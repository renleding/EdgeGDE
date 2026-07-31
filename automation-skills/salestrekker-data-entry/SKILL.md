---
name: salestrekker-data-entry
description: >-
  Data entry patterns for Salestrekker 2.0 React SPA — section navigation,
  field filling, enterprise methodology (vision-for-discovery, script-for-runtime),
  asset type selection, and all applicant/deal sections.
tags: [salestrekker, data-entry, browser-automation, cdp, playwright, react-spa]
---

# Salestrekker Data Entry — Section Navigation & Field Fill Patterns

## Enterprise Methodology — Vision-for-Discovery, Script-for-Runtime

Core principle for ALL Salestrekker automation — NOT optional.

```
PHASE 1 (DEVELOP) — Use CUA vision/SOM to discover the page layout
  → Take ONE screenshot to see what's on screen
  → Identify DOM element patterns (classes, roles, selectors)
  → Use page.evaluate() to probe the React component tree

PHASE 2 (FREEZE) — Build a deterministic script from discovered patterns
  → All interaction via page.evaluate() with native JS
  → No CUA, no screenshots, no LLM at runtime
  → Zero recurring token cost

PHASE 3 (MAINTAIN) — When a script breaks (DOM change, React update):
  → Use CUA vision ONE TIME to diagnose
  → Update the selectors in the script
  → Back to runtime-free operation
```

**Why:** The React SPA's AX tree is shallow — form fields don't surface in SOM mode.
CUA captures are slow (200K+ chars of Chrome chrome noise per scan). Direct
page.evaluate() is instant and bypasses React's focus-gate and isTrusted checks.
Vision is a development-time tool, NOT a runtime tool.

## Primary Navigation — a._U0 Section Links

The home loan edit page renders section links as `<a>` tags with class `_U0 _R0`.
This is the **preferred** navigation method — no SPA priming needed:

```python
def open_section(page, name):
    """Click a section link by text. Returns True if found."""
    return page.evaluate("""(section) => {
        const links = document.querySelectorAll('a._U0, a[class*="_U0"]');
        for (const a of links) {
            if (a.textContent.trim() === section && a.offsetParent !== null) {
                a.click(); return true;
            }
        }
        return false;
    }""", name)

# Usage — navigate to section page first, then open the section
page.goto(f'.../deals/home-loan/{dealId}/{contactId}', timeout=15000)
time.sleep(3)
open_section(page, "Assets")
open_section(page, "Liabilities")
open_section(page, "Income")
open_section(page, "Expenses")
open_section(page, "Needs and objectives")
```

### Complete section list (sidebar order)
```
CLIENT PROFILE sections (per applicant):
  Client profile   — SUMMARY toggle, opens Sam/Amy tabs
  Sam Smith           APPLICANT tab
  Amy Smith           APPLICANT tab
  Assets
  Liabilities
  Income
  Expenses
  Needs and objectives
  Risks - Sam Smith
  Risks - Amy Smith
  Product requirements
  Insurance
  Other advisers

HOME LOAN sections (loan-level):
  Security details
  Funding worksheet
  Product search
  Compare products
  Commissions
  Compliance comments and documents
  Summary
  Diversification opportunities
```

## Add Deal Form — Keyboard-First Pattern (Updated 28 Jul 2026)

The Add deal form fields have **NO React props** (`__reactProps$`) in the current Salestrekker build. The form state is parent-managed. `locator.type()` has a CfT/Patchright bug causing 30s timeout.

**Working pattern — focus + keyboard.type():**

```python
# Title
page.evaluate("()=>document.querySelector('input[name=\"name\"]').focus()")
time.sleep(0.3)
page.keyboard.type('Deal Title Here', delay=2)

# Value
page.evaluate("()=>document.querySelector('input[name=\"value.total\"]').focus()")
time.sleep(0.3)
page.keyboard.type('800000', delay=2)

# Lead source combobox
page.evaluate("()=>document.querySelector('[name=\"leadSource\"]').click()")
time.sleep(1.5)
page.keyboard.press('ArrowDown')
time.sleep(0.3)
page.keyboard.press('Enter')
time.sleep(1.5)
```

**Save button is BLOCKED** on current build — uses addEventListener with handleEvent object. `element.click()` doesn't trigger on disabled buttons. `removeAttribute('disabled')` + click produces zero API calls (React's internal form state doesn't match DOM values).

## React Controlled Input Filling (v2, 27 Jul 2026 — UNSOLVED persistence)

**CRITICAL: Section editor data persistence is an unsolved problem for Assets, Expenses, and Product Requirements.**

The evaluate native setter pattern (`Object.getOwnPropertyDescriptor(...).set` + `dispatchEvent`) **and** `locator().type()` with real keyboard events both fail to persist data in certain home loan editor sections.

### Persistence Matrix (verified 27 Jul 2026)

| Section | Persists? | Method Used |
|---------|-----------|-------------|
| Liabilities | ✅ Yes | evaluate or .type() |
| Income | ✅ Yes | evaluate or .type() |
| Needs and objectives | ✅ Yes | textarea evaluate |
| Insurance | ✅ Yes | evaluate |
| Security details | ✅ Yes | evaluate |
| Funding worksheet | ✅ Yes | evaluate |
| Client profile | ⚠️ Partial | fields fill but not all persist |
| **Assets** | **❌ No** | **Fails — both evaluate and .type()** |
| **Expenses** | **❌ No** | **Fails** |
| **Product requirements** | **❌ No** | **Fails — radio buttons + textareas** |

### What Was Tried for Section Persistence (All Failed)

| Approach | Result |
|----------|--------|
| `locator().type('...', delay=2)` via keyboard | Fields fill visibly, Save discards |
| evaluate prototype setter + input/change events | Same |
| evaluate.click() on Save button | Saves null/empty values |
| locator.click() on Save button | Same |
| keyboard Tab to Save + Enter | Same |
| pointerdown event on Save button | Same |
| CDP Input.dispatchMouseEvent on Save | Same |
| Batch fill all fields, then save once | Same |

### Suspected Root Cause

The deal creation form and home loan section editors use different React state management:

- **Deal creation form**: React form state mirrors DOM values. `.type()` and evaluate setter both trigger React's onChange reliably.
- **Section editors**: React maintains an internal state SEPARATE from DOM values. CDP-driven changes to the DOM don't propagate to React's internal state. The Save button submits the React state (empty), not the DOM values (filled).

React's controlled components may check `event.isTrusted` — all programmatic events are `isTrusted: false`, and only real user interactions are `isTrusted: true`.

### Workaround

For sections where persistence works, use `locator().type()` with delay=2:
```python
page.locator('input[name="name"]').first.type("BMW 3 Series", delay=2)
```

For Assets, Expenses, and Product Requirements, manual entry or an alternative approach (CUA keystrokes? API call?) is required. See the `salestrekker-react-form-entry` skill's reference file `radix-pointerdown-fix.md` for the pointerdown research lead.

### Verification Pattern (always use this)
```python
# After saving, navigate away and back, then check
page.evaluate("window.location.href = '{same_section_url}'")
time.sleep(6)
txt = page.evaluate("""() => document.body.innerText""")
print(f"Data persisted: {'BMW' in txt}")
```

### Fill Input Helper — For Sections Where It Works
```python
def fill_input(page, name, value):
    return page.evaluate("""({name, value}) => {
        const setter = Object.getOwnPropertyDescriptor(
            window.HTMLInputElement.prototype, 'value'
        )?.set;
        const el = document.querySelector('input[name="' + name + '"]');
        if (el && el.offsetParent !== null) {
            setter?.call(el, value);
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
        }
        const el2 = document.querySelector('textarea[name="' + name + '"]');
        if (el2 && el2.offsetParent !== null) {
            el2.focus();
            el2.value = value;
            el2.dispatchEvent(new Event('input', { bubbles: true }));
            el2.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
        }
        return false;
    }""", {"name": name, "value": str(value)})
```

## Save Button — Handles Both Variants

Financial sections use "Save and calculate", others use "Save":

```python
def save_section(page):
    result = page.evaluate("""() => {
        const btns = document.querySelectorAll('button');
        for (const b of btns) {
            const t = b.textContent.trim();
            if ((t === 'Save' || t.startsWith('Save')) && b.offsetParent !== null) {
                b.click(); return t;
            }
        }
        return 'Save not found';
    }""")
    time.sleep(2)
    msg = page.evaluate("""() => {
        const t = document.body.innerText.toLowerCase();
        const idx = t.indexOf('updated');
        if (idx >= 0) return t.substring(Math.max(0, idx-20), idx+60);
        return '';
    }""")
    return result, msg
```

## Asset Type Selection — [role=menuitem]

After clicking "Add asset" or "Add liability", type options appear as
`<button role="menuitem">` in a dropdown menu:

```python
def click_menuitem(page, label):
    return page.evaluate("""(label) => {
        const items = document.querySelectorAll('[role="menuitem"]');
        for (const item of items) {
            if (item.textContent.trim() === label && item.offsetParent !== null) {
                item.click(); return true;
            }
        }
        return false;
    }""", label)

# Complete flow: Add asset -> select type -> fill -> save
click_button(page, "Add asset")
time.sleep(2)
click_menuitem(page, "Vehicles make and model")
time.sleep(2)
fill_input(page, "name", "BMW X5 2018")
fill_input(page, "vehicleBuildDate", "06/2018")
fill_input(page, "value", "40000")
```

### Asset types and their form fields (verified 26 Jul 2026)
```
Button label               Fields revealed (by input name attr)
Vehicles make and model    name (NOT makesModel!), vehicleBuildDate, value, vehicleRegoNumber, percent(x2)
Home content               contentsValue (NOT name/value)
Bank account               savingsBalance, bankName, bankAccountNumber, bsb, percent
Shares                     name, value
Other                      name, value
```

### Liability types (same pattern)
```
Credit card                creditCardIssuer, creditLimit, balance, repayment
Vehicle loan               financeProvider, totalFinanced, balance, monthlyRepayment
Personal loan              financeProvider, totalFinanced, balance, monthlyRepayment
```

**See also:** `react-spa-automation-hybrid` for full nested dropdown patterns,
CUA session management, and the escalation ladder for stubborn Add buttons.

## Tab/Page Cleanup

Too many open CDP tabs degrades performance. Clean up before each script run:

```python
import urllib.request, json
tabs = json.loads(urllib.request.urlopen('http://localhost:9222/json').read())
first = tabs[0]['id'] if tabs else None
for t in tabs:
    if t['id'] != first and 'salestrekker' in t.get('url', ''):
        urllib.request.urlopen(f'http://localhost:9222/json/close/{t["id"]}').read()
```

Use `browser.contexts[0].pages[0]` (first existing tab), NOT `ctx.new_page()`.
New tabs require a full SPA reload and slow things down.

## Reference Scripts

Scripts under `scripts/` in the EdgeGDE repo that implement these patterns:
- `st-test-deal-2.py` — Complete Test Deal 2 creation via the deal wizard
- `st-test-deal-3-fill.py` — Test Deal 3 post-creation data entry (section nav + asset types)

## Reference Files

- `references/product-requirements-field-map.md` — Complete field map for the Product Requirements section: all radio groups, textareas, text inputs, comboboxes, checkbox reasons, and the `danger`-class server-side validation finding
- `references/asset-liability-field-maps.md` — Field name/value map for vehicle, contents, bank, credit card, loan forms (26 Jul 2026)
- `references/test-deal-3-field-map.md` — Test Deal 3 data: applicant details, income, expenses, assets, liabilities, risks

## Section-Specific Fill Patterns

### Assets
Click "Add asset" -> click asset type via [role=menuitem] -> fill fields -> Save and calculate.
The percent field (ownership split) defaults to 50/50 for joint applicants.

### Liabilities
Click "Add liability" -> click liability type -> fill fields -> Save and calculate.

### Expenses
1. Click "Add expense"
2. Applicant checkboxes + "Add" button appear
3. Fill fields for Groceries, Clothing, Phone, Other
4. Save and calculate

### Risks (radio buttons by index)
Radio buttons have no name attribute. Fill by index:

```python
page.evaluate("""
(function() {
    var rbs = document.querySelectorAll('input[type="radio"]');
    // Sam Smith risks (40 radios, 0-based):
    // 1=No(adverse), 3=No(beneficial), 5=Medium(exp), 8=Medium(interest),
    // 11=High(flexibility), 13=Low(security), 16=Low(property),
    // 18=Yes(emergency), 21=No(commitments), 22=Yes(insurance),
    // 25=No(will), 27=No(circumstances), 29=No(problems),
    // 31=No(officer), 33=No(judgements), 35=No(other), 37=No(bankrupt)
    [1,3,5,8,11,13,16,18,21,22,25,27,29,31,33,35,37].forEach(function(i){
        if(rbs[i]) rbs[i].click();
    });
})()
""")
```

### Retirement age + Exit strategy checkboxes
```python
page.evaluate("""
(function() {
    var ns = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    var ins = document.querySelectorAll('input');
    for(var i=0;i<ins.length;i++){
        if(ins[i].type==='text' && ins[i].name && ins[i].name.includes('exitStrategy')){
            ns.call(ins[i], '67');
            ins[i].dispatchEvent(new Event('input', {bubbles: true}));
            ins[i].dispatchEvent(new Event('change', {bubbles: true}));
            break;
        }
    }
    // Exit checkboxes
    var cbs = document.querySelectorAll('input[type="checkbox"]');
    for(var i=0;i<cbs.length;i++){
        var p = (cbs[i].parentElement||{}).textContent||'';
        if(p.includes('Repayment') || p.includes('Savings') || p.includes('Income from')){
            cbs[i].checked = true;
            cbs[i].dispatchEvent(new Event('change', {bubbles: true}));
        }
    }
})()
""")
```

### Requirements & Objectives — Expand and Check Owner occupied

The REQUIREMENTS AND OBJECTIVES section is **collapsed by default** and must be expanded first before any fields are accessible:

```python
# Step 1: Expand the section
page.evaluate("""() => {
    const all = document.querySelectorAll('button');
    for (const el of all) {
        const p = el.closest('div') || el.parentElement;
        if (p && p.textContent.includes('REQUIREMENTS') && el.offsetParent !== null) {
            el.click(); return;
        }
    }
}""")
time.sleep(1)

# Step 2: Click Owner occupied
page.evaluate("""() => {
    const cbs = document.querySelectorAll('input[type="checkbox"]');
    for (var i = 0; i < cbs.length; i++) {
        var p = (cbs[i].parentElement || {}).textContent || '';
        if (p.includes('Owner occupied')) { cbs[i].click(); return true; }
    }
    return false;
}""")
```

### Purpose Section (Dynamic Add)

After expanding REQUIREMENTS AND OBJECTIVES, there's a "PURPOSE" section with an Add (+) button. Clicking it adds a row with two fields:
- Purpose description (input)
- Amount (input)

```python
# Click the Add (+) icon button in the PURPOSE section
page.evaluate("""() => {
    const h3 = Array.from(document.querySelectorAll('h2, h3'));
    for (const h of h3) {
        if (h.textContent.includes('purpose') && h.textContent.includes('proceeds')) {
            const sec = h.closest('div') || h.parentElement;
            const btns = sec.querySelectorAll('button');
            for (const b of btns) if (b.offsetParent !== null) { b.click(); return; }
        }
    }
}""")
time.sleep(0.5)

# Fill purpose and amount
page.evaluate("""() => {
    const inputs = document.querySelectorAll('input:not([type=hidden]):not([type=radio]):not([type=checkbox])');
    if (inputs.length >= 2) {
        // First new input = purpose description
        const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        if (s) {
            s.call(inputs[inputs.length-2], 'Purchase of established property at 1 Test Street');
            inputs[inputs.length-2].dispatchEvent(new Event('input', {bubbles: true}));
            // Second = amount
            s.call(inputs[inputs.length-1], '640000');
            inputs[inputs.length-1].dispatchEvent(new Event('input', {bubbles: true}));
        }
    }
}""")
```

## Product Requirements Section

Page URL: `/deals/home-loan/{D}/{C}/product-requirements`

### Radio Buttons by Fieldset + Value

Product Requirements uses `input[type="radio"]` grouped inside `<fieldset>` with `<legend>`. Some radio inputs have `disabled=""` attribute — remove it before clicking:

```python
def click_product_radio(page, legend_text, value):
    """Click a radio button by fieldset legend + value. Handles disabled inputs."""
    return page.evaluate("""(args) => {
        const [t, v] = args;
        for (const f of document.querySelectorAll('fieldset')) {
            const l = f.querySelector('legend');
            if (!l || l.textContent.trim() !== t) continue;
            for (const r of f.querySelectorAll('input[type="radio"]')) {
                r.removeAttribute('disabled');
                if (r.value === v) {
                    r.checked = true;
                    r.click();
                    const evt = document.createEvent('MouseEvents');
                    evt.initEvent('click', true, true);
                    r.dispatchEvent(evt);
                    return true;
                }
            }
        }
        return false;
    }""", [legend_text, value])

# RATE TYPE
click_product_radio(page, "Fixed rate", "do_not_want")
click_product_radio(page, "Variable rate", "important")
click_product_radio(page, "Fixed and variable rate", "do_not_want")

# REPAYMENT TYPE
click_product_radio(page, "Principal and interest", "important")
click_product_radio(page, "Interest only", "do_not_want")
click_product_radio(page, "Interest in advance", "do_not_want")

# PRODUCT TYPE
click_product_radio(page, "Line of credit", "do_not_want")
click_product_radio(page, "Offset account", "important")
click_product_radio(page, "Redraw", "important")

# REPAYMENT FREQUENCY (Indicate preferred repayment frequency)
click_product_radio(page, "Indicate preferred repayment frequency", "monthly")

# WHAT IS IMPORTANT FOR YOU
click_product_radio(page, "Lowest overall loan cost", "most_important")
click_product_radio(page, "Loan approved quickly", "somewhat_important")
click_product_radio(page, "Specific loan features", "least_important")
click_product_radio(page, "Lender policy/borrowing capacity", "somewhat_important")
# NOTE: lenderPolicy with "most_important" REJECTED by server (server-side validation)
# Only "somewhat_important" or "least_important" persist for this field

# BRANCH / INTERNET
click_product_radio(page, "How often do you go to a branch?", "rarely")
click_product_radio(page, "How often do you use internet banking?", "all_the_time")
```

### Checkboxes (Why textareas)

Some radio groups have follow-up checkbox sections (e.g., "Where principal and interest is important, why?"). These are `AXCheckBox` in the AX tree — click via native `.click()`:

```python
for label in ["Minimise interest paid over life of loan", "Allows paying off the loan sooner",
               "Flexibility to access prepaid funds if needed"]:
    page.evaluate("""(label) => {
        const all = document.querySelectorAll('label, span, div');
        for (const el of all) {
            if (el.textContent.trim() === label) {
                const cb = el.closest('label') || el.querySelector('input[type="checkbox"]');
                if (cb) { cb.click(); return true; }
            }
        }
        return false;
    }""", label)
```

### Textareas in Product Requirements

Two textareas exist:
- `productRequirements.otherRequirements` — "Do the applicant(s) have any other requirements..."
- `productRequirements.whatIsImportantForYou.lowestOverallLoanCostComments` — "Please comment why is this important to you"

Use the native value setter for HTMLTextAreaElement (NOT HTMLInputElement):

```python
def fill_textarea(page, name, value):
    return page.evaluate("""(args) => {
        const [n, v] = args;
        const el = document.querySelector('textarea[name="' + n + '"], [id="' + n + '"]');
        if (!el) return false;
        const s = Object.getOwnPropertyDescriptor(
            window.HTMLTextAreaElement.prototype, 'value').set;
        if (s) {
            s.call(el, v);
            el.dispatchEvent(new Event('input', {bubbles: true}));
            el.dispatchEvent(new Event('change', {bubbles: true}));
            return true;
        }
        return false;
    }""", [name, value])

fill_textarea(page, "productRequirements.otherRequirements",
    "No other requirements or objectives not already stated.")
fill_textarea(page, "productRequirements.whatIsImportantForYou.lowestOverallLoanCostComments",
    "Keeping monthly repayments affordable and minimising total interest paid over the life of the loan.")
```

**Pitfall:** Using `HTMLInputElement.prototype.value` setter on a `<textarea>` throws an error. Always use `HTMLTextAreaElement.prototype.value` setter for textareas.

### Text Fields (Preferred lenders etc.)

Direct input text fields by name:

```python
page.evaluate("""(args) => {
    const [name, value] = args;
    const el = document.querySelector('input[name="' + name + '"]');
    if (!el) return false;
    const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    if (s) {
        s.call(el, value);
        el.dispatchEvent(new Event('input', {bubbles: true}));
        el.dispatchEvent(new Event('change', {bubbles: true}));
        return true;
    }
    return false;
}""", ["productRequirements.termOfCreditSought.preferredLenders", "ANZ, CBA, NAB"])

page.evaluate("""(args) => {
    const [name, value] = args;
    const el = document.querySelector('input[name="' + name + '"]');
    if (!el) return false;
    const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    if (s) {
        s.call(el, value);
        el.dispatchEvent(new Event('input', {bubbles: true}));
        el.dispatchEvent(new Event('change', {bubbles: true}));
        return true;
    }
    return false;
}""", ["productRequirements.termOfCreditSought.notLenders", "None"])
```

### Combobox (Years, Months)

Years/Months use custom React comboboxes (`role="combobox"`) with NO native `<select>`. Options appear as `<div>`/`<button>` elements in a React portal. They DO NOT respond to CUA `set_value` or CDP evaluate for selection.

**Option 1 — Keyboard ArrowDown navigation (works for SELECT YEAR):**
Open the combobox with a click, then press ArrowDown N times + Enter:
```python
# Open years combobox
page.evaluate("""() => {
    const c = document.querySelector('[role="combobox"]');
    if (c) c.click();
}""")
time.sleep(0.5)
# Press ArrowDown 10 times (from 40 to 30 years)
for _ in range(10):
    page.keyboard.press("ArrowDown")
    time.sleep(0.1)
page.keyboard.press("Enter")
```

**Option 2 — Clear button for Months:**
The Months combobox has a "Clear" button that resets to "Select one" (no value). Use CUA click on the Clear button. Note: months options only go 1-11 (no "0 months" option).

### Server-side Validation: `danger` class fields

Radio buttons inside a `<span>`/`<div>` with CSS class containing `danger` have **server-side isTrusted event validation**. The server silently discards values set programmatically for `most_important` on the `lenderPolicy` field. Accepted values: `somewhat_important` and `least_important`.

Detection: the fieldset's wrapper class differs — `_u0` (unset) vs `_m0` (has value) for normal fields.

### API Direct Call (last resort for stubborn fields)

If UI clicks fail to persist a value, use the page's authenticated fetch context:

```python
token = page.evaluate("() => localStorage.getItem('accessToken')")
result = page.evaluate("""async (token) => {
    const payload = {data: { ticketId: "20b987db-...", /* ... full payload */ }};
    const res = await fetch("https://pc.engine.v2.salestrekker.com/ticket_client_profile/update", {
        method: "POST",
        headers: {"Content-Type": "application/json", "Authorization": "Bearer " + token},
        body: JSON.stringify(payload)
    });
    return await res.json();
}""", token)
```

**CAUTION:** The API returns `status: true, errors: null` even when it silently discards the value (as with `lenderPolicy: "most_important"`). Always verify persistence by navigating away and back.

## Session Management
- Do NOT re-login for each section. Use the existing CDP session (CfT runs persistently on 9222).
- Re-logging wastes time, risks 2-attempt limit, resets SPA state.
- Check session is still active: navigate to /dashboard, look for "sign-in" in URL.

### ⚠️ SPA Navigation Sign-out Risk (Updated 30 Jul 2026)

**`page.evaluate("window.location.href = '...'")` causes sign-out after ~5-10 navigations.** The SPA's session token (localStorage/bearer) expires under repeated `window.location.href` assignments. This is NOT immediate — it degrades gradually. You'll see the page return empty body text before the final redirect to `/auth/sign-out`.

**Fixes/precautions:**

1. **Prefer the sidebar-click entry path** (does NOT trigger sign-out):
```python
# CORRECT — click Home loan tab from deal view, then section links
await page.evaluate("window.location.href = '/deals/view/{deal_id}/{contact_id}'")
time.sleep(4)
# Click "Home loan" tab
page.evaluate("""() => {
    var all = document.querySelectorAll('a, button, div, span');
    for (var el of all) {
        if (el.textContent.trim() === 'Home loan' && el.offsetParent !== null) {
            el.click(); return;
        }
    }
}""")
time.sleep(4)
# Now click section links from sidebar (a._U0 elements)
page.evaluate("""(section) => {
    const links = document.querySelectorAll('a._U0, a[class*="_U0"]');
    for (const a of links) {
        if (a.textContent.trim() === section && a.offsetParent !== null) {
            a.click(); return true;
        }
    }
    return false;
}""", "Assets")
```

2. **Batch multiple sections in one pass** — minimize total navigations. Fill all fields in a section before moving to the next.

3. **Detect sign-out early** — after every 3rd navigation, check for sign-out:
```python
def check_signed_out(page):
    url = page.url
    if '/sign-out' in url or '/sign-in' in url:
        raise Exception("Session expired — sign-out detected. Manual login required.")
    text = page.evaluate("() => document.body.innerText")
    if 'See you again soon' in text or 'Welcome back' in text:
        raise Exception("Session expired — sign-in page detected.")
```

4. **When session expires**, the page body may return empty (0 lines). This is the first warning sign. The CDP connection is still alive but the page needs re-login. Close expired tabs and navigate to `/auth/sign-in` — the 8um7547w profile may NOT auto-fill credentials after a full sign-out cycle.

5. **Last-known-good approach**: Navigate to the deal's specific board page FIRST (`/deals/board/{deal_id}`), which is the most stable route, then enter the home loan editor from there.

## Known Pitfalls
1. Add current employment button was previously blocked by Radix menus. SOLVED via CUA hybrid: CUA click Add current employment -> CUA click Salaried employee -> CUA click Add new company -> modal opens -> fill entity name -> CUA click Add -> modal closes -> inline employment form renders with Occupation, Start date, ABN, ANZSCO fields. See `react-spa-automation-hybrid` for the full nested menu tree and CUA escalation pattern.
2. CUA clicks on checkboxes: Use page.evaluate() with checked=true instead.
3. Radio buttons: No name attribute, can't group by name. Use querySelectorAll by index.
4. Save confirmation: Check for text containing updated after save.
5. Save and calculate vs Save: Financial sections use Save and calculate. Match with t.startsWith to handle both.
6. New tab overhead: ctx.new_page creates tabs that need full SPA load. Use pages[0].
7. Too many open tabs degrade CDP: Clean up with JSON close API before each script run.
8. **Always `await` evaluate calls in async scripts**: The helper functions (fill_input, click_button, save_section) return coroutines when they use `page.evaluate()`. Calling them without `await` produces RuntimeWarnings and the evaluate NEVER RUNS — the save button clicks empty React state. Pattern:
```python
# ❌ WRONG — coroutine never awaited, field not filled
fill_input(page, "name", "BMW X5")  # RuntimeWarning, data lost

# ✅ CORRECT
await fill_input(page, "name", "BMW X5")
```
9. **CfT tab creation via CDP JSON API uses PUT, not GET**: `curl -X PUT "http://localhost:9222/json/new?url"` — GET returns "Using unsafe HTTP verb GET" error. Patchright's `connect_over_cdp` + `ctx.new_page()` also fails with "Browser context management is not supported" for CfT profiles. Use `curl -X PUT` to create a fresh tab, then reconnect Patchright.
