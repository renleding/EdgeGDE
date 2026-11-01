# Tasks — Automation Bridge-to-Resolver Bridge Contract

## Phase 0: Publish the contract (this change)

- [x] `packages/automation-bridge/schemas/automation-bridge-request.schema.json` — capture request schema v2.0.0
- [x] `packages/automation-bridge/schemas/automation-bridge-response.schema.json` — resolution response schema v2.0.0
- [x] `packages/automation-bridge/schemas/automation-bridge-error.schema.json` — standalone error envelope
- [x] `packages/automation-bridge/schemas/error-codes.json` — error registry with retry ladders
- [x] `packages/automation-bridge/mcp-tool.json` — `mcp_resolve_element` definition plus HTTP fallback declaration
- [x] `packages/automation-bridge/examples/` — positive and negative example payloads
- [x] `packages/automation-bridge/tools/validate_examples.py` — schema validation plus cross-artifact consistency
- [x] `docs/IDD-016-automation-bridge-v1.md` — the frozen contract document

## Phase 1: Hermes resolver side (kanban t_7363056a)

- [ ] Register `mcp_resolve_element` on the state engine MCP server
- [ ] Add `POST /api/v1/resolver/resolve` with identical payload handling
- [ ] Validate requests. Map violations to `INVALID_REQUEST` with `validation_errors`
- [ ] Implement the exact `backendDOMNodeId` fast path. Confidence exactly 1.0
- [ ] Implement stale-node structural fallback with `fallback_match` metadata. Floor at 0.5
- [ ] Attach known-bug flags and workarounds from the registry
- [ ] Implement `request_id` response cache with 60s TTL
- [ ] Map failures to the error registry. Honor `timeout_ms`

## Phase 2: Automation Bridge capture side (kanban t_4242d4b7)

- [ ] Design Mode toggle and click-to-pick overlay. T0.5 tier classification
- [ ] CDP capture recipe per IDD-016 §6.2, including portal elements
- [ ] `structural_hash` computation per §6.5. Caps per §6.6
- [ ] MCP client for `mcp_resolve_element`
- [ ] HTTP fallback with failover per §5.3
- [ ] UI surfacing of confidence, fallback metadata, bug flags, and verdicts

## Phase 3: Action and verification wiring (kanban t_466ce83a)

- [ ] Map `action` plus `action_hints` to Action Engine primitives
- [ ] Apply known-bug workarounds before dispatch
- [ ] Verification Engine state-diff verdict per IDD-016 §7.5
- [ ] Structured outcome with diff summary and verdict

## Phase 4: Governance (kanban t_b1efe846)

- [ ] CI gate: bridge payloads validate against this contract's schemas
- [ ] CI gate: resolutions carry known-bug flags when applicable
- [ ] CI gate: actions without verification verdicts fail
- [ ] Registry intake runbook with the initial three entries

## Phase 5: Visual confirmation loop (kanban t_f86d149b)

- [ ] Hot-reload after action completion
- [ ] Before/after comparison with verdict and diff evidence

## Verification

- `cd packages/automation-bridge && python3 tools/validate_examples.py` exits 0
- `openspec validate automation-bridge-contract` passes
- ste-lint reports 0 hard violations on `docs/IDD-016-automation-bridge-v1.md`