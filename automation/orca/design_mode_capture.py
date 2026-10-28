#!/usr/bin/env python3
"""Orca Design Mode — CDP element capture and resolver transport.

Implements the Orca (capture) side of the IDD-016 Orca→Resolver bridge:

* Design Mode pick handling (click coordinates or a RemoteObjectId from the page)
* Raw-CDP capture recipe (IDD-016 §6.2): exact backendDOMNodeId, DOM snapshot,
  10-key computed styles, geometry, clipped screenshot. Portal elements
  (Radix portals attached at body level, outside the React tree) are captured
  like any other node — the backendDOMNodeId is valid for them too.
* Payload assembly per packages/orca-resolver-bridge/schemas/orca-resolver-request.schema.json
  (snake_case fields, schema_version "1.0.0", structural_hash §6.5, caps §6.6)
* Transport (IDD-016 §5): MCP tool ``mcp_resolve_element`` first; byte-identical
  HTTP fallback POST /api/v1/resolver/resolve; RESOLVER_UNREACHABLE ladder
  [5s, 15s, 25s, 60s] max 4 attempts; idempotent request_id.

Capture never mutates the page (IDD-016 §11 invariant 9): no attribute
injection, no leftover scripts. The overlay lives in the page only while
Design Mode is enabled and is removed on disable.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

import requests
import websockets

logger = logging.getLogger("orca.design-mode")

CONTRACT_VERSION = "1.0.0"

# IDD-016 §6.3 — frozen 10-key computed style subset (kebab-case, CDP names).
STYLE_KEYS = [
    "display",
    "visibility",
    "opacity",
    "pointer-events",
    "cursor",
    "color",
    "background-color",
    "font-size",
    "font-weight",
    "text-align",
]

# IDD-016 §6.6 caps.
MAX_OUTER_HTML = 200000
MAX_TEXT_CONTENT = 2000
MAX_DATA_URI_CHARS = 4_000_000

# IDD-016 §5.3 — RESOLVER_UNREACHABLE transport ladder (ms), max 4 attempts.
UNREACHABLE_LADDER_MS = [5000, 15000, 25000, 60000]
MAX_TRANSPORT_ATTEMPTS = 4

# IDD-016 §10 retry matrix (error-codes.json). Only retryable codes retry,
# always with the SAME request_id. STALE_NODE requires recapture.
RETRYABLE_BACKOFF_MS = {
    "RESOLVER_TIMEOUT": [1000, 3000],
    "TARGET_NOT_ATTACHED": [250],
    "INTERNAL_ERROR": [2000],
    "RESOLVER_UNREACHABLE": UNREACHABLE_LADDER_MS,
}

# IDD-016 §6.2 — known portal root markers.
PORTAL_MARKER_ATTRS = ("data-radix-portal", "data-portal")
PORTAL_MARKER_CLASSES = ("portal-root", "radix-portal-root")
APP_ROOT_SELECTOR_IDS = ("root", "app", "__next", "next", "___gatsby", "gatsby-focus-wrapper")

# Page-side extraction function, executed via raw CDP Runtime.callFunctionOn
# (IDD-016 §6.2: raw CDP Runtime.evaluate — NOT a WebDriver page.evaluate
# wrapper, which strips React internals). Runs inside the target page.
_PAGE_EXTRACT_FN = """
function () {
  function seg(el) {
    var idx = 1;
    var p = el.parentElement;
    if (p) {
      var n = 0;
      for (var i = 0; i < p.children.length; i++) {
        if (p.children[i].tagName === el.tagName) { n++; if (p.children[i] === el) { idx = n; break; } }
      }
    }
    var o = { tag: el.tagName.toLowerCase(), index: idx };
    if (el.id) o.id = el.id;
    var cls = [];
    for (var j = 0; j < el.classList.length; j++) {
      var c = el.classList[j];
      if (c && c.indexOf('orca-') !== 0) cls.push(c);
    }
    if (cls.length) o.classes = cls;
    o.parent_tag = p ? p.tagName.toLowerCase() : null;
    o.data_radix_portal = el.hasAttribute && el.hasAttribute('data-radix-portal');
    o.data_portal = el.hasAttribute && el.hasAttribute('data-portal');
    return o;
  }
  var el = this;
  var elem = seg(el);
  delete elem.parent_tag; delete elem.data_radix_portal; delete elem.data_portal;
  var ancestors = [];
  var p = el.parentElement;
  while (p) {
    ancestors.push(seg(p));
    if (p.tagName === 'HTML') break;
    p = p.parentElement;
  }
  var attrs = {};
  var relevant = ['id','name','class','type','placeholder','aria-label','aria-describedby','role','href','title','data-testid'];
  for (var a = 0; a < relevant.length; a++) {
    var v = el.getAttribute(relevant[a]);
    if (v) attrs[relevant[a]] = v;
  }
  var appRoot = el.closest && el.closest('#root,#app,#__next,#next,#___gatsby,[data-reactroot],.app-root');
  var portal = { in_portal: false, portal_root_hint: null };
  var cur = el.parentElement;
  var portalDiv = null;
  while (cur) {
    if (cur.hasAttribute('data-radix-portal') || cur.hasAttribute('data-portal') ||
        cur.classList.contains('portal-root') || cur.classList.contains('radix-portal-root')) {
      portalDiv = cur;
      break;
    }
    if (cur.parentElement && cur.parentElement.tagName === 'BODY' && cur.tagName === 'DIV' &&
        cur !== appRoot && (!appRoot || !appRoot.contains(cur))) {
      portalDiv = cur;
      break;
    }
    cur = cur.parentElement;
  }
  if (portalDiv) {
    portal.in_portal = true;
    if (portalDiv.hasAttribute('data-radix-portal')) portal.portal_root_hint = 'div[data-radix-portal]';
    else if (portalDiv.hasAttribute('data-portal')) portal.portal_root_hint = 'div[data-portal]';
    else if (portalDiv.classList.contains('portal-root')) portal.portal_root_hint = 'body > div.portal-root';
    else if (portalDiv.classList.contains('radix-portal-root')) portal.portal_root_hint = 'body > div.radix-portal-root';
    else {
      var sibs = portalDiv.parentElement.children;
      var nth = 1;
      for (var k = 0; k < sibs.length; k++) { if (sibs[k] === portalDiv) { nth = k + 1; break; } }
      portal.portal_root_hint = 'body > div:nth-child(' + nth + ')';
    }
  }
  return JSON.stringify({
    element: elem,
    ancestors: ancestors,
    attributes: attrs,
    text_content: (el.textContent || '').trim(),
    child_count: el.children.length,
    portal: portal
  });
}
"""

# Shim appended to the injected design-mode.js so picks flow to the controller
# over the Runtime binding instead of a same-origin HTTP proxy. Also rides
# the page's auto-execute setting (admin console checkbox) so the §8 policy
# decision can be made controller-side.
_BINDING_SHIM = """
;(function () {
  if (!window.__orcaDesignModePickInstalled) {
    window.__orcaDesignModePickInstalled = true;
    var origDeliver = window.__orcaDesignModeDeliverPick;
    window.__orcaDesignModeDeliverPick = function (payload, x, y) {
      if (typeof window.__orcaDesignModePick === 'function') {
        try {
          var autoExecute = true;
          var cb = document.getElementById('autoExecuteActions');
          if (cb && cb.type === 'checkbox') autoExecute = cb.checked;
          window.__orcaDesignModePick(JSON.stringify({ payload: payload, x: x, y: y, auto_execute: autoExecute }));
        } catch (e) { console.error('[orca] binding pick failed', e); }
      } else if (typeof origDeliver === 'function') {
        origDeliver(payload, x, y);
      }
    };
  }
})();
"""


# Readiness probe for install_design_mode: script surface + render entry both live.
INSTALL_READINESS_PROBE = (
    "typeof window.orcaDesignMode === 'object' && "
    "typeof window.__orcaDesignModeDeliverPick === 'function' && "
    "typeof window.__orcaDesignModeRenderConfirmation === 'function'"
)


def selector_hints_from_attributes(attrs: dict) -> list[str]:
    """Stable CSS attribute selectors for capture/re-location, safest first.

    Built from the in-page payload's relevantAttributes. Attribute selectors
    avoid CSS escaping issues with ids and work for portal elements too.
    """
    hints = []
    for name in ("id", "data-testid", "name", "aria-label", "title"):
        val = (attrs or {}).get(name)
        if val:
            hints.append(f'[{name}={json.dumps(val)}]')
    return hints


def sha256_hex(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def structural_hash(ancestor_path: list[dict], element_seg: dict) -> str:
    """IDD-016 §6.5 — SHA-256 over the canonical structural string.

    Canonical string = ancestor_path segments nearest-ancestor-first, then the
    element itself as the final segment, joined by '|'. Each segment is
    ``tag:index:id`` (id empty when absent).
    """
    segments = [f"{s['tag']}:{s['index']}:{s.get('id', '')}" for s in ancestor_path]
    segments.append(f"{element_seg['tag']}:{element_seg['index']}:{element_seg.get('id', '')}")
    return sha256_hex("|".join(segments))


def canonical_ancestor_path(ancestors: list[dict]) -> list[dict]:
    """Nearest-ancestor-first path, at most 8 entries, ending at html."""
    path = []
    for a in ancestors:
        path.append({k: a[k] for k in ("tag", "index", "id", "classes") if k in a})
        if a["tag"] == "html":
            break
    if not path or path[-1]["tag"] != "html":
        path.append({"tag": "html", "index": 1})
    if len(path) > 8:
        path = path[:7] + [{"tag": "html", "index": 1}]
    return path


def detect_portal(ancestors: list[dict]) -> dict:
    """IDD-016 §6.2 portal classification from the raw ancestor chain.

    True when an ancestor matches ``[data-radix-portal]`` / ``[data-portal]`` /
    a known portal-root class, or when the element lives under a body-level
    ``div`` that is outside the main app root (Radix attaches portals there).
    """
    for a in ancestors:
        if a.get("data_radix_portal"):
            return {"in_portal": True, "portal_root_hint": "div[data-radix-portal]"}
        if a.get("data_portal"):
            return {"in_portal": True, "portal_root_hint": "div[data-portal]"}
        classes = a.get("classes") or []
        if a.get("parent_tag") == "body" and ("portal-root" in classes or "radix-portal-root" in classes):
            return {"in_portal": True, "portal_root_hint": "body > div." + ".".join(classes)}
    # Body-level portal root outside the app root (Radix default container).
    seen_app_root = False
    for a in ancestors:
        if a["tag"] == "html":
            break
        if a.get("parent_tag") != "body":
            continue
        is_app_root = (
            a.get("id") in APP_ROOT_SELECTOR_IDS
            or "app-root" in (a.get("classes") or [])
        )
        if is_app_root:
            seen_app_root = True
            continue
        # A body-level div that is not the app root and appears outside it.
        if seen_app_root or a.get("id") not in APP_ROOT_SELECTOR_IDS:
            hint = "body > div:nth-child(%d)" % a.get("index", 1)
            if a.get("id"):
                hint = "body > div#" + a["id"]
            elif a.get("classes"):
                hint = "body > div." + ".".join(a["classes"])
            return {"in_portal": True, "portal_root_hint": hint}
    return {"in_portal": False, "portal_root_hint": None}


def truncate_outer_html(html: str) -> tuple[str, bool]:
    """IDD-016 §6.6 — cap outer_html at 200000 chars on a complete tag."""
    if len(html) <= MAX_OUTER_HTML:
        return html, False
    cut = html[:MAX_OUTER_HTML]
    last_tag = cut.rfind(">")
    if last_tag > 0:
        cut = cut[: last_tag + 1]
    return cut, True


def build_request(
    *,
    target_id: str,
    url: str,
    backend_dom_node_id: int,
    outer_html: str,
    tag: str,
    attributes: dict,
    text_content: str,
    ancestor_path: list[dict],
    structural_hash_value: str,
    child_count: int,
    computed_styles: dict,
    geometry: dict,
    screenshot: dict,
    portal: dict,
    request_id: Optional[str] = None,
    timeout_ms: int = 10000,
    title: Optional[str] = None,
    frame_id: Optional[str] = None,
    device_pixel_ratio: Optional[float] = None,
    viewport: Optional[dict] = None,
    app_context: str = "salestrekker",
    locale: str = "en-AU",
    action: Optional[dict] = None,
    capture_source: str = "cdp",
) -> dict:
    """Assemble the IDD-016 request envelope. Pure — no I/O."""
    if not request_id:
        request_id = str(uuid.uuid4())
    outer_html, truncated = truncate_outer_html(outer_html)
    text_content = text_content[:MAX_TEXT_CONTENT]
    payload: dict[str, Any] = {
        "schema_version": CONTRACT_VERSION,
        "request_id": request_id,
        "captured_at": datetime.now(timezone.utc).isoformat(),
        "timeout_ms": int(timeout_ms),
        "page": {
            "url": url,
            "target_id": target_id,
            "viewport": viewport or {"width": 1280, "height": 800},
        },
        "element": {
            "backend_dom_node_id": int(backend_dom_node_id),
            "dom_snapshot": {
                "outer_html": outer_html,
                "tag": tag,
                "attributes": attributes,
                "text_content": text_content,
                "ancestor_path": ancestor_path,
                "structural_hash": structural_hash_value,
                "child_count": int(child_count),
                "truncated": truncated,
            },
            "computed_styles": {k: computed_styles.get(k, "") for k in STYLE_KEYS},
            "geometry": geometry,
            "portal": portal,
            "screenshot": screenshot,
        },
        "context": {
            "app": app_context,
            "locale": locale,
            "hints": {"capture_source": capture_source, "design_mode": True},
        },
    }
    if title:
        payload["page"]["title"] = title
    if frame_id:
        payload["page"]["frame_id"] = frame_id
    if device_pixel_ratio is not None:
        payload["page"]["device_pixel_ratio"] = device_pixel_ratio
    if action:
        payload["action"] = action
    return payload


def synthesize_unreachable(request_id: str, target_id: str, attempts: int, detail: str, ladder_ms: Optional[list] = None) -> dict:
    """IDD-016 §5.3 rule 3 — caller-synthesized transport failure envelope."""
    return {
        "schema_version": CONTRACT_VERSION,
        "request_id": request_id,
        "resolved_at": datetime.now(timezone.utc).isoformat(),
        "resolver": {
            "version": "orca-capture@1.0.0",
            "latency_ms": 0,
            "node_live": False,
            "target_id": target_id,
        },
        "error": {
            "code": "RESOLVER_UNREACHABLE",
            "message": f"Neither MCP (mcp_resolve_element) nor HTTP fallback responded after {attempts} attempts. {detail}",
            "retryable": True,
            "retry_policy": "backoff",
            "details": {
                "transports_attempted": ["mcp", "http"],
                "attempts": attempts,
                "ladder_ms": list(ladder_ms if ladder_ms is not None else UNREACHABLE_LADDER_MS),
            },
            "known_bug_flags": [],
        },
        "warnings": [],
    }


class CdpClient:
    """Minimal raw-CDP client over a browser-level WebSocket (flatten mode)."""

    def __init__(self, ws_url: str):
        self.ws_url = ws_url
        self._ws: Optional[Any] = None
        self._msg_id = 0
        self._pending: dict[int, asyncio.Future] = {}
        self._subscribers: list = []
        self._reader_task: Optional[asyncio.Task] = None

    async def connect(self):
        self._ws = await websockets.connect(self.ws_url, max_size=2**26)
        self._reader_task = asyncio.get_event_loop().create_task(self._reader())
        logger.info("CDP connected: %s", self.ws_url[:60])

    async def _reader(self):
        try:
            async for msg in self._ws:
                data = json.loads(msg)
                msg_id = data.get("id")
                if msg_id in self._pending:
                    fut = self._pending.pop(msg_id)
                    if not fut.done():
                        fut.set_result(data)
                    continue
                for cb in self._subscribers:
                    try:
                        cb(data)
                    except Exception:  # noqa: BLE001 - subscriber isolation
                        logger.exception("CDP event subscriber error")
        except Exception as e:  # noqa: BLE001
            logger.warning("CDP reader stopped: %s", e)

    def subscribe(self, callback):
        self._subscribers.append(callback)

    async def send(self, method: str, params: Optional[dict] = None, session_id: Optional[str] = None, timeout: float = 30.0) -> dict:
        self._msg_id += 1
        msg_id = self._msg_id
        frame: dict[str, Any] = {"id": msg_id, "method": method, "params": params or {}}
        if session_id:
            frame["sessionId"] = session_id
        fut = asyncio.get_event_loop().create_future()
        self._pending[msg_id] = fut
        await self._ws.send(json.dumps(frame))
        try:
            data = await asyncio.wait_for(fut, timeout=timeout)
        except asyncio.TimeoutError:
            self._pending.pop(msg_id, None)
            raise TimeoutError(f"CDP command timed out: {method}")
        if "error" in data:
            raise RuntimeError(f"CDP error {method}: {data['error']}")
        return data.get("result", {})

    async def close(self):
        if self._reader_task:
            self._reader_task.cancel()
        if self._ws:
            await self._ws.close()


class DesignModeCapture:
    """Orca-side Design Mode capture + resolver transport (IDD-016)."""

    # §5.3 default ladder. Class-level so instances constructed via __new__
    # (the test suite's fake-CDP harness) still carry the frozen default.
    unreachable_ladder_ms: list = list(UNREACHABLE_LADDER_MS)

    def __init__(
        self,
        cdp_ws_url: str,
        state_engine_port: int = 9110,
        timeout_ms: int = 10000,
        app_context: str = "salestrekker",
        locale: str = "en-AU",
        http_timeout: float = 15.0,
        sleep_fn=asyncio.sleep,
        unreachable_ladder_ms: Optional[list] = None,
    ):
        self.cdp = CdpClient(cdp_ws_url)
        self.state_engine_port = state_engine_port
        self.timeout_ms = timeout_ms
        self.app_context = app_context
        self.locale = locale
        self.http_timeout = http_timeout
        self.sleep_fn = sleep_fn
        self.blobs: dict[str, bytes] = {}
        self.last_request: Optional[dict] = None
        self.last_response: Optional[dict] = None
        self.last_transport: Optional[str] = None
        self._sessions: dict[str, str] = {}
        self._pick_queue: asyncio.Queue = asyncio.Queue()
        # §5.3 ladder — overridable (tests and failure-path demos use a
        # compressed ladder; the frozen default is [5000, 15000, 25000, 60000]).
        self.unreachable_ladder_ms = list(
            unreachable_ladder_ms if unreachable_ladder_ms is not None else UNREACHABLE_LADDER_MS
        )

    # ── target / session management ──────────────────────────────────────

    async def connect(self):
        await self.cdp.connect()

    async def close(self):
        await self.cdp.close()

    async def _session(self, target_id: str) -> Optional[str]:
        if target_id in self._sessions:
            return self._sessions[target_id]
        try:
            res = await self.cdp.send("Target.attachToTarget", {"targetId": target_id, "flatten": True})
            sid = res.get("sessionId")
        except Exception as e:  # noqa: BLE001
            logger.warning("attach failed for %s: %s", target_id, e)
            return None
        if sid:
            self._sessions[target_id] = sid
            # CDP domain lazy-init (found by live probing, kanban t_f86d149b):
            # DOM/CSS recipe commands — getComputedStyleForNode, getBoxModel,
            # describeNode — fail with "agent was not enabled" on a session
            # whose domains were never enabled. Enable the capture recipe's
            # domains once per session (idempotent).
            for method in ("DOM.enable", "CSS.enable"):
                try:
                    await self.cdp.send(method, {}, session_id=sid)
                except Exception as e:  # noqa: BLE001
                    logger.warning("domain enable %s failed: %s", method, e)
        return sid

    async def _cdp(self, method: str, params: dict, target_id: str, timeout: float = 30.0) -> dict:
        sid = await self._session(target_id)
        return await self.cdp.send(method, params, session_id=sid, timeout=timeout)

    # ── IDD-016 §6.2 capture recipe (raw CDP) ────────────────────────────

    async def _node_ids_from_backend(self, target_id: str, backend_node_id: int) -> Optional[int]:
        """nodeId for a backendNodeId.

        Chrome ≥151 omits nodeId from DOM.getNodeForLocation responses —
        derive it via DOM.pushNodesByBackendIdsToFrontend.
        """
        res = await self._cdp(
            "DOM.pushNodesByBackendIdsToFrontend", {"backendNodeIds": [int(backend_node_id)]}, target_id
        )
        ids = res.get("nodeIds") or []
        return ids[0] if ids else None

    async def _node_ids_from_selector(self, target_id: str, selector: str) -> tuple[Optional[int], Optional[int]]:
        """(nodeId, backendNodeId) for a CSS selector via DOM.querySelector."""
        doc = await self._cdp("DOM.getDocument", {"depth": 0}, target_id)
        root_id = (doc.get("root") or {}).get("nodeId")
        if not root_id:
            return None, None
        q = await self._cdp("DOM.querySelector", {"nodeId": root_id, "selector": selector}, target_id)
        node_id = q.get("nodeId")
        if not node_id:
            return None, None
        desc = await self._cdp("DOM.describeNode", {"nodeId": node_id}, target_id)
        return node_id, desc.get("node", {}).get("backendNodeId")

    async def capture_element(self, target_id: str, x: Optional[float] = None, y: Optional[float] = None, remote_object_id: Optional[str] = None, selector_hints: Optional[list] = None) -> dict:
        """Capture the clicked element via raw CDP. Never mutates the page.

        Node resolution order (§6.2 steps 1–3): explicit RemoteObjectId →
        stable attribute selectors from the in-page payload (deterministic;
        immune to overlay/portal hit-testing quirks) → pick coordinates.
        """
        # 1–3. Element handle → nodeId → backendNodeId (exact CDP handle).
        backend_node_id, node_id = None, None
        if remote_object_id:
            node_id = (await self._cdp("DOM.requestNode", {"objectId": remote_object_id}, target_id)).get("nodeId")
            desc = await self._cdp("DOM.describeNode", {"nodeId": node_id}, target_id)
            backend_node_id = desc.get("node", {}).get("backendNodeId")
        else:
            for sel in selector_hints or []:
                node_id, backend_node_id = await self._node_ids_from_selector(target_id, sel)
                if node_id and backend_node_id:
                    break
            if not backend_node_id or not node_id:
                if x is None or y is None:
                    raise ValueError("capture_element needs remote_object_id, selector_hints, or (x, y)")
                loc = await self._cdp("DOM.getNodeForLocation", {"x": int(x), "y": int(y)}, target_id)
                node_id, backend_node_id = loc.get("nodeId"), loc.get("backendNodeId")
                if backend_node_id and not node_id:
                    node_id = await self._node_ids_from_backend(target_id, backend_node_id)
        if not backend_node_id or not node_id:
            raise RuntimeError("CDP returned no backendNodeId for pick")

        # 4. DOM snapshot.
        outer_html = (await self._cdp("DOM.getOuterHTML", {"nodeId": node_id}, target_id)).get("outerHTML", "")

        # 5. Computed styles — exact 10-key subset (§6.3).
        styles_arr = (await self._cdp("CSS.getComputedStyleForNode", {"nodeId": node_id}, target_id)).get("computedStyle", [])
        styles_map = {s["name"]: s["value"] for s in styles_arr}
        computed_styles = {k: styles_map.get(k, "") for k in STYLE_KEYS}

        # 6. Geometry from DOM.getBoxModel (first quad).
        geometry = await self._geometry(target_id, node_id)

        # 7. Clipped element screenshot.
        screenshot = await self._screenshot(target_id, geometry)

        # Page-side structural facts via raw CDP Runtime.callFunctionOn.
        struct = await self._structural_facts(target_id, node_id)

        # Page context.
        page_info = await self._page_info(target_id)

        ancestor_path = canonical_ancestor_path(struct["ancestors"])
        # Page-side detection (has full closest() context) is authoritative;
        # the pure chain-based detector acts as a belt-and-braces override for
        # explicit Radix markers and supplies the hint selector.
        chain_portal = detect_portal(struct["ancestors"])
        portal = {
            "in_portal": bool(struct["portal"].get("in_portal")) or chain_portal["in_portal"],
            "portal_root_hint": struct["portal"].get("portal_root_hint") or chain_portal.get("portal_root_hint"),
        }

        return build_request(
            target_id=target_id,
            url=page_info["url"],
            title=page_info.get("title"),
            backend_dom_node_id=backend_node_id,
            outer_html=outer_html,
            tag=struct["element"]["tag"],
            attributes=struct["attributes"],
            text_content=struct["text_content"],
            ancestor_path=ancestor_path,
            structural_hash_value=structural_hash(ancestor_path, struct["element"]),
            child_count=struct["child_count"],
            computed_styles=computed_styles,
            geometry=geometry,
            screenshot=screenshot,
            portal={"in_portal": portal["in_portal"], "portal_root_hint": portal.get("portal_root_hint")},
            timeout_ms=self.timeout_ms,
            viewport=page_info["viewport"],
            device_pixel_ratio=page_info.get("device_pixel_ratio"),
            app_context=self.app_context,
            locale=self.locale,
        )

    async def _geometry(self, target_id: str, node_id: int) -> dict:
        try:
            model = (await self._cdp("DOM.getBoxModel", {"nodeId": node_id}, target_id)).get("model", {})
            quad = model.get("quads", [[0, 0, 0, 0, 0, 0, 0, 0]])[0]
            xs = quad[0::2]
            ys = quad[1::2]
            x, y = min(xs), min(ys)
            w = max(xs) - x
            h = max(ys) - y
        except Exception:  # noqa: BLE001 - fall through to the rect probe below
            w = h = 0
        if not w or not h:
            # Box model came back empty (observed live on Chrome 151 for
            # nodes resolved via querySelector on a freshly-attached session)
            # — probe the page's own layout rect so the clip is never
            # degenerate. Zero stays only for genuinely layout-less nodes.
            try:
                resolve = await self._cdp("DOM.resolveNode", {"nodeId": node_id}, target_id)
                object_id = (resolve.get("object") or {}).get("objectId")
                if object_id:
                    rect_res = await self._cdp(
                        "Runtime.callFunctionOn",
                        {
                            "objectId": object_id,
                            "functionDeclaration": "function(){const r=this.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height};}",
                            "returnByValue": True,
                        },
                        target_id,
                    )
                    r = (rect_res.get("result") or {}).get("value") or {}
                    if r.get("w") and r.get("h"):
                        return {"x": r["x"], "y": r["y"], "width": r["w"], "height": r["h"], "coordinate_space": "viewport"}
            except Exception:  # noqa: BLE001 - keep zero-geometry (schema-invalid → surfaced)
                pass
        return {"x": x, "y": y, "width": w, "height": h, "coordinate_space": "viewport"}

    async def _screenshot(self, target_id: str, geometry: dict) -> dict:
        clip = {
            "x": max(0, geometry["x"]),
            "y": max(0, geometry["y"]),
            "width": max(1, geometry["width"]),
            "height": max(1, geometry["height"]),
            "scale": 1,
        }
        res = await self._cdp(
            "Page.captureScreenshot",
            {"format": "png", "clip": clip, "captureBeyondViewport": True},
            target_id,
            timeout=20.0,
        )
        raw = res.get("data", "")
        import base64

        img_bytes = base64.b64decode(raw)
        digest = hashlib.sha256(img_bytes).hexdigest()
        data_uri = "data:image/png;base64," + raw
        if len(data_uri) <= MAX_DATA_URI_CHARS:
            return {
                "storage": "data_uri",
                "data_uri": data_uri,
                "mime_type": "image/png",
                "width": max(1, int(geometry["width"])),
                "height": max(1, int(geometry["height"])),
                "sha256": digest,
            }
        blob_id = "orca-capture-" + uuid.uuid4().hex[:8]
        self.blobs[blob_id] = img_bytes
        return {
            "storage": "blob_ref",
            "blob_id": blob_id,
            "mime_type": "image/png",
            "width": max(1, int(geometry["width"])),
            "height": max(1, int(geometry["height"])),
            "sha256": digest,
        }

    async def _structural_facts(self, target_id: str, node_id: int) -> dict:
        resolve = await self._cdp("DOM.resolveNode", {"nodeId": node_id}, target_id)
        object_id = resolve.get("object", {}).get("objectId")
        if not object_id:
            return {
                "element": {"tag": "unknown", "index": 1},
                "ancestors": [{"tag": "html", "index": 1}],
                "attributes": {},
                "text_content": "",
                "portal": {"in_portal": False},
                "child_count": 0,
            }
        res = await self._cdp(
            "Runtime.callFunctionOn",
            {
                "objectId": object_id,
                "functionDeclaration": _PAGE_EXTRACT_FN,
                "returnByValue": True,
            },
            target_id,
        )
        value = res.get("result", {}).get("value", "{}")
        facts = json.loads(value) if isinstance(value, str) else value
        # child_count via DOM.childNodes? Keep cheap: query selector children.
        facts["child_count"] = facts.get("child_count", 0)
        return facts

    async def _page_info(self, target_id: str) -> dict:
        info = await self.cdp.send("Target.getTargetInfo", {"targetId": target_id})
        tinfo = info.get("targetInfo", {})
        eval_res = await self._evaluate(
            target_id,
            "JSON.stringify({w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio})",
        )
        viewport = {"width": 1280, "height": 800}
        dpr = 1.0
        try:
            v = json.loads(eval_res)
            viewport = {"width": v["w"], "height": v["h"]}
            dpr = v["dpr"]
        except Exception:  # noqa: BLE001
            pass
        return {
            "url": tinfo.get("url", ""),
            "title": tinfo.get("title", ""),
            "viewport": viewport,
            "device_pixel_ratio": dpr,
        }

    async def _evaluate(self, target_id: str, expression: str) -> Any:
        res = await self._cdp("Runtime.evaluate", {"expression": expression, "returnByValue": True}, target_id)
        return res.get("result", {}).get("value")

    # ── IDD-016 §5 transport: MCP first, byte-identical HTTP fallback ────

    def _mcp_url(self) -> str:
        return f"http://127.0.0.1:{self.state_engine_port}/mcp"

    def _http_url(self) -> str:
        return f"http://127.0.0.1:{self.state_engine_port}/api/v1/resolver/resolve"

    def _post(self, url: str, *, data: Optional[bytes] = None, json_body: Optional[dict] = None, headers: Optional[dict] = None, timeout: float = 15.0) -> requests.Response:
        return requests.post(url, data=data, json=json_body, headers=headers or {}, timeout=timeout)

    def _envelope_from_body(self, resp) -> Optional[dict]:
        """Parse a contract envelope from any transport response.

        §5.1: MCP contract errors arrive in-band inside the envelope (the tool
        call itself succeeds). §5.2: the HTTP fallback returns contract errors
        with the error-codes.json HTTP status and the same envelope body. So a
        non-2xx body that parses as an envelope is a CONTRACT response, not a
        transport failure. Only unparseable bodies / connect errors are
        transport failures.
        """
        try:
            body = resp.json()
        except Exception:  # noqa: BLE001
            return None
        if not isinstance(body, dict):
            return None
        if "error" in body and "result" in body:
            return None  # JSON-RPC protocol error → transport failure
        if body.get("schema_version") and ("resolution" in body or "error" in body):
            return body
        # MCP tools/call wrapper: content[0].text holds the envelope.
        result = body.get("result")
        if isinstance(result, dict):
            content = result.get("content")
            if isinstance(content, list) and content and isinstance(content[0], dict):
                text = content[0].get("text")
                if isinstance(text, str):
                    try:
                        inner = json.loads(text)
                    except json.JSONDecodeError:
                        return None
                    if isinstance(inner, dict) and inner.get("schema_version"):
                        return inner
        return None

    async def _attempt_pair(self, payload: dict) -> tuple[Optional[dict], Optional[str]]:
        """One transport attempt: MCP first, then byte-identical HTTP fallback.

        Returns (envelope, transport_used). (None, None) when both fail.
        """
        body_bytes = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        # §5.1 MCP primary.
        try:
            rpc_frame = (
                '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"mcp_resolve_element","arguments":'
                + body_bytes.decode("utf-8")
                + "}}"
            ).encode("utf-8")
            resp = await asyncio.to_thread(
                self._post,
                self._mcp_url(),
                data=rpc_frame,
                headers={"Content-Type": "application/json", "Accept": "application/json, text/event-stream"},
                timeout=2.0,
            )
            envelope = self._envelope_from_body(resp)
            if envelope is not None:
                return envelope, "mcp"
            logger.warning("[bridge] MCP transport failed (HTTP %s)", getattr(resp, "status_code", "n/a"))
        except Exception as e:  # noqa: BLE001
            logger.warning("[bridge] MCP transport error: %s", e)

        # §5.2 HTTP fallback — byte-identical payload.
        try:
            resp = await asyncio.to_thread(
                self._post,
                self._http_url(),
                data=body_bytes,
                headers={"Content-Type": "application/json", "X-Orca-Bridge-Version": CONTRACT_VERSION},
                timeout=self.timeout_ms / 1000.0 + 5.0,
            )
            envelope = self._envelope_from_body(resp)
            if envelope is not None:
                return envelope, "http_fallback"
            logger.warning("[bridge] HTTP fallback failed (HTTP %s)", resp.status_code)
        except Exception as e:  # noqa: BLE001
            logger.warning("[bridge] HTTP fallback error: %s", e)
        return None, None

    async def resolve(self, payload: dict) -> dict:
        """Send the request to the resolver. MCP first, ladder on unreachable.

        Implements §5.3 failover + §10 retry matrix. Retryable error codes
        retry with the SAME request_id; STALE_NODE is returned to the caller
        for recapture (never blind-retried).
        """
        request_id = payload.get("request_id", str(uuid.uuid4()))
        target_id = payload.get("page", {}).get("target_id", "")
        attempts = 0
        while True:
            attempts += 1
            envelope, transport = await self._attempt_pair(payload)
            if envelope is not None:
                self.last_request = payload
                self.last_response = envelope
                self.last_transport = transport
                err = envelope.get("error")
                logger.info(
                    "[bridge] request_id=%s transport=%s code=%s confidence=%s",
                    request_id, transport,
                    (err or {}).get("code", "none"),
                    (envelope.get("resolution") or {}).get("confidence"),
                )
                # §10 retry matrix: only retryable codes retry, SAME request_id.
                # STALE_NODE is non-retryable (recapture required) — returned
                # to the caller. Non-retryable codes return immediately.
                if err and err.get("retryable"):
                    code = err.get("code")
                    backoff = RETRYABLE_BACKOFF_MS.get(code, [])
                    if backoff and (attempts - 1) < len(backoff):
                        delay = backoff[attempts - 1] / 1000.0
                        logger.info("[bridge] retryable %s — sleeping %sms (attempt %d)", code, delay * 1000, attempts)
                        await self.sleep_fn(delay)
                        continue
                return envelope
            # Transport-level failure: RESOLVER_UNREACHABLE ladder (§5.3 rule 5).
            if attempts < MAX_TRANSPORT_ATTEMPTS:
                delay = self.unreachable_ladder_ms[attempts - 1] / 1000.0
                logger.warning("[bridge] unreachable (attempt %d) — ladder sleep %dms", attempts, delay * 1000)
                await self.sleep_fn(delay)
                continue
            envelope = synthesize_unreachable(
                request_id, target_id, attempts, "both transports exhausted",
                ladder_ms=self.unreachable_ladder_ms,
            )
            self.last_request = payload
            self.last_response = envelope
            self.last_transport = "unreachable"
            return envelope

    # ── live Design Mode session (binding-based pick listener) ────────────

    def design_mode_js(self) -> str:
        """The in-page Design Mode script, with the binding shim appended."""
        candidates = [
            Path(__file__).resolve().parents[2] / "apps/edge-runtime/public/design-mode.js",
            Path(__file__).resolve().parent / "design-mode.js",
        ]
        for c in candidates:
            if c.exists():
                return c.read_text(encoding="utf-8") + "\n" + _BINDING_SHIM
        raise FileNotFoundError("design-mode.js not found — set ORCA_DESIGN_MODE_JS or install alongside edge-runtime")

    async def install_design_mode(self, target_id: str) -> dict:
        """Inject Design Mode into the target and wire picks to this controller.

        CDP domain lazy-init gotcha (found by live probe, kanban t_f86d149b):
        Runtime.addBinding and Page.addScriptToEvaluateOnNewDocument silently
        no-op on a flattened session whose Runtime/Page domains were never
        enabled — the binding never materializes on window and the
        on-new-document script never fires. Enable BOTH domains first.

        Sequence: enable domains → add binding → register script for future
        documents (survives the confirmation loop's hot-reload) → probe the
        CURRENT document (already-loaded tabs predate the registration, so
        the script is evaluated directly into it) → readiness probe.
        """
        await self._cdp("Page.enable", {}, target_id)
        await self._cdp("Runtime.enable", {}, target_id)
        await self._cdp("Runtime.addBinding", {"name": "__orcaDesignModePick"}, target_id)
        await self._cdp(
            "Page.addScriptToEvaluateOnNewDocument",
            {"source": self.design_mode_js()},
            target_id,
        )
        # Current document already loaded → the on-new-document script will
        # not fire for it; evaluate the source directly (idempotent IIFE,
        # shim double-install guarded by __orcaDesignModePickInstalled).
        if not await self._evaluate(target_id, INSTALL_READINESS_PROBE):
            await self._cdp(
                "Runtime.evaluate",
                {"expression": self.design_mode_js(), "returnByValue": False},
                target_id,
            )
        ready = bool(await self._evaluate(target_id, INSTALL_READINESS_PROBE))
        return {"installed": ready, "target_id": target_id}

    async def next_pick(self, timeout: float = 300.0) -> dict:
        """Block until the page reports a pick via the Runtime binding."""
        deadline = asyncio.get_event_loop().time() + timeout
        while True:
            remaining = deadline - asyncio.get_event_loop().time()
            if remaining <= 0:
                raise TimeoutError("no Design Mode pick received")
            try:
                evt = await asyncio.wait_for(self._pick_queue.get(), timeout=remaining)
            except asyncio.TimeoutError:
                raise TimeoutError("no Design Mode pick received")
            return evt

    def feed_event(self, cdp_event: dict) -> None:
        """Call from the CDP event loop when Runtime.bindingCalled arrives."""
        if cdp_event.get("method") == "Runtime.bindingCalled":
            params = cdp_event.get("params", {})
            if params.get("name") == "__orcaDesignModePick":
                try:
                    self._pick_queue.put_nowait(json.loads(params.get("payload", "{}")))
                except json.JSONDecodeError:
                    logger.warning("malformed pick payload dropped")

    async def handle_pick(self, pick: dict) -> dict:
        """Full flow for one pick: capture → resolve. Returns the envelope."""
        in_page = pick.get("payload") or {}
        attrs = ((in_page.get("element") or {}).get("dom_snapshot") or {}).get("attributes") or {}
        payload = await self.capture_element(
            pick.get("target_id", ""),
            x=pick.get("x"),
            y=pick.get("y"),
            remote_object_id=pick.get("remote_object_id"),
            selector_hints=selector_hints_from_attributes(attrs),
        )
        return await self.resolve(payload)

    # ── confirmation-loop support (kanban t_f86d149b) ─────────────────────

    def session_for(self, target_id: str) -> Optional[str]:
        """The flattened CDP session id currently attached to a target."""
        return self._sessions.get(target_id)

    async def evaluate(self, target_id: str, expression: str, timeout: float = 30.0) -> Any:
        """Public Runtime.evaluate wrapper (returnByValue)."""
        return await self._evaluate(target_id, expression)

    async def reload_and_wait(self, target_id: str, timeout: float = 15.0) -> dict:
        """Hot-reload the tab (Page.reload) and wait for loadEventFired.

        Used by the visual confirmation loop after a bridged action: the page
        re-navigates to its current state, the Design Mode script (installed
        via Page.addScriptToEvaluateOnNewDocument) re-runs automatically, and
        the loop re-locates + re-captures the affected region.
        """
        sid = await self._session(target_id)
        if not sid:
            return {"reloaded": False, "reason": "no_session"}
        loop = asyncio.get_event_loop()
        loaded: asyncio.Future = loop.create_future()

        def _on_event(evt: dict):
            if evt.get("method") == "Page.loadEventFired" and evt.get("sessionId") == sid:
                if not loaded.done():
                    loaded.set_result(True)

        self.cdp.subscribe(_on_event)
        try:
            await self._cdp("Page.enable", {}, target_id)
            await self._cdp("Page.reload", {"ignoreCache": True}, target_id)
            try:
                await asyncio.wait_for(loaded, timeout=timeout)
                return {"reloaded": True, "wait": "loadEventFired"}
            except asyncio.TimeoutError:
                # Belt-and-braces: probe the new document directly.
                ready = await self._evaluate(target_id, "document.readyState")
                return {"reloaded": True, "wait": "timeout_fallback", "ready_state": ready}
        finally:
            try:
                self.cdp._subscribers.remove(_on_event)
            except ValueError:
                pass

    async def capture_region(self, target_id: str, node_id: int) -> dict:
        """Re-capture an element region from a FRESH nodeId (post-reload).

        Reuses the §6.2 recipe pieces (box-model geometry → clipped
        Page.captureScreenshot → outerHTML) against a node handle obtained
        after the reload. Never mutates the page.
        """
        geometry = await self._geometry(target_id, node_id)
        screenshot = await self._screenshot(target_id, geometry)
        outer_html = (await self._cdp("DOM.getOuterHTML", {"nodeId": node_id}, target_id)).get("outerHTML", "")
        return {
            "geometry": geometry,
            "screenshot": screenshot,
            "outer_html": outer_html[:MAX_OUTER_HTML],
        }

    async def element_from_point(self, target_id: str, x: float, y: float) -> dict:
        """Probe the element at viewport coordinates (post-reload fallback)."""
        expr = (
            "(()=>{const el=document.elementFromPoint(%s,%s);"
            "return el?{found:true,tag:el.tagName.toLowerCase(),text:(el.textContent||'').trim().substring(0,80)}:{found:false};})()"
            % (int(x), int(y))
        )
        val = await self._evaluate(target_id, expr)
        try:
            return json.loads(val) if isinstance(val, str) else (val or {"found": False})
        except (json.JSONDecodeError, TypeError):
            return {"found": False}


def load_schema() -> Optional[dict]:
    """Load the frozen request schema for caller-side pre-validation."""
    here = Path(__file__).resolve()
    for cand in (here.parents[2] / "packages/orca-resolver-bridge/schemas/orca-resolver-request.schema.json",):
        if cand.exists():
            return json.loads(cand.read_text(encoding="utf-8"))
    return None


def validate_payload(payload: dict) -> list[str]:
    """Validate against the frozen contract schema (best effort)."""
    schema = load_schema()
    if not schema:
        return ["schema file not found — skipping validation"]
    try:
        import jsonschema

        jsonschema.validate(payload, schema)
        return []
    except ImportError:
        return ["jsonschema not installed — skipping validation"]
    except Exception as e:  # noqa: BLE001
        return [str(e)]


async def main(argv: Optional[list[str]] = None) -> int:
    import argparse

    p = argparse.ArgumentParser(description="Orca Design Mode capture (IDD-016)")
    p.add_argument("--cdp-ws", required=True, help="Browser-level CDP WebSocket URL")
    p.add_argument("--target", required=True, help="CDP Target.targetId of the tab")
    p.add_argument("--x", type=float, required=True)
    p.add_argument("--y", type=float, required=True)
    p.add_argument("--port", type=int, default=9110)
    p.add_argument("--timeout-ms", type=int, default=10000)
    args = p.parse_args(argv)

    logging.basicConfig(level=logging.INFO)
    cap = DesignModeCapture(args.cdp_ws, state_engine_port=args.port, timeout_ms=args.timeout_ms)
    await cap.connect()
    try:
        payload = await cap.capture_element(args.target, x=args.x, y=args.y)
        violations = validate_payload(payload)
        if violations:
            logger.error("payload invalid: %s", violations)
            return 2
        envelope = await cap.resolve(payload)
        print(json.dumps({"request": payload, "response": envelope}, indent=2))
        return 0 if "resolution" in envelope else 1
    finally:
        await cap.close()


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
