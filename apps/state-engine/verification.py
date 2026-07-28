"""Verification — rule-based per-action success detection."""
import logging
from enum import Enum
from typing import Optional
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
        self._rules = {
            ActionType.CLICK: self._verify_click,
            ActionType.TYPE: self._verify_type,
            ActionType.SELECT: self._verify_select,
            ActionType.SAVE: self._verify_save,
            ActionType.NAVIGATE: self._verify_navigate,
        }

    def verify(self, action_type: ActionType, diff: StateDiff, 
               tier: str = "") -> VerificationResult:
        rule = self._rules.get(action_type)
        if not rule:
            return VerificationResult(False, tier, f"No rule for {action_type}")
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

    def _verify_save(self, diff: StateDiff, tier: str) -> VerificationResult:
        if diff.url_changed():
            return VerificationResult(True, tier, "URL changed (navigation)")
        if diff.toast_appeared():
            return VerificationResult(True, tier, "Toast appeared: " + 
                str(diff.changes.get('toast', {}).get('to', '')))
        if diff.errors_appeared():
            return VerificationResult(False, tier, "Error appeared: " + 
                str(diff.changes.get('errors', {}).get('to', [])))
        return VerificationResult(False, tier, "no_state_change_detected")

    def _verify_navigate(self, diff: StateDiff, tier: str) -> VerificationResult:
        if diff.url_changed():
            return VerificationResult(True, tier, "URL changed")
        return VerificationResult(False, tier, "no_state_change_detected")
