# Closure Forensics Session — 2026-07-29

## Discovery

The Salestrekker Add deal form and Home-loan editor use a **hybrid framework**:
- **Shell:** React (event delegation at document level)
- **Forms:** Custom minified framework (closure-based state)

This was discovered via CDP Debugger breakpoints:
1. `DOMDebugger.setEventListenerBreakpoint` for `click` events
2. When JS paused at `Debugger.paused`, called `Runtime.getProperties` on closure scope objects
3. Captured 984 closure variables — including React event system keys (`__reactEvents$7aljpldl56b`, `__reactFiber$7aljpldl56b`, etc.)
4. But ZERO DOM elements had any `__react*` properties

## Key Technique: CDP Debugger for Closure Capture

```python
import websockets, requests as rq

ws_url = rq.get('http://localhost:9222/json').json()[0]['webSocketDebuggerUrl']

async def capture_closure():
    async with websockets.connect(ws_url, max_size=2**26) as ws:
        # Enable debugger
        await ws.send(json.dumps({"id": 1, "method": "Debugger.enable"}))
        
        # Set breakpoint on ALL click events
        await ws.send(json.dumps({
            "id": 2, "method": "DOMDebugger.setEventListenerBreakpoint",
            "params": {"eventName": "click"}
        }))
        
        # Trigger click
        await ws.send(json.dumps({
            "id": 3, "method": "Runtime.evaluate",
            "params": {
                'expression': 'document.querySelector("button").click()',
                'returnByValue': True
            }
        }))
        
        # On Debugger.paused:
        # For each callFrame in params.callFrames:
        #   For each scopeChain entry where type == 'closure':
        #     Runtime.getProperties on scope.object.objectId
        #   Debugger.resume
        
        # CRITICAL: Send getProperties BEFORE resume
        # The closure objectId becomes invalid after resume
```

## Hybrid Framework Detection

Use `.includes('Fiber')` or `.includes('Props')` — NOT an exact match for `__reactFiber$`:

```javascript
// WRONG — returns nothing (suffix varies per build)
elements.some(k => k === '__reactFiber$')

// RIGHT — finds all React-built elements
elements.some(k => k.includes('Fiber') || k.includes('Props'))
```

## Failed Approaches (All Exhausted)

| Approach | Layer | Result |
|----------|-------|--------|
| Input.dispatchMouseEvent | CDP | ❌ |
| element.click() + dispatchEvent | JS | ❌ |
| Tab+Enter (trusted) | Keyboard | ❌ |
| pyautogui click at pixel | OS mouse | ❌ |
| CGEventPost | OS HID | ❌ |
| Network.requestWillBeSent | Network | ❌ (0 calls) |
| Debugger breakpoint + closure capture | Debugger | ⚠️ (state unreachable) |
| Page.addScriptToEvaluateOnNewDocument | CDP injection | ❌ (doesn't persist) |
| page.add_init_script() | Playwright | ❌ (CDP-connected only) |
| Fetch.enable bundle interception | CDP network | ❌ (process interference) |

## Root Cause

The Save handler reads form state from a JavaScript closure that is INACCESSIBLE from any CDP, JS, or OS-level interaction. The closure is created when the minified bundle (`main.1ff6a4...js`) executes at page load. Handlers registered via `addEventListener` or `{handleEvent: fn}` pattern capture references to internal state variables. Our keyboard/evaluate events update the DOM but never modify these closure variables.

## Recommendation

If interaction tiers all fail, the next step is FORENSICS:
1. Capture the network request from a MANUAL (human) Save click
2. Decompile the minified bundle to find the persistence endpoint
3. Replicate the API call from within the browser context
