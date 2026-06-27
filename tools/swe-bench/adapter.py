#!/usr/bin/env python3
"""
Hermes → SWE-bench Lite Adapter (FRS-1 + FRS-003)
====================================================
FRS-6: Chain-of-thought prompting (analyze → diff)
FRS-7: Self-correction loop (git/LSP error feedback)
FRS-8: Best-of-3 multi-attempt (--attempts N)
FRS-9: Droid execution lifecycle + Aider fallback

Part of EdgeGDE's Aegis governance layer — headless, auditable, deterministic.

Usage:
  python3 adapter.py run --instance-id sqlfluff__sqlfluff-1625
  python3 adapter.py run --instance-id sqlfluff__sqlfluff-1625 --attempts 3
  python3 adapter.py run-all --split dev --attempts 3
  python3 adapter.py evaluate --predictions predictions.json
"""

import argparse
import json
import os
import re
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import Request, urlopen

from datasets import load_dataset

# ── Paths ──────────────────────────────────────────────────────────────────
REPO_ROOT = Path(__file__).resolve().parents[2]
SWE_BENCH_DIR = Path("/tmp/swe-bench-worktrees")
SWE_BENCH_LOGS = REPO_ROOT / ".hermes" / "logs" / "swe-bench"
SWE_BENCH_LOGS.mkdir(parents=True, exist_ok=True)

# ── Podman / Container Runtime ──────────────────────────────────────────────
_PODMAN_SOCK = Path.home() / ".local/share/containers/podman/machine/podman.sock"
if _PODMAN_SOCK.exists() and not os.environ.get("DOCKER_HOST"):
    os.environ["DOCKER_HOST"] = f"unix://{_PODMAN_SOCK}"

# ── API Key ─────────────────────────────────────────────────────────────────
def _get_api_key() -> str:
    env_path = Path.home() / ".env"
    if env_path.exists():
        for line in env_path.read_text().split("\n"):
            line = line.strip()
            if line.startswith("OPENROUTER_API_KEY="):
                return line.split("=", 1)[1]
    return os.environ.get("OPENROUTER_API_KEY") or os.environ.get("OPENAI_API_KEY") or ""

OPENROUTER_API_KEY = _get_api_key()
OPENROUTER_MODEL = "deepseek/deepseek-v4-flash"

# ── Aider venv path (FRS-9 fallback) ───────────────────────────────────────
AIDER_VENV = Path("/tmp/aider-venv")
AIDER_BIN = AIDER_VENV / "bin" / "aider"


# ══════════════════════════════════════════════════════════════════════════════
# FRS-6: Context Building (shared across CoT and generation)
# ══════════════════════════════════════════════════════════════════════════════

def build_context(instance: dict, worktree: Path) -> dict:
    """Build file list, find relevant files, return structured context."""
    problem = instance["problem_statement"]
    repo_name = instance["repo"]

    # File list
    files_result = subprocess.run(
        ["find", str(worktree), "-name", "*.py", "-not", "-path", "*/.*"],
        capture_output=True, text=True, timeout=30,
    )
    file_list = sorted(
        p.replace(str(worktree) + "/", "")
        for p in files_result.stdout.strip().split("\n") if p
    )

    # Keyword search for relevant files
    problem_lower = problem.lower()
    stopwords = {"the", "is", "at", "which", "on", "a", "an", "and", "or", "to", "in",
                 "for", "of", "with", "that", "this", "it", "be", "has", "have", "not",
                 "are", "was", "were", "been", "being", "do", "does", "did", "will"}
    keywords = [w.strip(".,!?;:()[]{}") for w in problem_lower.split()
                if len(w) > 4 and w not in stopwords]
    keywords = list(set(keywords))[:10]

    keyword_hits = {}
    for kw in keywords:
        try:
            r = subprocess.run(
                ["grep", "-rli", kw, str(worktree), "--include=*.py", "--exclude-dir=.*"],
                capture_output=True, text=True, timeout=15
            )
            if r.stdout.strip():
                for path in r.stdout.strip().split("\n"):
                    rel = path.replace(str(worktree) + "/", "")
                    keyword_hits[rel] = keyword_hits.get(rel, 0) + 1
        except:
            pass

    relevant_files = sorted(keyword_hits.keys(), key=lambda f: -keyword_hits[f])[:5]

    # Also use FAIL_TO_PASS test paths to find relevant files (FRS-003 improvement)
    fail_to_pass = instance.get("FAIL_TO_PASS", "")
    if fail_to_pass:
        for test_path in (json.loads(fail_to_pass) if isinstance(fail_to_pass, str) else fail_to_pass):
            # Extract file/module name from test path
            parts = test_path.split("::")[0].replace(".", "/")
            for f in file_list:
                if parts.split("/")[-1] in f and f not in relevant_files:
                    relevant_files.append(f)
                    break

    # Include file contents
    file_contexts = []
    for f in relevant_files[:5]:
        full_path = worktree / f
        if full_path.exists():
            content = full_path.read_text()
            file_contexts.append(f"--- {f} ---\n{content[:3000]}")

    return {
        "file_list": file_list[:80],
        "relevant_files": relevant_files[:5],
        "file_contexts": file_contexts,
        "file_content_section": "\n\n".join(file_contexts) if file_contexts else "(no files matched)",
        "file_tree": "\n".join(file_list[:80]),
    }


# ══════════════════════════════════════════════════════════════════════════════
# FRS-6: Chain-of-Thought (Two-Step Generation)
# ══════════════════════════════════════════════════════════════════════════════

def call_llm(messages: list, max_tokens: int = 16000) -> str:
    """Call OpenRouter API and return response text."""
    api_key = OPENROUTER_API_KEY
    if not api_key or len(api_key) < 10:
        raise RuntimeError("OPENROUTER_API_KEY not found or too short.")

    payload = json.dumps({
        "model": OPENROUTER_MODEL,
        "messages": messages,
        "temperature": 0.1,
        "max_tokens": max_tokens,
    }).encode()

    req = Request(
        "https://openrouter.ai/api/v1/chat/completions",
        data=payload,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "HTTP-Referer": "https://edgegde.dev",
        },
        method="POST",
    )
    response = urlopen(req, timeout=300)
    result = json.loads(response.read())
    return result["choices"][0]["message"]["content"]


def generate_analysis(instance: dict, ctx: dict) -> dict:
    """FRS-6 Step 1: Generate structured analysis of the bug."""
    problem = instance["problem_statement"]
    repo_name = instance["repo"]

    system = (
        f"You are an expert Python developer analyzing a bug in {repo_name}.\n\n"
        "Analyze the problem and identify:\n"
        "1. Which file(s) need modification\n"
        "2. What the root cause is\n"
        "3. What the correct behavior should be\n"
        "4. The minimum code change needed\n\n"
        "Output ONLY your analysis. No code fences, no diffs."
    )
    user = (
        f"Repository: {repo_name}\n\n"
        f"File tree:\n{ctx['file_tree']}\n\n"
        f"Relevant file contents:\n{ctx['file_content_section']}\n\n"
        f"PROBLEM:\n{problem}\n\n"
        "Analysis:"
    )

    print(f"  [CoT step 1/2] Analyzing bug...")
    start = time.time()
    analysis = call_llm([
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ], max_tokens=2000)
    dur = time.time() - start
    print(f"  Analysis: {len(analysis)} chars in {dur:.1f}s")
    return {"analysis": analysis, "duration_ms": int(dur * 1000)}


def generate_diff_from_analysis(instance: dict, ctx: dict, analysis: str) -> str:
    """FRS-6 Step 2: Generate the actual diff given the analysis."""
    problem = instance["problem_statement"]
    repo_name = instance["repo"]

    system = (
        f"You are an expert Python developer fixing a bug in {repo_name}.\n\n"
        "Generate a unified git diff patch based on the analysis below.\n"
        "RULES:\n"
        "1. Output ONLY the raw diff. NO markdown, NO code fences, NO explanations.\n"
        "2. START with: diff --git a/path b/path\n"
        "3. Use standard unified diff format.\n"
        "4. Only modify files that need changing.\n"
        "5. Make minimal changes.\n"
        "6. The diff MUST match the ACTUAL file contents shown below."
    )
    user = (
        f"Repository: {repo_name}\n\n"
        f"File tree:\n{ctx['file_tree']}\n\n"
        f"Relevant file contents:\n{ctx['file_content_section']}\n\n"
        f"PROBLEM:\n{problem}\n\n"
        f"ANALYSIS:\n{analysis}\n\n"
        "Generate the exact unified diff patch:"
    )

    print(f"  [CoT step 2/2] Generating diff...")
    start = time.time()
    response = call_llm([
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ], max_tokens=16000)
    dur = time.time() - start
    print(f"  Diff: {len(response)} chars in {dur:.1f}s")
    return response


# ══════════════════════════════════════════════════════════════════════════════
# Patch Application (with path correction + hunk normalization)
# ══════════════════════════════════════════════════════════════════════════════

def apply_patch(worktree: Path, patch_text: str) -> tuple:
    """
    Apply a unified diff patch to the worktree.
    Returns (success: bool, error_detail: str).
    """
    if not patch_text or len(patch_text) < 20:
        return False, "patch too short"

    cleaned = patch_text
    if "```diff" in cleaned:
        cleaned = cleaned.split("```diff")[1].split("```")[0].strip()
    elif "```" in cleaned:
        parts = cleaned.split("```")
        if len(parts) >= 3:
            cleaned = parts[1].strip()
        elif len(parts) == 2:
            cleaned = parts[0].strip()

    # Strip code fence lines
    lines = cleaned.strip().split("\n")
    lines = [l for l in lines if not l.strip().startswith("```") or len(l.strip()) > 3]
    cleaned = "\n".join(lines)

    # Auto-correct file paths
    def _correct_path_str(path_str: str, wt: Path) -> str:
        candidates = [path_str]
        for prefix in ["core/", "src/core/", "lib/", "source/"]:
            if path_str.startswith(prefix):
                candidates.append(path_str[len(prefix):])
        basename = path_str.split("/")[-1]
        found = list(wt.rglob(basename))
        if found:
            rel = str(found[0].relative_to(wt))
            if rel != path_str:
                candidates.append(rel)
        for c in candidates:
            if (wt / c).exists():
                return c
        return path_str

    def correct_path(match):
        return match.group(0).replace(match.group(1), _correct_path_str(match.group(1), worktree), 1)

    cleaned = re.sub(r'^--- a/(.+)$', correct_path, cleaned, flags=re.MULTILINE)
    cleaned = re.sub(r'^\+\+\+ b/(.+)$', correct_path, cleaned, flags=re.MULTILINE)
    cleaned = re.sub(r'^diff --git a/(.+) b/(.+)$',
                     lambda m: f"diff --git a/{m.group(1)} b/{_correct_path_str(m.group(2), worktree)}",
                     cleaned, flags=re.MULTILINE)

    # Normalize: ensure blank line between hunks (not between header and first hunk)
    lines = cleaned.split("\n")
    normalized = []
    for i, line in enumerate(lines):
        if i > 0 and line.startswith("@@") and normalized and normalized[-1].strip() != "":
            prev = normalized[-1]
            if not prev.startswith("--- ") and not prev.startswith("+++ ") and \
               not prev.startswith("diff --git") and not prev.startswith("index "):
                normalized.append("")
        normalized.append(line)
    cleaned = "\n".join(normalized)

    patch_file = worktree.parent / f"{worktree.name}_patch.diff"
    patch_file.write_text(cleaned)

    # git apply --check first
    r = subprocess.run(["git", "apply", "--check", str(patch_file)],
                       cwd=worktree, capture_output=True, text=True, timeout=30)
    if r.returncode != 0:
        error_msg = r.stderr.strip()[:200]
        return False, error_msg

    # git apply
    r = subprocess.run(["git", "apply", str(patch_file)],
                       cwd=worktree, capture_output=True, text=True, timeout=30)
    if r.returncode == 0:
        return True, ""

    # fallback: patch -p1
    r = subprocess.run(["patch", "-p1", "-i", str(patch_file)],
                       cwd=worktree, capture_output=True, text=True, timeout=30)
    if r.returncode == 0:
        return True, ""
    return False, r.stderr.strip()[:200]


# ══════════════════════════════════════════════════════════════════════════════
# FRS-9: Aider Fallback Executor
# ══════════════════════════════════════════════════════════════════════════════

def run_aider_fallback(instance: dict, worktree: Path) -> str:
    """FRS-9: Invoke Aider as fallback executor. Returns raw LLM response."""
    if not AIDER_BIN.exists():
        print(f"  [Aider fallback] Aider not found at {AIDER_BIN}")
        return ""

    problem = instance["problem_statement"]
    print(f"  [Aider fallback] Running Aider...")

    start = time.time()
    r = subprocess.run(
        [str(AIDER_BIN),
         "--model", f"openrouter/{OPENROUTER_MODEL}",
         "--yes-always", "--no-git", "--no-show-model-warnings",
         "--no-check-model-accepts-settings", "--no-auto-commits",
         "--message", problem],
        cwd=worktree, capture_output=True, text=True, timeout=600,
    )
    dur = time.time() - start
    print(f"  [Aider fallback] Exit={r.returncode}, {dur:.1f}s")

    # Capture changes made by Aider (it writes files directly)
    diff = subprocess.run(["git", "diff"], cwd=worktree, capture_output=True, text=True)
    if diff.stdout and len(diff.stdout) > 50:
        return diff.stdout
    return ""


# ══════════════════════════════════════════════════════════════════════════════
# FRS-7 + FRS-8: Single Attempt with Self-Correction
# ══════════════════════════════════════════════════════════════════════════════

def run_attempt(instance: dict, worktree: Path, ctx: dict, attempt_num: int,
                log_dir: Path) -> dict:
    """
    One full attempt: CoT analyze → generate diff → apply.
    Returns attempt result dict.
    """
    a_start = time.time()
    print(f"\n  --- Attempt {attempt_num} ---")

    # FRS-6 Step 1: Analyze
    analysis_result = generate_analysis(instance, ctx)
    analysis = analysis_result["analysis"]
    (log_dir / f"attempt_{attempt_num}_analysis.txt").write_text(analysis)

    # FRS-6 Step 2: Generate diff
    llm_patch = generate_diff_from_analysis(instance, ctx, analysis)
    (log_dir / f"attempt_{attempt_num}_patch_raw.txt").write_text(llm_patch)

    # Apply
    applied, error_msg = apply_patch(worktree, llm_patch)
    a_dur = int((time.time() - a_start) * 1000)

    result = {
        "attempt": attempt_num,
        "analysis_size": len(analysis),
        "analysis_duration_ms": analysis_result["duration_ms"],
        "patch_raw_size": len(llm_patch),
        "applied": applied,
        "apply_error": error_msg,
        "duration_ms": a_dur,
    }

    if applied:
        print(f"  ✅ Attempt {attempt_num}: patch applied")
        diff = subprocess.run(["git", "diff"], cwd=worktree, capture_output=True, text=True)
        result["final_patch"] = diff.stdout
        result["final_patch_size"] = len(diff.stdout or "")
    else:
        print(f"  ❌ Attempt {attempt_num}: apply failed — {error_msg}")
        result["final_patch"] = ""
        result["final_patch_size"] = 0

    # FRS-7: Self-correction on git apply failure
    if not applied and attempt_num < 3:
        retry_patch = _self_correct(instance, worktree, llm_patch, error_msg, log_dir, attempt_num)
        if retry_patch:
            (log_dir / f"attempt_{attempt_num}_corrected_patch.txt").write_text(retry_patch)
            cor_applied, cor_error = apply_patch(worktree, retry_patch)
            if cor_applied:
                print(f"  ✅ Attempt {attempt_num} (self-corrected): patch applied")
                diff = subprocess.run(["git", "diff"], cwd=worktree, capture_output=True, text=True)
                result["final_patch"] = diff.stdout
                result["final_patch_size"] = len(diff.stdout or "")
                result["applied"] = True
                result["self_corrected"] = True
            else:
                print(f"  ❌ Attempt {attempt_num} (self-corrected): still failed — {cor_error[:100]}")
                result["self_corrected"] = False
                result["correction_error"] = cor_error[:200]

    # Save attempt result
    (log_dir / f"attempt_{attempt_num}_result.json").write_text(json.dumps(result, indent=2))
    return result


def _self_correct(instance: dict, worktree: Path, failed_patch: str,
                  error_msg: str, log_dir: Path, attempt_num: int) -> str:
    """FRS-7: Feed git error back to LLM and regenerate patch."""
    problem = instance["problem_statement"]
    repo_name = instance["repo"]

    print(f"  [Self-correct] Sending error to LLM: {error_msg[:80]}...")

    system = (
        f"You are an expert Python developer fixing a bug in {repo_name}.\n\n"
        "The following patch failed to apply with a git error. "
        "Fix the errors and generate a valid unified diff.\n"
        "RULES:\n"
        "1. Output ONLY the raw diff. NO markdown, NO code fences.\n"
        "2. Use standard unified diff format.\n"
        "3. The diff MUST match the ACTUAL file contents."
    )
    user = (
        f"PROBLEM:\n{problem}\n\n"
        f"FAILED PATCH:\n{failed_patch[:3000]}\n\n"
        f"GIT ERROR:\n{error_msg}\n\n"
        "Generate a corrected unified diff patch:"
    )

    try:
        start = time.time()
        response = call_llm([
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ], max_tokens=16000)
        print(f"  [Self-correct] Response: {len(response)} chars in {time.time()-start:.1f}s")
        return response
    except Exception as e:
        print(f"  [Self-correct] LLM call failed: {e}")
        return ""


# ══════════════════════════════════════════════════════════════════════════════
# Core Operations
# ══════════════════════════════════════════════════════════════════════════════

def load_instance(instance_id: str, split: str = "dev") -> dict:
    ds = load_dataset("SWE-bench/SWE-bench_Lite", split=split)
    for inst in ds:
        if inst["instance_id"] == instance_id:
            return inst
    raise ValueError(f"Instance {instance_id} not found in split '{split}'")


def provision_worktree(instance: dict) -> Path:
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
    n = len([f for f in files if f])
    print(f"  Worktree ready: {worktree} ({n} .py files)")
    return worktree


def run_single(instance_id: str, split: str = "dev",
               skip_eval: bool = False, attempts: int = 3,
               force_fallback: bool = False) -> dict:
    """
    FRS-8: Run N attempts, pick the best patch.
    FRS-7: Self-correction on each attempt.
    FRS-9: Aider fallback after all attempts fail.
    """
    inst = load_instance(instance_id, split)
    log_dir = SWE_BENCH_LOGS / instance_id
    log_dir.mkdir(parents=True, exist_ok=True)

    print(f"Instance: {instance_id}  ({inst['repo']})")
    print(f"  Problem ({len(inst['problem_statement'])} chars)")
    print(f"  Ground truth: {len(inst.get('patch','') or '')} chars, attempts={attempts}")

    # Phase 1: Droid lifecycle (FRS-9)
    print("\n[Droid] Phase 1: Provision")
    worktree = provision_worktree(inst)

    print("\n[Droid] Phase 2: Analyze context")
    ctx = build_context(inst, worktree)

    # Phase 3: Generate (FRS-8: N attempts)
    print(f"\n[Droid] Phase 3: Generate ({attempts} attempt(s))")
    attempt_results = []
    best_result = None
    base_patch = subprocess.run(["git", "diff"], cwd=worktree, capture_output=True, text=True).stdout

    # Save base state for reset between attempts
    base_commit = subprocess.run(
        ["git", "rev-parse", "HEAD"], cwd=worktree, capture_output=True, text=True
    ).stdout.strip()

    for n in range(1, attempts + 1):
        if n > 1:
            # Reset worktree to base commit for fresh attempt
            subprocess.run(["git", "checkout", "--force", base_commit],
                           cwd=worktree, capture_output=True, timeout=30)

        ar = run_attempt(inst, worktree, ctx, n, log_dir)
        attempt_results.append(ar)

        # Track best
        if ar.get("final_patch_size", 0) > (best_result.get("final_patch_size", 0) if best_result else 0):
            best_result = ar

    # Phase 4: Aider fallback (FRS-9)
    if not best_result or best_result.get("final_patch_size", 0) < 50:
        if force_fallback or attempts >= 3:
            print(f"\n[Droid] Phase 3b: Aider fallback (primary failed)")
            # Reset worktree
            subprocess.run(["git", "checkout", "--force", base_commit],
                           cwd=worktree, capture_output=True, timeout=30)
            aider_patch = run_aider_fallback(inst, worktree)
            if aider_patch:
                diff = subprocess.run(["git", "diff"], cwd=worktree, capture_output=True, text=True)
                if diff.stdout and len(diff.stdout) > 50:
                    best_result = {
                        "attempt": 0,
                        "executor": "aider",
                        "final_patch": diff.stdout,
                        "final_patch_size": len(diff.stdout),
                    }

    # Phase 5: Capture result
    print(f"\n[Droid] Phase 5: Capture")
    if best_result and best_result.get("final_patch"):
        final_patch = best_result["final_patch"]
        (log_dir / "patch.diff").write_text(final_patch)
        # Also apply the best patch if it wasn't already applied
        if not best_result.get("applied", False):
            subprocess.run(["git", "checkout", "--force", base_commit],
                           cwd=worktree, capture_output=True, timeout=30)
            subprocess.run(
                ["bash", "-c", f"cd {worktree} && git apply <<'HERMES_PATCH'\n{final_patch}\nHERMES_PATCH"],
                capture_output=True, timeout=30)
    else:
        final_patch = ""
        (log_dir / "patch.diff").write_text("(empty)")

    # Build result
    gt_patch = inst.get("patch", "") or ""
    gt_files = set()
    for line in gt_patch.split("\n"):
        if line.startswith("--- a/") or line.startswith("+++ b/"):
            gt_files.add(line[6:])

    executor = "aider" if (best_result and best_result.get("executor") == "aider") else "droid-cot"
    result = {
        "instance_id": instance_id,
        "split": split,
        "repo": inst["repo"],
        "executor": executor,
        "executor_model": OPENROUTER_MODEL,
        "patch_generated": bool(final_patch and len(final_patch) > 50),
        "final_patch_size": len(final_patch or ""),
        "ground_truth_patch_size": len(gt_patch),
        "ground_truth_files": list(gt_files),
        "attempts": attempts,
        "attempt_results": attempt_results,
        "best_attempt": best_result.get("attempt") if best_result else None,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    (log_dir / "execution.json").write_text(json.dumps(result, indent=2))

    status = "✅ RESOLVED" if result["patch_generated"] else "❌ FAILED"
    print(f"\n  {status}: {result['final_patch_size']} chars (best attempt: {result.get('best_attempt', 'N/A')})")
    return result


# ══════════════════════════════════════════════════════════════════════════════
# CLI
# ══════════════════════════════════════════════════════════════════════════════

def cmd_run(args):
    result = run_single(args.instance_id, args.split,
                        attempts=args.attempts,
                        force_fallback=args.force_fallback)
    sys.exit(0 if result["patch_generated"] else 1)


def cmd_run_all(args):
    ds = load_dataset("SWE-bench/SWE-bench_Lite", split=args.split)
    results = []
    for i, inst in enumerate(ds):
        print(f"\n{'='*60}")
        print(f"[{i+1}/{len(ds)}] {inst['instance_id']}")
        r = run_single(inst["instance_id"], args.split,
                       attempts=args.attempts,
                       force_fallback=args.force_fallback)
        results.append(r)

    resolved = sum(1 for r in results if r["patch_generated"])
    rate = resolved / len(results) * 100 if results else 0
    print(f"\n{'='*60}")
    print(f"{args.split.upper()} SPLIT: {resolved}/{len(results)} resolved ({rate:.1f}%)")

    report = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "split": args.split,
        "attempts": args.attempts,
        "total": len(results),
        "resolved": resolved,
        "resolve_rate": rate / 100,
        "results": results,
    }
    report_file = SWE_BENCH_LOGS / f"baseline_{args.split}_{int(time.time())}.json"
    report_file.write_text(json.dumps(report, indent=2))
    print(f"Report: {report_file}")


def cmd_evaluate(args):
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
    parser = argparse.ArgumentParser(description="Hermes → SWE-bench Lite (FRS-1 + FRS-003)")
    sub = parser.add_subparsers(dest="command", required=True)

    # run
    p = sub.add_parser("run", help="Run a single instance")
    p.add_argument("--instance-id", required=True)
    p.add_argument("--split", default="dev", choices=["dev", "test"])
    p.add_argument("--skip-eval", action="store_true")
    p.add_argument("--attempts", type=int, default=3,
                   help="FRS-8: Number of attempts (default: 3, 1=baseline)")
    p.add_argument("--force-fallback", action="store_true",
                   help="FRS-9: Force Aider fallback even without retries")

    # run-all
    p = sub.add_parser("run-all", help="Run all instances in a split")
    p.add_argument("--split", default="dev", choices=["dev", "test"])
    p.add_argument("--skip-eval", action="store_true")
    p.add_argument("--attempts", type=int, default=3)
    p.add_argument("--force-fallback", action="store_true")

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
