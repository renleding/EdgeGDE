# Proposal: FRS-010 v2.4 — Configurator Column Sorting Requirement

## Why this change

A JavaScript SyntaxError (`const headers` declared twice in the same scope) shipped through green CI and prevented the entire sort function from executing on the live configurator page. The bug was invisible to all existing gates because:

1. The sort script lives inside a TypeScript template literal — tsc type-checks the string, not its contents
2. Vitest never parses inline `<script>` strings from rendered HTML
3. No FRS requirement existed for column sorting, so no spec-driven test coverage existed
4. No SDD design specified the sort interface
5. No IDD documented the configurator page contract

This change adds the missing spec layer and a CI gate that extracts and syntax-checks every inline script from rendered admin pages, so this class of bug cannot ship again.

## What changes

| Artifact | Change |
|----------|--------|
| FRS-010 v2.4 | Add FEATURE-15: Configurator Column Sorting with SHALL/MUST requirements and scenarios |
| CI pipeline | Add `test/scripts-syntax.test.ts` — renders all admin pages, extracts inline `<script>`, runs `node --check` |
| IDD | New `IDD-011-afirmico-auto-configurator-v1.md` documenting the page interface |
| SDD | Amend SDD-011 to reference the sort implementation design |

## Capabilities affected

- FEATURE-15: Configurator Column Sorting (new)
- FEATURE-12: Config Scopes / Telemetry Configurator (amended - sort is now specified)
- CI: script syntax validation gate (new)
- IDD: configurator page interface contract (new)