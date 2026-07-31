---
name: salestrekker-react-form-entry
description: >-
  Reliable form entry on Salestrekker React 18 SPA using Patchright CDP.
  Covers keyboard events for React inputs, CDP mouse for Radix popovers,
  b.click() for Save with async board polling verification.
  HARD RULE: never embed login code in scripts. GOGO mode: execute
  across all tiers without asking. Correction (29 Jul 2026): Save DOES
  work — verification timing was the bug.
tags: [salestrekker, react, form-filling, cdp, patchright, radix, automation]
related_skills:
  - salestrekker-react-automation
  - salestrekker-spa-patterns
  - salestrekker-hybrid-login
  - salestrekker-login-and-navigation
  - react-spa-automation-hybrid
---

# Salestrekker React Form Entry — Proven Patterns

## ⚠️ HARD RULE: Never Login from Scripts (LOCKED 29 Jul 2026)

**ABSOLUTELY NO login code in scripts.** Every script must check session and fail fast:
```python
if '/auth/sign-in' in page.url.lower():
    print("Session expired — login manually in CfT browser")
    pw.stop()
    exit(1)
```

This session locked the account with 5+ automated logins. Max 2 total. Scripts that attempt login are bugs.

## Save & Verify Async Pattern (29 Jul 2026 — Corrected Understanding)

**The Save button works with `b.click()`.** This was the single most expensive finding of the investigation — 10+ hours of false theories because verification checked the wrong signal.

### What Works

```python
# 1. Fill fields (keyboard events, focus + type)
page.evaluate("()=>document.querySelector('input[name=\"name\"]').focus()")
time.sleep(0.3); page.keyboard.type('Deal Title', delay=2)

# 2. Verify button is enabled (NOT disabled)
save = page.evaluate("""()=>{
    for(var b of document.querySelectorAll('button')){
        if(b.textContent.trim()==='Save') return {disabled:b.disabled};
    }
    return null;
}""")

# 3. b.click()
page.evaluate("""()=>{
    for(var b of document.querySelectorAll('button')){
        if(b.textContent.trim()==='Save'&&!b.disabled&&b.offsetParent){
            b.removeAttribute('disabled'); b.click(); return;
        }
    }
}""")

# 4. Poll board for deal title — URL NEVER changes
for i in range(300):
    time.sleep(1)
    if i % 30 == 0:
        page.evaluate("window.location.href = '/deals/board/{BOARD_ID}'")
        time.sleep(2)
        if 'Deal Title' in page.evaluate("()=>document.body.innerText"):
            break
```

### Key Facts That Contradict Earlier Theories

- **URL never changes** — SPA stays on `/deals/add/...` after clicking Save
- **No `__reactProps$` on the button** — it's plain DOM, but b.click() works
- **HandleEvent pattern does NOT block** — click dispatches normally
- **Deal appears on board in 3s to 5min** — async server processing
- **No interceptor, React hack, OS event, or CDP magic needed**
- **All prior "closure state unreachable" diagnosis was WRONG** — root cause was verification checking URL change

### Evidence

6 deals created in a single session with this approach. See `references/async-save-verification-20260729.md`.

## Core Principle: Real Events, Not Synthetic

React SPAs ignore synthetic events (CDP evaluate `.click()`, native setter `.value=`).
Always prefer browser-level events that trigger React's onChange/onClick:

| Intent | Tool | Why |
|--------|------|-----|
| Fill text input | `page.locator().type()` (keyboard events) | Sends real keystroke events, triggers React onChange |
| Click button | `page.locator().click()` (CDP Input.dispatchMouseEvent) | Sends real mouse events, triggers React onClick |
| Open Radix popover | CDP `Input.dispatchMouseEvent` on `div[aria-haspopup]` | JS evaluate `.click()` is silently swallowed by Radix |
| Select dropdown option | `page.keyboard.type()` + `keyboard.press('Enter')` | React comboboxes ignore programmatic value setting |
| Enter TOTP | `page.keyboard.type(code, delay=60)` | Per-digit inputs need real keystroke events |
| Submit form | `page.locator('button[type="submit"]').click()` | `form.requestSubmit()` may be ignored |

## No `<form>` Element (Add Deal Page)

`document.querySelectorAll('form').length === 0` on the Add deal page. There is NO wrapping `<form>` tag. This means:

- `form.requestSubmit()` is impossible
- `form.dispatchEvent(new Event('submit'))` is impossible
- The only way to submit is through the Save button's React onClick handler

This applies to the Add deal form specifically. Some section editors (Assets, etc.) also lack `<form>` elements, but some may have them. Always check `document.querySelector('form')` before attempting form-level submission.

## `locator.type()` Hangs on CfT

On CfT (Chrome for Testing), `page.locator('input[name="name"]').first.type('text', delay=2)` **hangs for 30s then times out**. This is a CfT + Patchright compatibility issue affecting certain React-controlled inputs.

**Fix:** Use evaluate prototype setter instead:
```python
page.evaluate("""()=>{
    var i=document.querySelector('input[name="name"]');
    if(i){
        var s=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;
        if(s){s.call(i,'Deal Title');i.value='Deal Title';i.dispatchEvent(new Event('input',{bubbles:true}));i.dispatchEvent(new Event('change',{bubbles:true}));}
    }
}""")
```

**Exception:** The Contact search field (`input[name="query"]`) DOES work with `locator.type()`. Only the main form fields (Title, Value) hang.

## Lead Source Selection — Pointerdown Prevents SPA Nav

Selecting a Lead source option via `element.click()` or keyboard can trigger SPA navigation back to the board, losing all form data. Use `pointerdown` event on the option before clicking:

```python
page.evaluate("""()=>{
    for(var s of document.querySelectorAll('span,div,label')){
        if(s.textContent.trim()==='Lead source'){
            var sibling=s.parentElement.nextElementSibling;
            if(sibling){var combo=sibling.querySelector('[role=combobox]');if(combo){combo.click();return}}
        }
    }
}""")
time.sleep(2)
page.evaluate("""()=>{
    var opts=document.querySelectorAll('[role=option]');
    for(var o of opts){
        if(o.textContent.trim()==='Existing client'&&o.offsetParent){
            o.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true}));
            o.click();
            return;
        }
    }
}""")
```

This fires the Radix `onValueChange` without the event bubbling up to trigger SPA-level navigation.

## Login: Title-Based State Detection

The SPA URL does NOT reliably reflect auth state. After successful sign-in,
the URL stays on `/auth/sign-in` while the **page title** changes.

```python
def check_page_state(page) -> str:
    """Returns 'signin', 'totp', 'dashboard', or 'unknown'."""
    title = page.title().lower()
    url = page.url.lower()
    if 'dashboard' in title or 'deals' in title or 'board' in title:
        return 'dashboard'
    if 'two-factor' in title or 'totp' in title or '2f authentication' in title:
        return 'totp'
    if 'sign-in' in url or 'sign in' in title:
        return 'signin'
    if '/deals/view' in url or '/deals/home-loan' in url:
        return 'dashboard'
    return 'unknown'
```

### Credential auto-fill check
CfT's Chrome profile (`8um7547w`) auto-fills credentials. Check before filling:

```python
email_filled = page.evaluate("""() => {
    var e = document.querySelector('input[type="email"]');
    return e ? e.value : '';
}""")
if not email_filled:

## CfT Startup & Connection

```bash
# Start CfT with the correct profile and --disable-extensions flag
# The --disable-extensions flag prevents Google extension service workers
# from crashing patchright.connect_over_cdp
"/Users/warren/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing" --remote-debugging-port=9222 --user-data-dir="/Users/warren/.hermes/chrome/cft-profile-8um7547w" --no-first-run --disable-default-apps --disable-sync --disable-extensions
```

**Connection fix** (handle fresh CfT with no pages):
```python
pw = sync_playwright().start()
b = pw.chromium.connect_over_cdp('http://localhost:9222')
if len(b.contexts) > 0 and len(b.contexts[0].pages) > 0:
    p = b.contexts[0].pages[0]
else:
    p = b.new_page()
```

## Workflow: GOGO Mode — Stop Asking, Just Execute

When the user says "gogo", escalate through all remaining tiers without pause:
- Do NOT ask "what should I try next" — try the next approach
- Do NOT report a summary of failures as a blocker — report a summary only after ALL approaches across ALL tiers have been exhausted
- The user does not want to be consulted on minor decisions or approach changes
- A failed approach should be followed immediately by a different approach
- Only stop and ask when truly blocked at the LAST remaining approach with NO alternatives left

## Self-Audit Discipline (Before Any Action)

Before running any automation script on Salestrekker:

1. **Forage session history FIRST** (`session_search("query")`) — check if this exact problem was solved in a prior session. See `references/session-foraging-pattern-20260729.md`.
2. **Check memory** — review key entries: deal IDs, contact IDs, login attempt count, known field selectors
3. **Check skill files** — load the relevant skills via `skill_view(name)` to see current patterns and pitfalls
4. **Check logs** — review previous session logs for failed patterns and recently learned lessons
5. **Check CfT state** — verify authenticated session exists (page title contains "Dashboard", "Home loans", or "Deals")
6. **Verify deal/contact IDs** — ensure you're acting on the correct deal, not a stale one from a previous run
7. **Confirm the UI hasn't changed** — contacts already exist? Use "Add existing person" not "Add new person". Sections already filled? Skip them.

The most common failure pattern: running an old script against a deal with a different state (contacts already exist, sections already filled). Always assess the CURRENT state of the target deal before executing.

## Batch Save Pattern

Fill ALL fields on a section page first, then click Save/Save and calculate ONCE. Do NOT save after each individual field entry:

```python
# CORRECT: fill all fields, then save once
for field in fields:
    page.locator(field['selector']).type(field['value'], delay=2)
time.sleep(0.3)
page.evaluate("""() => {
    for(var b of document.querySelectorAll('button')) {
        if((b.textContent.trim().includes('Save') || b.textContent.trim().includes('Save and calculate'))
           && !b.disabled && b.offsetParent) { b.click(); return; }
    }
}""")
time.sleep(4)

# WRONG: save after each field
for field in fields:
    page.locator(field['selector']).type(field['value'])
    page.locator('button:has-text("Save")').click()  # Too many saves, slow
## Add Existing Person Pattern

Sam Smith, Amy Smith and all previous test contacts already exist in Salestrekker.
Use "Add existing person" — never "Add new person":

```python
# After Radix popup opens via CDP mouse event:
page.evaluate("""() => {
    for(var i of document.querySelectorAll('[role="menuitem"]')) {
        if(i.textContent.trim() === 'Add existing person' && i.offsetParent) {
            i.click(); return;
        }
    }
}""")
time.sleep(2)

# Search (find the EMPTY query field — first one is Owner)
for i in range(page.locator('input[name="query"]').count()):
    if not page.locator('input[name="query"]').nth(i).input_value():
        page.locator('input[name="query"]').nth(i).type('Sam Smith', delay=3)
        break
time.sleep(3)

# Select result
page.evaluate("""() => {
    for(var o of document.querySelectorAll('[role="option"]')) {
        if(o.textContent.includes('Sam') && o.textContent.includes('sam@fakeemail.com')) { o.click(); return; }
    }
}""")
time.sleep(1)

# Click Add — use evaluate click, NOT locator.click()
# WHY: The search result's email input (<input name="value" type="email">)
# sits in the DOM above the Add button and intercepts pointer events.
# locator.click() sees this overlay and timeouts after 30s retries.
# page.evaluate click bypasses the hit-test check.
page.evaluate("""() => {
    var dialog = document.querySelector('[role="dialog"]');
    var btns = dialog ? dialog.querySelectorAll('button') : document.querySelectorAll('button');
    for(var b of btns) {
        if(b.textContent.trim() === 'Add' && !b.disabled && b.offsetParent) { b.click(); return; }
    }
}""")
time.sleep(3)
```

### CUA Fallback for Add Existing Person

If both CDP methods fail (rare — happens when Radix intercepts all JS events), use CUA:

```python
# T4 CUA: Click Add contact button (element index from capture)
computer_use(action='click', element=72, pid=640, window_id=717)

# Click Add existing person menu item (element 17)
computer_use(action='click', element=17, pid=640, window_id=717)

# T0 CDP: Type search term
page.locator('input[name="query"]').last.type('Sam Smith', delay=3)

# T4 CUA: Click search result, then Add
computer_use(action='click', element=151, pid=640, window_id=717)
computer_use(action='click', element=146, pid=640, window_id=717)
```

## Dialog Detection — Check offsetParent, Not DOM Presence

`document.querySelector('[role="dialog"]') !== null` returns `True` even when the dialog is visually hidden (Radix keeps the DOM element but hides it via CSS/visibility). This caused false "dialog still open" detections — the script thought the dialog was blocking when it had actually been dismissed.

**Fix:** Check `offsetParent` instead:
```python
dialog_visible = page.evaluate("""() => {
    var d = document.querySelector('[role="dialog"]');
    return d ? d.offsetParent !== null : false;
}""")
```

## Radix Button Click — pointerdown Event Required

Radix UI Primitives listen for `pointerdown` events — NOT `click`, `mousedown`, or `mouseup`. All of the following FAIL on Radix buttons:

- `element.click()` — dispatches `click`, Radix ignores
- `dispatchEvent(new MouseEvent('click'))` — Radix ignores
- CDP `Input.dispatchMouseEvent({type: 'mousePressed'})` — sends `mousedown`, Radix ignores
- `document.createEvent('MouseEvents').initEvent('click')` — Radix ignores

**Fix:** Dispatch a `pointerdown` event with `{bubbles: true}`:
```python
page.evaluate("""() => {
    for(var b of document.querySelectorAll('button')) {
        if(b.textContent.trim() === 'Add' && !b.disabled && b.offsetParent) {
            b.dispatchEvent(new Event('pointerdown', {bubbles: true, cancelable: true}));
            return;
        }
    }
}""")
time.sleep(2)
```

**Note:** The Radix button must be visible AND enabled (`!b.disabled`). Use keyboard `ArrowDown`+`Enter` on the combobox/option first to enable the "Add" button, THEN dispatch `pointerdown`.

**Found via:** Stack Overflow — "How to click Radix UI React dropdown menu using Selenium IDE" (pointerdown with bubbles:true)

## Value Field Formatting — Use evaluate Prototype Setter

The Value field (`input[name="value.total"]`) uses React currency formatting. Using `page.locator().type('800000')` can produce `$8,000,000` instead of `$800,000` because each keystroke triggers the formatter differently.

**Fix:** Use the evaluate prototype setter with input/change events:
```python
page.evaluate("""() => {
    var i = document.querySelector('input[name="value.total"]');
    if(i) {
        var s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        s.call(i, '800000');
        i.dispatchEvent(new Event('input', {bubbles: true}));
        i.dispatchEvent(new Event('change', {bubbles: true}));
    }
}""")
```

**Always verify:** Check the displayed value after setting — `$ 800,000` (correct) vs `$ 8,000,000` (wrong).

## Lead Source Selection — Use evaluate, Not keyboard

The Lead source combobox is often confused with the Deal type combobox (first `[role="combobox"]` on the page). `page.keyboard.type('Existing client')` + `Enter` frequently fails because the keyboard events go to the wrong combobox.

**Fix:** Find the "Lead source" label, get its sibling combobox, click it, then click the option:
```python
# Find and click the Lead source combobox
page.evaluate("""() => {
    var spans = document.querySelectorAll('span, div, label');
    for(var s of spans) {
        if(s.textContent.trim() === 'Lead source') {
            var sibling = s.parentElement.nextElementSibling;
            if(sibling) {
                var combo = sibling.querySelector('[role="combobox"]') || sibling;
                if(combo.getAttribute('role') === 'combobox') { combo.click(); return; }
            }
        }
    }
}""")
time.sleep(2)

# Click "Existing client" option
page.evaluate("""() => {
    var opts = document.querySelectorAll('[role="option"]');
    for(var o of opts) {
        if(o.textContent.trim() === 'Existing client' && o.offsetParent) {
            o.click(); return;
        }
    }
}""")
```

## Key Field Name Mappings

| Label | Selector | Notes |
|-------|----------|-------|
| Title | `input[name="name"]` | Required field on Add Deal form |
| Value | `input[name="value.total"]` | Currency field, NOT aria-label="Value" |
| Lead source | `[role="combobox"]` first one | Opens option list; select by text |
| Owner | `input[name="query"]` first | Auto-filled to "Warren Ledingham" |
| Search contacts | `input[name="query"]` second (empty) | Only appears in Add Existing dialog |
| First name | `input[name="firstName"]` | New contact form |
| Last name | `input[name="lastName"]` | New contact form |
| Phone | `input[name="value"]` nth(0) | New contact form |
| Email | `input[type="email"]` nth(0) | New contact form |
| Save | `button:has-text("Save")` | Disabled until all required fields set |

## CDP Runtime.evaluate vs page.evaluate — Critical Distinction

React internals (`__reactFiber$`, `__reactProps$`) are NOT visible via `page.evaluate()` or `Object.keys()` in the Playwright/CDP context. They ARE visible via CDP `Runtime.evaluate`:

```python
# ❌ Returns empty array — React keys stripped during serialization
page.evaluate("Object.keys(btn)")  # → []

# ✅ Returns the actual keys — React fibers and props visible
cdp.send('Runtime.evaluate', {
    'expression': 'Object.keys(btn)',
    'returnByValue': True
})  # → ['__reactFiber$vh8jbm6pwh', '__reactProps$vh8jbm6pwh']
```

Use this to access the Save button's React onClick handler directly:

```python
result = cdp.send('Runtime.evaluate', {
    'expression': """
    (function() {
        var btns = document.querySelectorAll('button');
        for(var b of btns) {
            if(b.textContent.includes('Save') && !b.disabled) {
                var keys = Object.getOwnPropertyNames(b);
                var propsKey = keys.find(k => k.startsWith('__reactProps'));
                if(propsKey) {
                    var props = b[propsKey];
                    if(typeof props.onClick === 'function') {
                        props.onClick();
                        return 'CALLED';
                    }
                }
            }
        }
        return 'NOT_FOUND';
    })()
    """,
    'returnByValue': True
})
```

See `references/async-save-verification-20260729.md`.

## Tier 5 — Agent-S3 for Real OS-Level Events

Agent-S3 (Simular AI, `gui-agents` package) uses `pyautogui` to send real CGEvent keystrokes — genuine hardware events that React's SyntheticEvent system CANNOT ignore.

**Install:** `pip install gui-agents && brew install tesseract`

**Configuration:**
- Main model: `nvidia/nemotron-3-ultra-550b-a55b:free` via OpenRouter (largest free, 1M context)
- Grounding model: `qwen3-vl:4b` via Ollama, or `bytedance/ui-tars-1.5-7b` via OpenRouter
- API keys: Get via `bws secret list` (Bitwarden Secrets Manager CLI at `~/.hermes/bin/bws`)

**Run:**
```bash
python3 -m gui_agents.s3.cli_app \
  --provider open_router \
  --model "nvidia/nemotron-3-ultra-550b-a55b:free" \
  --model_url "https://openrouter.ai/api/v1" \
  --model_api_key "$(bws secret list | python3 -c \"import sys,json;d=json.load(sys.stdin);[print(i['value']) for i in d if i['key']=='OPENROUTER_API_KEY']\")" \
  --ground_provider openai \
  --ground_url "http://localhost:11434/v1" \
  --ground_model "qwen3-vl:4b" \
  --ground_api_key "ollama" \
  --grounding_width 1512 \
  --grounding_height 982
```

**pyautogui standalone** (lighter than full Agent-S3):
```python
import pyautogui
pyautogui.click(x, y)                              # Click to focus field
pyautogui.typewrite('BMW 3 Series', interval=0.02) # Real CGEvent keystrokes
pyautogui.press('tab')                             # Tab to next field
```

## Pitfalls

### Save stays disabled despite all fields filled
Check for:
- Required field showing "This field is required" text
- Lead source still showing "Select one" — react dropdown selection may not have registered
- Value too large or malformed (currency formatting)

Fix: Use `page.keyboard.type()` for dropdown selection + Enter key,
not `page.evaluate().click()` on role="option" elements.

### Value field shows wrong formatted amount
The Value field (`input[name="value.total"]`) uses currency formatting.
Typing "800000" can display as "$8,000,000" instead of "$800,000" in the DOM.
This happens because the currency formatter interprets the input differently.
**Always verify the displayed value** before clicking Save:
```python
displayed = page.evaluate("""() => {
    var v = document.querySelector('input[name="value.total"]');
    return v ? v.value : '';
}""")
print(f"Value shows: {displayed}")
# Expected: "$ 800,000"  Not: "$ 8,000,000"
```
If wrong, clear the field (`Ctrl+A → Backspace`) and re-type with fewer digits.

### After login, stuck on sign-in page
The sign-in form uses `method="get"` with no visible POST request.
Clicking the Sign in button triggers an SPA-internal auth flow.
If the page stays on sign-in with no error, the credentials may be
wrong or the account is rate-limited. **Do NOT retry past max 2 attempts.**

### Data persists in DOM but not on server
CDP evaluate setter + dispatchEvent can make a field appear filled
visually while React silently discards the value. This is because
React's synthetic events check `event.isTrusted` — synthetic events
are isTrusted=false and may be ignored.
**Fix:** Use `page.locator().type()` (real keyboard events) instead of
native setter + dispatchEvent for ALL text inputs.

### SPA Navigation — Initialization Sequence Required

The SPA must be **initialized first** before `window.location.href` navigation works. If you navigate from `chrome://downloads/` or `about:blank`, the SPA router may not intercept the URL change correctly.

**⚠️ 30 Jul 2026 finding:** `window.location.href` works but **triggers sign-out after ~5-10 navigations**. The session token degrades gradually — pages return empty body text before final redirect to `/auth/sign-out`. For bulk multi-section work (10+ sections), prefer clicking the "Home loan" tab from the deal view page (1 navigation) then using sidebar section links (`a._U0` elements) for the rest. See `salestrekker-data-entry` reference `20260730-data-entry-session.md` for details.

**Fix:** Always start from a proper Salestrekker page:

```python
# 1. Load a Salestrekker page first (page.goto IS safe for unauthenticated routes)
page.goto('https://pc.v2.salestrekker.com/auth/sign-in', timeout=20000)
# ... authenticate ...

# 2. SPA navigation for authenticated routes — DO NOT use page.goto()
page.evaluate("window.location.href = '/deals/view/{deal_id}/{contact_id}'")
time.sleep(6)

# 3. Click the Home loan tab to expand section sidebar
page.evaluate("""() => {
    for(var t of document.querySelectorAll('[role=tab]')) {
        if(t.textContent.includes('Home loan')) { t.click(); return; }
    }
}""")
time.sleep(3)

# 4. Now navigate to specific section
page.evaluate("window.location.href = '{SECTION_URL}'")
time.sleep(5)
```

**Never** use `page.goto()` for authenticated SPA routes — it triggers sign-out. **Exception:** `page.goto()` DOES work for the specific board URL `https://pc.v2.salestrekker.com/deals/board/{BOARD_ID}` — the full URL with a valid board ID hydrates correctly even with a fresh CfT session. Use this for board navigation instead of SPA router calls.

### `locator.type()` Hangs on CfT for Title/Value — KEYBOARD workaround

`page.locator('input[name="name"]').first.type('text', delay=2)` hangs for 30s then times out. This is a CfT + Patchright bug.

**Two workarounds:**

**A. Evaluate prototype setter** (fills DOM but React state ignores it):
```python
page.evaluate("""()=>{
    var i=document.querySelector('input[name="name"]');
    if(i){
        var s=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;
        if(s){s.call(i,'Deal Title');i.value='Deal Title';i.dispatchEvent(new Event('input',{bubbles:true}));i.dispatchEvent(new Event('change',{bubbles:true}));}
    }
}""")
```

**B. `page.keyboard.type()` after `focus()` — PREFERRED** (sends real keyboard events, React captures):
```python
page.evaluate("()=>document.querySelector('input[name=\"name\"]').focus()")
time.sleep(0.3)
page.keyboard.type('Deal Title', delay=3)
time.sleep(0.3)
```
Prefer this for React forms — keyboard events ARE captured by React's event system. The evaluate prototype setter fills the DOM but React's internal state may not update.

**Exception:** The Contact search field (`input[name="query"]`) DOES work with `locator.type()`. Only the main form fields (Title, Value) hang.
Use evaluate prototype setter for Title and Value fields on the Add deal page. See the `locator.type()` Hangs section above for the fix.

### Lead Source Selection Navigates to Board
Using `element.click()` or keyboard on a Radix option can trigger SPA navigation. Use pointerdown + click as shown in the Lead Source section above.

### No `<form>` Element — Cannot `requestSubmit()`
Always check `document.querySelector('form')` before attempting form-level submission. The Add deal page has no form element.

### Save Button Stays Disabled → Check Verification, Not Interaction

If the Save button is enabled (disabled=False) but clicking it doesn't seem to create the deal:

1. **The deal WAS created** — it just takes 3s to 5min to appear on the board
2. **The URL does NOT change** — the SPA stays on the Add deal page
3. **Check the board** by refreshing `/deals/board/{BOARD_ID}` and searching for your deal title
4. **Fixed in State Engine:** Poll the board for the deal title at 30s intervals for up to 5 minutes
5. **Do NOT re-try clicking** — each click may create a duplicate deal

The most common failure pattern: the script reported "Save failed" because the verification checked URL change, which never fires. The deal was actually created successfully.
