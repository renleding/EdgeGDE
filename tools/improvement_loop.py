#!/usr/bin/env python3
"""Continuous Improvement Loop — Phase 1 (EG-FEAT-0030).

Provides four subcommands: scan, detect, fix, run.
"""

from __future__ import annotations

import argparse
import json
import re
import sqlite3
import subprocess
import sys
from collections import Counter
from datetime import timedelta, datetime, timezone
from pathlib import Path


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
REPO_ROOT = Path(__file__).resolve().parent.parent
MISSION_DIR = REPO_ROOT / ".hermes" / "logs" / "missions"
MEMORY_DB = REPO_ROOT / ".hermes" / "memory" / "missions.db"
SCAN_REPORT = REPO_ROOT / ".hermes" / "improvement-scan.json"
PATTERNS_FILE = REPO_ROOT / ".hermes" / "improvement-patterns.json"
POLICY_FILE = REPO_ROOT / ".hermes" / "policies" / "policy.md"


def _run(cmd: list[str], *, timeout: int = 120) -> subprocess.CompletedProcess:
    try:
        return subprocess.run(cmd, capture_output=True, text=True, check=False, timeout=timeout)
    except FileNotFoundError:
        print(f"[error] executable not found: {cmd[0]}", file=sys.stderr)
        return subprocess.CompletedProcess(args=cmd, returncode=-1, stdout="", stderr="")
    except subprocess.TimeoutExpired as exc:
        print(f"[warn] command timed out: {' '.join(cmd)}", file=sys.stderr)
        return subprocess.CompletedProcess(args=cmd, returncode=-1, stdout=exc.stdout or "", stderr=exc.stderr or "")


def _gh_pr_list(days: int) -> list[dict]:
    since = (datetime.now() - timedelta(days=days)).strftime("%Y-%m-%d")
    result = _run(["gh", "pr", "list", "--state", "merged", "--json", "number,title,headRefName,mergedAt,body", f"--search=merged:>={since}", "--limit", "20"])
    if result.returncode != 0:
        return []
    try:
        data = json.loads(result.stdout)
        return data if isinstance(data, list) else []
    except json.JSONDecodeError:
        return []


def _load_reports(days: int) -> list[dict]:
    reports = []
    if not MISSION_DIR.exists():
        return reports
    cutoff = datetime.now() - timedelta(days=days)
    for path in sorted(MISSION_DIR.glob("*.report.json")):
        try:
            with path.open() as fh:
                data = json.load(fh)
        except (json.JSONDecodeError, OSError):
            continue
        ts_raw = data.get("end_time") or data.get("start_time")
        if ts_raw is None:
            reports.append({"path": str(path), "data": data})
            continue
        try:
            dt = datetime.fromisoformat(str(ts_raw)[:19]) if isinstance(ts_raw, str) else datetime.fromtimestamp(ts_raw / 1000 if ts_raw > 1e12 else ts_raw, tz=timezone.utc)
            if dt.replace(tzinfo=None) < cutoff:
                continue
        except (ValueError, OSError):
            pass
        reports.append({"path": str(path), "data": data})
    return reports


def cmd_scan(args: argparse.Namespace) -> None:
    days = args.days
    print(f"[scan] loading mission reports (last {days} days)...")
    reports = _load_reports(days)
    print(f"[scan] fetching recent merged PRs...")
    prs = _gh_pr_list(days)
    scan_report = {"mission_reports": reports, "pr_count": len(prs), "scanned_at": datetime.now(timezone.utc).isoformat()}
    SCAN_REPORT.parent.mkdir(parents=True, exist_ok=True)
    SCAN_REPORT.write_text(json.dumps(scan_report, indent=2))
    print(f"[scan] {len(reports)} missions, {len(prs)} PRs")


def cmd_detect(args: argparse.Namespace) -> None:
    if not SCAN_REPORT.exists():
        print("[error] run scan first", file=sys.stderr)
        sys.exit(1)
    data = json.loads(SCAN_REPORT.read_text())
    error_counter: Counter[str] = Counter()
    no_comp_failures = []
    for report in data.get("mission_reports", []):
        body = (report.get("data") or {}).get("body", "")
        if isinstance(body, str):
            for line in re.sub(r"\x1b\[[0-9;]*m", "", body).splitlines():
                lower = line.strip().lower()
                if any(kw in lower for kw in ["error", "assert", "failed", "exception"]):
                    key = re.sub(r"\W+", "_", lower[:200])
                    if key:
                        error_counter[key] += 1
        if isinstance(report, dict) and report.get("data", {}).get("status") == "failure":
            no_comp_failures.append(report.get("path", ""))
    patterns = {"recurring_errors": [{"error": k, "count": v} for k, v in error_counter.items() if v >= 3], "no_compensation_failures": no_comp_failures, "detected_at": datetime.now(timezone.utc).isoformat()}
    PATTERNS_FILE.parent.mkdir(parents=True, exist_ok=True)
    PATTERNS_FILE.write_text(json.dumps(patterns, indent=2))
    print(f"[detect] {len(patterns['recurring_errors'])} recurring, {len(no_comp_failures)} no-comp")


def cmd_fix(args: argparse.Namespace) -> None:
    if not PATTERNS_FILE.exists():
        print("[error] run detect first", file=sys.stderr)
        sys.exit(1)
    data = json.loads(PATTERNS_FILE.read_text())
    patterns = [{"type": "recurring_error", **p} for p in data.get("recurring_errors", [])]
    if not patterns:
        print("[fix] no patterns to fix")
        return
    conn = sqlite3.connect(str(MEMORY_DB))
    conn.execute("CREATE TABLE IF NOT EXISTS lessons (signature TEXT PRIMARY KEY, created_at TEXT)")
    existing = {row[0] for row in conn.execute("SELECT signature FROM lessons")}
    pr_count = 0
    for p in patterns:
        sig = f"{p['type']}:{p.get('error', '')[:100]}"
        if sig in existing:
            print(f"[fix] skipping (already filed): {p.get('error', '')[:60]}")
            continue
        ts = datetime.now().strftime("%Y%m%d%H%M%S")
        branch = f"fix/auto-{p['type']}-{ts}"
        _run(["git", "checkout", "-b", branch])
        entry = f"\n- **{p['type']}** ({ts}): {p.get('error', '')[:200]}"
        POLICY_FILE.parent.mkdir(parents=True, exist_ok=True)
        existing_policy = POLICY_FILE.read_text() if POLICY_FILE.exists() else ""
        POLICY_FILE.write_text(existing_policy + entry)
        _run(["git", "add", str(POLICY_FILE)])
        _run(["git", "commit", "-m", f"auto: {p['type']} - {p.get('error', '')[:60]}"])
        _run(["git", "push", "-u", "origin", branch])
        result = _run(["gh", "pr", "create", "--base", "main", "--title", f"auto: {p['type']} - {p.get('error', '')[:60]}", "--body", f"Recurring pattern detected. Count: {p.get('count', 0)}"])
        if result.returncode == 0:
            pr_count += 1
        conn.execute("INSERT OR IGNORE INTO lessons (signature, created_at) VALUES (?, ?)", (sig, datetime.now(timezone.utc).isoformat()))
        _run(["git", "checkout", "main"])
    conn.commit()
    conn.close()
    print(f"[fix] opened {pr_count} PR(s)")


def cmd_run(args: argparse.Namespace) -> None:
    cmd_scan(args)
    cmd_detect(args)
    cmd_fix(args)


def main() -> None:
    parser = argparse.ArgumentParser(description="Continuous Improvement Loop")
    sub = parser.add_subparsers(dest="command", required=True)
    for name, help_text in [("scan", "Scan mission reports and recent PRs"), ("detect", "Detect recurring patterns"), ("fix", "Open auto-fix PRs"), ("run", "Run all three")]:
        p = sub.add_parser(name, help=help_text)
        p.add_argument("--days", type=int, default=7, help="Look back N days")
        p.set_defaults(func={"scan": cmd_scan, "detect": cmd_detect, "fix": cmd_fix, "run": cmd_run}[name])
    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
