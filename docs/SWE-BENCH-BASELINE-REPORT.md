# SWE-bench Lite Baseline — Phase 0 Execution Report

**Date:** 2026-06-27  
**Status:** Infrastructure validated, baseline measurement **blocked** (API auth)  
**Executor tested:** OpenRouter API (direct LLM call via `call_llm` in adapter)

---

## What Was Built

### Hermes → SWE-bench Lite Adapter (`/tmp/hermes-swe-bench-v3.py`)

A Python adapter that:

1. **Loads SWE-bench Lite instances** from HuggingFace via `datasets` library
2. **Provisions worktrees** — sparse-clones each repo at the exact `base_commit`:
   - `git init + remote add + fetch --depth 1 + checkout`
   - Average: 5-15s per repo (sqlfluff, pvlib, astroid, pydicom, etc.)
3. **Generates patches via OpenRouter API** (DeepSeek V4 Flash):
   - Constructs a system prompt with diff format rules
   - Sends problem_statement + file tree as user prompt
   - Captures raw LLM response
4. **Applies patches** to worktree (try `git apply`, fallback `patch -p1`)
5. **Captures final diff** via `git diff`
6. **Logs everything** under `.hermes/logs/swe-bench/{instance_id}/`
7. **Supports batch mode** — `python3 v3.py all-dev` runs all 23 dev instances

### Verified Working

| Component | Status | Details |
|-----------|--------|---------|
| SWE-bench installation | ✅ | v4.1.0, pip installed |
| Dataset loading | ✅ | 23 dev + 300 test instances |
| Worktree provisioning | ✅ | Tested on sqlfluff/sqlfluff (212 .py files, 5s clone) |
| Log structure | ✅ | `.hermes/logs/swe-bench/` with execution.json per instance |
| Ground truth analysis | ✅ | Can read ground_truth patch, test_patch, FAIL_TO_PASS/PASS_TO_PASS |

---

## Blocker: OpenRouter API Key Expired

The `OPENROUTER_API_KEY` in `~/.env` returns HTTP 401 Unauthorized.

**Diagnosis:**
- Key length: 73 chars (correct for `sk-or-v1-...`)
- Endpoint: `openrouter.ai/api/v1/chat/completions` returns 401
- Alternate endpoint `api.openrouter.ai` doesn't resolve (DNS — consistent with Tailscale DNS issue documented in agent-selection-matrix references)
- The Hermes agent chat works via LiteLLM on a different route or with a different credential

**Options to unblock:**
1. **Regenerate OpenRouter API key** — visit openrouter.ai/keys, create new key, update `~/.env`
2. **Use DeepSeek direct API** — if you have a DeepSeek API key, the adapter can switch to `api.deepseek.com/v1/chat/completions`
3. **Use Anthropic/Claude API** — if you have an Anthropic key (suitable for coding tasks)
4. **Fix OpenRouter DNS** — if the Tailscale DNS issue is the root cause: `nslookup api.openrouter.ai`

---

## Infrastructure Readiness

### Dev Split (23 instances) — Ready to Run

Once the API key is resolved, run:

```bash
/Library/Frameworks/Python.framework/Versions/3.11/bin/python3 /tmp/hermes-swe-bench-v3.py all-dev
```

Expected time: ~23 instances × ~60-120s each = **~30-45 minutes total**
Cost: ~300K tokens per instance × 23 × ~$0.001/1K tokens ≈ **~$7** for dev split

### Test Split (300 instances) — Infrastructure Ready

```bash
# Need to modify the adapter for test split (all-test mode)
python3 -c "
from datasets import load_dataset
ds = load_dataset('SWE-bench/SWE-bench_Lite', split='test')
print(f'{len(ds)} instances across {len(set(i[\"repo\"] for i in ds))} repos')
"
```

Expected time: 300 × ~90s average = **~7.5 hours** (or parallelize with Kanban dispatch)
Cost: ~$90 for full test split

### SWE-bench Evaluation (via Podman)

The `swebench.harness` package is installed and can evaluate generated patches. The harness uses the `docker` Python package, but on this system the Docker socket (`/var/run/docker.sock`) is symlinked to Podman's socket:

```bash
/var/run/docker.sock → /Users/warren/.local/share/containers/podman/machine/podman.sock
```

So evaluation runs on **Podman** transparently. Set the DOCKER_HOST explicitly:

```bash
export DOCKER_HOST=unix:///Users/warren/.local/share/containers/podman/machine/podman.sock
python3 -m swebench.harness.run_evaluation \
  --dataset_name SWE-bench/SWE-bench_Lite \
  --split dev \
  --predictions_path predictions.json \
  --output_dir results/
```

Podman machine: podman-machine-default (2 CPUs, 8GB RAM, 60GB disk, running)

---

## Projected Baseline (Estimate Before Running)

Based on published SWE-bench Lite leaderboard scores for equivalent models:

| Executor | Estimated Dev Resolve Rate | Estimated Test Resolve Rate |
|----------|---------------------------|----------------------------|
| DeepSeek V4 Flash (direct prompt) | 8-15% | 5-10% |
| DeepSeek V4 Flash + Aider | 12-20% | 8-15% |
| Claude Sonnet 4 | 25-35% | 20-30% |
| GPT-4o | 20-30% | 15-25% |

The exact baseline will be determined once the API key is resolved and the adapter runs.

---

## Files Created

| File | Purpose |
|------|---------|
| `docs/FRS-002-agentic-coding-capability.md` | Func/tech spec for agentic coding capability |
| `.hermes/logs/swe-bench/` | Execution logs directory |
| `/tmp/hermes-swe-bench-v3.py` | Main adapter script (readable from any shell) |
| `/tmp/swe-bench-worktrees/` | Cloned repo worktrees (will be cleaned) |
