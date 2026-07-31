# Add Deal Form — React Architecture Analysis

Found 28 Jul 2026 during Test 11-14 automation attempts.

## Executive Summary

The Salestrekker Add deal form CANNOT be submitted programmatically through any CDP/JS/React props approach. The form uses a parent React component that manages form state independently from DOM values. The Save button's `disabled` state is bound to this parent state, which never updates from programmatic DOM changes. Only OS-level pyautogui clicks on the Save button work.

## Evidence

### 1. Title input has NO React markers

```javascript
// Results from CDP Runtime.evaluate:
{
  "allReactKeys": [],       // No __reactFiber$, __reactProps$, __reactState$
  "hasFiber": false,
  "hasProps": false,
  "hasState": false,
  "onChangeType": "none",   // No onChange handler
  "onBlurType": "none"      // No onBlur handler
}
```

### 2. No `<form>` element exists

`document.querySelectorAll('form').length` → `0`. Cannot use `form.submit()` or `form.requestSubmit()`.

### 3. Save button events all fired with no effect

The following events were dispatched on the Title input with no effect on Save button's disabled state:
- `input` (bubbles, cancelable)
- `change` (bubbles, cancelable)
- `blur` (bubbles, cancelable)
- `focusout` (bubbles, cancelable)
- `keydown` (bubbles, cancelable)
- `keyup` (bubbles, cancelable)
- `beforeinput` (via InputEvent with `inputType: 'insertText'`)

### 4. Zero API calls after Save click

Even after removing `disabled` attribute and clicking Save, zero network requests were captured by:
- `window.fetch` interceptor (injected after SPA load)
- `XMLHttpRequest.prototype.send` interceptor
- CDP `Network.requestWillBeSent` event

The onClick handler returns early without making any fetch/XHR call.

### 5. Save button has React props but no onClick

```javascript
Save button properties:
{
  hasReactFiber: true,
  hasReactProps: true,
  onClickType: "object",   // not "function"!
  onclick: null            // addEventListener, not onclick attribute
}
```

The `onClick` in `__reactProps$` is an object (likely a handler wrapper), not a function. This differs from the asset form where `onClick` IS a function.

## Working Approaches

### Keyboard events for Title/Value (work)

```python
page.evaluate("document.querySelector('input[name=\"name\"]').focus()")
time.sleep(0.3)
page.keyboard.type('My Title', delay=3)  # NOT locator.type() - that hangs 30s

page.evaluate("document.querySelector('input[name=\"value.total\"]').focus()")
time.sleep(0.3)
page.keyboard.type('800000', delay=3)
```

`page.keyboard.type()` sends real keyboard events. The CfT `locator.type()` has a bug that hangs for 30s.

### Lead source keyboard (works)

```python
page.evaluate("document.querySelector('[name=\"leadSource\"]').click()")
time.sleep(1.5)
page.keyboard.press('ArrowDown')  # Selects first option
time.sleep(0.3)
page.keyboard.press('Enter')       # Confirms selection
time.sleep(1.5)
```

`keyboard.type('Existing client', delay=10)` does NOT work. The Radix combobox doesn't accept keyboard search text. ArrowDown+Enter does work.

### pyautogui OS click for Save (last resort, works in principle)

```python
# 1. Get button viewport position
coords = page.evaluate("""()=>{
    for(var b of document.querySelectorAll('button')){
        if(b.textContent.trim()==='Save'){
            var r = b.getBoundingClientRect();
            return {x: Math.round(r.x+r.width/2), y: Math.round(r.y+r.height/2)};
        }
    }
    return null;
}""")

# 2. Get CfT window position
import subprocess
pos = subprocess.run(
    ['osascript', '-e', 'tell app "System Events" to get position of window 1 of process "Google Chrome for Testing"'],
    capture_output=True, text=True, timeout=5
)
wx, wy = map(int, pos.stdout.strip().split(', '))

# 3. Remove disabled and OS-click
page.evaluate("""()=>{for(var b of document.querySelectorAll('button')){
    if(b.textContent.trim()==='Save'){b.removeAttribute('disabled');return}
}}""")
import pyautogui
pyautogui.click(wx + coords['x'], wy + coords['y'])
```

## CfT Session Expiry Issue

Repeated SPA navigation via `window.location.href` to authenticated routes triggers sign-out. The sign-out page shows "See you again soon" with "Back to Sign in" link. This causes ALL automation scripts to fail because elements don't exist.

**Detection:** Check for `'/auth/sign-out'` in URL or "See you again soon" in `document.body.innerText`.

**Fix:** Navigate to `/auth/sign-in` and re-authenticate. The CfT profile auto-fills credentials.

## Script: test_os_click.py

Location: `apps/state-engine/test_os_click.py`

Implements the complete flow: navigate to board → click Add new → fill Title/Value/Lead source/Contact → pyautogui click Save.
