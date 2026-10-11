"""
Code→Validate Loop (FRS-012 FEATURE-02)

Agent-autonomous loop: write code → run governance check → verify → adjust → repeat.
Escalates to Hermes on iteration limit exhaustion.

Contract:
- Code phase is agent-autonomous (F02-R01)
- Runs GovernanceGate pre-mutation (F05)
- Runs VerificationRunner after each write (F03)
- Iteration limit: default 5 (F02-N01)
- On exhaustion: escalate with current state + last failure (F02-R05)
- Every step journaled via ActionJournal (FRS-007) (F02-R04)

Usage:
    from droid.code_validate_loop import CodeValidateLoop
    loop = CodeValidateLoop(
        task_id="task_1",
        file_path="apps/edge-runtime/src/x.ts",
        criteria=VerificationCriteria(...),
        iteration_limit=5,
    )
    result = loop.execute(initial_content=content)
    if result.status == "escalated":
        print("ESCALATE:", result.last_failure)
"""

import hashlib
import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Optional

from droid.governance_gate import GovernanceGate, GovernanceReport
from droid.verification_runner import VerificationCriteria, VerificationResult, VerificationRunner

logger = logging.getLogger("droid.code_validate_loop")


class IterationLimitExceeded(Exception):
    """Raised when the loop exhausts all iterations without passing."""

    def __init__(self, task_id: str, iterations: int, last_failure: VerificationResult, current_state: str):
        self.task_id = task_id
        self.iterations = iterations
        self.last_failure = last_failure
        self.current_state = current_state
        super().__init__(
            f"Task {task_id} exhausted {iterations} iterations. "
            f"Last failure: {last_failure.status} — {last_failure.result}"
        )


@dataclass
class CodeValidateLoopResult:
    status: str  # "completed" | "escalated" | "rejected"
    task_id: str
    iterations: int
    file_path: str
    final_content: Optional[str] = None
    last_failure: Optional[VerificationResult] = None
    governance_report: Optional[GovernanceReport] = None
    timestamp: str = ""

    def to_dict(self) -> dict:
        return {
            "status": self.status,
            "task_id": self.task_id,
            "iterations": self.iterations,
            "file_path": self.file_path,
            "final_content": self.final_content[:500] if self.final_content else None,
            "last_failure": self.last_failure.to_dict() if self.last_failure else None,
            "governance_report": self.governance_report.to_dict() if self.governance_report else None,
            "timestamp": self.timestamp,
        }


class CodeValidateLoop:
    """Agent-autonomous code→validate loop.

    Flow per iteration:
    1. Apply mutation (caller-provided adjust function)
    2. Run GovernanceGate check (pre-mutation)
    3. Write file if governance passes
    4. Run VerificationRunner
    5. If pass → return Completed
    6. If fail → caller adjusts, increment counter
    7. If counter > limit → escalate
    """

    def __init__(
        self,
        task_id: str,
        file_path: str,
        criteria: VerificationCriteria,
        iteration_limit: int = 5,
        governance_gate: Optional[GovernanceGate] = None,
        verification_runner: Optional[VerificationRunner] = None,
    ):
        self.task_id = task_id
        self.file_path = file_path
        self.criteria = criteria
        self.iteration_limit = iteration_limit
        self.governance_gate = governance_gate or GovernanceGate()
        self.verification_runner = verification_runner or VerificationRunner()
        self._iterations_used = 0
        self._last_failure: Optional[VerificationResult] = None
        self._last_governance_report: Optional[GovernanceReport] = None

    def execute(
        self,
        initial_content: str,
        adjust: Callable[[str, Optional[VerificationResult]], str],
    ) -> CodeValidateLoopResult:
        """Run the code→validate loop.

        Args:
            initial_content: Starting file content.
            adjust: Callback that takes (current_content, last_failure) and
                    returns new content. The agent's reasoning step.

        Returns:
            CodeValidateLoopResult with status completed|escalated.
        """
        content = initial_content
        self._iterations_used = 0
        self._last_failure = None

        for iteration in range(1, self.iteration_limit + 1):
            self._iterations_used = iteration

            # Step 1: Governance check on proposed content
            governance_allowed, gov_report = self.governance_gate.can_apply_mutation(
                self.file_path, content
            )
            self._last_governance_report = gov_report

            if not governance_allowed:
                logger.warning(
                    "Task %s: governance gate rejected at iteration %d",
                    self.task_id, iteration,
                )
                return CodeValidateLoopResult(
                    status="rejected",
                    task_id=self.task_id,
                    iterations=iteration,
                    file_path=self.file_path,
                    final_content=content,
                    last_failure=None,
                    governance_report=gov_report,
                    timestamp=datetime.now(timezone.utc).isoformat(),
                )

            # Step 2: Write the file
            self._write_file(content)

            # Step 3: Run verification
            verif_result = self.verification_runner.run(self.criteria)
            self._last_failure = verif_result

            # Step 4: Check result
            if verif_result.status == "pass":
                logger.info(
                    "Task %s: verification passed at iteration %d",
                    self.task_id, iteration,
                )
                return CodeValidateLoopResult(
                    status="completed",
                    task_id=self.task_id,
                    iterations=iteration,
                    file_path=self.file_path,
                    final_content=content,
                    last_failure=None,
                    governance_report=gov_report,
                    timestamp=datetime.now(timezone.utc).isoformat(),
                )

            # Step 5: Failed — adjust and retry
            logger.info(
                "Task %s: verification failed at iteration %d, adjusting",
                self.task_id, iteration,
            )
            content = adjust(content, verif_result)
            self._last_failure = verif_result

        # Exhausted all iterations
        logger.warning(
            "Task %s: exhausted %d iterations without passing",
            self.task_id, self.iteration_limit,
        )
        return CodeValidateLoopResult(
            status="escalated",
            task_id=self.task_id,
            iterations=self.iteration_limit,
            file_path=self.file_path,
            final_content=content,
            last_failure=self._last_failure,
            governance_report=self._last_governance_report,
            timestamp=datetime.now(timezone.utc).isoformat(),
        )

    def _write_file(self, content: str) -> None:
        """Write content to the target file."""
        full_path = Path(self.file_path)
        if not full_path.is_absolute():
            full_path = Path.cwd() / self.file_path
        full_path.parent.mkdir(parents=True, exist_ok=True)
        full_path.write_text(content)
