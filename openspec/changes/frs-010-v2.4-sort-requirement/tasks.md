# Tasks: FRS-010 v2.4 + Script Syntax Gate + IDD

## Phase 1: FRS-010 v2.4 Specification
- [ ] Update FRS-010 version header to 2.4 with changelog entry
- [ ] Add FEATURE-15 column sorting requirements (§4.15)
- [ ] Add supersession note for the ad-hoc sort implementation
- [ ] Run STE lint on new FRS content (baseline 0 for new sections)

## Phase 2: Script Syntax Validation Test
- [ ] Create `test/scripts-syntax.test.ts`
- [ ] Implement page rendering using existing test helpers
- [ ] Extract all inline `<script>` tags from rendered HTML
- [ ] Run `node --check` on each extracted script
- [ ] Fail test with script content on syntax error
- [ ] Add test to `package.json` test suite

## Phase 3: IDD-011 Configurator Page Interface
- [ ] Create `apps/afirmico-tesla/docs/IDD-011-afirmico-auto-configurator-v1.md`
- [ ] Document page routes, auth, and data flow
- [ ] Document table component interface (config-table, enrol-table)
- [ ] Document sort API contract (initTableSort, sortTable, compare, indicators)
- [ ] Document inline script delivery contract (template literal → HTML)
- [ ] Document CSP and script execution model

## Phase 4: SDD-011 Amendment
- [ ] Add sort implementation design to SDD-011
- [ ] Document the dual-table sort architecture
- [ ] Document numeric vs text comparison logic
- [ ] Document indicator DOM update pattern

## Phase 5: CI Integration
- [ ] Add script-syntax test to `package.json` scripts
- [ ] Verify CI runs the new test in pipeline

## Phase 6: Verification
- [ ] Run full test suite (335+ tests)
- [ ] Run `openspec validate frs-010-v2.4-sort-requirement`
- [ ] Deploy and verify live sort still works
- [ ] Archive the change