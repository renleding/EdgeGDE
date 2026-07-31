#!/usr/bin/env python3
"""
Aegis CLI — Unified 5-Phase State Machine (EG-FSM-001)
"""

import argparse
import json
import hashlib
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

# Ensure tools are importable
TOOLS_DIR = Path(__file__).resolve().parent
REPO_ROOT = TOOLS_DIR.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from tools.saga import SagaManifest, SagaCoordinator, LOG_DIR
from tools.scheduler import DAGScheduler, TaskNode, CycleError


# ── Risk Taxonomy ───────────────────────────────────────────────────────────

RISK_SCORES = {
    "read_file": {"score": 1, "label": "info", "reason": "Read-only, no side effects"},
    "list_dir": {"score": 1, "label": "info", "reason": "Read-only, no side effects"},
    "architecture_summary": {"score": 1, "label": "info", "reason": "Read-only, no side effects"},
    "write_text": {"score": 3, "label": "low", "reason": "File mutation, compensated by checkpoint"},
    "shell": {"score": 5, "label": "medium", "reason": "Arbitrary command execution"},
    "delete": {"score": 7, "label": "high", "reason": "Destructive — requires checkpoint"},
    "network": {"score": 8, "label": "high", "reason": "External data exfiltration risk"},
    "deploy": {"score": 9, "label": "critical", "reason": "Production state change"},
    "secrets": {"score": 10, "label": "critical", "reason": "Credential exposure risk"},
    "permissions": {"score": 8, "label": "high", "reason": "Security boundary change"},
}

MAX_ALLOWED_SCORE = 10  # No operation can exceed this


def score_manifest(manifest_path: Path) -> dict:
    """Score a manifest's risk level based on operations."""
    data = json.loads(manifest_path.read_text())
    tasks = data.get("tasks", [])
    max_score = 0
    max_op = ""
    operation_scores = {}

    for task in tasks:
        op = task.get("operation", "")
        info = RISK_SCORES.get(op, {"score": 5, "label": "medium", "reason": "Unknown operation"})
        score = info["score"]
        operation_scores[task.get("task_id", "?")] = score
        if score > max_score:
            max_score = score
            max_op = op

    # Overall manifest risk
    if max_score >= 9:
        overall = "critical"
    elif max_score >= 7:
        overall = "high"
    elif max_score >= 5:
        overall = "medium"
    elif max_score >= 3:
        overall = "low"
    else:
        overall = "info"

    # Check for compensating transactions
    has_saga = "saga" in data and bool(data["saga"].get("compensation_strategy"))
    has_compensations = any(t.get("compensate") for t in tasks)

    return {
        "manifest_id": data.get("mission_id", "unknown"),
        "overall_risk": overall,
        "max_score": max_score,
        "max_operation": max_op,
        "operation_scores": operation_scores,
        "total_tasks": len(tasks),
        "has_saga_coverage": has_saga,
        "has_compensations": has_compensations,
        "recommendation": (
            "✅ Safe to execute" if max_score < 7
            else "⚠️  High risk — ensure Saga compensation is configured"
            if max_score < 9
            else "🛑 Critical — requires explicit deploy gogo or exemption"
        ),
        "requires_gogo_level": "gogo" if max_score < 7 else "deploy gogo" if max_score >= 9 else "gogo + caution",
    }


# ── Policy Validation ───────────────────────────────────────────────────────

def validate_policy() -> dict:
    """Validate that policy documents exist and are consistent."""
    policy_path = REPO_ROOT / ".hermes" / "policies" / "policy.md"
    instructions_path = REPO_ROOT / ".hermes" / "instructions" / "instructions.md"
    agents_md = REPO_ROOT / "AGENTS.md"

    checks = {}

    # File existence
    checks["policy_exists"] = policy_path.exists()
    checks["instructions_exists"] = instructions_path.exists()
    checks["agents_md_exists"] = agents_md.exists()

    # Policy content checks
    if policy_path.exists():
        content = policy_path.read_text()
        checks["policy_has_5_phase"] = "Phase 1" in content and "Phase 2" in content and "Phase 3" in content
        checks["policy_has_gogo"] = "gogo" in content.lower()
        checks["policy_has_error_transparency"] = "Error Transparency" in content
        checks["policy_size"] = len(content)
    else:
        checks["policy_has_5_phase"] = False
        checks["policy_has_gogo"] = False
        checks["policy_has_error_transparency"] = False
        checks["policy_size"] = 0

    # Instructions content checks
    if instructions_path.exists():
        content = instructions_path.read_text()
        checks["instructions_has_kanban"] = "Kanban" in content
        checks["instructions_has_aider_rule"] = "Aider" in content
        checks["instructions_has_breach_record"] = "Breach" in content
        checks["instructions_has_auth_rules"] = "gogo" in content.lower() and "deploy gogo" in content.lower()
        checks["instructions_size"] = len(content)
    else:
        checks["instructions_has_kanban"] = False
        checks["instructions_has_aider_rule"] = False
        checks["instructions_has_breach_record"] = False
        checks["instructions_has_auth_rules"] = False
        checks["instructions_size"] = 0

    # AGENTS.md schema checks
    if agents_md.exists():
        content = agents_md.read_text()
        checks["agents_md_has_saga"] = "saga" in content.lower()
        checks["agents_md_has_compensate"] = "compensate" in content and "compensation" in content
        checks["agents_md_has_3_roles"] = "Hermes" in content and "Aegis" in content and "Droid" in content
        checks["agents_md_size"] = len(content)
    else:
        checks["agents_md_has_saga"] = False
        checks["agents_md_has_compensate"] = False
        checks["agents_md_has_3_roles"] = False
        checks["agents_md_size"] = 0

    # Determine overall health
    mandatory = ["policy_exists", "instructions_exists", "agents_md_exists",
                  "policy_has_5_phase", "policy_has_gogo",
                  "instructions_has_kanban", "instructions_has_aider_rule",
                  "agents_md_has_3_roles"]
    passed = sum(1 for c in mandatory if checks.get(c))
    total = len(mandatory)
    checks["health"] = f"{passed}/{total} checks pass"

    return checks


# ── Unified Aegis CLI ────────────────────────────────────────────────────────

class AegisCLI:
    """
    Unified 5-Phase State Machine:

    Phase 1 - DISCOVERY:  Validate manifest structure, score risks, check policy
    Phase 2 - ALIGNMENT:  Build task DAG, check dependencies, no cycles
    Phase 3 - THE GATE:   Check gogo authorization level
    Phase 4 - EXECUTION:  Execute via Saga coordinator (with checkpoint/reconcile/compensate)
    Phase 5 - VERIFICATION: Run replay-style checks, store memory, produce report
    """

    def __init__(self, manifest_path: Path, dry_run: bool = False):
        self.manifest_path = manifest_path
        self.manifest_data = json.loads(manifest_path.read_text())
        self.dry_run = dry_run
        self.phases = {}

    def run(self) -> dict:
        """Execute the full 5-phase pipeline."""
        print(f"╔══ AEGIS — 5-Phase State Machine ═══")
        print(f"║ Mission: {self.manifest_data.get('mission_id', '?')}")
        print(f"║ Objective: {self.manifest_data.get('objective', '?')[:80]}")
        print(f"╠══")

        # Phase 1: DISCOVERY
        print(f"║ [PHASE 1] DISCOVERY — Validate & Score")
        self.phases["discovery"] = self._phase_discovery()
        if self.phases["discovery"].get("blocked"):
            return self._final_report("blocked", "Discovery failed policy validation")

        # Phase 2: ALIGNMENT
        print(f"║ [PHASE 2] ALIGNMENT — Build DAG & Check Dependencies")
        self.phases["alignment"] = self._phase_alignment()
        if self.phases["alignment"].get("blocked"):
            return self._final_report("blocked", "DAG validation failed")

        # Phase 3: THE GATE
        print(f"║ [PHASE 3] THE GATE — Authorization Check")
        self.phases["gate"] = self._phase_gate()
        if self.phases["gate"].get("blocked") and not self.dry_run:
            return self._final_report("blocked", f"gogo level required: {self.phases['gate'].get('required_level', '?')}")

        # Phase 4: EXECUTION
        print(f"║ [PHASE 4] EXECUTION — Via Saga Coordinator")
        if self.dry_run:
            self.phases["execution"] = {"status": "skipped", "reason": "Dry run — no execution"}
            print(f"║   (skipped — dry run)")
        else:
            self.phases["execution"] = self._phase_execution()

        # Phase 5: VERIFICATION
        print(f"║ [PHASE 5] VERIFICATION — Reconcile & Store")
        self.phases["verification"] = self._phase_verification()

        overall = "success" if self.phases.get("execution", {}).get("status") != "failure" else "failure"
        print(f"╚══ Mission: {overall}")

        return self._final_report(overall)

    def _phase_discovery(self) -> dict:
        """Phase 1: Validate manifest structure, score risks, check policy."""
        checks = []

        # 1a. Manifest has required fields
        required = ["mission_id", "tasks"]
        missing = [f for f in required if f not in self.manifest_data]
        if missing:
            checks.append(f"❌ Missing fields: {missing}")
            return {"blocked": True, "checks": checks, "risk_score": {}}

        checks.append("✅ Manifest has required fields")

        # 1b. Tasks have operation and args
        for i, task in enumerate(self.manifest_data.get("tasks", [])):
            if "operation" not in task:
                checks.append(f"❌ Task {i} missing 'operation'")
            if "args" not in task:
                checks.append(f"⚠️  Task {i} missing 'args'")

        # 1c. Risk score
        risk = score_manifest(self.manifest_path)
        checks.append(f"✅ Risk score: {risk['overall_risk']} (max: {risk['max_score']})")
        checks.append(f"   Highest risk op: {risk['max_operation']}")
        checks.append(f"   Saga coverage: {'✅' if risk['has_saga_coverage'] else '⚠️  None'}")
        checks.append(f"   Compensations: {'✅' if risk['has_compensations'] else '⚠️  None'}")
        checks.append(f"   Authorization: {risk['requires_gogo_level']}")

        print(f"║   {'; '.join(checks)}")
        return {"blocked": False, "checks": checks, "risk_score": risk}

    def _phase_alignment(self) -> dict:
        """Phase 2: Build DAG, check dependencies, no cycles."""
        try:
            tasks = self.manifest_data.get("tasks", [])
            nodes = []
            for t in tasks:
                nodes.append(TaskNode(
                    task_id=t["task_id"],
                    operation=t["operation"],
                    args=t.get("args", {}),
                    depends_on=t.get("depends_on", []),
                ))

            # Validate DAG
            dag = DAGScheduler(nodes)
            dag._validate()
            print(f"║   ✅ DAG valid — {len(nodes)} tasks, no cycles")
            return {"blocked": False, "task_count": len(nodes), "dag_valid": True}

        except CycleError as e:
            print(f"║   ❌ Cycle detected: {e}")
            return {"blocked": True, "error": str(e), "dag_valid": False}
        except ValueError as e:
            print(f"║   ❌ Invalid DAG: {e}")
            return {"blocked": True, "error": str(e), "dag_valid": False}

    def _granted_gogo_level(self) -> tuple[str, str]:
        """Resolve the currently granted gogo level.

        Sources, in priority order:
        1. SDLC auth state (~/.hermes/.edgegde-auth.json) — set by
           `edgegde-sdlc authorize gogo on|off` / `nodeploy on|off`.
           gogo=true + deploy_block=false  → "deploy gogo" (full)
           gogo=true + deploy_block=true   → "gogo" (deploy blocked)
        2. Manifest structured gogo (GogoAuthorization, gogo.ts schema).

        Returns (level, source). Level ∈ {"none", "gogo", "deploy gogo"}.
        """
        # 1. SDLC auth file — the authoritative gate state
        auth_path = Path.home() / ".hermes" / ".edgegde-auth.json"
        auth: dict = {}
        try:
            if auth_path.exists():
                auth = json.loads(auth_path.read_text())
        except Exception:
            auth = {}

        sdlc_gogo = bool(auth.get("gogo"))
        sdlc_block = bool(auth.get("deploy_block"))
        if sdlc_gogo and not sdlc_block:
            return "deploy gogo", "sdlc-auth(gogo=true, deploy_block=false)"
        if sdlc_gogo:
            return "gogo", "sdlc-auth(gogo=true, deploy_block=true)"

        # 2. Manifest structured gogo (gogo.ts GogoAuthorization)
        mgogo = self.manifest_data.get("gogo")
        if isinstance(mgogo, dict) and mgogo.get("authorizedBy"):
            exp = mgogo.get("expiresAt")
            if exp:
                try:
                    exp_dt = datetime.fromisoformat(str(exp).replace("Z", "+00:00"))
                    if datetime.now(timezone.utc) > exp_dt:
                        return "none", "manifest-gogo(expired)"
                except Exception:
                    pass
            scope = mgogo.get("scope") or {}
            actions = scope.get("actions") or []
            if any(
                kw in str(a).lower()
                for a in actions
                for kw in ("deploy", "publish", "rollback")
            ):
                return "deploy gogo", "manifest-gogo(scope=deploy)"
            return "gogo", "manifest-gogo"

        return "none", "no-gogo-authorization"

    def _phase_gate(self) -> dict:
        """Phase 3: Check gogo authorization level — THE GATE.

        Enforces policy.md Phase 3: no gogo authorization → no execution.
        Required level comes from risk scoring; granted level comes from the
        SDLC auth file or the manifest's structured gogo. Blocks when the
        granted level is below the required level.
        """
        risk = self.phases.get("discovery", {}).get("risk_score", {})
        required_level = risk.get("requires_gogo_level", "gogo")

        granted_level, granted_source = self._granted_gogo_level()

        # Level ordering: none < gogo < deploy gogo.
        # "gogo + caution" is advisory — it still only requires "gogo".
        req_base = {
            "gogo": "gogo",
            "gogo + caution": "gogo",
            "deploy gogo": "deploy gogo",
        }.get(required_level, "gogo")
        level_rank = {"none": 0, "gogo": 1, "deploy gogo": 2}
        req_rank = level_rank.get(req_base, 1)
        granted_rank = level_rank.get(granted_level, 0)

        blocked = granted_rank < req_rank
        if blocked:
            print(
                f"║   ❌ GATE BLOCKED: requires '{required_level}' "
                f"but granted '{granted_level}' ({granted_source})"
            )
            print(f"║      Fix: edgegde-sdlc authorize gogo on   (or set manifest gogo field)")
        else:
            print(
                f"║   ✅ GATE PASS: required '{required_level}' "
                f"≤ granted '{granted_level}' ({granted_source})"
            )

        return {
            "blocked": blocked,
            "required_level": required_level,
            "granted_level": granted_level,
            "granted_source": granted_source,
        }

    def _phase_execution(self) -> dict:
        """Phase 4: Execute via Saga coordinator."""
        manifest = SagaManifest(self.manifest_data)
        coordinator = SagaCoordinator(manifest)
        return coordinator.run()

    def _phase_verification(self) -> dict:
        """Phase 5: Verify execution, store memory, report."""
        exec_result = self.phases.get("execution", {})

        # Store in memory if we have a report
        log_dir = LOG_DIR
        report_file = log_dir / f"{self.manifest_data.get('mission_id', 'unknown')}.report.json"

        if exec_result and exec_result.get("status"):
            # Write execution report
            log_dir.mkdir(parents=True, exist_ok=True)
            report = {
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "mission_id": self.manifest_data.get("mission_id", "?"),
                "status": exec_result.get("status", "?"),
                "task_count": len(self.manifest_data.get("tasks", [])),
                "completed": exec_result.get("completed", exec_result.get("tasks", {}).get("completed", 0)),
                "failed": exec_result.get("failed", exec_result.get("tasks", {}).get("failed", 0)),
                "compensated": exec_result.get("tasks", {}).get("compensated", 0) if isinstance(exec_result.get("tasks"), dict) else exec_result.get("compensated", 0),
                "duration": exec_result.get("duration_seconds", 0),
            }
            report_file.write_text(json.dumps(report, indent=2))

            # Try to store in cross-mission memory
            try:
                from tools.mission_memory import _get_db, timestamp
                conn = _get_db()
                canonical = f"{report['mission_id']}:{report['timestamp']}:{report['status']}"
                checksum = hashlib.sha256(canonical.encode()).hexdigest()[:16]
                conn.execute("""
                    INSERT OR REPLACE INTO mission_memory
                    (mission_id, timestamp, objective, success, compensation_used,
                     verification_summary, checksum)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                """, (
                    report["mission_id"],
                    report["timestamp"],
                    self.manifest_data.get("objective", "")[:200],
                    1 if report["status"] == "success" else 0,
                    report.get("compensated", 0) > 0,
                    f"tasks={report['task_count']}, completed={report['completed']}, failed={report['failed']}",
                    checksum,
                ))
                conn.commit()
                conn.close()
            except Exception:
                pass  # Memory store is optional for verification

            return {"report_file": str(report_file), "stored": True}
        return {"report_file": None, "stored": False}

    def _final_report(self, status: str, reason: str = "") -> dict:
        return {
            "aegis_version": "1.0.0",
            "status": status,
            "reason": reason,
            "dry_run": self.dry_run,
            "phases": self.phases,
            "mission_id": self.manifest_data.get("mission_id", "?"),
        }


# ── CLI Entry Point ─────────────────────────────────────────────────────────

def cmd_run(args):
    manifest_path = Path(args.manifest)
    if not manifest_path.exists():
        print(f"Error: manifest not found: {manifest_path}")
        sys.exit(1)

    cli = AegisCLI(manifest_path, dry_run=args.dry_run)
    result = cli.run()
    print(json.dumps(result, indent=2)[:500])

    if result["status"] == "blocked":
        sys.exit(1)


def cmd_replay(args):
    from tools.replay import cmd_replay as replay_run
    # Delegate to replay tool
    replay_args = type("Args", (), {
        "mission": args.mission if args.mission else None,
        "all": args.all if hasattr(args, 'all') else False,
        "recent": args.recent if hasattr(args, 'recent') else None,
    })()
    from tools.replay import cmd_run as replay_cmd
    replay_cmd(replay_args)


def cmd_memory(args):
    from tools.mission_memory import cmd_recall, cmd_summarize
    if args.recall:
        mem_args = type("Args", (), {"path": args.path, "mission": args.mission})()
        cmd_recall(mem_args)
    elif args.summarize:
        mem_args = type("Args", (), {"mission": args.mission})()
        cmd_summarize(mem_args)


def cmd_risk(args):
    result = score_manifest(Path(args.manifest))
    print(json.dumps(result, indent=2))


def cmd_policy(args):
    result = validate_policy()
    print(json.dumps(result, indent=2))
    if result.get("health"):
        h = result["health"]
        check_str = h.split("/")[0]
        total_str = h.split("/")[1].split()[0]
        check_count = int(check_str) if check_str.isdigit() else 0
        total = int(total_str) if total_str.isdigit() else 0
        if check_count < total:
            print(f"\n  ❌ {total - check_count} policy checks failed:")
            for k, v in result.items():
                if k != "health" and not v:
                    print(f"     - {k}")
        else:
            print(f"\n  ✅ All policy checks pass")


def main():
    parser = argparse.ArgumentParser(description="Aegis — Unified 5-Phase State Machine")
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("run", help="Run full 5-phase pipeline on a manifest")
    p.add_argument("manifest", help="Path to Mission Manifest JSON")
    p.add_argument("--dry-run", action="store_true", help="Preview without execution")

    p = sub.add_parser("replay", help="Replay past missions from audit history")
    p.add_argument("--mission", help="Specific mission ID")
    p.add_argument("--all", action="store_true")
    p.add_argument("--recent", type=int)

    p = sub.add_parser("memory", help="Query cross-mission memory")
    p.add_argument("--recall", action="store_true")
    p.add_argument("--path", help="File path to search")
    p.add_argument("--mission", help="Mission ID")
    p.add_argument("--summarize", action="store_true")

    p = sub.add_parser("risk-score", help="Score a manifest's risk level")
    p.add_argument("manifest", help="Path to Mission Manifest JSON")

    p = sub.add_parser("policy", help="Validate policy documents")
    p.add_argument("validate", nargs="?", const=True, help="Run policy validation")

    args = parser.parse_args()
    {
        "run": cmd_run,
        "replay": cmd_replay,
        "memory": cmd_memory,
        "risk-score": cmd_risk,
        "policy": cmd_policy,
    }[args.command](args)


if __name__ == "__main__":
    main()
