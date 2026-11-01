# Automation Bridge-to-Resolver Bridge Contract

## Why this change

AB-07 fuses Automation Bridge Design Mode with the Hermes State Engine Resolver (FRS-005).
Two workstreams build at once. The Automation Bridge side captures clicked elements in the admin console tab.
The Hermes side resolves them and executes actions.
Both sides need one frozen contract before implementation starts.
This change publishes that contract: versioned schemas, the MCP tool definition, the HTTP fallback, and the error registry.

## What changes

| Artifact | Location |
|---|---|
| Contract document | `docs/IDD-016-automation-bridge-v1.md` |
| Schema package | `packages/automation-bridge/` |
| Request schema | `packages/automation-bridge/schemas/automation-bridge-request.schema.json` |
| Response schema | `packages/automation-bridge/schemas/automation-bridge-response.schema.json` |
| Error envelope schema | `packages/automation-bridge/schemas/automation-bridge-error.schema.json` |
| Error code registry | `packages/automation-bridge/schemas/error-codes.json` |
| MCP tool definition | `packages/automation-bridge/mcp-tool.json` |
| Examples and negative examples | `packages/automation-bridge/examples/` |
| Validator | `packages/automation-bridge/tools/validate_examples.py` |

## Capabilities affected

- `automation-bridge` — new capability. The frozen integration contract itself.
- `state-engine` — resolver consumes the request and emits the response (kanban t_7363056a).
- `edge-runtime` admin console — Automation Bridge Design Mode captures elements and calls the bridge (kanban t_4242d4b7).

## Acceptance criteria

1. The contract document defines request schema, response schema, MCP tool, HTTP fallback, error codes, and retry semantics.
2. An Automation Bridge engineer implements capture and transport from the document alone.
3. A Hermes engineer implements the resolver tool from the document alone.
4. `python3 packages/automation-bridge/tools/validate_examples.py` exits 0.
5. Every positive example validates against its schema.
6. Every negative example fails validation.
7. `openspec validate automation-bridge-contract` passes.