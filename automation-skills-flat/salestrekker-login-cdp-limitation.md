---
name: salestrekker-login-cdp-limitation
description: >-
  Documents that Salestrekker's sign-in form silently rejects all CDP-initiated
  form submissions. The fix is CUA-driver hybrid login (CDP fill + CUA click).
  Captures the silent-rejection pattern, rate-limit symptoms, and recovery.
tags: [salestrekker, login, cdp, cua, bot-detection, rate-limit]
related_skills:
  - salestrekker-hybrid-login
  - salestrekker-react-automation
  - four-tier-sensory-test
---

# CDP Login — Root Cause & Fix (v2, 27 Jul 2026)
# 
# CORRECTION from v1: CDP form submission IS possible. The real issue was
# that the "Sign in" button stays DISABLED (React form validation not
# triggered by native setter), not that CDP clicks are rejected.

## The Problem

Salestrekker's React 18 sign-in form at `pc.v2.salestrekker.com/auth/sign-in`
appears to silently reject form submissions. The page stays on `/auth/sign-in`
even after credentials are set and a submit action is triggered.

## Root Cause (CORRECTED)

The "Sign in" button is rendered with `[disabled]` in the DOM. React form
validation (checking email format, password non-empty, etc.) removes the
`disabled` attribute. CDP evaluate native setter (`Object.getOwnPropertyDescriptor
... value.set` + `dispatchEvent`) does NOT trigger React's validation handlers,
so the button stays disabled. Any click on a disabled button is silently ignored.

The solution: use `locator().type()` (real keyboard events with per-char delay)
which triggers React's onChange and validation properly.

## What Actually Works (v2 correction)

### Method 1 (PREFERRED): CDP locator.type + locator.click

`page.locator('input[type="email"]').first.type(email, delay=20)` sends real
keyboard events → React validates → button enables.

`page.locator('button:has-text("Sign in")').first.click()` sends a CDP mouse
event → React accepts it (isTrusted is not checked at this level).

```python
# Type credentials — keyboard events trigger React validation
page.locator('input[type="email"]').first.type(USERNAME, delay=20)
page.locator('input[type="password"]').first.type(PASSWORD, delay=20)

# Click Sign in — CDP mouse event works when button is enabled
page.locator('button:has-text("Sign in")').first.click()

# TOTP via keyboard.type — real keystrokes
code = pyotp.TOTP(os.environ["SALESTREKKER_TOTP_SECRET"]).now()
page.locator('input').first.focus()
page.keyboard.type(code, delay=60)
page.keyboard.press('Enter')
```

Key insight: the login was never blocked by `isTrusted`. CDP evaluate clicks
on disabled buttons are silently ignored — they look like they succeed but
React's event handler never fires because the button is disabled.

### Method 2 (Fallback): CUA-driver hybrid

See `salestrekker-hybrid-login` for CUA+CDP pattern. Only needed if Method 1
fails (rare — usually indicates a different issue).

## Symptoms Checklist

1. ✅ Credentials filled correctly (visible in DOM inputs)
2. ❌ "Sign in" button shows `[disabled]` in accessibility tree
3. ❌ URL stays at `/auth/sign-in`
4. ❌ No TOTP page reached
5. ❌ No network request sent for login (no POST/GET submitted)

## CfT Profile Auto-Fill

CfT's profile (8um7547w) saves credentials after first successful login.
Subsequent runs auto-fill email/password. Scripts must CHECK before filling:
```python
email_val = page.evaluate(
    "() => document.querySelector('input[type=\"email\"]')?.value || ''")
```

## ⚠️ CRITICAL: Login Diagnostics Count as Attempts

Every time you navigate to the sign-in page, fill credentials, and submit —
even in a diagnostic or debugging script — it counts as a login attempt
against the 2-max cap. This is NOT free.

**Rule:** Login diagnostics must be READ-ONLY:
- CUA capture (screenshot) — zero side effects
- page.evaluate that only READS DOM state (no fill, no submit)
- Never page.goto to sign-in + fill + submit for diagnostic purposes

**Consequence of violation:** The 2-attempt limit is silently exceeded,
the account enters rate-limit (20min+ lockout), and the user cannot log in
even manually until the lockout expires.

## Page Title for State Detection (v2 addition)

After successful sign-in, the SPA navigates to TOTP but the URL may still show
`/auth/sign-in`. Check page TITLE instead of URL:
```python
def check_page_state(page):
    title = page.title().lower()
    if 'two-factor' in title or 'totp' in title or '2f authentication' in title:
        return 'totp'
    if 'dashboard' in title or 'deals' in title or '/deals/' in page.url:
        return 'dashboard'
    return 'signin'
```

## Rate-Limit Recovery

After 2 failed login attempts, the account enters rate-limit — same symptom
(stays on sign-in with no error, "Sign in" button disabled). Rate limit
escalates: 15s → 45s → 20min+.

To distinguish credential issues from rate-limiting:
- Fewer than 2 immediate failures → likely wrong credentials or React issue
- Cumulative time between attempts → rate-limit (15s+ pauses)

Wait 20+ minutes before retrying.
