"""
Gap #4 verification — droid/execute.py --adjust-cmd.

Covers:
1. Mutating task with a working adjuster: loop completes
   (initial content fails verification, adjuster fixes it,
   second iteration passes).
2. Mutating task WITHOUT adjuster: loop escalates after the
   iteration limit (content never changes).
3. Bad --adjust-cmd (nonexistent executable): clean failure,
   not a crash.
4. Read-only task ignores --adjust-cmd.

Run:  python3 tests/test_execute_adjust_cmd.py
"""

import json
import subprocess
import sys
import os
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

from droid.mission_manifest import MissionManifest, Task, VerificationCriteria

EXECUTE = REPO_ROOT / "droid" / "execute.py"
ADJUSTER = REPO_ROOT / "tests" / "fixtures" / "dummy_adjuster.py"
WORK_DIR = Path("/tmp/droid-adjust-test")


def run_execute(mission: MissionManifest, worktree: Path,
                adjust_cmd: str | None = None) -> tuple[int, dict]:
    mission_path = worktree / "mission.json"
    mission_path.write_text(mission.to_json())
    cmd = [
        sys.executable, str(EXECUTE),
        "--mission", str(mission_path),
        "--worktree", str(worktree),
    ]
    if adjust_cmd:
        cmd += ["--adjust-cmd", adjust_cmd]
    proc = subprocess.run(
        cmd, capture_output=True, text=True, timeout=120,
        cwd=str(worktree),
    )
    try:
        payload = json.loads(proc.stdout or proc.stderr)
    except json.JSONDecodeError:
        payload = {"_stdout": proc.stdout, "_stderr": proc.stderr}
    return proc.returncode, payload


def test_adjuster_completes_loop():
    """Mutating task: initial content BROKEN fails verification;
    dummy adjuster replaces BROKEN->FIXED; loop completes."""
    worktree = WORK_DIR / "complete"
    worktree.mkdir(parents=True, exist_ok=True)
    target = worktree / "target.txt"
    target.write_text("status: BROKEN\n")

    manifest = MissionManifest(
        mission_id="adjust-complete",
        objective="adjuster completes the loop",
        autonomy_level="medium",
        tasks=[Task(
            task_id="t_fix",
            operation="write_text",
            scope=["target.txt"],
            verification_criteria=VerificationCriteria(
                type="state_check", path="target.txt",
                expected={"exists": True}),
            args={"content": "status: FIXED\n"},
        )],
    )
    # state_check exists is too weak — use a command that checks content
    manifest.tasks[0].verification_criteria = VerificationCriteria(
        type="test_command",
        command="grep -q FIXED target.txt",
        expected={"exit_code": 0},
    )

    rc, payload = run_execute(manifest, worktree,
                              adjust_cmd=f"python3 {ADJUSTER}")
    record = payload["task_results"][0]
    assert record["status"] == "completed", \
        f"expected completed, got {record['status']}: {record}"
    assert record["iterations"] == 2, \
        f"expected 2 iterations (fail, adjust, pass), got {record['iterations']}"
    assert "FIXED" in target.read_text(), \
        "worktree file should contain the adjusted content"
    print(f"PASS test_adjuster_completes_loop "
          f"(iterations={record['iterations']}, status={record['status']})")


def test_no_adjuster_escalates():
    """Mutating task without adjuster: content never changes,
    loop escalates after the default limit (5)."""
    worktree = WORK_DIR / "escalate"
    worktree.mkdir(parents=True, exist_ok=True)
    target = worktree / "target.txt"
    target.write_text("status: BROKEN\n")

    manifest = MissionManifest(
        mission_id="adjust-escalate",
        objective="no adjuster escalates",
        autonomy_level="medium",
        tasks=[Task(
            task_id="t_stuck",
            operation="write_text",
            scope=["target.txt"],
            verification_criteria=VerificationCriteria(
                type="test_command",
                command="grep -q FIXED target.txt",
                expected={"exit_code": 0},
            ),
        )],
    )

    rc, payload = run_execute(manifest, worktree)
    record = payload["task_results"][0]
    assert record["status"] == "escalated", \
        f"expected escalated, got {record['status']}"
    assert record["iterations"] == 5, \
        f"expected 5 iterations (default limit), got {record['iterations']}"
    assert record["last_failure"]["exit_code"] != 0
    print(f"PASS test_no_adjuster_escalates "
          f"(iterations={record['iterations']}, status={record['status']})")


def test_bad_adjust_cmd_fails_cleanly():
    """Nonexistent adjuster executable → startup failure,
    exit 2, JSON error on stderr — not a traceback."""
    worktree = WORK_DIR / "badcmd"
    worktree.mkdir(parents=True, exist_ok=True)
    target = worktree / "target.txt"
    target.write_text("status: BROKEN\n")

    manifest = MissionManifest(
        mission_id="adjust-badcmd",
        objective="bad adjust cmd fails cleanly",
        autonomy_level="medium",
        tasks=[Task(
            task_id="t_bad",
            operation="write_text",
            scope=["target.txt"],
            verification_criteria=VerificationCriteria(
                type="test_command",
                command="grep -q FIXED target.txt",
                expected={"exit_code": 0},
            ),
        )],
    )

    rc, payload = run_execute(manifest, worktree,
                              adjust_cmd="definitely-not-a-real-cmd-xyz")
    assert rc == 2, f"expected exit 2 (fail-fast), got {rc}"
    assert "error" in payload, f"expected error in stderr JSON: {payload}"
    assert "not found" in payload["error"], \
        f"error should name the missing executable: {payload['error']}"
    print(f"PASS test_bad_adjust_cmd_fails_cleanly "
          f"(rc={rc}, error={payload['error'][:60]})")


def test_readonly_ignores_adjust_cmd():
    """Read-only task passes with adjust-cmd configured (unused)."""
    worktree = WORK_DIR / "readonly"
    worktree.mkdir(parents=True, exist_ok=True)

    manifest = MissionManifest(
        mission_id="adjust-readonly",
        objective="read-only ignores adjust cmd",
        autonomy_level="low",
        tasks=[Task(
            task_id="t_ro",
            operation="read_file",
            scope=["README.md"],
            verification_criteria=VerificationCriteria(
                type="test_command", command="echo ok",
                expected={"exit_code": 0},
            ),
        )],
    )

    rc, payload = run_execute(manifest, worktree,
                              adjust_cmd=f"python3 {ADJUSTER}")
    assert payload["all_passed"] is True
    assert payload["task_results"][0]["status"] == "pass"
    print("PASS test_readonly_ignores_adjust_cmd")


if __name__ == "__main__":
    WORK_DIR.mkdir(parents=True, exist_ok=True)
    test_adjuster_completes_loop()
    test_no_adjuster_escalates()
    test_bad_adjust_cmd_fails_cleanly()
    test_readonly_ignores_adjust_cmd()
    print("=== ALL --adjust-cmd TESTS PASSED ===")
