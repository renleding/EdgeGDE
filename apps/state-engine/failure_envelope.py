"""Failure Envelope — structured error with page context."""
from typing import Any, Optional

class FailureEnvelope:
    def __init__(self, tier: str, action: str, reason: str, 
                 page_state: Optional[dict] = None,
                 errors_on_page: Optional[list] = None,
                 active_dialog: Optional[str] = None,
                 buttons_found: Optional[list] = None,
                 verification_result: Optional[dict] = None):
        self.tier = tier
        self.action = action
        self.reason = reason
        self.page_state = page_state or {}
        self.errors_on_page = errors_on_page or []
        self.active_dialog = active_dialog
        self.buttons_found = buttons_found or []
        self.verification_result = verification_result or {}

    def to_dict(self) -> dict:
        return {
            'tier': self.tier,
            'action': self.action,
            'reason': self.reason,
            'page_state': self.page_state,
            'errors_on_page': self.errors_on_page,
            'active_dialog': self.active_dialog,
            'buttons_found': self.buttons_found,
            'verification_result': self.verification_result,
        }
