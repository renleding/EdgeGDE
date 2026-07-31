---
name: salestrekker-react-automation
description: >
  Permanent automation stack for Salestrekker React 18 SPA on macOS.
  Chrome for Testing + CDP + Playwright connect_over_cdp.
  Covers Popover click bypass, React Save bypass, inline contact forms.
tags: [salestrekker, automation, cdp, chrome-for-testing, playwright, process, workflow, browser-automation, react-spa]
related_skills:
  - agent-process-automation
---

# Salestrekker Automation — Permanent Stack (v3, 27 Jul 2026)

## Architecture
**Discover with Vision, Execute with CDP.**

1. **Vision phase** (dev only): Use CUA/screenshots to observe the UI — find element selectors, understand React component structure, identify click targets
2. **CDP phase** (runtime): Write a deterministic Playwright script — no LLM, no screenshots, zero recurring cost

```python
Chrome for Testing (always running, CDP port 9222)
    │
    ▼
Patchright connect_over_cdp('http://localhost:9222')
    │
    ▼
locator.type() / locator.click() → React-triggering events
page.evaluate() → native setter for currency fields
CDP Input.dispatchMouseEvent → Radix popup triggers
keyboard events (ArrowDown+Enter) → Radix combobox selection
New Event('pointerdown', {bubbles:true}) → Radix button handlers
```

## Chrome for Testing Setup
macOS Chrome 150+ hardened runtime blocks `--remote-debugging-port`.
CfT auto-starts on login via launchd agent. Port 9222 always available.

```python
from patchright.sync_api import sync_playwright
pw = sync_playwright().start()
browser = pw.chromium.connect_over_cdp('http://localhost:9222')
page = browser.contexts[0].pages[0]
```

## CRITICAL RULES (DO NOT VIOLATE)

### Login Lockout Avoidance
- **Max 2 login attempts per session.** Hard stop at 2.
- Salestrekker rate limit escalates: 15s → 45s → 20min+.
- Use `locator.type()` for credentials + `locator.click()` for Sign in (triggers React validation)
- TOTP: `page.keyboard.type(code, delay=40)` on focused input, then Enter

### SPA Navigation — NEVER page.goto()
- `page.goto()` to authenticated SPA URLs **triggers sign-out**
- Use: `page.evaluate("window.location.href = '/deals/view/...'")` 
- Only `/auth/sign-in` is safe for `page.goto()`

## Deal Creation Flow (PROVEN)

### 1. Title
```python
page.locator('input[name="name"]').first.type('Deal Name', delay=2)
```

### 2. Value (CRITICAL: use evaluate setter, NOT .type())
```python
page.evaluate("""()=>{
    var i=document.querySelector('input[name="value.total"]');
    if(i){
        var s=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;
        s.call(i,'800000');
        i.dispatchEvent(new Event('input',{bubbles:true}));
        i.dispatchEvent(new Event('change',{bubbles:true}));
    }
}""")
```
`.type()` produces "$8,000,000" instead of "$800,000" due to currency formatting.

### 3. Lead Source
```python
# Click the combobox via label sibling traversal
page.evaluate("""()=>{var spans=document.querySelectorAll('span,div,label');
for(var s of spans){if(s.textContent.trim()==='Lead source'){
var sibling=s.parentElement.nextElementSibling;
if(sibling){var combo=sibling.querySelector('[role="combobox"]')||sibling;
if(combo.getAttribute('role')==='combobox'){combo.click();return}}}}return false}""")
time.sleep(2)
# Select option
page.evaluate("""()=>{var opts=document.querySelectorAll('[role="option"]');
for(var o of opts){if(o.textContent.trim()==='Existing client'&&o.offsetParent){o.click();return}}}""")
```

### 4. Add Contact (Radix Popup)
Use CDP Input.dispatchMouseEvent for opening the menu and selecting menu items:
```python
cdp = page.context.new_cdp_session(page)
box = page.evaluate("""()=>{for(var b of document.querySelectorAll('button')){
if(b.textContent.trim()==='Add contact'&&b.offsetParent){
var el=b.parentElement;while(el){
if(el.getAttribute('aria-haspopup')==='menu'){
var r=el.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}}
el=el.parentElement}}}return null}""")
cdp.send('Input.dispatchMouseEvent', {'type':'mousePressed','x':box['x'],'y':box['y'],'button':'left','clickCount':1})
cdp.send('Input.dispatchMouseEvent', {'type':'mouseReleased','x':box['x'],'y':box['y'],'button':'left','clickCount':1})
time.sleep(2)

# Click "Add existing person" menu item
items = page.evaluate("""()=>{return Array.from(document.querySelectorAll('[role="menuitem"]'))
.filter(i=>i.offsetParent).map(i=>({t:i.textContent.trim().substring(0,30),
x:i.getBoundingClientRect().x+i.getBoundingClientRect().width/2,
y:i.getBoundingClientRect().y+i.getBoundingClientRect().height/2}))}""")
for item in items:
    if 'Add existing person' in item['t']:
        cdp.send('Input.dispatchMouseEvent', {'type':'mousePressed','x':item['x'],'y':item['y'],'button':'left','clickCount':1})
        cdp.send('Input.dispatchMouseEvent', {'type':'mouseReleased','x':item['x'],'y':item['y'],'button':'left','clickCount':1})
        time.sleep(2)
        break
```

### 5. Select Existing Contact (Keyboard-Driven Radix)
```python
search = page.locator('input[name="query"]').last
search.focus()
search.type('Sam Smith', delay=5)
time.sleep(3)
page.keyboard.press('ArrowDown')
time.sleep(0.5)
page.keyboard.press('ArrowDown')
time.sleep(0.3)
page.keyboard.press('Enter')
time.sleep(2)
```

### 6. Click "Add" in Dialog (evaluate click works here)
```python
page.evaluate("""()=>{for(var b of document.querySelectorAll('button')){
if(b.textContent.trim()==='Add'&&!b.disabled){b.click();return}}}""")
time.sleep(3)
```

### 7. Save
```python
page.evaluate("""()=>{for(var b of document.querySelectorAll('button')){
if(b.textContent.trim()==='Save'&&!b.disabled&&b.offsetParent){b.click();return}}}""")
time.sleep(6)
```

## Radix UI Interaction (CRITICAL DISCOVERY)

### How Radix Responds to Events
Radix UI Primitives listen for these events specifically:

| Event | Radix Menu/Popover | Radix Button/Trigger | Radix Combobox |
|-------|-------------------|---------------------|-----------------|
| `click` (evaluate) | ❌ | ❌ | ❌ |
| `mousedown` (CDP) | ✅ Menu opens | ❌ | ❌ |
| `mouseup` (CDP) | ✅ Menu opens | ❌ | ❌ |
| `pointerdown` | ✅ | ✅ **Button handler fires** | ✅ |
| `keyboard ArrowDown` | ❌ | ❌ | ✅ Highlights item |
| `keyboard Enter` | ❌ | ✅ On focused element | ✅ Selects item |
| CDP `dispatchMouseEvent` | ✅ Popup opens | ❌ Button handler doesn't fire | ❌ |
| `element.click()` via evaluate | ❌ | ❌ | ❌ |

**Key insight:** CDP mouse events open menus but don't trigger button handlers.
Only `pointerdown` event with `{bubbles: true}` triggers Radix button onClick.
Only keyboard ArrowDown+Enter triggers Radix combobox selection.

### Using pointerdown for Radix buttons
```javascript
// Dispatch pointerdown (this is what Radix primitives listen for)
button.dispatchEvent(new Event('pointerdown', {bubbles: true, cancelable: true}));
```

## ⚠️ KNOWN LIMITATION: Asset/Expense Data Entry

The asset, liability, income, and expense section forms in Salestrekker 2.0 use **React controlled components** that are resistant to all programmatic input. The Save handler reads from React state (which CDP can't modify), not the DOM (which CDP sets).

**Tried and failed:**
- `page.evaluate()` native setter with dispatchEvent
- `locator.type()` — fills DOM but not React state
- `keyboard.type()` — fills DOM but not React state  
- `locator.fill()` — same
- CDP `Input.dispatchKeyEvent` — same
- Vehicle type combobox selection — filled but Save ignored
- `pointerdown` on Save button — Save handler ran but data was empty
- All 4 tiers (CDP, Chrome MCP, browser-act, CUA)

**Hypothesis:** The asset form uses a custom React form library (likely Formik or React Hook Form) with uncontrolled input wrappers that capture values via synthetic events not dispatched by CDP. Only genuine user keyboard events (hardware keystrokes) would register.

**Workaround:** CUA (Tier 4) real OS keystrokes, or API-based data entry if endpoints become available.

## TOTP Entry
```python
code = pyotp.TOTP(os.environ["SALESTREKKER_TOTP_SECRET"]).now()
page.locator('input').first.focus()
page.keyboard.type(code, delay=40)
time.sleep(0.3)
page.keyboard.press('Enter')
time.sleep(6)
```

## Browser-act (Tier 2) Notes
- Sends real browser events — correct value formatting ($800K vs $8M)
- Session times out quickly — use for field-level interactions only
- Radix popup still doesn't respond to browser-act clicks
