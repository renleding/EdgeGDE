---
name: salestrekker-hybrid-login
description: >
  Salestrekker 2.0 login — CDP `locator().type()` triggers React validation,
  `locator().click()` submits. CUA+CDP hybrid fallback. TOTP keyboard.type.
tags: [salestrekker, login, cdp, totp, auth, react]
related_skills:
  - salestrekker-react-automation
  - salestrekker-spa-patterns
  - four-tier-sensory-test
---

# Salestrekker Login — CDP Primary, CUA Fallback

## Architecture — Two Approaches

### Approach A: CDP-Only (DEFAULT)
Uses Patchright `locator().type()` for field fill (character-by-character keyboard events trigger React form validation) and `locator().click()` for Sign in (CDP Input.dispatchMouseEvent). Does NOT require CUA daemon.

### Approach B: CUA+CDP Hybrid (FALLBACK)
CUA for button clicks (real macOS CGEvents), CDP for field filling. Use when Approach A blocked by WAF/Cloudflare.

## ⚠️ CRITICAL: The Native Setter Trap

`Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set` + `dispatchEvent('input')` fills the field visually but does **NOT** trigger React form validation. The "Sign in" button stays `[disabled]`.

**Diagnose:** `page.evaluate('() => Array.from(document.querySelectorAll("button")).find(x => x.textContent.trim() === "Sign in")?.disabled')`

Only `page.locator().type()` (real keyboard events per-character) triggers React validation.

| Method | What it sends | Triggers React? |
|--------|--------------|-----------------|
| `evaluate` native setter | Sets `.value` via descriptor | ❌ No |
| `locator.fill()` | CDP Input.insertText (bulk) | ❌ Usually not |
| `locator.type(value, delay=N)` | CDP Input.dispatchKeyEvent per char | ✅ Yes |
| `locator.click()` | CDP Input.dispatchMouseEvent | ✅ Yes |

## Approach A — CDP-Only Code (PRIMARY)

```python
import os, time, pyotp
from patchright.sync_api import sync_playwright

pw = sync_playwright().start()
browser = pw.chromium.connect_over_cdp('http://localhost:9222')
page = browser.contexts[0].pages[0]
page.goto('https://pc.v2.salestrekker.com/auth/sign-in', timeout=20000)
time.sleep(5)

def check_state(page):
    t = page.title().lower()
    if 'dashboard' in t or 'deals' in t: return 'dashboard'
    if 'two-factor' in t or 'totp' in t: return 'totp'
    return 'signin'

state = check_state(page)
if state == 'dashboard':
    print('Already authenticated')

# Check Chrome profile auto-fill
email_val = page.evaluate('() => document.querySelector("input[type=email]")?.value || ""')
signin_enabled = page.evaluate('() => { var b = Array.from(document.querySelectorAll("button")).find(x => x.textContent.trim() === "Sign in"); return b ? (!b.disabled && b.offsetParent !== null) : false; }')

# Only type if NOT auto-filled
if not email_val or not signin_enabled:
    u = os.environ["SALESTREKKER_USERNAME"]
    p = os.environ["SALESTREKKER_PASSWORD"]
    page.locator('input[type="email"]').first.type(u, delay=20)
    time.sleep(0.3)
    page.locator('input[type="password"]').first.type(p, delay=20)
    time.sleep(0.3)

# CRITICAL: locator.click() not evaluate click
page.locator('button:has-text("Sign in")').first.click()
time.sleep(8)

state = check_state(page)
if state == 'totp':
    code = pyotp.TOTP(os.environ["SALESTREKKER_TOTP_SECRET"]).now()
    page.locator('input').first.focus()
    page.keyboard.type(code, delay=60)
    time.sleep(0.5)
    page.keyboard.press('Enter')
    time.sleep(8)
```

## Approach B — CUA+CDP Hybrid Code (FALLBACK)

```python
import os, json, time, pyotp, subprocess
from patchright.sync_api import sync_playwright

def find_el(pid, wid, label):
    s = json.loads(subprocess.run(['cua-driver','call','get_window_state',
        json.dumps({'pid':pid,'window_id':wid,'capture_mode':'ax','max_elements':300})],
        capture_output=True, text=True, timeout=15).stdout)
    return next((e['element_index'] for e in s.get('elements',[])
        if label in e.get('label','')), None)

def cua_click(pid, wid, label):
    el = find_el(pid, wid, label)
    if el: subprocess.run(['cua-driver','call','click',
        json.dumps({'pid':pid,'window_id':wid,'element_index':el})],
        capture_output=True, text=True, timeout=15)

pw = sync_playwright().start()
browser = pw.chromium.connect_over_cdp('http://localhost:9222')
page = browser.contexts[0].pages[0]
page.goto('https://pc.v2.salestrekker.com/auth/sign-in')
time.sleep(5)

u, p = os.environ["SALESTREKKER_USERNAME"], os.environ["SALESTREKKER_PASSWORD"]
page.evaluate("""([u, pwd]) => {
    const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    [['input[type="email"]',u],['input[type="password"]',pwd]].forEach(([sel,val]) => {
        var el = document.querySelector(sel);
        if(el && s) { s.call(el, val); ['input','change','blur'].forEach(e =>
            el.dispatchEvent(new Event(e, {bubbles:true}))); }
    });
}""", [u, p])
time.sleep(1)

list_r = subprocess.run(['cua-driver','call','list_windows','{}'],
    capture_output=True, text=True, timeout=15)
cft = next((w for w in json.loads(list_r.stdout).get('windows',[])
    if 'Testing' in w.get('app_name','') and 'Sign in' in w.get('title','')), None)
if cft:
    cua_click(cft['pid'], cft['window_id'], 'Sign in')
    time.sleep(6)
```

## Critical Rules

1. **page.evaluate takes ONE arg**: `(args) => { const [u,p] = args; }` + pass `[u, p]` — never multiple positional args
2. **keyboard.type with delay=60**: 6 individual OTP digit inputs. `set_value` on the first input dumps all 6 chars into field 1. Only keyboard.type fires React onChange per-digit
3. **CUA for auth clicks, CDP for data entry**: CUA's real macOS CGEvents appear isTrusted=true. CDP clicks are isTrusted=false — React SPAs may reject them
4. **Use `browser.contexts[0].pages[0]`**: Avoid `browser.new_page()`. CUA targets the browser window by window_id, not individual tabs. New CDP tabs may not be the CUA-targeted tab
5. **One-shot TOTP**: Generate code once, use within 30s window. If verify fails, wait 30s for next code — don't re-login
6. **Max 2 login attempts**: Hard stop at 2. Salestrekker rate limit: 15s → 45s → 20min+ lockout
7. **Find CfT PID/W**: `cua-driver call list_windows '' | grep -i 'chrome.*testing\\|salestrekker'`
8. **Login diagnostics count as attempts (HARD BLOCK)**: Every `page.goto()` to sign-in + fill + submit counts as one attempt against the 2-max cap. Zero diagnostic scripts may navigate to sign-in and fill/submit to "check" the login state. Login diagnostics MUST be read-only: CUA capture (OS screenshot) or page.evaluate that only reads DOM state (never fills or submits). The only code that performs login is the single test script with the hardcoded 2-attempt limit. Violating this is a pattern error, not a one-off.
9. **Check Chrome profile auto-fill before typing**: CfT's profile (8um7547w) has saved credentials stored. Before typing, check `page.evaluate('document.querySelector("input[type=email]").value')`. If non-empty, skip fill and click Sign in directly. Double-filling an already-populated field causes login failures because React validation state gets confused.
10. **Use `locator().click()` for Sign in, not evaluate click**: `page.evaluate()` with JS `.click()` + `createEvent('MouseEvents')` is silently ignored by the sign-in form. Only `page.locator('button:has-text("Sign in")').first.click()` works — it sends a real CDP Input.dispatchMouseEvent that the form recognizes as a trusted event.
11. **React form validation NOT triggered by native setter**: `Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set` + `dispatchEvent('input')` fills the field visually but does NOT enable the Sign in button. React validates form state via real keyboard events. Use `page.locator('input[type="email"]').first.type(value, delay=20)` (character-by-character) to trigger React validation. Diagnose with: `page.evaluate('() => Array.from(document.querySelectorAll("button")).find(x => x.textContent.trim() === "Sign in")?.disabled')` — `true` means React didn't validate yet.
### 12. Check page TITLE, not just URL, for auth state
After form submission, the SPA may redirect to TOTP/dashboard WITHOUT updating the URL bar. The `<title>` changes first. Check for keywords in `page.title()`:
- `'dashboard'` or `'deals'` or `'board'` in title → authenticated
- `'two-factor'`, `'totp'`, `'2f authentication'` in title → TOTP page
- `'sign in'` in title or URL → still on sign-in

### 13. TOTP Input Rejects Evaluate Setter
The 2FA TOTP input is a React controlled component that only registers values typed via **real keyboard events**. Using `evaluate()` prototype setter silently fails — field fills visually but React ignores it, redirecting to the recovery page on submit.

See `references/totp-entry-pitfall.md` for full diagnostic + recovery flow.

### 14. Check Page Title After TOTP Submit
After pressing Enter on the TOTP form, check the page title for auth state:
- `'dashboard'` or `'deals'` in title → authenticated
- `'two-factor authentication recovery'` in title → TOTP failed
- `'sign in'` in title → session expired
- `'two-factor authentication'` in title → TOTP not submitted yet
    - `'dashboard'` or `'deals'` or `'board'` in title → authenticated
    - `'two-factor'`, `'totp'`, `'2f authentication'` in title → TOTP page
    - `'sign in'` in title or URL → still on sign-in
