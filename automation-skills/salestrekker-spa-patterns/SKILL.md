---
name: salestrekker-spa-patterns
description: "Discovered interaction patterns for Salestrekker React SPA automation — section navigation, asset/liability add flows, SPA navigation constraints, and vision-for-discovery workflow."
category: engineering
---

# Salestrekker SPA Interaction Patterns

## SPA Navigation Constraint

Salestrekker's React SPA aggressively signs out on any `page.goto()` to a deep SPA URL. Only `/auth/sign-in` and `/dashboard` survive `page.goto()`.

**Workaround:** Use `page.evaluate()` with `window.location.href`:

```python
# WRONG — triggers sign-out:
page.goto("https://pc.v2.salestrekker.com/deals/view/{id}/{cid}")

# RIGHT — navigates within SPA:
page.evaluate(f"window.location.href = '/deals/view/{id}/{cid}'")
time.sleep(6)
```

## page.evaluate() Syntax — Single Array Rule (26 Jul 2026)

`page.evaluate()` takes at most ONE optional argument after the expression. For multi-value functions:

```python
# ✅ CORRECT — single array, destructured in the function body
page.evaluate("([a,b])=>{const u=a; const p=b; ...}", [USER, PASS])
page.evaluate("([leg,val])=>{const[t,v]=args; ...}", [legend, value])

# ❌ FAILS — TypeError: Page.evaluate() takes 2-3 positional arguments
page.evaluate("(a,b)=>{...}", a, b)

# ❌ FAILS — SyntaxError in this Playwright/Patchright version
page.evaluate("({a,b})=>{...}", {a: a, b: b})
```

This applies to both Playwright AND Patchright (same API).

## Section Navigation via URL (NOT `a._U0`)

The home loan editor sections are NOT accessed via `a._U0` links. Use SPA URL navigation:

```python
DEAL_BASE = f"/deals/home-loan/{DEAL_ID}/{CONTACT_ID}"
SECTION_URLS = {
    "Assets": f"{DEAL_BASE}/assets",
    "Liabilities": f"{DEAL_BASE}/liabilities",
    "Income": f"{DEAL_BASE}/income",
    "Expenses": f"{DEAL_BASE}/expenses",
    "Needs and objectives": f"{DEAL_BASE}/needs-and-objectives",
    "Product requirements": f"{DEAL_BASE}/product-requirements",
    "Insurance": f"{DEAL_BASE}/insurance",
    "Other advisers": f"{DEAL_BASE}/other-advisers",
    "Security details": f"{DEAL_BASE}/security-details",
    "Funding worksheet": f"{DEAL_BASE}/funding-worksheet",
    "Product search": f"{DEAL_BASE}/products-search",
    "Compare products": f"{DEAL_BASE}/compare-products",
    "Commissions": f"{DEAL_BASE}/commissions",
    "Compliance comments": f"{DEAL_BASE}/compliance-comments-and-documents",
    "Summary": f"{DEAL_BASE}/summary",
}
```

**Home loan tab must be expanded FIRST** before section URLs work:

```python
page.evaluate("""() => {
    var tabs = document.querySelectorAll('[role=tab]');
    for(var t of tabs) {
        if(t.textContent.includes('Home loan')) { t.click(); return; }
    }
}""")
time.sleep(3)
```

## Deal View Initialization

Always: deal view URL → expand Home loan tab → navigate to section URL.

## Add Asset/Liability Flow  

1. Click "Add asset" → menu appears with asset types as `<button role="menuitem">`  
2. Select vehicle, home content, or bank account → form fields appear  

```python  
click_button(page, "Add asset")  
time.sleep(2)  
click_menuitem(page, "Vehicles make and model")  
```  

Vehicle fields: `name`, `vehicleBuildDate` (MM/YYYY), `value` ($), `vehicleRegoNumber`  

## Add Current Employment — Nested Menu Pattern (26 Jul 2026)  

This section uses a 3-level nested menu, not inline expansion:  

```text  
Click "Add current employment"  
  → Dropdown: Salaried employee / Self employed / Retired / Unemployed  
    → Click "Salaried employee"  
      → Sub-dropdown: Add new company / Add existing company  
        → Click "Add new company"  
          → MODAL opens with fields: Entity name, Type of business, ABN, Email  
            → Click "Add" in modal → modal closes  
              → Employment form renders inline  
```  

**Each level requires a separate click.** CDP evaluate clicks work (via Patchright).  

Employment form inline fields (after modal):  
- Occupation (text input, positional)  
- Start date (DD/MM/YYYY date input)  
- Employment priority / Employment basis (combobox)  
- ABN / Employer ACN (text)  
- ANZSCO / ANZSIC code (combobox)  
- Employer name (pre-filled from modal "Wealth Wages")  
- Employer type (combobox)  



Financial sections use "Save and calculate" instead of "Save":

```python
if ((t === 'Save' || t.startsWith('Save')) && b.offsetParent) { b.click(); }
```

## Radix Popovers — CDP Input.dispatchMouseEvent (NOT JS evaluate)

Radix/Floating UI popovers (Add contact, Add asset menus) **do not respond** to `page.evaluate()` JS `.click()`, `MouseEvents`, or `__reactProps.onClick()`. Only CDP `Input.dispatchMouseEvent` works:

```python
# Find the aria-haspopup parent of the trigger button
box = page.evaluate("""() => {
    var btns = document.querySelectorAll('button');
    for(var b of btns) {
        if(b.textContent.trim() === 'Add contact' && b.offsetParent) {
            var p = b.parentElement;
            while(p) {
                if(p.getAttribute('aria-haspopup') === 'menu') {
                    var r = p.getBoundingClientRect();
                    return {x: r.x + r.width/2, y: r.y + r.height/2};
                }
                p = p.parentElement;
            }
        }
    }
    return null;
}""")

cdp = page.context.new_cdp_session(page)
cdp.send('Input.dispatchMouseEvent', {'type': 'mousePressed', 'x': box['x'], 'y': box['y'], 'button': 'left', 'clickCount': 1})
time.sleep(0.05)
cdp.send('Input.dispatchMouseEvent', {'type': 'mouseReleased', 'x': box['x'], 'y': box['y'], 'button': 'left', 'clickCount': 1})
time.sleep(2)
```

After popup opens, menu items `[role="menuitem"]` CAN be clicked via `page.evaluate()`.

## Add Existing Person (contacts already in Salestrekker) — CONFIRMED WORKING

Sam and Amy Smith are already in the contact database from previous tests. Always use "Add existing person" instead of "Add new person":

**The full sequence works.** The dialog's Add button IS clickable via `page.evaluate`. The dialog DOM element persists visually hidden after the contact is added — check `offsetParent === null` not `!== null` to detect closure.

Working pattern:
```python
# 1. Open Radix popup via CDP mouse event
cdp = page.context.new_cdp_session(page)
box = page.evaluate("""() => {
    for(var b of document.querySelectorAll('button')) {
        if(b.textContent.trim() === 'Add contact' && b.offsetParent) {
            var el = b.parentElement;
            while(el) {
                if(el.getAttribute('aria-haspopup') === 'menu') {
                    var r = el.getBoundingClientRect();
                    return {x: r.x + r.width/2, y: r.y + r.height/2};
                }
                el = el.parentElement;
            }
        }
    }
    return null;
}""")
cdp.send('Input.dispatchMouseEvent', {'type': 'mousePressed', 'x': box['x'], 'y': box['y'], 'button': 'left', 'clickCount': 1})
cdp.send('Input.dispatchMouseEvent', {'type': 'mouseReleased', 'x': box['x'], 'y': box['y'], 'button': 'left', 'clickCount': 1})
time.sleep(2)

# 2. Click "Add existing person" via evaluate
page.evaluate("""() => {
    for(var i of document.querySelectorAll('[role="menuitem"]')) {
        if(i.textContent.trim() === 'Add existing person' && i.offsetParent) { i.click(); return; }
    }
}""")
time.sleep(2)

# 3. Type in search field
page.locator('input[name="query"]').last.focus()
page.locator('input[name="query"]').last.type('Sam Smith', delay=5)
time.sleep(3)

# 4. Select result via keyboard (Radix accessibility handler)
page.keyboard.press('ArrowDown')
time.sleep(0.3)
page.keyboard.press('ArrowDown')
time.sleep(0.3)
page.keyboard.press('Enter')
time.sleep(2)

# 5. Click Add button via evaluate (works when button is enabled after selection)
page.evaluate("""() => {
    for(var b of document.querySelectorAll('button')) {
        if(b.textContent.trim() === 'Add' && !b.disabled) { b.click(); return; }
    }
}""")
time.sleep(4)

# 6. Verify — check for contact on page, NOT dialog DOM presence
contact_added = page.evaluate("""() => {
    return document.body.innerText.includes('SAM SMITH');
}""")
```

```python
# 1. Open Radix popup via CDP mouse event (see Radix Popovers section)
# 2. Click "Add existing person"
page.evaluate("""() => {
    for(var i of document.querySelectorAll('[role="menuitem"]')) {
        if(i.textContent.trim() === 'Add existing person' && i.offsetParent) {
            i.click(); return;
        }
    }
}""")
time.sleep(2)

# 3. Type in the search field
searches = page.locator('input[name="query"]')
for i in range(searches.count()):
    if not searches.nth(i).input_value() and searches.nth(i).is_visible():
        searches.nth(i).type('Sam Smith', delay=5)
        break
time.sleep(3)
```

**⚠️ KNOWN BLOCKER (27 Jul 2026): The "Add existing person" Radix dialog Add button cannot be triggered via automation.** Contact search results render as `[role="option"]` inside a Radix portal. Keyboard-driven selection (ArrowDown + ArrowDown + Enter) successfully enables the Add button (disabled=false), but ALL approaches fail to trigger the Add button's React handler:
- CDP Input.dispatchMouseEvent on button — click lands but React ignores
- page.evaluate `element.click()` — ignored by React synthetic event system
- Keyboard Tab to button + Enter/Space — focus trap never reaches the Add button
- CUA AXPress — click appears to land but dialog stays open
- `document.createEvent('MouseEvents')` — ignored

**Workaround: Use "Add new person" instead.** The "Add new person" form (accessible via the same CDP mouse event on the menu item) shows a standard HTML form with `input[name="firstName"]` and `input[name="lastName"]` fields that CAN be filled via `locator.type()`. The Add button in this form has the same Radix resistance though — so this is a partial workaround only.

The native setter pattern (`Object.getOwnPropertyDescriptor(...).set` + `dispatchEvent`) fills visually but does NOT trigger React form validation or persistence.

## SPA State Detection

Check page TITLE (not just URL) — SPA may redirect without updating URL:

```python
def check_page_state(page) -> str:
    title = page.title().lower(); url = page.url.lower()
    if 'dashboard' in title or 'deals' in title or 'board' in title or '/deals/' in url:
        return 'dashboard'
    if 'two-factor' in title or 'totp' in title:
        return 'totp'
    if 'sign-in' in url or 'sign in' in title:
        return 'signin'
    return 'unknown'
```

## Add Deal Form Field Names

| Field | Selector | Notes |
|-------|----------|-------|
| Title | `input[name="name"]` | Required |
| Value | `input[name="value.total"]` | NOT aria-label="Value" |
| Lead source | `[role="combobox"]` containing "Select one" | Click open, select `[role="option"]` |

## CRITICAL: Verify Data Persistence

After Save, reload the section and check field values before confirming success.

## Asset Editor Fields

Vehicle: `name`, `vehicleBuildDate`, `value`, `vehicleRegoNumber`
Home Contents: `name`, `value`
Bank Account: `name`, `bankName`, `bankBSB`, `bankAccountNumber`, `value`

## Key Pitfalls

- **Wrong deal**: Double-check DEAL_ID/CONTACT_ID before data entry
- **Title/name duplication**: Check field empty before typing
- **Value field**: `name="value.total"` not `name="value"`
- **Save vs Save and calculate**: Financial sections use "Save and calculate"
- **TOTP 30s window**: Generate just before use

## Vision-for-Discovery, Script-for-Runtime

Use CUA vision ONCE during process development, then freeze into a
deterministic script. No vision at runtime.

1. **Discover** — CUA capture to see layout and clickable elements
2. **Build** — Deterministic Playwright CDP + page.evaluate() script
3. **Run** — Script runs blind, zero tokens per run
4. **Fix** — If script breaks, use vision to diagnose and patch

## Expense Section — Add and Fill

Expenses require selecting the applicant BEFORE clicking "Add expense". The applicant selector is NOT a form field — it is a checkbox/list element on the page.

Sequence:
1. User must click the applicant's checkbox/label (cannot be automated via AppleScript JS injection)
2. Click **"Add expense"** → dropdown shows **"Add"**
3. Click **"Add"** → form fields appear:
   - `value` — amount ($)
   - `monthly` — auto-calculated from value + frequency  
   - `percent` — ownership percentage
   - `comment` — free text
4. Fill via native setter: `ns.call(el, 'amount')` + dispatchEvent('input') + dispatchEvent('change')
5. Click "Save and calculate" to persist

**Critical:** If you skip step 1, "Add expense" will show an empty dropdown or "Add" that creates nothing. The user must select the applicant first.

Data: Groceries $1,170/mth ($270/wk equivalent), Clothing $200/mth, Phone $110/mth.

## Insurance Section — Add and Fill

1. Click **"Insurance"** in sidebar
2. Click **"Add insurance"** → type selection opens
3. Select **"Income protection"** from dropdown button options
4. Fields appear:
   - `name` — provider (e.g. "Youi")
   - `policyNumber` — policy #
   - `value` — insured amount ($250,000)
   - `premium` — monthly premium ($90)
5. Save via **"Save"** button in Insurance section (not "Save and calculate")

## Needs & Objectives — Purpose Section Add Button (26 Jul 2026)

The Purpose section has a **two-level expand** pattern:

1. **Level 1:** Click the toggle button next to "REQUIREMENTS AND OBJECTIVES" heading to reveal the section (button at (1444, 775, 28, 28))
2. **Level 2:** Click the **`dangerFill` button** (plus-icon SVG, class `_gJ _lJ lg _HJ dangerFill`) — opens a Radix dropdown menu with purpose type options
3. **Select** the purpose type from `[role="menuitem"]` list
4. **Fill** the resulting fields

```python
# Expand REQUIREMENTS section
page.evaluate("""() => {
    for (const b of document.querySelectorAll('button')) {
        const p = b.closest('div');
        if (p && p.textContent.includes('REQUIREMENTS') && b.offsetParent) { b.click(); break; }
    }
}""")
time.sleep(1.5)

# Click the + Add button (dangerFill)
page.evaluate("""() => {
    for (const b of document.querySelectorAll('button')) {
        if ((b.className||'').includes('dangerFill') && b.offsetParent) {
            b.click();
            const e = document.createEvent('MouseEvents');
            e.initEvent('click', true, true);
            b.dispatchEvent(e);
            break;
        }
    }
}""")
time.sleep(1.5)

# Select "Purchase property" from Radix dropdown
page.evaluate("""() => {
    const items = document.querySelectorAll('[role="menuitem"]');
    for (const item of items) {
        if ((item.textContent||'').trim() === 'Purchase property') { item.click(); break; }
    }
}""")
time.sleep(1.5)

# Fill fields
page.evaluate("""() => {
    const c = document.querySelector('textarea[name*="purposeDetails"][name*="comments"]');
    if (c) { c.value = 'Purchase details here'; c.dispatchEvent(new Event('input',{bubbles:true})); }
    const a = document.querySelector('input[name*="purposeDetails"][name*="amount"]');
    if (a) { a.value = '640000'; a.dispatchEvent(new Event('input',{bubbles:true})); a.dispatchEvent(new Event('change',{bubbles:true})); }
}""")
```

**Menu options:** `Purchase property`, `Construction`, `Renovations`, `Investment purchase`.

**Field names:** `needsAndObjectives.requirementsAndObjectives.purposeDetails[0].comments` (textarea), `needsAndObjectives.requirementsAndObjectives.purposeDetails[0].amount` (input).

**Critical:** CDP evaluate click + createEvent('MouseEvents') is REQUIRED. `page.mouse.click()` at the same coordinates does NOT trigger the Radix menu. The `page.mouse.click()` can expand Level 1 (the accordion toggle) but Level 2 (the + button) requires evaluate events.

## Needs and Objectives — Textarea Pattern

Uses `<textarea>` elements (not `<input>`). The native setter pattern for HTMLInputElement does NOT work here:

```javascript
// Direct value assignment works for textarea
el.value = 'Your text here';
el.dispatchEvent(new Event('input', {bubbles: true}));
```

Fields: `reasonForSeekingCredit`, `immediateNeedsAndObjectives`, `longerTerm`.

## React Radio Button Fix — Disabled Inputs + Legacy MouseEvents (26 Jul 2026)

Some React radio groups in Product Requirements **do not respond** to `element.click()`, `new MouseEvent('click')`, or CDP evaluate clicks. Two issues:
1. The input has `disabled=""` attribute (blocks all click events)
2. The React handler checks `isTrusted` on the event

The ONLY pattern that works for ALL radio groups:

```python
def click_radio_by_legend(page, legend_text, value):
    return page.evaluate('''(args)=>{
        const[t,v]=args;
        const all=document.querySelectorAll('fieldset');
        for(const f of all){
            const l=f.querySelector('legend');
            if(l&&l.textContent.trim()===t){
                const rs=f.querySelectorAll('input[type="radio"]');
                for(const r of rs){
                    if(r.value===v){
                        // CRITICAL: disabled inputs block ALL events
                        r.removeAttribute('disabled');
                        r.checked = true;
                        r.click();
                        const evt=document.createEvent('MouseEvents');
                        evt.initEvent('click',true,true);
                        r.dispatchEvent(evt);
                        return 'ok '+t;
                    }
                }
            }
        }
        return 'nf '+t;
    }''', [legend_text, value])
```

Without the legacy `document.createEvent('MouseEvents')` step, the radio appears selected visually but `input.checked` remains `false` and the value does NOT persist on Save.

Without `r.removeAttribute('disabled')`, ALL click events are silently swallowed.

**`lenderPolicy` server limitation**: Even with the correct click pattern, `most_important` is rejected server-side for this specific field. Use `somewhat_important`. See `references/salestrekker-product-requirements-field-map.md` for details.

## Textarea Fill — Different Prototype!

Textareas use `HTMLTextAreaElement.prototype.value` NOT `HTMLInputElement.prototype.value`:
```python
page.evaluate("""()=>{
    const ta=document.querySelectorAll('textarea');
    for(const t of ta){
        const n=t.getAttribute('name')||'';
        if(n.includes('lowestOverallLoanCostComments')){
            const s=Object.getOwnPropertyDescriptor(
                window.HTMLTextAreaElement.prototype,'value'
            ).set;
            s.call(t,'Your text here');
            t.dispatchEvent(new Event('input',{bubbles:true}));
            t.dispatchEvent(new Event('change',{bubbles:true}));
        }
    }
}""")
```

## Evaluate Args — Single Array Rule

`page.evaluate()` takes at most ONE argument after the expression. For multi-value functions:

```python
# ✅ CORRECT — single array, destructured in function body
page.evaluate("([a,b])=>{const u=a; const p=b; ...}", [USER, PASS])
page.evaluate("([leg,val])=>{const[t,v]=leg,val; ...}", [legend, value])

# ❌ FAILS — TypeError: takes 2-3 positional args
page.evaluate("(a,b)=>{...}", a, b)

# ❌ FAILS — SyntaxError in this Playwright/Patchright version
page.evaluate("({a,b})=>{...}", {a: a, b: b})
```

## Years/Months Comboboxes — Locator + Keyboard Approach

Custom React comboboxes (`div[role="combobox"]`, no native `<select>` element).
CUA `set_value` does NOT persist for these. Use Patchright locator + keyboard:

```python
# Open Years combobox
page.locator('#productRequirements\\.termOfCreditSought\\.years').click()
time.sleep(0.5)

# Navigate: Home goes to top (40 years), ArrowDown 10x reaches 30 years
page.keyboard.press('Home')
time.sleep(0.2)
for _ in range(10):
    page.keyboard.press('ArrowDown')
    time.sleep(0.03)
page.keyboard.press('Enter')
time.sleep(0.5)

# Verify
val = page.evaluate("()=>document.getElementById('productRequirements.termOfCreditSought.years')?.textContent?.trim()")
print('Years:', val)  # '30 years'
```

Years combobox ID: `productRequirements.termOfCreditSought.years`
Months combobox ID: `productRequirements.termOfCreditSought.months`
Month options: 1-11 months (no "0 months" option — 0 is implied by not selecting).

## Product Requirements Text Fields — Prototype Distinction

Product Requirements uses BOTH `HTMLInputElement` AND `HTMLTextAreaElement` prototypes.
Using the wrong prototype silently fails (field appears filled but Save doesn't persist).

**`HTMLInputElement.prototype.value`** (for `<input>` elements):
- `productRequirements.termOfCreditSought.preferredLenders` — fill with "ANZ, CBA, NAB"
- `productRequirements.termOfCreditSought.notLenders` — fill with "None"

**`HTMLTextAreaElement.prototype.value`** (for `<textarea>` elements):
- `productRequirements.whatIsImportantForYou.lowestOverallLoanCostComments`
- `productRequirements.otherRequirements`

```python
# Textarea fill (correct prototype)
page.evaluate("""()=>{
    const ta=document.querySelectorAll('textarea');
    for(const t of ta){
        const n=t.getAttribute('name')||'';
        if(n.includes('lowestOverallLoanCostComments')){
            const s=Object.getOwnPropertyDescriptor(
                window.HTMLTextAreaElement.prototype,'value'
            ).set;
            s.call(t,'Keeping monthly repayments affordable and minimising total interest paid');
            t.dispatchEvent(new Event('input',{bubbles:true}));
            t.dispatchEvent(new Event('change',{bubbles:true}));
        }
    }
}""")
```

## Product Requirements — Radio Button Legend Table

Radio groups via `fieldset > legend` matching. Use the `click_radio_by_legend()` helper from the React Radio Button Fix section above for stubborn groups.

Value mapping (input[type="radio"] value attribute):
| Legend text | Value options | Selected |
|---|---|---|
| Fixed rate | `important`, `not_important`, `do_not_want` | `do_not_want` |
| Variable rate | `important`, `not_important`, `do_not_want` | `important` |
| Fixed and variable rate | `important`, `not_important`, `do_not_want` | `do_not_want` |
| Principal and interest | `important`, `not_important`, `do_not_want` | `important` |
| Interest only | `important`, `not_important`, `do_not_want` | `do_not_want` |
| Interest in advance | `important`, `not_important`, `do_not_want` | `do_not_want` |
| Line of credit | `important`, `not_important`, `do_not_want` | `do_not_want` |
| Offset account | `important`, `not_important`, `do_not_want` | `important` |
| Redraw | `important`, `not_important`, `do_not_want` | `important` |
| Indicate preferred repayment frequency | `daily`, `weekly`, `fortnightly`, `monthly`, `quarterly`, `semiannually`, `annually` | `monthly` |
| Lowest overall loan cost | `most_important`, `somewhat_important`, `least_important` | `most_important` |
| Loan approved quickly | `most_important`, `somewhat_important`, `least_important` | `somewhat_important` |
| Specific loan features | `most_important`, `somewhat_important`, `least_important` | `least_important` |
| Lender policy/borrowing capacity | `most_important`, `somewhat_important`, `least_important` | `somewhat_important` ⚠️ |
| How often do you go to a branch? | `all_the_time`, `sometimes`, `rarely` | `rarely` |
| How often do you use internet banking? | `all_the_time`, `sometimes`, `rarely` | `all_the_time` |

See `references/salestrekker-product-requirements-field-map.md` for the full field reference with Python helpers.

Page URL: `/deals/home-loan/{D}/{C}/product-requirements`  

## Asset/Liability Fields Map (Field Names)

See `references/salestrekker-2-field-map.md` for the complete name-attribute map.

## Funding Worksheet — Calculate and Save

Key fields (all `<input>` with name attributes):
- `proposedLoanAmount` — loan amount ($640,000)
- `savings` — available savings ($350,000)
- `stampDuty` — stamp duty (~$33,000 for $800K in NSW)
- `lenderFees` — lender fees ($500)
- `legalFees` — legal fees ($1,500)
- `propertyRunningCosts` — running costs

After filling, click **"Save and calculate"** to run servicing.

## Expense Section — Applicant Selection First

Expenses require selecting the applicant BEFORE clicking "Add expense". The applicant selector is NOT a form field — it is a checkbox/list element on the page.

Sequence:
1. User must click the applicant's checkbox/label (cannot be automated via AppleScript JS injection)
2. Click **"Add expense"** → dropdown shows **"Add"**
3. Click **"Add"** → form fields appear: `value` (amount), `monthly` (auto-calc), `percent` (ownership), `comment` (free text)
4. Fill via native setter: `ns.call(el, 'amount')` + dispatchEvent('input') + dispatchEvent('change')
5. Click "Save and calculate" to persist

**Critical:** If you skip step 1, "Add expense" will show an empty dropdown or "Add" that creates nothing. The user must select the applicant first.

## Key Pitfalls (Learned Hard Way)

- **DOM value lost data.** Setting a field value via JS injection and clicking "Save" does NOT guarantee the data was persisted to the server. React may have ignored the change. ALWAYS verify by navigating away and back to check if the value survived a page reload.
- **Do NOT claim data was saved until you verify.** If you set fields and clicked Save but the user later says the data isn't there, you hallucinated success. React may have accepted the click but not the data. Verify from the server side (reload the page and check the field) before reporting success.
- **Stop-and-switch protocol**: After 1-2 identical attempts with the same tool/approach, do NOT retry a third time. Switch to a different tier: T0 (CDP evaluate) -> T1 (browser_console/Chrome MCP) -> T2 (browser-act) -> T3 (Qwen3 VL) -> T4 (CUA). 3+ same-approach failures = spinning. Log which tier was tried and why it failed before switching. Warren gets frustrated when you repeat the same failing approach.
- **Auto-fix errors on sight**: When you see incorrect data on screen (wrong value, $8M instead of $800K, missing fields), fix it immediately. Do NOT ask the user for permission on obvious fixes — they expect you to notice and fix automatically.
- **Dialog closure detection**: The Add dialog's DOM element persists visually hidden after the contact is added. Check `offsetParent === null` (not `!== null`). Use `document.body.innerText.includes('SAM SMITH')` for reliable verification.\n- **Keyboard-driven Radix selection**: ArrowDown+Enter selects the combobox result. The subsequent evaluate.click() on the enabled "Add" button DOES work — the contact is added even though the dialog DOM element remains.
- **Value field $8M bug**: Typing "800000" via `locator.type()` in the Add deal form shows "$8,000,000" because the currency input's React formatter misinterprets keystrokes. Fix: use the evaluate native setter pattern:
  ```python
  page.evaluate("""() => {
      var i = document.querySelector('input[name="value.total"]');
      if(i) {
          var s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
          s.call(i, '800000');
          i.dispatchEvent(new Event('input', {bubbles:true}));
          i.dispatchEvent(new Event('change', {bubbles:true}));
      }
  }""")
  ```
  Note: `browser_type` via browser-act (Tier 2) correctly formats "$800,000" — escalate to browser-act when CDP formatting is wrong.
- **Fresh start per run**: Navigate explicitly before each script run. Don't assume the page is on a specific URL from a previous attempt.
- **Dialog closure detection**: The Add dialog's DOM element persists visually hidden after the contact is added. Check `offsetParent === null` (not `!== null`). Use `document.body.innerText.includes('SAM SMITH')` for reliable verification.\n- **Keyboard-driven Radix selection**: ArrowDown+Enter selects the combobox result. The subsequent evaluate.click() on the enabled "Add" button DOES close the dialog and add the contact — this is not a blocker. The previous "KNOWN BLOCKER" claim was incorrect: the dialog DOM element persists hidden but the contact IS added.\n
- **Wrong deal**: Double-check DEAL_ID/CONTACT_ID before data entry. Previously filled the old TEST-Smith deal instead of Test 4 — always confirm deal name on the board matches Test N.
- **Title/name duplication**: Contact names showing "SamSam SmithSmith" means data was filled twice (from adding contact while form already had one from a previous run).
- **"Add current employment"** uses a 3-level nested menu: click → type → Add new company (MODAL, not inline).
- **Currency formatting**: Value fields display "$ 0" as default. The native setter sends raw number and React formats it.
- **Don't hallucinate data entry success**: If the field value doesn't change in the DOM after your dispatchEvent, React didn't register it.
- **CUA session expiry**: Dead sessions silently reject tool calls. Check `capture` output — if it fails, isdue `cua-driver call start_session` first. CfT CDP session is persistent.
- **Disabled radio inputs block all events**: Some React radio groups (esp. "What is important for you" section) set `disabled=""` on unselected inputs. `r.click()` silently fails on disabled elements. Always call `r.removeAttribute('disabled')` before the click-and-dispatch sequence.
- **`lenderPolicy: most_important` is SERVER-REJECTED**: The Salestrekker API accepts `{"lenderPolicy":"most_important"}` with HTTP 200 but silently discards the value. `somewhat_important` and `least_important` persist correctly. Use `somewhat_important` as the max value for this field. The `danger` CSS class on the fieldset wrapper indicates this is a server-side business rule, not a client automation issue.
- **React radio CSS class semantics**: `_w0` = selected/persisted, `_x0` = not selected, `_YZ` = temporary visual highlight (client-side optimistic state, not persisted). A `_YZ` class on reload means the value was NOT saved despite the UI appearing to show it.

## Linked Resources

- `references/actioning-ready-tasks.md` — Direct execution protocol for kanban ready tasks (not automation pipelines)
- `references/salestrekker-2-field-map.md` — Complete name-attribute map for all form sections (personal, assets, liabilities, income, expenses, funding)
- `references/salestrekker-product-requirements-field-map.md` — Product Requirements field names, radio button value table, and Python helper functions

