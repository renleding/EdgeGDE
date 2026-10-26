"""Orca Action Bridge — executes bridge actions with verification state-diff.

Consumes resolver response (IDD-016), maps to Action Engine primitives,
applies known-bug workarounds, executes, verifies via state-diff.

Vendored from kanban task t_466ce83a (ORCA-07 action bridge). Repo layout
adjustment only: sys.path bootstrap so the state-engine sibling modules
resolve when this file runs from automation/orca/.
"""
import sys
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[2]
_STATE_ENGINE_DIR = _REPO_ROOT / "apps" / "state-engine"
if str(_STATE_ENGINE_DIR) not in sys.path:
    sys.path.insert(0, str(_STATE_ENGINE_DIR))

import asyncio
import json
import logging
import time
import uuid
from dataclasses import dataclass, field, asdict
from typing import Any, Optional
from enum import Enum

from action_engine import ActionEngine, ActionType
from verification import VerificationEngine, VerificationResult
from state_diff import StateDiff
from state_cache import StateCache, build_state_summary
from cdp_connection import CdpConnection
from failure_envelope import FailureEnvelope
from salestrekker_rules import get_salestrekker_rules

logger = logging.getLogger('orca.action_bridge')


class ExecutionTier(str, Enum):
    REACT = "REACT"
    CDP = "CDP"
    KEY = "KEY"
    JS = "JS"
    AX = "AX"
    OS = "OS"


class VerificationVerdict(str, Enum):
    VERIFIED = "verified"
    NO_STATE_CHANGE = "no_state_change"
    FALSE_POSITIVE_DETECTED = "false_positive_detected"
    NOT_VERIFIED = "not_verified"


class RejectionReasonCode(str, Enum):
    CONFIDENCE_BELOW_POLICY = "confidence_below_policy"
    ELEMENT_TYPE_INCOMPATIBLE = "element_type_incompatible"
    KNOWN_BUG_NO_WORKAROUND = "known_bug_no_workaround"
    ELEMENT_NOT_INTERACTABLE = "element_not_interactable"


@dataclass
class ActionOutcome:
    requested_action: dict
    executed: bool
    action_tier: Optional[str] = None
    verification: Optional[dict] = None
    rejection: Optional[dict] = None

    def to_dict(self) -> dict:
        return {k: v for k, v in asdict(self).items() if v is not None}


@dataclass
class BridgeExecutionResult:
    schema_version: str = "1.0.0"
    request_id: str = ""
    resolved_at: str = ""
    resolution: Optional[dict] = None
    error: Optional[dict] = None
    resolver: Optional[dict] = None
    warnings: list = field(default_factory=list)

    def to_dict(self) -> dict:
        return {k: v for k, v in asdict(self).items() if v is not None}


class OrcaActionBridge:
    """Bridge from resolver response to verified action execution."""

    def __init__(self, cdp: CdpConnection, cache: StateCache, journal=None):
        self.cdp = cdp
        self.cache = cache
        self.journal = journal
        self.engine = ActionEngine(cdp, cache, journal)
        self.verifier = VerificationEngine()
        self.verifier.set_state_fn(self._poll_state)
        self.rules = get_salestrekker_rules()

    async def _poll_state(self) -> dict:
        snapshot = await self.cache.get_state()
        return {'body_text': snapshot.body_text or '', 'url': snapshot.url or ''}

    async def execute_from_resolver_response(
        self,
        resolver_response: dict,
        request_id: str,
        timeout_ms: int = 10000
    ) -> BridgeExecutionResult:
        """Execute action from resolver response and return full outcome envelope.

        Args:
            resolver_response: The full resolver response envelope
            request_id: The request_id for idempotency
            timeout_ms: Timeout budget for execution + verification

        Returns:
            BridgeExecutionResult with action_outcome populated
        """
        start_time = time.time()
        timeout_seconds = timeout_ms / 1000.0

        # Extract resolution from response
        resolution = resolver_response.get('resolution')
        if not resolution:
            return BridgeExecutionResult(
                request_id=request_id,
                resolved_at=self._now_iso(),
                error={
                    'code': 'INTERNAL_ERROR',
                    'message': 'Resolver response missing resolution',
                    'retryable': False,
                    'retry_policy': 'none'
                }
            )

        # Check if action was requested in the original request
        # The resolver response may already have action_outcome if action was in request
        existing_action_outcome = resolution.get('action_outcome')
        if existing_action_outcome and existing_action_outcome.get('executed'):
            # Action already executed by resolver — return as-is
            return BridgeExecutionResult(
                request_id=request_id,
                resolved_at=self._now_iso(),
                resolution=resolution,
                resolver=resolver_response.get('resolver'),
                warnings=resolver_response.get('warnings', [])
            )

        # No action in request, or action not executed — check if we should execute
        action_hints = resolution.get('action_hints', [])
        if not action_hints:
            # No compatible actions — return resolution without action_outcome
            return BridgeExecutionResult(
                request_id=request_id,
                resolved_at=self._now_iso(),
                resolution=resolution,
                resolver=resolver_response.get('resolver'),
                warnings=resolver_response.get('warnings', [])
            )

        # For this bridge, we assume the caller wants to execute the first compatible action
        # In practice, the caller would specify the intended action in the request
        element_type = resolution.get('element_type', 'other')
        action_type = self._map_action_hint_to_type(action_hints[0], element_type)
        if not action_type:
            return BridgeExecutionResult(
                request_id=request_id,
                resolved_at=self._now_iso(),
                resolution=resolution,
                resolver=resolver_response.get('resolver'),
                warnings=resolver_response.get('warnings', []) + ['no_compatible_action_type']
            )

        # Build action request from resolution
        element_ref = resolution.get('element_ref', {})
        backend_node_id = element_ref.get('backend_dom_node_id')
        if backend_node_id is None:
            # No live node handle — cannot execute
            rejection = {
                'code': 'ACTION_REJECTED',
                'reason_code': RejectionReasonCode.ELEMENT_NOT_INTERACTABLE.value,
                'reason': 'No live backendDOMNodeId available for execution'
            }
            resolution['action_outcome'] = ActionOutcome(
                requested_action={'type': action_type.value, 'value': None, 'submit': False},
                executed=False,
                rejection=rejection
            ).to_dict()
            return BridgeExecutionResult(
                request_id=request_id,
                resolved_at=self._now_iso(),
                resolution=resolution,
                resolver=resolver_response.get('resolver'),
                warnings=resolver_response.get('warnings', [])
            )

        # Check confidence policy
        confidence = resolution.get('confidence', 0.0)
        if confidence < 0.5:
            rejection = {
                'code': 'ACTION_REJECTED',
                'reason_code': RejectionReasonCode.CONFIDENCE_BELOW_POLICY.value,
                'reason': f'Confidence {confidence:.2f} below 0.5 floor'
            }
            resolution['action_outcome'] = ActionOutcome(
                requested_action={'type': action_type.value, 'value': None, 'submit': False},
                executed=False,
                rejection=rejection
            ).to_dict()
            return BridgeExecutionResult(
                request_id=request_id,
                resolved_at=self._now_iso(),
                resolution=resolution,
                resolver=resolver_response.get('resolver'),
                warnings=resolver_response.get('warnings', [])
            )

        # Check element type compatibility
        element_type = resolution.get('element_type', 'other')
        if not self._is_action_compatible(action_type, element_type, action_hints):
            rejection = {
                'code': 'ACTION_REJECTED',
                'reason_code': RejectionReasonCode.ELEMENT_TYPE_INCOMPATIBLE.value,
                'reason': f'Action {action_type.value} not compatible with element type {element_type}'
            }
            resolution['action_outcome'] = ActionOutcome(
                requested_action={'type': action_type.value, 'value': None, 'submit': False},
                executed=False,
                rejection=rejection
            ).to_dict()
            return BridgeExecutionResult(
                request_id=request_id,
                resolved_at=self._now_iso(),
                resolution=resolution,
                resolver=resolver_response.get('resolver'),
                warnings=resolver_response.get('warnings', [])
            )

        # Check known-bug flags for no-workaround cases
        known_bug_flags = resolution.get('known_bug_flags', [])
        known_bug_workarounds = resolution.get('known_bug_workarounds', [])
        for workaround in known_bug_workarounds:
            if not workaround.get('applied', False):
                bug_id = workaround.get('bug_id')
                if bug_id and self._is_no_workaround_bug(bug_id):
                    rejection = {
                        'code': 'ACTION_REJECTED',
                        'reason_code': RejectionReasonCode.KNOWN_BUG_NO_WORKAROUND.value,
                        'reason': f'Known bug {bug_id} has no available workaround'
                    }
                    resolution['action_outcome'] = ActionOutcome(
                        requested_action={'type': action_type.value, 'value': None, 'submit': False},
                        executed=False,
                        rejection=rejection
                    ).to_dict()
                    return BridgeExecutionResult(
                        request_id=request_id,
                        resolved_at=self._now_iso(),
                        resolution=resolution,
                        resolver=resolver_response.get('resolver'),
                        warnings=resolver_response.get('warnings', [])
                    )

        # Execute with workarounds applied
        result = await self._execute_with_workarounds(
            action_type,
            resolution,
            element_ref,
            timeout_seconds
        )

        # Build final response
        resolution['action_outcome'] = result.to_dict()

        return BridgeExecutionResult(
            request_id=request_id,
            resolved_at=self._now_iso(),
            resolution=resolution,
            resolver=resolver_response.get('resolver'),
            warnings=resolver_response.get('warnings', [])
        )

    def _map_action_hint_to_type(self, hint: str, element_type: str = None) -> Optional[ActionType]:
        """Map action hint to ActionType, considering element type."""
        # Special case: save_button with click -> SAVE action type for proper verification
        if element_type == 'save_button' and hint == 'click':
            return ActionType.SAVE
        mapping = {
            'click': ActionType.CLICK,
            'fill': ActionType.TYPE,  # fill maps to TYPE in engine
            'type': ActionType.TYPE,
            'select': ActionType.SELECT,
            'hover': ActionType.CLICK,  # hover not directly supported, treat as click
        }
        return mapping.get(hint)

    def _is_action_compatible(self, action_type: ActionType, element_type: str, action_hints: list) -> bool:
        # Check action_hints from resolver (authoritative)
        hint_str = action_type.value
        # Special case: SAVE action type maps to click hint for save_button
        if action_type == ActionType.SAVE and element_type == 'save_button':
            return 'click' in action_hints
        if action_type == ActionType.TYPE:
            # fill and type both map to TYPE
            if 'fill' in action_hints or 'type' in action_hints:
                return True
        return hint_str in action_hints

    def _is_no_workaround_bug(self, bug_id: str) -> bool:
        # Currently all known bugs have workarounds
        # This would be extended based on registry
        return False

    async def _execute_with_workarounds(
        self,
        action_type: ActionType,
        resolution: dict,
        element_ref: dict,
        timeout_seconds: float
    ) -> ActionOutcome:
        """Execute action applying known-bug workarounds."""
        backend_node_id = element_ref.get('backend_dom_node_id')
        frame_id = element_ref.get('frame_id')
        target_id = element_ref.get('target_id')
        element_type = resolution.get('element_type', 'other')
        known_bug_flags = resolution.get('known_bug_flags', [])
        known_bug_workarounds = resolution.get('known_bug_workarounds', [])

        # Determine target selector for ActionEngine (uses text matching)
        selector = element_ref.get('selector', '')
        # Use text_content from dom_snapshot or element text
        target_text = resolution.get('element_ref', {}).get('selector', '')
        if not target_text:
            # Fallback to element_type-based targeting
            target_text = element_type
        # If target_text is a CSS selector, try to extract meaningful text
        # e.g., "button#save-and-calculate" -> "Save and calculate"
        if target_text and ('#' in target_text or '.' in target_text or '[' in target_text):
            # Extract text from common patterns
            import re
            # Try to get text from id attribute
            id_match = re.search(r'#([^\s\[\.]+)', target_text)
            if id_match:
                target_text = id_match.group(1).replace('-', ' ').replace('_', ' ')
            else:
                # Try to get from class or attribute
                target_text = element_type

        # Select tier with workaround awareness
        tier = self._select_tier_with_workarounds(action_type, element_type, known_bug_flags, known_bug_workarounds)

        # Build context for tier selection
        context = f"{element_type}"
        if 'radix_portal_block' in known_bug_flags:
            context += " radix_portal_block"
        if 'react_props_fallback' in known_bug_flags:
            context += " react_props_fallback"

        # Capture before state
        before = build_state_summary(await self.cache.get_state())

        # Execute action with selected tier
        executed = await self._try_tier_with_workaround(
            tier, action_type, target_text, None, context, known_bug_flags, known_bug_workarounds
        )

        if not executed:
            # Try fallback tiers
            fallback_tiers = self._get_fallback_tiers(tier, element_type, known_bug_flags)
            for fb_tier in fallback_tiers:
                executed = await self._try_tier_with_workaround(
                    fb_tier, action_type, target_text, None, context, known_bug_flags, known_bug_workarounds
                )
                if executed:
                    tier = fb_tier
                    break

        # Capture after state
        after = build_state_summary(await self.cache.get_state())
        diff = StateDiff(before, after)

        # Verify via state-diff
        verification = self.verifier.verify(action_type, diff, tier)

        # Apply false_positive_save guard
        false_positive_guard = None
        if 'false_positive_save' in known_bug_flags:
            if verification.success and diff.toast_appeared() and not diff.url_changed():
                # Toast alone without URL change = false positive
                verification = VerificationResult(False, tier, "false_positive_save: toast without persistence")
                false_positive_guard = "false_positive_save"

        # Determine verdict
        if verification.success:
            verdict = VerificationVerdict.VERIFIED
        elif diff.has_changed():
            verdict = VerificationVerdict.FALSE_POSITIVE_DETECTED if false_positive_guard else VerificationVerdict.NO_STATE_CHANGE
        else:
            verdict = VerificationVerdict.NO_STATE_CHANGE

        verified = (verdict == VerificationVerdict.VERIFIED)

        return ActionOutcome(
            requested_action={'type': action_type.value, 'value': None, 'submit': False},
            executed=executed,
            action_tier=tier if executed else None,
            verification={
                'verified': verified,
                'method': 'state_diff',
                'state_changed': diff.has_changed(),
                'verdict': verdict.value,
                'diff_summary': diff.summary(),
                'false_positive_guard': false_positive_guard
            } if executed else None,
            rejection=None if executed else {
                'code': 'ACTION_REJECTED',
                'reason_code': RejectionReasonCode.ELEMENT_NOT_INTERACTABLE.value,
                'reason': 'All execution tiers failed'
            }
        )

    def _select_tier_with_workarounds(
        self,
        action_type: ActionType,
        element_type: str,
        known_bug_flags: list,
        known_bug_workarounds: list
    ) -> str:
        """Select execution tier considering known-bug workarounds."""
        # Check for Radix portal block → force KEY tier for combobox
        if 'radix_portal_block' in known_bug_flags and element_type == 'combobox':
            for wb in known_bug_workarounds:
                if wb.get('bug_id') == 'radix_portal_block' and not wb.get('applied', False):
                    return ExecutionTier.KEY.value

        # Check for React props fallback → prefer JS/CDP over REACT for save_button
        if 'react_props_fallback' in known_bug_flags and element_type == 'save_button':
            # Skip REACT tier, prefer JS then CDP
            return ExecutionTier.JS.value

        # Default to engine's tier selection
        target = element_type  # Used as target text for engine
        context = element_type
        tiers = self.engine._select_tiers(action_type, target, context)
        return tiers[0] if tiers else ExecutionTier.CDP.value

    def _get_fallback_tiers(self, primary_tier: str, element_type: str, known_bug_flags: list) -> list:
        """Get fallback tiers excluding the primary and known-bug-affected tiers."""
        all_tiers = ['CDP', 'JS', 'KEY', 'AX', 'REACT', 'OS']
        fallbacks = [t for t in all_tiers if t != primary_tier]

        # Remove tiers affected by known bugs
        if 'radix_portal_block' in known_bug_flags:
            # CDP and AX may be intercepted
            fallbacks = [t for t in fallbacks if t not in ['CDP', 'AX']]
        if 'react_props_fallback' in known_bug_flags:
            # REACT may fail
            fallbacks = [t for t in fallbacks if t != 'REACT']

        return fallbacks

    async def _try_tier_with_workaround(
        self,
        tier: str,
        action_type: ActionType,
        target: str,
        value: Optional[str],
        context: str,
        known_bug_flags: list,
        known_bug_workarounds: list
    ) -> bool:
        """Execute a specific tier with workaround applied."""
        if tier == ExecutionTier.KEY.value and 'radix_portal_block' in known_bug_flags:
            return await self._tier_key_combobox(target)
        elif tier == ExecutionTier.JS.value and 'react_props_fallback' in known_bug_flags:
            return await self._tier_js_bubbling_click(target)
        elif tier == ExecutionTier.REACT.value and 'react_props_fallback' in known_bug_flags:
            # Skip REACT when props fallback is flagged
            return False

        # Standard tier execution via engine
        try:
            return await self.engine._try_tier(tier, action_type, target, value)
        except Exception as e:
            logger.warning("Tier %s failed: %s", tier, e)
            return False

    async def _tier_key_combobox(self, target: str) -> bool:
        """KEY tier workaround for Radix portal combobox: ArrowDown + Enter."""
        try:
            # Find combobox and focus it
            expr = f'''()=>{{const el=document.querySelector('[role=combobox],[aria-autocomplete="list"]');if(el){{el.focus();return true}}return false}}()'''
            r = await self.cdp.send('Runtime.evaluate', {'expression': expr, 'returnByValue': True})
            if not r.get('result', {}).get('value', False):
                return False

            # ArrowDown to open/navigate
            await self.cdp.send('Input.dispatchKeyEvent', {
                'type': 'keyDown', 'key': 'ArrowDown', 'code': 'ArrowDown'
            })
            await asyncio.sleep(0.1)
            await self.cdp.send('Input.dispatchKeyEvent', {
                'type': 'keyUp', 'key': 'ArrowDown', 'code': 'ArrowDown'
            })
            await asyncio.sleep(0.1)

            # Enter to select
            await self.cdp.send('Input.dispatchKeyEvent', {
                'type': 'keyDown', 'key': 'Enter', 'code': 'Enter'
            })
            await asyncio.sleep(0.1)
            await self.cdp.send('Input.dispatchKeyEvent', {
                'type': 'keyUp', 'key': 'Enter', 'code': 'Enter'
            })
            return True
        except Exception as e:
            logger.warning("KEY tier combobox failed: %s", e)
            return False

    async def _tier_js_bubbling_click(self, target: str) -> bool:
        """JS tier workaround for React props fallback: bubbling dispatchEvent."""
        try:
            expr = f'''()=>{{for(const b of document.querySelectorAll('button')){{if((b.textContent||'').trim()==='{target}'&&b.offsetParent){{b.removeAttribute('disabled');const ev=new MouseEvent('click',{{bubbles:true,cancelable:true,view:window}});b.dispatchEvent(ev);return true}}}}return false}}()'''
            r = await self.cdp.send('Runtime.evaluate', {'expression': expr, 'returnByValue': True})
            return r.get('result', {}).get('value', False)
        except Exception as e:
            logger.warning("JS bubbling click failed: %s", e)
            return False

    def _now_iso(self) -> str:
        from datetime import datetime, timezone
        return datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')


async def main():
    """Demo / test entry point."""
    logging.basicConfig(level=logging.INFO)
    logger.info("Orca Action Bridge module loaded")

    # Example usage with the sample response
    sample_response = {
        "schema_version": "1.0.0",
        "request_id": "3f6b2a1e-7c4d-4e5f-9a8b-1c2d3e4f5a6b",
        "resolved_at": "2026-10-26T08:15:00.000Z",
        "resolution": {
            "status": "resolved",
            "resolution_path": "exact_backend_node",
            "confidence": 1.0,
            "element_ref": {
                "backend_dom_node_id": 4821,
                "selector": "button#save-and-calculate",
                "ax_node_id": 112,
                "bounds": {"x": 640, "y": 812, "width": 168, "height": 40},
                "frame_id": "F1.1",
                "target_id": "A1B2C3D4E5F6A7B8C9D0"
            },
            "strategy": "backend_node_exact",
            "element_type": "button",
            "action_hints": ["click", "hover"],
            "known_bug_flags": ["react_props_fallback"],
            "known_bug_workarounds": [{
                "bug_id": "react_props_fallback",
                "workaround": "Save button may lack __reactProps$. Dispatch a bubbling click event or call b.click() after removing disabled.",
                "applied": False,
                "reason": "Execution-time workaround. Enforced by the Action Engine at dispatch."
            }],
            "fallback_match": None,
            "action_outcome": None
        },
        "resolver": {
            "version": "state-engine@1.4.2",
            "latency_ms": 42,
            "node_live": True,
            "target_id": "A1B2C3D4E5F6A7B8C9D0"
        },
        "warnings": []
    }

    # Note: Requires live CDP connection to run
    logger.info("Bridge ready. Connect to CDP to execute.")
    print(json.dumps(sample_response, indent=2))


if __name__ == '__main__':
    asyncio.run(main())