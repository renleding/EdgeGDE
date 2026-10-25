# Design — Orca-to-Resolver Bridge Contract

## Context

The State Engine already exposes MCP tools (`mcp_state`, `mcp_interact`, `mcp_inspect`, `mcp_screenshot`) over
streamable HTTP on port 9110. The resolver already scores multi-strategy matches with confidence values.
The bridge adds one capability: Orca Design Mode supplies an exact `backendDOMNodeId` from a human click,
so the resolver can skip selector inference and return confidence 1.0.

## Decisions

### D1 — snake_case field names everywhere

Both payloads use snake_case. The state engine's existing JSON (`mission_id`, `run_id`, `tier_used`) is snake_case.
The Orca side is TypeScript-first and maps on the boundary. One naming rule, no per-field translation table.

### D2 — Contract errors travel in-band

The response envelope carries `error` as a field. The MCP tool call succeeds at the JSON-RPC layer.
Rationale: the caller parses one shape on every path. Retry logic branches on `error.code`, not on transport
exceptions. JSON-RPC protocol errors remain transport failures and sit outside the contract.

### D3 — Self-contained schema files

Each schema file validates standalone. No cross-file `$ref`. Rationale: TypeScript and Python implementers
copy schemas into their own tooling. External references break naive validators. The validator
(`tools/validate_examples.py`) machine-checks that `mcp-tool.json` stays deep-equal to the schema files,
so the embedded copies cannot drift.

### D4 — MCP primary, HTTP fallback, identical payloads

`mcp_resolve_element` on the existing streamable-HTTP server is the primary transport.
`POST /api/v1/resolver/resolve` on the same port is the fallback. The request body and the response envelope
are byte-identical across both. Rationale: Orca already speaks MCP. The fallback covers MCP outage without a
second payload dialect.

### D5 — Idempotency through `request_id`

The resolver caches each response keyed by `request_id` for 60 seconds. Replays return the cached envelope and
never re-execute an action. Rationale: retries are safe when the action already ran and the response was lost.
This is the load-bearing safety property for action execution over flaky local transports.

### D6 — Optional action in the same round trip

The request may carry `action`. The resolver then resolves, executes, and verifies in one call.
`action_outcome` reports dispatch tier and the verification verdict. Rationale: Design Mode pick-to-confirm needs
one round trip. Resolution-only callers omit `action` and get hints only.

### D7 — Default confidence bands, governance-owned overrides

Defaults: 1.0 exact auto-executes. 0.9–0.99 fallback auto-executes with a badge. 0.5–0.9 asks the human.
Below 0.5 never resolves. The compliance workstream records the final policy (kanban t_b1efe846).
The contract ships fields and defaults, not the policy surface.

### D8 — Deterministic structural hash

`structural_hash` is SHA-256 over `tag:index:id` segments, ancestor-nearest-first, element last, joined by `|`.
Rationale: fallback matching needs a stable fingerprint that survives attribute churn but detects structure moves.

### D9 — Portal elements capture like any node

Radix portals render under body-level roots outside the React tree. CDP still assigns them `backendDOMNodeId`
values. The capture recipe never filters by React ownership. `portal.in_portal` marks the case for the UI.

### D10 — Target pinning

`backendDOMNodeId` is meaningful only inside one CDP target. The request carries `page.target_id`.
The resolver refuses to act on any other target and reports `TARGET_NOT_ATTACHED` when it cannot attach.

## Alternatives rejected

- **Selector-only contract.** Reintroduces the guesswork the bridge exists to remove.
- **Separate blob-upload protocol for screenshots.** The data-URI cap plus `blob_ref` covers both sizes with one field.
- **WebSocket push for results.** One request, one response. Push adds nothing at this scale.
- **CamelCase fields.** Would force the Python side to translate against its own conventions.

## Migration

None. This is a new capability. No existing payload changes.
