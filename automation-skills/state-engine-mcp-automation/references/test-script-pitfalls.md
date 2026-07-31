# Test Script Pitfalls (Salestrekker + State Engine)

## Page Selection Bug

**`browser.contexts[0].pages[0]` is NOT guaranteed to be the Salestrekker page.** The New Tab page (chrome://new-tab-page/) is often the first page. Always search for the correct page by URL:

```python
page = None
for ctx in browser.contexts:
    for p in ctx.pages:
        if 'salestrekker' in p.url.lower():
            page = p
            break
    if page: break
```

## Playwright Sync API + asyncio Conflict

**`patchright.sync_api` crashes inside `asyncio.run()` with:**
```
Error: It looks like you are using Playwright Sync API inside the asyncio loop.
Please use the Async API instead.
```

**Fix:** Use `patchright.async_api` and `async with async_playwright()`:
```python
from patchright.async_api import async_playwright

async def main():
    async with async_playwright() as pw:
        browser = await pw.chromium.connect_over_cdp('http://localhost:9222')
        page = await ...  # all calls use await
```

## HTTP/SSE MCP Client Connection

Use the `mcp` Python client library with `sse_client`:

```python
from mcp import ClientSession
from mcp.client.sse import sse_client

async with sse_client(url="http://localhost:9110/sse", timeout=10, sse_read_timeout=30) as streams:
    async with ClientSession(*streams) as mcp:
        await mcp.initialize()
        # Now call tools...
        r = await mcp.call_tool("mcp_interact", {"action":"click","target":"Save"})
        result = json.loads(r.content[0].text) if r.content else {"status":"error"}
```

**Key param: `sse_read_timeout=30`** — The default 300s causes disconnects during CDP initialization. Set to 30-60s for reliable connections.

## AX Tree Name Format Fix

AX node `name` can be a string OR a dict with `{"value": "..."}`:

```python
raw_name = node.get("name", "") or ""
name = raw_name.get("value", "") if isinstance(raw_name, dict) else str(raw_name)
```

Without this check, `str.get("value")` raises `AttributeError: 'str' object has no attribute 'get'`.

## Add Deal Navigation — Long Wait Required

After clicking "Add new" on the board, the SPA takes 8-10 seconds to render the form:

```python
await page.evaluate("""()=>{...click Add new...}""")
await asyncio.sleep(10)  # NOT 6s — the title input isn't ready yet
```

If `locator.type('input[name="name"]')` times out with 30s, increase the sleep after clicking Add new. The SPA hydration is slow on Salestrekker.

## SPA Navigation — Board First, Then Add Deal

To navigate from the home-loan editor to the Add deal page:
1. Navigate to board: `page.evaluate("window.location.href = '/deals/board/{BOARD}'")`
2. Wait 6-8s for SPA render
3. Click "Add new": `page.evaluate("...click Add new...")`
4. Wait 8-10s for the form to render
5. Now interact with form fields

Direct SPA navigation from the editor to `/deals/add/...` DOES NOT work — the SPA router blocks it.
