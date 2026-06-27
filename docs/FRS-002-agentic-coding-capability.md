# FRS-002: Agentic-First Coding Capability — Headless Guardrails, Orchestrated Execution & SWE-bench Baseline

**Version:** 1.0.0  
**Status:** Draft  
**Date:** 2026-06-27  
**Author:** Hermes (Director)

---

## Objective

Establish a **quantitative, reproducible measurement framework** for EdgeGDE's agentic coding capability. This is not about building an IDE or a native code editor — EdgeGDE is an **agentic SDLC kernel**. Its value is in **orchestration, governance, and deterministic verification**, not in-line text editing.

The measurement framework (SWE-bench Lite) provides a **mathematical baseline** that proves or disproves the ROI of EdgeGDE's architecture decisions. Every infrastructure improvement thereafter is measured against this baseline.

**Guiding principles:**
- Droid is the **automated hand** — provisions worktrees, invokes external executors (Aider, Claude Code, Codex), captures results, tears down
- Aegis is the **automated gatekeeper** — headless LSP validation, test runner, audit trace
- Hermes is the **Director** — routes context to executors, manages the state machine, verifies outcomes
- **No native editor code.** No LSP interactive tools. No IDE extension logic.
- **Orchestration over Implementation.** Optimize context passing, not code generation.

---

## Architecture Model

```
Hermes (Director)                 — Plans, decomposes, routes context, verifies
  │
  ├── Aegis (Governance)          — Headless guardrails: LSP lint, typecheck, audit
  │
  └── Droid (Executor Orchestrator)
        │
        ├── Provision worktree    — git clone/checkout at base_commit
        ├── Invoke executor       — Aider / Claude Code / Codex CLI
        ├── Capture result        — git diff → patch file
        └── Tear down             — remove worktree
```

**Key insight:** EdgeGDE doesn't compete on who writes better code line-by-line. It competes on **who can orchestrate, verify, and audit code generation at scale** — a problem none of the four competitors (Cline, Kilo Code, Crush, Factory) solve.

---

## FRS-1: SWE-bench Lite Baseline Framework

### Objective

Establish the measurement infrastructure and record EdgeGDE's **current** SWE-bench Lite score using Hermes + Aider orchestration through the existing SDLC pipeline. This is the "before" measurement.

### Functional Requirements

**FR-1.1 — SWE-bench Environment Bootstrap**
The system MUST install and configure the SWE-bench evaluation harness (`pip install swebench`) with Docker-based evaluation support. The 23-instance `dev` split of SWE-bench Lite MUST be accessible locally for fast iteration. The 300-instance `test` split MUST be accessible for final measurement.

**FR-1.2 — Hermes → SWE-bench Adapter**
Hermes MUST be able to:
1. Read a SWE-bench instance (repo, base_commit, problem_statement, test_patch, FAIL_TO_PASS, PASS_TO_PASS)
2. Provision a worktree at the base_commit of the target repo
3. Pass the problem_statement to the executor (Aider/Claude Code/Codex)
4. Capture the generated patch
5. Teardown the worktree
6. Return the patch for evaluation

**FR-1.3 — Headless Aider Execution via Droid**
Droid MUST invoke Aider in headless mode (no PTY, no streaming) against each SWE-bench task. The invocation MUST:
- Use `--no-git` (no repo-map analysis — avoid 30-60s overhead)
- Use `--edit-format whole` (reliable for patches)
- Use `--no-auto-commits` (Hermes owns lifecycle)
- Use `--no-stream` (limit output size)
- Run inside the provisioned worktree
- Timeout after 600 seconds per task
- Capture std{out,err} for audit logging

**FR-1.4 — Patch Capture & Format Conversion**
Droid MUST:
- Execute `git diff` on the worktree after executor completes
- Save the diff as a unified patch file under `.hermes/logs/swe-bench/{instance_id}/patch.diff`
- Record: instance_id, executor exit code, duration, patch size, executor model, executor command

**FR-1.5 — Evaluation via SWE-bench Harness (Podman)**
The system MUST evaluate each generated patch using the SWE-bench official harness, which uses the `docker` Python package. On this system, the Docker socket (`/var/run/docker.sock`) is symlinked to Podman's socket (`podman.sock`), so the harness transparently uses **Podman** as the container runtime.

Podman machine status: running (podman-machine-default, 2 CPUs, 8GB RAM, 60GB disk).

```bash
export DOCKER_HOST=unix:///Users/warren/.local/share/containers/podman/machine/podman.sock
python -m swebench.harness.run_evaluation \
  --dataset_name SWE-bench/SWE-bench_Lite \
  --split dev \
  --predictions_path predictions.json \
  --output_dir results/
```

Note: The SWE-bench harness uses the `docker` Python package (not `podman` CLI). This works because Podman exposes a Docker-compatible API socket. If future changes require direct Podman CLI invocation, use `podman` commands with the machine context `podman-machine-default`.

**FR-1.6 — Results Aggregation & Report**
For each run, the system MUST produce `docs/SWE-BENCH-BASELINE-{date}.md` containing:
- Overall resolve rate (X/300 on test, X/23 on dev)
- Per-repo breakdown (resolve rate by Python repo name)
- Per-task breakdown (which instances resolved/failed)
- Execution statistics (mean duration per task, mean patch size, executor model)
- Architecture trace (which state machine phases executed per task)
- Comparison to published baselines (from SWE-bench leaderboard)

### Acceptance Criteria

- [ ] SWE-bench `dev` split (23 instances) evaluates successfully with Hermes + Aider (Podman runtime)
- [ ] SWE-bench `test` split (300 instances) evaluates successfully (or a statistically meaningful subset, Podman runtime)
- [ ] Report is published to `docs/SWE-BENCH-BASELINE-*.md`
- [ ] Results are reproducible: re-run of same tasks produces same pass/fail outcomes
- [ ] Report includes comparison to published SWE-bench Lite leaderboard scores

### Verification

```bash
# Verify SWE-bench installation
python3 -c "from swebench import harness; print('SWE-bench OK')"

# Verify Podman connection
export DOCKER_HOST=unix:///Users/warren/.local/share/containers/podman/machine/podman.sock
python3 -c "import docker; c=docker.from_env(); print(f'Podman: {c.info().get(\"dockerRootDir\",\"connected\")}')"

# Verify dev split evaluation for a single task
export DOCKER_HOST=unix:///Users/warren/.local/share/containers/podman/machine/podman.sock
python3 -m swebench.harness.run_evaluation \
  --dataset_name SWE-bench/SWE-bench_Lite \
  --split dev \
  --predictions_path predictions_dev.json \
  --output_dir results/

# View report
cat docs/SWE-BENCH-BASELINE-*.md
```

---

## FRS-2: Headless LSP Static Analysis Guardrail

### Objective

Replace the interactive, editor-centric LSP pattern (used by competitors like Crush) with a **headless, automated validation gate** inside EdgeGDE's 5-phase state machine. The LSP is a deterministic, near-instant static analysis step — not a code intelligence aid.

### Functional Requirements

**FR-2.1 — LSP-as-Gate Architecture**
An **LSP validation step** MUST be inserted between the EXECUTION and VERIFICATION phases of EdgeGDE's state machine:

```
EXECUTION → LSP GATE → VERIFICATION
                │
                ├── ✅ No diagnostics → proceed to VERIFICATION
                ├── ⚠️ Warnings only  → log, proceed to VERIFICATION
                └── ❌ Errors detected → reject, force self-correction loop, flag to Aegis
```

**FR-2.2 — Headless LSP Client**
Hermes MUST support a `lsp_validate(worktree_path, language)` operation that:
- Starts a headless LSP server (e.g., `typescript-language-server`, `pyright`, `gopls`)
- Opens every file in the worktree that was modified by the executor
- Collects all diagnostics (errors, warnings, infos)
- Shuts down the LSP server
- Returns structured diagnostics: `{errors: [...], warnings: [...], infos: [...]}`

**FR-2.3 — Aegis Integration**
Aegis MUST:
- Review LSP diagnostics and classify severity
- If errors exist: set `lsp_gate_status = "rejected"`, trigger self-correction loop
- If warnings only: set `lsp_gate_status = "warned"`, log to audit, proceed
- If clean: set `lsp_gate_status = "passed"`, proceed

**FR-2.4 — Self-Correction Loop**
When LSP gate rejects with errors:
1. Aegis records the diagnostics in the audit ledger
2. Hermes re-routes the task back to the executor with the LSP errors as context
3. Executor retries with the added context of "these diagnostics must be resolved"
4. After executor completes, LSP gate re-runs
5. Max 3 correction attempts before escalation to human

**FR-2.5 — Multi-Language Support**
The LSP gate MUST support at minimum:
- Python: `pyright` or `basedpyright`
- TypeScript/JavaScript: `typescript-language-server`
- Go: `gopls`
- Rust: `rust-analyzer`

Language is auto-detected from the worktree's file extensions (`.py`, `.ts`/`.js`, `.go`, `.rs`).

### Acceptance Criteria

- [ ] `lsp_validate()` returns structured diagnostics for a modified worktree
- [ ] Type errors cause gate rejection and self-correction loop
- [ ] Clean code passes gate without delay
- [ ] LSP gate is measured in benchmark runs (included in `docs/SWE-BENCH-BASELINE-*.md`)
- [ ] LSP gate does NOT block on missing LSP servers (graceful degradation: warn and pass)

### Verification

```bash
# Test LSP gate on a modified TypeScript worktree
hermes lsp-validate /tmp/test-worktree --language typescript

# Expected output:
# {
#   "status": "passed" | "rejected" | "warned",
#   "errors": [...],
#   "warnings": [...],
#   "gate_ns": 1234567
# }

# Test self-correction loop
hermes task run --correction-loop --max-attempts 3 --instance-id django__django-12345
```

---

## FRS-3: Orchestrated Execution over Native Implementation

### Objective

Optimize how Hermes passes context to external CLI executors (Aider, Claude Code, Codex) so they run **completely unattended** inside a worktree — no human prompts, no interactive feedback, minimal overhead.

### Functional Requirements

**FR-3.1 — Droid Worktree Lifecycle**
Droid MUST manage an executor's full lifecycle:
1. **Provision** — `git clone --no-checkout <repo> <worktree>` then `git checkout <base_commit>` in the worktree, install dependencies
2. **Inject context** — Hermes constructs a system prompt from: problem_statement, file list, relevant snippets
3. **Execute** — Launch Aider/Claude Code/Codex inside the worktree with the injected prompt
4. **Capture** — `git diff` the worktree, extract patch, record metadata
5. **Teardown** — `rm -rf <worktree>`
6. **Report** — Return structured execution report

**FR-3.2 — Optimal Context Injection**
Hermes MUST construct the minimum viable context for the executor:
- Problem statement (from SWE-bench instance)
- File list (from the repo at base_commit)
- Optionally: relevant snippets from grep/search of the problem statement keywords
- Optionally: test file paths (from `test_patch` or `FAIL_TO_PASS`)

This is the **orchestration value**: a human running Aider alone would spend 5 minutes deciding what context to provide. Hermes decides in <1 second, deterministically.

**FR-3.3 — Executor Selection Strategy**
Hermes MUST select the optimal executor based on:
- Task complexity (estimated from problem_statement length, repo size)
- Language/framework (Python → Aider, TypeScript → Codex, Rust → Claude Code)
- Available executor (check if CLI is installed, fall back chain)
- Cost tolerance (Aider + cheap model vs Claude Code + expensive model)

Initial implementation: hard-code Aider as the default. Selection strategy is a Phase 3 optimization.

**FR-3.4 — Failure Classification & Retry**
When an executor fails (non-zero exit, timeout, corrupted output), Droid MUST:
1. Classify the failure: `timeout`, `build_error`, `executor_crash`, `empty_patch`, `syntax_error`
2. Log classification to audit
3. Retry up to `max_retries=2` with exponential backoff
4. After max retries, mark task as `failed` and proceed (error-continue, not error-stop)

### Acceptance Criteria

- [ ] Droid can provision a worktree, run Aider, capture patch, and teardown in <5 minutes
- [ ] Context injection includes problem_statement and file list
- [ ] Executor selection defaults to Aider with graceful fallback
- [ ] Failure classification works for timeout, crash, empty patch
- [ ] SWE-bench baseline uses this lifecycle end-to-end

### Verification

```bash
# Single task end-to-end
hermes swe-bench run --instance-id django__django-12345

# Expected structured output
# {
#   "instance_id": "django__django-12345",
#   "status": "resolved" | "failed" | "error",
#   "patch": "diff --git a/...",
#   "executor": "aider",
#   "executor_model": "deepseek/deepseek-v4-flash",
#   "duration_ms": 123456,
#   "lsp_gate": { "status": "passed", "diagnostics": [] },
#   "failure_classification": null
# }
```

---

## FRS-4: Automated Verification & Audit Trail

### Objective

Build the **Aegis governance layer** — automated, programmatic verification that validates every executor action before it reaches a human PR review. Make the verification process as deterministic as the code generation itself.

### Functional Requirements

**FR-4.1 — Post-Execution Verification Suite**
After an executor generates a patch, Aegis MUST run these automated checks in order (cheapest first):
1. **Git diff hygiene** — no binary files, no `.env` files, no node_modules
2. **LSP gate** (from FRS-2) — type errors, missing imports
3. **Lint** — run `ruff` (Python) or `eslint` (TypeScript) on changed files
4. **Test run** — execute tests related to changed files (if discoverable)
5. **Patch format** — valid unified diff, applies cleanly against base_commit
6. **Test patch apply** — apply `test_patch` and verify the test file exists and is valid Python/TS

Results: pass/fail per gate + aggregate verdict.

**FR-4.2 — Audit Ledger per Task**
Each executor invocation MUST produce an immutable audit record containing:
- `instance_id` — SWE-bench instance identifier
- `executor` — which executor was used (aider/claude-code/codex)
- `executor_model` — model name
- `duration_ms` — wall clock time from provision to teardown
- `lsp_gate_status` — passed/warned/rejected + diagnostics
- `verification_gates` — results of all FR-4.1 gates
- `patch_hash` — SHA256 of the generated patch
- `failure_classification` — if failed
- `retry_count` — number of retry attempts
- `hermes_trace` — OpenTelemetry trace ID

**FR-4.3 — Aggregate Scoring & Regression Detection**
Hermes MUST maintain a running aggregate across all SWE-bench runs:
- Resolve rate (resolved / total)
- Per-repo resolve rate
- Mean time per task
- Mean LSP gate pass rate
- Gate-by-gate pass rates

When a change to Hermes, Aegis, or Droid code produces a **lower resolve rate**, the change MUST be automatically flagged as a regression.

### Acceptance Criteria

- [ ] Post-execution verification suite runs 6 gates in <30 seconds per task
- [ ] Audit ledger is machine-readable JSON and human-readable summary
- [ ] Regression detection flags any decrease in resolve rate
- [ ] Audit ledger is queryable: "show me all failed tasks where LSP gate rejected"

### Verification

```bash
# Run verification on a single patch
hermes swe-bench verify --patch path/to/patch.diff --instance django__django-12345

# Expected output
# {
#   "lsp_gate": "passed",
#   "lint_gate": "passed",
#   "test_gate": "skipped",
#   "patch_format": "passed",
#   "test_patch_apply": "passed",
#   "verdict": "PASS" | "FAIL"
# }
```

---

## FRS-5: Iterative Optimization Pipeline

### Objective

Once the baseline is established (FRS-1), use the measurement framework to **iteratively improve** EdgeGDE's coding capability through targeted, quantifiable changes — never through guesses or vibes.

### Functional Requirements

**FR-5.1 — Hypothesis-Driven Improvement**
Every proposed improvement MUST:
1. State a hypothesis (e.g., "Adding file list context improves resolve rate by 5%")
2. Run the SWE-bench dev split (23 instances) to compare before/after
3. Report the delta in resolve rate, mean duration, and LSP gate pass rate
4. Only deploy to production if the dev split shows improvement

**FR-5.2 — Optimization Modes (Phase 3+)**

| Mode | What Changes | Expected Impact |
|------|-------------|-----------------|
| Context injection | Add/remove file list, code snippets | Resolve rate |
| Executor model | Switch Aider's backend model | Resolve rate + cost |
| LSP gate feedback | Include LSP errors in retry prompt | Resolve rate (correction) |
| Executor selection | Choose aider vs codex vs claude-code | Resolve rate + speed |
| Parallel execution | Run multiple executors, pick best patch | Resolve rate (at cost) |
| Multi-attempt | Run N attempts, keep best patch | Resolve rate (at time cost) |

**FR-5.3 — Regression Gate in CI**
The SWE-bench dev split (23 instances) MUST gate CI. A PR that decreases resolve rate on dev by >=3 percentage points is automatically flagged and requires human override to merge.

### Acceptance Criteria

- [ ] Hypothesis-driven improvement workflow is documented and repeatable
- [ ] At least 3 optimization experiments are run and recorded in `docs/SWE-BENCH-EXPERIMENTS-*.md`
- [ ] Resolve rate improvement of >=5% on dev split achieved from baseline
- [ ] CI regression gate implemented

### Verification

```bash
# Run hypothesis experiment
hermes swe-bench experiment \
  --name "context-file-list" \
  --control-baseline "baseline-2026-06-27" \
  --variable "inject_file_list=true" \
  --split dev

# Expected output
# {
#   "control_resolve_rate": 0.XX,
#   "variable_resolve_rate": 0.YY,
#   "delta": ±0.ZZ,
#   "verdict": "improved" | "regressed" | "unchanged"
# }
```

---

## Phased Implementation Plan

### Phase 0: Measurement Foundation (This Session)

| Day | Task | Deliverable |
|-----|------|-------------|
| 0 | Install SWE-bench + sb-cli | Functional harness |
| 0 | Create Hermes → SWE-bench adapter script | `hermes swe-bench run` |
| 0 | Run dev split (23 instances) with Aider | `docs/SWE-BENCH-BASELINE-*.md` |
| 0 | Run test split (300 instances) or subset | Baseline resolve rate |

### Phase 1: Headless Guardrails (1-2 weeks)

| Week | Task | Deliverable |
|------|------|-------------|
| 1 | Implement LSP gate (FRS-2) | `lsp_validate()` operation |
| 1 | Integrate LSP into state machine | State machine transition |
| 1 | Run LSP gate on baseline results | Measure diff: how many baseline patches had type errors? |
| 2 | Implement self-correction loop | Correction loop with diagnostics |

### Phase 2: Orchestration Optimization (2-4 weeks)

| Week | Task | Deliverable |
|------|------|-------------|
| 3 | Implement Droid worktree lifecycle (FRS-3) | Provision → Execute → Capture → Teardown |
| 4 | Context injection optimization | File list + snippet injection |
| 4 | Failure classification | Retry logic with classification |

### Phase 3: Measurement-Driven Iteration (Ongoing)

| Sprint | Task | Deliverable |
|--------|------|-------------|
| 1 | Run hypothesis experiments (FRS-5) | Optimization results |
| 2 | Implement CI regression gate | Dev split in CI |
| 3 | Executor selection strategy | Automatic executor routing |
| 4 | Multi-attempt orchestration | Parallel executors |

---

## Dependencies Between Items

```
FRS-1 (Baseline) ──required by──▶ FRS-2 (LSP Gate)
FRS-1 (Baseline) ──required by──▶ FRS-3 (Orchestration)
FRS-2 (LSP Gate) ──required by──▶ FRS-4 (Verification)
FRS-4 (Verification) ──required by──▶ FRS-5 (Optimization)
Phase 0 (FRS-1)               → Phase 1 (FRS-2, FRS-3)
Phase 1 (FRS-2, FRS-3)        → Phase 2 (FRS-4)
Phase 2 (FRS-4)                → Phase 3 (FRS-5)
```

---

## Testing Strategy

| Capability | Test Level | File | Coverage |
|-----------|-----------|------|----------|
| FRS-1 | Integration + E2E | `tests/swe-bench-adapter.test.ts` | All FR-1.x |
| FRS-2 | Unit + Integration | `tests/lsp-gate.test.ts` | All FR-2.x |
| FRS-3 | Integration | `tests/droid-worktree.test.ts` | All FR-3.x |
| FRS-4 | Unit + Integration | `tests/aegis-verification.test.ts` | All FR-4.x |
| FRS-5 | E2E | `tests/swe-bench-experiment.test.ts` | All FR-5.x |

---

## Boundaries

### Always do
- Run dev split (23 instances) before committing any change to Hermes/Droid/Aegis
- Record all experiment results in `docs/SWE-BENCH-EXPERIMENTS-*.md`
- Attach the FRS to its Kanban task
- Log every executor invocation to the audit ledger
- Use `error-continue` for individual task failures (never error-stop a batch)

### Ask first
- Changing the evaluation harness itself (SWE-bench → different benchmark)
- Adding a new executor type (e.g., Factory's Droid, OpenCode)
- Changing the retry strategy from `error-continue` to `error-stop`
- Running SWE-bench test split on paid cloud compute (Modal costs)

### Never do
- Build a native code editor inside Hermes or Droid
- Add LSP interactive features (autocomplete, hover docs)
- Add IDE extension code to the EdgeGDE repository
- Compare EdgeGDE scores to competitors using non-reproducible methodology
- Claim "improved coding capability" without a SWE-bench dev split measurement

---

## Success Criteria (Overall)

- [ ] FRS-1: SWE-bench baseline published with resolve rate, per-repo breakdown, execution statistics
- [ ] FRS-2: LSP gate operational in the state machine, integrated with self-correction loop
- [ ] FRS-3: Droid worktree lifecycle handles provision → execute → capture → teardown
- [ ] FRS-4: Verification suite runs 6 gates per task, audit ledger recorded
- [ ] FRS-5: CI regression gate active, hypothesis experiments runnable
- [ ] Baseline resolve rate improvement >=5% after Phase 1-2 optimizations

---

## Open Questions

1. **Executor model cost**: Running 300 SWE-bench Lite tasks with Aider + DeepSeek V4 Flash costs ~$XX in API tokens. Is there a budget cap?
3. **Podman machine compatibility**: SWE-bench evaluation requires building Docker-compatible images. Podman machine is running (2 CPUs, 8GB, 60GB). Need to verify image building works through the Docker→Podman socket bridge. The `docker` Python package connects via `DOCKER_HOST=unix:///Users/warren/.local/share/containers/podman/machine/podman.sock`.
4. **Time budget**: 300 tasks × ~5 min/task = ~25 hours of wall clock for full test split. Dev split (23 tasks) = ~2 hours. Is dev-only sufficient for the initial baseline?
4. **Aider model choice**: Should we use the same model as EdgeGDE's runtime (deepseek-v4-flash) or a coding-specialized model (claude-sonnet, gpt-4o)? Initial baseline should use a cheap model to establish cost baseline, then iterate.

---

## Resolved Decisions

| Question | Decision | Rationale |
|----------|----------|-----------|
| Q — Should we build a native editor? | ❌ No | EdgeGDE is an SDLC kernel, not an IDE. Droid orchestrates executors. |
| Q — Should LSP be interactive or headless? | ❌ Headless only | Interactive LSP is an IDE feature. Headless LSP is a deterministic gate. |
| Q — Which benchmark first? | ✅ SWE-bench Lite dev (23 tasks) | Fast iteration cycle. Full test (300 tasks) after dev split stabilizes. |
| Q — Default executor? | ✅ Aider | Already configured, proven in agent-selection-matrix, works with cheap models. |
| Q — Error handling per task? | ✅ error-continue | A single failed task should never block the batch. Audit and move on. |
