# Intent Driven Design (IDD): Orca Design Mode to State Engine Resolver Bridge

**Document ID:** IDD-016  \
**Version:** 1.0.0  \
**Status:** Frozen  \
**Author:** Hermes (Director)  \
**Date:** 2026-10-26  \
**FRS Reference:** FRS-005 State Engine MCP (Hermes state engine)  \
**Kanban Reference:** ORCA-07 (t_6abd576c), contract task t_08bde3be  \
**OpenSpec Change:** [orca-resolver-bridge-contract](../openspec/changes/orca-resolver-bridge-contract/)  \
**Schema Package:** `@edgegde/orca-resolver-bridge` (`packages/orca-resolver-bridge/`)

---

## 1. Purpose

This document freezes the integration contract between Orca Design Mode and the Hermes State Engine Resolver.
Orca captures a clicked element. The resolver resolves it against the live page.
Both workstreams build from this document and the schema package in parallel.
Neither workstream needs further clarification.

The bridge makes Design Mode a visual element picker. The picker supplies an exact `backendDOMNodeId`.
The resolver returns confidence 1.0 on that handle. Selector guesswork disappears.

## 2. Scope

**In scope:**

- The versioned capture request payload.
- The resolution response payload, including fallback match metadata.
- Optional action execution with state-diff verification in one round trip.
- The MCP tool definition and the direct-call HTTP fallback.
- Error codes, retry semantics, and idempotency.
- Known-bug flag attachment.

**Out of scope:**

- The Design Mode overlay UI itself (kanban t_4242d4b7).
- Resolver internals beyond the documented fast path and fallback (kanban t_7363056a).
- Action Engine tier selection logic (kanban t_466ce83a).
- The hot-reload confirmation loop (kanban t_f86d149b).
- Known-bug registry governance and intake (kanban t_b1efe846).

## 3. Artifacts and locations

All paths are relative to the EdgeGDE repo root.

| Artifact | Path |
|---|---|
| Contract document (this file) | `docs/IDD-016-orca-resolver-bridge-v1.md` |
| Request schema | `packages/orca-resolver-bridge/schemas/orca-resolver-request.schema.json` |
| Response schema | `packages/orca-resolver-bridge/schemas/orca-resolver-response.schema.json` |
| Error envelope schema | `packages/orca-resolver-bridge/schemas/orca-resolver-error.schema.json` |
| Error code registry | `packages/orca-resolver-bridge/schemas/error-codes.json` |
| MCP tool definition | `packages/orca-resolver-bridge/mcp-tool.json` |
| Example payloads | `packages/orca-resolver-bridge/examples/` |
| Validator | `packages/orca-resolver-bridge/tools/validate_examples.py` |

The schemas are the source of truth for field shapes. This document is the source of truth for semantics.
Where they disagree, the schemas win for structure and this document wins for behavior. File a contract bug.

## 4. Versioning rules

- The contract version is `1.0.0`. Every payload carries `schema_version: "1.0.0"`.
- Additive optional fields are a minor bump. Both sides tolerate unknown fields on read.
- Type changes, renames, removals, and new required fields are a major bump.
- The resolver rejects a request whose `schema_version` major differs from its own.
- The rejection code is `UNSUPPORTED_SCHEMA_VERSION`.
- Schemas use JSON Schema draft 2020-12. Field names are snake_case. Enum values are snake_case.

## 5. Transport

### 5.1 Primary: MCP tool

- Tool name: `mcp_resolve_element`.
- Transport: MCP streamable HTTP at `http://127.0.0.1:{STATE_ENGINE_PORT}/mcp`.
- Default port: `9110`. Override with the `STATE_ENGINE_PORT` environment variable.
- Tool arguments: the request object from §6, passed as a single structured argument set.
- Tool result: `content[0].text` holds the JSON response envelope from §7.
- Contract errors arrive in-band inside the envelope. The tool call itself succeeds.
- JSON-RPC protocol errors are transport failures. They sit outside this contract.
- The canonical tool definition is `packages/orca-resolver-bridge/mcp-tool.json`.

### 5.2 Fallback: direct HTTP call

- Method and path: `POST /api/v1/resolver/resolve`.
- Base URL: `http://127.0.0.1:{STATE_ENGINE_PORT}`.
- Headers: `Content-Type: application/json` and `X-Orca-Bridge-Version: 1.0.0`.
- Request body: the request object, byte-identical to the MCP arguments.
- Success: HTTP 200 with the response envelope.
- Contract errors: HTTP status from `error-codes.json`, body is the same envelope with `error` set.
- Connect timeout: 2000 ms. Read timeout: `request.timeout_ms` plus 5000 ms grace.

The payloads are identical across both transports. No transport-specific field exists.

### 5.3 Failover rules

1. Orca MUST try the MCP tool first.
2. Orca switches to HTTP when MCP connect fails, MCP times out at 2000 ms, or MCP returns a protocol error.
3. Orca synthesizes `RESOLVER_UNREACHABLE` locally when both transports fail.
4. One transport serves one request. Never mix transports mid-request.
5. Transport retries use the `RESOLVER_UNREACHABLE` ladder: 5000, 15000, 25000, 60000 ms.
6. Transport retries stop after 4 attempts. The caller surfaces the failure.

## 6. Request contract

### 6.1 Envelope fields

| Field | Type | Required | Rule |
|---|---|---|---|
| `schema_version` | const `"1.0.0"` | yes | Contract version. |
| `request_id` | uuid string | yes | Caller-generated UUIDv4. Idempotency key. |
| `captured_at` | date-time | yes | Capture instant, UTC. |
| `timeout_ms` | integer 1000–30000 | no | Default 10000. Budget for resolve plus optional action. |
| `page` | object | yes | See below. |
| `element` | object | yes | See §6.2–§6.6. |
| `action` | object | no | Intended operation. See §7.5. |
| `context` | object | no | `app`, `locale`, `hints`. Hints are never authoritative. |

`page` fields: `url` (uri, required), `target_id` (CDP `Target.targetId`, required), `title` (optional),
`frame_id` (CDP `Page.frameId`, optional, main frame when omitted), `viewport` (`width`, `height`, required),
`device_pixel_ratio` (optional).

The `backendDOMNodeId` is only meaningful inside `page.target_id`. The resolver MUST resolve within that target.

### 6.2 Element capture recipe (Orca side)

Capture runs in the Design Mode click handler, inside the target page. Use raw CDP, not a WebDriver evaluate wrapper.
`page.evaluate` strips React internals. Raw CDP `Runtime.evaluate` preserves them.

1. Fetch the element handle from the click event target, or `document.elementFromPoint(x, y)`.
2. `DOM.requestNode` with the `RemoteObjectId` returns the `nodeId`.
3. `DOM.describeNode` with the `nodeId` returns `backendNodeId`. Store it as `backend_dom_node_id`.
4. `DOM.getOuterHTML` returns the subtree string for `dom_snapshot.outer_html`.
5. `CSS.getComputedStyle` returns computed styles. Copy exactly the 10 keys from §6.3.
6. `DOM.getBoxModel` or `DOM.getContentQuads` returns geometry. Collapse to the first quad.
7. `Page.captureScreenshot` with a clip of the element bounds returns the screenshot bytes.

Capture portal elements the same way. Radix portals attach to body-level roots outside the React tree.
The clicked node still has a valid `backendDOMNodeId`. Never restrict capture to the React root subtree.
Set `portal.in_portal` true when an ancestor matches `[data-radix-portal]` or a known portal root.
Supply `portal.portal_root_hint` as a selector hint when true.

Capture MUST NOT mutate the page. No attribute injection. No leftover overlay scripts.

### 6.3 Computed styles subset

Exactly these 10 keys, kebab-case as CDP returns them. Values are raw strings.

| Key | Purpose |
|---|---|
| `display` | Overlay and portal detection. |
| `visibility` | Interactability. |
| `opacity` | Interactability. |
| `pointer-events` | Click interception detection. |
| `cursor` | Affordance hint. |
| `color` | Visual fallback matching. |
| `background-color` | Visual fallback matching. |
| `font-size` | Visual fallback matching. |
| `font-weight` | Visual fallback matching. |
| `text-align` | Visual fallback matching. |

The schema rejects requests with missing or extra style keys. This subset is frozen for v1.

### 6.4 Screenshot rules

- `storage` is `data_uri` or `blob_ref`.
- `data_uri` embeds a base64 PNG or JPEG clip. Maximum 4000000 characters.
- Beyond the cap, store the blob caller-side and send `blob_ref` with `blob_id`.
- `blob_url` and `blob_expires_at` are optional fetch hints.
- `mime_type` is `image/png` or `image/jpeg`.
- `width` and `height` are the clip pixel dimensions.
- `sha256` is the hex digest of the raw image bytes.

### 6.5 Structural hash canonicalization

`dom_snapshot.structural_hash` locates the element after page mutation. Canonical string rules:

1. Take `ancestor_path` segments, nearest ancestor first, then the element itself as the final segment.
2. Each segment is `tag:index:id`. The `id` is empty when absent.
3. Join segments with `|`. Hash the UTF-8 string with SHA-256. Lowercase hex.

`ancestor_path` entries carry `tag`, 1-based `index` among same-tag siblings, optional `id`, optional `classes`.
The array holds at most 8 entries and ends at `html`.

### 6.6 Caps and truncation

- `outer_html` caps at 200000 characters. Truncate at the last complete tag. Set `truncated: true`.
- `text_content` caps at 2000 characters.
- `action.value` caps at 100000 characters.
- The data-URI cap lives in §6.4.

## 7. Response contract

### 7.1 Envelope

Every response carries `schema_version`, `request_id`, `resolved_at`, and `resolver`.
The envelope carries either `resolution` or `error`, never both. `warnings` holds non-fatal notes.
The schema enforces this exclusion.

`resolver` reports `version`, `latency_ms`, `node_live`, and `target_id`. `target_id` must equal the request target.

### 7.2 Exact fast path

When `backend_dom_node_id` is live in `page.target_id`:

- `resolution_path` is `exact_backend_node`.
- `confidence` is exactly `1.0`.
- `strategy` is `backend_node_exact`.
- `resolver.node_live` is `true`.
- `element_ref.backend_dom_node_id` equals the requested id.
- No selector inference runs on this path.

### 7.3 Stale-node fallback

When the requested node id no longer resolves:

1. The resolver scores candidates from the state cache snapshot.
2. Signals are DOM structure (`ancestor_path`, `structural_hash`, tag, attributes), the computed styles subset, geometry, and text content.
3. The weighted score becomes `confidence`.
4. `resolution_path` is `fallback_structural` and `strategy` is `structural_styles_match`.
5. `resolver.node_live` is `false`.
6. `element_ref.backend_dom_node_id` is the freshly fetched live handle, which differs from the request.
7. `fallback_match` reports `matched_on`, `match_score` (0.5–0.99), `differences`, `candidate_count`, and `candidate_refs`.
8. `confidence` never reaches 1.0 on this path.

When no candidate reaches the 0.5 floor, the resolver returns error `ELEMENT_NOT_RESOLVABLE`
with the best candidate in `details`. It never returns a sub-floor resolution as success.

### 7.4 Confidence and element reference

- `confidence` ranges over [0, 1].
- `element_ref.selector` is a human-readable hint. The Action Engine MUST NOT depend on it.
- Execution addresses `element_ref.backend_dom_node_id` within `element_ref.target_id` and `frame_id`.
- The resolver includes `ax_node_id` when the accessibility tree exposes the node.

### 7.5 Action outcome and verification

When the request carries `action`, the resolver resolves, executes, and verifies in one call.

- `action_outcome.requested_action` echoes the request.
- `action_outcome.executed` reports dispatch. `action_tier` names the tier that dispatched.
- Execution tiers are `REACT`, `CDP`, `KEY`, `JS`, `AX`, `OS`.
- `verification.verified` is true only when the state-diff shows the change.
- `verification.verdict` is `verified`, `no_state_change`, `false_positive_detected`, or `not_verified`.
- A dispatched action with unchanged state reports `no_state_change` with `verified: false`.
- The known false-positive save toast never counts as proof. The guard id is `false_positive_save`.

When resolution succeeds but the resolver declines the action, the response is a success envelope.
`action_outcome.rejection` carries `code: "ACTION_REJECTED"`, a `reason_code`, and the reason.
Reason codes: `confidence_below_policy`, `element_type_incompatible`, `known_bug_no_workaround`, `element_not_interactable`.

## 8. Confidence policy

Defaults at contract freeze. The governance workstream (kanban t_b1efe846) owns overrides.

| Confidence | Path | Policy |
|---|---|---|
| exactly 1.0 | exact_backend_node | Auto-execute permitted. |
| 0.9–0.99 | fallback_structural | Auto-execute permitted. Orca surfaces a fallback badge. |
| 0.5–0.9 | fallback_structural | Human approval before execution. |
| below 0.5 | none | Not returned as a resolution. `ELEMENT_NOT_RESOLVABLE` instead. |

Design Mode picks classify as the T0.5 tier in the sensory array.

## 9. Known-bug flags

- `resolution.known_bug_flags` lists applicable registry ids.
- `resolution.known_bug_workarounds` gives one entry per flag with `bug_id`, `workaround`, `applied`, and optional `reason`.
- Initial ids, aligned with `apps/state-engine/salestrekker_rules.py`:
  - `radix_portal_block`: CDP mouse events intercepted by the Radix portal overlay. Workaround: KEY tier selection.
  - `react_props_fallback`: Save button lacks `__reactProps$` in some builds. Workaround: bubbling dispatch or `b.click()`.
  - `false_positive_save`: success toast without persistence. Workaround: require URL change or network proof.
- Resolution-time workarounds set `applied: true`. Execution-time and verification-time workarounds set `applied: false`
  with a `reason` naming the enforcing component.
- The compliance workstream (kanban t_b1efe846) governs the registry schema and intake process. This contract consumes ids only.

## 10. Error codes and retry semantics

### 10.1 Registry

Machine-readable form: `packages/orca-resolver-bridge/schemas/error-codes.json`.

| Code | HTTP | Retryable | Policy | Ladder (ms) | Caller action |
|---|---|---|---|---|---|
| `STALE_NODE` | 409 | no | recapture | — | Recapture. New `request_id`. One resend. |
| `ELEMENT_NOT_RESOLVABLE` | 422 | no | none | — | Human re-pick. Show candidates. |
| `RESOLVER_TIMEOUT` | 504 | yes | backoff | 1000, 3000 | Same `request_id`. Max 2 retries. |
| `ACTION_REJECTED` | 422 | no | none | — | Change action or apply workaround. |
| `INVALID_REQUEST` | 400 | no | none | — | Fix payload. See `validation_errors`. |
| `UNSUPPORTED_SCHEMA_VERSION` | 400 | no | none | — | Upgrade contract version. |
| `TARGET_NOT_ATTACHED` | 409 | yes | reattach | 250 | Retry once after reattach. |
| `RESOLVER_UNREACHABLE` | — | yes | backoff | 5000, 15000, 25000, 60000 | Transport ladder. Max 4 retries. |
| `INTERNAL_ERROR` | 500 | yes | backoff | 2000 | Retry once. File issue with `request_id`. |

The four contract-mandated codes are `STALE_NODE`, `ELEMENT_NOT_RESOLVABLE`, `RESOLVER_TIMEOUT`, `ACTION_REJECTED`.

`STALE_NODE` fires only when the node is stale AND structural fallback also fails. A stale node with a successful
fallback match is a success response, not an error.

The caller synthesizes `RESOLVER_UNREACHABLE`. The resolver never emits it.

### 10.2 Retry rules

- Retry only when `retryable` is true. Never retry deterministic failures.
- Backoff ladders are per code. One ladder entry per attempt.
- Reuse the same `request_id` across retries. Idempotency depends on it.
- `STALE_NODE` requires a fresh capture. The old node id is dead.
- `ACTION_REJECTED` requires a different action or a workaround. Retrying changes nothing.

### 10.3 Idempotency

- The resolver caches each response keyed by `request_id` for 60 seconds.
- A replayed `request_id` returns the cached envelope byte-for-byte.
- An action executes at most once per `request_id`. A lost response never triggers a second execution.
- A recaptured element is a new request. It receives a new `request_id`.

## 11. Invariants

1. The resolver never reports confidence 1.0 without a live `backendDOMNodeId` resolution.
2. The resolver never executes an action below confidence 0.5.
3. The resolver never re-executes an action for a replayed `request_id`.
4. Neither side adds fields outside the schemas within a contract version.
5. The caller never embeds a data-URI screenshot above 4000000 characters.
6. The resolver never treats `context.hints` as authoritative.
7. Neither side treats selector presence as success. The verification verdict governs.
8. The caller never auto-retries a non-retryable code.
9. The capture path never mutates the page.
10. The resolver never returns a resolution and an error in one envelope.

## 12. Validation

Run from the repo root:

```sh
cd packages/orca-resolver-bridge
python3 tools/validate_examples.py
```

The validator proves:

- Every valid example passes its schema.
- The validator rejects every negative example.
- `mcp-tool.json` matches the schema files with deep equality.
- Error codes agree across the response schema, error schema, and registry.
- Retry semantics exist for every code.
- The contract version is consistent across artifacts.

Exit 0 is the gate. Governance CI (kanban t_b1efe846) runs this validator on bridge PRs.

## 13. Implementation checklists

### 13.1 Orca engineer (capture side)

1. Build the Design Mode toggle and click overlay. Classify picks as T0.5 tier.
2. Implement §6.2 capture with raw CDP. Include portal elements.
3. Compute `structural_hash` per §6.5. Enforce caps per §6.6.
4. Build the request per `schemas/orca-resolver-request.schema.json`.
5. Call `mcp_resolve_element` first. Fail over per §5.3.
6. Parse the envelope. Branch on `error` presence.
7. Render confidence, `fallback_match`, `known_bug_flags`, and the verification verdict.
8. Apply the retry rules from §10. Never auto-retry non-retryable codes.

### 13.2 Hermes engineer (resolver side)

1. Register `mcp_resolve_element` on the state engine MCP server (port 9110 default).
2. Add `POST /api/v1/resolver/resolve` with identical payload handling.
3. Validate requests against the schema. Return `INVALID_REQUEST` with `validation_errors`.
4. Reject unknown major versions with `UNSUPPORTED_SCHEMA_VERSION`.
5. Implement the exact fast path per §7.2. Confidence is exactly 1.0.
6. Implement the stale-node fallback per §7.3. Floor at 0.5. Emit `fallback_match`.
7. Consult the known-bug registry. Attach flags and workarounds per §9.
8. Execute optional actions after the compatibility test. Emit `ACTION_REJECTED` with `reason_code`.
9. Prove execution through state-diff. Emit `no_state_change` for no-ops. Never treat selector presence as success.
10. Cache responses per `request_id` for 60 seconds. Replay without re-executing.
11. Honor `timeout_ms`. Return `RESOLVER_TIMEOUT` with the failing phase.
12. Emit responses strictly per `schemas/orca-resolver-response.schema.json`.

## 14. Change log

| Version | Date | Change |
|---|---|---|
| 1.0.0 | 2026-10-26 | Initial frozen contract for ORCA-07 parallel implementation. |
