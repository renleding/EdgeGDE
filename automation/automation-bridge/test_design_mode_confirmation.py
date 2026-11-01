#!/usr/bin/env python3
"""Tests for automation/automation_bridge/design_mode_confirmation.py (IDD-016 confirmation loop).

Fake capture (duck-typed DesignModeCapture) + fake bridge (duck-typed
ABActionBridge) — no browser, no resolver. Asserts the pipeline semantics:
policy bands, hot-reload, re-location, recapture, render payload shape, and
the frozen failure-honesty rules (error → no reload; no_state_change →
evidence not a success badge; rejection → no reload).
"""
import asyncio
import json
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))

from design_mode_confirmation import (  # noqa: E402
    ActionConfirmationLoop,
    ConfirmationSession,
    build_confirmation_payload,
    classify_outcome,
    policy_decision,
)
from design_mode_confirmation import _dispatch_envelope, _diff_summary_text  # noqa: E402

TARGET = "TGT-1"

# ── fakes ──────────────────────────────────────────────────────────────────

BEFORE_SHOT = {
    "storage": "data_uri",
    "data_uri": "data:image/png;base64,BEFORE",
    "mime_type": "image/png",
    "width": 100,
    "height": 40,
    "sha256": "b" * 64,
}
AFTER_SHOT = {
    "storage": "data_uri",
    "data_uri": "data:image/png;base64,AFTER",
    "mime_type": "image/png",
    "width": 100,
    "height": 40,
    "sha256": "a" * 64,
}


def resolution_envelope(request_id, *, confidence=1.0, hints=("click",), selector="button#sync-toggle"):
    return {
        "schema_version": "2.0.0",
        "request_id": request_id,
        "resolved_at": "2026-10-26T08:15:00.000Z",
        "resolution": {
            "status": "resolved",
            "resolution_path": "exact_backend_node",
            "confidence": confidence,
            "element_ref": {
                "backend_dom_node_id": 6,
                "selector": selector,
                "ax_node_id": None,
                "bounds": {"x": 41, "y": 138, "width": 100, "height": 40},
                "frame_id": None,
                "target_id": TARGET,
            },
            "strategy": "backend_node_exact",
            "element_type": "button",
            "action_hints": list(hints),
            "known_bug_flags": [],
            "known_bug_workarounds": [],
            "fallback_match": None,
            "action_outcome": None,
        },
        "resolver": {"version": "state-engine@1.4.2", "latency_ms": 2.6, "node_live": True, "target_id": TARGET},
        "warnings": [],
    }


def error_envelope(request_id, code="STALE_NODE", retryable=False, retry_policy="recapture"):
    return {
        "schema_version": "2.0.0",
        "request_id": request_id,
        "resolved_at": "2026-10-26T08:15:00.000Z",
        "resolver": {"version": "state-engine@1.4.2", "latency_ms": 0, "node_live": False, "target_id": TARGET},
        "error": {
            "code": code,
            "message": f"simulated {code}",
            "retryable": retryable,
            "retry_policy": retry_policy,
            "details": {"stale_backend_dom_node_id": 6},
            "known_bug_flags": [],
        },
        "warnings": [],
    }


def _extract_rendered_payload(expression: str):
    """Robustly extract the JSON payload from a render-injection call.

    Handles payloads containing parens/quotes (e.g. diff_summary text with
    nested parentheses) by tracking brace depth rather than rindex(")").
    """
    marker = "window.__automation_bridgeDesignModeRenderConfirmation("
    if marker not in expression:
        return None
    start = expression.index(marker) + len(marker)
    brace = expression.find("{", start)
    if brace == -1:
        return None
    depth = 0
    for i in range(brace, len(expression)):
        c = expression[i]
        if c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                return json.loads(expression[brace:i + 1])
    return None


class FakeCapture:
    """Duck-typed DesignModeCapture for the loop."""

    def __init__(self, *, envelope=None, region=None, relocate_visible=True, region_error=None):
        self.envelope = envelope
        self.region = region if region is not None else {
            "geometry": {"x": 41, "y": 138, "width": 100, "height": 40, "coordinate_space": "viewport"},
            "screenshot": dict(AFTER_SHOT),
            "outer_html": '<button id="sync-toggle">Disable sync</button>',
        }
        self.relocate_visible = relocate_visible
        self.region_error = region_error
        self.last_transport = "mcp"
        self.capture_calls = []
        self.resolve_calls = []
        self.reload_calls = []
        self.render_calls = []
        self.evaluate_calls = []
        self.guard_states = []

    async def capture_element(self, target_id, x=None, y=None, remote_object_id=None, selector_hints=None):
        self.capture_calls.append({"target_id": target_id, "x": x, "y": y, "selector_hints": selector_hints})
        return {
            "schema_version": "2.0.0",
            "request_id": "req-" + target_id,
            "timeout_ms": 10000,
            "page": {"url": "http://fixture/", "target_id": target_id, "viewport": {"width": 1280, "height": 800}},
            "element": {
                "backend_dom_node_id": 6,
                "dom_snapshot": {
                    "outer_html": '<button id="sync-toggle">Enable sync</button>',
                    "tag": "button",
                    "attributes": {"id": "sync-toggle", "data-testid": "sync-toggle", "aria-label": "Toggle sync"},
                    "text_content": "Enable sync",
                    "ancestor_path": [{"tag": "div", "index": 1}, {"tag": "html", "index": 1}],
                    "structural_hash": "h" * 64,
                    "child_count": 0,
                    "truncated": False,
                },
                "computed_styles": {k: "block" for k in (
                    "display", "visibility", "opacity", "pointer-events", "cursor",
                    "color", "background-color", "font-size", "font-weight", "text-align")},
                "geometry": {"x": 41, "y": 138, "width": 100, "height": 40, "coordinate_space": "viewport"},
                "portal": {"in_portal": False},
                "screenshot": dict(BEFORE_SHOT),
            },
            "context": {"app": "salestrekker", "locale": "en-AU", "hints": {"capture_source": "cdp", "design_mode": True}},
        }

    async def resolve(self, payload):
        self.resolve_calls.append(payload["request_id"])
        if self.envelope is not None:
            return json.loads(json.dumps(self.envelope))
        return resolution_envelope(payload["request_id"])

    async def reload_and_wait(self, target_id, timeout=15.0):
        self.reload_calls.append(target_id)
        return {"reloaded": True, "wait": "loadEventFired"}

    async def capture_region(self, target_id, node_id):
        if self.region_error:
            raise self.region_error
        return json.loads(json.dumps(self.region))

    async def element_from_point(self, target_id, x, y):
        return {"found": True, "tag": "button", "text": "Enable sync"}

    async def _node_ids_from_selector(self, target_id, selector):
        return (19, 6) if self.relocate_visible else (None, None)

    async def _node_ids_from_backend(self, target_id, backend_id):
        return 19

    async def evaluate(self, target_id, expression):
        self.evaluate_calls.append(expression)
        if "__automation_bridgeDesignModeRenderConfirmation" in expression and "typeof" not in expression:
            # render injection — extract the payload for assertions
            self.render_calls.append(_extract_rendered_payload(expression))
            return True
        if "setExecutionGuard" in expression:
            self.guard_states.append("true" in expression)
            return True
        if "typeof window.__automation_bridgeDesignModeRenderConfirmation" in expression:
            return True
        if "querySelector" in expression:
            return {"tag": "button", "visible": self.relocate_visible}
        if "elementFromPoint" in expression:
            return {"found": True, "tag": "button"}
        if "sessionStorage" in expression:
            return True
        return True

    def _cdp(self, *a, **k):
        raise AssertionError("loop should not use raw _cdp in these tests")


class FakeBridge:
    """Duck-typed ABActionBridge."""

    def __init__(self, outcome=None, raise_exc=None):
        self.outcome = outcome
        self.raise_exc = raise_exc
        self.calls = []

    async def execute_from_resolver_response(self, envelope, request_id, timeout_ms):
        self.calls.append({"request_id": request_id, "envelope": envelope})
        if self.raise_exc:
            raise self.raise_exc
        if self.outcome is None:
            # default: executed + verified
            resolution = envelope.get("resolution") or {}
            resolution["action_outcome"] = {
                "requested_action": {"type": "click", "value": None, "submit": False},
                "executed": True,
                "action_tier": "CDP",
                "verification": {
                    "verified": True,
                    "method": "state_diff",
                    "state_changed": True,
                    "verdict": "verified",
                    "diff_summary": {"has_changed": True, "change_count": 2, "keys_changed": ["url", "buttons"],
                                     "url_changed": True, "errors_appeared": False, "toast_appeared": False},
                    "false_positive_guard": None,
                },
                "rejection": None,
            }
            return SimpleNamespace(to_dict=lambda: {
                "schema_version": "2.0.0",
                "request_id": request_id,
                "resolved_at": "2026-10-26T08:15:01.000Z",
                "resolution": resolution,
                "resolver": envelope.get("resolver"),
                "warnings": [],
            })
        return self.outcome


def make_loop(capture, **kw):
    loop = ActionConfirmationLoop(capture, default_target_id=TARGET, **kw)
    return loop


def run(coro):
    return asyncio.run(coro)


# ── pure helpers ───────────────────────────────────────────────────────────

def test_classify_outcome_matrix():
    assert classify_outcome({"error": {"code": "STALE_NODE"}}) == ("error", None)
    assert classify_outcome({"resolution": {}}) == ("no_action", None)
    assert classify_outcome({"resolution": {"action_outcome": {"executed": False, "rejection": {}}}}) == ("rejection", None)
    assert classify_outcome({"resolution": {"action_outcome": {"executed": False}}}) == ("no_action", None)
    assert classify_outcome({"resolution": {"action_outcome": {"executed": True, "verification": {"verdict": "verified"}}}}) == ("confirmed", "verified")
    assert classify_outcome({"resolution": {"action_outcome": {"executed": True, "verification": {"verdict": "no_state_change"}}}}) == ("confirmed", "no_state_change")


def test_policy_decision_bands():
    assert policy_decision(1.0, ["click"]) == ("execute", "click")
    assert policy_decision(0.95, ["click", "hover"]) == ("execute", "click")
    assert policy_decision(0.9, ["click"]) == ("execute", "click")
    assert policy_decision(0.89, ["click"]) == ("human_confirm", "click")
    assert policy_decision(0.5, ["click"]) == ("human_confirm", "click")
    assert policy_decision(1.0, ["fill"]) == ("human_confirm", "fill")
    assert policy_decision(1.0, []) == ("no_action", None)


def test_diff_summary_normalization():
    assert "url" in _diff_summary_text({"has_changed": True, "keys_changed": ["url", "buttons"]})
    assert "no state change" in _diff_summary_text({"has_changed": False, "keys_changed": []})
    assert _diff_summary_text("already a string") == "already a string"
    assert _diff_summary_text(None) == ""


def test_dispatch_envelope_adapts_css_hint_and_preserves_original():
    env = resolution_envelope("r1")
    payload = {
        "request_id": "r1",
        "element": {"dom_snapshot": {"text_content": "Enable sync", "attributes": {"id": "sync-toggle"}}},
    }
    dispatch = _dispatch_envelope(env, payload)
    assert dispatch["resolution"]["element_ref"]["selector"] == "Enable sync"
    # original envelope untouched
    assert env["resolution"]["element_ref"]["selector"] == "button#sync-toggle"
    # text-like hints pass through unadapted
    env2 = resolution_envelope("r2", selector="Enable sync")
    assert _dispatch_envelope(env2, payload)["resolution"]["element_ref"]["selector"] == "Enable sync"
    # empty selector also adapts
    env3 = resolution_envelope("r3", selector="")
    assert _dispatch_envelope(env3, payload)["resolution"]["element_ref"]["selector"] == "Enable sync"
    # html-ish text never adapted
    payload2 = {"element": {"dom_snapshot": {"text_content": "<b>Enable</b>"}}}
    assert _dispatch_envelope(env, payload2)["resolution"]["element_ref"]["selector"] == "button#sync-toggle"


# ── pipeline ───────────────────────────────────────────────────────────────

def test_verified_click_full_pipeline():
    cap = FakeCapture()
    bridge = FakeBridge()
    loop = make_loop(cap, bridge_factory=lambda: bridge)
    events = []
    for stage in ("pick", "captured", "resolved", "action_executed", "reloaded", "recaptured", "rendered"):
        loop.subscribe(stage, lambda s, st=stage: events.append(st))

    session = run(loop.process_pick({"x": 93, "y": 155, "auto_execute": True}))

    assert session.phase == "confirmed"
    assert session.verdict == "verified"
    assert session.reload == {"reloaded": True, "wait": "loadEventFired"}
    assert session.after_shot == AFTER_SHOT
    assert session.after_element["dom_changed"] is True
    assert session.after_element["via"] == "attribute"
    assert session.render_error is None
    assert events == ["pick", "captured", "resolved", "action_executed", "reloaded", "recaptured", "rendered"]
    assert cap.reload_calls == [TARGET]
    # bridge received the dispatch copy with the adapted selector
    assert bridge.calls[0]["envelope"]["resolution"]["element_ref"]["selector"] == "Enable sync"
    # render payload shape
    payload = cap.render_calls[0]
    assert payload["phase"] == "confirmed"
    assert payload["verdict"] == "verified"
    assert payload["verification"]["verdict"] == "verified"
    assert payload["verification"]["diff_summary"] == "state changed: url, buttons (2 key(s))"
    assert payload["before"]["data_uri"] == "data:image/png;base64,BEFORE"
    assert payload["after"]["data_uri"] == "data:image/png;base64,AFTER"
    assert payload["resolution"]["confidence"] == 1.0
    assert payload["resolution"]["resolution_path"] == "exact_backend_node"
    assert payload["action"]["action_tier"] == "CDP"
    assert payload["action"]["executed"] is True
    # execution guard toggled around the dispatch
    assert cap.guard_states == [True, False]


def test_no_state_change_shows_evidence_and_still_reloads():
    env = resolution_envelope("r-ns")
    cap = FakeCapture(envelope=env)

    def outcome_factory(envelope):
        resolution = envelope["resolution"]
        resolution["action_outcome"] = {
            "requested_action": {"type": "click", "value": None, "submit": False},
            "executed": True,
            "action_tier": "JS",
            "verification": {
                "verified": False,
                "method": "state_diff",
                "state_changed": False,
                "verdict": "no_state_change",
                "diff_summary": {"has_changed": False, "change_count": 0, "keys_changed": [],
                                 "url_changed": False, "errors_appeared": False, "toast_appeared": False},
                "false_positive_guard": None,
            },
            "rejection": None,
        }
        return SimpleNamespace(to_dict=lambda: {
            "schema_version": "2.0.0", "request_id": "r-ns", "resolved_at": "t",
            "resolution": resolution, "resolver": envelope.get("resolver"), "warnings": [],
        })

    bridge = FakeBridge()
    bridge.outcome = None
    # patch: use custom outcome
    async def custom(envelope, request_id, timeout_ms):
        return outcome_factory(envelope)
    bridge.execute_from_resolver_response = custom

    loop = make_loop(cap, bridge_factory=lambda: bridge)
    session = run(loop.process_pick({"x": 10, "y": 10, "auto_execute": True}))

    assert session.phase == "confirmed"
    assert session.verdict == "no_state_change"
    assert cap.reload_calls == [TARGET]  # reload still happens — visual evidence
    assert session.after_shot is not None
    payload = cap.render_calls[0]
    assert payload["verification"]["verified"] is False
    assert payload["verification"]["verdict"] == "no_state_change"
    assert payload["verification"]["diff_summary"] == "no state change — before/after snapshots identical (0 keys changed)"
    # before/after both present (identical thumbs are the evidence)
    assert payload["before"] and payload["after"]


def test_resolver_error_no_reload_no_bridge():
    cap = FakeCapture(envelope=error_envelope("r-err", "STALE_NODE"))
    bridge = FakeBridge()
    loop = make_loop(cap, bridge_factory=lambda: bridge)
    session = run(loop.process_pick({"x": 1, "y": 1}))
    assert session.phase == "error"
    assert session.error["code"] == "STALE_NODE"
    assert cap.reload_calls == []
    assert bridge.calls == []
    payload = cap.render_calls[0]
    assert payload["phase"] == "error"
    assert payload["error"]["code"] == "STALE_NODE"
    assert payload["error"]["retry_policy"] == "recapture"


def test_rejection_no_reload():
    env = resolution_envelope("r-rej")
    cap = FakeCapture(envelope=env)

    async def reject(envelope, request_id, timeout_ms):
        resolution = envelope["resolution"]
        resolution["action_outcome"] = {
            "requested_action": {"type": "click", "value": None, "submit": False},
            "executed": False,
            "rejection": {
                "code": "ACTION_REJECTED",
                "reason_code": "confidence_below_policy",
                "reason": "Confidence 0.42 below 0.5 floor",
            },
            "verification": None,
        }
        return SimpleNamespace(to_dict=lambda: {
            "schema_version": "2.0.0", "request_id": "r-rej", "resolved_at": "t",
            "resolution": resolution, "resolver": envelope.get("resolver"), "warnings": [],
        })

    bridge = FakeBridge()
    bridge.execute_from_resolver_response = reject
    loop = make_loop(cap, bridge_factory=lambda: bridge)
    session = run(loop.process_pick({"x": 1, "y": 1}))
    assert session.phase == "rejection"
    assert cap.reload_calls == []
    payload = cap.render_calls[0]
    assert payload["rejection"]["reason_code"] == "confidence_below_policy"


def test_human_confirm_below_auto_execute_floor():
    cap = FakeCapture(envelope=resolution_envelope("r-hc", confidence=0.83, selector="#fb"))
    bridge = FakeBridge()
    loop = make_loop(cap, bridge_factory=lambda: bridge)
    session = run(loop.process_pick({"x": 1, "y": 1, "auto_execute": True}))
    assert session.phase == "human_confirm"
    assert bridge.calls == []
    assert cap.reload_calls == []
    payload = cap.render_calls[0]
    assert payload["phase"] == "human_confirm"
    assert payload["policy"]["confidence"] == 0.83


def test_page_opt_out_forces_human_confirm():
    cap = FakeCapture()
    bridge = FakeBridge()
    loop = make_loop(cap, bridge_factory=lambda: bridge)
    session = run(loop.process_pick({"x": 1, "y": 1, "auto_execute": False}))
    assert session.phase == "human_confirm"
    assert bridge.calls == []


def test_fill_hint_requires_human_confirm():
    cap = FakeCapture(envelope=resolution_envelope("r-fill", hints=("fill",)))
    bridge = FakeBridge()
    loop = make_loop(cap, bridge_factory=lambda: bridge)
    session = run(loop.process_pick({"x": 1, "y": 1}))
    assert session.phase == "human_confirm"
    assert bridge.calls == []


def test_recapture_failure_surfaced_not_hidden():
    cap = FakeCapture(region_error=RuntimeError("box model blew up"))
    loop = make_loop(cap, bridge_factory=lambda: FakeBridge())
    session = run(loop.process_pick({"x": 1, "y": 1}))
    assert session.phase == "confirmed"
    assert session.verdict == "verified"
    assert session.after_shot is None
    assert "box model blew up" in session.recapture_error
    payload = cap.render_calls[0]
    assert payload["after"] is None
    assert "box model blew up" in payload["recapture_error"]


def test_element_not_relocatable_surfaced():
    cap = FakeCapture(relocate_visible=False)
    loop = make_loop(cap, bridge_factory=lambda: FakeBridge())
    session = run(loop.process_pick({"x": 1, "y": 1}))
    assert session.phase == "confirmed"
    assert session.recapture_error and "not re-locatable" in session.recapture_error
    assert cap.render_calls  # panel still rendered with the verdict


def test_bridge_execution_failure_becomes_error_session():
    cap = FakeCapture()
    bridge = FakeBridge(raise_exc=RuntimeError("engine exploded"))
    loop = make_loop(cap, bridge_factory=lambda: bridge)
    session = run(loop.process_pick({"x": 1, "y": 1}))
    assert session.phase == "error"
    assert session.error["code"] == "BRIDGE_EXECUTION_FAILED"
    assert "engine exploded" in session.error["message"]
    assert cap.reload_calls == []


def test_capture_failure_becomes_error_session():
    cap = FakeCapture()

    async def boom(**kw):
        raise RuntimeError("capture node gone")

    cap.capture_element = boom
    loop = make_loop(cap, bridge_factory=lambda: FakeBridge())
    session = run(loop.process_pick({"x": 1, "y": 1}))
    assert session.phase == "error"
    assert session.error["code"] == "CAPTURE_FAILED"


def test_run_loop_survives_broken_pick():
    cap = FakeCapture()
    picks = [{"x": 1, "y": 1}, RuntimeError("next pick exploded")]

    async def next_pick(timeout=300.0):
        item = picks.pop(0)
        if isinstance(item, Exception):
            raise item
        return item

    cap.next_pick = next_pick
    loop = make_loop(cap, bridge_factory=lambda: FakeBridge())
    failed = []
    loop.subscribe("failed", lambda s: failed.append(s))

    async def driver():
        task = asyncio.ensure_future(loop.run())
        await asyncio.sleep(0.05)
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass

    run(driver())
    assert cap.render_calls, "first pick must have rendered before the crash"
    assert failed and "next pick exploded" in str(failed[0])


def test_build_confirmation_payload_shape():
    session = ConfirmationSession(session_id="s1", target_id=TARGET, pick={"x": 1, "y": 1})
    session.payload = run(FakeCapture().capture_element(TARGET, x=1, y=1))
    session.envelope = resolution_envelope("r1")
    session.phase = "confirmed"
    session.verdict = "verified"
    session.before_shot = BEFORE_SHOT
    session.after_shot = AFTER_SHOT
    payload = build_confirmation_payload(session)
    # JSON-serializable end to end
    assert json.loads(json.dumps(payload))["session_id"] == "s1"
    assert payload["element"]["tag"] == "button"
    assert payload["known_bug_flags"] == []
    assert payload["before"]["width"] == 100


def test_session_defaults():
    s = ConfirmationSession(session_id="x", target_id="T", pick={})
    assert s.phase == "capturing"
    s.note("pick", {"x": 1})
    assert s.stage_log[0]["stage"] == "pick"
