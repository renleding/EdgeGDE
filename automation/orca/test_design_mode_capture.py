#!/usr/bin/env python3
"""Tests for automation/orca/design_mode_capture.py (IDD-016 capture side)."""
import asyncio
import hashlib
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))

from design_mode_capture import (  # noqa: E402
    MAX_DATA_URI_CHARS,
    MAX_OUTER_HTML,
    MAX_TEXT_CONTENT,
    STYLE_KEYS,
    DesignModeCapture,
    build_request,
    canonical_ancestor_path,
    detect_portal,
    structural_hash,
    truncate_outer_html,
)

REPO_ROOT = Path(__file__).resolve().parents[2]
REQUEST_SCHEMA_PATH = REPO_ROOT / "packages/orca-resolver-bridge/schemas/orca-resolver-request.schema.json"


def seg(tag, index, id=None, classes=None, parent_tag=None, radix=False, data_portal=False):
    s = {"tag": tag, "index": index}
    if id:
        s["id"] = id
    if classes:
        s["classes"] = classes
    if parent_tag:
        s["parent_tag"] = parent_tag
    if radix:
        s["data_radix_portal"] = True
    if data_portal:
        s["data_portal"] = True
    return s


# ── §6.5 structural hash ──────────────────────────────────────────────────

def test_structural_hash_known_vector():
    ancestors = [seg("div", 3), seg("div", 1, id="asset-form"), seg("html", 1)]
    element = {"tag": "button", "index": 1, "id": "save-btn"}
    h = structural_hash(ancestors, element)
    canonical = "div:3:|div:1:asset-form|html:1:|button:1:save-btn"
    assert h == hashlib.sha256(canonical.encode("utf-8")).hexdigest()
    assert len(h) == 64 and all(c in "0123456789abcdef" for c in h)


def test_structural_hash_empty_id_segment():
    ancestors = [seg("body", 1), seg("html", 1)]
    element = {"tag": "input", "index": 2}
    h = structural_hash(ancestors, element)
    assert h == hashlib.sha256("body:1:|html:1:|input:2:".encode()).hexdigest()


# ── canonical ancestor path ───────────────────────────────────────────────

def test_canonical_path_ends_at_html_and_caps_at_8():
    deep = [seg("div", i) for i in range(1, 12)]  # 10 divs, no html
    deep.append(seg("html", 1))
    path = canonical_ancestor_path(deep)
    assert len(path) == 8
    assert path[-1] == {"tag": "html", "index": 1}
    assert path[0]["tag"] == "div" and path[0]["index"] == 1  # nearest-first preserved


def test_canonical_path_appends_html_when_missing():
    path = canonical_ancestor_path([seg("div", 2)])
    assert path[-1]["tag"] == "html"


# ── portal detection (§6.2) ───────────────────────────────────────────────

def test_detect_portal_radix_marker():
    chain = [seg("input", 1), seg("div", 1, id="radix-vehicle-make", classes=["radix-portal-root"], parent_tag="body"), seg("body", 1), seg("html", 1)]
    p = detect_portal(chain)
    assert p["in_portal"] is True
    assert "radix" in p["portal_root_hint"]


def test_detect_portal_data_radix_portal_attr():
    chain = [seg("div", 2, radix=True), seg("body", 1), seg("html", 1)]
    p = detect_portal(chain)
    assert p["in_portal"] is True
    assert p["portal_root_hint"] == "div[data-radix-portal]"


def test_detect_portal_body_level_div_outside_app_root():
    # Element under body > div#radix-combobox while app root is #root (not in chain).
    chain = [seg("div", 1, id="radix-combobox", parent_tag="body"), seg("body", 1), seg("html", 1)]
    p = detect_portal(chain)
    assert p["in_portal"] is True
    assert p["portal_root_hint"] == "body > div#radix-combobox"


def test_detect_portal_inside_app_root_not_portal():
    chain = [seg("button", 3), seg("div", 1, id="asset-form"), seg("div", 1, id="root", parent_tag="body"), seg("body", 1), seg("html", 1)]
    p = detect_portal(chain)
    assert p["in_portal"] is False


# ── caps (§6.6) ───────────────────────────────────────────────────────────

def test_truncate_outer_html_at_last_complete_tag():
    html = "<div>" + "x" * 300000 + "</div>"
    out, truncated = truncate_outer_html(html)
    assert truncated is True
    assert len(out) <= MAX_OUTER_HTML
    assert out.endswith(">")


def test_truncate_outer_html_short_untouched():
    assert truncate_outer_html("<button>Save</button>") == ("<button>Save</button>", False)


def test_build_request_enforces_caps_and_style_subset():
    payload = build_request(
        target_id="T1",
        url="https://example.com/x",
        backend_dom_node_id=5177,
        outer_html="<div>" + "y" * 300000 + "</div>",
        tag="div",
        attributes={"class": "rc-input"},
        text_content="t" * 3000,
        ancestor_path=[seg("body", 1), seg("html", 1)],
        structural_hash_value="a" * 64,
        child_count=2,
        computed_styles={k: "v" for k in STYLE_KEYS},
        geometry={"x": 1, "y": 2, "width": 3, "height": 4, "coordinate_space": "viewport"},
        screenshot={"storage": "data_uri", "data_uri": "data:image/png;base64,AAAA", "mime_type": "image/png", "width": 10, "height": 10, "sha256": "b" * 64},
        portal={"in_portal": False},
    )
    assert payload["schema_version"] == "1.0.0"
    dom = payload["element"]["dom_snapshot"]
    assert dom["truncated"] is True and len(dom["outer_html"]) <= MAX_OUTER_HTML
    assert dom["text_content"] == "t" * MAX_TEXT_CONTENT
    assert list(payload["element"]["computed_styles"].keys()) == STYLE_KEYS
    assert payload["element"]["backend_dom_node_id"] == 5177
    assert payload["page"]["target_id"] == "T1"
    assert payload["context"]["hints"]["capture_source"] == "cdp"


def test_build_request_validates_against_frozen_schema():
    import jsonschema

    schema = json.loads(REQUEST_SCHEMA_PATH.read_text())
    payload = build_request(
        target_id="A1B2C3D4E5F6A7B8C9D0",
        url="https://pc.v2.salestrekker.com/deals/1/assets/new",
        backend_dom_node_id=4821,
        outer_html='<button id="save">Save</button>',
        tag="button",
        attributes={"id": "save"},
        text_content="Save",
        ancestor_path=[seg("div", 1, id="asset-form"), seg("body", 1), seg("html", 1)],
        structural_hash_value=structural_hash(
            [seg("div", 1, id="asset-form"), seg("body", 1), seg("html", 1)],
            {"tag": "button", "index": 1, "id": "save"},
        ),
        child_count=0,
        computed_styles={k: "block" for k in STYLE_KEYS},
        geometry={"x": 640, "y": 812, "width": 168, "height": 40, "coordinate_space": "viewport"},
        screenshot={"storage": "data_uri", "data_uri": "data:image/png;base64,AAAA", "mime_type": "image/png", "width": 168, "height": 40, "sha256": "c" * 64},
        portal={"in_portal": False},
        title="New asset",
        viewport={"width": 1440, "height": 900},
        device_pixel_ratio=1,
    )
    jsonschema.validate(payload, schema)  # raises on violation


# ── fake CDP ──────────────────────────────────────────────────────────────

PORTAL_EXTRACT_RESULT = json.dumps({
    "element": {"tag": "input", "index": 1},
    "ancestors": [
        {"tag": "div", "index": 1, "id": "radix-vehicle-make", "classes": ["radix-portal-root"], "parent_tag": "body"},
        {"tag": "body", "index": 1, "parent_tag": "html"},
        {"tag": "html", "index": 1, "parent_tag": None},
    ],
    "attributes": {"role": "combobox", "class": "rc-input"},
    "text_content": "",
    "child_count": 0,
    "portal": {"in_portal": True, "portal_root_hint": "div[data-radix-portal]"},
})


class FakeCdp:
    """Canned raw-CDP responses; records every command."""

    def __init__(self, screenshot_b64="iVBORw0KGgo="):
        self.calls = []
        self.screenshot_b64 = screenshot_b64

    async def send(self, method, params=None, session_id=None, timeout=30.0):
        self.calls.append((method, params or {}))
        if method == "DOM.getNodeForLocation":
            return {"nodeId": 77, "backendNodeId": 5177}
        if method == "DOM.getOuterHTML":
            return {"outerHTML": '<input role="combobox" class="rc-input"/>'}
        if method == "CSS.getComputedStyleForNode":
            return {"computedStyle": [{"name": k, "value": "block"} for k in STYLE_KEYS]}
        if method == "DOM.getBoxModel":
            return {"model": {"quads": [[220, 348, 540, 348, 540, 384, 220, 384]]}}
        if method == "Page.captureScreenshot":
            return {"data": self.screenshot_b64}
        if method == "DOM.resolveNode":
            return {"object": {"objectId": "obj-1"}}
        if method == "Runtime.callFunctionOn":
            return {"result": {"type": "string", "value": PORTAL_EXTRACT_RESULT}}
        if method == "Target.getTargetInfo":
            return {"targetInfo": {"url": "https://pc.v2.salestrekker.com/deals/1/assets/new", "title": "New asset", "type": "page"}}
        if method == "Runtime.evaluate":
            return {"result": {"type": "string", "value": json.dumps({"w": 1440, "h": 900, "dpr": 1})}}
        if method == "Target.attachToTarget":
            return {"sessionId": "S-1"}
        if method == "Runtime.addBinding" or method == "Page.addScriptToEvaluateOnNewDocument":
            return {}
        return {}


def make_capture(fake_cdp, port=9110):
    cap = DesignModeCapture.__new__(DesignModeCapture)
    cap.cdp = fake_cdp
    cap.state_engine_port = port
    cap.timeout_ms = 10000
    cap.app_context = "salestrekker"
    cap.locale = "en-AU"
    cap.http_timeout = 15.0
    cap.sleep_fn = None  # patched per-test
    cap.blobs = {}
    cap.last_request = cap.last_response = cap.last_transport = None
    cap._sessions = {}
    cap._pick_queue = asyncio.Queue()
    cap.sleep_fn = asyncio.sleep
    return cap


def test_capture_element_recipe_and_portal_payload():
    fake = FakeCdp()
    cap = make_capture(fake)
    payload = asyncio.run(cap.capture_element("TGT-1", x=220, y=348))

    methods = [m for m, _ in fake.calls]
    assert "DOM.getNodeForLocation" in methods
    assert "DOM.getOuterHTML" in methods
    assert "CSS.getComputedStyleForNode" in methods
    assert "DOM.getBoxModel" in methods
    assert "Page.captureScreenshot" in methods
    assert "Runtime.callFunctionOn" in methods

    assert payload["element"]["backend_dom_node_id"] == 5177
    assert payload["page"]["target_id"] == "TGT-1"
    assert payload["page"]["url"] == "https://pc.v2.salestrekker.com/deals/1/assets/new"
    assert payload["page"]["viewport"] == {"width": 1440, "height": 900}

    snap = payload["element"]["dom_snapshot"]
    assert snap["tag"] == "input"
    assert snap["ancestor_path"][0]["id"] == "radix-vehicle-make"
    assert snap["ancestor_path"][-1]["tag"] == "html"
    assert snap["structural_hash"] == structural_hash(snap["ancestor_path"], snap and {"tag": "input", "index": 1})
    assert snap["truncated"] is False

    assert payload["element"]["portal"]["in_portal"] is True
    assert payload["element"]["computed_styles"].keys() == set(STYLE_KEYS)
    assert payload["element"]["geometry"] == {"x": 220, "y": 348, "width": 320, "height": 36, "coordinate_space": "viewport"}
    assert payload["element"]["screenshot"]["storage"] == "data_uri"
    assert payload["element"]["screenshot"]["data_uri"].startswith("data:image/png;base64,")

    import jsonschema

    jsonschema.validate(payload, json.loads(REQUEST_SCHEMA_PATH.read_text()))


def test_capture_element_screenshot_blob_ref_over_cap():
    fake = FakeCdp(screenshot_b64="A" * (MAX_DATA_URI_CHARS + 100))
    cap = make_capture(fake)
    payload = asyncio.run(cap.capture_element("TGT-1", x=10, y=10))
    shot = payload["element"]["screenshot"]
    assert shot["storage"] == "blob_ref"
    assert "blob_id" in shot and shot["blob_id"] in cap.blobs
    assert "data_uri" not in shot
    assert len(shot["sha256"]) == 64


# ── transport (§5, §10) ───────────────────────────────────────────────────

def ok_envelope(request_id):
    return {
        "schema_version": "1.0.0",
        "request_id": request_id,
        "resolved_at": "2026-10-26T08:15:00.000Z",
        "resolution": {"status": "resolved", "resolution_path": "exact_backend_node", "confidence": 1.0, "element_ref": {}, "strategy": "backend_node_exact", "element_type": "button", "action_hints": ["click"], "known_bug_flags": [], "known_bug_workarounds": [], "fallback_match": None, "action_outcome": None},
        "resolver": {"version": "state-engine@1.4.2", "latency_ms": 42, "node_live": True, "target_id": "TGT-1"},
        "warnings": [],
    }


class FakePost:
    def __init__(self, behaviors):
        self.behaviors = list(behaviors)
        self.requests = []

    def __call__(self, url, *, data=None, json_body=None, headers=None, timeout=None):
        self.requests.append({"url": url, "data": data, "headers": headers, "timeout": timeout})
        behavior = self.behaviors.pop(0) if self.behaviors else {"status": 500}
        if behavior.get("raise"):
            raise requests.ConnectionError("simulated down")

        class R:
            def __init__(self, status, body):
                self.status_code = status
                self._body = body
                self.ok = status < 400

            def json(self):
                return self._body

        return R(behavior.get("status", 200), behavior.get("json", {}))


def base_payload():
    return build_request(
        target_id="TGT-1",
        url="https://example.com/",
        backend_dom_node_id=5177,
        outer_html="<button>Save</button>",
        tag="button",
        attributes={},
        text_content="Save",
        ancestor_path=[seg("body", 1), seg("html", 1)],
        structural_hash_value="d" * 64,
        child_count=0,
        computed_styles={k: "block" for k in STYLE_KEYS},
        geometry={"x": 0, "y": 0, "width": 10, "height": 10, "coordinate_space": "viewport"},
        screenshot={"storage": "data_uri", "data_uri": "data:image/png;base64,AA", "mime_type": "image/png", "width": 10, "height": 10, "sha256": "e" * 64},
        portal={"in_portal": False},
    )


def test_resolve_mcp_first():
    cap = make_capture(FakeCdp())
    rid = base_payload()["request_id"]
    mcp_env = ok_envelope(rid)
    post = FakePost([
        {"status": 200, "json": {"result": {"content": [{"type": "text", "text": json.dumps(mcp_env)}]}}},
    ])
    cap._post = post
    envelope = asyncio.run(cap.resolve(base_payload()))
    assert envelope["resolution"]["confidence"] == 1.0
    assert cap.last_transport == "mcp"
    assert len(post.requests) == 1
    assert post.requests[0]["url"].endswith("/mcp")


def test_resolve_http_fallback_byte_identical():
    cap = make_capture(FakeCdp())
    payload = base_payload()
    http_env = ok_envelope(payload["request_id"])
    post = FakePost([
        {"raise": True},  # MCP connect fails
        {"status": 200, "json": http_env},  # HTTP fallback succeeds
    ])
    cap._post = post
    envelope = asyncio.run(cap.resolve(payload))
    assert cap.last_transport == "http_fallback"
    assert envelope["resolution"]["confidence"] == 1.0
    http_call = post.requests[1]
    assert http_call["url"].endswith("/api/v1/resolver/resolve")
    assert http_call["headers"].get("X-Orca-Bridge-Version") == "1.0.0"
    # Byte-identical payload across transports (§5.2).
    assert http_call["data"] == json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def test_resolve_unreachable_synthesizes_with_ladder():
    cap = make_capture(FakeCdp())
    slept = []

    async def fake_sleep(d):
        slept.append(d)

    cap.sleep_fn = fake_sleep
    post = FakePost([{"raise": True}, {"raise": True}])
    cap._post = post
    payload = base_payload()
    envelope = asyncio.run(cap.resolve(payload))
    assert envelope["error"]["code"] == "RESOLVER_UNREACHABLE"
    assert envelope["error"]["retryable"] is True
    assert envelope["error"]["retry_policy"] == "backoff"
    assert envelope["resolver"]["node_live"] is False
    assert len(post.requests) == 8  # 4 attempts × (mcp + http)
    assert slept == [5.0, 15.0, 25.0]  # §5.3 ladder between the 4 attempts


def test_resolve_retries_retryable_codes_same_request_id():
    cap = make_capture(FakeCdp())
    payload = base_payload()
    timeout_env = {
        "schema_version": "1.0.0",
        "request_id": payload["request_id"],
        "resolved_at": "now",
        "resolver": {"version": "state-engine@1.4.2", "latency_ms": 1, "node_live": True, "target_id": "TGT-1"},
        "error": {"code": "RESOLVER_TIMEOUT", "message": "budget exceeded", "retryable": True, "retry_policy": "backoff", "details": {"failing_phase": "resolve"}, "known_bug_flags": []},
        "warnings": [],
    }
    good = ok_envelope(payload["request_id"])
    post = FakePost([
        {"status": 200, "json": {"result": {"content": [{"type": "text", "text": json.dumps(timeout_env)}]}}},
        {"status": 200, "json": {"result": {"content": [{"type": "text", "text": json.dumps(good)}]}}},
    ])
    cap._post = post
    slept = []

    async def fake_sleep(d):
        slept.append(d)

    cap.sleep_fn = fake_sleep

    envelope = asyncio.run(cap.resolve(payload))
    assert envelope["resolution"]["confidence"] == 1.0
    assert slept == [1.0]  # RESOLVER_TIMEOUT first backoff rung
    bodies = [json.loads(r["data"]) for r in post.requests]
    ids = set()
    for b in bodies:
        if "params" in b:
            ids.add(b["params"]["arguments"]["request_id"])
        else:
            ids.add(b["request_id"])
    assert ids == {payload["request_id"]}  # same request_id across retries


def test_resolve_stale_node_not_blind_retried():
    cap = make_capture(FakeCdp())
    payload = base_payload()
    stale_env = {
        "schema_version": "1.0.0",
        "request_id": payload["request_id"],
        "resolved_at": "now",
        "resolver": {"version": "state-engine@1.4.2", "latency_ms": 1, "node_live": False, "target_id": "TGT-1"},
        "error": {"code": "STALE_NODE", "message": "node gone", "retryable": False, "retry_policy": "recapture", "details": {}, "known_bug_flags": []},
        "warnings": [],
    }
    post = FakePost([{"status": 200, "json": {"result": {"content": [{"type": "text", "text": json.dumps(stale_env)}]}}}])
    cap._post = post
    envelope = asyncio.run(cap.resolve(payload))
    assert envelope["error"]["code"] == "STALE_NODE"
    assert len(post.requests) == 1  # no blind retry — recapture required


def test_resolve_non_retryable_error_returns_immediately():
    cap = make_capture(FakeCdp())
    payload = base_payload()
    err_env = {
        "schema_version": "1.0.0",
        "request_id": payload["request_id"],
        "resolved_at": "now",
        "resolver": {"version": "state-engine@1.4.2", "latency_ms": 1, "node_live": True, "target_id": "TGT-1"},
        "error": {"code": "ELEMENT_NOT_RESOLVABLE", "message": "floor not met", "retryable": False, "retry_policy": "none", "details": {}, "known_bug_flags": []},
        "warnings": [],
    }
    # MCP succeeds at transport level; contract error arrives in-band (§5.1).
    post = FakePost([{"status": 200, "json": {"result": {"content": [{"type": "text", "text": json.dumps(err_env)}]}}}])
    cap._post = post
    envelope = asyncio.run(cap.resolve(payload))
    assert envelope["error"]["code"] == "ELEMENT_NOT_RESOLVABLE"
    assert cap.last_transport == "mcp"
    assert len(post.requests) == 1  # non-retryable: no retry, no fallback


def test_resolve_http_contract_error_status_not_transport_failure():
    cap = make_capture(FakeCdp())
    payload = base_payload()
    err_env = {
        "schema_version": "1.0.0",
        "request_id": payload["request_id"],
        "resolved_at": "now",
        "resolver": {"version": "state-engine@1.4.2", "latency_ms": 1, "node_live": False, "target_id": "TGT-1"},
        "error": {"code": "STALE_NODE", "message": "node gone", "retryable": False, "retry_policy": "recapture", "details": {"stale_backend_dom_node_id": 5177}, "known_bug_flags": []},
        "warnings": [],
    }
    # MCP down; HTTP fallback returns 409 with the in-band STALE_NODE envelope (§5.2).
    post = FakePost([{"raise": True}, {"status": 409, "json": err_env}])
    cap._post = post
    envelope = asyncio.run(cap.resolve(payload))
    assert envelope["error"]["code"] == "STALE_NODE"
    assert cap.last_transport == "http_fallback"
    assert len(post.requests) == 2
