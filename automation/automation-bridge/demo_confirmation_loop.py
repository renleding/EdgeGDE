#!/usr/bin/env python3
"""Live end-to-end demo — AutomationBridge hot-reload + visual confirmation loop.

Drives the REAL stack against a dedicated Chrome for Testing instance:

  1. CfT launched headless with CDP on a dedicated port (fresh profile)
  2. Fixture app served over HTTP (state persists in localStorage + URL hash,
     so the post-reload region capture shows the real change)
  3. REAL AutomationBridgeResolver (work/automation-bridge-fastpath @ f3513f4) served by
     resolver_transport_adapter.py on the IDD-016 transport (MCP frame +
     byte-identical HTTP fallback, X-AutomationBridge-Bridge-Version checked)
  4. DesignModeCapture installs Design Mode into the tab (Runtime binding +
     script-on-new-document), the harness simulates the human pick click
  5. ActionConfirmationLoop runs: capture → resolve (confidence 1.0 exact
     fast path) → §8 policy → ABActionBridge execution → state-diff
     verification → Page.reload → re-locate → region re-capture → panel
     render injected into the page

Scenarios:
  1. VERIFIED — pick "Enable sync", click executes, state changes (URL hash
     + button count), page hot-reloads, before/after thumbs + VERIFIED badge.
  2. NO STATE CHANGE — pick "Ping (no-op)": action dispatches, state-diff
     shows zero change → UNVERIFIED badge + diff evidence, never a success
     badge (frozen decision 5).
  3. TRANSPORT ERROR — resolver adapter stopped → synthesized
     RESOLVER_UNREACHABLE envelope → error card with code/retryable/
     retry_policy (frozen decision 4), no reload.

Exit 0 only when every assertion passes. Evidence (screenshots + session
JSONs + report) lands in the output directory.
"""
from __future__ import annotations

import argparse
import asyncio
import base64
import json
import logging
import socket
import subprocess
import sys
import threading
import time
import urllib.request
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

_HERE = Path(__file__).resolve().parent
for _p in (str(_HERE), str(_HERE.parents[1] / "apps" / "state-engine")):
    if _p not in sys.path:
        sys.path.insert(0, _p)

from design_mode_capture import DesignModeCapture  # noqa: E402
from design_mode_confirmation import ActionConfirmationLoop, build_confirmation_payload  # noqa: E402

logger = logging.getLogger("automation_bridge.demo")

CFT_BINARY = Path.home() / "Applications" / "Google Chrome for Testing.app" / "Contents" / "MacOS" / "Google Chrome for Testing"
FASTPATH_STATE_ENGINE = Path("/Users/warren/automation_bridge-worktrees/automation-bridge-fastpath/apps/state-engine")


def free_port() -> int:
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


def http_json(url: str, timeout: float = 5.0):
    with urllib.request.urlopen(url, timeout=timeout) as r:  # noqa: S310 - localhost only
        return json.loads(r.read().decode())


class NoCacheFixtureHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):  # noqa: A002 - silence request log
        pass


class Demo:
    def __init__(self, out_dir: Path, headless: bool = True, engine_dir: Path = FASTPATH_STATE_ENGINE, cdp_port: int = 9333):
        self.out_dir = out_dir
        self.out_dir.mkdir(parents=True, exist_ok=True)
        self.headless = headless
        self.engine_dir = engine_dir
        self.cdp_port = cdp_port
        self.loop: asyncio.AbstractEventLoop | None = None
        self.browser_proc: subprocess.Popen | None = None
        self.browser_ws = ""
        self.fixture_server: ThreadingHTTPServer | None = None
        self.fixture_port = 0
        self.fixture_url = ""
        self.adapter_proc: subprocess.Popen | None = None
        self.resolver_port = 0
        self.capture: DesignModeCapture | None = None
        self.confirm: ActionConfirmationLoop | None = None
        self.target_id = ""
        self.page_ws = ""
        self.report: dict = {"scenarios": []}

    def run_async(self, coro):
        assert self.loop is not None
        return self.loop.run_until_complete(coro)

    # ── infrastructure ────────────────────────────────────────────────────

    def launch_browser(self):
        profile = self.out_dir / "cft-profile"
        cmd = [
            str(CFT_BINARY),
            f"--remote-debugging-port={self.cdp_port}",
            "--remote-debugging-address=127.0.0.1",
            "--remote-allow-origins=*",
            f"--user-data-dir={profile}",
            "--no-first-run",
            "--no-default-browser-check",
            "--disable-gpu",
            "--window-size=1280,800",
            "about:blank",
        ]
        if self.headless:
            cmd.append("--headless=new")
        self.browser_proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        deadline = time.time() + 20
        while time.time() < deadline:
            try:
                version = http_json(f"http://127.0.0.1:{self.cdp_port}/json/version")
                logger.info("CfT online: %s", version.get("Browser", ""))
                self.browser_ws = version["webSocketDebuggerUrl"]
                return
            except Exception:
                time.sleep(0.3)
        raise RuntimeError(f"CfT did not come up on port {self.cdp_port}")

    def start_fixture_server(self):
        handler = partial(NoCacheFixtureHandler, directory=str(_HERE / "fixtures"))
        self.fixture_server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        self.fixture_port = self.fixture_server.server_address[1]
        threading.Thread(target=self.fixture_server.serve_forever, daemon=True).start()
        self.fixture_url = f"http://127.0.0.1:{self.fixture_port}/confirmation-demo.html"
        logger.info("fixture at %s", self.fixture_url)

    def start_resolver_adapter(self):
        self.resolver_port = free_port()
        cmd = [
            sys.executable, str(_HERE / "resolver_transport_adapter.py"),
            "--port", str(self.resolver_port),
            "--page-ws", self.page_ws,
            "--state-engine-dir", str(self.engine_dir),
            "--pin-target", self.target_id,
        ]
        self.adapter_proc = subprocess.Popen(
            cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
        )
        deadline = time.time() + 20
        while time.time() < deadline:
            try:
                health = http_json(f"http://127.0.0.1:{self.resolver_port}/healthz")
                if health.get("ok"):
                    logger.info("resolver adapter online (real AutomationBridgeResolver) on :%d", self.resolver_port)
                    return
            except Exception:
                if self.adapter_proc.poll() is not None:
                    out = self.adapter_proc.stdout.read() if self.adapter_proc.stdout else ""
                    raise RuntimeError(f"resolver adapter exited early:\n{out}")
                time.sleep(0.2)
        raise RuntimeError("resolver adapter did not become ready in 20s")

    def stop_resolver_adapter(self):
        if self.adapter_proc:
            self.adapter_proc.terminate()
            try:
                self.adapter_proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.adapter_proc.kill()
            self.adapter_proc = None
            logger.info("resolver adapter stopped")

    def open_fixture_tab(self):
        assert self.capture
        res = self.run_async(self.capture.cdp.send("Target.createTarget", {"url": "about:blank"}))
        self.target_id = res["targetId"]
        for _ in range(50):
            for t in http_json(f"http://127.0.0.1:{self.cdp_port}/json/list"):
                if t.get("id") == self.target_id:
                    self.page_ws = t["webSocketDebuggerUrl"]
                    break
            if self.page_ws:
                break
            time.sleep(0.1)
        assert self.page_ws, "page ws not discovered"
        # Register the on-new-document script BEFORE navigating to the
        # fixture, so the fixture document itself runs Design Mode.
        self.capture.cdp.subscribe(self.capture.feed_event)
        self.run_async(self.capture.install_design_mode(self.target_id))
        self.run_async(self.capture._cdp("Page.navigate", {"url": self.fixture_url}, self.target_id))
        deadline = time.time() + 15
        while time.time() < deadline:
            url = self.run_async(self.capture.evaluate(self.target_id, "location.href"))
            if str(url).startswith("http"):
                logger.info("fixture loaded: %s", url)
                return
            time.sleep(0.2)
        raise RuntimeError("fixture page did not load")

    # ── helpers ───────────────────────────────────────────────────────────

    def evaluate(self, expr: str):
        return self.run_async(self.capture.evaluate(self.target_id, expr))

    def reset_fixture(self):
        """Clean fixture state + fresh document; Design Mode auto-restores."""
        self.evaluate("localStorage.clear()")
        self.evaluate("history.replaceState(null,'',location.pathname+location.search)")
        self.run_async(self.capture.reload_and_wait(self.target_id))
        deadline = time.time() + 10
        while time.time() < deadline:
            if self.evaluate("typeof window.automation_bridgeDesignMode === 'object'"):
                break
            time.sleep(0.1)
        self.evaluate("try{sessionStorage.removeItem('automation_bridgeDesignMode.pending')}catch(e){}")
        self.evaluate("window.automation_bridgeDesignMode && !window.automation_bridgeDesignMode.isActive() && window.automation_bridgeDesignMode.enable()")

    def pick_at_element(self, selector: str) -> dict:
        """Simulate the human Design Mode click: real mouse press/release."""
        coords = self.evaluate(
            "(function(){const el=document.querySelector(" + json.dumps(selector) + ");"
            "if(!el)return null;const r=el.getBoundingClientRect();"
            "return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()"
        )
        assert coords, f"element {selector} not found for pick"
        for typ in ("mousePressed", "mouseReleased"):
            self.run_async(self.capture._cdp(
                "Input.dispatchMouseEvent",
                {"type": typ, "x": coords["x"], "y": coords["y"], "button": "left", "clickCount": 1},
                self.target_id,
            ))
            time.sleep(0.05)
        return self.run_async(self.capture.next_pick(timeout=10))

    def page_screenshot(self, name: str) -> str:
        res = self.run_async(self.capture._cdp(
            "Page.captureScreenshot", {"format": "png"}, self.target_id
        ))
        path = self.out_dir / name
        path.write_bytes(base64.b64decode(res["data"]))
        logger.info("evidence screenshot: %s", path)
        return str(path)

    def panel_text(self) -> str:
        return str(self.evaluate(
            "(function(){const h=document.getElementById('confirmationContent');"
            "return h?h.textContent:''})()"
        ) or "")

    def panel_images(self) -> int:
        return int(self.evaluate(
            "document.querySelectorAll('#confirmationContent img').length"
        ) or 0)

    # ── scenarios ─────────────────────────────────────────────────────────

    def scenario_verified_toggle(self):
        logger.info("=" * 70)
        logger.info("SCENARIO 1: pick #sync-toggle → click → verified → hot-reload → before/after")
        pick = self.pick_at_element("#sync-toggle")
        session = self.run_async(self.confirm.process_pick(pick))
        resolution = (session.envelope or {}).get("resolution") or {}
        outcome = resolution.get("action_outcome") or {}
        s = {
            "phase": session.phase,
            "verdict": session.verdict,
            "confidence": resolution.get("confidence"),
            "resolution_path": resolution.get("resolution_path"),
            "transport": session.transport,
            "reloaded": (session.reload or {}).get("reloaded"),
            "after_shot": bool(session.after_shot),
            "dom_changed": (session.after_element or {}).get("dom_changed"),
            "tier": outcome.get("action_tier"),
            "stage_log": [e["stage"] for e in session.stage_log],
        }
        panel = self.panel_text()
        s["panel_has_verified"] = "VERIFIED — state change confirmed" in panel
        s["panel_images"] = self.panel_images()
        s["fixture_sync"] = self.evaluate("localStorage.getItem('automation_bridgeDemo.sync')")
        s["fixture_line"] = self.evaluate("document.getElementById('state-line').textContent")
        s["screenshot"] = self.page_screenshot("scenario1-verified.png")
        self.report["scenarios"].append({"name": "verified-toggle", "result": s, "session": session_dump(session)})
        assert session.phase == "confirmed", f"phase={session.phase} error={session.error}"
        assert session.verdict == "verified", f"verdict={session.verdict}"
        assert s["confidence"] == 1.0, f"confidence={s['confidence']}"
        assert s["resolution_path"] == "exact_backend_node"
        assert s["reloaded"] is True
        assert s["after_shot"] is True
        assert s["dom_changed"] is True
        assert s["fixture_sync"] == "on"
        assert "Sync is ON" in str(s["fixture_line"])
        assert s["panel_has_verified"], f"panel missing VERIFIED badge: {panel[:400]}"
        assert s["panel_images"] >= 2, "before/after thumbs missing"
        for stage in ("action_executed", "reloaded", "recaptured", "rendered"):
            assert stage in s["stage_log"], f"stage {stage} missing"
        logger.info("SCENARIO 1 PASS: %s", json.dumps(s, indent=2))
        return session

    def scenario_noop(self):
        logger.info("=" * 70)
        logger.info("SCENARIO 2: pick #ping-btn → no-op → no_state_change evidence (never a success badge)")
        self.reset_fixture()
        pick = self.pick_at_element("#ping-btn")
        session = self.run_async(self.confirm.process_pick(pick))
        resolution = (session.envelope or {}).get("resolution") or {}
        verification = (resolution.get("action_outcome") or {}).get("verification") or {}
        panel = self.panel_text()
        s = {
            "phase": session.phase,
            "verdict": session.verdict,
            "verified": verification.get("verified"),
            "reloaded": (session.reload or {}).get("reloaded"),
            "after_shot": bool(session.after_shot),
            "panel_has_no_state_change": "NO STATE CHANGE" in panel,
            "panel_has_not_success_note": "NOT a success" in panel,
            "panel_has_verified_badge": "VERIFIED — state change confirmed" in panel,
            "panel_images": self.panel_images(),
        }
        s["screenshot"] = self.page_screenshot("scenario2-no-state-change.png")
        self.report["scenarios"].append({"name": "no-state-change", "result": s, "session": session_dump(session)})
        assert session.phase == "confirmed" and session.verdict == "no_state_change"
        assert s["verified"] is False
        assert s["reloaded"] is True and s["after_shot"] is True
        assert s["panel_has_no_state_change"] and s["panel_has_not_success_note"]
        assert not s["panel_has_verified_badge"], "frozen decision 5 violated: success badge on no_state_change"
        assert s["panel_images"] >= 2
        logger.info("SCENARIO 2 PASS: %s", json.dumps(s, indent=2))
        return session

    def scenario_resolver_down(self):
        logger.info("=" * 70)
        logger.info("SCENARIO 3: resolver down → synthesized RESOLVER_UNREACHABLE error card (no reload)")
        self.stop_resolver_adapter()
        self.reset_fixture()
        pick = self.pick_at_element("#sync-toggle")
        session = self.run_async(self.confirm.process_pick(pick))
        panel = self.panel_text()
        s = {
            "phase": session.phase,
            "error_code": (session.error or {}).get("code"),
            "retryable": (session.error or {}).get("retryable"),
            "retry_policy": (session.error or {}).get("retry_policy"),
            "reloaded": (session.reload or {}).get("reloaded"),
            "panel_has_code": "RESOLVER_UNREACHABLE" in panel,
            "panel_has_retryable": "retryable" in panel.lower(),
            "panel_has_retry_policy": "backoff" in panel.lower(),
        }
        s["screenshot"] = self.page_screenshot("scenario3-resolver-unreachable.png")
        self.report["scenarios"].append({"name": "resolver-unreachable", "result": s, "session": session_dump(session)})
        assert session.phase == "error"
        assert s["error_code"] == "RESOLVER_UNREACHABLE"
        assert not s["reloaded"], "error path must NOT reload"
        assert s["panel_has_code"] and s["panel_has_retryable"] and s["panel_has_retry_policy"]
        logger.info("SCENARIO 3 PASS: %s", json.dumps(s, indent=2))
        return session

    # ── lifecycle ─────────────────────────────────────────────────────────

    def run(self):
        self.loop = asyncio.new_event_loop()
        asyncio.set_event_loop(self.loop)
        self.launch_browser()
        try:
            self.capture = DesignModeCapture(
                self.browser_ws,
                state_engine_port=9110,
                unreachable_ladder_ms=[50, 150, 250, 600],
            )
            self.run_async(self.capture.connect())
            self.start_fixture_server()
            self.open_fixture_tab()
            self.start_resolver_adapter()
            self.capture.state_engine_port = self.resolver_port
            self.confirm = ActionConfirmationLoop(
                self.capture,
                page_ws_url=self.page_ws,
                default_target_id=self.target_id,
            )
            # The human toggles Design Mode in the demo.
            self.evaluate("window.automation_bridgeDesignMode.enable()")
            assert self.evaluate("window.automation_bridgeDesignMode.isActive()") is True

            self.scenario_verified_toggle()
            self.scenario_noop()
            self.scenario_resolver_down()

            self.report["all_passed"] = True
            logger.info("=" * 70)
            logger.info("ALL DEMO SCENARIOS PASSED")
        finally:
            try:
                if self.confirm:
                    self.run_async(self.confirm.close())
            except Exception:
                pass
            self.stop_resolver_adapter()
            try:
                if self.capture:
                    self.run_async(self.capture.close())
            except Exception:
                pass
            if self.fixture_server:
                self.fixture_server.shutdown()
            if self.browser_proc:
                self.browser_proc.terminate()
                try:
                    self.browser_proc.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    self.browser_proc.kill()
            if self.loop:
                self.loop.close()


def session_dump(session) -> dict:
    """JSON-safe session summary for the report (drops bulky shot data)."""
    payload = build_confirmation_payload(session)
    for key in ("before", "after"):
        shot = payload.get(key)
        if shot and shot.get("data_uri"):
            shot["data_uri"] = shot["data_uri"][:64] + f"…({len(shot['data_uri'])} chars)"
    return payload


def main(argv=None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s [%(name)s] %(message)s")
    p = argparse.ArgumentParser(description="AutomationBridge confirmation loop — live end-to-end demo")
    p.add_argument("--out-dir", default="/Users/warren/.hermes/cache/scratch/automation_bridge-confirmation-demo")
    p.add_argument("--headless", type=lambda v: str(v).lower() != "false", default=True)
    p.add_argument("--engine-dir", default=str(FASTPATH_STATE_ENGINE))
    p.add_argument("--cdp-port", type=int, default=9333)
    args = p.parse_args(argv)

    if not CFT_BINARY.exists():
        logger.error("Chrome for Testing not found at %s", CFT_BINARY)
        return 2
    if not Path(args.engine_dir, "resolver.py").exists():
        logger.error("state-engine dir with AutomationBridgeResolver not found at %s", args.engine_dir)
        return 2

    demo = Demo(out_dir=Path(args.out_dir), headless=args.headless, engine_dir=Path(args.engine_dir), cdp_port=args.cdp_port)
    try:
        demo.run()
    except AssertionError as e:
        logger.error("DEMO FAILED (assertion): %s", e)
        (Path(args.out_dir) / "report.json").write_text(json.dumps(demo.report, indent=2))
        return 1
    except Exception as e:
        logger.exception("DEMO FAILED (exception): %s", e)
        (Path(args.out_dir) / "report.json").write_text(json.dumps(demo.report, indent=2))
        return 1

    report_path = Path(args.out_dir) / "report.json"
    report_path.write_text(json.dumps(demo.report, indent=2))
    logger.info("report: %s", report_path)
    print(json.dumps({"all_passed": True, "out_dir": str(demo.out_dir), "report": str(report_path)}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
