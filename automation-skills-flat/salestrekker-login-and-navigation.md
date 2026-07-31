---
name: salestrekker-login-and-navigation
description: >-
  Login, SPA navigation, and React interaction patterns for Salestrekker 2.0.
  Covers hybrid auth flow, Radix/Floating UI popovers, and URL-based section
  navigation for the home loan editor.
tags: [salestrekker, login, react, spa, navigation, radix, popover, auth]
related_skills:
  - four-tier-sensory-test
  - salestrekker-react-automation
  - salestrekker-spa-patterns
  - salestrekker-react-form-entry
  - react-spa-automation-hybrid
---

# Salestrekker Login & Navigation Patterns

## ⚠️ HARD RULE: Login Diagnostics Are NOT Free

Every script that navigates to sign-in, fills credentials, and clicks Submit counts as a **login attempt** against the 2-max cap. This includes diagnostic scripts — they are NOT free reads.

**Login diagnostics must be READ-ONLY:**
- `page.evaluate()` to read values and check button state (never fill/submit)
- Check `page.title()` for TOTP/dashboard detection
- CUA capture for OS-level screenshot (no side effects, no attempt counted)

## Login Flow (Proven, 27 Jul 2026)

```
1. page.goto('https://pc.v2.salestrekker.com/auth/sign-in')
2. Wait 5s for React mount
3. Check page TITLE (not URL): 'two-factor' → TOTP, 'dashboard' → auth'd
4. CfT profile auto-fills credentials — check input values, DO NOT refill
5. If not auto-filled: page.locator('input[type="email"]').first.type() credentials
   - type() sends real keyboard events → React validates → Sign in button enables
   - CDP evaluate native setter DOES NOT trigger React form validation
6. Click Sign in: page.locator('button:has-text("Sign in")').first.click()
   - locator.click() sends real CDP mouse event → React recognizes it
   - page.evaluate .click() does NOT work — React ignores synthetic events
7. Wait 8s, check page.title() for redirect
8. TOTP: page.locator('input').first.focus() → keyboard.type(code, delay=60) → press Enter
   - TOTP has 6 separate <input> fields — keyboard.type fills all 6 sequentially
```

## Radix/Floating UI Popover Pattern

Buttons wrapped in Radix/Floating UI popovers (Add contact, Add asset, etc.) do NOT respond to `button.click()`, `locator.click()`, OR `page.evaluate()` with native `.click()` + `createEvent('MouseEvents')`.

**Root cause:** Radix intercepts browser-level input events (mousedown/mouseup/click dispatched by the OS/Chrome), not JS-level events. `page.evaluate().click()` and `createEvent('MouseEvents')` are both JS-synthetic and ignored.

**Fix (two approaches):**

### Approach A: CDP Input.dispatchMouseEvent (PREFERRED, 27 Jul 2026)

Send a real browser-level mouse event via CDP, which Radix recognizes:

```python
box = page.evaluate("""() => {
    var btn = Array.from(document.querySelectorAll('button'))
        .find(b => b.textContent.trim() === 'Add contact' && b.offsetParent);
    if (!btn) return null;
    var parent = btn.closest('[aria-haspopup]') || btn.parentElement;
    var rect = parent.getBoundingClientRect();
    return {x: rect.x + rect.width / 2, y: rect.y + rect.height / 2};
}""")

cdp = page.context.new_cdp_session(page)
cdp.send('Input.dispatchMouseEvent', {
    'type': 'mousePressed', 'x': box['x'], 'y': box['y'],
    'button': 'left', 'clickCount': 1
})
cdp.send('Input.dispatchMouseEvent', {
    'type': 'mouseReleased', 'x': box['x'], 'y': box['y'],
    'button': 'left', 'clickCount': 1
})
time.sleep(2)

# Menu items now visible — click via evaluate
page.evaluate("""() => {
    var items = document.querySelectorAll('[role="menuitem"]');
    for(var i of items) {
        if(i.textContent.trim() === 'Add new person') { i.click(); return; }
    }
}""")
```

### Approach B: Click aria-haspopup parent div (LEGACY, may not work)

```javascript
var div = document.querySelector('div[aria-haspopup="menu"]');
div.click();
var evt = document.createEvent('MouseEvents');
evt.initEvent('click', true, true);
div.dispatchEvent(evt);
```

**Note:** Approach B works for **some** Radix popups but not the "Add contact" popup on the deal creation form. When B fails, escalate to A.

## SPA Section Navigation (Home Loan Editor)

The home loan editor sections are accessible via direct URL navigation:

```
/deals/home-loan/{deal_id}/{contact_id}/{section-name}
```

Available section names:
- `applicant-1`, `applicant-2`, `applicant-3` — client profiles
- `assets` — assets section
- `liabilities` — liabilities section
- `income` — income section
- `expenses` — expenses section
- `needs-and-objectives` — needs and objectives
- `product-requirements` — product requirements
- `insurance` — insurance section
- `other-advisers` — other advisers
- `security-details` — security details
- `funding-worksheet` — funding worksheet
- `products-search` — product search (cannot be automated)
- `compare-products` — compare products
- `commissions` — commissions (auto-calculated)
- `compliance-comments-and-documents` — compliance comments
- `summary` — summary & SOCA

**Navigation method:** `page.evaluate("window.location.href = '{url}'")`
Wait 4-6s after each navigation for the SPA to render.

The `/deals/board` URL hangs the SPA — use sidebar click navigation instead.

## Data Entry Reliability

CDP evaluate native setter + dispatchEvent does NOT reliably trigger React persistence.
Use `page.locator().type()` (real keyboard events) for all field fills:

```python
# RELIABLE: triggers React validation and persistence
page.locator('input[name="firstName"]').first.type("Sam", delay=5)

# UNRELIABLE: fills visually but React may not persist
page.evaluate("""...native setter + dispatchEvent...""")
```

**Always verify data persistence** by navigating away and back to check field values.

## CfT Session Management

- CfT runs persistently via launchd agent (port 9222)
- The profile directory is `8um7547w`
- Credentials are cached in the profile after first successful login
- If the page shows "Loading ..." for more than 10s, navigation failed — retry via sidebar click
- browser-act browser session expires after ~2 minutes of inactivity — use CfT for sustained work
