---
name: react-form-automation-diagnostics
description: "Forensic analysis techniques for debugging React form automation failures. How to determine if a form is React-controlled, find React fibers, access __reactProps, and diagnose why programmatic input doesn't persist."
tags: [react, automation, cdp, debugging, forms, diagnostics]
related_skills:
  - salestrekker-react-automation
---

# React Form Automation Diagnostics

## When to use this skill

When a React form does not respond to programmatic input (`.type()`, `.fill()`, evaluate setter, keyboard events) and you need to determine WHY. Use CDP `Runtime.evaluate` for forensic analysis.

## Quick diagnostic: Is this form React-controlled?

Run this from CDP `Runtime.evaluate` (NOT `page.evaluate`):

```javascript
(function() {
    var results = {};
    var input = document.querySelector('input');
    if (!input) return 'no input found';
    
    // 1. Check for React fiber/props on the input itself
    var ownKeys = Object.getOwnPropertyNames(input);
    results.inputOwnKeys = ownKeys;
    results.hasReactFiber = ownKeys.some(k => k.toLowerCase().includes('reactfiber'));
    results.hasReactProps = ownKeys.some(k => k.toLowerCase().includes('reactprops'));
    results.sampleReactKeys = ownKeys.filter(k => k.toLowerCase().includes('react')).slice(0, 5);
    
    // 2. Check for _valueTracker (React's internal input value tracking)
    results.hasValueTracker = '_valueTracker' in input;
    results.valueTrackerValue = input._valueTracker ? input._valueTracker.getValue() : null;
    
    // 3. Check if value property is overridden on the element
    var elementDesc = Object.getOwnPropertyDescriptor(input, 'value');
    var protoDesc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    results.valueSetterIsOverridden = elementDesc ? (elementDesc.set !== protoDesc.set) : false;
    
    // 4. Check for form element
    results.formCount = document.querySelectorAll('form').length;
    
    // 5. Check Save button for React props
    var btns = document.querySelectorAll('button');
    for(var b of btns) {
        if(b.textContent.includes('Save')) {
            var bKeys = Object.getOwnPropertyNames(b);
            results.saveButtonReactFiber = bKeys.some(k => k.startsWith('__reactFiber$'));
            results.saveButtonReactProps = bKeys.some(k => k.startsWith('__reactProps$'));
            results.saveOnclickType = typeof b.onclick;
            results.saveOnclickIsNull = b.onclick === null;
            break;
        }
    }
    
    return results;
})()
```

### Interpreting the results

| Pattern | Diagnosis |
|---------|-----------|
| No `__reactFiber$` on inputs, no `_valueTracker`, `valueSetterIsOverridden=false` | **Not React-controlled.** Inputs are native HTML elements. Setting `.value` via prototype setter SHOULD work, but the Save handler reads from a different state store. |
| No `__reactFiber$`, `__reactProps$`, or `_valueTracker` on inputs, Save button has `__reactFiber$` | **Form state managed by PARENT React component.** The input is a native DOM element but its value is read by a parent component through a ref or custom hook (mutation observer, direct DOM read in render cycle, etc.). The Save button checks this parent state, not DOM values. Programmatic input updates the DOM but the parent never re-reads it. |
| Has `__reactFiber$` on inputs, has `_valueTracker` | **React-controlled.** Need to use React event system (`__reactProps.onChange`) or prototype setter + dispatchEvent. |
| Has `__reactProps$` but NOT `__reactFiber$` on button | React attached event handlers but the element might be a Portal child or SSR'd. |
| `saveButtonReactFiber=true` but `saveOnclickIsNull=true` and `typeof b.onclick === 'object'` | Handler is via `addEventListener` with a `handleEvent` object, not `onclick` attribute. `element.click()` via evaluate will NOT trigger it. Use `dispatchEvent(new Event('click', {bubbles:true}))` — BUT note that dispatched events are **untrusted** (`event.isTrusted === false`) and React v17+ checks this and ignores untrusted events. See event.isTrusted section below. |
| `formCount=0` | No `<form>` element. Cannot use `form.submit()` or `form.requestSubmit()`. Save is via button click handler only. |

## CRITICAL: event.isTrusted — React Ignores Synthetic Events

React v17+ attaches event listeners to the React root container (not document). When a real user clicks, the browser creates a **trusted** event (`event.isTrusted === true`). When JavaScript calls `dispatchEvent()`, the event is **untrusted** (`event.isTrusted === false`).

**React's event delegation checks `event.isTrusted`** in some versions and configurations. Dispatched events bubble to the React root but may be silently ignored because they are untrusted.

This affects:
- `element.dispatchEvent(new MouseEvent('click', {bubbles: true}))` — UNTRUSTED
- `element.dispatchEvent(new PointerEvent('pointerdown', ...))` — UNTRUSTED
- `element.dispatchEvent(new Event('input', {bubbles: true}))` — UNTRUSTED
- `element.click()` — creates a TRUSTED event ONLY if the element is not disabled and the click is from a user gesture

The ONLY way to create trusted events programmatically:
1. **CDP `Input.dispatchMouseEvent`** — creates trusted events via Chrome's input pipeline
2. **CUA/pyautogui OS-level clicks** — real CGEvent through macOS window server
3. **User interaction** — actual mouse/keyboard

### Verified on Salestrekker (28 Jul 2026)

The Save button in the Add deal form uses `addEventListener` with a `handleEvent` object. Even after removing `disabled` and dispatching `MouseEvent('click')`, the handler does NOT fire because:
1. The event is untrusted
2. React's event delegation ignores it
3. No API call is made (confirmed: zero network requests via CDP)

CDP `Input.dispatchMouseEvent` creates a trusted event but the handler checks internal form state and returns early (the form is considered "incomplete" by React state even though DOM is filled).

## New Diagnostic: No React Fibers on Any Elements

If `Object.getOwnPropertyNames(input)` shows NO keys starting with `__reactFiber$`, `__reactProps$`, or `__reactState$`, the element is NOT a React-controlled component. This has been observed on the current Salestrekker Add deal form build:

- Title input: `allReactKeys: []` (NO React props)
- Value input: `allReactKeys: []` (NO React props)
- Save button: `allReactKeys: []` (NO React props)
- `b.onclick === null` (technically `typeof null === 'object'`)

**Diagnosis:** The form state is managed by a PARENT React component (not the individual inputs). The parent reads DOM values via a ref or custom hook (mutation observer, direct DOM read in render cycle). Programmatic input updates the DOM but the parent's React state never re-reads it. The parent's validation state keeps the Save button disabled.

**No known programmatic fix for this architecture.** Options:
1. **pyautogui OS-level events** on the Save button after making it enabled — creates trusted events through macOS
2. **Direct API POST** — capture the GraphQL mutation and POST it with the session token
3. **Navigate to the home-loan editor** for an existing deal — the editor view uses different (older?) React components that respond to `page.evaluate` prototype setter

`Object.getOwnPropertyNames()` and `Object.keys()` on DOM elements return DIFFERENT results depending on the execution context:

| Context | Shows React fibers? | Use when |
|---------|-------------------|----------|
| `page.evaluate()` | **NO** — React strips fiber props in serialization | Normal DOM reads, text extraction |
| CDP `Runtime.evaluate` with `returnByValue: True` | **YES** — raw JS object, not serialized through structured clone | React prop introspection, fiber access |

**Always use CDP `Runtime.evaluate` for React prop/fiber inspection.**

```python
# From Patchright:
cdp = page.context.new_cdp_session(page)
result = cdp.send('Runtime.evaluate', {
    'expression': 'JS_CODE_HERE',
    'returnByValue': True
})
value = result.get('result', {}).get('result', {}).get('value', None)
```

## React Prop Access Pattern

Once you confirm the button has `__reactProps$`:

```javascript
(function() {
    var btns = document.querySelectorAll('button');
    for(var b of btns) {
        if(b.textContent.includes('Save')) {
            var keys = Object.getOwnPropertyNames(b);
            var propsKey = keys.find(k => k.startsWith('__reactProps'));
            if(propsKey) {
                var props = b[propsKey];
                if(typeof props.onClick === 'function') {
                    props.onClick();  // Call the React onClick handler directly
                }
            }
        }
    }
})()
```

Note: Calling `props.onClick()` directly bypasses React's event system. It may run the handler but the synthetic event object (`e`) will be undefined. Some handlers check for `e.preventDefault()` and may throw. Test with a try/catch.

**Important: Salestrekker asset form — props.onClick() runs but data does NOT persist.** Calling `props.onClick()` on the Save button in the asset form DOES execute the handler (returns "anonymous") but the form data is NOT saved. The handler validates and navigates but the form state (stored outside React's component state — inputs have no `__reactFiber$` and no `_valueTracker`) is disconnected from the DOM values. Setting `input.value` via prototype setter + dispatchEvent fills the DOM visually but the Save handler reads from internal state (React fiber memoizedState or a ref-based store), not the DOM. This is a confirmed architectural limitation of current automation approaches for this specific form.

## addEventListener vs onclick

If `b.onclick === null` (and `typeof b.onclick === 'object'` because `typeof null === 'object'`):

```javascript
// .click() via evaluate does NOT trigger addEventListener handlers
// Use dispatchEvent instead:
b.dispatchEvent(new Event('click', {bubbles: true, cancelable: true}));
```

## pyautogui OS-Level Clicks — Last Resort for React Save Buttons

When ALL programmatic approaches fail (CDP mouse, JS click, React props.onClick, keyboard events) and no API call is made:

**The React button's onClick handler checks internal form state and returns early.** Even removing `disabled` and clicking produces zero network requests (confirmed via CDP `Network.requestWillBeSent`).

**Fix: pyautogui OS-level click**

Real CGEvent mouse clicks go through macOS's window server into Chrome's native event handling, which React's event delegation captures as a legitimate user interaction. The button fires its onClick handler normally, including proper synthetic event objects.

```python
import pyautogui

# Get button viewport position
coords = page.evaluate("""()=>{
    for(var b of document.querySelectorAll('button')){
        if(b.textContent.trim()==='Save'){
            var r = b.getBoundingClientRect();
            return {x: Math.round(r.x+r.width/2), y: Math.round(r.y+r.height/2)};
        }
    }
    return null;
}""")

# Get CfT window position
pos = subprocess.run(
    ['osascript','-e','tell app "System Events" to get position of window 1 of process "Google Chrome for Testing"'],
    capture_output=True, text=True, timeout=5
)
wx, wy = map(int, pos.stdout.strip().split(', '))

# Click
pyautogui.click(wx + coords['x'], wy + coords['y'])
```

## Agent-S3 (Tier 5) — Vision-Guided Alternative

When all programmatic approaches fail, Agent-S3 uses:
1. **pyautogui** — real OS-level CGEvent keystrokes (React CANNOT ignore)
2. **Vision grounding** — Ollama qwen3-vl detects UI elements from screenshots
3. **OpenRouter main model** — free Nemotron for reasoning

```bash
# Install: pip install gui-agents
# Requires: ollama running with qwen3-vl:4b, OpenRouter key

python3 -m gui_agents.s3.cli_app \
  --provider open_router \
  --model "nvidia/nemotron-3-ultra-550b-a55b:free" \
  --model_url "https://openrouter.ai/api/v1" \
  --model_api_key "$(bws secret list | python3 -c 'import sys,json; [print(i.get(\"value\",\"\")) for i in json.load(sys.stdin) if i.get(\"key\")==\"OPENROUTER_API_KEY\"]')" \
  --ground_provider openai \
  --ground_url "http://localhost:11434/v1" \
  --ground_model "qwen3-vl:4b" \
  --grounding_width 1512 \
  --grounding_height 982
```

### OpenRouter Key Access

The key is in Bitwarden Secrets Manager, accessible via `bws` CLI:

```bash
bws secret list | python3 -c '
import sys, json
for i in json.load(sys.stdin):
    if i.get("key") == "OPENROUTER_API_KEY":
        print(i.get("value", ""))
'
```

## References

- `FRS-005-state-engine-mcp-v1.md` in EdgeGDE docs directory — Long-term architecture for solving form persistence issues
- `salestrekker-react-automation` skill — Permanent automation patterns for Salestrekker (manually authored, read-only from curator)
- `salestrekker-data-entry/references/salestrekker-add-deal-form-20260728.md` — Full forensic analysis of Salestrekker's Add deal form architecture, including the finding that NO elements have React fibers in the current build
