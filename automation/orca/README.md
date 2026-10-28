# Orca Design Mode — CDP capture controller + action confirmation loop

Browser-side capture flow and post-action confirmation loop for the
Orca→Resolver bridge (contract: `docs/IDD-016-orca-resolver-bridge-v1.md`,
repo root).

## Files

- `design_mode_capture.py` — `DesignModeCapture` controller: pick → raw-CDP
  capture recipe (IDD-016 §6.2) → payload assembly per
  `orca-resolver-request.schema.json` → transport (MCP `mcp_resolve_element`
  first, byte-identical HTTP fallback) per §5. Also owns the Design Mode
  install (Runtime binding + script-on-new-document, with `Page.enable` /
  `Runtime.enable` issued first — domains lazy-init otherwise), post-reload
  element re-location (fresh node ids — backend node ids die on reload) and
  region re-capture.
- `design_mode_confirmation.py` — `ActionConfirmationLoop`: the §13.1 item 7
  loop. pick → capture → resolve → §8 policy gate → `OrcaActionBridge`
  execution → state-diff verification → `Page.reload` hot-reload → re-locate →
  region re-capture → confirmation payload for the Design Mode panel.
- `orca_action_bridge.py` — `OrcaActionBridge` (vendored from the bridge
  task): resolver response → ActionEngine primitive dispatch (CDP → AX → JS →
  React tiers), known-bug workarounds, structured outcome with verification
  verdicts.
- `resolver_transport_adapter.py` — serves the real `OrcaResolver` over the
  frozen IDD-016 transport (MCP JSON-RPC frame + byte-identical HTTP
  fallback) for demos/tests without booting the full StateEngine MCP.
- `demo_confirmation_loop.py` — live end-to-end demo harness (CfT + fixture
  app + real resolver): 3 scenarios with hard assertions, evidence PNGs and
  `report.json`. Run: `python3 demo_confirmation_loop.py`
- `fixtures/confirmation-demo.html` — fixture app (state in localStorage +
  URL hash so the post-reload region capture shows the real change).
- `test_design_mode_capture.py` — pytest suite (21 tests): recipe order,
  structural_hash canonicalization (§6.5), portal detection (Radix),
  §6.6 caps, schema validation, retry matrix (§10), all transport paths.
- `test_design_mode_confirmation.py` — pytest suite (18 tests): outcome
  classification, §8 policy bands, dispatch adaptation, payload building,
  full loop with fakes (verified / no_state_change / error / rejection /
  recapture-failure / not-relocatable paths).
- `test_orca_action_bridge.py` — pytest suite (16 tests, vendored): click,
  fill, save, combobox, rejection scenarios, contract sample payloads.

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
