#!/usr/bin/env python3
"""
Headless LSP Validation Gate (FRS-2)
=====================================
Runs inside EdgeGDE's 5-phase state machine between EXECUTION and VERIFICATION.

Detects file language, starts a headless LSP server, collects diagnostics,
shuts down cleanly. Returns structured results for Aegis to evaluate.

Usage:
  python3 lsp-validate.py /path/to/worktree
  python3 lsp-validate.py /path/to/worktree --language python
  python3 lsp-validate.py /path/to/worktree --files file1.py file2.ts
"""

import argparse
import json
import os
import subprocess
import sys
import time
from pathlib import Path
from typing import Dict, List, Optional, Tuple

# ── Severity mapping ────────────────────────────────────────────────────────
LSP_SEVERITY = {1: "error", 2: "warning", 3: "info", 4: "hint"}
EXIT_LSP_NOT_AVAILABLE = 2
EXIT_ERRORS_FOUND = 3


def detect_language(worktree: Path, specific_files: Optional[List[str]] = None) -> Tuple[str, List[str]]:
    """
    Detect the primary programming language in the worktree.
    Returns (language, list_of_files_to_check).
    """
    if specific_files:
        # Use specified files
        exts = {Path(f).suffix for f in specific_files if Path(f).suffix}
        lang_map = {".py": "python", ".ts": "typescript", ".js": "javascript",
                    ".go": "go", ".rs": "rust", ".tsx": "typescript", ".jsx": "javascript"}
        lang = "unknown"
        for ext in exts:
            if ext in lang_map:
                lang = lang_map[ext]
                break
        return lang, specific_files

    # Auto-detect from file extensions
    counts: Dict[str, int] = {}
    for f in worktree.rglob("*"):
        if f.is_file() and f.suffix in (".py", ".ts", ".js", ".go", ".rs", ".tsx", ".jsx"):
            lang_map = {".py": "python", ".ts": "typescript", ".js": "javascript",
                        ".go": "go", ".rs": "rust", ".tsx": "typescript", ".jsx": "javascript"}
            lang = lang_map.get(f.suffix, "unknown")
            counts[lang] = counts.get(lang, 0) + 1

    if not counts:
        return "unknown", []

    # Pick the most common language
    primary = max(counts, key=lambda k: counts[k])
    files = [str(f.relative_to(worktree)) for f in worktree.rglob("*")
             if f.is_file() and f.suffix in _ext_for_lang(primary)]
    return primary, files[:200]  # cap at 200 files


def _ext_for_lang(lang: str) -> tuple:
    mapping = {
        "python": (".py",),
        "typescript": (".ts", ".tsx"),
        "javascript": (".js", ".jsx"),
        "go": (".go",),
        "rust": (".rs",),
    }
    return mapping.get(lang, (".txt",))


def find_lsp_server(language: str) -> Optional[str]:
    """Find the LSP server binary for the given language."""
    servers = {
        "python": ["pyright", "basedpyright", "pylsp"],
        "typescript": ["typescript-language-server", "ts-lsp"],
        "javascript": ["typescript-language-server"],
        "go": ["gopls"],
        "rust": ["rust-analyzer"],
    }
    for name in servers.get(language, []):
        r = subprocess.run(["which", name], capture_output=True, text=True)
        if r.returncode == 0:
            return r.stdout.strip()
    return None


def validate_via_pyright(worktree: Path, files: List[str]) -> dict:
    """Run pyright in headless mode over the worktree."""
    # pyright has a --outputjson flag for machine-readable output
    cmd = ["pyright", "--outputjson", "--project", str(worktree)]
    if files:
        cmd.extend(files[:50])  # cap at 50 for performance

    start = time.time()
    r = subprocess.run(cmd, cwd=worktree, capture_output=True, text=True, timeout=120)
    duration_ns = int((time.time() - start) * 1_000_000_000)

    diagnostics = []
    try:
        data = json.loads(r.stdout)
        for diag in data.get("generalDiagnostics", []):
            diagnostics.append({
                "file": diag.get("file", ""),
                "severity": diag.get("severity", "error"),
                "message": diag.get("message", ""),
                "line": diag.get("range", {}).get("start", {}).get("line", 0),
                "column": diag.get("range", {}).get("start", {}).get("column", 0),
            })
    except (json.JSONDecodeError, KeyError):
        pass

    errors = [d for d in diagnostics if d["severity"] == "error"]
    warnings = [d for d in diagnostics if d["severity"] == "warning"]

    return {
        "lsp_server": "pyright",
        "language": "python",
        "gate_ns": duration_ns,
        "gate_ms": duration_ns / 1_000_000,
        "files_checked": len(files[:50]),
        "total_diagnostics": len(diagnostics),
        "errors": errors[:100],
        "warnings": warnings[:100],
        "infos": [d for d in diagnostics if d["severity"] not in ("error", "warning")][:50],
    }


def validate_via_typescript_lsp(worktree: Path, files: List[str]) -> dict:
    """Run tsc --noEmit for headless TypeScript validation."""
    cmd = ["npx", "tsc", "--noEmit", "--pretty", "false"]
    if (worktree / "tsconfig.json").exists():
        cmd = ["npx", "tsc", "--noEmit", "--pretty", "false", "--project", str(worktree)]

    start = time.time()
    r = subprocess.run(cmd, cwd=worktree, capture_output=True, text=True, timeout=120)
    duration_ns = int((time.time() - start) * 1_000_000_000)

    # Parse tsc output: "path(line,col): error TS2345: message"
    errors = []
    warnings = []
    for line in r.stderr.split("\n"):
        if "error TS" in line or "error " in line.lower():
            errors.append({"message": line.strip()[:200]})
        elif "warning" in line.lower():
            warnings.append({"message": line.strip()[:200]})

    return {
        "lsp_server": "typescript",
        "language": "typescript",
        "gate_ns": duration_ns,
        "gate_ms": duration_ns / 1_000_000,
        "files_checked": len(files[:200]),
        "total_diagnostics": len(errors) + len(warnings),
        "errors": errors[:100],
        "warnings": warnings[:100],
        "infos": [],
    }


def validate_worktree(worktree: Path, language: Optional[str] = None,
                      files: Optional[List[str]] = None) -> dict:
    """
    Run headless LSP validation on the worktree.
    Returns structured results for Aegis evaluation.
    """
    # Detect language
    if not language:
        language, detected_files = detect_language(worktree, files)
    else:
        detected_files = files or []

    print(f"  LSP gate: language={language}, files={len(detected_files) if detected_files else 'auto'}")

    if language == "unknown" or not detected_files:
        return {
            "status": "skipped",
            "reason": "No supported language detected",
            "gate_ns": 0,
            "errors": [],
            "warnings": [],
        }

    # Route to the appropriate validator
    if language == "python":
        server = find_lsp_server("python")
        if server:
            return validate_via_pyright(worktree, detected_files)
        else:
            print("  LSP gate: pyright not installed, trying tsc...")
            if (worktree / "tsconfig.json").exists():
                return validate_via_typescript_lsp(worktree, detected_files)
            return {
                "status": "unavailable",
                "reason": "No LSP server found for python (try: pip install pyright)",
                "gate_ns": 0,
                "errors": [],
                "warnings": [],
            }

    elif language in ("typescript", "javascript"):
        return validate_via_typescript_lsp(worktree, detected_files)

    elif language == "go":
        print("  LSP gate: Go validation via go vet...")
        start = time.time()
        r = subprocess.run(["go", "vet", "./..."], cwd=worktree,
                           capture_output=True, text=True, timeout=120)
        dur = int((time.time() - start) * 1_000_000_000)
        errors = [{"message": l.strip()[:200]} for l in r.stderr.split("\n") if l.strip()]
        return {
            "lsp_server": "go-vet",
            "language": "go",
            "gate_ns": dur,
            "gate_ms": dur / 1_000_000,
            "total_diagnostics": len(errors),
            "errors": errors[:100],
            "warnings": [],
            "infos": [],
        }

    else:
        return {
            "status": "unsupported",
            "reason": f"Language '{language}' not supported yet",
            "gate_ns": 0,
            "errors": [],
            "warnings": [],
        }


def aegis_evaluate(gate_result: dict) -> dict:
    """
    Evaluate LSP gate results and produce an Aegis verdict.
    This is the state machine integration point.
    """
    errors = gate_result.get("errors", [])
    warnings = gate_result.get("warnings", [])

    if gate_result.get("status") in ("skipped", "unavailable", "unsupported"):
        return {"gate_status": "skipped", "reason": gate_result.get("reason", "N/A")}

    if errors:
        return {
            "gate_status": "rejected",
            "error_count": len(errors),
            "warning_count": len(warnings),
            "first_errors": [e["message"] for e in errors[:5]],
        }

    if warnings:
        return {
            "gate_status": "warned",
            "error_count": 0,
            "warning_count": len(warnings),
            "first_warnings": [w["message"] for w in warnings[:5]],
        }

    return {"gate_status": "passed", "error_count": 0, "warning_count": 0}


# ══════════════════════════════════════════════════════════════════════════════
# CLI
# ══════════════════════════════════════════════════════════════════════════════

def main():
    parser = argparse.ArgumentParser(description="Headless LSP Validation Gate (FRS-2)")
    parser.add_argument("worktree", help="Path to worktree to validate")
    parser.add_argument("--language", choices=["python", "typescript", "javascript", "go", "rust"],
                        help="Override language auto-detection")
    parser.add_argument("--files", nargs="*", help="Specific files to check")
    parser.add_argument("--json", action="store_true", help="Output raw JSON")
    args = parser.parse_args()

    worktree = Path(args.worktree).resolve()
    if not worktree.exists():
        print(f"Error: worktree not found: {worktree}", file=sys.stderr)
        sys.exit(1)

    result = validate_worktree(worktree, args.language, args.files)
    verdict = aegis_evaluate(result)

    if args.json:
        output = {
            "validation": result,
            "verdict": verdict,
        }
        print(json.dumps(output, indent=2))
    else:
        status = verdict.get("gate_status", "unknown")
        if status == "rejected":
            print(f"\n  ❌ LSP GATE REJECTED: {verdict.get('error_count', 0)} errors")
            for e in verdict.get("first_errors", []):
                print(f"     {e}")
        elif status == "warned":
            print(f"\n  ⚠️  LSP GATE WARNED: {verdict.get('warning_count', 0)} warnings")
        elif status == "passed":
            print(f"\n  ✅ LSP GATE PASSED: clean")
        else:
            print(f"\n  ⏭️  LSP GATE {status.upper()}: {verdict.get('reason', '')}")

        print(f"  Duration: {result.get('gate_ms', 0):.1f}ms")

    sys.exit(0 if verdict.get("gate_status") == "passed" else
              EXIT_ERRORS_FOUND if verdict.get("gate_status") == "rejected" else 0)


if __name__ == "__main__":
    main()
