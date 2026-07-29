"""Verification — rule-based per-action success detection with async polling for Save."""
import asyncio, logging
from enum import Enum
from typing import Optional, Callable, Awaitable
from state_diff import StateDiff

logger = logging.getLogger('state-engine.verify')

class ActionType(Enum):
    CLICK = "click"
    TYPE = "type"
    SELECT = "select"
    SAVE = "save"
    NAVIGATE = "navigate"
    SCROLL = "scroll"

class VerificationResult:
    def __init__(self, success: bool, tier: str = "", detail: str = ""):
        self.success = success
        self.tier = tier
        self.detail = detail

class VerificationEngine:
    def __init__(self):
        self._get_state_fn = None
        self._rules = {
            ActionType.CLICK: self._verify_click,
            ActionType.TYPE: self._verify_type,
            ActionType.SELECT: self._verify_select,
            ActionType.SAVE: self._verify_save_async,
            ActionType.NAVIGATE: self._verify_navigate,
        }
    
    def set_state_fn(self, fn: Callable[[], Awaitable[dict]]):
        """Set async function to get current page state."""
        self._get_state_fn = fn

    def verify(self, action_type: ActionType, diff: StateDiff, 
               tier: str = "") -> VerificationResult:
        rule = self._rules.get(action_type)
        if not rule:
            return VerificationResult(False, tier, f"No rule for {action_type}")
        
        # For actions that support async polling, call the async method
        if action_type == ActionType.SAVE:
            return rule(diff, tier)
        
        return rule(diff, tier)

    def _verify_click(self, diff: StateDiff, tier: str) -> VerificationResult:
        if diff.url_changed():
            return VerificationResult(True, tier, "URL changed")
        if diff.buttons_changed():
            return VerificationResult(True, tier, "Buttons changed")
        if diff.errors_appeared():
            return VerificationResult(False, tier, "Error appeared: " + 
                str(diff.changes.get('errors', {}).get('to', [])))
        return VerificationResult(False, tier, "no_state_change_detected")

    def _verify_type(self, diff: StateDiff, tier: str) -> VerificationResult:
        if diff.has_changed():
            return VerificationResult(True, tier, "State changed")
        return VerificationResult(False, tier, "no_state_change_detected")

    def _verify_select(self, diff: StateDiff, tier: str) -> VerificationResult:
        if diff.has_changed():
            return VerificationResult(True, tier, "State changed")
        return VerificationResult(False, tier, "no_state_change_detected")

    def _verify_save_async(self, diff: StateDiff, tier: str) -> VerificationResult:
        """Async-aware save verification with polling for delayed creation."""
        if diff.url_changed():
            return VerificationResult(True, tier, "URL changed (navigation)")
        if diff.toast_appeared():
            return VerificationResult(True, tier, "Toast appeared: " + 
                str(diff.changes.get('toast', {}).get('to', '')))
        if diff.errors_appeared():
            return VerificationResult(False, tier, "Error appeared: " + 
                str(diff.changes.get('errors', {}).get('to', [])))
        
        # No immediate change detected — schedule async polling
        # The deal may be created after a delay (observed: 30-180s)
        # Return pending state — caller should poll via check_save_result()
        return VerificationResult(False, tier, "pending_async_save")

    async def check_save_result(self, check_url: str, deal_title: str = "",
                                 poll_seconds: int = 300, 
                                 interval: int = 30) -> VerificationResult:
        """Poll for async save completion by checking board for deal title.
        
        The SPA does NOT auto-navigate after Save. URL change checking is
        unreliable. Instead, navigate to the board and look for the deal title."""
        import time, re
        start = time.time()
        while time.time() - start < poll_seconds:
            await asyncio.sleep(interval)
            if self._get_state_fn and deal_title:
                try:
                    state = await self._get_state_fn()
                    body = state.get('body_text', state.get('content', ''))
                    if deal_title in body:
                        return VerificationResult(True, "async_poll",
                            f"Deal '{deal_title}' found on board after {time.time()-start:.0f}s")
                except Exception as e:
                    logger.warning("Async poll failed: %s", e)
        return VerificationResult(False, "async_poll", 
            f"Deal '{deal_title}' not found after {poll_seconds}s")

    def _verify_navigate(self, diff: StateDiff, tier: str) -> VerificationResult:
        if diff.url_changed():
            return VerificationResult(True, tier, "URL changed")
        return VerificationResult(False, tier, "no_state_change_detected")
