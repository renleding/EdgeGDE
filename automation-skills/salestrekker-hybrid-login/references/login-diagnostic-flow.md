# Login Diagnostic Flow (DISCOVERED 27 Jul 2026)

## Background
The sign-in page at `pc.v2.salestrekker.com/auth/sign-in` uses React form validation.
The form has `method="get"` (unusual for login), `novalidate=""`, and no CSRF tokens.
Credentials are stored in CfT's Chrome profile (8um7547w) and auto-filled on navigation.

## Sequence for Reliable Login

1. Navigate to sign-in: `page.goto()`
2. Wait 5s for React to mount
3. Check `page.title()`: if 'dashboard' or 'deals' → already authenticated
4. Check `page.title()`: if 'two-factor' or 'totp' → enter TOTP code directly
5. Check email input: `page.evaluate('document.querySelector("input[type=email]").value')`
   - If non-empty → **DO NOT TYPE** (Chrome profile auto-fill). Skip to click.
   - If empty → type via `page.locator('input[type="email"]').first.type(u, delay=20)`
6. Check Sign in button: `page.evaluate('...button...disabled')`
   - If enabled → click via `page.locator('button:has-text("Sign in")').first.click()`
   - If disabled → type credentials again (React didn't validate)
7. Wait 8s after click
8. Check `page.title()` for TOTP or dashboard
9. TOTP: `page.locator('input').first.focus()` + `page.keyboard.type(code, delay=60)` + page.keyboard.press('Enter')

## Key Distinctions

| Method | What it sends | Triggers React validation? |
|--------|--------------|---------------------------|
| `evaluate` native setter | Sets `.value` directly via descriptor | ❌ No |
| `locator.fill()` | CDP Input.insertText (bulk text) | ❌ No (usually) |
| `locator.type(value, delay=N)` | CDP Input.dispatchKeyEvent per char | ✅ Yes |
| `locator.click()` | CDP Input.dispatchMouseEvent | ✅ Yes (for buttons) |

## Page State Detection

Use `page.title()` (not `page.url`) to detect SPA state:

```python
def check_state(page):
    t = page.title().lower()
    if 'dashboard' in t or 'deals' in t: return 'dashboard'
    if 'two-factor' in t or 'totp' in t or '2f authentication' in t: return 'totp'
    return 'signin'
```

The URL does NOT update reliably when the SPA redirects (e.g., sign-in → TOTP → dashboard all show `auth/sign-in` in the URL bar).

## Login Attempt Limit (Hard Block)

- Max 2 login attempts total
- EVERY `page.goto()` to sign-in + fill + submit counts as one attempt
- Diagnostic scripts are NOT free — they consume attempts
- Read-only diagnostics: CUA capture (OS screenshot), or `page.evaluate()` that ONLY reads DOM state
- After 2 failures: HARD STOP. Report to user. Do NOT retry automatically.
- Rate limit escalation: 15s silence → 45s → 20min+ lockout
