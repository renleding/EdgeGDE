# Tamper-Proof Audit Storage — Implementation Spec (EG-SEC-0002)

## Problem

Current audit logs are JSON files under `.hermes/logs/missions/`. These can be
modified or deleted — no cryptographic integrity guarantee. NIST AI RMF
recommends tamper-proof audit trails for AI governance.

## Solution: Hash-Chained Append-Only Audit Log

### Phase 1: File-Level Hash Chaining (0.5 day)

Add a hash chain to the existing JSON report files.

```python
# Every report includes:
{
    "mission_id": "...",
    "timestamp": "...",
    "previous_mission_hash": "sha256-of-previous-report",
    "mission_hash": "sha256-of-this-report(excluding previous_mission_hash)",
    "chain": [
        {"mission_id": "a", "hash": "abc123"},
        {"mission_id": "b", "hash": "def456"},
    ]
}
```

New field: `previous_mission_hash` links each report to the previous one.
New field: `mission_hash` is the SHA-256 of the canonical report content.
Periodically anchor the chain head hash to a durable store (D1, KV, or file).

### Phase 2: Durable Object Integration (2-3 days)

Migrate from file-based logs to the existing `AuditLedger_DO` Durable Object:

1. Extend AuditLedger_DO to accept governance audit events (not just canvas)
2. Each event: `{type, payload, checksum, previous_event_hash}`
3. DO guarantees append-only (no deletes, no updates)
4. DO storage persists across Worker restarts
5. Query: `GET /audit/chain` returns the full hash chain
6. Verify: `GET /audit/verify/{event_id}` recomputes and checks hash integrity

### Phase 3: External Anchoring (Future)

- Periodically write the chain head hash to a public transparency log
- Or emit to a separate append-only service (SigNoz log stream with hash anchoring)

## Implementation Priority

1. Phase 1 is file-level and can be done without Cloudflare Worker changes
2. Phase 2 needs the existing edge-runtime codebase (AuditLedger_DO)
3. Phase 3 is future work

## Verification

- [ ] `python3 tools/audit_verify.py` passes: all reports have valid hashes
- [ ] Tampering with a report file causes hash chain break
- [ ] DO append-only invariant enforced (no deletes)
