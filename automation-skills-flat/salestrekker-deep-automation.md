---
name: salestrekker-deep-automation
description: Deep technical research and advanced techniques for automating React-controlled and hybrid forms in Salestrekker 2.0 — React fiber inspection, CDP Runtime.evaluate, pyautogui OS-level keystrokes, Agent-S setup.
tags: [salestrekker, automation, react, cdp, pyautogui, research, agent-s]
---

# Salestrekker Deep Automation — Advanced Techniques

## React Fiber Inspection via CDP Runtime.evaluate

`page.evaluate()` hides React-injected properties (`__reactProps$`, `__reactFiber$`) from Object.keys/Object.getOwnPropertyNames. Use a CDP session directly:

```python
cdp = page.context.new_cdp_session(page)
result = cdp.send('Runtime.evaluate', {
    'expression': """
    Object.getOwnPropertyNames(
        Array.from(document.querySelectorAll('button'))
            .find(b => b.textContent.includes('Save'))
    ).filter(k => k.startsWith('__react'))
    """,
    'returnByValue': True
})
```

This works because Runtime.evaluate returns results through the CDP serialization path, which preserves React-injected properties that page.evaluate()'s JavaScript sandbox strips.

## Asset Form: NOT React-Controlled

The Salestrekker 2.0 asset/expense/liability/income sections use **native HTML inputs** inside a React SPA shell:

| Check | Value | Meaning |
|-------|-------|---------|
| `inputOwnKeysCount` | 0 | No React fiber/props on inputs |
| `formCount` | 0 | No `<form>` element |
| `_valueTracker` | none | React isn't tracking these inputs |
| `onclick` on Save | null | Uses addEventListener, not inline onclick |

The native setter pattern DOES fill the DOM visually but the Save handler reads from React internal state (memoizedState in the fiber tree), not the DOM. Data never persists.

## Save Button: React Wrapper, addEventListener Handler (UPDATED)

The Add deal form's Save button uses `addEventListener` with a `handleEvent` object (not a function):
- `typeof btn.onclick === 'object'` (not `'function'`)
- NO `__reactProps$` keys on the button element
- `Object.keys(btn)` returns zero React-internal keys
- The handler reads from internal React/Formik state, not DOM values
- Returns before making ANY network request — confirmed by CDP Network monitoring
- `element.click()` does nothing on disabled buttons
- `dispatchEvent(new MouseEvent('click'))` creates **untrusted** events — React checks `event.isTrusted` and ignores synthetic events
- CDP `Input.dispatchMouseEvent` creates trusted events but handler checks form state

**Detection:**
```python
info = page.evaluate("""()=>{
    var b = document.querySelector('button:has-text("Save")');
    return {
        onclickType: typeof b.onclick,  # 'object' = handleEvent
        allReactKeys: Object.keys(b).filter(k => k.startsWith('__react'))
    };
}""")
```

**In contrast:** The home-loan editor view's "Save and calculate" button DOES have `__reactProps$` and responds to `props.onClick()` via CDP Runtime.evaluate.

**AddEventListener detection** (when save button has no addEventListener on the element itself):
```python
btn_info = page.evaluate("""()=>{
    var b = document.querySelector('button:has-text("Save")');
    // Check if onclick is a handleEvent object (used by addEventListener)
    var onclickType = typeof b.onclick;
    var hasEventListeners = typeof b.getEventListeners === 'function';
    return { onclickType: onclickType, hasGetEventListeners: hasEventListeners };
}""")
```

## isTrusted Proxy Bypass — Research Finding

The known workaround: intercept `EventTarget.prototype.addEventListener` and wrap each callback with a Proxy that forces `event.isTrusted = true`. Must be injected BEFORE React mounts.

```javascript
(function(){
    if(window.__h) return; window.__h = true;
    var _a = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function(t, h, o) {
        if(typeof h === 'function') {
            var w = function() {
                var a = Array.prototype.slice.call(arguments);
                if(a[0] && a[0].type) {
                    a[0] = new Proxy(a[0], {
                        get: function(target, prop) {
                            return prop === 'isTrusted' ? true : target[prop];
                        }
                    });
                }
                return h.apply(this, a);
            };
            return _a.call(this, t, w, o);
        }
        return _a.call(this, t, h, o);
    };
})();
```

**Preferred injection:** `page.add_init_script(code)` — Patchright API that runs before any page script. CDP's `Page.addScriptToEvaluateOnNewDocument` has origin-scoping issues with `connect_over_cdp()`. `page.add_init_script()` also has limited support with `connect_over_cdp` — for reliable injection, create pages fresh via `browser.new_page()`.

## CDP Network Monitoring — API Call Capture

The Save button handler returns before making any network request when form state is "invalid". To capture the actual GraphQL endpoint and mutation:

```python
cdp = page.context.new_cdp_session(page)
cdp.send('Network.enable')
api_calls = []
def on_req(params):
    req = params.get('request', {})
    url = req.get('url', '')
    if 'graphql' in url.lower() or 'api' in url.lower():
        api_calls.append({'url': url, 'method': req.get('method', ''), 'postData': req.get('postData', '')})
cdp.on('Network.requestWillBeSent', on_req)
```

**Real human click required** to capture the API — no programmatic click triggers the request.

## ADDITION: Field Fill Techniques

| Field | Selector | Method | Notes |
|-------|----------|--------|-------|
| Title | `input[name="name"]` | `keyboard.type()` after `focus()` | NOT `locator.type()` which hangs in CfT |
| Value | `input[name="value.total"]` | `keyboard.type()` after `focus()` | Formatted as `$ 800,000` in DOM |
| Lead source | `[name="leadSource"]` combobox | `.click()` then `ArrowDown` + `Enter` | Radix combobox |
| Contact search | `input[name="query"]` | `.last.type('Sam Smith')` | Multiple query fields exist |

## Login Field Names (CfT fresh profile)
- Email: `input[name="eMail"]` (capital M)
- Password: `input[name="password"]`

## Tier 5: pyautogui Real OS-Level Events

Install: `pip install gui-agents` (includes pyautogui + pyobjc)

pyautogui sends genuine macOS CGEvent keystrokes that React's synthetic event system CANNOT ignore:

```python
import pyautogui
import subprocess

# Get CfT window position
result = subprocess.run(['osascript', '-e', '''
tell application "System Events"
    tell first process whose name contains "Chrom"
        set {x, y} to position of window 1
        return x & "," & y
    end tell
end tell
'''], capture_output=True, text=True, timeout=5)
win_x, win_y = map(int, result.stdout.strip().split(','))

# Click field and type via real OS events
pyautogui.click(win_x + field_x, win_y + field_y)
pyautogui.typewrite('BMW 3 Series', interval=0.02)
pyautogui.press('tab')
pyautogui.typewrite('40000', interval=0.02)
```

## Tier 5b: Agent-S (Simular AI) Setup

```bash
pip install gui-agents
# Also needs: brew install tesseract
```

The `gui-agents` package provides:
- AgentS3 class: full AI agent with vision + action
- pyautogui: real OS-level input
- pyobjc: macOS Objective-C bridge
- paddleocr/pytesseract: OCR screen reading
- selenium: WebDriver fallback

## 4-Tier Escalation (Extended)

- **T0**: CDP evaluate → locator.type() → native setter
- **T1**: Chrome MCP (browser_console)
- **T2**: browser-act CLI
- **T3**: Qwen3 VL vision model
- **T4**: CUA-driver desktop control
- **T5**: pyautogui / Agent-S real OS keystrokes

After 2 same-approach failures, escalate to the next tier. After all tiers fail, research and change approach fundamentally.
