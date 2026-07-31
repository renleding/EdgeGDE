# CDP Event Loop + Timeout Debugging

## Symptom: Runtime.evaluate silently times out after 15s

**Root cause mismatch**: The CDP background reader task (`asyncio.create_task(self._reader())`) was created in the engine startup event loop, but uvicorn/FastMCP runs its own event loop. The reader becomes orphaned — it reads responses but they're never dispatched to the waiting `send()` coroutine.

**Log pattern:**
```
WARNING state-engine.cdp] CDP command timed out: Runtime.evaluate
INFO     mcp.server.lowlevel.server] Processing request of type CallToolRequest
```

The CDP timeout happens 15s after the tool request — matching the `asyncio.wait_for(recv(), 15)` in the synchronous pattern or the background reader read timeout.

## Fix: Synchronous Send/Recv

Replace the background reader pattern with inline reads:

```python
async def send(self, method, params=None):
    msg_id = self._next_id()
    await self._ws.send(json.dumps({"id": msg_id, "method": method, "params": params or {}}))
    while True:
        msg = await asyncio.wait_for(self._ws.recv(), timeout=15)
        data = json.loads(msg)
        resp_id = data.get("id")
        # Dispatch events to subscribers when we encounter them
        if resp_id is None and data.get("method", "") in self._subscribers:
            for cb in self._subscribers[data["method"]]:
                await cb(data.get("params", {}))
            continue
        # Found our response
        if resp_id == msg_id:
            return data.get("result", {})
```

## Fallback: Direct Page WS Instead of Browser WS

The original code used `Target.getTargets` + `Target.attachToTarget` via the browser-level websocket URL. This is unnecessary — connect directly to the page's WS URL from `/json`:

```python
targets = requests.get(f"http://localhost:9222/json", timeout=5).json()
# Pick the right page
target = [t for t in targets if "Salestrekker" in t.get("title", "")][0]
ws_url = target["webSocketDebuggerUrl"]
# Connect directly — no attachToTarget needed
ws = await websockets.connect(ws_url)
```

## CfT Session Timeout During Testing

Repeated SPA navigation via `window.location.href` eventually triggers sign-out. The page shows "See you again soon / You have been securely signed out."

**Detection:**
```python
text = page.evaluate("()=>document.body.innerText")
if "sign-out" in page.url or "See you again soon" in text:
    # Session expired — navigate to /auth/sign-in
    page.goto("https://pc.v2.salestrekker.com/auth/sign-in")
    # CfT profile auto-fills credentials, click Sign in
```

**Prevention:** Add a bridge login between test runs. Every 3 SPA navigations, verify the page isn't on sign-out by checking for a known element like `.board-container` or `input[name="name"]`.
