"""Automation Bridge Design Mode to State Engine Resolver bridge.

Implements IDD-016 v2.0.0 contract. Resolves an element captured by Automation
Bridge Design Mode against the live page.

Primary path: exact backendDOMNodeId resolution at confidence 1.0.
Fallback: structural match on DOM plus computed styles when the node is stale.

Contract: docs/IDD-016-automation-bridge-v1.md
"""
import asyncio
import hashlib
import json
import logging
import time
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

logger = logging.getLogger('state-engine.automation_bridge_resolver')

CONTRACT_VERSION = "2.0.0"
CONTRACT_MAJOR = 2
RESOLVER_VERSION = "state-engine@automation-bridge-2.0.0"

# Error code registry mirror (source: packages/automation-bridge/schemas/error-codes.json)
ERROR_REGISTRY = {
    "STALE_NODE": {"http_status": 409, "retryable": False, "retry_policy": "recapture"},
    "ELEMENT_NOT_RESOLVABLE": {"http_status": 422, "retryable": False, "retry_policy": "none"},
    "RESOLVER_TIMEOUT": {"http_status": 504, "retryable": True, "retry_policy": "backoff"},
    "ACTION_REJECTED": {"http_status": 422, "retryable": False, "retry_policy": "none"},
    "INVALID_REQUEST": {"http_status": 400, "retryable": False, "retry_policy": "none"},
    "UNSUPPORTED_SCHEMA_VERSION": {"http_status": 400, "retryable": False, "retry_policy": "none"},
    "TARGET_NOT_ATTACHED": {"http_status": 409, "retryable": True, "retry_policy": "reattach"},
    "RESOLVER_UNREACHABLE": {"http_status": None, "retryable": True, "retry_policy": "backoff"},
    "INTERNAL_ERROR": {"http_status": 500, "retryable": True, "retry_policy": "backoff"},
}

# Element type inference from tag/role
ELEMENT_TYPE_MAP = {
    "button": "button",
    "a": "link",
    "input": "text_input",
    "select": "combobox",
    "textarea": "text_input",
    "checkbox": "checkbox",
    "radio": "radio",
    "dialog": "dialog_button",
    "td": "table_cell",
}

# Action compatibility per element type
ACTION_COMPAT = {
    "button": ["click", "hover"],
    "link": ["click", "hover"],
    "text_input": ["fill", "type", "click", "hover"],
    "combobox": ["select", "click", "hover"],
    "checkbox": ["click", "hover"],
    "radio": ["click", "hover"],
    "dialog_button": ["click", "hover"],
    "menu_item": ["click", "hover"],
    "table_cell": ["click", "hover"],
    "container": ["click", "hover"],
    "other": ["click", "hover"],
}

# Known-bug flags (source: docs/IDD-016 §9, salestrekker_rules.py)
KNOWN_BUG_FLAGS = {
    "radix_portal_block": {
        "workaround": "Use KEY tier selection instead of CDP mouse events; the Radix portal overlay intercepts pointer events.",
        "applies_when": "portal",
        "applied_at_resolution": True,
        "tier_override": "KEY",  # Phase 3: enforce KEY tier for portal elements
    },
    "react_props_fallback": {
        "workaround": "Dispatch a bubbling event or call b.click() directly; __reactProps$ is absent in some builds.",
        "applies_when": "no_react_props",
        "applied_at_resolution": False,
        "reason": "Enforced by Action Engine at dispatch time.",
        "dispatch_strategy": "bubble_or_direct",  # Phase 3: use bubbling or direct click
    },
    "false_positive_save": {
        "workaround": "Require a URL change or network proof; the success toast can appear without persistence.",
        "applies_when": "save_action",
        "applied_at_resolution": False,
        "reason": "Enforced by Verification Engine at verdict time.",
        "verification_mode": "strict",  # Phase 3: require URL change or network proof
    },
}


class AutomationBridgeResolverError(Exception):
    """Structured resolver error mapped to the contract error registry."""

    def __init__(self, code: str, message: str, details: Optional[dict] = None,
                 known_bug_flags: Optional[list] = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.details = details or {}
        self.known_bug_flags = known_bug_flags or []
        meta = ERROR_REGISTRY.get(code, ERROR_REGISTRY["INTERNAL_ERROR"])
        self.http_status = meta["http_status"]
        self.retryable = meta["retryable"]
        self.retry_policy = meta["retry_policy"]


def _utcnow_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")


def _infer_element_type(element: dict) -> str:
    """Infer semantic element type from tag and attributes."""
    snap = element.get("dom_snapshot", {})
    tag = (snap.get("tag") or "").lower()
    attrs = snap.get("attributes", {}) or {}
    role = (attrs.get("role") or "").lower()

    if role in ("button", "menuitem", "option", "tab", "switch"):
        return "menu_item" if role == "menuitem" else "dialog_button" if role == "button" else "button"
    if role == "combobox":
        return "combobox"
    if role == "textbox":
        return "text_input"
    input_type = (attrs.get("type") or "").lower()
    if tag == "input":
        if input_type in ("checkbox",):
            return "checkbox"
        if input_type in ("radio",):
            return "radio"
        if input_type in ("submit", "button"):
            return "button"
        return "text_input"
    return ELEMENT_TYPE_MAP.get(tag, "other")


def _action_hints_for(element_type: str) -> list:
    return list(ACTION_COMPAT.get(element_type, ACTION_COMPAT["other"]))


def _is_interactable(computed_styles: dict) -> bool:
    """An element is interactable when visible and not pointer-blocked."""
    display = (computed_styles.get("display") or "block").lower()
    visibility = (computed_styles.get("visibility") or "visible").lower()
    opacity = computed_styles.get("opacity") or "1"
    pointer_events = (computed_styles.get("pointer-events") or "auto").lower()
    if display == "none":
        return False
    if visibility in ("hidden", "collapse"):
        return False
    try:
        if float(opacity) <= 0.0:
            return False
    except (TypeError, ValueError):
        pass
    if pointer_events == "none":
        return False
    return True


def _compute_structural_hash(ancestor_path: list, element_tag: str,
                             element_id: str = "") -> str:
    """Compute SHA-256 structural hash per IDD-016 §6.5.

    Canonical string = ancestor_path segments nearest-first, then the element
    itself, joined by '|'. Each segment = tag:index:id (id empty when absent).
    """
    segments = []
    for step in ancestor_path:
        tag = step.get("tag", "")
        index = step.get("index", 1)
        sid = step.get("id", "") or ""
        segments.append(f"{tag}:{index}:{sid}")
    segments.append(f"{element_tag}:1:{element_id}")
    canonical = "|".join(segments)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _extract_selector(element: dict) -> Optional[str]:
    """Build a best-effort CSS selector hint from element attributes."""
    attrs = (element.get("dom_snapshot", {}) or {}).get("attributes", {}) or {}
    tag = (element.get("dom_snapshot", {}) or {}).get("tag", "*")
    if attrs.get("id"):
        return f"#{attrs['id']}"
    if attrs.get("data-testid"):
        return f"[data-testid=\"{attrs['data-testid']}\"]"
    if attrs.get("name"):
        return f"{tag}[name=\"{attrs['name']}\"]"
    if attrs.get("aria-label"):
        return f"[aria-label=\"{attrs['aria-label']}\"]"
    return None


def _kebab(s: str) -> str:
    """Convert camelCase to kebab-case for style keys."""
    import re
    return re.sub(r'([a-z])([A-Z])', r'\1-\2', s).lower()


class AutomationBridgeResolver:
    """Resolves Automation Bridge Design Mode element captures against the live page."""

    def __init__(self, cdp, cache=None, evidence=None, journal=None):
        self.cdp = cdp
        self.cache = cache
        self.evidence = evidence
        self.journal = journal
        self.engine = None  # Injected by main.py after ActionEngine creation
        self._response_cache: dict[str, tuple[float, dict]] = {}
        self._cache_ttl = 60.0

    # ── Request cache (idempotency per IDD-016 §10.3) ──────────────────

    def _cache_get(self, request_id: str) -> Optional[dict]:
        entry = self._response_cache.get(request_id)
        if entry is None:
            return None
        cached_at, envelope = entry
        if time.time() - cached_at > self._cache_ttl:
            del self._response_cache[request_id]
            return None
        return envelope

    def _cache_put(self, request_id: str, envelope: dict) -> None:
        # Bound the cache so a long-lived daemon cannot grow without limit.
        if len(self._response_cache) > 512:
            oldest = sorted(self._response_cache.items(), key=lambda kv: kv[1][0])
            for rid, _ in oldest[:128]:
                del self._response_cache[rid]
        self._response_cache[request_id] = (time.time(), envelope)

    # ── Envelope builders ──────────────────────────────────────────────

    def _base_envelope(self, request: dict, latency_ms: float,
                       node_live: bool) -> dict:
        return {
            "schema_version": CONTRACT_VERSION,
            "request_id": request.get("request_id", ""),
            "resolved_at": _utcnow_iso(),
            "resolver": {
                "version": RESOLVER_VERSION,
                "latency_ms": round(latency_ms, 2),
                "node_live": node_live,
                "target_id": (request.get("page", {}) or {}).get("target_id", ""),
            },
        }

    def _error_envelope(self, request: dict, error: AutomationBridgeResolverError,
                        latency_ms: float) -> dict:
        envelope = self._base_envelope(request, latency_ms, node_live=False)
        envelope["error"] = {
            "code": error.code,
            "message": error.message,
            "retryable": error.retryable,
            "retry_policy": error.retry_policy,
            "details": error.details,
            "known_bug_flags": error.known_bug_flags,
        }
        return envelope

    # ── Validation ─────────────────────────────────────────────────────

    def _validate_version(self, request: dict) -> None:
        version = request.get("schema_version", "")
        try:
            major = int(str(version).split(".")[0])
        except (ValueError, IndexError):
            raise AutomationBridgeResolverError(
                "UNSUPPORTED_SCHEMA_VERSION",
                f"Malformed schema_version: {version!r}",
                {"schema_version": version},
            )
        if major != CONTRACT_MAJOR:
            raise AutomationBridgeResolverError(
                "UNSUPPORTED_SCHEMA_VERSION",
                f"Contract major {major} unsupported; resolver speaks {CONTRACT_MAJOR}.x",
                {"schema_version": version,
                 "supported_version": CONTRACT_VERSION},
            )

    def _validate_required(self, request: dict) -> None:
        missing = [f for f in ("request_id", "captured_at", "page", "element")
                   if f not in request]
        if missing:
            raise AutomationBridgeResolverError(
                "INVALID_REQUEST",
                f"Missing required fields: {', '.join(missing)}",
                {"validation_errors": [{"path": f, "message": "required"}
                                       for f in missing]},
            )
        element = request.get("element") or {}
        elem_missing = [f for f in ("backend_dom_node_id", "dom_snapshot",
                                    "computed_styles", "geometry", "screenshot")
                        if f not in element]
        if elem_missing:
            raise AutomationBridgeResolverError(
                "INVALID_REQUEST",
                f"Missing element fields: {', '.join(elem_missing)}",
                {"validation_errors": [{"path": f"element.{f}", "message": "required"}
                                       for f in elem_missing]},
            )
        page = request.get("page") or {}
        if not page.get("target_id"):
            raise AutomationBridgeResolverError(
                "INVALID_REQUEST",
                "Missing page.target_id",
                {"validation_errors": [{"path": "page.target_id", "message": "required"}]},
            )

    # ── Exact fast path (IDD-016 §7.2) ─────────────────────────────────

    async def _resolve_exact(self, request: dict) -> Optional[dict]:
        """Resolve the captured backendDOMNodeId live in the target."""
        element = request["element"]
        node_id = element["backend_dom_node_id"]
        try:
            result = await self.cdp.send("DOM.describeNode",
                                         {"backendNodeId": node_id})
        except Exception as e:  # noqa: BLE001 — stale handle raises many CDP errors
            logger.debug("Exact resolution failed for node %s: %s", node_id, e)
            return None
        if not result or not result.get("node"):
            return None
        node = result["node"]
        # Re-fetch a live backend id and box model for the element_ref.
        live_backend_id = node.get("backendNodeId", node_id)
        return {
            "node": node,
            "backend_dom_node_id": live_backend_id,
        }

    # ── Structural fallback (IDD-016 §7.3) ─────────────────────────────

    async def _resolve_fallback(self, request: dict) -> Optional[dict]:
        """Score live candidates against the captured element's structure."""
        element = request["element"]
        snap = element.get("dom_snapshot", {})
        captured_tag = (snap.get("tag") or "").lower()
        captured_hash = snap.get("structural_hash", "")
        captured_styles = element.get("computed_styles", {})
        captured_text = (snap.get("text_content") or "").strip().lower()

        # Ask the page for candidate elements of the same tag.
        selector = captured_tag or "*"
        expr = (
            f"(() => {{ const out = []; "
            f"const nodes = document.querySelectorAll('{selector}'); "
            f"for (const n of nodes) {{ "
            f"const r = n.getBoundingClientRect(); "
            f"const cs = getComputedStyle(n); "
            f"out.push({{"
            f"tag: n.tagName.toLowerCase(), "
            f"id: n.id || '', "
            f"text: (n.textContent || '').trim().slice(0, 200), "
            f"cls: n.className || '', "
            f"x: r.x, y: r.y, w: r.width, h: r.height, "
            f"styles: {{ display: cs.display, visibility: cs.visibility, "
            f"opacity: cs.opacity, pointerEvents: cs.pointerEvents, "
            f"color: cs.color, backgroundColor: cs.backgroundColor, "
            f"fontSize: cs.fontSize, fontWeight: cs.fontWeight }} }}); "
            f"}} return out; }})()"
        )
        try:
            r = await self.cdp.send("Runtime.evaluate", {
                "expression": expr, "returnByValue": True,
            })
        except Exception as e:  # noqa: BLE001
            logger.debug("Fallback candidate scan failed: %s", e)
            return None
        candidates = r.get("result", {}).get("value", []) or []
        if not candidates:
            return None

        scored = []
        for cand in candidates:
            score, matched_on, differences = self._score_candidate(
                cand, captured_styles, captured_text, captured_hash, snap
            )
            if score is not None:
                scored.append({
                    "candidate": cand,
                    "score": score,
                    "matched_on": matched_on,
                    "differences": differences,
                })
        if not scored:
            return None
        scored.sort(key=lambda s: s["score"], reverse=True)
        best = scored[0]
        if best["score"] < 0.5:
            return None

        # Cap the match score below 1.0 — fallback never reaches exact.
        match_score = min(round(best["score"], 3), 0.99)
        cand = best["candidate"]
        return {
            "node": cand,
            "backend_dom_node_id": None,  # re-obtained during action dispatch
            "match_score": match_score,
            "matched_on": best["matched_on"],
            "differences": best["differences"],
            "candidate_count": len(scored),
            "candidate_refs": [
                f"{c['candidate']['tag']}#{c['candidate']['id']}" if c["candidate"]["id"]
                else f"{c['candidate']['tag']}"
                for c in scored[:5]
            ],
        }

    def _score_candidate(self, cand: dict, captured_styles: dict,
                         captured_text: str, captured_hash: str,
                         captured_snap: dict) -> tuple:
        """Score a live candidate against the captured element. Returns
        (score, matched_on, differences). Score None means not scored."""
        matched_on = []
        differences = []
        weights = []

        # Structural signal: same tag and id
        cand_tag = cand.get("tag", "")
        captured_tag = (captured_snap.get("tag") or "").lower()
        if cand_tag == captured_tag:
            weights.append((0.35, "dom_structure"))
            matched_on.append("dom_structure")
        else:
            weights.append((0.0, "dom_structure"))

        # Computed styles signal
        cand_styles = cand.get("styles", {})
        style_keys = ("display", "visibility", "opacity",
                      "color", "backgroundColor", "fontSize", "fontWeight")
        style_matches = 0
        style_total = 0
        for k in style_keys:
            captured_val = captured_styles.get(
                k if k in captured_styles else _kebab(k))
            if captured_val:
                style_total += 1
                if str(cand_styles.get(k, "")) == str(captured_val):
                    style_matches += 1
        if style_total:
            style_ratio = style_matches / style_total
            weights.append((0.40 * style_ratio, "computed_styles"))
            if style_ratio >= 0.6:
                matched_on.append("computed_styles")
            else:
                differences.append(f"computed_styles drift ({style_matches}/{style_total} match)")
        else:
            weights.append((0.0, "computed_styles"))

        # Text content signal
        cand_text = (cand.get("text") or "").strip().lower()
        if captured_text and cand_text:
            if cand_text == captured_text:
                weights.append((0.25, "text_content"))
                matched_on.append("text_content")
            elif captured_text in cand_text or cand_text in captured_text:
                weights.append((0.15, "text_content"))
                matched_on.append("text_content")
                differences.append("text_content partial match")
            else:
                weights.append((0.0, "text_content"))
                differences.append("text_content differs")
        else:
            weights.append((0.0, "text_content"))

        total = sum(w for w, _ in weights)
        if total <= 0:
            return None, [], []
        if not matched_on:
            matched_on = ["dom_structure"]
        return total, matched_on, differences

    def _kebab(self, s: str) -> str:
        """Convert camelCase to kebab-case for style keys."""
        import re
        return re.sub(r'([a-z])([A-Z])', r'\1-\2', s).lower()

    # ── Known-bug consultation (IDD-016 §9) ────────────────────────────

    def _consult_known_bugs(self, request: dict, element: dict,
                            element_type: str, action: Optional[dict]) -> tuple:
        """Return (flags, workarounds) for this element+action."""
        flags = []
        workarounds = []
        portal = element.get("portal") or {}
        if portal.get("in_portal"):
            bug = KNOWN_BUG_FLAGS["radix_portal_block"]
            flags.append("radix_portal_block")
            workarounds.append({
                "bug_id": "radix_portal_block",
                "workaround": bug["workaround"],
                "applied": True,
            })
        # false_positive_save fires on save-ish actions on buttons.
        if action and action.get("type") == "click":
            attrs = (element.get("dom_snapshot", {}) or {}).get("attributes", {}) or {}
            label = ((element.get("dom_snapshot", {}) or {}).get("text_content") or "").lower()
            if "save" in label or "submit" in label or (attrs.get("type") == "submit"):
                bug = KNOWN_BUG_FLAGS["false_positive_save"]
                flags.append("false_positive_save")
                workarounds.append({
                    "bug_id": "false_positive_save",
                    "workaround": bug["workaround"],
                    "applied": False,
                    "reason": bug["reason"],
                })
        return flags, workarounds

    # ── Action compatibility (IDD-016 §7.5, §9) ────────────────────────

    def _check_action(self, action: dict, element_type: str,
                      confidence: float, interactable: bool,
                      flags: list) -> Optional[dict]:
        """Return a rejection dict when the action must be declined."""
        atype = action.get("type")
        compatible = ACTION_COMPAT.get(element_type, ACTION_COMPAT["other"])
        if atype not in compatible:
            return {
                "code": "ACTION_REJECTED",
                "reason_code": "element_type_incompatible",
                "reason": f"Action '{atype}' not supported on element type '{element_type}'.",
            }
        if confidence < 0.5:
            return {
                "code": "ACTION_REJECTED",
                "reason_code": "confidence_below_policy",
                "reason": f"Confidence {confidence} below execution policy floor 0.5.",
            }
        if not interactable:
            return {
                "code": "ACTION_REJECTED",
                "reason_code": "element_not_interactable",
                "reason": "Element is not visible or pointer-events blocked.",
            }
        return None

    def _map_action_to_primitive(self, action: dict, element_type: str,
                                  flags: list) -> dict:
        """Map the request action to ActionEngine primitives with workaround overrides."""
        from verification import ActionType
        
        atype = action.get("type", "click")
        value = action.get("value", "") or ""
        submit = bool(action.get("submit", False))
        
        # Base mapping
        at_map = {
            "click": ActionType.CLICK,
            "fill": ActionType.TYPE,
            "type": ActionType.TYPE,
            "select": ActionType.SELECT,
            "hover": ActionType.CLICK,
            "save": ActionType.SAVE,
        }
        at = at_map.get(atype, ActionType.CLICK)
        
        # Phase 3: Apply known-bug workarounds at dispatch time
        tier_override = None
        dispatch_strategy = None
        verification_mode = None
        
        for flag in flags:
            bug = KNOWN_BUG_FLAGS.get(flag, {})
            if bug.get("tier_override"):
                tier_override = bug["tier_override"]
            if bug.get("dispatch_strategy"):
                dispatch_strategy = bug["dispatch_strategy"]
            if bug.get("verification_mode"):
                verification_mode = bug["verification_mode"]
        
        # Override for save action
        if atype == "save" or (atype == "click" and "save" in value.lower()):
            at = ActionType.SAVE
        
        return {
            "action_type": at,
            "value": value,
            "submit": submit,
            "tier_override": tier_override,
            "dispatch_strategy": dispatch_strategy,
            "verification_mode": verification_mode,
        }

    # ── Main entry point ───────────────────────────────────────────────

    async def resolve(self, request: dict) -> dict:
        """Resolve an Automation Bridge capture request. Returns the response envelope.

        Never raises for contract errors — every failure becomes an error
        envelope so the caller parses one shape on every path.
        """
        started = time.time()
        request_id = request.get("request_id", "") if isinstance(request, dict) else ""

        # Idempotent replay
        if request_id:
            cached = self._cache_get(request_id)
            if cached is not None:
                logger.info("Replaying cached response for request_id=%s", request_id)
                return cached

        try:
            self._validate_version(request)
            self._validate_required(request)

            element = request["element"]
            action = request.get("action")
            timeout_ms = request.get("timeout_ms", 10000)
            element_type = _infer_element_type(element)
            computed_styles = element.get("computed_styles", {})
            interactable = _is_interactable(computed_styles)

            flags, workarounds = self._consult_known_bugs(
                request, element, element_type, action
            )

            # Exact fast path
            exact = await self._resolve_exact(request)
            latency = (time.time() - started) * 1000
            if latency > timeout_ms:
                raise AutomationBridgeResolverError(
                    "RESOLVER_TIMEOUT",
                    f"Resolution exceeded {timeout_ms}ms budget.",
                    {"phase": "resolve", "elapsed_ms": round(latency, 2)},
                )

            if exact is not None:
                envelope = self._build_exact_envelope(
                    request, exact, element_type, flags, workarounds,
                    interactable, latency,
                )
            else:
                fallback = await self._resolve_fallback(request)
                latency = (time.time() - started) * 1000
                if latency > timeout_ms:
                    raise AutomationBridgeResolverError(
                        "RESOLVER_TIMEOUT",
                        f"Fallback resolution exceeded {timeout_ms}ms budget.",
                        {"phase": "fallback", "elapsed_ms": round(latency, 2)},
                    )
                if fallback is None:
                    # Stale node + failed fallback => STALE_NODE per §10.1
                    raise AutomationBridgeResolverError(
                        "STALE_NODE",
                        "Node no longer resolves and structural fallback found no match at or above 0.5.",
                        {"requested_node_id": element.get("backend_dom_node_id"),
                         "fallback_attempted": True},
                        known_bug_flags=flags,
                    )
                envelope = self._build_fallback_envelope(
                    request, fallback, element_type, flags, workarounds,
                    interactable, latency,
                )

            # Optional action execution
            if action:
                await self._apply_action(
                    request, envelope, action, element_type,
                    interactable, flags,
                )

            self._cache_put(request_id, envelope)
            return envelope

        except AutomationBridgeResolverError as e:
            latency = (time.time() - started) * 1000
            envelope = self._error_envelope(request, e, latency)
            # Do not cache deterministic failures — recapture/retry would
            # trip over a stale error; only timeout/reattach replay.
            if e.code in ("RESOLVER_TIMEOUT", "TARGET_NOT_ATTACHED"):
                self._cache_put(request_id, envelope)
            return envelope
        except Exception as e:  # noqa: BLE001 — contract boundary
            logger.exception("Unexpected resolver failure for request_id=%s", request_id)
            latency = (time.time() - started) * 1000
            err = AutomationBridgeResolverError(
                "INTERNAL_ERROR",
                f"Unexpected resolver failure: {e}",
                {"request_id": request_id},
            )
            return self._error_envelope(request, err, latency)

    def _build_exact_envelope(self, request: dict, exact: dict,
                              element_type: str, flags: list,
                              workarounds: list, interactable: bool,
                              latency_ms: float) -> dict:
        element = request["element"]
        geom = element.get("geometry", {}) or {}
        envelope = self._base_envelope(request, latency_ms, node_live=True)
        envelope["resolution"] = {
            "status": "resolved",
            "resolution_path": "exact_backend_node",
            "confidence": 1.0,
            "element_ref": {
                "backend_dom_node_id": exact["backend_dom_node_id"],
                "selector": _extract_selector(element),
                "ax_node_id": exact["node"].get("nodeId"),
                "bounds": {
                    "x": geom.get("x", 0),
                    "y": geom.get("y", 0),
                    "width": geom.get("width", 0),
                    "height": geom.get("height", 0),
                },
                "frame_id": (request.get("page", {}) or {}).get("frame_id"),
                "target_id": (request.get("page", {}) or {}).get("target_id", ""),
            },
            "strategy": "backend_node_exact",
            "element_type": element_type,
            "action_hints": _action_hints_for(element_type),
            "known_bug_flags": flags,
            "known_bug_workarounds": workarounds,
            "fallback_match": None,
        }
        return envelope

    def _build_fallback_envelope(self, request: dict, fallback: dict,
                                 element_type: str, flags: list,
                                 workarounds: list, interactable: bool,
                                 latency_ms: float) -> dict:
        element = request["element"]
        geom = element.get("geometry", {}) or {}
        cand = fallback["candidate"]
        envelope = self._base_envelope(request, latency_ms, node_live=False)
        envelope["resolution"] = {
            "status": "resolved",
            "resolution_path": "fallback_structural",
            "confidence": fallback["match_score"],
            "element_ref": {
                "backend_dom_node_id": fallback["backend_dom_node_id"],
                "selector": (f"#{cand['id']}" if cand.get("id") else None),
                "ax_node_id": None,
                "bounds": {
                    "x": cand.get("x", geom.get("x", 0)),
                    "y": cand.get("y", geom.get("y", 0)),
                    "width": cand.get("w", geom.get("width", 0)),
                    "height": cand.get("h", geom.get("height", 0)),
                },
                "frame_id": (request.get("page", {}) or {}).get("frame_id"),
                "target_id": (request.get("page", {}) or {}).get("target_id", ""),
            },
            "strategy": "structural_styles_match",
            "element_type": element_type,
            "action_hints": _action_hints_for(element_type),
            "known_bug_flags": flags,
            "known_bug_workarounds": workarounds,
            "fallback_match": {
                "matched_on": fallback["matched_on"],
                "match_score": fallback["match_score"],
                "differences": fallback["differences"],
                "candidate_count": fallback["candidate_count"],
                "candidate_refs": fallback["candidate_refs"],
            },
        }
        return envelope

    async def _apply_action(self, request: dict, envelope: dict,
                            action: dict, element_type: str,
                            interactable: bool, flags: list) -> None:
        """Execute the requested action and attach action_outcome.

        Phase 3: Applies known-bug workarounds at dispatch time:
        - radix_portal_block: forces KEY tier
        - react_props_fallback: uses bubbling/direct dispatch
        - false_positive_save: enforces strict verification (URL change or network proof)
        """
        resolution = envelope["resolution"]
        confidence = resolution["confidence"]

        rejection = self._check_action(action, element_type, confidence,
                                       interactable, flags)
        action_outcome = {
            "requested_action": {
                "type": action.get("type"),
                "value": action.get("value"),
                "submit": bool(action.get("submit", False)),
            },
            "executed": False,
            "verification": None,
            "rejection": rejection,
        }
        if rejection is not None:
            resolution["action_outcome"] = action_outcome
            return

        # Phase 3: Map to ActionEngine primitives with workaround overrides
        primitive = self._map_action_to_primitive(action, element_type, flags)
        
        # Build a target for the Action Engine. Exact path uses the backend
        # node id; fallback path uses the selector hint.
        element_ref = resolution["element_ref"]
        target = (f"#{element_ref['backend_dom_node_id']}"
                  if element_ref.get("backend_dom_node_id") is not None
                  else element_ref.get("selector") or "")

        # The Action Engine is injected by the caller (main.py owns it).
        engine = getattr(self, "engine", None)
        if engine is None:
            action_outcome["rejection"] = {
                "code": "ACTION_REJECTED",
                "reason_code": "element_not_interactable",
                "reason": "Action Engine not available to the resolver.",
            }
            resolution["action_outcome"] = action_outcome
            return

        # Phase 3: Pass workaround context to Action Engine
        context = ""
        if primitive["tier_override"]:
            context = f"tier_override={primitive['tier_override']}"
        if primitive["dispatch_strategy"]:
            context = (context + "; " if context else "") + \
                f"dispatch_strategy={primitive['dispatch_strategy']}"
        if primitive["verification_mode"]:
            context = (context + "; " if context else "") + \
                f"verification_mode={primitive['verification_mode']}"

        try:
            result = await engine.execute(
                primitive["action_type"],
                target,
                primitive["value"],
                context=context,
                har_ref=request.get("request_id"),
            )
        except Exception as e:  # noqa: BLE001
            logger.warning("Action execution failed: %s", e)
            action_outcome["rejection"] = {
                "code": "ACTION_REJECTED",
                "reason_code": "element_not_interactable",
                "reason": f"Action dispatch failed: {e}",
            }
            resolution["action_outcome"] = action_outcome
            return

        action_outcome["executed"] = bool(result.get("success", False))
        action_outcome["action_tier"] = result.get("tier_used", result.get("tier", "CDP"))

        # Phase 3: Enhanced verification verdict with structured diff summary
        verified = bool(result.get("verified", False))
        state_changed = bool(result.get("state_changed", result.get("success", False)))
        
        # Determine verdict per IDD-016 §7.5
        if verified:
            verdict = "verified"
        elif state_changed:
            verdict = "not_verified"
        else:
            verdict = "no_state_change"
        
        # Build structured diff summary
        diff = result.get("diff", {})
        diff_summary = {
            "has_changed": diff.get("has_changed", False),
            "change_count": diff.get("change_count", 0),
            "keys_changed": diff.get("keys_changed", []),
            "url_changed": diff.get("url_changed", False),
            "errors_appeared": diff.get("errors_appeared", False),
            "toast_appeared": diff.get("toast_appeared", False),
        }
        
        # Phase 3: Add verification detail
        verification_detail = result.get("verification", {})
        verification_info = {
            "verified": verified,
            "method": "state_diff",
            "state_changed": state_changed,
            "verdict": verdict,
            "detail": verification_detail.get("detail", ""),
            "tier": verification_detail.get("tier", ""),
            "diff_summary": diff_summary,
        }
        
        # Add async poll info if present
        if result.get("verification", {}).get("detail", "").startswith("Deal"):
            verification_info["async_poll"] = verification_detail.get("detail", "")
        
        action_outcome["verification"] = verification_info
        resolution["action_outcome"] = action_outcome