"""
fact_registry_api.py — Exposes FRS-006 Fact Registry and Contradiction
Engine to the orchestration layer (ActionEngine, WorkflowEngine).

All methods accept an optional EvidenceAdapter instance. If none is
provided, returns safe defaults — the system degrades gracefully when
the Evidence Engine is not initialized.
"""

import logging
from typing import Optional

logger = logging.getLogger('state-engine.fact-registry')


class FactRegistryAPI:
    """Stateless API that wraps EvidenceAdapter for agent decision-making.

    Injected into ActionEngine and WorkflowEngine at construction time.
    """

    def __init__(self, adapter=None):
        self._adapter = adapter

    # ── Fact Queries ──

    def get_fact(self, key: str) -> Optional[dict]:
        """Retrieve a verified fact. Returns None if not found or engine off."""
        if not self._adapter:
            return None
        return self._adapter.get_fact(key)

    def get_confidence(self, key: str) -> str:
        """Get confidence level for a fact. Returns 'unknown' if not found."""
        f = self.get_fact(key)
        if f:
            return f.get('confidence', 'unknown')
        return 'unknown'

    def is_confirmed(self, key: str) -> bool:
        """Check if a fact is confirmed or strongly_confirmed."""
        return self.get_confidence(key) in ('confirmed', 'strongly_confirmed')

    def all_facts(self) -> list:
        """List all known facts (simplified for agent consumption)."""
        if not self._adapter:
            return []
        import sqlite3
        try:
            cur = self._adapter._require_open().execute(
                "SELECT key, value, confidence, evidence_count FROM facts ORDER BY key"
            )
            return [dict(row) for row in cur.fetchall()]
        except Exception as e:
            logger.warning("all_facts query failed: %s", e)
            return []

    # ── Contradiction Engine ──

    def is_blocked(self, hypothesis: str) -> bool:
        """Check if a recovery strategy or theory is disproven. O(1) cache.

        Usage in ActionEngine tier selection:
            if reg.is_blocked('fiber_manipulation_required'):
                skip T4 (REACT tier) — already disproven
        """
        if not self._adapter:
            return False
        return self._adapter.is_path_blocked(hypothesis)

    def blocked_paths(self) -> list:
        """Return all currently disproven hypotheses."""
        if not self._adapter:
            return []
        return self._adapter.get_blocked_paths()

    def reject_blocked_recovery(self, candidate_strategies: list) -> list:
        """Filter a list of recovery strategy names, removing any that
        are in the contradiction cache. Returns accepted strategies only.

        Example:
            strategies = ['retry_cdp', 'fiber_manipulation', 'event_interceptor']
            reg.reject_blocked_recovery(strategies)
            # -> ['retry_cdp']  # the other two are disproven
        """
        if not self._adapter:
            return candidate_strategies
        return [
            s for s in candidate_strategies
            if not self._adapter.is_path_blocked(s)
        ]

    # ── Fact Challenge ──

    def challenge_fact(self, fact_key: str, severity: str = 'MEDIUM') -> Optional[str]:
        """Open a fact challenge when telemetry contradicts a confirmed fact."""
        if not self._adapter:
            return None
        fact = self._adapter.get_fact(fact_key)
        if not fact:
            return None
        return self._adapter.open_fact_challenge(fact['fact_id'], severity)

    # ── Health ──

    def is_available(self) -> bool:
        return self._adapter is not None

    def health(self) -> dict:
        if not self._adapter:
            return {'available': False}
        return {
            'available': True,
            'facts': len(self._adapter._fact_cache) if hasattr(self._adapter, '_fact_cache') else 0,
            'contradictions': len(self._adapter._contradiction_cache) if hasattr(self._adapter, '_contradiction_cache') else 0,
        }
