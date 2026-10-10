# Design: Configurator Column Sorting + Script Syntax Gate

## Architecture

Three layers close the SDLC gap that let a SyntaxError ship:

```
┌─────────────────────────────────────────────────────────────┐
│  Layer 1: SPEC (FRS-010 v2.4 / FEATURE-15)                │
│  - Column sorting SHALL be available on both tables          │
│  - Indicators SHALL show current sort state                  │
│  - Numeric columns SHALL sort numerically (not lexically)    │
│  - Script SHALL execute without errors                       │
└─────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────────────────────────────────────┐
│  Layer 2: VERIFICATION (test/scripts-syntax.test.ts)        │
│  - Render every admin page with the test harness            │
│  - Extract all inline <script> tags via regex               │
│  - Write each to a temp file and run node --check           │
│  - Fail CI if any script has a syntax error                 │
└─────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────────────────────────────────────┐
│  Layer 3: DOCUMENTATION (IDD-011)                           │
│  - Configurator page interface contract                     │
│  - Table component interface                                │
│  - Sort API contract                                        │
│  - Inline script delivery contract                          │
└─────────────────────────────────────────────────────────────┘
```

## Data flow

1. User clicks `<th data-sort="key">` header
2. Click listener calls `sortTable(idx, key)`
3. `sortTable` reads `tbody` rows, compares by cell index
4. `compare()` handles numeric detection via `parseFloat`
5. Sorted rows are re-appended to `tbody` (DOM move, not re-render)
6. Indicators update: `▲` for ascending, `▼` for descending, cleared elsewhere

## Why `node --check` in CI

The root cause was a duplicate `const` declaration. TypeScript cannot catch it because the script is a template literal string. Vitest cannot catch it because it never parses inline scripts from HTML. `node --check` is the only tool that parses the script as JavaScript and throws on syntax errors before they reach the browser.

## File structure

| File | Purpose |
|------|---------|
| `test/scripts-syntax.test.ts` | New CI test - extracts and validates all inline scripts |
| `apps/afirmico-tesla/docs/IDD-011-afirmico-auto-configurator-v1.md` | New IDD document |
| `apps/afirmico-tesla/docs/FRS-010-afirmico-auto-tesla-fleet-data-v1.md` | Amended to v2.4 |
| `apps/afirmico-tesla/docs/SDD-011-afirmico-auto-config-scopes-v1.md` | Amended with sort design |

## Inline script extraction

The test must:

1. Render each admin page via the existing test harness
2. Extract all `<script>...</script>` blocks (not `<script src=...>`)
3. Write each block's content to a temp `.js` file
4. Execute `node --check <tempfile>` 
5. Fail with the script content if exit code is non-zero

Edge cases:
- Empty scripts (valid)
- Scripts with `type="module"` (still valid for node --check)
- Scripts with template literals containing `</script>` (already escaped by the renderer)
- Multiple scripts per page (all must pass)