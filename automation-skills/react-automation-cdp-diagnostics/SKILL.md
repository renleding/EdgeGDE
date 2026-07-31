---
name: react-automation-cdp-diagnostics
description: CDP-level diagnostic techniques for React SPA automation — how to probe React fiber tree, find component state, distinguish controlled vs uncontrolled inputs, and access addEventListener handlers.
tags: [react, cdp, diagnostics, debugging, salestrekker, automation]
related_skills:
  - salestrekker-react-automation
  - browser-automation-mcp-architecture
  - agent-process-automation
---

# React Automation CDP Diagnostics

## Detecting React-Controlled Inputs

Use `Object.getOwnPropertyNames()` to check if an input has React internals:

```javascript
var input = document.querySelector('input');
var keys = Object.getOwnPropertyNames(input);
var fiberKey = keys.find(k => k.startsWith('__reactFiber$'));
var propsKey = keys.find(k => k.startsWith('__reactProps$'));
var tracker = input._valueTracker;

console.log({
    isReactControlled: !!fiberKey,
    hasValueTracker: !!tracker,
    ownKeysCount: keys.length,
    nativeSetterInUse: !Object.getOwnPropertyDescriptor(input, 'value')
});
```

**Interpretation:**
- `fiberKey` exists + `tracker` exists = React controlled input (value managed by React state)
- No fiber, no tracker, 0 own keys = native HTML input (setting `.value` directly should work)
- `typeof b.onclick === 'object'` = `null` (typeof null === 'object'). Handler is via addEventListener.

## Accessing React Fibers

**CRITICAL:** `page.evaluate()` strips React-injected properties from serialized results. Always use raw CDP `Runtime.evaluate` via the CDP session:

```python
# ❌ page.evaluate — React keys invisible
page.evaluate("Object.keys(button)")  # → []

# ✅ CDP Runtime.evaluate — React keys preserved
cdp.send('Runtime.evaluate', {
    'expression': 'Object.keys(document.querySelector("button"))',
    'returnByValue': True
})  # → ['__reactFiber$...', '__reactProps$...', ...]
```

## Calling React onClick Directly

Once you have the props key, call `props.onClick()`:

```javascript
// Via CDP Runtime.evaluate (NOT page.evaluate)
var btn = document.querySelectorAll('button');
for(var b of btn) {
    if(b.textContent.includes('Save')) {
        var keys = Object.getOwnPropertyNames(b);
        var propsKey = keys.find(k => k.startsWith('__reactProps'));
        if(propsKey && typeof b[propsKey].onClick === 'function') {
            b[propsKey].onClick();  // Direct React handler call
        }
    }
}
```

**Note:** This calls the handler but React state is often empty because the handler reads component state, not DOM values.

## Triggering addEventListener Handlers

Element click handlers attached via `addEventListener` (React's event delegation):

```javascript
// ❌ element.click() — does NOT trigger addEventListener handlers
element.click();

// ✅ dispatchEvent(new Event('click')) — DOES trigger addEventListener
element.dispatchEvent(new Event('click', {bubbles: true, cancelable: true}));

// ❌ CDP dispatchMouseEvent — does NOT trigger React synthetic handlers
cdp.send('Input.dispatchMouseEvent', ...)
```

## Finding the Form Element

```javascript
// Check if there's a form
var forms = document.querySelectorAll('form');
console.log('Form count:', forms.length); // 0 = no form element
```

If no form exists, `form.submit()`, `form.requestSubmit()`, and `form.dispatchEvent(new Event('submit'))` are all impossible. Save can only be triggered via button click event chain.

## Complete Probe Script

```python
result = cdp.send('Runtime.evaluate', {
    'expression': '''
    (function() {
        var r = {};
        
        // Check inputs
        var input = document.querySelector('input');
        if(input) {
            var keys = Object.getOwnPropertyNames(input);
            r.inputKeys = keys.filter(k => k.startsWith('__react'));
            r.inputKeyCount = keys.length;
            r.tracker = input._valueTracker ? input._valueTracker.getValue() : 'none';
            r.isControlled = !!keys.find(k => k.startsWith('__reactFiber'));
        }
        
        // Check Save button
        for(var b of document.querySelectorAll('button')) {
            if(b.textContent.includes('Save')) {
                var bKeys = Object.getOwnPropertyNames(b);
                r.saveButtonPropsKey = bKeys.find(k => k.startsWith('__reactProps'));
                r.saveButtonFiberKey = bKeys.find(k => k.startsWith('__reactFiber'));
                r.saveOnclickNull = (b.onclick === null);
                break;
            }
        }
        
        // Check forms
        r.formCount = document.querySelectorAll('form').length;
        
        return JSON.stringify(r);
    })()
    ''',
    'returnByValue': True
})
```

## Salestrekker Asset Form — Specific Diagnostic Findings (Jul 2026)

### No `<form>` Element

```javascript
document.querySelectorAll('form').length  // → 0
```

There is NO `<form>` element wrapping the editor sections. This means:
- `form.submit()` — impossible
- `form.requestSubmit()` — impossible
- `form.dispatchEvent(new Event('submit'))` — impossible
- The only way to trigger Save is via the button's React event handler chain

### `_valueTracker` Confirmed Absent

The React DOM internal `_valueTracker` mechanism is NOT installed on asset form inputs. React is not overriding the value setter. The inputs use the native `HTMLInputElement.prototype.value` setter directly.

### `page.evaluate` vs `Runtime.evaluate` — Critical Trap

**This is the most common debugging error.** The two methods give DIFFERENT results for React-injected properties:

```python
# ❌ page.evaluate — React fibers are INVISIBLE
page.evaluate("Object.getOwnPropertyNames(button)")
# Returns: []  (React fibers stripped by serialization)

# ❌ page.evaluate — even with specific key access
page.evaluate("document.querySelector('button').__reactProps$")
# Returns: undefined  (can't access through evaluate)

# ✅ CDP Runtime.evaluate via cdp.send — React fibers ARE visible
cdp.send('Runtime.evaluate', {
    'expression': 'Object.getOwnPropertyNames(document.querySelector("button"))',
    'returnByValue': True
})
# Returns: ['__reactFiber$vh8jbm6pwh', '__reactProps$vh8jbm6pwh']

# ✅ Runtime.evaluate can access React props and call handlers
cdp.send('Runtime.evaluate', {
    'expression': '''
    var b = document.querySelector("button");
    var k = Object.keys(b).find(k => k.startsWith('__reactProps'));
    if(k && typeof b[k].onClick === 'function') { b[k].onClick(); }
    ''',
    'returnByValue': True
})
```

**Root cause:** `page.evaluate()` uses `Runtime.callFunctionOn` internally which serializes results through structured clone — React-injected symbol-keyed or getter-based properties are lost. `Runtime.evaluate` with `returnByValue: True` preserves them.

### Interpreting Diagnostic Results

| Finding | Meaning |
|---------|---------|
| `inputKeyCount: 0` | Input is native HTML, NOT React controlled |
| `hasTracker: false` | React is not tracking this input |
| `setterIsNative: true` | Native value setter in use — setting `.value` directly should work at DOM level |
| `savePropsKey: '__reactProps$...'` | Save button IS React — has onClick handler via props |
| `saveOnclickNull: true` | onclick is literally null (typeof null === 'object') |
| `saveOnclickType: 'object'` | `typeof null === 'object'` — handler via addEventListener |
| `formCount: 0` | No form element — can't use form.submit() or requestSubmit() |
| `onclick.name: 'anonymous'` | React wraps handlers — callable but may not read DOM |

### Persistence Rule

When all diagnostics confirm values ARE in the DOM before Save but data doesn't persist:

**Do NOT give up on a single approach.** The user has explicitly stated: "keep trying different techniques, do not stop." Change approach fundamentally after 2 failures of the same type:

```
CDP evaluate failed → keyboard events
Keyboard failed → CDP mouse events
CDP mouse failed → React fiber props.onClick()
React props failed → OS-level events (pyautogui)
OS-level failed → AI vision agent (Agent-S3)
```

### CDP Raw WebSocket Approach (Fallback)

When Patchright/CDP sessions are unreliable or you need React fiber access:

```python
import asyncio, json, websockets, requests

targets = requests.get('http://localhost:9222/json', timeout=5).json()
page_ws = targets[0]['webSocketDebuggerUrl']

async def go():
    async with websockets.connect(page_ws) as ws:
        async def js(expr):
            await ws.send(json.dumps({
                'id':1,'method':'Runtime.evaluate',
                'params':{'expression':expr,'returnByValue':True}
            }))
            resp = json.loads(await asyncio.wait_for(ws.recv(), timeout=8))
            return resp.get('result',{}).get('result',{}).get('value','')
        
        title = await js('document.title')
        await js("window.location.href = '/path'")
        await asyncio.sleep(6)

asyncio.run(go())
```

This bypasses Playwright/Patchright entirely. Useful when:
- `connect_over_cdp` hangs
- `page.evaluate` strips React internals
- Need low-level CDP methods not exposed by Playwright API

## Agent-S3 (Tier 5) — Last Resort

When all CDP tiers fail, Agent-S3 sends real OS-level events. See `browser-automation-mcp-architecture` skill for setup instructions.
