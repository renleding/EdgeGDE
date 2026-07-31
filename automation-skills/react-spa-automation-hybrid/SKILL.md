---
name: react-spa-automation-hybrid
description: >
  Hybrid CUA+CDP workflow for React SPAs on macOS. Use CUA (computer_use)
  for React synthetic event triggers (dropdowns, popovers, checkboxes) and
  CDP (page.evaluate) for deterministic field filling, saves, and navigation.
  General pattern applicable to any React SPA including Salestrekker.
tags: [react, spa, automation, hybrid, cua, cdp, patchright, playwright, macos]
trigger: when automating a React SPA where Playwright locator clicks fail to trigger React synthetic events (popovers, dropdowns, disabled Save buttons)
---

# React SPA Automation — Hybrid CUA+CDP Method

## Tiered Coordination — When to Use Which Tool

The 4-tier sensory array provides escalation when a tool fails. Start at T0, escalate up when needed:

| Tier | Tool | Best For | Failure Signal |
|------|------|----------|----------------|
| **T0** | CDP `locator.type()` / `locator.click()` | Text input filling, button clicks, TOTP entry | TimeoutError (locator not found or intercepted) |
| **T1** | Chrome MCP (`browser_console`) | DOM inspection, reading field values, checking page state | Cannot reach the element (different frame/portal) |
| **T2** | browser-act (`browser_navigate/click/type`) | Alternative browser session for SPA navigation | Session expires after ~2 min; slow |
| **T3** | Qwen3 VL (`vision_analyze`) | Visual confirmation of page state, identifying what's on screen | Image analysis is best-effort |
| **T4** | CUA-driver (`computer_use`) | Radix popups, overlays, elements `locator.click()` can't reach (overlay interception) | AX element not found or no change after AXPress |

### Common Failure → Tier Escalation

| What you want to do | Try | If fails | Then try |
|---------------------|-----|----------|----------|
| Click "Add contact" button | T0: CDP `Input.dispatchMouseEvent` on aria-haspopup div | Popup doesn't open | T4: CUA click on the AXButton "Add contact" |
| Click menu item in Radix popup | T0: `page.evaluate` click on `[role="menuitem"]` | JS click ignored | T4: CUA click on the AXMenuItem |
| Click "Add" in dialog | T0: `page.evaluate` click on dialog's Add button | Overlay intercepts | T4: CUA click on the AXButton "Add" |
| Fill text input | T0: `page.locator().type()` | Field doesn't appear in DOM | T1: `browser_console` inspect, T4: CUA click + type |
| Save form | T0: `page.evaluate` click (bypasses overlay) | Button disabled | T4: CUA click on AXButton "Save" |

### Save via evaluate click (bypasses overlay interception)

`page.locator('button:has-text("Save")').click()` can fail when an overlay element
(like an email input from search results) intercepts pointer events. The locator
retries for 30s then times out. **Fix:** Use `page.evaluate` click which bypasses
hit-test checks:

```python
page.evaluate("""() => {
    for(var b of document.querySelectorAll('button')) {
        if((b.textContent.trim() === 'Save' || b.textContent.trim() === 'Save and calculate')
           && !b.disabled && b.offsetParent) { b.click(); return 'saved'; }
    }
    return 'not found';
}""")
time.sleep(5)
# Verify: check if URL changed to /deals/view/ or confirm on board
```

## Batch Fill Then Save

Fill ALL fields on a section before saving — saves are expensive (4-5s wait each):

```python
# CORRECT: fill all visible fields, save once
for field in fields_to_fill:
    page.locator(field['selector']).type(field['value'], delay=2)
page.evaluate("...Save...")
time.sleep(4)

# WRONG: save after each field — doubles or triples execution time
```

React SPAs (Salestrekker, Salesforce, CRM portals) use synthetic events that
Playwright/Patchright locator clicks don't always trigger. "Add X" buttons
that open dropdown menus, checkboxes in popover wrappers, and radio buttons
with custom event handlers often ignore CDP programmatic clicks.

`page.evaluate()` native `.click()` and `__reactProps.onClick()` bypasses help
for some cases, but popover/dropdown menus still fail.

## The Solution: Hybrid CUA+CDP

Split the work between two tools in the same session:

| Work | Tool | Why |
|------|------|-----|
| **React triggers** | CUA (`computer_use`) | macOS accessibility layer fires genuine `AXPress` which React treats as real user input |
| **Field filling** | CDP (`page.evaluate` native setter) | Fast, deterministic, no screenshots, works on hidden/off-screen elements |
| **Navigation** | CDP (`page.evaluate` + `window.location.href`) | SPA-preserving nav, no sign-out |
| **Save/Next** | CDP (`page.evaluate` click) | Works when button isn't React-disabled; fallback to `__reactProps.onClick()` |

## Workflow

```
1. CDP: Navigate to section (window.location.href)
2. CUA: Capture screen to see elements
3. CUA: Click trigger element (e.g. "Add income" → opens dropdown)
4. CUA: Re-capture, see submenu items
5. CUA: Click submenu item (e.g. "PAYG income" → form renders)
6. CDP: Fill all visible fields (page.evaluate native setter + dispatchEvent)
7. CDP: Click Save/Save and calculate
8. Verify: page text contains "successfully updated"
```

## CUA: Key Patterns

### Session management
CUA sessions expire after inactivity. Revive:
```
cua-driver call start_session '{"session":"hermes-<session-id>"}'
```

### Element discovery
```python
computer_use(action='capture', app='Google Chrome for Testing', mode='som')
```
Returns element index, role, label, and bounds (1568x979 whole-window).
Click by element index (most reliable):
```python
computer_use(action='click', element=146)
```

### When to use CUA over CDP
- "Add X" buttons that open dropdown menus with sub-items
- Popover/Radix/Floating UI wrappers that intercept .click()
- Checkboxes in custom toggle components
- Radio buttons with React state handlers
- Native `<select>` dropdowns (use `set_value`)

### Add Contact Flow (Proven CUA+CDP Hybrid Pattern)

The Salestrekker "Add contact" popup is a Radix menu that requires CUA clicks
when CDP `Input.dispatchMouseEvent` alone doesn't work:

```python
# T4 CUA: Capture CfT window to find element indices
capture = computer_use(action='capture', mode='som', pid=640, window_id=717)
# Find "Add contact" button in elements list, note its index (usually ~72)

# T4 CUA: Click Add contact button
computer_use(action='click', element=72, pid=640, window_id=717)

# T4 CUA: Capture again — popup menu now visible
# Find "Add existing person" in the new elements list (usually ~17)

# T4 CUA: Click Add existing person
computer_use(action='click', element=17, pid=640, window_id=717)

# T0 CDP: Type search term in the search field
for i in range(page.locator('input[name="query"]').count()):
    if not page.locator('input[name="query"]').nth(i).input_value():
        page.locator('input[name="query"]').nth(i).type('Sam Smith', delay=3)
        break
time.sleep(3)

# T4 CUA: Capture to see search results
# Find first Sam Smith result (usually ~151) and Add button (~146)

# T4 CUA: Click result, then click Add
computer_use(action='click', element=151, pid=640, window_id=717)
computer_use(action='click', element=146, pid=640, window_id=717)
```
### Radix Button Pointerdown Discovery — CDP Fallback Before Escalating to CUA

Before escalating to CUA (T4) for a stubborn Radix button, try a `pointerdown` event dispatch first. Radix UI Primitives listen for `pointerdown` — NOT `click`, `mousedown`, or `mouseup`.

```python
# Try pointerdown BEFORE escalating to CUA
page.evaluate("""() => {
    for(var b of document.querySelectorAll('button')) {
        if(b.textContent.trim() === 'Add' && !b.disabled && b.offsetParent) {
            b.dispatchEvent(new Event('pointerdown', {bubbles: true, cancelable: true}));
            return true;
        }
    }
    return false;
}""")
time.sleep(2)

# If dialog still visible (check via offsetParent, not DOM presence):
dialog_visible = page.evaluate("""() => {
    var d = document.querySelector('[role="dialog"]');
    return d ? d.offsetParent !== null : false;
}""")
# If still visible, fall through to T4 CUA escalation
```

**Why this works:** Radix uses `onPointerDown` on its trigger components. CDP `Input.dispatchMouseEvent` sends `mousedown`/`mouseup` events (which Radix ignores), while `element.click()` and `dispatchEvent(new MouseEvent('click'))` send `click` events (also ignored). Only a native `pointerdown` event with `bubbles: true` triggers the Radix handler.

**Source:** Stack Overflow answer on triggering Radix UI dropdowns via Selenium/Playwright.

### Dialog Visibility Detection Fix

`document.querySelector('[role="dialog"]') !== null` returns `True` even when the dialog is visually hidden (Radix keeps the DOM element but hides it). This caused false "dialog still open" detections:

```python
# ❌ WRONG — returns True even when dialog is hidden
dialog_present = document.querySelector('[role="dialog"]') !== null

# ✅ CORRECT — checks if dialog is actually visible
dialog_visible = document.querySelector('[role="dialog"]')?.offsetParent !== null
```

### Complete Escalation Ladder for Radix Buttons

```
T0: page.evaluate .click()        → Radix ignores
T0: CDP Input.dispatchMouseEvent  → Radix ignores (sends mousedown)
T0: pointerdown dispatchEvent     → ✅ May work (Radix listens for pointerdown)
T4: CUA AXPress on button         → ✅ Usually works
T4: CUA foreground click          → ✅ Last resort
```

## ComboBox (role=combobox) — Uncrackable (Discovered 26 Jul 2026)

Salestrekker's Product Search uses custom combobox components with `role=combobox` (NOT native `<select>`) for fields like Loan term, Transaction type, Loan purpose. These DO NOT respond to CUA clicks OR CDP events.

**Why they fail:**
- CUA clicks open the dropdown but the options are rendered in React portals (document-level, not children of the combobox)
- Options appear as `<div>`/`<button>` elements that CUA can see but clicking them doesn't register the selection
- `KeyboardEvent` dispatch fails — React 18+ checks `isTrusted`
- The hidden `<input>` accepts value changes via native setter but React doesn't register the state change
- `Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set` works on the input but doesn't propagate to the combobox state
- `__reactProps$` and `__reactFiber$` keys are absent from both the combobox and its input — React internals are minified/obscured

**Known failure case:** Product Search page (required to search for loan products). Fields: Loan term (years), Loan term (months), Transaction type, Loan purpose, Facility type.

**Workaround (none reliable):**
1. AppleScript JS injection on user's real Chrome (8um7547w profile with JS toggle ON) — combobox IS found but options can't be selected
2. Playwright headed off-screen — combobox IS rendered but options don't appear in Playwright's Chrome (SPA renders differently)
3. Direct value setting on hidden input — value appears in the DOM but React doesn't register it

**Recommendation:** These fields require genuine user interaction. Automate everything else, flag combobox fields as manual completion in the task summary.

### Nested dropdown pattern (3-level)
Some "Add" buttons cascade through MULTIPLE menus before reaching the form.
Common in Salestrekker sections:

```text
Add current employment
  → Salaried employee (level 2 dropdown)
    → Add new company → MODAL opens (NOT inline!)
    → Add existing company
  → Self employed
  → Retired
  → Unemployed
```

Each level requires a separate CUA capture → click cycle:
1. CUA: Click "Add current employment" → capture sees level 2 menu
2. CUA: Click "Salaried employee" → capture sees level 3 sub-menu
3. CUA: Click "Add new company" → MODAL renders
4. CDP: Fill modal fields (Entity name, ABN, Email)
5. CUA: Click "Add" in modal → modal closes, inline employment form renders
6. CDP: Fill employment form (Occupation, Start date, ABN, etc.) — field details in table below

### Employment form fields (after modal close)
| Field | Name/Selector | Value | Notes |
|-------|--------------|-------|-------|
| Occupation | `input` by position | Electrician | |
| Employment priority | combobox | Primary | |
| Employment basis | combobox | Permanent full-time | |
| Start date | DD/MM/YYYY input | 20/05/2015 | Date picker |
| ABN | text input | | Optional |
| Employer name | combobox (pre-filled) | Wealth Wages | |
| ANZSCO code | combobox | Search | |
| Employer type | combobox | Select one | |


Other sections with similar nested patterns:
- **Income**: "Add income" → "PAYG income" → inline form renders
- **Assets**: "Add asset" → type menu (Vehicles, Home content, Bank account) → inline form renders  
- **Liabilities**: "Add liability" → type menu (Credit card, Vehicle loan) → inline form renders
- **Insurance**: "Add insurance" → type menu (Income Protection) → inline form renders

## Known Field Names (Salestrekker 2.0)
| Section | Field | Input name |
|---------|-------|------------|
| Income | Gross salary | `grossSalary` |
| Income | Bonus | `bonus` |
| Assets | Vehicle make/model | `name` (not `makesModel`) |
| Assets | Vehicle value | `value` |
| Assets | Home contents value | `contentsValue` |
| Assets | Savings balance | `savingsBalance` |
| Liabilities | Credit card issuer | `creditCardIssuer` |
| Liabilities | Credit limit | `creditLimit` |
| Liabilities | Balance | `balance` |
| Insurance | Provider name | `providerName` |
| Insurance | Sum insured | `sumInsured` |
| Insurance | Premium amount | `premiumAmount` |
| Employment | Occupation | `occupation` (by nth() index) |
| Employment | Employer name | `name` on the modal |

### Product Requirements — Radio Button Pattern

Salestrekker 2.0 Product Requirements uses `input[type="radio"]` inside `<fieldset>` with `<legend>`.  
Pass args as `[legend_text, value]` array:

```python
def click_radio(page, legend_text, value):
    return page.evaluate('''(args)=>{
        const [t,v]=args;
        const all=document.querySelectorAll('fieldset');
        for(const f of all){
            const l=f.querySelector('legend');
            if(l&&l.textContent.trim()===t){
                const rs=f.querySelectorAll('input[type="radio"]');
                for(const r of rs){if(r.value===v){r.click();r.dispatchEvent(new Event('change',{bubbles:true}));return true}}
            }
        }
        return false
    }''', [legend_text, value])

# Usage:
click_radio(page, "Fixed rate", "important")
click_radio(page, "Variable rate", "important")
click_radio(page, "Fixed and variable rate", "do_not_want")
click_radio(page, "Principal and interest", "important")
click_radio(page, "Interest only", "do_not_want")
click_radio(page, "Offset account", "important")
click_radio(page, "Redraw", "important")
click_radio(page, "Lowest overall loan cost", "most_important")
click_radio(page, "Loan approved quickly", "somewhat_important")
click_radio(page, "Specific loan features", "least_important")
click_radio(page, "Lender policy/borrowing capacity", "most_important")
click_radio(page, "How often do you go to a branch?", "rarely")
click_radio(page, "How often do you use internet banking?", "all_the_time")
```

Page URL: `/deals/home-loan/{D}/{C}/product-requirements`



When background CUA clicks fail (effect: 'suspected_noop' or 'unverifiable'),
climb the escalation ladder:

```python
# Step 1: Retry with foreground delivery (brings window front briefly)
computer_use(action='click', element=N, delivery_mode='foreground',
    capture_after=True)

# Step 2: If still failing, try by pixel coordinate
computer_use(action='click', coordinate=[x, y], delivery_mode='foreground',
    capture_after=True)
```

Use foreground ONLY after a background attempt returned a failure signal.
Never predict it from the app type — always react to the returned signal.
Set `bring_to_front=True` for rapid sequential foreground actions.

## CDP: Key Patterns

### page.evaluate() with array args (PROVEN — always use this)

Pass arguments as a SINGLE array, then destructure in JS. This is the ONLY
reliable pattern across Playwright and Patchright versions:

```python
# ✅ CORRECT — single array arg, destructured in JS
page.evaluate("""(args) => {
    const [name, value] = args;
    // use name and value
}""", ["grossSalary", "150000"])

# ❌ WRONG — multi-arg fails on many Playwright/Patchright versions
page.evaluate("""(name, value) => { ... }""", "grossSalary", "150000")

# Also ✅ — object arg
page.evaluate("""(arg) => {
    const {name, value} = arg;
}""", {"name": "grossSalary", "value": "150000"})
```

### Controlled Textarea Filling — HTMLTextAreaElement setter

React-controlled `<textarea>` elements require the `HTMLTextAreaElement.prototype.value` setter — NOT `HTMLInputElement.prototype.value`:

```python
# ✅ CORRECT — textarea-specific setter
page.evaluate("""(args) => {
    const [name, value] = args;
    const el = document.querySelector('textarea[name="' + name + '"]');
    if (!el) return false;
    const s = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype, 'value').set;
    if (s) {
        s.call(el, value);
        el.dispatchEvent(new Event('input', {bubbles: true}));
        el.dispatchEvent(new Event('change', {bubbles: true}));
        return true;
    }
    return false;
}""", [textarea_name, value])

# ❌ WRONG — HTMLInputElement setter throws on textarea
# s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
# s.call(textarea, value)  # TypeError!
```

**Pitfall:** Using the `HTMLInputElement` value setter on a `<textarea>` element throws `TypeError: Illegal invocation`. Always check whether the target is `INPUT` or `TEXTAREA` and use the correct prototype.

### page.fill() — best for textarea elements

Patchright's `page.fill()` dispatches proper React events on textarea elements too. Prefer it over the native setter when the element is visible and not inside a portal:

```python
page.locator('textarea[name="' + name + '"]').fill(value)
```

```python
# ✅ CORRECT — dispatches React synthetic events
page.locator('input[name="grossSalary"]').fill('150000')

# ⚠️ Fallback — native setter for fields fill() can't reach
page.evaluate("""(args) => {
    const [name, value] = args;
    const s = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype, 'value').set;
    const el = document.querySelector('[name="' + name + '"]');
    if (el && s) {
        s.call(el, value);
        ['input','change'].forEach(e =>
            el.dispatchEvent(new Event(e, {bubbles:true})));
    }
}""", ["grossSalary", "150000"])
```

**Caveat:** `page.fill()` works on visible, enabled inputs. For inputs inside
React portals, modals, or off-screen elements, use the native setter fallback.

### Login flow (React SPA)
```python
# Fill using native setter + dispatchEvent
page.evaluate("""(args) => {
    const [u, p] = args;
    const s = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype, 'value').set;
    const email = document.querySelector('input[type="email"]');
    const pwd = document.querySelector('input[type="password"]');
    if (email && s) {
        s.call(email, u);
        ['input','change'].forEach(e =>
            email.dispatchEvent(new Event(e, {bubbles:true})));
    }
    if (pwd && s) {
        s.call(pwd, p);
        ['input','change'].forEach(e =>
            pwd.dispatchEvent(new Event(e, {bubbles:true})));
    }
}""", [USER, PASS])
time.sleep(1)

# Submit via form.requestSubmit() — triggers React validation
page.evaluate("""() => {
    const form = document.querySelector('form');
    if (form) form.requestSubmit();
}""")
```

### SPA navigation (AVOID page.goto)

```python
# ✅ SAFE — stays within SPA
page.evaluate("window.location.href = '/deals/view/{deal_id}/{contact_id}'")
time.sleep(5)

# ❌ TRIGGERS SIGN-OUT (authenticated routes only)
page.goto("https://app.example.com/deals/view/{id}")
```

`page.goto()` is safe ONLY for unauthenticated routes (login, TOTP).

### Save button
```python
page.evaluate("""() => {
    const b = document.querySelectorAll('button');
    for(let i=0;i<b.length;i++)
        if(b[i].offsetParent && (b[i].textContent.trim()==='Save'
            || b[i].textContent.trim()==='Save and calculate'))
                { b[i].click(); return; }
}""")
time.sleep(3)
# Verify
t = page.evaluate("document.body.innerText")
ok = "updated" in t.lower()
```

## Pitfalls

- **CUA session expires** — revive via `cua-driver call start_session` before each capture attempt
- **CDP clicks on dropdown buttons** — CUA clicks trigger React state; CDP clicks on the same button only focus it
- **App capture scope** — always pass `app='Google Chrome for Testing'` to avoid capturing the wrong window
- **Element index stability** — AX element indices change between page renders; re-capture before each click
- **`page.goto()` signs out** — only use on unauthenticated routes; use `window.location.href` for SPA routes
- **`window.location.href` is async** — the SPA needs 4-5s to re-render after navigation
- **`danger`-class radio buttons may have server-side isTrusted validation** — fields with `danger` CSS class on the wrapper div (vs `secondary`) can silently discard programmatically-set values. The server returns `status: true, errors: null` but doesn't persist the change. Test with alternate values and verify by navigating away and back. This affects at least `lenderPolicy` with `most_important` in Salestrekker's Product Requirements.
- **Textarea vs Input setter** — `HTMLTextAreaElement.prototype.value` setter is separate from `HTMLInputElement.prototype.value`. Using the wrong one throws `TypeError`. Check `el.tagName` before choosing the setter.

## Required Setup

- Chrome for Testing running on port 9222 with the automation profile
- `pip install patchright` (or playwright)
- cua-driver running (needed for CUA captures/clicks)
- Credentials from Bitwarden vault via `load_hermes_dotenv()`

## Related Skills

- `salestrekker-react-automation` — Salestrekker-specific field names, section URLs, login SOP
- `salestrekker-react-form-entry` — React form entry with Add existing person, batch save, value formatting
- `salestrekker-login-and-navigation` — SPA navigation rules, Radix popover CDP approach
- `four-tier-sensory-test` — 4-tier sensory array for test execution
- `salestrekker-data-entry` — Section-specific data entry patterns
- `playwright-spa-automation` — Patchright setup, launchPersistentContext, AppleScript injection fallback
- `salestrekker-test-deal` — Test deal data, contact details, expected values
- `agent-process-automation` — Generic browser process automation engine
