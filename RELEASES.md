# EdgeGDE Releases

## edge-runtime v0.9.3-chat-stream-deterministic

Release candidate for the deterministic chat stream hotfix.

### Scope

- `src/api/chat.ts`
  - chat stream now emits deterministic session state without waiting on external OpenRouter SSE,
  - runtime health no longer depends on provider latency,
  - field extraction/state logic remains authoritative.

- `src/api/admin-rules.ts`
  - create/update now validate deterministic rule condition syntax before persistence.

- `src/lib/rule-engine.ts`
  - added `validateConditionSyntax(...)` with tokenizer-level grammar checks.

- Tests
  - admin KV/DB mocks aligned with runtime behavior,
  - rule syntax validation coverage added,
  - chat constraint/schema tests tightened around required fields.

### Verification completed

- `npm run typecheck` — passed
- `npx eslint . --quiet` — passed
- `npm test` — passed
- `wrangler deploy --dry-run` — passed
- `git diff --check` — passed
- production chat health check — passed

### Production deployment

- Worker version: `0.9.3-chat-stream-deterministic`
- Deployed version ID: `694f9483-03c0-4b79-897b-f83396689ff4`
- Health check result: `ALL TESTS PASSED`

### Notes

This release marker intentionally creates a non-empty PR/CI source from the clean release branch.
