# Streamable-HTTP MCP Client (Synchronous)

A synchronous MCP client using FastMCP's `streamable-http` transport.
Manages session lifecycle through `MCP-Session-ID` headers.

## Protocol

1. POST `/mcp` with `initialize` request → server returns `mcp-session-id` response header
2. POST `/mcp` with `notifications/initialized` (include `MCP-Session-ID` header)
3. POST `/mcp` with `tools/call` → read SSE `data:` events from response body

Required headers: `Content-Type: application/json`, `Accept: application/json, text/event-stream`, `MCP-Session-ID: <sid>`.

## Working MCPClient Class

```python
import httpx, json

class MCPClient:
    def __init__(self, url="http://localhost:9110/mcp"):
        self.url = url
        self.client = httpx.Client(timeout=30)
        self.session_id = self._init_session()

    def _init_session(self):
        r = self.client.post(self.url,
            headers={"Content-Type": "application/json",
                      "Accept": "application/json, text/event-stream"},
            json={"jsonrpc":"2.0","id":1,"method":"initialize",
                  "params":{"protocolVersion":"2024-11-05","capabilities":{},
                            "clientInfo":{"name":"mcp-client","version":"1.0"}}})
        sid = r.headers.get('mcp-session-id', '')
        self.client.post(self.url,
            headers={"Content-Type": "application/json",
                      "Accept": "application/json, text/event-stream",
                      "MCP-Session-ID": sid},
            json={"jsonrpc":"2.0","id":2,"method":"notifications/initialized"})
        return sid

    def call(self, tool, args=None):
        headers = {"Content-Type": "application/json",
                   "Accept": "application/json, text/event-stream",
                   "MCP-Session-ID": self.session_id}
        payload = {"jsonrpc":"2.0","id":3,"method":"tools/call",
                   "params":{"name":tool,"arguments":args or {}}}
        r = self.client.post(self.url, headers=headers, json=payload)
        for line in r.text.split('\n'):
            if line.startswith('data: '):
                try:
                    data = json.loads(line[6:])
                    if data.get("id") == 3:
                        result = data.get("result", {})
                        content = result.get("content", [])
                        if content:
                            return json.loads(content[0].get("text", "{}"))
                        return result
                except json.JSONDecodeError:
                    continue
        return {"status":"error","message":"parse failed"}
```

## Usage

```python
mcp = MCPClient()
state = mcp.call("mcp_state")          # page state
result = mcp.call("mcp_interact", ...)  # execute action
info = mcp.call("mcp_inspect", ...)     # element inspection
```

The session persists across calls. Create one MCPClient per test run.
