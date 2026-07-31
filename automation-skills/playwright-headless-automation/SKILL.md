---
name: playwright-headless-automation
description: Playwright + launchPersistentContext for React SPA automation on macOS 15.7. Bypasses CDP port lockdown via pipe transport. Automated Salestrekker login with TOTP. Tested against Salestrekker 2.0 React SPA.
tags: [playwright, salestrekker, react-spa, browser-automation, totp, macos]
---

# Playwright Headless Automation (Proven on macOS 15.7)

## Architecture

Playwright's `launchPersistentContext` with `channel:'chrome'` uses pipe-based CDP (stdin/stdout) — **no TCP port needed**. This bypasses macOS hardened runtime's `--remote-debugging-port` lockout.

```javascript
const context = await chromium.launchPersistentContext(PROFILE, {
  channel: 'chrome',
  headless: false,  // headed = full SPA rendering
  args: ['--no-first-run', '--window-position=-3000,0'],
});
```

## Automated Login (Salestrekker)

### Prerequisites
- `playwright` and `otpauth` npm packages
- Hermes Bitwarden secrets accessible via `load_hermes_dotenv()`

### Login Flow
1. **Resolve credentials** via Hermes env loader (not .env file):
   ```python
   sys.path.insert(0, '/path/to/hermes-agent')
   from hermes_cli.env_loader import load_hermes_dotenv
   load_hermes_dotenv()
   username = os.environ.get('SALESTREKKER_USERNAME')
   ```
2. Launch browser, go to `https://pc.v2.salestrekker.com/auth/sign-in`
3. Fill email + password with `locator.fill()`
4. Submit, wait for 2FA page
5. Generate TOTP: `new TOTP({secret}).generate()`
6. Fill 6 individual inputs with TOTP digits
7. Click verify

### Session Persistence
`launchPersistentContext` manages a Chrome profile directory. After one successful login, cookies are saved. Future runs skip the login flow entirely if the session hasn't expired.

## Navigating Within Salestrekker SPA

Direct `page.goto()` to deal URLs causes "Loading..." indefinitely. Use SPA-safe paths:

```
page.goto('/dashboard') → always loads
page.locator('li#deals').click() → sidebar
Locate board button in flyout by text → click
Find deal card on board → click
Click "Edit deal" to enter editing mode
```

## Headless vs Headed

| Feature | Headed (off-screen) | Headless |
|---------|-------------------|----------|
| Dashboard | ✅ | ✅ |
| Sidebar nav | ✅ | ⚠️ Flyout may not appear |
| Board with deals | ✅ | ❌ "All deals (0)" |
| Deal overview | ✅ (via board) | ❌ "Loading..." |
| locator.fill() | ✅ React compatible | ✅ |
| locator.click() | ✅ | ✅ |

**Rule of thumb**: Use headed with `--window-position=-3000,0` for any SPA work. The window exists off-screen — user never sees it.

## Pitfalls

- **Headless renders board empty** — Salestrekker's kanban data fetch is unreliable in headless Chrome
- **Deal view URL direct navigation** — always shows "Loading...". Must navigate via board
- **Secret resolution** — use `load_hermes_dotenv()`, don't try to read .env files directly. The secrets are in Bitwarden, not disk files
- **First-run login**: After creating the profile with a successful login, never log in more than twice if login fails (account lockout risk)
- **Profile ownership**: `launchPersistentContext` creates/owns the profile. Don't try to use the same profile with a separately running Chrome instance
- **Selenium 4, WDIO, Puppeteer**: ALL blocked on macOS 15.7 (need CDP port). Playwright's pipe transport is the only working mechanism

## Key Files from Validation Session

Scripts created during testing (in /tmp/ — copy to project):
- `resolve_secrets.py` — loads Hermes Bitwarden secrets into temp files
- `deal-v4.js` — Playwright headed off-screen with full login + TOTP + navigation
- `fill_deal?.py` — AppleScript JS injection variants for real Chrome
