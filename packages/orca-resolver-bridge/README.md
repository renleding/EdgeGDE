# @edgegde/orca-resolver-bridge

Frozen integration contract between **Orca Design Mode** (browser-tab capture side)
and the **Hermes State Engine Resolver** (FRS-005, resolution side).

**The authoritative contract document is `~/hermes-master/05_DOCS/frs/IDD-016-orca-resolver-bridge-v1.md`.**
Read it before implementing either side. This package holds the machine-readable
artifacts that document references. Do not edit schemas here without a contract
version bump (see IDD-016 §4).

## Layout

| Path | Contents |
|---|---|
| `schemas/orca-resolver-request.schema.json` | Request schema. Capture payload, `schema_version` 1.0.0. |
| `schemas/orca-resolver-response.schema.json` | Response schema. Resolution or error, never both. |
| `schemas/orca-resolver-error.schema.json` | Standalone error envelope. Byte-identical `error` object. |
| `schemas/error-codes.json` | Error code registry with retry semantics. |
| `mcp-tool.json` | MCP tool definition (`mcp_resolve_element`) plus HTTP fallback declaration. |
| `examples/` | Valid example payloads. `response-error-*` files validate against both response and error schemas. |
| `examples/invalid/` | Negative examples. The validator asserts these FAIL. |
| `tools/validate_examples.py` | Validates examples, checks cross-artifact consistency. |

## Validate

```sh
cd packages/orca-resolver-bridge
python3 tools/validate_examples.py
```

Requires Python 3.11+ and `jsonschema>=4.18`. Exit 0 means every example
validates, every negative example is rejected, and no artifact drifted.

## Import guidance

- **TypeScript (Orca side):** generate types from `schemas/*.schema.json` or
  hand-bind with zod, mirroring `packages/op-schema`. Field names are snake_case.
- **Python (Hermes side):** validate with `jsonschema.Draft202012Validator`.
  `apps/state-engine` already depends on the MCP stack. Load schemas from this
  package path at runtime.
- **Both sides:** the response envelope always parses as JSON. Check `error`
  first. When `error` is absent, `resolution` is present and usable.

## Initial known-bug registry ids

Consumed from `apps/state-engine/salestrekker_rules.py` at contract freeze:
`radix_portal_block`, `react_props_fallback`, `false_positive_save`.
The registry itself is governed by the compliance workstream (kanban t_b1efe846).
