# Interface Design Document (IDD): AFIRMICO Auto — Distributed Apply Queue

**Document ID:** IDD-015  
**Version:** 1.0  
**Status:** Draft  
**Author:** Hermes (Director)  
**Date:** 2026-10-13  
**Spec:** FRS-010 v3.0 — FEATURE-16 (F16-R01..R08, F16-N01..N03)  
**Design:** SDD-011 v1.3 §3.7, §7.1  
**Implements:** Cloudflare Queues consumer for the FEATURE-12 apply sweep at 50k–200k vehicle scale

---

## 1. Purpose

The FEATURE-12 apply sweep (F12-N04) drains `config_apply_queue` from a
single `*/5 * * * *` cron consumer at `MAX_BATCH_SIZE=50` — ~600 vehicles/hour.
That covers a 1,000-vehicle fleet but cannot cover 50k–200k: at that rate
50k vehicles take ~17 days and 200k take ~69 days.

This IDD specifies the Cloudflare Queues interface that replaces the single
consumer with an N-consumer fan-out while preserving the canary contract
(F12-R07/R08/R09).

## 2. Queue: `apply-queue`

```yaml
# wrangler.json (deployment config, F16-R02)
queues:
  producers:
    - queue: apply-queue
      binding: APPLY_QUEUE
  consumers:
    - queue: apply-queue
      max_batch_size: 100      # F16-R07: capped per invocation
      max_batch_timeout: 5     # seconds
      max_retries: 3           # F16-R05
      dead_letter_queue: apply-dlq
# consumer parallelism: deployment setting (F16-R02), default 20
```

## 3. Message shape

```json
{
  "run_id": "apply_1729..._abc123",
  "vin": "LRW3F7ET1SC584656",
  "position": 0,
  "scope_kind": "global"
}
```

| Field | Type | Meaning |
|-------|------|---------|
| `run_id` | string | `config_apply_run.run_id` — groups all VINs of one apply |
| `vin` | string | the vehicle to configure |
| `position` | integer | rollout order within the run; **0 = canary** |
| `scope_kind` | string | `global \| group \| vehicle` — for run-status lookup |

The message does NOT carry the resolved config or the member token: the
consumer reads `config_json` from `config_apply_queue` (F16-R06 — tokens
are resolved at processing time).

## 4. Consumer algorithm (`src/apply-queue-consumer.ts`)

```
consume(batch: Message[]):
  for msg in batch:
    run  = SELECT * FROM config_apply_run WHERE run_id = msg.run_id
    if run.status IN ('halted', 'canary_failed'):
      msg.ack(); UPDATE config_apply_queue SET status='halted' WHERE vin=msg.vin AND run_id=msg.run_id
      continue

    item = SELECT * FROM config_apply_queue WHERE run_id=msg.run_id AND vin=msg.vin
    UPDATE config_apply_queue SET status='in_progress', attempts=attempts+1 WHERE queue_id=item.queue_id

    resolved = JSON.parse(item.config_json)
    memberToken = getMemberAccessToken(env, memberIdOf(msg.vin))
    if !memberToken:
      fail(item, 'no_member_access_token'); msg.ack(); continue

    result = applyVehicleConfig(msg.vin, resolved, signerUrl, memberToken, signerSharedSecret)
    recordOutcome(db, msg.run_id, result)

    if item.position == 0 && run.canary_vin == msg.vin:        // the canary
      if result.outcome != 'applied':
        haltRun(msg.run_id, `canary POST failed: ${result.error_detail}`)
        fail(item, 'canary_post_failed'); msg.ack(); continue
      verified = verifyAdoption(msg.vin, ...)
      if !verified.verified:
        haltRun(msg.run_id, `canary verification failed: ${verified.reason}`)
        fail(item, 'canary_verification_failed'); msg.ack(); continue
      UPDATE config_apply_run SET status='rolling', canary_state='verified' WHERE run_id=msg.run_id
      result.outcome = 'verified'; recordOutcome(db, msg.run_id, result)

    else if result.outcome == 'applied':                          // rollout VIN
      verified = verifyAdoption(msg.vin, ...)
      result.outcome = verified.verified ? 'verified' : 'failed'
      result.error_detail = verified.reason
      recordOutcome(db, msg.run_id, result)

    UPDATE config_apply_queue SET status='done' WHERE queue_id=item.queue_id
    msg.ack()

  finalizeRuns(batch)   // any run with no pending/in_progress rows → completed
```

## 5. Error taxonomy (F16-R05)

| Error class | Examples | Retry? | DLQ? |
|-------------|----------|--------|------|
| Transient | Tesla 5xx, network timeout, token exchange hiccup | Yes — 3× at 5/15/60 min | After 3× |
| Permanent | 4xx, invalid VIN, revoked refresh token, `no_member_access_token` | No | Immediately |
| Canary failure | POST succeeded but verification failed | No (run halts) | No — run marked `halted`, remaining messages ack as `halted` |

## 6. Dead-letter queue: `apply-dlq`

```sql
-- migration 0024_config_apply_dead_letter.sql
CREATE TABLE config_apply_dead_letter (
  dl_id        INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id       TEXT NOT NULL,
  vin          TEXT NOT NULL,
  attempts     INTEGER NOT NULL,
  error_detail TEXT NOT NULL,
  message_json TEXT NOT NULL,       -- the original queue message
  dead_at      TEXT NOT NULL
);
```

Bounded at 10,000 rows (F16-N03); a non-empty DLQ raises an operator alert
via the existing alerting path.

## 7. Invariants

1. **Canary-first (F16-R03):** the consumer processes a run's position-0
   message before any other position of that run. Because Cloudflare Queues
   does not guarantee cross-message ordering, the consumer enforces this by
   checking `config_apply_run.status` before applying — a run not yet
   `rolling` has not passed its canary, so only the position-0 message is
   applied and other positions wait for their next delivery attempt.
2. **Halt propagation:** a halted run's pending messages acknowledge as
   `halted` on delivery — no vehicle past the canary is touched.
3. **Progress from D1 (F16-R04):** every message processed writes
   `config_apply_outcome` and updates `config_apply_queue`.
4. **Idempotency (F16-R08):** the (run_id, vin) key makes duplicate
   delivery safe; the second write is a no-op update of the same row.
5. **Per-invocation bound (F16-R07):** a consumer invocation never applies
   more than `max_batch_size` vehicles; per-VIN work is O(fields).

## 8. Non-goals

- Telemetry ingest (F14) — per-payload, no fleet loop.
- Export (F13) — per-schedule-row cron, no fleet loop.
- Durable Object coordination — not needed at 20 consumers; revisit if
  consumer count exceeds ~50 or cross-run ordering becomes a requirement.
