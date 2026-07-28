"""State Engine MCP — persistent HTTP daemon on :9110 (streamable-http)."""
import asyncio, json, logging, os, sys, time, uuid
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from action_engine import ActionEngine
from action_journal import ActionJournal
from cdp_connection import CdpConnection
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
            self.engine = ActionEngine(self.cdp, self.cache, self.journal)
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
        async def mcp_state() -> str:
            snap = await self.cache.get_state()
            return json.dumps(build_state_summary(snap))

        @mcp.tool()
        async def mcp_interact(action: str, target: str, value: str = "") -> str:
            at_map = {'click': ActionType.CLICK, 'type': ActionType.TYPE,
                      'select': ActionType.SELECT, 'save': ActionType.SAVE}
            at = at_map.get(action, ActionType.CLICK)
            result = await self.engine.execute(at, target, value)
            return json.dumps(result)

        @mcp.tool()
        async def mcp_inspect(target: str, context: str = "") -> str:
            el = await self.resolver.resolve(target, context)
            if el:
                return json.dumps(el.__dict__)
            return json.dumps({"status": "not_found", "target": target})

        @mcp.tool()
        async def mcp_screenshot() -> str:
            r = await self.cdp.send('Page.captureScreenshot', {'format': 'png'})
            data = r.get('data', '')
            if data:
                import base64
                path = os.path.expanduser(f"~/.hermes/logs/state-engine/screenshot_{int(time.time())}.png")
                with open(path, 'wb') as f:
                    f.write(base64.b64decode(data))
                return json.dumps({"path": path, "size": len(data)})
            return json.dumps({"error": "capture_failed"})

        @mcp.tool()
        async def mcp_workflow(name: str, params_json: str = "{}") -> str:
            params = json.loads(params_json)
            result = await self.workflow.execute(name, params)
            return json.dumps(result)

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
