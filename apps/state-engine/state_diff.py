"""State Diff — structured before/after comparison."""
import json, logging
from typing import Any

logger = logging.getLogger('state-engine.diff')

class StateDiff:
    def __init__(self, before: dict, after: dict):
        self.before = before
        self.after = after
        self._compute()

    def _compute(self):
        self.changes = {}
        for key in set(list(self.before.keys()) + list(self.after.keys())):
            if self.before.get(key) != self.after.get(key):
                self.changes[key] = {
                    'from': self.before.get(key),
                    'to': self.after.get(key)
                }

    def has_changed(self) -> bool:
        return len(self.changes) > 0

    def url_changed(self) -> bool:
        return 'url' in self.changes

    def buttons_changed(self) -> bool:
        return 'buttons' in self.changes

    def errors_appeared(self) -> bool:
        if 'errors' not in self.changes:
            return False
        return len(self.after.get('errors', [])) > 0

    def toast_appeared(self) -> bool:
        return 'toast' in self.changes and self.after.get('toast')

    def summary(self) -> dict:
        return {
            'has_changed': self.has_changed(),
            'change_count': len(self.changes),
            'keys_changed': list(self.changes.keys()),
            'url_changed': self.url_changed(),
            'errors_appeared': self.errors_appeared(),
            'toast_appeared': self.toast_appeared(),
        }
