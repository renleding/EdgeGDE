"""
Mission Manifest — verification_criteria schema (FRS-012 FEATURE-01)

Extends the Mission Manifest with executable verification_criteria.
Field is an object, not a string — so Droid can run it without Hermes
interpretation.

Contract:
- verification_criteria.type ∈ {test_command, script, http_check, state_check}
- verification_criteria.command / script / endpoint / path
- verification_criteria.expected — structured condition
- verification_criteria.timeout — optional seconds
- A mission SHALL NOT pass GATE with any mutating task missing criteria (F01-R05)

Usage:
    from droid.mission_manifest import MissionManifest, Task, VerificationCriteria
    manifest = MissionManifest(
        mission_id="mission-42",
        objective="Add telemetry configurator",
        tasks=[
            Task(
                task_id="task_1",
                operation="write_text",
                scope=["apps/edge-runtime/src/x.ts"],
                verification_criteria=VerificationCriteria(
                    type="test_command",
                    command="npx vitest run --testNamePattern='Configurator'",
                    expected={"exit_code": 0},
                ),
                parallel=True,
            ),
        ],
    )
    manifest.validate()  # raises if any mutating task missing criteria
"""

import json
import logging
from dataclasses import dataclass, field
from typing import Any, Optional

from droid.verification_runner import VerificationCriteria

logger = logging.getLogger("droid.mission_manifest")


class ManifestValidationError(Exception):
    """Raised when a mission manifest fails validation."""
    pass


@dataclass
class Task:
    """A task in a mission manifest.

    verification_criteria is REQUIRED for mutating operations
    (write_text, patch, delete, shell). Read-only operations
    (read_file, list_dir) may omit it.
    """
    task_id: str
    operation: str  # write_text | patch | shell | delete | read_file | list_dir | architecture_summary
    scope: list[str]
    depends_on: list[str] = field(default_factory=list)
    idempotent: bool = True
    parallel: bool = False
    verification_criteria: Optional[VerificationCriteria] = None
    args: dict[str, Any] = field(default_factory=dict)
    compensate: Optional[dict[str, Any]] = None

    MUTATING_OPERATIONS = frozenset({
        "write_text", "patch", "delete", "shell",
    })

    def is_mutating(self) -> bool:
        return self.operation in self.MUTATING_OPERATIONS

    def has_criteria(self) -> bool:
        return self.verification_criteria is not None

    def validate(self) -> list[str]:
        errors: list[str] = []
        if not self.task_id:
            errors.append("task_id is required")
        if not self.operation:
            errors.append("operation is required")
        if not self.scope:
            errors.append("scope is required")
        if self.is_mutating() and not self.has_criteria():
            errors.append(
                f"mutating task {self.task_id} requires verification_criteria"
            )
        if self.parallel and self.depends_on:
            errors.append(
                f"parallel task {self.task_id} must not have depends_on"
            )
        return errors


@dataclass
class Budget:
    max_tokens: int = 25000
    max_cost_usd: float = 2.0
    max_tool_calls: int = 1000
    max_duration_seconds: int = 14400

    def to_dict(self) -> dict:
        return {
            "max_tokens": self.max_tokens,
            "max_cost_usd": self.max_cost_usd,
            "max_tool_calls": self.max_tool_calls,
            "max_duration_seconds": self.max_duration_seconds,
        }


@dataclass
class Saga:
    compensation_strategy: str = "reverse_order"
    partial_failure_policy: str = "compensate_all"

    def to_dict(self) -> dict:
        return {
            "compensation_strategy": self.compensation_strategy,
            "partial_failure_policy": self.partial_failure_policy,
        }


@dataclass
class MissionManifest:
    """Mission manifest with executable verification_criteria.

    Extends the AGENTS.md §5 contract:
    - verification_criteria is an object (not prose)
    - parallel flag for concurrent execution (F04)
    - budget declaration (FRS-007)
    """
    mission_id: str
    objective: str
    tasks: list[Task]
    autonomy_level: str = "medium"
    budget: Budget = field(default_factory=Budget)
    saga: Saga = field(default_factory=Saga)

    def validate(self) -> list[str]:
        """Validate the manifest. Returns list of errors.

        A mission SHALL NOT pass GATE with any mutating task
        missing verification_criteria (F01-R05).
        """
        errors: list[str] = []
        if not self.mission_id:
            errors.append("mission_id is required")
        if not self.objective:
            errors.append("objective is required")
        if self.autonomy_level not in {"low", "medium", "high"}:
            errors.append(f"invalid autonomy_level: {self.autonomy_level}")

        task_ids = set()
        for task in self.tasks:
            task_errors = task.validate()
            if task.task_id in task_ids:
                task_errors.append(f"duplicate task_id: {task.task_id}")
            task_ids.add(task.task_id)
            errors.extend(task_errors)

        for task in self.tasks:
            for dep in task.depends_on:
                if dep not in task_ids:
                    errors.append(
                        f"task {task.task_id} depends on unknown task: {dep}"
                    )

        return errors

    def to_dict(self) -> dict:
        return {
            "mission_id": self.mission_id,
            "objective": self.objective,
            "autonomy_level": self.autonomy_level,
            "budget": self.budget.to_dict(),
            "saga": self.saga.to_dict(),
            "tasks": [
                {
                    "task_id": t.task_id,
                    "operation": t.operation,
                    "args": t.args,
                    "scope": t.scope,
                    "depends_on": t.depends_on,
                    "idempotent": t.idempotent,
                    "parallel": t.parallel,
                    "verification_criteria": (
                        t.verification_criteria.to_dict()
                        if t.verification_criteria else None
                    ),
                    "compensate": t.compensate,
                }
                for t in self.tasks
            ],
        }

    def to_json(self) -> str:
        return json.dumps(self.to_dict(), indent=2)

    @classmethod
    def from_dict(cls, data: dict) -> "MissionManifest":
        tasks = []
        for t in data.get("tasks", []):
            criteria = t.get("verification_criteria")
            tasks.append(Task(
                task_id=t.get("task_id", ""),
                operation=t.get("operation", ""),
                scope=t.get("scope", []),
                depends_on=t.get("depends_on", []),
                idempotent=t.get("idempotent", True),
                parallel=t.get("parallel", False),
                verification_criteria=(
                    VerificationCriteria(
                        type=criteria.get("type", ""),
                        command=criteria.get("command"),
                        script=criteria.get("script"),
                        endpoint=criteria.get("endpoint"),
                        path=criteria.get("path"),
                        expected=criteria.get("expected", {}),
                        timeout=criteria.get("timeout", 300),
                    )
                    if criteria else None
                ),
                args=t.get("args", {}),
                compensate=t.get("compensate"),
            ))

        budget_data = data.get("budget", {})
        saga_data = data.get("saga", {})

        return cls(
            mission_id=data.get("mission_id", ""),
            objective=data.get("objective", ""),
            tasks=tasks,
            autonomy_level=data.get("autonomy_level", "medium"),
            budget=Budget(
                max_tokens=budget_data.get("max_tokens", 25000),
                max_cost_usd=budget_data.get("max_cost_usd", 2.0),
                max_tool_calls=budget_data.get("max_tool_calls", 1000),
                max_duration_seconds=budget_data.get(
                    "max_duration_seconds", 14400
                ),
            ),
            saga=Saga(
                compensation_strategy=saga_data.get(
                    "compensation_strategy", "reverse_order"
                ),
                partial_failure_policy=saga_data.get(
                    "partial_failure_policy", "compensate_all"
                ),
            ),
        )

    @classmethod
    def from_json(cls, json_str: str) -> "MissionManifest":
        return cls.from_dict(json.loads(json_str))
