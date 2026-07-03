# EdgeGDE Chat Reliability Overhaul — Functional Requirements Specification

**Document ID:** FRS-CHAT-RL-001  
**Version:** 1.0  
**Status:** Draft  
**Based on:** `docs/research-chat-architecture-review.md`

---

## 1. Objective

Eliminate the 5 root causes of chat unreliability identified in the architecture review. Transform the chat system from a fragile dual-state architecture into a deterministic, auditable, single-source-of-truth system aligned with EdgeGDE's three-role SDLC model.

Target outcomes:
- 100% stream completion rate (typing indicator always resolves)
- Zero silent failures (every error has a visible user-facing state)
- Single source of truth for session state (no DO/D1 drift)
- Maintainable codebase (consolidated routes, dead code removed)

---

## 2. Current Baseline

| Component | Lines | State | Issue |
|-----------|-------|-------|-------|
| `widget.js` | 350 | Deployed | No init error handling, no retry, no completion signaling |
| `chat.ts` | 904 | Deployed | Stream bypasses DO, reads D1 directly. Dead LLM path (llmFallback always true) |
| `chat-views.ts` | 550 | Deployed | HTMX server-rendered views. May overlap with chat.ts routes |
| `canvas-chat.ts` | 379 | Deployed | Separate chat routes for canvas. Potential route conflicts |
| `chat-init.ts` | 53 | Deployed | Session creation. Works correctly |
| `chat-constraint.ts` | 192 | Deployed | Deterministic field engine. Solid — no changes needed |
| `chat-session.do.ts` | 184 | Deployed | DO for session state. Not used by stream endpoint |
| `chat-processor.ts` | 265 | Deployed | Heavy processor. Dead code if LLM path is non-functional |
| `chat-scoring.ts` | 95 | Deployed | Lead scoring trigger. Works correctly |
| `chat-audit.ts` | 38 | Deployed | Audit logging. Works correctly |
| **Total** | **3,010** | | |

**Known failures:**
- Stream typing indicator never resolves (SSE prefix bug — FIXED today in widget.js)
- Chat init has no client-side error handling (silent blank screen)
- DO/D1 state can silently diverge (stream bypasses DO)
- `llmFallback:true` always set — masks real LLM failures

---

## 3. Proposed Architecture

### P1 — Widget Reliability (low effort)

```
Widget load
  ├── POST /chat/init with 5s timeout
  │     ├── Success → store sessionId, enable input
  │     └── Timeout/failure → show "Connection failed" bar + retry button
  │
  └── User types + sends
        ├── POST /chat/stream
        ├── SSE events: [event: token | event: complete | event: error]
        ├── event: token → append to responseText
        ├── event: complete → replace typing indicator with final message
        └── event: error → show error bubble, re-enable input
```

**Widget retry flow:**
```
Stream drops
  ├── Attempt 1 (0s): reconnect → POST /chat/stream with same session
  ├── Attempt 2 (2s): wait → reconnect
  └── Attempt 3 (6s): wait → reconnect
        └── All failed → show "Unable to connect" + offer to retry manually
```

### P2 — Backend Consolidation (medium effort)

```
Before (4 files, 1,886 lines):
  chat.ts        → POST/chat/init, POST/chat/stream, GET/chat/stream/:sessionId, POST/chat/tool
  chat-views.ts  → GET/admin/chat, GET/embed/chat, GET/widget.js
  canvas-chat.ts → POST/canvas/chat/... (overlapping routes)
  chat-init.ts   → POST/chat/init (imported by chat.ts)

After (2 files, ~900 lines):
  chat.ts          → All chat routes (API + views + canvas + init)
  canvas-chat.ts   → Canvas-specific chat integration only (or removed if routes merge cleanly)
```

**DO mediation:**
```
Current: Widget → POST /chat/stream → D1 read/write → SSE response
Target:  Widget → POST /chat/stream → DO.read()/DO.write() → SSE response → DO → D1 sync

The DO becomes the single point of serialization for session state.
D1 becomes a read cache / persistence layer, not an authoritative source.
```

### P3 — Resilience & Observability (medium+ effort)

```
D1 connection:
  ├── Built-in wrangler D1 batching (already available — just not used)
  └── Circuit breaker: 3 consecutive failures → 30s cooldown → degrade gracefully

State reconciliation:
  Stream completes → DO version is canonical → write to D1 with version check
  If D1 version > DO version → conflict detected → log + reconcile from DO (DO wins)

Metrics (OpenTelemetry):
  chat.stream.duration_ms     — Histogram
  chat.stream.completed       — Counter (tagged: success/error)
  chat.state.drift_detected   — Counter (alert if >0)
  chat.d1.failures            — Counter (circuit breaker)
```

---

## 4. Detailed Requirements

### P1 Requirements

| # | Requirement | Verification |
|---|-------------|-------------|
| P1.1 | Widget calls `POST /chat/init` with 5s timeout on load | Browser network tab shows init request |
| P1.2 | On init failure, widget displays a non-blocking error bar: "Connection failed" + retry button | Visual inspection after killing init endpoint |
| P1.3 | On init success, widget stores `sessionId` and enables input field | Input field is not disabled |
| P1.4 | Stream response includes an explicit `event: complete` SSE event as the final event | `curl` output shows `event: complete` as last line |
| P1.5 | Widget resolves typing indicator ONLY on `event: complete` | Typing indicator `▍▍▍` replaced by full message text |
| P1.6 | On stream drop, widget retries 3 times with exponential backoff (0s, 2s, 6s) | 3 POST requests visible in network tab |
| P1.7 | After 3 retry failures, widget shows "Unable to connect" message with manual retry option | Visual inspection |
| P1.8 | Init error bar and stream error message are themable (CSS variables) | Dark/light theme both display correctly |

### P2 Requirements

| # | Requirement | Verification |
|---|-------------|-------------|
| P2.1 | `chat.ts` contains ALL chat API routes. `chat-views.ts` and `canvas-chat.ts` routes are migrated or deleted | `grep -r "chatRouter\."` only returns one file |
| P2.2 | `POST /chat/stream` reads session state from DO via `DO.read()`, not D1 directly | Code inspection: stream handler calls DO stub |
| P2.3 | `POST /chat/stream` writes session state back to DO via `DO.write()` | Code inspection: state mutation via DO |
| P2.4 | After stream completes, DO syncs state to D1 with version check | D1 `chat_sessions` row matches DO state after stream |
| P2.5 | `llmFallback` is a per-session config flag, not hardcoded `true` | `chat-config.ts` returns `llmFallback` from tenant config |
| P2.6 | All existing endpoints maintain backward compatibility | Old URLs still return 200 |
| P2.7 | Total source lines of chat code reduces by at least 30% | `wc -l` comparison before/after |
| P2.8 | No duplicate route registrations | `wrangler deploy` succeeds without route conflict warnings |

### P3 Requirements

| # | Requirement | Verification |
|---|-------------|-------------|
| P3.1 | D1 queries within a single stream request are batched where possible | Single D1 query per stream request (verify via D1 dashboard) |
| P3.2 | Circuit breaker: 3 consecutive D1 failures → 30s cooldown → degraded mode | Simulate D1 failure, verify circuit opens |
| P3.3 | On stream completion, DO writes state to D1 with version comparison | D1 row has `version` column that increments |
| P3.4 | Conflict detection: if D1 version > DO version, log drift event and reconcile | `chat.drift_detected` counter increments |
| P3.5 | OpenTelemetry metrics are emitted for: duration, completion, drift, D1 failures | SigNoz dashboard shows 4 new metrics |
| P3.6 | No new compatibility-breaking schema changes | D1 migration is additive only |

---

## 5. Migration Strategy (zero downtime)

### Phase 1 — Widget only (no backend changes)
1. Update widget.js with init error handling and retry logic
2. Update widget.js to listen for `event: complete` SSE event
3. Test against current deployed backend (backward compatible)

### Phase 2 — Backend consolidation
1. Merge chat-views.ts routes into chat.ts
2. Merge canvas-chat.ts routes into chat.ts (or remove if dead)
3. Delete migrated files
4. Deploy and verify all endpoints work

### Phase 3 — DO mediation
1. Add `DO.read()` and `DO.write()` methods to ChatSession_DO
2. Update stream handler to use DO instead of D1
3. Add version-based state sync after stream completes
4. Deploy and monitor drift rate

### Phase 4 — Resilience
1. Add circuit breaker wrapper around D1 calls
2. Add OpenTelemetry metrics
3. Update tenant config to support `llmFallback` flag
4. Run load test

---

## 6. Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Backend consolidation breaks existing routes | Medium | High | Phase 2 migration. Test every endpoint before deleting files. CI verifies all 598 tests pass |
| DO mediation adds latency | Medium | Medium | DO read/write is sub-millisecond. D1 round-trip is 5-20ms. Net effect is neutral or better |
| Widget retry causes duplicate messages | Low | Medium | Stream idempotency: same session+text returns same result. Deduplicate on client if needed |
| State reconciliation introduces conflicts | Low | Low | DO always wins. Version check prevents data loss |
| Circuit breaker degrades UX under load | Low | Medium | Degraded mode shows clear error message. User can retry manually |

---

## 7. Acceptance Criteria (summary)

1. ✅ Widget shows error state on init failure (P1)
2. ✅ Widget retries stream drops 3x with backoff (P1)
3. ✅ Stream sends explicit `event: complete` (P1)
4. ✅ Chat routes consolidated to ≤2 files (P2)
5. ✅ Stream reads from DO, not D1 directly (P2)
6. ✅ llmFallback pulled from session config (P2)
7. ✅ D1 circuit breaker activates after 3 failures (P3)
8. ✅ State drift detected and reconciled (P3)
9. ✅ 4 OpenTelemetry metrics emitted (P3)
10. ✅ All 598 existing tests pass (P1-P3)
11. ✅ Zero typecheck errors (P1-P3)
