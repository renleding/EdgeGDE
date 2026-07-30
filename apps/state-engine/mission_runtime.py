"""
mission_runtime.py — FRS-006 Mission Runtime for State Engine daemon.

Manages mission lifecycle (steps, resumption, evidence) with persistent
browser context. Runs inside the State Engine daemon on :9110.

Core algorithm:
  1. Find first incomplete step
  2. If checkpoint exists AND L1 verified → skip (continue)
  3. If no checkpoint → execute step → set checkpoint → mark complete
  4. If step fails → mark failed → raise for Aegis/human review
"""

import asyncio, json, logging, uuid, time
from typing import Optional, Callable, Awaitable, List
from dataclasses import dataclass, field

logger = logging.getLogger('state-engine.mission')

# ── Step Registry ──
# Missions declare their steps upfront. Each step has a name and an
# async handler. The handler receives the runtime context and returns
# a (success: bool, result: dict) tuple.

StepHandler = Callable[['MissionContext'], Awaitable[tuple[bool, dict]]]


@dataclass
class StepDef:
    name: str
    handler: StepHandler
    l1_check: Optional[Callable[['MissionContext'], Awaitable[bool]]] = None
    depends_on: List[str] = field(default_factory=list)
    """Step names that must complete before this step runs."""


@dataclass
class MissionContext:
    """Context passed to every step handler.

    Provides access to the EvidenceAdapter, Playwright page, and
    mission/step identifiers.
    """
    mission_id: str
    step_id: str
    step_name: str
    page: any  # Playwright page
    cdp: any   # CDP session
    evidence: any  # EvidenceAdapter
    registry: any  # FactRegistryAPI


class MissionRuntime:
    """Mission execution runtime embedded in the State Engine daemon.

    Usage:
        runtime = MissionRuntime(page, cdp, evidence, registry)
        await runtime.run_mission("add-client", [
            StepDef("Expand Change Deal", handler=expand_cd),
            StepDef("Click Add Client", handler=click_add_client),
        ])
    """

    def __init__(self, page, cdp, evidence, registry):
        self._page = page
        self._cdp = cdp
        self._evidence = evidence
        self._registry = registry

    async def run_mission(self, mission_id: str, objective: str,
                          steps: list[StepDef]) -> dict:
        """Execute or resume a mission with the given steps.

        Returns:
            {
                "status": "COMPLETED" | "FAILED" | "PARTIAL",
                "mission_id": str,
                "completed_steps": int,
                "total_steps": int,
                "results": [dict, ...]
            }
        """
        # Ensure mission exists
        self._evidence.begin_mission(mission_id, objective)

        # Store step definitions
        for s in steps:
            self._evidence.begin_step(
                f"{mission_id}:{s.name}", mission_id, s.name
            )

        results = []
        completed = 0
        total = len(steps)
        final_status = "COMPLETED"

        for step_def in steps:
            step_id = f"{mission_id}:{step_def.name}"

            # ── L1 Resumption Handshake ──
            if self._evidence.l1_is_verified(mission_id, step_id):
                logger.info("Step '%s' already verified, skipping", step_def.name)
                completed += 1
                results.append({
                    "step": step_def.name,
                    "status": "SKIPPED",
                    "reason": "L1 checkpoint exists",
                })
                continue

            logger.info("Executing step: %s", step_def.name)

            # Create run context
            run_id = f"{mission_id}:{step_def.name}:{uuid.uuid4().hex[:8]}"
            self._evidence.begin_run(
                run_id, mission_id, "salestrekker_v2",
                f"step:{step_def.name}", step_id=step_id
            )

            context = MissionContext(
                mission_id=mission_id,
                step_id=step_id,
                step_name=step_def.name,
                page=self._page,
                cdp=self._cdp,
                evidence=self._evidence,
                registry=self._registry,
            )

            try:
                success, result = await step_def.handler(context)

                if success:
                    # Set L1 checkpoint
                    l1_sig = result.get("l1_signature", f"{step_def.name}:completed")
                    self._evidence.set_checkpoint(mission_id, step_id, l1_sig)

                    self._evidence.add_verification(
                        run_id, "L1_BUSINESS_OUTCOME", "PASSED",
                        result.get("verification_reason", "Step completed")
                    )
                    self._evidence.finish_run(run_id, "SUCCESS")
                    self._evidence.complete_step(step_id, "COMPLETED",
                                                  verification_result=result)

                    completed += 1
                    results.append({
                        "step": step_def.name,
                        "status": "COMPLETED",
                        "result": result,
                    })
                else:
                    self._evidence.add_verification(
                        run_id, "L1_BUSINESS_OUTCOME", "FAILED",
                        result.get("error", "Step handler returned failure")
                    )
                    self._evidence.finish_run(run_id, "FAILED")
                    self._evidence.complete_step(step_id, "FAILED",
                                                  verification_result=result)

                    final_status = "FAILED"
                    results.append({
                        "step": step_def.name,
                        "status": "FAILED",
                        "error": result,
                    })
                    break  # Stop on failure

            except Exception as e:
                logger.exception("Step '%s' raised exception", step_def.name)
                self._evidence.add_verification(
                    run_id, "L1_BUSINESS_OUTCOME", "FAILED", str(e)
                )
                self._evidence.finish_run(run_id, "FAILED")
                self._evidence.complete_step(step_id, "FAILED")
                final_status = "FAILED"
                results.append({
                    "step": step_def.name,
                    "status": "EXCEPTION",
                    "error": str(e),
                })
                break

        # Complete mission
        self._evidence.complete_mission(mission_id, final_status)
        return {
            "status": final_status,
            "mission_id": mission_id,
            "completed_steps": completed,
            "total_steps": total,
            "results": results,
        }

    # ── Step Builder Helpers ──

    @staticmethod
    def step(name: str, handler: StepHandler,
             l1_check: Optional[Callable[['MissionContext'], Awaitable[bool]]] = None,
             depends_on: Optional[List[str]] = None) -> StepDef:
        return StepDef(
            name=name,
            handler=handler,
            l1_check=l1_check,
            depends_on=depends_on or [],
        )
