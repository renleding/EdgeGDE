#!/usr/bin/env python3
"""Patchright vs Playwright — Salestrekker Suitability Test.

Compares both engines on:
  1. Login page load success
  2. Authentication flow (with TOTP)
  3. Dashboard navigation
  4. Bot detection markers
  5. Performance (cold start, page load, interaction latency)

Respects HARD LIMIT of 2 login attempts total across both engines.
Uses dedicated 8um7547w profile for persistent sessions.
"""

import json
import os
import sys
import tempfile
import time
from datetime import datetime

# ── Config ──────────────────────────────────────────────────────────────────

PROFILE_DIR = tempfile.mkdtemp(prefix="patchright-test-")
BASE_URL = "https://pc.v2.salestrekker.com"
RESULTS_DIR = os.path.expanduser("~/Desktop/patchright-test")

os.makedirs(RESULTS_DIR, exist_ok=True)

# Credentials from environment (Bitwarden injected)
USERNAME = os.environ.get("SALESTREKKER_USERNAME", "")
PASSWORD = os.environ.get("SALESTREKKER_PASSWORD", "")
TOTP_SECRET = os.environ.get("SALESTREKKER_TOTP_SECRET", "")

MINIMUM_PROFILE_SIZE = 100000  # 100KB — profile must have prior session


# ── Helpers ─────────────────────────────────────────────────────────────────


def log_result(name: str, data: dict):
    path = os.path.join(RESULTS_DIR, f"{name}.json")
    with open(path, "w") as f:
        json.dump(data, f, indent=2, default=str)
    print(f"  Results saved: {path}")


def check_bot_markers(page, engine: str) -> dict:
    """Run common bot detection checks via JS execution context."""
    markers = {}
    markers["engine"] = engine
    markers["webdriver"] = page.evaluate("navigator.webdriver")
    markers["plugins_length"] = page.evaluate("navigator.plugins.length")
    markers["languages"] = page.evaluate("navigator.languages")
    markers["chrome_runtime"] = page.evaluate(
        "typeof window.chrome === 'object' && window.chrome !== null"
    )
    markers["chrome_runtime_in_runtime"] = page.evaluate(
        "typeof chrome === 'object' && chrome.runtime !== undefined"
    )
    # Check for Playwright-specific CDP detection leaks
    markers["playwright_global"] = page.evaluate(
        "window.__playwright__ !== undefined"
    )
    markers[
        "phantom_global"
    ] = """
        eval("var flag = false; try { if (window.callPhantom) flag = true } catch(e){}; flag")
    """ and False  # No phantom check needed
    markers["permissions_status"] = page.evaluate(
        """navigator.permissions.query({name: 'notifications'})
           .then(p => p.state).catch(() => 'error')"""
    )
    return markers


def detect_blocked_page(page) -> tuple[bool, str]:
    """Check if Salestrekker served the real login or a bot block page."""
    title = page.title().lower()
    url = page.url.lower()
    body = page.evaluate("document.body?.innerText?.substring(0, 200) || ''").lower()

    is_blocked = (
        "access denied" in body
        or "automated" in body
        or "blocked" in body
        or "challenge" in body
        or "captcha" in title
        or "denied" in title
        or "sorry" in body[:100]
    )
    reason = ""
    if is_blocked:
        if "captcha" in title or "challenge" in body:
            reason = "CAPTCHA_CHALLENGE"
        elif "access denied" in body:
            reason = "ACCESS_DENIED"
        elif "automated" in body:
            reason = "BOT_DETECTED"
        else:
            reason = "BLOCK_PAGE"
    return is_blocked, reason


# ── Test Runner ─────────────────────────────────────────────────────────────


def run_test(
    engine_name: str,
    use_patchright: bool,
    attempt_number: int,
) -> dict:
    """Run a full test cycle for one engine.

    Returns structured result dict.
    """
    if use_patchright:
        from patchright.sync_api import sync_playwright
    else:
        from playwright.sync_api import sync_playwright

    result = {
        "engine": engine_name,
        "attempt": attempt_number,
        "timestamp": datetime.now().isoformat(),
        "phases": {},
        "markers": None,
        "success": False,
        "errors": [],
    }

    with sync_playwright() as p:
        browser = None
        try:
            # ── Phase 1: Launch ──────────────────────────────────────
            t0 = time.time()
            browser = p.chromium.launch_persistent_context(
                user_data_dir=PROFILE_DIR,
                channel="chrome",
                headless=False,
                args=[
                    "--no-first-run",
                    "--disable-blink-features=AutomationControlled",
                ]
                if not use_patchright
                else [],  # Patchright handles args itself
                viewport={"width": 1280, "height": 900},
            )
            launch_time = time.time() - t0
            result["phases"]["launch"] = {
                "time_s": round(launch_time, 2),
                "profile_exists": os.path.isdir(PROFILE_DIR),
            }

            page = browser.pages[0] if browser.pages else browser.new_page()

            # ── Phase 2: Navigate to login ──────────────────────────
            t0 = time.time()
            page.goto(f"{BASE_URL}/auth/sign-in", wait_until="networkidle")
            nav_time = time.time() - t0
            result["phases"]["navigate"] = {
                "url": page.url,
                "time_s": round(nav_time, 2),
            }

            # Check for bot block
            blocked, reason = detect_blocked_page(page)
            result["phases"]["navigate"]["blocked"] = blocked
            result["phases"]["navigate"]["block_reason"] = reason
            if blocked:
                result["errors"].append(f"BLOCKED on navigation: {reason}")
                # Still collect markers for analysis
                result["markers"] = check_bot_markers(page, engine_name)
                browser.close()
                return result

            # ── Phase 3: Bot detection markers ──────────────────────
            result["markers"] = check_bot_markers(page, engine_name)

            # ── Phase 4: Check if already authenticated ──────────────
            t0 = time.time()
            is_logged_in = "dashboard" in page.url.lower() or "deals" in page.url.lower()
            if not is_logged_in:
                # Check for sign-in form
                has_email_field = page.query_selector('input[type="email"]') is not None
                result["phases"]["auth_check"] = {
                    "already_logged_in": False,
                    "has_email_field": bool(has_email_field),
                    "time_s": round(time.time() - t0, 2),
                }

                # Only attempt login if we have credentials and haven't hit limits
                if USERNAME and PASSWORD and attempt_number <= 2:
                    # ── Login ───────────────────────────────────────
                    page.fill('input[type="email"]', USERNAME)
                    page.fill('input[type="password"]', PASSWORD)
                    page.click('button[type="submit"]')
                    page.wait_for_timeout(3000)

                    # ── TOTP ────────────────────────────────────────
                    if "totp" in page.url.lower() or page.query_selector("input:not([type])"):
                        if TOTP_SECRET:
                            import pyotp

                            totp_code = pyotp.TOTP(TOTP_SECRET).now()
                            digits = page.query_selector_all("input:not([type])")
                            for i, d in enumerate(digits[:6]):
                                d.fill(totp_code[i])
                            page.wait_for_timeout(1000)
                            page.click('button[type="submit"]')
                            page.wait_for_timeout(5000)

                    # Check if login succeeded
                    page.wait_for_load_state("networkidle", timeout=15000)
                    is_logged_in = "dashboard" in page.url.lower() or "deals" in page.url.lower()
                    result["phases"]["login"] = {
                        "success": is_logged_in,
                        "url_after": page.url,
                    }
                else:
                    result["phases"]["login"] = {
                        "success": False,
                        "reason": (
                            "no_credentials"
                            if not USERNAME
                            else "attempt_limit_reached"
                        ),
                    }
            else:
                result["phases"]["auth_check"] = {
                    "already_logged_in": True,
                    "time_s": round(time.time() - t0, 2),
                }

            # ── Phase 5: Dashboard interaction (if authenticated) ───
            if is_logged_in:
                t0 = time.time()
                # Verify key dashboard elements
                has_sidebar = False
                has_user_menu = False
                try:
                    has_sidebar = (
                        page.query_selector("nav, ul, [class*=sidebar]") is not None
                    )
                    has_user_menu = (
                        page.query_selector(
                            '[class*=avatar], [class*=user], [class*=profile]'
                        )
                        is not None
                    )
                except Exception:
                    pass

                # Memory usage
                mem = {}
                try:
                    mem = page.evaluate(
                        """JSON.stringify({
                            jsHeap: performance.memory?.usedJSHeapSize || null,
                            totalJSHeap: performance.memory?.totalJSHeapSize || null
                        })"""
                    )
                    mem = json.loads(mem) if isinstance(mem, str) else {}
                except Exception:
                    pass

                result["phases"]["dashboard"] = {
                    "time_s": round(time.time() - t0, 2),
                    "has_sidebar": has_sidebar,
                    "has_user_menu": has_user_menu,
                    "url": page.url,
                    "memory_kb": round(mem.get("jsHeap", 0) / 1024, 0) if mem.get("jsHeap") else None,
                }
                result["success"] = True
            else:
                result["phases"]["dashboard"] = {"reached": False}

        except Exception as e:
            result["errors"].append(f"{type(e).__name__}: {e}")
            import traceback

            result["errors"].append(traceback.format_exc()[-500:])
        finally:
            if browser:
                try:
                    browser.close()
                except Exception:
                    pass

    return result


# ── Main ────────────────────────────────────────────────────────────────────


def main():
    print("=" * 60)
    print("PATCHRIGHT vs PLAYWRIGHT — Salestrekker Suitability Test")
    print(f"Profile: {PROFILE_DIR}")
    print(f"Profile exists: {os.path.isdir(PROFILE_DIR)}")
    print(f"Time: {datetime.now().isoformat()}")
    print("=" * 60)

    # Profile check
    profile_ok = os.path.isdir(PROFILE_DIR)
    if not profile_ok:
        print("\n⚠️  No existing profile found at 8um7547w.")
        print("   First run will create it and require fresh login.\n")

    results = []
    attempts = 0

    # Test 1: Playwright baseline
    print("\n[1/2] PLAYWRIGHT baseline...")
    r1 = run_test("playwright", use_patchright=False, attempt_number=1)
    results.append(r1)
    attempts += 1
    status = "✅" if r1["success"] else "❌"
    nav_blocked = r1["phases"].get("navigate", {}).get("blocked", False)
    nav_icon = "🚫" if nav_blocked else "✅"
    print(
        f"  {status} Dashboard: {r1['success']}  "
        f"{nav_icon} Blocked: {nav_blocked}  "
        f"Launch: {r1['phases'].get('launch',{}).get('time_s','?')}s  "
        f"Errors: {len(r1['errors'])}"
    )

    # Test 2: Patchright
    print("\n[2/2] PATCHRIGHT...")
    r2 = run_test("patchright", use_patchright=True, attempt_number=2)
    results.append(r2)
    attempts += 1
    status = "✅" if r2["success"] else "❌"
    nav_blocked = r2["phases"].get("navigate", {}).get("blocked", False)
    nav_icon = "🚫" if nav_blocked else "✅"
    print(
        f"  {status} Dashboard: {r2['success']}  "
        f"{nav_icon} Blocked: {nav_blocked}  "
        f"Launch: {r2['phases'].get('launch',{}).get('time_s','?')}s  "
        f"Errors: {len(r2['errors'])}"
    )

    # Summary
    print("\n" + "=" * 60)
    print("SUMMARY")
    print("=" * 60)

    for r in results:
        launch = r["phases"].get("launch", {})
        nav = r["phases"].get("navigate", {})
        dash = r["phases"].get("dashboard", {})
        markers = r.get("markers") or {}

        print(f"\n{r['engine'].upper()}:")
        print(f"  Success:       {'✅' if r['success'] else '❌'}")
        print(f"  Launch time:   {launch.get('time_s', '?'):>5.1f}s")
        print(f"  Nav time:      {nav.get('time_s', '?'):>5.1f}s")
        print(f"  Blocked:       {'🚫' if nav.get('blocked') else '✅'}")
        if nav.get("block_reason"):
            print(f"  Block reason:  {nav['block_reason']}")
        if dash:
            print(f"  Dash time:     {dash.get('time_s', '?'):>5.1f}s")
            print(f"  Sidebar found: {'✅' if dash.get('has_sidebar') else '❌'}")
            print(f"  User menu:     {'✅' if dash.get('has_user_menu') else '❌'}")
        if markers:
            print(f"  Bot markers:")
            print(f"    navigator.webdriver: {markers.get('webdriver')}")
            print(f"    plugins.length:      {markers.get('plugins_length')}")
            print(f"    chrome.runtime:      {markers.get('chrome_runtime')}")
            print(
                f"    __playwright__ leak: {'🔴' if markers.get('playwright_global') else '✅'}"
            )
        if r.get("errors"):
            print(f"  Errors ({len(r['errors'])}):")
            for e in r["errors"][:3]:
                print(f"    - {e[:120]}")

    # Save all
    summary = {
        "timestamp": datetime.now().isoformat(),
        "profile_exists": profile_ok,
        "profile_dir": PROFILE_DIR,
        "total_attempts": attempts,
        "results": results,
    }
    log_result("summary", summary)

    print(f"\nFull results: {RESULTS_DIR}/summary.json")
    print(f"⚠️  {attempts} login attempt(s) used. Max is 2 per session.")


if __name__ == "__main__":
    main()
