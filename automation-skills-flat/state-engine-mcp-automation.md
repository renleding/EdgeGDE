---
name: state-engine-mcp-automation
description: >
  State Engine MCP architecture for deterministic browser automation against
  React/Radix SPAs like Salestrekker. Persistent daemon, 5-tier escalation,
  verification-first, failure envelopes. Implements FRS-005.
tags: [salestrekker, automation, state-engine, mcp, cdp, verification-first, frs-005]
related_skills:
  - salestrekker-react-automation
  - agent-process-automation
---

# State Engine MCP — Deterministic Browser Automation

## Architecture

```
Hermes (orchestrator)
   │  mcp_interact(action, target, value)
   ▼
State Engine MCP (localhost:9110)
   ├─ State Cache          (DOM + AX + screenshot, lazy refresh)
   ├─ Resolver             (AX → text → aria → visual cascade, confidence 0-1)
   ├─ Action Engine        (dynamic tier selection based on element assessment)
   ├─ State Diff Engine    (before/after structured comparison)
   ├─ Verification Engine  (rules-based success detection)
   └─ Failure Envelope     (structured error with page context)
         │
         ▼
   CfT (CDP port 9222)
   Ollama qwen3-vl (localhost:11434)
   pyautogui (OS-level events)
```

## Dynamic Tier Selection — NOT Linear Escalation

The Action Engine **assesses each element individually** (role, React props, AX visibility, known Salestrekker patterns) and **deploys the most suitable tier FIRST**. Failed tiers fall back to the next-best option. No fixed T0→T1→T2→T3 order.

### Assessment Factors

1. **Action type** (click, type, select)
2. **Element role** (button, combobox, link, input)
3. **Has React props** (`__reactProps$` detectable via CDP Runtime.evaluate) → REACT tier early
4. **Has AX node ID** → AX tier available
5. **Target text matches known patterns** ("Save", "Add", "Select one", "Assets", "Liabilities")
6. **Salestrekker rules** in `salestrekker_rules.py` override tier priority per element type

### Dynamic Priority Examples

| Scenario | First Attempt | Fallback Chain |
|----------|--------------|----------------|
| Save button with React props | **REACT** (props.onClick) | CDP → JS → KEY → AX |
| Save button no React props | **AX** (dispatchClick) | CDP → JS → REACT → KEY |
| Radix combobox (Select one) | **CDP** (mouse click opens menu) | KEY (ArrowDown+Enter) → REACT |
| Sidebar nav link (Assets) | **JS** (element.click) | CDP → AX → KEY |
| Text input (React controlled) | **JS** (prototype setter) | KEY → OS (pyautogui) |
| Delete button | **CDP** (mouse event) | JS → AX → KEY |
| "Add" dialog button (Radix) | **REACT** (props.onClick) | AX → CDP → JS → KEY |

### All Available Tiers

| Tier | Method | When Deployed |
|------|--------|---------------|
| AX | CDP `Accessibility.dispatchClick` | ARIA-labeled elements with AX node ID |
| CDP | CDP `Input.dispatchMouseEvent` by bbox | Standard buttons, combobox opening |
| JS | `element.click()` via evaluate | Sidebar links, non-Radix buttons, element refs |
| KEY | Keyboard Tab + Enter, ArrowDown+Enter | Radix comboboxes, dialog navigation |
| REACT | `element[__reactProps$].onClick()` via CDP | Radix portal-blocked buttons, Save |
| VIS | Ollama qwen3-vl screenshot → coordinates | Undetectable elements (not yet validated) |
| OS | pyautogui CGEvent keystrokes | React-controlled inputs rejecting all programmatic events |

### Implementation: `action_engine.py` → `_select_tiers()`

```python
def _select_tiers(self, action_type, el, target):
    target_lower = target.lower()
    role = el.role.lower() if el.role else ""
    has_ax = bool(el.ax_node_id)
    has_react = bool(el.react_props)

    # Check Salestrekker rules first (highest priority)
    st_rules = get_salestrekker_rules(action_type, target)
    if st_rules.get("tier_priority"):
        return st_rules["tier_priority"]

    # Dynamic assessment based on element context...
    if "save" in target_lower:
        return ["REACT", "AX", "CDP", "JS", "KEY"] if has_react else ["AX", "CDP", "JS", "REACT", "KEY"]
    if action_type == ActionType.SELECT:
        return ["CDP", "KEY", "REACT", "AX", "JS"]
    if role in ("link", "tab"):
        return ["JS", "CDP", "AX", "KEY", "REACT"]
```

### Known Salestrekker Rules (from `salestrekker_rules.py`)

| Element | Tier Priority | Why |
|---------|--------------|-----|
| Save / Save and calculate | JS → KEY → CDP → AX | Save works with `b.click()` on enabled button. Verify by polling board for deal title (async, 30-300s). URL never changes. |
| Select one (combobox) | CDP → KEY → REACT → AX → JS | CDP opens menu, keyboard ArrowDown+Enter triggers Radix onChange |
| Add / Add existing person | AX → CDP → JS → REACT → KEY → VIS | Radix dialog button blocks CDP, REACT props bypasses |
| Assets / Liabilities / Income (sidebar) | JS → CDP → AX → KEY → REACT | JS click works for SPA links |
| Type actions | JS → KEY → OS | JS prototype setter fills DOM, OS pyautogui for React-controlled inputs |

## CRITICAL: CDP Runtime.evaluate vs page.evaluate

`page.evaluate()` does NOT expose `__reactFiber$` or `__reactProps$` keys on DOM elements.
These keys are ONLY visible via CDP `Runtime.evaluate` (direct websocket call).

**Correct approach for accessing React props:**
```python
from patchright.sync_api import sync_playwright
pw = sync_playwright().start()
browser = pw.chromium.connect_over_cdp('http://localhost:9222')
page = browser.contexts[0].pages[0]
cdp = page.context.new_cdp_session(page)

# This shows __reactFiber$ and __reactProps$:
result = cdp.send('Runtime.evaluate', {
    'expression': """
        var btn = document.querySelector('button');
        Object.keys(btn).filter(k => k.startsWith('__react'));
    """,
    'returnByValue': True
})
```

## Verification-First (Core Principle)

Success = state changed, not method returned.

Every action captures:
1. `before_state` — structured page summary (URL, buttons, dialogs, inputs, errors, toasts)
2. Execute action
3. `after_state` — same structure
4. State diff — what changed?

Success criteria per action type:
- **click**: new dialog opened OR toast appeared OR URL changed OR API request fired
- **type**: `input.value === expected_value`
- **save**: **CRITICAL: Business outcome verification, NOT URL change**

### Save Verification — Async Polling Required

**The SPA NEVER navigates after Save.** The URL stays on `/deals/add/...`.
Deals are created asynchronously (observed: 30-300s delay). The board updates
independently. Any verification based on URL change will ALWAYS fail.

**Correct approach:** Poll the board for the deal title:

```python
# In verification.py:
verification_result = self._verify_save_async(diff, tier)

# Returns 'pending_async_save' when no immediate change detected
# Then action_engine.py calls:
poll_result = await self.verifier.check_save_result(
    check_url, deal_title=deal_title)
```

The `check_save_result` method:
1. Navigates to the board
2. Checks `document.body.innerText` for the deal title
3. Waits 30s between checks (interval)
4. Times out after 5 minutes (poll_seconds=300)

### Business Outcome Over Technical Signal

| Instead of checking | Check this | Why |
|-------------------|-----------|-----|
| URL changed from /add/ to /view/ | Deal title appears on board | SPA never navigates |
| Toast notification | Board entry with today's date | Async delay means toast may have dismissed |
| Network request posted | Board shows "CREATED" status | Handler exits early on some pages |
| Save click returned `click` | Deal appears in search | Business outcome is the truth |

### Known False Positive: "Client profile successfully updated"

This toast appears even when asset/liability data is NOT persisted. 
Verification must check: did the URL change OR did an API call fire?

## Failure Envelope

Failed actions return structured error:
```json
{
  "status": "failed",
  "action": "click",
  "target": "Save and calculate",
  "tiers_attempted": [
    {"tier": "AX", "error": "element_not_found"},
    {"tier": "CDP", "error": "click_no_state_change"}
  ],
  "verification": {"verified": false, "reason": "no_state_change_detected"},
  "state": {
    "url": "https://.../assets",
    "dialog": null,
    "buttons": ["Prev", "Save and calculate", "Next"],
    "errors": ["Vehicle type is required"]
  }
}
```
This enables LLM diagnosis: "Vehicle type missing → set it → retry Save."

## CRITICAL: Hybrid Framework Detection

Before attempting ANY interaction, detect the page's framework:

```python
framework = page.evaluate("""() => ({
    hasReact: !!window.React || !!window.__REACT_DEVTOOLS_GLOBAL_HOOK__,
    hasVue: !!window.Vue || !!document.__vue_app__,
    hasAngular: !!document.querySelector('[ng-version]'),
    hasSvelte: !!document.querySelector('[svelte-hash]'),
    elementsWithFiber: Array.from(document.querySelectorAll('*'))
        .filter(el => Object.keys(el).some(k => k.toLowerCase().includes('fiber') || k.toLowerCase().includes('props')))
        .length,
    elementsWithCustomProps: Array.from(document.querySelectorAll('*'))
        .filter(el => Object.getOwnPropertyNames(el).some(k => k.startsWith('__')))
        .length,
})""")
```

**Key insight: `__reactFiber$` keys have UNIQUE SUFFIXES** (e.g. `__reactFiber$7aljpldl56b`). Searching for `__reactFiber$` (without the suffix) returns NOTHING. Always use `.includes('Fiber')` or `.includes('Props')` when scanning.

### Hybrid Framework Pattern (Salestrekker-specific)

Salestrekker uses a TWO-FRAMEWORK architecture:
- **Shell:** React (navigation sidebar, document-level event delegation)
- **Forms:** Custom minified framework (closure-based state, no React fibers)

Evidence from CDP debugger:
```
React event dispatch functions ($n/Jr) visible in closure:
  hl = __reactEvents$7aljpldl56b
  dl = __reactFiber$7aljpldl56b  
  pl = __reactProps$7aljpldl56b
BUT: ZERO elements have any __react* keys on the Add deal form
```

**Event flow for Save clicks:**
1. React's document-level `addEventListener('click', $n)` fires FIRST
2. React checks if target is a React component — determines it's NOT
3. React returns without processing
4. Custom framework's `button.addEventListener('click', handler)` fires SECOND
5. Handler checks internal closure state — if invalid → return early (no API call)

**Implication:** React tiers (REACT tier, __reactProps$.onClick) NEVER work on form elements. The form elements are NOT React components. All interaction must go through `addEventListener` interception or OS-level events.

## FORENSICS / DISCOVERY Tier (Added 2026-07-29)

When ALL interaction tiers (CDP/AX/JS/REACT) return `no_state_change_detected`, run FORENSICS before escalating to FIBER or OS.

### Why
The engine was cycling through interaction methods when what was needed was DISCOVERY. The FORENSICS tier answers "Why did the state transition fail?" rather than "How can I force the state transition?"

### Operations

```python
FORENSICS operations:
  1. NETWORK CAPTURE
     cdp.send('Network.enable')
     # Listen for requestWillBeSent events
     # Filter: graphql, api/, or POST with JSON content-type
   
  2. CLOSURE INSPECTION (CDP Debugger)
     cdp.send('Debugger.enable')
     cdp.send('DOMDebugger.setEventListenerBreakpoint', {'eventName': 'click'})
     # Trigger click → debugger pauses at React $n/Jr handlers
     # When paused, call Runtime.getProperties on closure scope objects
   
  3. addEventListener INTERCEPTOR
     Inject BEFORE any framework mounts (on page load):
     - Wrap EventTarget.prototype.addEventListener
     - For function handlers: wrap to proxy isTrusted=true
     - For {handleEvent: fn} objects: override handleEvent method
     - Also proxy MouseEvent constructor

  4. MANUAL TRANSACTION TRACE
     Run forensics_monitor.py which:
     - Enables CDP Network tracking
     - Waits for human click on Save
     - Captures ALL API calls with payload and response
```

### When To Use

Set `skip_to_forensics=True` when:
- Multiple forms (Add deal, Home-loan editor) exhibit the SAME save-failure pattern
- Network requests show ZERO API calls after Save click
- Element has no `__reactProps$` but page clearly uses React (event delegation visible)

## addEventListener Interceptor (Experimental)

Inject this code via `page.evaluate()` on the CURRENT page to wrap all future `addEventListener` calls:

```javascript
(function(){
    if(window.__h) return;
    window.__h = true;
    var _a = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function(t, h, o) {
        if(typeof h === 'function' && (t === 'click' || t === 'input' || t === 'change')) {
            var w = function() {
                var a = Array.from(arguments);
                if(a[0] && a[0].type) {
                    a[0] = new Proxy(a[0], {
                        get: function(target, prop) {
                            if(prop === 'isTrusted') return true;
                            return typeof target[prop] === 'function' ? target[prop].bind(target) : target[prop];
                        }
                    });
                }
                return h.apply(this, a);
            };
            return _a.call(this, t, w, o);
        }
        if(typeof h === 'object' && h.handleEvent && (t === 'click' || t === 'input' || t === 'change')) {
            var origHandle = h.handleEvent.bind(h);
            h.handleEvent = function() {
                var a = Array.from(arguments);
                if(a[0] && a[0].type) {
                    a[0] = new Proxy(a[0], {
                        get: function(t, p) {
                            if(p === 'isTrusted') return true;
                            return typeof t[p] === 'function' ? t[p].bind(t) : t[p];
                        }
                    });
                }
                return origHandle.apply(this, a);
            };
            return _a.call(this, t, h, o);
        }
        return _a.call(this, t, h, o);
    };
})();
```

**Limitations:**
- Only wraps FUTURE `addEventListener` calls (handlers registered before injection are not wrapped)
- `Page.addScriptToEvaluateOnNewDocument` via CDP does NOT persist in CfT environment
- `page.add_init_script()` does NOT work for CDP-connected pages (only for Playwright-created pages)

## CDP Debugger Closure Capture

When `DOMDebugger.setEventListenerBreakpoint` pauses execution, capture closure variables:

```python
# Send Runtime.getProperties on closure scope objects
await ws.send(json.dumps({
    "id": "props",
    "method": "Runtime.getProperties", 
    "params": {"objectId": scope_object_id, "ownProperties": True}
}))

# Read response (comes as separate message on the same WebSocket)
# DONT resume (Debugger.resume) BEFORE receiving the getProperties response
```

**Timing is critical:** Send getProperties BEFORE resume. The closure scope's objectId remains valid while paused, but becomes invalid after resume.

1. **Radix portal blocks clicks**: CDP mouse events open menus but don't trigger button onClick. Use T2-REACT (React props fallback) or pointerdown event.
2. **False-positive "Client profile successfully updated"**: Save handler runs but asset data is NOT persisted. Verification must check for URL change OR API call, not just the toast message.
3. **Asset form NOT React-controlled**: Inputs have 0 own properties, no `__reactFiber$`, no `__reactProps$`, no `_valueTracker`. The Save button IS React but reads state from fiber, not DOM.
6. **Add deal form: Title input NOT React-controlled**: `input[name="name"]` has NO `__reactFiber$`, NO `__reactProps$`. Parent component tracks form state independently. The Save button's `disabled` state is bound to this parent state, not DOM values.
7. **Add deal form Save button**: Stays disabled even after filling ALL visible fields via keyboard. Parent component's form state machine never receives the DOM value changes. Events (`input`, `change`, `blur`, `focusout`, `beforeinput`) fire but React's form lib ignores them. **The only known fix is pyautogui OS-level click** after removing the `disabled` attribute — real CGEvents go through native event delegation that React captures correctly.
8. **Value field formatting**: `.type("800000")` produces "$8,000,000". Use native prototype setter: `Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '800000')`.
5. **Radix combobox**: CDP mouse click + ArrowDown/Enter for option selection. `element.click()` via evaluate is ignored.

## Tools Available

- **bws CLI**: `bws secret list | python3 -c "..."` — access API keys (OpenRouter, etc.)
- **Ollama**: `localhost:11434/v1` with `qwen3-vl:4b` for visual grounding
- **pyautogui**: Real CGEvent keystrokes via `pyautogui.typewrite()` (included in `gui-agents`)
- **Agent-S3**: `gui-agents` v0.3.2 with grounding model for autonomous vision-guided actions

## FRS-005 Implementation

All 4 phases completed and shipped 28 Jul 2026. ~1,900 lines across 10 source modules at `apps/state-engine/`:

| Module | Purpose |
|--------|---------|
| `cdp_connection.py` | **Synchronous send/recv** — no background reader task (avoids event-loop conflict with uvicorn). Direct page-level WebSocket to CfT (NOT browser-level WS + Target.attachToTarget). Each send() reads messages until matching response ID; events dispatched inline. |
| `state_cache.py` | Lazy DOM/AX/screenshot capture, Dirty/DirtyCritical invalidation |
| `state_diff.py` | Structured before/after comparison |
| `verification.py` | Per-action-type success rules, false positive detection |
| `failure_envelope.py` | Structured error with page context for LLM |
| `resolver.py` | AX → DOM exact → DOM includes → aria cascade with confidence scores |
| `action_engine.py` | **Dynamic tier selection** — assesses element type, React props, AX visibility, and Salestrekker rules to deploy the best tier FIRST. Replaced linear T0→T1→T2 with `_select_tiers()` |
| `action_journal.py` | JSON-Lines telemetry at `~/.hermes/logs/state-engine/actions.jsonl` |
| `workflow_engine.py` | YAML workflow loader + parameterized executor |
| `salestrekker_rules.py` | Known-bug overrides, custom tier priority per element |
| `main.py` | FastMCP server via SSE on :9110. Single event loop: `asyncio.run(serve())` → `await uvicorn.Server(uvicorn.Config(mcp.sse_app())).serve()`. 5 tools. |

## CRITICAL: CDP Connection — Synchronous Send/Recv (No Background Reader)

**The biggest recurring bug was "Future attached to a different loop" causing 15s CDP timeouts.** Root cause: the CDP connection's background reader task (`asyncio.create_task(self._reader())`) was created inside the engine startup event loop, but uvicorn/FastMCP creates its own event loop. The reader task would be orphaned and never dispatch responses.

**Fix in `cdp_connection.py` v2:**
- No `create_task()` for background reading
- Each `send()` call writes the request, then reads messages in a loop until it finds the matching response ID by `data.get("id") == msg_id`
- Events are dispatched to subscribers inline when encountered in the read loop
- `Runtime.evaluate` must pass `"awaitPromise": False` to avoid hanging on Promise-based React renderers

```python
async def send(self, method, params=None):
    msg_id = self._next_id()
    cmd = {"id": msg_id, "method": method, "params": params or {}}
    await self._ws.send(json.dumps(cmd))

    while True:
        msg = await asyncio.wait_for(self._ws.recv(), timeout=15)
        data = json.loads(msg)
        resp_id = data.get("id")
        # Dispatch events to subscribers
        if resp_id is None and data.get("method", "") in self._subscribers:
            for cb in self._subscribers[data["method"]]:
                await cb(data.get("params", {}))
            continue
        # Found matching response
        if resp_id == msg_id:
            return data.get("result", {})
```

See `references/closure-forensics-session-2026-07-29.md` for the full debugger-based closure capture technique and the addEventListener interceptor approach.
- No `create_task()` for background reading
- Each `send()` call writes the request, then reads messages in a loop until it finds the matching response ID by `data.get("id") == msg_id`
- Events are dispatched to subscribers inline when encountered in the read loop
- `Runtime.evaluate` must pass `"awaitPromise": False` to avoid hanging on Promise-based React renderers

```python
async def send(self, method, params=None):
    msg_id = self._next_id()
    cmd = {"id": msg_id, "method": method, "params": params or {}}
    await self._ws.send(json.dumps(cmd))

    while True:
        msg = await asyncio.wait_for(self._ws.recv(), timeout=15)
        data = json.loads(msg)
        resp_id = data.get("id")
        # Dispatch events to subscribers
        if resp_id is None and data.get("method", "") in self._subscribers:
            for cb in self._subscribers[data["method"]]:
                await cb(data.get("params", {}))
            continue
        # Found matching response
        if resp_id == msg_id:
            return data.get("result", {})
```

## Running: HTTP/SSE Transport (Preferred over Stdio)

The State Engine runs as a FastMCP server on port 9110 with SSE transport:

```bash
cd apps/state-engine && python3 main.py
# Server on http://localhost:9110/sse
```

**From an MCP client:**
```python
from mcp import ClientSession
from mcp.client.sse import sse_client

async with sse_client(url="http://localhost:9110/sse", timeout=10, sse_read_timeout=30) as streams:
    async with ClientSession(*streams) as mcp:
        await mcp.initialize()
        state = await mcp.call_tool("mcp_state", {})
```

**CRITICAL: `sse_read_timeout=30`** — Without this, the SSE connection drops before the session initializes. The default 300s is too short for the first CDP connection.

**HTTP server implementation** uses `mcp.sse_app()` + `uvicorn.Server` in a single event loop:
```python
app = mcp.sse_app()
config = uvicorn.Config(app, host="0.0.0.0", port=9110, log_level="info")
server = uvicorn.Server(config)
await server.serve()
```

This avoids the "Future attached to different loop" error that occurs when engine startup and the MCP server use different event loops.

## Running: Stdio Transport (Legacy — Not for Testing)

Stdio works by piping JSON-RPC via stdin/stdout, but **NOT recommended**:
- `Popen.communicate()` is one-shot (closes stdin after first request)
- Persistent pipe with `proc.stdin.write()` + `proc.stdout.read(1)` has race conditions on pipe buffer fills
- stderr redirect to PIPE can block the process if the buffer fills

Use HTTP/SSE for any multi-call workflow.

## Running: streamable-http (Avoid)

FastMCP `transport="streamable-http"` exposes `/mcp` POST endpoint. Avoid for now:
- Requires `Accept: application/json, text/event-stream` header
- Requires session negotiation via SSE first (circular dependency)
- FastMCP 1.28 returns "Missing session ID" on first HTTP request

## CfT/Patchright locator.type() Bug (CRITICAL)

`page.locator('input[name="name"]').first.type('text', delay=3)` **hangs for 30s and times out** on CfT Chrome 151. This is a CfT-specific bug with Patchright's `type()` method. The locator finds the element but the type action never dispatches.

**Fix: Use keyboard events instead**

```python
# DON'T — hangs 30s:
page.locator('input[name="name"]').first.type('My Title', delay=3)

# DO — works reliably:
page.evaluate("document.querySelector('input[name=\"name\"]').focus()")
time.sleep(0.3)
page.keyboard.type('My Title', delay=3)
```

This applies to ALL text inputs on Salestrekker forms when using CfT. The `page.keyboard.type()` method sends real keyboard events that work correctly.

## pyautogui OS-Level Clicks for React-Controlled Buttons

When the Save button (or any React button) checks internal form state before enabling/disabling, CDP mouse events, JS clicks, and React props calls all fail because the parent component's state machine never updates from programmatic DOM changes.

**Only pyautogui OS-level clicks work** — real CGEvent mouse clicks go through macOS's window server into Chrome's native event handler, which React's event delegation system captures as a legitimate user interaction.

### Implementation

```python
import pyautogui

# 1. Get button's viewport-relative position
coords = page.evaluate("""()=>{
    for(var b of document.querySelectorAll('button')){
        if(b.textContent.trim()==='Save'){
            var r = b.getBoundingClientRect();
            return {x: Math.round(r.x+r.width/2), y: Math.round(r.y+r.height/2)};
        }
    }
    return null;
}""")

# 2. Get CfT window position via osascript
import subprocess
pos = subprocess.run(
    ['osascript', '-e', 'tell app "System Events" to get position of window 1 of process "Google Chrome for Testing"'],
    capture_output=True, text=True, timeout=5
)
wx, wy = map(int, pos.stdout.strip().split(', '))

# 3. Calculate screen coordinates and click
screen_x = wx + coords['x']
screen_y = wy + coords['y']
pyautogui.click(screen_x, screen_y)
```

### When to Use

- **Save button on Add deal form** — Always disabled by React parent state. Remove `disabled` attribute first, then OS-click.
- **Any Radix dialog button** that doesn't respond to CDP mouse events
- **React-controlled form submissions** where the onClick handler checks internal form state

### Warning

pyautogui moves the REAL cursor. Coordinate calculation must account for:
- CfT window position (viewport origin)
- Page scroll offset
- Element bounding box center

## Lead Source Radix Combobox — Proven Keyboard Approach

The Lead source combobox (`[name="leadSource"]`) does NOT accept `keyboard.type('Existing client', delay=10)`. Instead:

```python
# Click to open the combobox
page.evaluate("document.querySelector('[name=\"leadSource\"]').click()")
time.sleep(1.5)

# ArrowDown selects first option, Enter confirms
page.keyboard.press('ArrowDown')
time.sleep(0.3)
page.keyboard.press('Enter')
time.sleep(1.5)
```

The `ArrowDown` once selects the first option ("Existing client" for Lead source). `Enter` confirms the selection and closes the dropdown.

## CfT Session Expiry

Repeated SPA navigation via `window.location.href` to authenticated routes can trigger sign-out. The sign-out screen shows "See you again soon" with "Back to Sign in" button. This causes ALL Patchright locator calls to time out (target input doesn't exist on sign-out page).

Fix: navigate to `/auth/sign-in` and re-authenticate. CfT profile auto-fills credentials.

## CDP Timeout Diagnosis

If `Runtime.evaluate` silently times out (15s default), check:
1. **Event loop conflict** — background reader on different loop? Use sync send/recv pattern (see above).
2. **Expression hangs** — React SPA may have pending Promise. Add `"awaitPromise": False` to CDP params.
3. **CfT down** — check `curl -s http://localhost:9222/json`. Restart via launchd script.
4. **Page signed out** — URL contains `/auth/sign-out`. Check `document.body.innerText.includes("See you again soon")`.

## Salestrekker Page Selection Gotcha

`browser.contexts[0].pages[0]` is often the **New Tab page** (`chrome://new-tab-page/...`), not Salestrekker. Always find by URL:
```python
page = None
for ctx in browser.contexts:
    for p in ctx.pages:
        if 'salestrekker' in p.url.lower():
            page = p; break
    if page: break
```

Full specification: `docs/FRS-005-state-engine-mcp-v1.md`
OpenSpec change: `openspec/changes/state-engine-mcp/`
