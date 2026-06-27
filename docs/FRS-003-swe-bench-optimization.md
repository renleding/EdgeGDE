# FRS-003: SWE-bench Score Optimization — Self-Correction, CoT, Multi-Attempt & Droid Execution

**Version:** 1.0.0  
**Status:** Draft  
**Date:** 2026-06-27  
**Author:** Hermes (Director)  
**Predecessor:** FRS-002 (Aegis Governance Layer — baseline 2/23 = 8.7% on dev split)

---

## Objective

Improve the SWE-bench Lite resolve rate from **8.7% (2/23)** to **~20-25%** using **the same model (DeepSeek V4 Flash)**. No model upgrade. No API key change. All improvements are purely in orchestration, prompt structure, and execution strategy.

**Guiding principles (from FRS-002):**
- Droid is the automated hand — provisions worktrees, invokes executors, captures results, tears down
- No native editor code. No IDE features. No interactive LSP.
- Every improvement must be measurable against the committed baseline (FRS-5 regression gate)

---

## FRS-6: Chain-of-Thought Prompting (Two-Step Generate)

### Objective

Replace the single-shot "generate a diff" prompt with a structured two-step chain-of-thought. The LLM first analyzes the bug, then generates the patch. This forces the model to commit to an understanding before producing code, dramatically reducing hallucinated fixes.

### Functional Requirements

**FR-6.1 — Analysis Step (Step 1)**
Before generating a diff, the system MUST prompt the LLM to produce a structured analysis containing:
- Which file(s) need modification
- What the root cause of the bug is
- What the correct behavior should be
- The minimum code change to achieve it

Output format: plain text analysis (not a diff). No code fences.

**FR-6.2 — Generation Step (Step 2)**
The analysis from Step 1 MUST be fed back into the LLM context alongside the original problem. The LLM then generates the exact unified diff, explicitly told to use the analysis as a guide.

**FR-6.3 — Token Budget**
Step 1: `max_tokens=2000` (analysis is short).  
Step 2: `max_tokens=16000` (diff can be large).  
Total per instance: 18K output tokens, ~2x previous cost per instance.

**FR-6.4 — Same Model, Same Session**
Both steps use the same model (`deepseek/deepseek-v4-flash`). The conversation history from Step 1 is preserved for Step 2 so the model has full context. No new connection, no context loss.

### Acceptance Criteria

- [ ] Dev split shows improved resolve rate vs baseline (target: +3pp minimum)
- [ ] Analysis step produces identifiable root cause in >50% of instances
- [ ] No increase in hallucinated file paths (analysis forces correct path identification)

### Verification

```bash
export DOCKER_HOST=unix:///Users/warren/.local/share/containers/podman/machine/podman.sock
cd /Users/warren/Documents/_HQ_AI/EdgeGDE/.worktrees/hermes-a760990a

# Run baseline comparison
python3 tools/swe-bench/adapter.py run-all --split dev --skip-eval
# Compare against BASELINE_COMMITTED.json
```

---

## FRS-7: Self-Correction Loop (Error Feedback)

### Objective

When `git apply --check` fails, feed the git error message back to the LLM and let it regenerate the patch. The adapter already handles common formatting failures (wrong paths, missing blank lines, code fences) syntactically, but semantic failures (wrong function signature, wrong hunk location) need LLM-in-the-loop correction.

Also integrate with the LSP Gate (FRS-2): if pyright/tsc diagnostics exist on the generated patch, feed those back for a second attempt.

### Functional Requirements

**FR-7.1 — Apply Failure → Retry**
When `git apply --check` returns a non-zero exit, the adapter MUST:
1. Capture the stderr (e.g., `error: corrupt patch at line 12`)
2. Concatenate the original problem + the failed patch + the git error
3. Send to the LLM with instruction: "The following patch failed to apply. Fix the errors and regenerate a valid unified diff."
4. Max 2 retries per instance (3 total attempts: original + 2 retries)

**FR-7.2 — LSP Gate Failure → Retry**
When FRS-2's LSP gate reports errors (not warnings) on the applied patch, the adapter MUST:
1. Capture the diagnostics (file, line, severity, message)
2. Concatenate the original problem + the applied patch + the diagnostics
3. Send to the LLM with instruction: "The following patch has type errors. Fix them and regenerate a valid unified diff."
4. Max 2 retries per LSP failure

**FR-7.3 — Retry Budget**
Total retries per instance: max 2. If both retries fail (patch still doesn't apply or LSP still reports errors), mark the instance as `failed` with `failure_classification: "max_retries_exceeded"`.

**FR-7.4 — Failure Classification**
Each retry records:
- `attempt_number` (1, 2, 3)
- `failure_reason` (git_apply_error, lsp_error, llm_empty_response)
- `failure_detail` (the actual error message or diagnostics)
- `duration_ms` per attempt

### Acceptance Criteria

- [ ] At least 2 previously-failed instances resolve after self-correction loop
- [ ] LSP diagnostics fed back result in type-clean patches
- [ ] Max retry budget is enforced (never >3 total attempts)
- [ ] Failure classification is recorded in audit log

### Verification

```bash
# Run with retry enabled
python3 tools/swe-bench/adapter.py run-all --split dev --skip-eval --retry 2
# Check failure_classification in execution.json
```

---

## FRS-8: Best-of-3 Multi-Attempt

### Objective

The LLM is non-deterministic — `sqlfluff__sqlfluff-1625` resolved in run 1 but failed in run 2. Run 3 attempts per instance, keep the best patch. "Best" is defined as: applies cleanly → most meaningful diff (largest non-noop content).

### Functional Requirements

**FR-8.1 — Parallel Execution**
Run 3 attempts per instance. Each attempt gets its own LLM call with identical context (same model, same temperature=0.1). Attempts can be serial or parallel depending on API rate limits. Initial implementation: serial (linear), with option for parallel via `delegate_task`.

**FR-8.2 — Best Patch Selection**
After all 3 attempts complete:
1. Discard any attempts where `git apply --check` fails
2. Among successful attempts, rank by: patch length (longer = more meaningful), then by LSP gate result (clean > warned > rejected)
3. Pick the best patch and discard the others

**FR-8.3 — Result Recording**
The audit log records:
- `best_attempt` which attempt was selected (1, 2, or 3)
- `all_patches` array of all 3 patches with their status (passed/failed_applied/failed_lsp)
- `attempt_durations_ms` per attempt

**FR-8.4 — Cost Control**
3 attempts × baseline cost = 3x token cost per instance. Dev split (23 × 3 = 69 LLM calls). 
Optional: configurable in adapter CLI (`--attempts 3` default, `--attempts 1` for quick test).

### Acceptance Criteria

- [ ] Resolve rate with 3 attempts exceeds resolve rate with 1 attempt (measured on same run)
- [ ] Best patch selection correctly picks the most meaningful patch
- [ ] Cost is correctly accounted in run report

### Verification

```bash
# Single vs multi-attempt comparison
python3 tools/swe-bench/adapter.py run-all --split dev --skip-eval --attempts 1
python3 tools/swe-bench/adapter.py run-all --split dev --skip-eval --attempts 3

# Compare resolve rates
```

---

## FRS-9: Droid Execution with Aider Fallback

### Objective

Replace the direct OpenRouter API call with **Droid-executed** patch generation. Droid provisions the worktree, invokes the primary executor, captures the result, and tears down. The primary executor is a **Python script** that reads files and calls the LLM directly (already implemented as the adapter). Aider is the **fallback** — used only when the direct approach fails.

### Functional Requirements

**FR-9.1 — Droid Execution Lifecycle (formalized)**
The adapter MUST follow this lifecycle for every instance:

```
PROVISION → ANALYZE (FRS-6) → GENERATE (Droid) → APPLY → VERIFY (LSP Gate) → 
  (if fail) → CORRECT (FRS-7) → REAPPLY → REVERIFY → CAPTURE → TEARDOWN
```

Each phase is a discrete, auditable step. No phase runs without logging.

**FR-9.2 — Aider as Fallback Executor**
When the primary Droid executor (direct LLM call) fails after max retries, Droid MAY invoke Aider as a fallback:
1. Provision a fresh worktree (discard the failed one)
2. Install pinned `aider-chat==0.86.2` with `litellm==1.81.10` in a temporary venv
3. Run Aider headlessly: `aider --no-git --yes-always --model openrouter/deepseek/deepseek-v4-flash --message <problem>`
4. Capture patch, apply, verify
5. Teardown

**FR-9.3 — Fallback Budget**
Aider fallback runs only when primary executor fails all 3 attempts (FRS-8). This keeps Aider as the last resort, not the default path.

**FR-9.4 — No Aider as Architecture Dependency**
Aider is NEVER the primary executor. Aider is NEVER wired into the state machine. Aider is a pure fallback invoked via subprocess and torn down after use. The architecture contract is: **Droid orchestrates; executors are pluggable.**

### Acceptance Criteria

- [ ] Primary executor (direct LLM) runs on all instances by default
- [ ] Aider fallback runs on at least 1 previously-failed instance and produces a patch
- [ ] Droid lifecycle is fully logged per phase
- [ ] Aider is never the primary executor (verified by code: Droid calls API directly first)

### Verification

```bash
# Normal flow (no Aider)
python3 tools/swe-bench/adapter.py run --instance-id sqlfluff__sqlfluff-1625

# Force Aider fallback
python3 tools/swe-bench/adapter.py run --instance-id sqlfluff__sqlfluff-2419 --force-fallback

# Verify: check execution.json for executor field
python3 -c "
import json
d=json.load(open('.hermes/logs/swe-bench/sqlfluff__sqlfluff-2419/execution.json'))
print('Executor:', d.get('executor'))
"
```

---

## Dependencies Between Items

```
FRS-6 (CoT Prompting) ──── independent ──── No dependencies
FRS-7 (Self-Correction) ── depends on ──▶ FRS-6 (uses CoT context)
FRS-8 (Best-of-3) ──────── depends on ──▶ FRS-7 (uses retry logic)
FRS-9 (Droid Execution) ── independent ──── Parallel implementation
```

Implementation order:
1. FRS-6 (CoT) — pure prompt change, highest ROI
2. FRS-7 (Self-Correction) — builds on CoT
3. FRS-8 (Multi-Attempt) — builds on retry logic
4. FRS-9 (Droid Execution) — parallel, independent

---

## Testing Strategy

| Capability | Test Level | File | Coverage |
|-----------|-----------|------|----------|
| FRS-6 | Integration | `tests/optimization/cot-prompt.test.py` | CoT produces analysis before diff |
| FRS-7 | Integration | `tests/optimization/self-correction.test.py` | Retry on git error, LSP error |
| FRS-8 | Integration | `tests/optimization/multi-attempt.test.py` | Best-of-3 selection logic |
| FRS-9 | Integration | `tests/optimization/droid-lifecycle.test.py` | Lifecycle phase logging, fallback chain |

All tests run against the SWE-bench dev split. No mocks — real LLM calls, real git operations. Test cost budget: ~50K tokens per test run.

---

## Boundaries

### Always do
- Compare every optimization experiment against BASELINE_COMMITTED.json
- Record all experiments in `docs/SWE-BENCH-EXPERIMENTS-*.md`
- Attach the FRS to its Kanban task on the `hermes-sdlc` board
- Use the same model (deepseek/deepseek-v4-flash) across all A/B comparisons

### Ask first
- Changing the evaluation split (dev → test) for optimization experiments
- Adding a new executor beyond Aider (e.g., Claude Code CLI, Codex CLI)
- Increasing retry budget beyond 3 total attempts per instance

### Never do
- Add interactive debugging, inline suggestions, or IDE features
- Make Aider the primary executor or wire it into the state machine
- Change the baseline comparison methodology without documenting it
- Claim improved resolve rate without a controlled A/B test against the committed baseline

---

## Success Criteria (Overall)

- [ ] FRS-6: Dev split resolve rate improves by ≥3pp vs baseline (target: 8.7% → ~12-18%)
- [ ] FRS-7: ≥2 previously-failed instances resolve after self-correction loop
- [ ] FRS-8: 3-attempt resolve rate exceeds 1-attempt resolve rate on same batch
- [ ] FRS-9: Droid lifecycle formalized with phase-level logging; Aider fallback works on ≥1 instance
- [ ] Combined estimate (all 4 FRS items): **8.7% → ~20-25%** on dev split

---

## Open Questions

1. **CoT token cost**: 2 calls per instance doubles token spend. Dev split cost goes from ~$7 to ~$14. Acceptable?
2. **Multi-attempt parallelism**: Serial (3 sequential calls per instance) takes 3x wall time (~90 min). Parallel (3 concurrent calls) takes ~30 min but hits API rate limits. Preference?
3. **Aider fallback venv**: Need to pre-build the pinned venv (`/tmp/aider-venv`) with `aider-chat==0.86.2` + `litellm==1.81.10`. Already partially exists. Ok to use this?

---

## Resolved Decisions

| Question | Decision | Rationale |
|----------|----------|-----------|
| Q — Primary executor? | ✅ Droid (direct LLM call) | Aider is fallback only, per user direction |
| Q — Aider architecture? | ✅ Subprocess, torn down after use | Never wired into state machine |
| Q — Model for all experiments? | ✅ deepseek/deepseek-v4-flash | Same model isolation. Model swap is a separate experiment |
