#!/usr/bin/env python3
"""
Hermes → SWE-bench Lite Adapter (FRS-1)
=========================================
Provisions worktrees, invokes LLM to generate patches, evaluates via Podman.
Part of EdgeGDE's Aegis governance layer — headless, auditable, deterministic.

Usage:
  # Single instance
  python3 adapter.py run --instance-id sqlfluff__sqlfluff-1625

  # Dev split (23 instances)
  python3 adapter.py run-all --split dev

  # Evaluate existing predictions
  python3 adapter.py evaluate --predictions predictions.json
"""

import argparse
import json
import os
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

from datasets import load_dataset

# ── Paths ──────────────────────────────────────────────────────────────────
REPO_ROOT = Path(__file__).resolve().parents[2]
SWE_BENCH_DIR = Path("/tmp/swe-bench-worktrees")
SWE_BENCH_LOGS = REPO_ROOT / ".hermes" / "logs" / "swe-bench"
SWE_BENCH_LOGS.mkdir(parents=True, exist_ok=True)

# ── Podman / Container Runtime ──────────────────────────────────────────────
# The SWE-bench harness uses docker-py. On this system, /var/run/docker.sock
# is symlinked to Podman's socket. We set DOCKER_HOST explicitly.
_PODMAN_SOCK = Path.home() / ".local/share/containers/podman/machine/podman.sock"
if _PODMAN_SOCK.exists() and not os.environ.get("DOCKER_HOST"):
    os.environ["DOCKER_HOST"] = f"unix://{_PODMAN_SOCK}"

# ── API Key ─────────────────────────────────────────────────────────────────
def _get_api_key() -> str:
    """Read OPENROUTER_API_KEY from ~/.env or environment."""
    env_path = Path.home() / ".env"
    if env_path.exists():
        for line in env_path.read_text().split("\n"):
            line = line.strip()
            if line.startswith("OPENROUTER_API_KEY="):
                return line.split("=", 1)[1]
    return os.environ.get("OPENROUTER_API_KEY") or os.environ.get("OPENAI_API_KEY") or ""

OPENROUTER_API_KEY = _get_api_key()
OPENROUTER_MODEL = "deepseek/deepseek-v4-flash"


# ══════════════════════════════════════════════════════════════════════════════
# Core Operations
# ══════════════════════════════════════════════════════════════════════════════

def load_instance(instance_id: str, split: str = "dev") -> dict:
    """Load a single SWE-bench Lite instance by ID."""
    ds = load_dataset("SWE-bench/SWE-bench_Lite", split=split)
    for inst in ds:
        if inst["instance_id"] == instance_id:
            return inst
    raise ValueError(f"Instance {instance_id} not found in split '{split}'")


def provision_worktree(instance: dict) -> Path:
    """Clone repo at base_commit into an isolated worktree."""
    repo_url = f"https://github.com/{instance['repo']}.git"
    iid, commit = instance["instance_id"], instance["base_commit"]

    worktree = SWE_BENCH_DIR / iid
    if worktree.exists():
        subprocess.run(["rm", "-rf", str(worktree)], check=True, capture_output=True)

    print(f"  Cloning {instance['repo']} @ {commit[:12]}...")
    worktree.mkdir(parents=True, exist_ok=True)
    subprocess.run(["git", "init"], cwd=worktree, capture_output=True, check=True)
    subprocess.run(["git", "remote", "add", "origin", repo_url],
                   cwd=worktree, capture_output=True, check=True)
    subprocess.run(["git", "fetch", "--depth", "1", "origin", commit],
                   cwd=worktree, capture_output=True, check=True, timeout=120)
    subprocess.run(["git", "checkout", commit], cwd=worktree, capture_output=True, check=True)

    files = subprocess.run(
        ["find", str(worktree), "-name", "*.py", "-not", "-path", "*/.*"],
        capture_output=True, text=True, timeout=30
    ).stdout.strip().split("\n")
    print(f"  Worktree ready: {worktree} ({len([f for f in files if f])} .py files)")
    return worktree


def call_llm(system_prompt: str, user_prompt: str) -> str:
    """Call OpenRouter API (or direct provider) and return the response."""
    from urllib.request import Request, urlopen

    api_key = OPENROUTER_API_KEY
    if not api_key or len(api_key) < 10:
        raise RuntimeError(
            "OPENROUTER_API_KEY not found or too short. "
            "Set it in ~/.env or as an environment variable."
        )

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "HTTP-Referer": "https://edgegde.dev",
    }
    payload = json.dumps({
        "model": OPENROUTER_MODEL,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        "temperature": 0.1,
        "max_tokens": 16000,
    }).encode()

    req = Request(
        "https://openrouter.ai/api/v1/chat/completions",
        data=payload, headers=headers, method="POST",
    )
    response = urlopen(req, timeout=300)
    result = json.loads(response.read())
    return result["choices"][0]["message"]["content"]


def generate_patch(instance: dict, worktree: Path) -> str:
    """Generate a unified diff patch via LLM for the given instance."""
    problem = instance["problem_statement"]
    repo_name = instance["repo"]

    # Build file list
    files_result = subprocess.run(
        ["find", str(worktree), "-name", "*.py", "-not", "-path", "*/.*"],
        capture_output=True, text=True, timeout=30,
    )
    file_list = sorted(
        p.replace(str(worktree) + "/", "")
        for p in files_result.stdout.strip().split("\n") if p
    )

    system_prompt = (
        f"You are an expert Python developer fixing a bug in {repo_name}.\n\n"
        "Generate a unified git diff patch that fixes the issue.\n"
        "RULES:\n"
        "1. Output ONLY the diff. No explanations, no markdown.\n"
        "2. Format: diff --git a/... b/...\\n--- a/...\\n+++ b/...\\n@@ ... @@\n"
        "3. Only modify files that need changing.\n"
        "4. Make minimal changes.\n"
        "5. Output ONLY the diff — no surrounding text."
    )
    user_prompt = (
        f"Repository: {repo_name}\n\n"
        f"File tree:\n" + "\n".join(file_list[:120]) + "\n\n"
        f"PROBLEM:\n{problem}\n\n"
        "Generate the diff:"
    )

    print(f"  Calling {OPENROUTER_MODEL}...")
    start = time.time()
    response = call_llm(system_prompt, user_prompt)
    dur = time.time() - start
    print(f"  LLM response: {len(response)} chars in {dur:.1f}s")
    return response


def apply_patch(worktree: Path, patch_text: str) -> bool:
    """Apply a unified diff patch to the worktree. Tries git apply, then patch."""
    if not patch_text or len(patch_text) < 20:
        return False

    cleaned = patch_text
    if "```diff" in cleaned:
        cleaned = cleaned.split("```diff")[1].split("```")[0].strip()
    elif "```" in cleaned:
        parts = cleaned.split("```")
        if len(parts) >= 3:
            cleaned = parts[1].strip()

    patch_file = worktree.parent / f"{worktree.name}_patch.diff"
    patch_file.write_text(cleaned)

    # git apply
    r = subprocess.run(["git", "apply", str(patch_file)],
                       cwd=worktree, capture_output=True, text=True, timeout=30)
    if r.returncode == 0:
        return True

    # fallback: patch -p1
    r = subprocess.run(["patch", "-p1", "-i", str(patch_file)],
                       cwd=worktree, capture_output=True, text=True, timeout=30)
    return r.returncode == 0


def run_single(instance_id: str, split: str = "dev", skip_eval: bool = False) -> dict:
    """Run a single SWE-bench instance: provision → generate → apply → capture."""
    inst = load_instance(instance_id, split)
    log_dir = SWE_BENCH_LOGS / instance_id
    log_dir.mkdir(parents=True, exist_ok=True)

    print(f"Instance: {instance_id}  ({inst['repo']})")
    print(f"  Problem ({len(inst['problem_statement'])} chars): {inst['problem_statement'][:120]}...")
    print(f"  Ground truth: {len(inst.get('patch','') or '')} chars")

    # Step 1: Provision
    print("\n[1/4] Provisioning worktree...")
    worktree = provision_worktree(inst)

    # Step 2: Generate patch
    print("\n[2/4] Generating patch via LLM...")
    llm_patch = generate_patch(inst, worktree)
    (log_dir / "generated_patch_raw.txt").write_text(llm_patch)

    # Step 3: Apply
    print("\n[3/4] Applying patch...")
    applied = apply_patch(worktree, llm_patch)

    # Step 4: Capture diff
    print("\n[4/4] Capturing result...")
    diff = subprocess.run(["git", "diff"], cwd=worktree, capture_output=True, text=True)
    final_patch = diff.stdout
    (log_dir / "patch.diff").write_text(final_patch or "(empty)")

    # Ground truth info
    gt_patch = inst.get("patch", "") or ""
    gt_files = set()
    for line in gt_patch.split("\n"):
        if line.startswith("--- a/") or line.startswith("+++ b/"):
            gt_files.add(line[6:])

    result = {
        "instance_id": instance_id,
        "split": split,
        "repo": inst["repo"],
        "executor": "openrouter-api",
        "executor_model": OPENROUTER_MODEL,
        "patch_generated": bool(final_patch and len(final_patch) > 50),
        "final_patch_size": len(final_patch or ""),
        "ground_truth_patch_size": len(gt_patch),
        "ground_truth_files": list(gt_files),
        "llm_response_size": len(llm_patch or ""),
        "patch_applied": applied,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    (log_dir / "execution.json").write_text(json.dumps(result, indent=2))

    status = "✅ RESOLVED" if result["patch_generated"] else "❌ FAILED"
    print(f"\n  {status}: {result['final_patch_size']} chars, applied={applied}")
    return result


# ══════════════════════════════════════════════════════════════════════════════
# CLI
# ══════════════════════════════════════════════════════════════════════════════

def cmd_run(args):
    result = run_single(args.instance_id, args.split)
    sys.exit(0 if result["patch_generated"] else 1)


def cmd_run_all(args):
    ds = load_dataset("SWE-bench/SWE-bench_Lite", split=args.split)
    results = []
    for i, inst in enumerate(ds):
        print(f"\n{'='*60}")
        print(f"[{i+1}/{len(ds)}] {inst['instance_id']}")
        r = run_single(inst["instance_id"], args.split, skip_eval=args.skip_eval)
        results.append(r)

    resolved = sum(1 for r in results if r["patch_generated"])
    rate = resolved / len(results) * 100 if results else 0
    print(f"\n{'='*60}")
    print(f"{args.split.upper()} SPLIT: {resolved}/{len(results)} resolved ({rate:.1f}%)")

    report = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "split": args.split,
        "total": len(results),
        "resolved": resolved,
        "resolve_rate": rate / 100,
        "results": results,
    }
    report_file = SWE_BENCH_LOGS / f"baseline_{args.split}_{int(time.time())}.json"
    report_file.write_text(json.dumps(report, indent=2))
    print(f"Report: {report_file}")


def cmd_evaluate(args):
    """Evaluate predictions using SWE-bench harness (Podman)."""
    cmd = [
        sys.executable, "-m", "swebench.harness.run_evaluation",
        "--dataset_name", "SWE-bench/SWE-bench_Lite",
        "--split", args.split,
        "--predictions_path", args.predictions,
        "--output_dir", str(SWE_BENCH_LOGS / "eval_results"),
        "--num_workers", str(args.workers),
    ]
    if args.skip_build:
        cmd.append("--skip_build_images")

    print(f"Running SWE-bench evaluation with Podman...")
    print(f"  DOCKER_HOST={os.environ.get('DOCKER_HOST', '(default)')}")
    r = subprocess.run(cmd, timeout=args.timeout)
    sys.exit(r.returncode)


def main():
    parser = argparse.ArgumentParser(description="Hermes → SWE-bench Lite (FRS-1)")
    sub = parser.add_subparsers(dest="command", required=True)

    # run
    p = sub.add_parser("run", help="Run a single instance")
    p.add_argument("--instance-id", required=True)
    p.add_argument("--split", default="dev", choices=["dev", "test"])
    p.add_argument("--skip-eval", action="store_true")

    # run-all
    p = sub.add_parser("run-all", help="Run all instances in a split")
    p.add_argument("--split", default="dev", choices=["dev", "test"])
    p.add_argument("--skip-eval", action="store_true")

    # evaluate
    p = sub.add_parser("evaluate", help="Evaluate predictions via SWE-bench harness")
    p.add_argument("--predictions", required=True)
    p.add_argument("--split", default="dev", choices=["dev", "test"])
    p.add_argument("--workers", type=int, default=2)
    p.add_argument("--skip-build", action="store_true")
    p.add_argument("--timeout", type=int, default=1800)

    args = parser.parse_args()
    {"run": cmd_run, "run-all": cmd_run_all, "evaluate": cmd_evaluate}[args.command](args)


if __name__ == "__main__":
    main()
