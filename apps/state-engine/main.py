"""State Engine MCP — persistent HTTP daemon on :9110 (streamable-http).

Embedded FRS-006 Evidence Engine for Tier A synchronous metadata
commits and Tier B async artifact flushing.
"""
import asyncio, json, logging, os, sys, time, uuid
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from action_engine import ActionEngine
from action_journal import ActionJournal
from cdp_connection import CdpConnection
from evidence_adapter import EvidenceAdapter
from evidence_worker import EvidenceWorker
from fact_registry_api import FactRegistryAPI
from mission_runtime import MissionRuntime
from resolver import Resolver
from salestrekker_rules import get_salestrekker_rules
from state_cache import StateCache, build_state_summary
from verification import ActionType
from workflow_engine import WorkflowEngine

logging.basicConfig(level=logging.INFO, stream=sys.stderr)
logger = logging.getLogger('state-engine')

PORT = int(os.environ.get('STATE_ENGINE_PORT', '9110'))


class StateEngineMCP:
    def __init__(self):
        self.journal = ActionJournal()
        self.cdp = None
        self.cache = None
        self.engine = None
        self.workflow = None
        self.resolver = None
        self.evidence = None
        self.evidence_worker = None
        self.state_registry = None  # FRS-007 Phase 2
        self._ws_url = None

    async def start(self):
        try:
            import subprocess
            r = subprocess.run(
                ['curl', '-s', 'http://localhost:9222/json'],
                capture_output=True, text=True, timeout=5
            )
            pages = json.loads(r.stdout)
            for p in pages:
                if 'salestrekker' in p.get('url', '').lower() or 'home' in p.get('title', '').lower():
                    ws_url = p['webSocketDebuggerUrl']
                    break
            else:
                ws_url = pages[0]['webSocketDebuggerUrl']

            self._ws_url = ws_url
            self.cdp = CdpConnection(ws_url)
            await self.cdp.connect()

            self.cache = StateCache(self.cdp)

            # FRS-006 Evidence Engine (must init before ActionEngine)
            self.evidence = EvidenceAdapter()
            self.evidence.open()
            self.evidence_worker = EvidenceWorker(self.evidence)
            asyncio.create_task(self.evidence_worker.run())
            self.fact_registry = FactRegistryAPI(self.evidence)
            # FRS-007 Phase 2: State & Transition Registries (Data Plane)
            from state_registry import StateRegistry
            self.state_registry = StateRegistry()
            self.state_registry.open()
            self.mission = MissionRuntime(
                page=None, cdp=None,
                evidence=self.evidence, registry=self.fact_registry
            )

            self.engine = ActionEngine(self.cdp, self.cache, self.journal,
                                        registry=self.fact_registry)
            self.resolver = Resolver(self.cdp)
            self.workflow = WorkflowEngine(self.engine)

            logger.info("State Engine MCP started on port %d", PORT)
            return True
        except Exception as e:
            logger.error("Startup failed: %s", e)
            return False

    def get_fastmcp_app(self):
        from mcp.server.fastmcp import FastMCP
        mcp = FastMCP("State Engine MCP")

        @mcp.tool()
        async def mcp_mission(objective: str, mission_id: str = "") -> str:
            """Start a new evidence-tracked mission. Returns mission_id."""
            mid = self.evidence.begin_mission(mission_id, objective)
            return json.dumps({"mission_id": mid, "objective": objective})

        @mcp.tool()
        async def mcp_state(mission_id: str = "", run_id: str = "") -> str:
            """Capture state snapshot with evidence logging."""
            snap = await self.cache.get_state()
            summary = build_state_summary(snap)

            # Log observation if run context is active
            if run_id:
                self.evidence.log_observation(
                    run_id, 'DOM',
                    json.dumps(summary, default=str)[:2000],
                    'MEDIUM'
                )

            return json.dumps(summary)

        @mcp.tool()
        async def mcp_interact(
            action: str, target: str, value: str = "",
            mission_id: str = "", run_id: str = ""
        ) -> str:
            """Execute browser interaction with full evidence pipeline.

            If run_id is provided, records observations, evidence, and
            verification results in the evidence database.
            """
            at_map = {'click': ActionType.CLICK, 'type': ActionType.TYPE,
                      'select': ActionType.SELECT, 'save': ActionType.SAVE}
            at = at_map.get(action, ActionType.CLICK)

            # Set up run context if not provided
            if not run_id and mission_id:
                run_id = str(uuid.uuid4())
                self.evidence.begin_run(run_id, mission_id, 'salestrekker_v2', action)

            # Log pre-action observation
            if run_id:
                obs_id = self.evidence.log_observation(
                    run_id, 'DOM',
                    f"Executing {action} on '{target}' via CDP",
                    'HIGH'
                )
                self.evidence.log_decision(
                    run_id,
                    f"tier_cdp_{action}",
                    f"CDP click via preferred_tier on '{target}'",
                )

            # Execute
            t0 = time.time()
            result = await self.engine.execute(at, target, value)
            elapsed = time.time() - t0

            # Capture pre-verification evidence
            if run_id:
                snap = await self.cache.get_state()
                status_snap = build_state_summary(snap)

                # Network evidence (inline)
                self.evidence.add_evidence(
                    run_id, 'verification', 'INLINE', 'SECONDARY',
                    payload_json=json.dumps({
                        'action': action, 'target': target,
                        'elapsed_seconds': round(elapsed, 2),
                        'success': result.get('success', False),
                        'url': status_snap.get('url', ''),
                    })
                )

                # Evaluate L1-L5 verification
                status = 'SUCCESS' if result.get('success', False) else 'FAILED'
                for level, label in [
                    ('L5_TOOL_EVIDENCE', 'Tool execution returned'),
                    ('L4_UI_EVIDENCE', 'URL/state changed'),
                    ('L3_NETWORK_EVIDENCE', 'Network captured'),
                ]:
                    self.evidence.add_verification(run_id, level, status, label)

                # Finalize run
                self.evidence.finish_run(run_id, status)

            return json.dumps({
                **result,
                'evidence_run_id': run_id,
                'elapsed_seconds': round(elapsed, 2),
            })

        @mcp.tool()
        async def mcp_inspect(target: str, context: str = "", run_id: str = "") -> str:
            """Resolve an element and log observation."""
            el = await self.resolver.resolve(target, context)
            if run_id and el:
                self.evidence.log_observation(
                    run_id, 'DOM',
                    f"Element '{target}' resolved as '{el.strategy}' confidence={el.confidence}",
                    'MEDIUM' if el.confidence and el.confidence >= 0.5 else 'LOW'
                )
            if el:
                return json.dumps(el.__dict__)
            return json.dumps({"status": "not_found", "target": target})

        @mcp.tool()
        async def mcp_screenshot(run_id: str = "") -> str:
            """Capture screenshot — Tier B artifact (async file write)."""
            r = await self.cdp.send('Page.captureScreenshot', {'format': 'png'})
            data = r.get('data', '')
            if data:
                import base64
                evidence_id = self.evidence.add_evidence(
                    run_id or 'standalone', 'screenshot', 'FILE', 'PRIMARY',
                    file_path='screenshot.png',
                )
                self.evidence.queue_artifact_job(
                    evidence_id, 'screenshot', data,
                    f"screenshot_{int(time.time())}.png"
                )
                return json.dumps({"evidence_id": evidence_id, "size": len(data)})
            return json.dumps({"error": "capture_failed"})

        @mcp.tool()
        async def mcp_workflow(name: str, params_json: str = "{}",
                                mission_id: str = "") -> str:
            """Multi-step workflow with mission tracking."""
            params = json.loads(params_json)
            result = await self.workflow.execute(name, params)

            if mission_id:
                run_id = str(uuid.uuid4())
                self.evidence.begin_run(run_id, mission_id, 'salestrekker_v2', f"workflow:{name}")
                self.evidence.add_evidence(
                    run_id, 'verification', 'INLINE', 'PRIMARY',
                    payload_json=json.dumps({
                        'workflow': name,
                        'params': params,
                        'result': result,
                        'elapsed_seconds': result.get('elapsed_seconds', 0),
                    })
                )
                self.evidence.finish_run(run_id, 'SUCCESS')

            return json.dumps({**result, 'mission_id': mission_id})

        @mcp.tool()
        async def mcp_evidence_health() -> str:
            """Evidence Engine health: queue depth, worker stats, contradictions."""
            health = self.evidence.get_worker_health()
            health['worker'] = self.evidence_worker.stats if self.evidence_worker else {}
            health['blocked_paths'] = len(self.evidence.get_blocked_paths()) if self.evidence else 0
            return json.dumps(health)

        @mcp.tool()
        async def mcp_fact(key: str) -> str:
            """Retrieve a verified fact from the registry."""
            f = self.evidence.get_fact(key) if self.evidence else None
            if f:
                return json.dumps(f)
            return json.dumps({"error": "fact_not_found", "key": key})

        # ── FRS-007 Phase 2: State & Transition Registries ──────────────
        @mcp.tool()
        async def mcp_object_state(object_id: str = "") -> str:
            """State Registry: read an object's current state, its history,
            or the full registry report.

            object_id empty → registry report (state_count, pending
            transitions, active transitions).
            """
            if not self.state_registry:
                return json.dumps({"error": "state_registry_not_initialized"})
            if not object_id:
                return json.dumps(self.state_registry.get_registry_report())
            state = self.state_registry.get_state(object_id)
            if state is None:
                return json.dumps({"error": "object_not_registered",
                                   "object_id": object_id})
            state['history'] = self.state_registry.get_history(object_id, limit=10)
            return json.dumps(state)

        @mcp.tool()
        async def mcp_transition(object_id: str, transition_id: str,
                                 action: str = "begin",
                                 evidence_id: str = "",
                                 evidence_strength: str = "L1",
                                 reason: str = "") -> str:
            """Transition Registry lifecycle.

            action=begin  → stage a transition (validates source state)
            action=commit → COMMIT ONLY on independent L1 evidence
                            (executor self-reports are rejected)
            action=abort  → compensate: discard the staged transition
            """
            if not self.state_registry:
                return json.dumps({"error": "state_registry_not_initialized"})
            try:
                if action == "begin":
                    return json.dumps(
                        self.state_registry.begin_transition(object_id,
                                                             transition_id))
                if action == "commit":
                    return json.dumps(
                        self.state_registry.commit_transition(
                            object_id, transition_id,
                            evidence_id=evidence_id,
                            evidence_strength=evidence_strength))
                if action == "abort":
                    return json.dumps(
                        self.state_registry.abort_transition(
                            object_id, transition_id, reason=reason))
                return json.dumps({"error": "unknown_action", "action": action})
            except (ValueError, PermissionError) as e:
                return json.dumps({"error": str(e), "action": action,
                                   "object_id": object_id,
                                   "transition_id": transition_id})

        @mcp.tool()
        async def mcp_transitions(source_state: str = "") -> str:
            """Transition Registry: list active transitions (optionally from
            a source state) or load the declarative YAML definitions.
            """
            if not self.state_registry:
                return json.dumps({"error": "state_registry_not_initialized"})
            if source_state:
                return json.dumps(
                    self.state_registry.find_transitions(source_state))
            return json.dumps(self.state_registry.get_registry_report())

        return mcp


def run():
    import uvicorn

    async def serve():
        eng = StateEngineMCP()
        if not await eng.start():
            sys.exit(1)

        mcp = eng.get_fastmcp_app()
        app = mcp.streamable_http_app()

        config = uvicorn.Config(app, host="0.0.0.0", port=PORT, log_level="info")
        server = uvicorn.Server(config)
        await server.serve()

    asyncio.run(serve())


if __name__ == '__main__':
    run()
