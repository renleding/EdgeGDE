#!/usr/bin/env python3
"""EdgeGDE Deploy Auto-Fix — detects deploy failures, analyzes logs, extracts fixable errors.

Output modes (for cron consumption):
  SILENT (exit 0, no stdout)     — nothing to fix
  FIX_DATA (exit 0, JSON lines)  — fixable error found, data for agent
  ERROR (exit non-zero, stderr)   — unrecoverable

Runs as no_agent=false script paired with an LLM prompt that receives this output.
"""
import json, os, re, subprocess, sys, time
from datetime import datetime, timezone
from pathlib import Path

# Strip ANSI escape codes from log output
ANSI_RE = re.compile(r'\x1b\[[0-9;]*[a-zA-Z]')

def strip_ansi(text: str) -> str:
    return ANSI_RE.sub('', text)

REPO_DIR = os.path.expanduser("~/Documents/_HQ_AI/EdgeGDE")
CHECKED_STATE_FILE = Path(os.path.expanduser("~/.hermes/state/last-deploy-auto-fix.json"))
LOG_LINES = 200
MINUTES_BACK = 120  # Only care about failures in the last 2 hours

os.chdir(REPO_DIR)

def run(cmd, timeout=60):
    return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)

def parse_iso(iso_str: str) -> datetime:
    """Parse ISO 8601 datetime string, handling Z and offset."""
    iso_str = iso_str.replace("Z", "+00:00")
    if "+" not in iso_str and iso_str.endswith("00:00"):
        iso_str += "+00:00"
    return datetime.fromisoformat(iso_str)

def is_recent(iso_str: str, minutes: int = MINUTES_BACK) -> bool:
    """Check if an ISO timestamp is within the last N minutes."""
    try:
        dt = parse_iso(iso_str)
        now = datetime.now(timezone.utc)
        return (now - dt).total_seconds() <= minutes * 60
    except Exception:
        return False

def get_failed_logs(run_id: int) -> str | None:
    """Fetch the full log output for a failed run."""
    result = run(["gh", "run", "view", str(run_id), "--log", "--repo", "renleding/EdgeGDE"], timeout=120)
    if result.returncode != 0:
        return None
    return result.stdout

def extract_test_failure(log_text: str) -> dict | None:
    """Parse log text for test assertion failures and extract key data."""
    # Strip ANSI escape codes first — gh log output has color codes
    clean_log = strip_ansi(log_text)

    result = {}

    # Check if it's a test failure — look for vitest failure marker
    # After ANSI strip: " FAIL   e2e  tests/e2e-widget.test.ts > E2E-08..."
    fail_line = re.search(r'FAIL\s+e2e\s+(tests/\S+?\.test\.ts)\s*>\s*(.+)', clean_log)
    if not fail_line:
        # Also check for non-e2e test failures or different format
        fails = re.findall(r'FAIL\s+(tests/\S+?\.test\.ts)\s*>\s*(.+)', clean_log)
        if fails:
            fail_line = True  # We have fails, just pick the first
            result['test_file'] = fails[0][0]
            result['test_name'] = fails[0][1]
    if not fail_line:
        return None

    if isinstance(fail_line, re.Match):
        result['test_file'] = fail_line.group(1)
        result['test_name'] = fail_line.group(2)

    # Detect type
    if 'toContain' in clean_log:
        result['type'] = 'e2e_assertion_mismatch'
    elif 'AssertionError' in clean_log:
        result['type'] = 'e2e_assertion_other'
    else:
        result['type'] = 'e2e_unknown'

    # Extract line number — use the vitest error location format
    # "❯ tests/e2e-widget.test.ts:373:18" (❯ is the Unicode arrow)
    line_match = re.search(r'[❯>]\s+tests/\S+\.test\.ts:(\d+):\d+', clean_log)
    if line_match:
        result['line'] = int(line_match.group(1))

    # Find the exact assertion value — expect(body).toContain('SOME_VALUE')
    contain_match = re.search(r"expect\(body\)\.toContain\('([^']+)'\)", clean_log)
    if contain_match:
        result['expected_value'] = contain_match.group(1)

    # Find the ##[error] line — contains the full assertion error
    # After ANSI strip: "##[error]AssertionError: expected '<!DOCTYPE html>...' to contain 'AFIRMICO'"
    error_match = re.search(r'##\[error\](.+?)(?:\n|$)', clean_log)
    if error_match:
        result['error_snippet'] = error_match.group(1).strip()[:300]

    return result

def check_governance_failure(log_text: str) -> dict | None:
    """Parse governance compliance failures — both verdict-FAIL and tool-crash modes.

    Mode A (verdict): governance-check.ts ran and emitted "verdict": "FAIL" with details.
    Mode B (diff crash): governance-check.ts failed to resolve the git diff and now
    exits with GOVERNANCE_DIFF_ERROR (post Jul-2026 fix) — or the pre-fix crash
    (fatal: ambiguous argument 'HEAD~1...HEAD') appeared before the tool could emit
    a verdict. Both are fixable: the auto-fix agent must restore diff resolution.
    """
    clean_log = strip_ansi(log_text)

    # Real CI log uses the workflow step header "Gate 3 — Governance compliance"
    # (the tool's own output may also contain "Governance compliance" in the JSON).
    if "Governance compliance" not in clean_log:
        return None

    # Mode B: diff-resolution crash (post-fix marker or pre-fix git fatal)
    if "GOVERNANCE_DIFF_ERROR" in clean_log or "ambiguous argument 'HEAD~1" in clean_log:
        return {
            "type": "governance_failure",
            "subtype": "diff_resolution_crash",
            "violations": [{
                "rule": "governance_diff_resolution",
                "detail": "git diff base...HEAD could not resolve changed files — "
                          "checkout fetch-depth / base-ref fetch collapsed history",
            }],
            "fix_hint": "ensure checkout fetch-depth >= 2 and skip base-ref fetch on "
                        "push-to-main events; verify .github/workflows/deploy-production.yml",
        }

    if '"verdict": "FAIL"' not in clean_log:
        return None

    result = {"type": "governance_failure", "subtype": "verdict_fail", "violations": []}

    # Extract individual violations. Actual format from governance-check.ts:
    #   {"check": "No `as any`", "status": "fail", "details": ["apps/...:line: content", ...]}
    #   {"check": "No console.log in production code", "status": "fail", "details": [...]}
    console_log_match = re.search(r'No console\.log[^}]*?"fail".*?"details":\s*\[(.*?)\]', clean_log, re.DOTALL)
    as_any_match = re.search(r'No `as any`[^}]*?"fail".*?"details":\s*\[(.*?)\]', clean_log, re.DOTALL)

    for label, match in [("console.log", console_log_match), ("as any", as_any_match)]:
        if match:
            details = re.findall(r'"(apps/[^":]+):\d+', match.group(1))
            if details:
                result["violations"].append({"rule": label, "files": sorted(set(details))})

    return result if result["violations"] else None


def check_current_state():
    """Main check — returns fix data dict or None."""
    CHECKED_STATE_FILE.parent.mkdir(parents=True, exist_ok=True)

    # Load last-checked state to avoid re-processing same failure
    last_checked = {}
    if CHECKED_STATE_FILE.exists():
        try:
            last_checked = json.loads(CHECKED_STATE_FILE.read_text())
        except (json.JSONDecodeError, OSError):
            pass

    # Step 1: Get latest deploy runs
    result = run(["gh", "run", "list", "--branch", "main", "--workflow", "Deploy \u2014 Production",
                  "--limit", "5", "--json", "databaseId,conclusion,displayTitle,headSha,createdAt,url"])
    if result.returncode != 0:
        print(f"TOOL_ERROR: gh run list failed: {result.stderr[:200]}", file=sys.stderr)
        sys.exit(1)

    try:
        runs = json.loads(result.stdout)
    except json.JSONDecodeError as e:
        print(f"TOOL_ERROR: failed to parse run list: {e}", file=sys.stderr)
        sys.exit(1)

    if not runs:
        sys.exit(0)

    # Step 2: Find failures
    failures = [r for r in runs if r["conclusion"] == "failure"]
    successes = [r for r in runs if r["conclusion"] == "success"]

    if not failures:
        sys.exit(0)  # Silent — no failures

    newest_success_time = max((parse_iso(r["createdAt"]) for r in successes), default=None) if successes else None
    newest_fail = max(failures, key=lambda r: r["createdAt"])
    fail_time = parse_iso(newest_fail["createdAt"])

    # Step 3: Skip if a success happened after the latest failure
    if newest_success_time and newest_success_time > fail_time:
        sys.exit(0)  # Already fixed

    # Step 4: Skip if too old
    if not is_recent(newest_fail["createdAt"], minutes=MINUTES_BACK):
        sys.exit(0)

    # Step 5: Skip if already processed
    fail_key = f"{newest_fail['databaseId']}"
    last_checked_fail_id = last_checked.get("last_processed_id")
    if last_checked_fail_id == fail_key:
        sys.exit(0)  # Already dispatched a fix for this failure

    # Step 6: Fetch and analyze logs
    logs = get_failed_logs(newest_fail["databaseId"])
    if not logs:
        print(f"TOOL_ERROR: could not fetch logs for run {newest_fail['databaseId']}", file=sys.stderr)
        sys.exit(1)

    # Try multiple analysis
    fix_data = extract_test_failure(logs)
    if not fix_data:
        fix_data = check_governance_failure(logs)

    if not fix_data:
        # Unknown failure type — log and skip
        print(f"UNKNOWN_FAILURE: {newest_fail['displayTitle'][:80]} \u2014 {newest_fail['headSha'][:7]}", file=sys.stderr)
        sys.exit(0)

    # Step 7: Build structured output for cron agent
    output = {
        "run_id": newest_fail["databaseId"],
        "head_sha": newest_fail["headSha"][:7],
        "title": newest_fail["displayTitle"],
        "url": newest_fail["url"],
        "created_at": newest_fail["createdAt"],
        "fix_data": fix_data,
    }

    # Save checkpoint
    CHECKED_STATE_FILE.write_text(json.dumps({"last_processed_id": fail_key, "last_output": output}, indent=2))

    # Output JSON for cron agent consumption
    print("FIX_DETECTED")
    print(json.dumps(output))
    sys.exit(0)

if __name__ == "__main__":
    check_current_state()
