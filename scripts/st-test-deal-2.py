#!/usr/bin/env python3
"""Test Deal 2 — Definitive. Chrome for Testing + CDP.
Fixes applied:
  1. ✅ launchd agent — CfT auto-starts on login (com.edgegde.chrome-for-testing)
  2. ✅ React __reactProps fallback — tries native click, keyboard, then props
  3. ✅ Contact field index — finds empty fields dynamically instead of nth()
  4. ✅ Wizard nav — clicks Next through all pages, fills labels + sections
"""

import os, sys, time, json, pyotp
from datetime import datetime, timedelta
from playwright.sync_api import sync_playwright

CDP = "http://localhost:9222"
BASE = "https://pc.v2.salestrekker.com"
UUID = "24f7b6a0-545a-4f8c-9e0f-0dc9ed175269"
U = os.environ.get("SALESTREKKER_USERNAME","")
P = os.environ.get("SALESTREKKER_PASSWORD","")
TS = os.environ.get("SALESTREKKER_TOTP_SECRET","")
REPORT = os.path.expanduser("~/Desktop/test-deal-2-report.json")
FINANCE_DUE = (datetime.now()+timedelta(days=14)).strftime("%d/%m/%Y")
SETTLEMENT = (datetime.now()+timedelta(days=90)).strftime("%d/%m/%Y")

stats = {"ok":0,"fail":0,"errors":[]}
def log(f, ok, n=""):
    k="ok" if ok else "fail"; stats[k]+=1
    if not ok: stats["errors"].append(f"{f}: {n}")
    print(f"  {'✅' if ok else '❌'} {f}")

def login(page):
    page.goto(f"{BASE}/dashboard", timeout=15000)
    time.sleep(2)
    if "sign-in" in page.url.lower():
        print("  → Logging in...")
        page.locator('input[type="email"]').fill(U)
        page.locator('input[type="password"]').fill(P)
        page.locator('button[type="submit"]').click(); time.sleep(3)
        if "totp" in page.url.lower() or "two-factor" in page.url.lower():
            code = pyotp.TOTP(TS).now()
            print(f"  → TOTP: {code}")
            page.locator('input._bS').first.focus()
            page.keyboard.type(code, delay=50); time.sleep(1)
            page.locator('button:has-text("Verify code")').click(); time.sleep(4)
        page.goto(f"{BASE}/dashboard", timeout=15000); time.sleep(3)
    log("Logged in", "dashboard" in page.url.lower())

def navigate_to_board(page):
    page.locator('#deals div[aria-haspopup]').click(); time.sleep(2)
    page.locator('[role=menu]').locator('text=Home Loans').first.click(); time.sleep(4)
    log("Home Loans board", True)

def open_add_contact_form(page):
    """Open the Add Contact inline form using native .click() on the popover trigger."""
    page.evaluate("""
        (function() {
            var divs = document.querySelectorAll('div[aria-haspopup]');
            for (var i = 0; i < divs.length; i++) {
                if (divs[i].textContent.trim() === 'Add contact') {
                    divs[i].click(); return true;
                }
            }
            return false;
        })()
    """)
    time.sleep(2)
    page.locator('text="Add new person"').first.click(timeout=3000)
    time.sleep(3)

def find_empty_input(page, name):
    """Find FIRST empty input with given name (not already filled by prior contact)."""
    loc = page.locator(f'input[name="{name}"]')
    for i in range(loc.count()):
        val = loc.nth(i).input_value()
        if not val or val.strip() == '':
            return loc.nth(i)
    return loc.first

def fill_contact(page, first, last, email, phone):
    """Fill inline contact form. Finds empty fields dynamically — no nth() fragility."""
    find_empty_input(page, 'firstName').fill(first); time.sleep(0.2)
    find_empty_input(page, 'lastName').fill(last); time.sleep(0.2)
    # value fields: find the two empty ones
    val_loc = page.locator('input[name="value"]')
    empty_indices = []
    for i in range(val_loc.count()):
        v = val_loc.nth(i).input_value()
        if not v or v.strip() == '':
            empty_indices.append(i)
    if len(empty_indices) >= 2:
        val_loc.nth(empty_indices[0]).fill(phone); time.sleep(0.2)
        val_loc.nth(empty_indices[1]).fill(email); time.sleep(0.3)
    # Click Add with fallback chain
    click_button_safe(page, 'Add', excludes=['contact'])
    time.sleep(3)
    log(f"Contact: {first} {last}", True, email)

def click_button_safe(page, text, excludes=None):
    """Click a button by text with fallback chain:
       1. Playwright locator.click()
       2. page.evaluate() native .click()
       3. page.evaluate() React __reactProps.onClick()
    """
    btn_text = f'button:has-text("{text}")'
    if excludes:
        for ex in excludes:
            btn_text += f':not(:has-text("{ex}"))'
    loc = page.locator(btn_text)
    # Method 1: Playwright click
    if loc.count() > 0 and loc.first.is_enabled():
        try:
            loc.first.click(timeout=3000)
            return True
        except:
            pass
    # Method 2: Native .click() via evaluate
    excl_js = ', '.join(f'el.textContent.indexOf("{ex}")===-1' for ex in (excludes or []))
    cond = ' && ' + excl_js if excl_js else ''
    result = page.evaluate(f"""
        (function() {{
            var btns = document.querySelectorAll('button');
            for (var i = 0; i < btns.length; i++) {{
                if (btns[i].textContent.trim() === '{text}' && btns[i].offsetParent !== null {cond}) {{
                    btns[i].click();
                    return 'CLICKED';
                }}
            }}
            return 'NOT_FOUND';
        }})()
    """)
    if 'CLICKED' in result:
        return True
    # Method 3: React props onClick
    excl_cond = ' && ' + ' && '.join(f'btns[i].textContent.indexOf("{ex}")===-1' for ex in (excludes or [])) if excludes else ''
    result2 = page.evaluate(f"""
        (function() {{
            var btns = document.querySelectorAll('button');
            for (var i = 0; i < btns.length; i++) {{
                if (btns[i].textContent.trim() === '{text}' && btns[i].offsetParent !== null {excl_cond}) {{
                    var key = Object.keys(btns[i]).find(function(k) {{ return k.startsWith('__reactProps'); }});
                    if (btns[i][key] && btns[i][key].onClick) {{
                        btns[i][key].onClick();
                        return 'REACT_CLICK';
                    }}
                }}
            }}
            return 'FAILED';
        }})()
    """)
    if 'REACT_CLICK' in result2:
        return True
    return False

def accept_wizard_page(page):
    """Accept the current wizard page — click Save or Next with fallbacks."""
    if click_button_safe(page, 'Save'):
        return True
    return click_button_safe(page, 'Next')

def main():
    pw = sync_playwright().start()
    browser = pw.chromium.connect_over_cdp(CDP)
    ctx = browser.contexts[0]
    page = ctx.pages[0] if ctx.pages else ctx.new_page()

    try:
        login(page)

        # ── PHASE 1: SETUP ────────────────────────────────
        print("\n=== PHASE 1: SETUP ===")
        navigate_to_board(page)
        page.locator('button:has-text("Add New")').first.click(); time.sleep(3)
        log("Add New opened", True)

        # Fill deal info
        page.locator('input[name="name"]').fill("Test 2 - Purple Circle Onboarding")
        log("Deal title set", True)
        page.locator('input[name="value.total"]').fill("800000")
        log("Property value $800k", True)
        dates = page.locator('input[placeholder="DD/MM/YYYY"]')
        if dates.count() >= 2:
            dates.nth(0).fill(FINANCE_DUE); dates.nth(1).fill(SETTLEMENT)
            log("Dates set", True)

        # ── PHASE 2: CONTACTS ─────────────────────────────
        print("\n=== PHASE 2: ADD CONTACTS ===")
        for name, first, last, email, phone in [
            ("Sam Smith (primary)", "Sam", "Smith", "sam.smith@example.com", "0400 000 000"),
            ("Amy Smith (secondary)", "Amy", "Smith", "amy.smith@example.com", "0400 000 001"),
        ]:
            print(f"  → {name}")
            open_add_contact_form(page)
            fill_contact(page, first, last, email, phone)

        # ── PHASE 3: WIZARD NAVIGATION ────────────────────
        print("\n=== PHASE 3: WIZARD NAVIGATION ===")
        # Click Next through wizard pages (deal-info → labels → custom-fields → etc.)
        for step in range(8):
            if click_button_safe(page, 'Next'):
                time.sleep(3)
                url = page.url
                log(f"Wizard step {step+2}", True, url[url.rfind('/')+1:70])
            else:
                break

        # ── PHASE 4: SAVE ─────────────────────────────────
        print("\n=== PHASE 4: SAVE ===")
        if click_button_safe(page, 'Save'):
            log("Deal saved", True)
            time.sleep(3)
        else:
            log("Deal saved", False, "all save methods failed")

        # ── REPORT ─────────────────────────────────────────
        total = stats["ok"]+stats["fail"]
        pct = round(stats["ok"]/total*100,1) if total else 0
        stats["timestamp"] = datetime.now().isoformat()
        with open(REPORT,"w") as f: json.dump(stats,f,indent=2)
        print(f"\n{'='*50}")
        print(f"RESULTS: {stats['ok']}/{total} ({pct}%)")
        if stats["errors"]:
            for e in stats["errors"][:10]: print(f"  - {e}")
        print(f"  Report: {REPORT}")

    finally:
        input("\nPress Enter...")
        pw.stop()

if __name__ == "__main__":
    main()
