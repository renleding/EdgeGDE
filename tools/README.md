# EdgeGDE Governance Tools (FRS-1 through FRS-5)

This directory contains tools implementing the Aegis governance layer — headless,
automated, deterministic verification and orchestration tooling.

## Tools

### `swe-bench/`
SWE-bench Lite adapter — provisions worktrees, generates patches via LLM, evaluates results.

```bash
# Run a single instance
python3 swe-bench/adapter.py run --instance-id sqlfluff__sqlfluff-1625

# Run all dev split instances
python3 swe-bench/adapter.py run-all --split dev

# Evaluate existing predictions via SWE-bench harness (requires Podman)
export DOCKER_HOST=unix:///Users/warren/.local/share/containers/podman/machine/podman.sock
python3 swe-bench/adapter.py evaluate --predictions predictions.json
```

### `lsp-gate/`
Headless LSP Validation Gate — runs inside the state machine between EXECUTION and VERIFICATION.

```bash
# Validate a worktree (auto-detect language)
python3 lsp-gate/lsp-validate.py /path/to/worktree

# Validate with specific language
python3 lsp-gate/lsp-validate.py /path/to/worktree --language python

# Machine-readable output
python3 lsp-gate/lsp-validate.py /path/to/worktree --json
```

### `verification-suite.ts`
6-gate verification suite (TypeScript):
1. Git diff hygiene — rejects binary files, .env files, excluded dirs
2. LSP gate — headless type checking via pyright/tsc
3. Lint — ruff (Python) / eslint (TypeScript)
4. Test run — pytest (Python) / vitest (TypeScript)
5. Patch format — validates unified diff structure
6. Test patch apply — `git apply --check` dry run

```bash
npx tsx tools/verification-suite.ts
```

### `test-verification-suite.ts`
Unit tests for the verification suite.

```bash
npx tsx tools/test-verification-suite.ts
```

## CI Integration

CI validates Python syntax of all tools. Full SWE-bench regression detection
requires a valid API key and Podman runtime (local execution only — see FRS-5).

## Dependencies

```bash
pip install swebench>=4.0.0 datasets>=3.0.0
# LSP gate requires at least one of:
pip install pyright        # Python
npm install -g typescript  # TypeScript (has built-in tsc)
```
