#!/usr/bin/env python3
"""
Continuous Improvement Loop — Phase 1 (FRS v1.0)

Scans → detects recurring patterns → opens auto-fix PRs.

Usage:
  python3 tools/improvement_loop.py scan          # Gather data
  python3 tools/improvement_loop.py detect        # Find recurring patterns
  python3 tools/improvement_loop.py fix           # Open fix PRs
  python3 tools/improvement_loop.py run           # All three in sequence
"""

import argparse
import json
import os
import re
import subprocess
import sys
from collections import Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
MISSION_DIR = REPO_ROOT / ".hermes" / "logs" / "missions"
MEMORY_DB = REPO_ROOT / ".hermes" / "memory" / "missions.db"

# ── Helpers ──

def run(cmd, **kw):
    """Run a shell command and return (stdout, stderr, exit_code)."""
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=kw.get("timeout", 30), cwd=kw.get("cwd", REPO_ROOT))
        return r.stdout.strip(), r.stderr.strip(), r.returncode
    except subprocess.TimeoutExpired:
        return "", "TIMEOUT", -1
    except FileNotFoundError:
        return "", "COMMAND_NOT_FOUND", -1


def recent_missions(days=7):
    """Yield mission report dicts from the last N days."""
    if not MISSION_DIR.exists():
        return
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    for f in sorted(MISSION_DIR.glob("*.report.json"), reverse=True):
        try:
            data = json.loads(f.read_text())
            # If no timestamp, include it anyway (file date is proxy)
            ts = data.get("end_time") or data.get("start_time")
            if ts is None:
                yield data
                continue
            if isinstance(ts, str):
                try:
                    dt = datetime.fromisoformat(ts)
                except ValueError:
                    try:
                        dt = datetime.fromtimestamp(float(ts), tz=timezone.utc)
                    except (ValueError, OSError):
                        yield data
                        continue
            else:
                dt = datetime.fromtimestamp(ts / 1000 if ts > 1e12 else ts, tz=timezone.utc)
            if dt >= cutoff:
                yield data
        except (json.JSONDecodeError, OSError):
            continue


def recent_prs(days=7):
    """Return recently merged PRs."""
    since = (datetime.now() - timedelta(days=days)).strftime("%Y-%m-%dT%H:%M:%SZ")
    out, _, code = run(["gh", "pr", "list", "--state", "merged", "--json", "number,title,headRefName,mergedAt,body", f"--search=merged:>={since}", "--limit", "20"])
    if code != 0 or not out:
        return []
    try:
        return json.loads(out)
    except json.JSONDecodeError:
        return []


# ── Scan ──

def cmd_scan(args):
    """Gather data from missions, replay, and git."""
    report = {
        "scanned_at": datetime.now(timezone.utc).isoformat(),
        "mission_logs": [],
        "replay_results": [],
        "recent_prs": [],
        "errors": [],
    }

    # Mission logs
    for m in recent_missions(args.days):
        tasks = m.get("tasks", {})
        completed = tasks.get("completed", 0)
        failed = tasks.get("failed", 0)
        entry = {
            "mission_id": m.get("mission_id", "?"),
            "status": m.get("status", "?"),
            "completed": completed,
            "failed": failed,
            "end_time": m.get("end_time", ""),
            "errors": [],
        }
        # Extract error messages from task results
        for t in m.get("tasks", {}).get("results", []):
            if not t.get("success", True):
                entry["errors"].append(t.get("error", "") or t.get("output", ""))
        if failed > 0:
            report["errors"].append(f"Mission {entry['mission_id']}: {failed} failed task(s)")
        report["mission_logs"].append(entry)

    # Replay results
    out, _, _ = run(["python3", "tools/replay.py", "run", "--all", "--days", str(args.days)])
    if out:
        report["replay_results"] = out.split("\n")

    # Recent PRs
    report["recent_prs"] = recent_prs(args.days)

    # Save scan report
    scan_file = REPO_ROOT / ".hermes" / "improvement-scan.json"
    scan_file.parent.mkdir(parents=True, exist_ok=True)
    scan_file.write_text(json.dumps(report, indent=2))
    print(f"Scan complete: {len(report['mission_logs'])} missions, {len(report['recent_prs'])} PRs")
    if report["errors"]:
        print(f"  {len(report['errors'])} issue(s) found")

    return report


# ── Detect ──

def cmd_detect(args):
    """Find recurring patterns in scan data."""
    scan_file = REPO_ROOT / ".hermes" / "improvement-scan.json"
    if not scan_file.exists():
        print("No scan data found. Run 'improvement_loop.py scan' first.")
        return

    scan = json.loads(scan_file.read_text())
    patterns = []

    # Pattern 1: Same error across multiple missions
    error_counter = Counter()
    for m in scan.get("mission_logs", []):
        for err in m.get("errors", []):
            # Normalize: strip timestamps, paths, memory addresses
            normalized = re.sub(r"0x[0-9a-fA-F]+", "0x...", err)
            normalized = re.sub(r"/\w+/[A-Z][A-Za-z0-9/._-]+", "/.../", normalized)
            normalized = re.sub(r"\d{10,}", "...", normalized)
            error_counter[normalized[:150]] += 1

    for err_text, count in error_counter.most_common(10):
        if count >= 3:
            patterns.append({
                "type": "recurring_error",
                "count": count,
                "sample": err_text[:200],
                "severity": "high" if count >= 5 else "medium",
            })

    # Pattern 2: Replay failures on same assertion
    replay_results = scan.get("replay_results", [])
    replay_fails = [l for l in replay_results if "FAIL" in l.upper() or "ERROR" in l.upper()]
    fail_counter = Counter()
    for f in replay_fails:
        fail_counter[f[:100]] += 1
    for fail_text, count in fail_counter.most_common(5):
        if count >= 2:
            patterns.append({
                "type": "replay_failure",
                "count": count,
                "sample": fail_text[:200],
                "severity": "high",
            })

    # Pattern 3: Missions with no compensate on shell/high-risk ops
    for m in scan.get("mission_logs", []):
        if m.get("status") == "failure":
            patterns.append({
                "type": "possible_compensation_gap",
                "count": 1,
                "mission_id": m.get("mission_id", "?"),
                "severity": "low",
            })

    # Save detected patterns
    detect_file = REPO_ROOT / ".hermes" / "improvement-patterns.json"
    detect_file.write_text(json.dumps(patterns, indent=2))
    print(f"Detected {len(patterns)} pattern(s):")
    for p in patterns:
        print(f"  [{p['severity']:6s}] {p['type']:30s} (count={p['count']})")
        if "sample" in p:
            print(f"          {p['sample'][:80]}")
    return patterns


# ── Fix ──

def cmd_fix(args):
    """Open auto-fix PRs for detected patterns."""
    detect_file = REPO_ROOT / ".hermes" / "improvement-patterns.json"
    if not detect_file.exists():
        print("No pattern data found. Run 'improvement_loop.py detect' first.")
        return

    patterns = json.loads(detect_file.read_text())
    if not patterns:
        print("No patterns to fix.")
        return

    # Deduplicate: skip patterns we've already filed
    memory_patterns = set()
    if MEMORY_DB.exists():
        try:
            import sqlite3
            conn = sqlite3.connect(str(MEMORY_DB))
            for row in conn.execute("SELECT content FROM lessons"):
                memory_patterns.add(row[0][:100])
            conn.close()
        except Exception:
            pass

    fixes_opened = 0
    for p in patterns:
        sig = p.get("sample", "") or p.get("mission_id", "")
        if sig[:100] in memory_patterns:
            print(f"  Skipping (already filed): {p['type']}")
            continue

        if p["type"] == "recurring_error" and p["count"] >= 3:
            branch = f"fix/auto-{p['type']}-{datetime.now().strftime('%Y%m%d-%H%M%S')}"
            out, err, code = run(["git", "checkout", "-b", branch])
            if code != 0:
                print(f"  Branch failed: {err}")
                continue

            # Write a context fix as an instructions patch
            fix_msg = (
                f"auto: address recurring error pattern\n\n"
                f"Detected {p['count']} occurrences of:\n"
                f"  {p['sample'][:200]}\n\n"
                f"Root cause: recurring agent error in auto-generated code. "
                f"Adding pattern to .hermes/policies/policy.md to catch in review."
            )

            # Append the pattern to policy.md as a known issue
            policy_path = REPO_ROOT / ".hermes" / "policies" / "policy.md"
            if policy_path.exists():
                with open(policy_path) as f:
                    existing = f.read()
                with open(policy_path, "w") as f:
                    f.write(existing)
                    f.write(f"\n\n## Auto-detected Pattern ({datetime.now().strftime('%Y-%m-%d')})\n\n")
                    f.write(f"- **Error:** {p['sample'][:200]}\n")
                    f.write(f"- **Frequency:** {p['count']} occurrences in 7 days\n")
                    f.write("- **Status:** Flagged for review\n")

            try:
                run(["git", "add", str(policy_path)])
                run(["git", "commit", "-m", fix_msg])
                run(["git", "push", "-u", "origin", "HEAD"])

                pr_body = (
                    f"## Auto-detected Pattern\n\n"
                    f"This PR was automatically generated by the Continuous Improvement Loop.\n\n"
                    f"**Pattern:** {p['type']}\n"
                    f"**Severity:** {p['severity']}\n"
                    f"**Frequency:** {p['count']} occurrences\n\n"
                    f"**Sample:**\n```\n{p.get('sample', 'N/A')[:300]}\n```\n\n"
                    f"**Action taken:** Pattern recorded in `.hermes/policies/policy.md`. "
                    f"A human should review and determine the root cause fix.\n\n"
                    f"_This is an automated PR. Review before merging._"
                )
                out, err, code = run(["gh", "pr", "create", "--base", "main",
                                       "--title", fix_msg.split("\n")[0],
                                       "--body", pr_body])
                if code == 0:
                    fixes_opened += 1
                    print(f"  PR opened: {out}")
                else:
                    print(f"  PR failed: {err}")

                run(["git", "checkout", "main"])
            except Exception as e:
                print(f"  Fix failed for pattern: {e}")
                run(["git", "checkout", "main"])

    # Store filed patterns in memory to avoid duplicates next cycle
    try:
        import sqlite3
        conn = sqlite3.connect(str(MEMORY_DB))
        conn.execute("CREATE TABLE IF NOT EXISTS lessons (content TEXT, filed_at TEXT)")
        for p in patterns:
            sig = p.get("sample", "") or p.get("mission_id", "")
            conn.execute("INSERT INTO lessons (content, filed_at) VALUES (?, ?)",
                         (sig[:100], datetime.now(timezone.utc).isoformat()))
        conn.commit()
        conn.close()
    except Exception:
        pass

    print(f"\nOpened {fixes_opened} fix PR(s)")


# ── Run (scan + detect + fix) ──

def cmd_run(args):
    print("=== Phase 1: Scan ===")
    cmd_scan(args)
    print("\n=== Phase 2: Detect ===")
    cmd_detect(args)
    print("\n=== Phase 3: Fix ===")
    cmd_fix(args)
    print("\n=== Done ===")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Continuous Improvement Loop")
    parser.add_argument("command", choices=["scan", "detect", "fix", "run"])
    parser.add_argument("--days", type=int, default=7, help="Lookback window in days")
    args = parser.parse_args()

    {"scan": cmd_scan, "detect": cmd_detect, "fix": cmd_fix, "run": cmd_run}[args.command](args)
