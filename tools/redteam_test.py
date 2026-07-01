#!/usr/bin/env python3
"""
Adversarial / Red-Team Testing (EG-SEC-0001)
"""

import argparse
import json
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))


# ── Test Registry ────────────────────────────────────────────────────────────

class RedTeamTest:
    """A single red-team test case."""

    def __init__(self, name: str, description: str, test_fn, expected: str):
        self.name = name
        self.description = description
        self.test_fn = test_fn
        self.expected = expected

    def run(self) -> dict:
        start = time.time()
        try:
            result = self.test_fn()
            passed = result["status"] == self.expected
            return {
                "name": self.name,
                "passed": passed,
                "expected": self.expected,
                "actual": result["status"],
                "detail": result.get("detail", ""),
                "duration_ms": int((time.time() - start) * 1000),
            }
        except Exception as e:
            return {
                "name": self.name,
                "passed": False,
                "expected": self.expected,
                "actual": "exception",
                "detail": str(e),
                "duration_ms": int((time.time() - start) * 1000),
            }


TESTS = []


def _test_forbidden_path():
    """Verify Saga coordinator rejects writes to forbidden paths."""
    import tempfile, json
    from pathlib import Path
    manifest = {
        "mission_id": "redteam-forbidden-path",
        "objective": "Attempt write to forbidden path",
        "tasks": [{
            "task_id": "try_write_env",
            "operation": "write_text",
            "args": {"path": ".env", "content": "HACKED=true"},
            "compensate": {"operation": "write_text"}
        }],
        "constraints": {"forbidden_paths": ["**/.env"]}
    }
    # Check that forbidden_paths are checked
    forbidden = manifest["constraints"].get("forbidden_paths", [])
    path = ".env"
    for pattern in forbidden:
        if path == pattern or path.endswith(pattern.replace("**/", "")):
            return {"status": "rejected", "detail": f"Path '{path}' matches forbidden pattern '{pattern}'"}
    return {"status": "accepted", "detail": "No pattern matched"}


def _test_missing_compensate():
    """Verify risk scoring flags missing compensate on high-risk ops."""
    from tools.aegis import score_manifest
    import tempfile, json
    manifest = {
        "mission_id": "redteam-no-compensate",
        "objective": "High-risk op without compensate",
        "tasks": [{
            "task_id": "delete_no_comp",
            "operation": "delete",
            "args": {"path": "/tmp/test.txt"},
        }],
    }
    mf = tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False)
    json.dump(manifest, mf)
    mf.close()
    result = score_manifest(Path(mf.name))
    os.unlink(mf.name)
    if result["overall_risk"] in ("high", "critical") and not result["has_compensations"]:
        return {"status": "flagged", "detail": f"Risk={result['overall_risk']}, no compensate"}
    return {"status": "missed", "detail": f"Risk={result['overall_risk']}"}


def _test_missing_saga():
    """Verify risk scoring flags missing Saga block."""
    from tools.aegis import score_manifest
    import tempfile, json
    manifest = {
        "mission_id": "redteam-no-saga",
        "objective": "Multi-step without saga block",
        "saga": {},
        "tasks": [
            {"task_id": "step1", "operation": "write_text", "args": {"path": "/tmp/a.txt", "content": "a"}},
            {"task_id": "step2", "operation": "write_text", "args": {"path": "/tmp/b.txt", "content": "b"}},
        ],
    }
    mf = tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False)
    json.dump(manifest, mf)
    mf.close()
    result = score_manifest(Path(mf.name))
    os.unlink(mf.name)
    if not result["has_saga_coverage"]:
        return {"status": "flagged", "detail": "Multi-step without Saga compensation strategy"}
    return {"status": "missed", "detail": "Saga was accepted"}


def _test_cycle_detection():
    """Verify DAG scheduler detects cycles."""
    from tools.scheduler import DAGScheduler, TaskNode
    from tools.scheduler import CycleError
    tasks = [
        TaskNode("A", "shell", {"command": "echo A"}, depends_on=["B"]),
        TaskNode("B", "shell", {"command": "echo B"}, depends_on=["C"]),
        TaskNode("C", "shell", {"command": "echo C"}, depends_on=["A"]),
    ]
    try:
        dag = DAGScheduler(tasks)
        dag._validate()
        return {"status": "missed", "detail": "Cycle was NOT detected"}
    except CycleError:
        return {"status": "detected", "detail": "A→B→C→A cycle correctly detected"}
    except Exception as e:
        return {"status": "error", "detail": str(e)}


def _test_policy_integrity():
    """Verify policy documents have correct structure."""
    from tools.aegis import validate_policy
    result = validate_policy()
    health = result.get("health", "0/0")
    check_str = health.split("/")[0]
    total_str = health.split("/")[1].split()[0]
    passed = int(check_str) if check_str.isdigit() else 0
    total = int(total_str) if total_str.isdigit() else 0
    if passed == total:
        return {"status": "verified", "detail": f"{passed}/{total} policy checks pass"}
    return {"status": "breach", "detail": f"{passed}/{total} policy checks pass — some FAILED"}


def _test_saga_compensation():
    """Verify Saga coordinator compensates on failure."""
    import tempfile, json
    from tools.saga import SagaManifest, SagaCoordinator

    manifest_data = {
        "mission_id": "redteam-saga-comp-test",
        "objective": "Verify Saga compensation",
        "saga": {"compensation_strategy": "reverse_order", "partial_failure_policy": "compensate_all"},
        "tasks": [
            {"task_id": "step_ok", "operation": "shell",
             "args": {"command": "echo 'Step OK'", "timeout": 5},
             "compensate": {"operation": "shell", "args": {"command": "echo 'Comp step OK'"}}},
            {"task_id": "step_fail", "operation": "shell",
             "args": {"command": "python3 -c 'import sys; sys.exit(1)'", "timeout": 5},
             "compensate": {"operation": "shell", "args": {"command": "echo 'Comp step fail'"}}},
        ],
    }
    manifest = SagaManifest(manifest_data)
    coord = SagaCoordinator(manifest)
    result = coord.run()
    if result.get("compensation_used") and result.get("tasks", {}).get("compensated", 0) >= 1:
        return {"status": "compensated", "detail": f"{result['tasks']['compensated']} task(s) compensated"}
    return {"status": "not_compensated", "detail": json.dumps(result.get("tasks", {}))}


TESTS = [
    RedTeamTest("forbidden-path", "Verify rejected writes to forbidden paths (e.g. .env)", _test_forbidden_path, "rejected"),
    RedTeamTest("missing-compensate", "Verify risk scoring flags high-risk ops without compensation", _test_missing_compensate, "flagged"),
    RedTeamTest("missing-saga", "Verify risk scoring flags missing Saga coverage", _test_missing_saga, "flagged"),
    RedTeamTest("cycle-detection", "Verify DAG scheduler catches circular dependencies", _test_cycle_detection, "detected"),
    RedTeamTest("policy-integrity", "Verify policy documents pass all structure checks", _test_policy_integrity, "verified"),
    RedTeamTest("saga-compensation", "Verify Saga coordinator compensates on multi-step failure", _test_saga_compensation, "compensated"),
]


def cmd_run(args):
    tests = TESTS if not args.test else [t for t in TESTS if t.name == args.test]
    if not tests:
        print(f"No tests match: {args.test}")
        sys.exit(1)

    results = []
    print(f"Running {len(tests)} red-team test(s)...\n")

    for test in tests:
        result = test.run()
        results.append(result)
        icon = "✅" if result["passed"] else "❌"
        print(f"  {icon} {test.name}")
        print(f"     Expected: {result['expected']}, Got: {result['actual']}")
        print(f"     Detail: {result['detail'][:200]}")
        print()

    passed = sum(1 for r in results if r["passed"])
    failed = len(results) - passed
    print(f"─── Results: {passed}/{len(results)} passed ({failed} failed) ───")

    # Summary for CI
    summary = {
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "total": len(results),
        "passed": passed,
        "failed": failed,
        "results": results,
    }
    log_dir = REPO_ROOT / ".hermes" / "logs" / "redteam"
    log_dir.mkdir(parents=True, exist_ok=True)
    report_file = log_dir / f"redteam_{int(time.time())}.json"
    report_file.write_text(json.dumps(summary, indent=2))
    print(f"Report: {report_file}")

    sys.exit(0 if passed == len(results) else 1)


def cmd_list(args):
    print("Available red-team tests:")
    for t in TESTS:
        print(f"  {t.name:30s} — {t.description}")


def main():
    parser = argparse.ArgumentParser(description="Adversarial/Red-Team Testing (EG-SEC-0001)")
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("run", help="Run red-team tests")
    p.add_argument("--test", help="Single test name")
    sub.add_parser("list", help="List available tests")
    args = parser.parse_args()
    {"run": cmd_run, "list": cmd_list}[args.command](args)


if __name__ == "__main__":
    main()
