# Orca Design Mode — CDP capture controller

Browser-side capture flow for the Orca→Resolver bridge (contract:
`docs/IDD-016-orca-resolver-bridge-v1.md`, repo root).

## Files

- `design_mode_capture.py` — `DesignModeCapture` controller: pick → raw-CDP
  capture recipe (IDD-016 §6.2) → payload assembly per
  `orca-resolver-request.schema.json` → transport (MCP `mcp_resolve_element`
  first, byte-identical HTTP fallback) per §5.
- `test_design_mode_capture.py` — pytest suite (21 tests): recipe order,
  structural_hash canonicalization (§6.5), portal detection (Radix),
  §6.6 caps, schema validation, retry matrix (§10), all transport paths.

## How it plugs into the admin console

The EdgeGDE admin console serves `apps/edge-runtime/public/design-mode.js`,
which provides the Design Mode toggle, overlay, pick handling and the in-page
half of the capture payload. This controller is the Orca automation-side
half: it attaches to the tab over CDP, installs a `Runtime.addBinding` shim
(`__orcaDesignModePick`) that the page script routes picks through, upgrades
each pick with the exact `backendDOMNodeId`, `DOM.getOuterHTML` snapshot,
`CSS.getComputedStyleForNode` subset, box-model geometry and a clipped
`Page.captureScreenshot`, then transports the assembled payload.

Initialization from the Orca/driver side:

```python
cap = DesignModeCapture(cdp_url="http://127.0.0.1:9222", target_id=<tab id>)
await cap.init()          # installs bindings + survey
# ... page picks flow to delivery_fit via the shim ...
await cap.close()         # removes bindings; overlay cleanup is page-side
```

## Invariants (IDD-016 §11)

- Capture MUST NOT mutate the page — no attribute writes, no leftover scripts;
  only reads (`Runtime.evaluate` returnByValue, DOM/CSS/Page capture methods).
- Portal elements (Radix portals attached at `body` level, outside the React
  tree) are captured like any other node; page-side portal detection is
  authoritative, with the ancestor-chain detector as belt-and-braces.
- `structural_hash` = SHA-256 of `tag:index:id` segments, nearest-ancestor-first.
- Transport ladder on total failure: RESOLVER_UNREACHABLE, backoff
  [5s, 15s, 25s, 60s], max 4 synthesized responses.
