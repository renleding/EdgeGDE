# Streamable-http Transport Setup for State Engine MCP

## FastMCP HTTP Daemon

Configure in `main.py`:

```python
import asyncio, logging, sys
from mcp.server.fastmcp import FastMCP
import uvicorn

async def serve():
    # Engine init (CDP connection, state cache, etc.)
    eng = Engine()
    if not await eng.start():
        sys.exit(1)
    
    mcp = FastMCP("StateEngine")
    # Register tools...
    mcp.tool()(mcp_state)
    mcp.tool()(mcp_interact)
    
    app = mcp.streamable_http_app()
    config = uvicorn.Config(app, host="0.0.0.0", port=9110, log_level="info")
    server = uvicorn.Server(config)
    await server.serve()

asyncio.run(serve())
```

## Synchronous MCP Client (no SSE required)

```python
import httpx, json

class MCPClient:
    def __init__(self):
        self.c = httpx.Client(timeout=30)
        # Initialize session via POST
        r = self.c.post("http://localhost:9110/mcp",
            headers={"Content-Type":"application/json","Accept":"application/json, text/event-stream"},
            json={"jsonrpc":"2.0","id":1,"method":"initialize",
                  "params":{"protocolVersion":"2024-11-05","capabilities":{},
                            "clientInfo":{"name":"test","version":"1.0"}}})
        self.sid = r.headers.get('mcp-session-id','')
        self.c.post("http://localhost:9110/mcp",
            headers={"Content-Type":"application/json","Accept":"application/json, text/event-stream",
                     "MCP-Session-ID":self.sid},
            json={"jsonrpc":"2.0","id":2,"method":"notifications/initialized"})
    
    def call(self, tool, args=None):
        r = self.c.post("http://localhost:9110/mcp",
            headers={"Content-Type":"application/json","Accept":"application/json, text/event-stream",
                     "MCP-Session-ID":self.sid},
            json={"jsonrpc":"2.0","id":3,"method":"tools/call",
                  "params":{"name":tool,"arguments":args or {}}})
        for line in r.text.split('\n'):
            if line.startswith('data: '):
                d = json.loads(line[6:])
                if d.get("id") == 3:
                    c = d.get("result",{}).get("content",[])
                    return json.loads(c[0].get("text","{}")) if c else {}
        return {"status":"error","message":"no response"}
```

## Key Points

- `streamable_http_app()` returns a Starlette ASGI app — pass to uvicorn directly
- Session ID is returned in `mcp-session-id` response header on initialize
- All subsequent requests include `MCP-Session-ID` header (not in the JSON body)
- Responses arrive as SSE events (`data: {...}`) — parse line by line
- Timeout default is 30s; raise for long-running tool calls
- Avoid stdio mode — `Popen.communicate()` is one-shot and unreliable for multi-call sessions
