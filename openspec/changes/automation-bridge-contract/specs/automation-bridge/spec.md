# Capability: automation-bridge

Frozen integration contract between Automation Bridge Design Mode element capture and the Hermes State Engine Resolver (FRS-005).
Contract document: `docs/IDD-016-automation-bridge-v1.md`. Schemas: `packages/automation-bridge/schemas/`.

## ADDED Requirements

### Requirement: AB-R01: Capture requests SHALL validate against the versioned request schema

Every Automation Bridge Design Mode capture payload SHALL conform to `automation-bridge-request.schema.json` version 2.0.0.
The payload SHALL carry `schema_version`, `request_id`, `captured_at`, `page`, and `element`.
The element SHALL carry `backend_dom_node_id`, `dom_snapshot`, the 10-key computed styles subset, geometry, and a screenshot reference.

#### Scenario: Valid capture passes schema validation
- Given: Automation Bridge captured a clicked Save button with backend DOM node id 4821
- When: the payload validates against `automation-bridge-request.schema.json`
- Then: validation SHALL report zero violations
- And: `schema_version` SHALL equal "2.0.0"

#### Scenario: Missing node id fails validation
- Given: a capture payload without `element.backend_dom_node_id`
- When: the payload validates against the request schema
- Then: validation SHALL report `element.backend_dom_node_id` as a required property

### Requirement: AB-R02: The resolver SHALL resolve a live backend DOM node at confidence exactly 1.0

When `backend_dom_node_id` resolves live inside `page.target_id`, the resolver SHALL return `resolution_path: "exact_backend_node"`, `confidence: 1.0`, and `strategy: "backend_node_exact"`. No selector inference SHALL run on this path.

#### Scenario: Live node resolves exactly
- Given: a request whose backend DOM node id is live in the target
- When: the resolver processes the request
- Then: the response SHALL carry `resolution.confidence` equal to 1.0
- And: `resolution.resolution_path` SHALL equal "exact_backend_node"
- And: `resolver.node_live` SHALL be true

### Requirement: AB-R03: The resolver SHALL fall back structurally when the node is stale

When the requested node id no longer resolves, the resolver SHALL score candidates on DOM structure and the computed styles subset. A match at or above 0.5 SHALL return `resolution_path: "fallback_structural"` with `confidence` below 1.0 and non-null `fallback_match` metadata.

#### Scenario: Stale node with structural match
- Given: a request whose backend DOM node id no longer exists after page mutation
- When: structural matching finds a candidate at score 0.83
- Then: the response SHALL carry `resolution_path` "fallback_structural"
- And: `confidence` SHALL equal 0.83
- And: `fallback_match.match_score` SHALL equal 0.83
- And: `fallback_match.matched_on` SHALL list the signals that produced the match

#### Scenario: Stale node without any match at the floor
- Given: a stale node and no candidate at or above 0.5
- When: the resolver processes the request
- Then: the response SHALL carry error code `ELEMENT_NOT_RESOLVABLE`
- And: the envelope SHALL NOT carry a resolution

### Requirement: AB-R04: The resolver SHALL emit the four mandated error codes with retry semantics

The resolver SHALL emit `STALE_NODE`, `ELEMENT_NOT_RESOLVABLE`, `RESOLVER_TIMEOUT`, and `ACTION_REJECTED` per the registry in `error-codes.json`. Every error SHALL carry `code`, `message`, `retryable`, and `retry_policy`. `STALE_NODE` SHALL fire only when the node is stale and structural fallback also fails.

#### Scenario: Stale node with failed fallback returns STALE_NODE
- Given: a stale node and an exhausted structural fallback
- When: the resolver processes the request
- Then: the error code SHALL be `STALE_NODE`
- And: `retry_policy` SHALL be "recapture"
- And: `retryable` SHALL be false

#### Scenario: Budget overrun returns RESOLVER_TIMEOUT
- Given: resolution plus action execution exceeds `timeout_ms`
- When: the budget expires
- Then: the error code SHALL be `RESOLVER_TIMEOUT`
- And: `retryable` SHALL be true
- And: `retry_policy` SHALL be "backoff"

### Requirement: AB-R05: Retries SHALL be idempotent through request_id

The resolver SHALL cache each response keyed by `request_id` for 60 seconds. A replayed `request_id` SHALL return the cached envelope and SHALL NOT re-execute the action.

#### Scenario: Lost response retried safely
- Given: a request whose action executed while the response was lost
- When: the caller retries with the same `request_id`
- Then: the resolver SHALL return the original cached envelope
- And: the action SHALL execute at most once in total

### Requirement: AB-R06: The bridge SHALL expose MCP primary transport and an HTTP fallback with identical payloads

The resolver SHALL register MCP tool `mcp_resolve_element` on the streamable-HTTP server. The resolver SHALL also serve `POST /api/v1/resolver/resolve`. Both transports SHALL accept byte-identical request objects and return the same response envelope shape.

#### Scenario: MCP tool call resolves the element
- Given: the state engine MCP server runs on port 9110
- When: the caller invokes `mcp_resolve_element` with a valid capture request
- Then: the tool result SHALL contain the JSON response envelope

#### Scenario: HTTP fallback accepts the same payload
- Given: MCP is unreachable
- When: the caller POSTs the same request object to `/api/v1/resolver/resolve`
- Then: the HTTP response body SHALL be the same envelope shape
- And: contract errors SHALL map to the HTTP statuses in `error-codes.json`

### Requirement: AB-R07: The resolver SHALL attach known-bug flags from the shared registry

When the resolved element matches a known-bug pattern, the response SHALL list the registry id in `known_bug_flags` and SHALL provide a matching `known_bug_workarounds` entry with `bug_id`, `workaround`, and `applied`.

#### Scenario: Radix portal combobox carries the portal flag
- Given: a captured combobox inside a Radix portal
- When: the resolver resolves it
- Then: `known_bug_flags` SHALL contain "radix_portal_block"
- And: `known_bug_workarounds` SHALL name the KEY tier workaround

### Requirement: AB-R08: Executed actions SHALL carry a state-diff verification verdict

When the request carries `action`, the response SHALL carry `action_outcome` with `executed`, `action_tier`, and a `verification` block whose `method` is "state_diff". A dispatched action with unchanged state SHALL report verdict `no_state_change` with `verified` false.

#### Scenario: Click opens a dialog
- Given: a click action on a resolved button
- When: the state-diff shows a dialog opened
- Then: `verification.verified` SHALL be true
- And: `verification.verdict` SHALL be "verified"

#### Scenario: No-op action reports unverified
- Given: a click action that changes no state
- When: verification runs
- Then: `verification.verdict` SHALL be "no_state_change"
- And: `verification.verified` SHALL be false

### Requirement: AB-R09: Incompatible actions SHALL be rejected with ACTION_REJECTED

When the requested action is incompatible with the resolved element type, or confidence sits below policy, the resolver SHALL reject the action. The response SHALL carry the rejection in `action_outcome.rejection` with `code` "ACTION_REJECTED" and a `reason_code`, or as a top-level error when resolution itself cannot support the action.

#### Scenario: Fill requested on a button
- Given: a request with action type "fill" on a resolved button
- When: the resolver checks compatibility
- Then: the response SHALL report reason_code "element_type_incompatible"

### Requirement: AB-R10: The contract artifacts SHALL validate mechanically

`packages/automation-bridge/tools/validate_examples.py` SHALL validate every positive example against its schema, SHALL reject every negative example, and SHALL prove that `mcp-tool.json` matches the schema files. The command SHALL exit 0 only when all checks pass.

#### Scenario: Validator passes on the committed artifacts
- Given: the committed schema package at contract version 2.0.0
- When: a developer runs `python3 tools/validate_examples.py`
- Then: every positive example SHALL validate
- And: every negative example SHALL be rejected
- And: the exit code SHALL be 0