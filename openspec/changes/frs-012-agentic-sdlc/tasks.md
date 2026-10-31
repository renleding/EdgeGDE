# Tasks — Agentic SDLC (FRS-012)

## Phase 1: Executable verification criteria (F01)

- [x] `droid/mission_manifest.py` — Task/Manifest/Budget/Saga dataclasses
- [x] `droid/mission_manifest.py` — `verification_criteria` object schema (4 types)
- [x] `droid/mission_manifest.py` — `validate()`: mutating tasks require criteria; parallel ⇒ no depends_on
- [x] JSON serialization round-trip (`to_dict`/`from_dict`/`to_json`/`from_json`)
- [x] Unit verification: missing-criteria manifest rejected; read-only manifest accepted

## Phase 2: Verification runner (F03)

- [x] `droid/verification_runner.py` — `VerificationCriteria`, `VerificationResult`
- [x] `droid/verification_runner.py` — 4 executors: test_command, script, http_check, state_check
- [x] `_check_condition` — dict-field comparison first, then scalar contains/exists/not_exists
- [x] Unit verification: deterministic pass/fail; state_check exists true/false

## Phase 3: Code→Validate loop (F02)

- [x] `droid/code_validate_loop.py` — loop with governance pre-check per iteration
- [x] Iteration limit (default 5), escalation report with last failure
- [x] `adjust` callback contract: `(content, last_failure) → content`
- [x] Unit verification: completed in 1 iteration; escalated at limit=2; governance-rejected

## Phase 4: Governance gate (F05)

- [x] `droid/governance_gate.py` — CI Gate 3 rule families (no-as-any, no-console-log, whitespace, size, JSDoc, test-exists)
- [x] Changed-line scoping via `git diff -U0` when available
- [x] `can_apply_mutation()` decision point; `check_diff()` for diffs
- [x] Unit verification: `as any` rejected; clean content allowed; test/tooling exemptions hold

## Phase 5: Parallel coordinator (F04, design-level)

- [x] `droid/parallel_coordinator.py` — worktree planning, status tracking, aggregation
- [x] `validate_parallelism()` — parallel ⇒ no depends_on
- [ ] (deferred until fleet idle) Actual worktree creation + per-worktree Droid spawn

## Phase 6: Spec renderer (F06)

- [x] `droid/spec_renderer.py` — markdown → HTML with embedded dark-theme CSS + TOC
- [x] Rendered artifact: `docs/html/FRS-012-agentic-sdlc-v1.html`
- [x] Unit verification: title + 9 sections + complete HTML document

## Phase 7: Documentation

- [x] `~/hermes-master/05_DOCS/frs/FRS-012-agentic-sdlc-v1.md`
- [x] `~/hermes-master/05_DOCS/frs/SDD-012-agentic-sdlc-v1.md`
- [x] `~/hermes-master/05_DOCS/frs/IDD-012-agentic-sdlc-v1.md`
- [x] OpenSpec change: `openspec/changes/frs-012-agentic-sdlc/` (proposal, design, 6 specs, tasks)

## Definition of Done

- [x] All integration assertions pass (6/6 features verified)
- [x] `openspec validate frs-012-agentic-sdlc` passes
- [x] No secrets or API tokens in artifacts
- [x] Fleet impact: zero (all work in agent-3 worktree)