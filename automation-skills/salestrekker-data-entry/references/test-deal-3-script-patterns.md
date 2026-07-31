# Test Deal 3 — Script Patterns (26 Jul 2026)

This reference captures the working CDP-native patterns discovered while
building the Test Deal 3 data entry script (Sam & Amy Smith).

## Key Discoveries

1. **Section nav via `a._U0`** — Home loan edit sections use `<a class="_U0 _R0">`
   links. No SPA priming needed. Navigate to the base home-loan URL, then click
   the section link.

2. **Asset type selection via `[role=menuitem]`** — After clicking "Add asset",
   asset type options render as `<button role="menuitem">`. Click one to reveal
   form fields (name, value, date, etc.).

3. **Save button has two labels** — "Save" (personal details) and
   "Save and calculate" (financial sections). Match with `startsWith('Save')`.

4. **DOM structure** — The page has ~501 elements with CSS-module class names
   (minified). Two `<details>` elements: "Client profile" and "Home loan".
   Section links are `<a>` inside the "Client profile" details' `<nav>`.

5. **Tab cleanup crucial** — Each Playwright CDP connection adds tabs. Clean
   stale ones before running: `http://localhost:9222/json/close/{id}`

## Verified Working Code

See `scripts/st-test-deal-3-fill.py` in the EdgeGDE repo for the complete
implementation with all patterns above.
