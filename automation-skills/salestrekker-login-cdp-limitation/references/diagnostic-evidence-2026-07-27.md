# Diagnostic Evidence — 27 Jul 2026 (v2, corrected)

## Root Cause Correction

The original v1 of this file documented CDP methods as "silently rejected"
by isTrusted checks. This was WRONG. The actual root cause:

**The "Sign in" button renders with `[disabled]` in the DOM.**
CDP evaluate native setter (`Object.getOwnPropertyDescriptor(...).set` +
`dispatchEvent`) does NOT trigger React's form validation. React checks
for real keyboard events (`input`, `change` with isTrusted=true) to
validate the form and remove `disabled`. Since the button stays disabled,
any click is silently ignored — event handlers on disabled buttons don't fire.

## CfT & Environment

```
CfT: Google Chrome for Testing v151.0.7922.47
CDP: --remote-debugging-port=9222
Profile: 8um7547w (persistent, saves credentials after first login)
```

## Key Discovery Sequence

### Step 1: Found button was DISABLED

Using browser-act tools (Tier 2), the snapshot showed:
```
button "Sign in" [disabled, ref=e9]
```

This confirmed the button was NOT clickable. All prior CDP methods were
trying to click a disabled button — React's event handler never fired.

### Step 2: browser-act type() triggered React validation

```python
browser_type(email_field, "connect@afirmico.com")
browser_type(password_field, "...")
```

After typing, snapshot showed:
```
button "Sign in" [ref=e9]
```
No more `[disabled]`. The button was now clickable.

### Step 3: browser-act click() worked

```python
browser_click(ref=e9)
```
→ Navigated to TOTP page successfully.

### Step 4: Translated to CDP: locator().type() + locator().click()

```python
page.locator('input[type="email"]').first.type(USER, delay=20)
page.locator('input[type="password"]').first.type(PASS, delay=20)
page.locator('button:has-text("Sign in")').first.click()
time.sleep(8)
```
→ TOTP page reached. Page title changed to "2F authentication | Salestrekker"
   even though URL stayed at `/auth/sign-in`.

### Step 5: TOTP via keyboard.type()

```python
page.locator('input').first.focus()
page.keyboard.type(code, delay=60)
page.keyboard.press('Enter')
time.sleep(8)
```
→ Dashboard reached. Title: "Dashboard: Sales | Afirmico | Salestrekker".

## CfT Profile Auto-Fill

After first successful login, CfT's profile saves credentials. On subsequent
page.goto to sign-in, email and password are pre-filled and the Sign in
button is already enabled. Double-filling causes failures — always check:

```python
email_val = page.evaluate(
    "() => document.querySelector('input[type=\"email\"]')?.value || ''")
if not email_val:
    # Type credentials
```

## Title vs URL for State Detection

After CDP login (locator.click + keyboard.type), the URL may NOT update
to the TOTP page URL. Check page TITLE instead:
- Sign-in: `"Sign in | Salestrekster"`
- TOTP: `"2F authentication | Salestrekker"`
- Dashboard: `"Dashboard: Sales | Afirmico | Salestrekker"`

## Data Entry Persistence

CDP evaluate native setter for field filling does NOT consistently trigger
React persistence. Verified through post-save reload testing:

| Method | Persists? | Notes |
|--------|-----------|-------|
| evaluate native setter | Inconsistent | Works for some sections (Assets, Funding) but not others (Liabilities, Insurance) |
| locator().type() | ✅ Yes | Real keyboard events trigger React onChange |
| locator().click() for Save | ✅ Yes | CDP mouse event triggers React handlers |

Fix: use `locator().type()` for ALL field fills, not evaluate native setter.

## Incorrect Claims from v1

The following claims from v1 are INCORRECT and should be ignored:
- "CDP-initiated form submissions are silently rejected" — FALSE. The button
  was disabled so no submission was attempted.
- "React handler checks event.isTrusted" — UNCONFIRMED. The button was disabled
  so the handler never ran.
- "CUA-driver hybrid is the ONLY working pattern" — FALSE. CDP locator.type +
  locator.click works reliably.
