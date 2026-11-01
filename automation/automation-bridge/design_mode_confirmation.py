#!/usr/bin/env python3
"""AutomationBridge Design Mode — hot-reload + visual confirmation loop (IDD-016).

Closes the ORCA-07 loop after a bridged action (kanban t_f86d149b):

  pick → capture → resolve → §8 policy gate → action execute
  (ABActionBridge, kanban t_466ce83a) → state-diff verification →
  Page.reload (hot-reload) → re-locate element (FRESH node id — backend
  node ids die on reload) → re-capture the affected region → inject the
  before/after + verdict panel render into the Design Mode UI.

Subscription model: every stage emits to subscribers —
'pick', 'captured', 'resolved', 'action_executed', 'reloaded',
'recaptured', 'rendered', 'failed' — so harnesses (and the demo) can
observe the Action/Verification result without polling.

Failure honesty (frozen contract decisions 4 and 5):
  * resolver error envelope   → error card, NO reload, NO execution
  * in-band ACTION_REJECTED   → rejection card, NO reload
  * verdict no_state_change / false_positive_detected / not_verified
    → evidence card with the state-diff summary and identical before/after
      thumbs — never a success badge
  * recapture failure after reload → panel still renders with the verdict
      and an explicit "after capture unavailable" note

Auto-execute policy mirrors IDD-016 §8 and the verification-gate policy
(IDD-016-VG-01): confidence >= 0.9 auto-executes click/hover; 0.5–0.9
requires human confirmation; fill/type/select require a value and are
human-confirm in v1.
"""
from __future__ import annotations

import asyncio
import copy
import json
import logging
import sys
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Optional

_HERE = Path(__file__).resolve().parent
_REPO_ROOT = _HERE.parents[1]
_STATE_ENGINE_DIR = _REPO_ROOT / "apps" / "state-engine"
for _p in (str(_HERE), str(_STATE_ENGINE_DIR)):
    if _p not in sys.path:
        sys.path.insert(0, _p)

from design_mode_capture import DesignModeCapture, selector_hints_from_attributes  # noqa: E402

try:
    from cdp_connection import CdpConnection  # noqa: E402
    from state_cache import CacheDirty, StateCache  # noqa: E402
    from ab_action_bridge import ABActionBridge  # noqa: E402
    _ENGINE_AVAILABLE = True
    _ENGINE_IMPORT_ERROR = None
except ImportError as _e:  # pragma: no cover - import diagnostics only
    _ENGINE_IMPORT_ERROR = repr(_e)
    _ENGINE_AVAILABLE = False
    CdpConnection = object  # type: ignore[assignment]
    StateCache = object  # type: ignore[assignment]
    CacheDirty = None  # type: ignore[assignment]
    ABActionBridge = None  # type: ignore[assignment]

logger = logging.getLogger("automation_bridge.design-mode-confirmation")

CONTRACT_VERSION = "1.0.0"

# §8 confidence bands. At/above the auto-execute floor the loop dispatches
# the first compatible hint; below it the session is surfaced for a human.
AUTO_EXECUTE_MIN_CONFIDENCE = 0.9
CONFIDENCE_FLOOR = 0.5

# Hints the v1 loop can auto-execute without a caller-supplied value.
AUTO_EXECUTE_HINTS = ("click", "hover")

STAGES = (
    "pick",
    "captured",
    "resolved",
    "action_executed",
    "reloaded",
    "recaptured",
    "rendered",
    "failed",
)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


# ──────────────────────────────────────────────────────────────────────────
# Fresh state cache — integration pitfall fix
# ──────────────────────────────────────────────────────────────────────────

class FreshStateCache(StateCache):
    """StateCache that never serves a stale snapshot.

    ABActionBridge reads before/after summaries from ONE StateCache
    instance around the action. The stock cache serves its CLEAN snapshot
    verbatim, so the after-read returns the before-snapshot and every
    action would verify as no_state_change. Invalidating before every
    read makes the state-diff honest. (The production engine relies on
    observers to dirty the cache; the AutomationBridge loop has no observer wired
    yet, so freshness is enforced here.)
    """

    async def get_state(self):
        if CacheDirty is None:  # state-engine modules unavailable
            raise RuntimeError("state_cache unavailable")
        self.invalidate(level=CacheDirty.DIRTY_CRITICAL)
        return await super().get_state()


# ──────────────────────────────────────────────────────────────────────────
# Session + classification
# ──────────────────────────────────────────────────────────────────────────

@dataclass
class ConfirmationSession:
    """One pick→confirm lifecycle. All fields serializable for the render."""

    session_id: str
    target_id: str
    pick: dict
    started_at: str = field(default_factory=now_iso)
    payload: Optional[dict] = None
    envelope: Optional[dict] = None
    before_shot: Optional[dict] = None
    after_shot: Optional[dict] = None
    after_element: Optional[dict] = None
    recapture_error: Optional[str] = None
    reload: Optional[dict] = None
    render_error: Optional[str] = None
    phase: str = "capturing"
    verdict: Optional[str] = None
    policy: Optional[dict] = None
    transport: Optional[str] = None
    error: Optional[dict] = None
    stage_log: list = field(default_factory=list)
    completed_at: Optional[str] = None

    def note(self, stage: str, detail: Any = None) -> None:
        self.stage_log.append({"stage": stage, "at": now_iso(), "detail": detail})


def classify_outcome(envelope: dict) -> tuple[str, Optional[str]]:
    """(phase, verdict) per IDD-016 §7.5 + the frozen badge decisions."""
    if envelope.get("error"):
        return ("error", None)
    resolution = envelope.get("resolution") or {}
    outcome = resolution.get("action_outcome")
    if not outcome:
        return ("no_action", None)
    if not outcome.get("executed"):
        if outcome.get("rejection") is not None:
            return ("rejection", None)
        return ("no_action", None)
    verdict = (outcome.get("verification") or {}).get("verdict")
    return ("confirmed", verdict)


def policy_decision(confidence: float, hints: list, auto_execute_min: float = AUTO_EXECUTE_MIN_CONFIDENCE) -> tuple[str, Optional[str]]:
    """§8 bands: >=0.9 auto-execute (click/hover in v1); 0.5–0.9 human confirm."""
    if not hints:
        return ("no_action", None)
    if confidence < auto_execute_min:
        return ("human_confirm", hints[0] if hints else None)
    hint = hints[0]
    if hint not in AUTO_EXECUTE_HINTS:
        # fill/type/select need a value the picker has not supplied yet.
        return ("human_confirm", hint)
    return ("execute", hint)


def _dispatch_envelope(envelope: dict, payload: dict) -> dict:
    """Deep-copied envelope adapted for Action Engine text dispatch.

    IDD-016 §7.4: element_ref.selector is a human-readable hint and the
    Action Engine MUST NOT depend on it. Task t_466ce83a's bridge however
    dispatches by visible text derived from that hint. When the resolver
    emitted a CSS-shaped hint, replace it with the captured element's real
    text content on the DISPATCH COPY only — the resolver's answer is
    preserved untouched on the session for rendering.
    """
    dispatch = copy.deepcopy(envelope)
    resolution = dispatch.get("resolution") or {}
    ref = resolution.get("element_ref") or {}
    selector = ref.get("selector") or ""
    text = ((payload.get("element") or {}).get("dom_snapshot") or {}).get("text_content") or ""
    text = text.strip().replace("\n", " ")
    looks_css = any(ch in selector for ch in ("#", ".", "[", " > "))
    # Adapt when the hint is CSS-shaped or absent — never when the resolver
    # already emitted a text-like hint.
    if text and (looks_css or not selector) and 0 < len(text) <= 60 and "<" not in text:
        ref["selector"] = text
        resolution["element_ref"] = ref
        logger.info("[confirm] dispatch selector adapted to visible text %r", text)
    return dispatch


def _diff_summary_text(diff_summary: Any) -> str:
    """Normalize diff_summary to the contract's string form.

    IDD-016 §7.5 types verification.diff_summary as a human-readable STRING.
    The task-3 bridge emits StateDiff.summary() (a dict) — normalize at the
    confirmation-loop boundary so the panel always renders text. The
    resolver-side contract (real resolver emits strings) is unaffected.
    """
    if isinstance(diff_summary, dict):
        keys = diff_summary.get("keys_changed") or []
        if diff_summary.get("has_changed"):
            return "state changed: " + ", ".join(keys) + f" ({len(keys)} key(s))"
        return "no state change — before/after snapshots identical (0 keys changed)"
    return "" if diff_summary is None else str(diff_summary)


def build_confirmation_payload(session: ConfirmationSession) -> dict:
    """Pure: assemble the render payload the Design Mode UI consumes."""
    envelope = session.envelope or {}
    resolution = envelope.get("resolution") or {}
    outcome = resolution.get("action_outcome") or {}
    verification = outcome.get("verification")
    if verification and isinstance(verification.get("diff_summary"), dict):
        verification = {
            **verification,
            "diff_summary": _diff_summary_text(verification.get("diff_summary")),
        }
    element = ((session.payload or {}).get("element")) or {}
    dom = (element.get("dom_snapshot") or {})
    portal = element.get("portal") or {}

    def _shot(shot):
        if not shot:
            return None
        return {
            "storage": shot.get("storage"),
            "data_uri": shot.get("data_uri"),
            "blob_id": shot.get("blob_id"),
            "mime_type": shot.get("mime_type"),
            "width": shot.get("width"),
            "height": shot.get("height"),
            "sha256": shot.get("sha256"),
        }

    return {
        "contract_version": CONTRACT_VERSION,
        "phase": session.phase,
        "verdict": session.verdict,
        "session_id": session.session_id,
        "request_id": (session.payload or {}).get("request_id"),
        "picked_at": session.started_at,
        "completed_at": session.completed_at,
        "element": {
            "tag": dom.get("tag"),
            "selector_hint": (resolution.get("element_ref") or {}).get("selector"),
            "text": (dom.get("text_content") or "")[:200],
            "in_portal": portal.get("in_portal", False),
        },
        "resolution": {
            "confidence": resolution.get("confidence"),
            "resolution_path": resolution.get("resolution_path"),
            "strategy": resolution.get("strategy"),
            "element_ref": resolution.get("element_ref"),
            "fallback_match": resolution.get("fallback_match"),
        } if resolution else None,
        "action": {
            "requested_action": outcome.get("requested_action"),
            "executed": outcome.get("executed", False),
            "action_tier": outcome.get("action_tier"),
        } if outcome else None,
        "verification": verification,
        "rejection": outcome.get("rejection"),
        "error": session.error or envelope.get("error"),
        "known_bug_flags": resolution.get("known_bug_flags") or (envelope.get("error") or {}).get("known_bug_flags") or [],
        "known_bug_workarounds": resolution.get("known_bug_workarounds") or [],
        "before": _shot(session.before_shot),
        "after": _shot(session.after_shot),
        "after_element": session.after_element,
        "recapture_error": session.recapture_error,
        "reload": session.reload,
        "resolver": envelope.get("resolver"),
        "transport": session.transport,
        "warnings": envelope.get("warnings") or [],
        "policy": session.policy,
        "stage_log": session.stage_log,
    }


# ──────────────────────────────────────────────────────────────────────────
# The loop
# ──────────────────────────────────────────────────────────────────────────

class ActionConfirmationLoop:
    """Pick loop with the full action→verify→hot-reload→recapture→render flow."""

    def __init__(
        self,
        capture: DesignModeCapture,
        *,
        page_ws_url: Optional[str] = None,
        default_target_id: str = "",
        auto_execute_min_confidence: float = AUTO_EXECUTE_MIN_CONFIDENCE,
        bridge_factory: Optional[Callable[[], Any]] = None,
        reload_timeout: float = 15.0,
        readiness_timeout: float = 3.0,
        sleep_fn=asyncio.sleep,
    ):
        self.capture = capture
        self.page_ws_url = page_ws_url
        self.default_target_id = default_target_id
        self.auto_execute_min_confidence = auto_execute_min_confidence
        self.bridge_factory = bridge_factory
        self.reload_timeout = reload_timeout
        self.readiness_timeout = readiness_timeout
        self.sleep_fn = sleep_fn
        self._subscribers: dict[str, list[Callable]] = {s: [] for s in STAGES}
        self._bridge_cdp: Optional[CdpConnection] = None

    # ── subscription ─────────────────────────────────────────────────────

    def subscribe(self, stage: str, callback: Callable) -> None:
        if stage not in self._subscribers:
            raise ValueError(f"unknown stage {stage!r}; valid: {STAGES}")
        self._subscribers[stage].append(callback)

    def _emit(self, stage: str, session: Any) -> None:
        for cb in list(self._subscribers.get(stage, [])):
            try:
                cb(session)
            except Exception:  # noqa: BLE001 - subscriber isolation
                logger.exception("[confirm] subscriber %s crashed", stage)

    # ── bridge execution (task 3 producer) ───────────────────────────────

    async def _get_bridge_cdp(self) -> CdpConnection:
        if self._bridge_cdp is None:
            if not self.page_ws_url:
                raise RuntimeError(
                    "page_ws_url required for bridge execution — the Action Engine "
                    "needs a page-level CDP WebSocket for the target tab"
                )
            conn = CdpConnection(self.page_ws_url)
            await conn.connect()
            self._bridge_cdp = conn
        return self._bridge_cdp

    async def _execute_action(self, envelope: dict, request_id: str, timeout_ms: int):
        if self.bridge_factory:
            bridge = self.bridge_factory()
        else:
            if not _ENGINE_AVAILABLE:
                raise RuntimeError(f"state-engine modules unavailable: {_ENGINE_IMPORT_ERROR}")
            cdp = await self._get_bridge_cdp()
            cache = FreshStateCache(cdp)
            bridge = ABActionBridge(cdp, cache)
        return await bridge.execute_from_resolver_response(envelope, request_id, timeout_ms)

    async def _set_execution_guard(self, target_id: str, executing: bool) -> None:
        """Pause the in-page picker while the action dispatches.

        The bridge drives real CDP input events; with Design Mode's
        document-level capture listener active those clicks would be
        swallowed as picks. The guard lets them through to the page.
        """
        try:
            await self.capture.evaluate(
                target_id,
                f"window.automation_bridgeDesignMode && window.automation_bridgeDesignMode.setExecutionGuard({str(executing).lower()})",
            )
        except Exception as e:  # noqa: BLE001 - guard is best-effort
            logger.warning("[confirm] execution guard toggle failed: %s", e)

    # ── post-reload re-location + recapture ──────────────────────────────

    async def _relocate(self, target_id: str, payload: dict) -> Optional[dict]:
        """Find the element again in the reloaded document.

        Backend node ids die on reload, so this re-locates by attribute
        selectors built from the captured element's stable attributes,
        falling back to the stored pick coordinates. Returns
        {node_id, selector|None, tag, via} or None.
        """
        dom = ((payload.get("element") or {}).get("dom_snapshot")) or {}
        attrs = dom.get("attributes") or {}
        picked_tag = dom.get("tag")

        candidates = selector_hints_from_attributes(attrs)

        for sel in candidates:
            probe_expr = (
                "(function(){const el=document.querySelector(" + json.dumps(sel) + ");"
                "if(!el)return null;const r=el.getBoundingClientRect();"
                "return {tag:el.tagName.toLowerCase(),visible:r.width>0&&r.height>0&&el.offsetParent!==null};})()"
            )
            probe = await self.capture.evaluate(target_id, probe_expr)
            logger.debug("[confirm] relocate probe %s => %s", sel, probe)
            if isinstance(probe, dict) and probe.get("visible"):
                # Same proven path as the initial capture: DOM.getDocument →
                # DOM.querySelector → DOM.describeNode (the objectId →
                # DOM.requestNode route proved unreliable live).
                node_id, _backend_id = await self.capture._node_ids_from_selector(target_id, sel)
                if node_id:
                    return {"node_id": node_id, "selector": sel, "tag": probe.get("tag"), "via": "attribute"}
                logger.warning("[confirm] relocate: selector %s probed visible but nodeId resolution failed", sel)

        # Coordinate fallback — the page reloaded to the same URL; the
        # element is usually near where it was picked.
        geometry = (payload.get("element") or {}).get("geometry") or {}
        cx = int((geometry.get("x") or 0) + (geometry.get("width") or 0) / 2)
        cy = int((geometry.get("y") or 0) + (geometry.get("height") or 0) / 2)
        probe = await self.capture.element_from_point(target_id, cx, cy)
        logger.debug("[confirm] relocate element_from_point(%s,%s) => %s", cx, cy, probe)
        if probe.get("found") and (picked_tag is None or probe.get("tag") == picked_tag):
            loc = await self.capture._cdp(
                "DOM.getNodeForLocation", {"x": cx, "y": cy}, target_id
            )
            node_id = loc.get("nodeId")
            backend_id = loc.get("backendNodeId")
            if not node_id and backend_id:
                # Chrome ≥151 omits nodeId from getNodeForLocation — derive it.
                node_id = await self.capture._node_ids_from_backend(target_id, backend_id)
            if node_id:
                return {"node_id": node_id, "selector": None, "tag": probe.get("tag"), "via": "element_from_point"}
        logger.warning("[confirm] relocate exhausted: candidates=%s coords=(%s,%s) probe=%s",
                       candidates, cx, cy, probe)
        return None

    async def _recapture(self, session: ConfirmationSession) -> None:
        target_id = session.target_id
        payload = session.payload or {}
        try:
            loc = await self._relocate(target_id, payload)
        except Exception as e:  # noqa: BLE001 - recapture failure is evidence, not a crash
            session.recapture_error = (
                f"element not re-locatable after hot-reload — capture_region failed: {type(e).__name__}: {e}"
            )
            return
        if not loc:
            session.recapture_error = (
                "element not re-locatable after hot-reload — attribute selectors and "
                "the coordinate probe both failed"
            )
            return
        try:
            region = await self.capture.capture_region(target_id, loc["node_id"])
        except Exception as e:  # noqa: BLE001
            session.recapture_error = f"region re-capture failed: {type(e).__name__}: {e}"
            return
        session.after_shot = region.get("screenshot")
        before_html = ((payload.get("element") or {}).get("dom_snapshot") or {}).get("outer_html") or ""
        after_html = region.get("outer_html") or ""
        session.after_element = {
            "selector": loc.get("selector"),
            "tag": loc.get("tag"),
            "via": loc.get("via"),
            "dom_changed": _normalize(before_html) != _normalize(after_html),
            "outer_html": after_html[:2000],
        }

    # ── render injection ─────────────────────────────────────────────────

    async def _await_page_ready(self, target_id: str) -> None:
        """Wait until the reloaded document re-exposed the render binding."""
        deadline = asyncio.get_event_loop().time() + self.readiness_timeout
        while asyncio.get_event_loop().time() < deadline:
            val = await self.capture.evaluate(
                target_id,
                "typeof window.__automation_bridgeDesignModeRenderConfirmation === 'function' && "
                "typeof window.automation_bridgeDesignMode === 'object'",
            )
            if val:
                return
            await self.sleep_fn(0.1)
        logger.warning("[confirm] page readiness probe timed out — rendering anyway")

    async def _render(self, session: ConfirmationSession) -> None:
        payload = build_confirmation_payload(session)
        expr = (
            "window.__automation_bridgeDesignModeRenderConfirmation && "
            "window.__automation_bridgeDesignModeRenderConfirmation("
            + json.dumps(payload, ensure_ascii=True)
            + ")"
        )
        try:
            val = await self.capture.evaluate(session.target_id, expr)
            session.render_error = None if val else (
                "page did not confirm the render (window.__automation_bridgeDesignModeRenderConfirmation "
                "missing or returned falsy)"
            )
        except Exception as e:  # noqa: BLE001
            session.render_error = f"render injection failed: {type(e).__name__}: {e}"
        session.note("rendered", {"render_error": session.render_error})

    # ── the pipeline ─────────────────────────────────────────────────────

    async def process_pick(self, pick: dict) -> ConfirmationSession:
        """Full pipeline for one pick. Returns the finished session."""
        session = ConfirmationSession(
            session_id=uuid.uuid4().hex,
            target_id=pick.get("target_id") or self.default_target_id or "",
            pick=pick,
        )
        session.note("pick", {"x": pick.get("x"), "y": pick.get("y")})
        target_id = session.target_id
        self._emit("pick", session)

        # 1. Capture (before-shot retained from the §6.2 recipe). Node
        #    resolution prefers stable attribute selectors from the in-page
        #    payload, then the pick coordinates.
        attrs = ((pick.get("payload") or {}).get("element") or {}).get("dom_snapshot", {}).get("attributes") or {}
        try:
            payload = await self.capture.capture_element(
                target_id,
                x=pick.get("x"),
                y=pick.get("y"),
                remote_object_id=pick.get("remote_object_id"),
                selector_hints=selector_hints_from_attributes(attrs),
            )
        except Exception as e:  # noqa: BLE001
            session.phase = "error"
            session.error = {
                "code": "CAPTURE_FAILED",
                "message": f"{type(e).__name__}: {e}",
                "retryable": False,
                "retry_policy": "none",
            }
            session.note("failed", session.error)
            self._emit("failed", session)
            return session
        session.payload = payload
        session.before_shot = ((payload.get("element") or {}).get("screenshot"))
        session.note("captured", payload["element"]["dom_snapshot"]["tag"])
        self._emit("captured", session)

        # 2. Resolve (MCP-first transport ladder, §5).
        envelope = await self.capture.resolve(payload)
        session.envelope = envelope
        session.transport = self.capture.last_transport
        if envelope.get("error"):
            session.phase = "error"
            session.error = envelope["error"]
            session.note("resolved", {"error": envelope["error"].get("code")})
            self._emit("resolved", session)
            await self._render(session)
            session.completed_at = now_iso()
            self._emit("rendered", session)
            return session

        resolution = envelope.get("resolution") or {}
        session.note("resolved", {"confidence": resolution.get("confidence"), "path": resolution.get("resolution_path")})
        self._emit("resolved", session)

        # 3. §8 policy gate. The page's auto-execute checkbox rides the
        #    binding IPC (auto_execute); when the page opts out, every
        #    action needs human confirmation regardless of confidence.
        confidence = float(resolution.get("confidence") or 0.0)
        hints = resolution.get("action_hints") or []
        if pick.get("auto_execute") is False:
            decision, hint = "human_confirm", hints[0] if hints else None
        else:
            decision, hint = policy_decision(confidence, hints, self.auto_execute_min_confidence)
        session.policy = {"decision": decision, "hint": hint, "confidence": confidence}
        if decision in ("no_action", "human_confirm"):
            session.phase = decision
            await self._render(session)
            session.completed_at = now_iso()
            self._emit("rendered", session)
            return session

        # 4. Execute via the task-3 bridge (dispatch copy carries the
        #    text-adapted selector hint; the session keeps the pristine
        #    resolver answer for rendering).
        dispatch_env = _dispatch_envelope(envelope, payload)
        await self._set_execution_guard(target_id, True)
        try:
            result = await self._execute_action(
                dispatch_env,
                payload.get("request_id", str(uuid.uuid4())),
                payload.get("timeout_ms", 10000),
            )
        except Exception as e:  # noqa: BLE001
            session.phase = "error"
            session.error = {
                "code": "BRIDGE_EXECUTION_FAILED",
                "message": f"{type(e).__name__}: {e}",
                "retryable": True,
                "retry_policy": "backoff",
            }
            session.note("action_executed", {"error": session.error["message"]})
            await self._set_execution_guard(target_id, False)
            await self._render(session)
            session.completed_at = now_iso()
            self._emit("failed", session)
            return session
        finally:
            await self._set_execution_guard(target_id, False)

        merged = result.to_dict()
        if merged.get("resolution"):
            session.envelope = merged
        elif merged.get("error"):
            session.envelope = merged
            session.phase = "error"
            session.error = merged["error"]
            session.note("action_executed", {"bridge_error": session.error.get("code")})
            self._emit("action_executed", session)
            await self._render(session)
            session.completed_at = now_iso()
            self._emit("rendered", session)
            return session

        phase, verdict = classify_outcome(session.envelope)
        session.phase = phase
        session.verdict = verdict
        outcome = (session.envelope.get("resolution") or {}).get("action_outcome") or {}
        session.note("action_executed", {
            "executed": outcome.get("executed"),
            "tier": outcome.get("action_tier"),
            "verdict": verdict,
        })
        self._emit("action_executed", session)

        if phase != "confirmed":
            # Rejection / no-op / error — nothing changed on the page, so no
            # reload. The panel renders the rejection or verdict evidence.
            await self._render(session)
            session.completed_at = now_iso()
            self._emit("rendered", session)
            return session

        # 5. Hot-reload the tab (Page.reload → same URL/state). Stash the
        #    pending session in sessionStorage first so the reloaded page
        #    can show an interim notice until the controller re-injects the
        #    full before/after payload. (session.phase keeps its terminal
        #    classification; progress lives in the stage log + emits.)
        try:
            pending = {
                "phase": "reloading",
                "request_id": (session.payload or {}).get("request_id"),
                "verdict": session.verdict,
                "element": {"tag": (((session.payload or {}).get("element") or {}).get("dom_snapshot") or {}).get("tag")},
            }
            await self.capture.evaluate(
                target_id,
                "(function(){try{sessionStorage.setItem('automation_bridgeDesignMode.pending',"
                + json.dumps(json.dumps(pending, ensure_ascii=True))
                + ")}catch(e){}})()",
            )
        except Exception as e:  # noqa: BLE001 - stash is best-effort
            logger.warning("[confirm] pending stash failed: %s", e)
        session.reload = await self.capture.reload_and_wait(target_id)
        session.note("reloaded", session.reload)
        self._emit("reloaded", session)
        await self._await_page_ready(target_id)

        # 6. Re-locate (fresh node id) + re-capture the affected region.
        await self._recapture(session)
        session.note("recaptured", {
            "after_shot": bool(session.after_shot),
            "recapture_error": session.recapture_error,
        })
        self._emit("recaptured", session)

        # 7. Render the before/after + verdict panel.
        await self._render(session)
        session.completed_at = now_iso()
        self._emit("rendered", session)
        return session

    async def run(self) -> None:
        """Sequential pick loop (production entry; never dies on one pick)."""
        while True:
            pick = None
            try:
                pick = await self.capture.next_pick()
                await self.process_pick(pick)
            except Exception as e:  # noqa: BLE001 - loop must survive one bad pick
                logger.exception("[confirm] pipeline error")
                self._emit("failed", {"error": f"{type(e).__name__}: {e}", "pick": pick})
            await asyncio.sleep(0)  # yield so cancellation propagates + other tasks run

    async def close(self) -> None:
        if self._bridge_cdp is not None:
            try:
                await self._bridge_cdp.close()
            except Exception:  # noqa: BLE001
                pass
            self._bridge_cdp = None


def _normalize(html: str) -> str:
    return "".join(html.split()).lower()


# ──────────────────────────────────────────────────────────────────────────
# CLI: run the loop against a live tab
# ──────────────────────────────────────────────────────────────────────────

async def main(argv: Optional[list[str]] = None) -> int:
    import argparse

    p = argparse.ArgumentParser(description="AutomationBridge Design Mode confirmation loop (IDD-016)")
    p.add_argument("--cdp-ws", required=True, help="Browser-level CDP WebSocket URL")
    p.add_argument("--target", required=True, help="CDP Target.targetId of the tab")
    p.add_argument("--page-ws", required=True, help="Page-level CDP WebSocket URL (Action Engine)")
    p.add_argument("--port", type=int, default=9110)
    args = p.parse_args(argv)

    logging.basicConfig(level=logging.INFO)
    capture = DesignModeCapture(args.cdp_ws, state_engine_port=args.port)
    await capture.connect()
    capture.cdp.subscribe(capture.feed_event)
    await capture.install_design_mode(args.target)

    loop = ActionConfirmationLoop(capture, page_ws_url=args.page_ws)

    def _log(stage):
        def cb(session):
            logger.info("[stage] %s session=%s phase=%s verdict=%s", stage, session.session_id, session.phase, session.verdict)
        return cb

    for stage in STAGES:
        loop.subscribe(stage, _log(stage))

    logger.info("Confirmation loop running — pick elements in Design Mode. Ctrl+C to stop.")
    try:
        await loop.run()
    finally:
        await loop.close()
        await capture.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
