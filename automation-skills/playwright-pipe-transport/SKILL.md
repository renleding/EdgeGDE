---
name: playwright-pipe-transport
description: Playwright pipe transport for React SPA automation on macOS 15.7+ that bypasses the CDP port-restriction. Validated on Salestrekker 2.0 with automated login, TOTP, session persistence, and SPA navigation.
tags: [playwright, react-spa, browser-automation, macos, salestrekker]
---

# Playwright Pipe Transport — Browser Automation on macOS

## When to Use
- Chrome hardened runtime blocks `--remote-debugging-port` (macOS 15.7+)
- Need trusted events for React 18 SPAs (`event.isTrusted === true`)
- Need background automation without focus stealing
- Selenium, WebdriverIO, Puppeteer (CDP-port based) don't work

## How It Works
Playwright's `launchPersistentContext` launches Chrome as a subprocess and communicates via internal pipe (stdin/stdout), NOT a TCP debugging port. This avoids the macOS hardened-runtime restriction entirely.

```javascript
const ctx = await chromium.launchPersistentContext(profilePath, {
  channel: 'chrome',        // uses system Chrome, not bundled Chromium
  headless: true,           // or false with --window-position=-3000,0
  args: ['--no-first-run', '--window-size=1920,1080'],
});
```

## What's Validated

| Capability | Status |
|-----------|--------|
| Chrome launch as subprocess | ✅ No focus stealing |
| locator.fill() on React inputs | ✅ Triggers onChange correctly |
| locator.click() on buttons | ✅ Trusted events, handlers execute |
| Login + TOTP 2FA | ✅ Bitwarden secrets → email/password → TOTP → dashboard |
| Session persistence | ✅ Profile saves cookies across runs |
| SPA navigation (sidebar) | ✅ `li#deals` → flyout button → board → deal card |

## Credential Resolution

Secrets are resolved via Hermes Bitwarden Secrets Manager:
```python
# Run this Python wrapper before the Node.js Playwright script
from hermes_cli.env_loader import load_hermes_dotenv
load_hermes_dotenv()  # triggers Bitwarden resolution into os.environ
```

Write to temp files for Node.js access: `/tmp/.SALESTREKKER_USERNAME`, etc.

## TOTP Automation
```javascript
const { TOTP } = require('otpauth');
const code = new TOTP({ secret: totpSecret }).generate();
const inputs = await page.locator('input').all();
if (inputs.length >= 6) {
  for (let i = 0; i < 6; i++) await inputs[i].fill(code[i]);
}
```

## SPA Navigation Pattern (Salestrekker 2.0)
1. Dashboard → `li#deals` click → flyout menu appears
2. Click flyout `button` by text content (e.g. "B. Home loans")
3. Board URL changes to `/deals/board/{boardId}`
4. Deal card click navigates within SPA to deal overview
5. Edit deal link available in headed mode

## Headless Limitation
Salestrekker's kanban/deal board view does NOT render deal cards in headless Chrome — board shows "All deals (0)" even when deals exist. Fix: use `headless: false` with `--window-position=-3000,0` to render off-screen.

## Pitfalls
- Never check `document.title` to determine if SPA loaded — check `document.body.innerText` for actual content
- page.goto() to deal URLs causes "Loading..." hang — always use SPA-internal navigation
- Session may expire after ~1 week; the automated login flow handles re-auth
- Different Chrome profiles (Warren vs 8um7547w) can run simultaneously
- Avoid BrowserUse/Stagehand on top of Playwright for deterministic form filling — adds LLM cost with zero benefit
- **Login retry safety**: MAX 2 attempts per session. If both fail, report and ask user for intervention. Never retry a third time.
- **Credential exposure**: Never display credential values in response text. Use redacted labels. bws CLI output and `.env` grep results both leak values to tool output.
- **Headless rendering**: Salestrekker's kanban board view does NOT render deal cards in headless mode (shows "All deals (0)"). This is a browser-engine limitation, not a scripting bug. Use `headless: false` with `--window-position=-3000,0` to render off-screen when the board view is required.
- **AppleScript quoting**: inline AppleScript with nested JS breaks from escape errors. Use `references/applescript-python-wrapper.md` for the Python tempfile pattern — `json.dumps()` handles escaping correctly.
- **Field names per section**: each section (Assets, Liabilities, Income) uses specific `name` attributes. See `references/salestrekker-field-mapping.md` for the complete mapping.

## Bitwarden Credential Resolution

Secrets are NOT stored in `.env` — they live in Bitwarden Secrets Manager cloud vault. Resolve them before any Playwright script that needs auth:

```python
# resolve_secrets.py — run this first
import sys
sys.path.insert(0, '/Users/warren/Documents/_HQ_AI/hermes_workspace/hermes-agent')
from hermes_cli.env_loader import load_hermes_dotenv
import os

load_hermes_dotenv()  # triggers Bitwarden resolution into os.environ

secrets = {}
for key in ['SALESTREKKER_USERNAME', 'SALESTREKKER_PASSWORD', 'SALESTREKKER_TOTP_SECRET']:
    val = os.environ.get(key)
    if val:
        secrets[key] = val
        path = f'/tmp/.{key}'
        with open(path, 'w') as f:
            f.write(val.strip())
        os.chmod(path, 0o600)
    else:
        print(f'MISSING: {key}')
        sys.exit(1)
```

Then in Node.js:
```javascript
const fs = require('fs');
const username = fs.readFileSync('/tmp/.SALESTREKKER_USERNAME', 'utf-8').trim();
```

## SPA Navigation Sequence (Salestrekker 2.0)

```javascript
// From dashboard, click the Deals sidebar icon (its li has id="deals")
await page.locator('li#deals').click();
await page.waitForTimeout(1000);

// Click the board from the flyout menu (buttons with text)
await page.evaluate(() => {
  document.querySelectorAll('button').forEach(b => {
    if (b.textContent.includes('B. Home loans') && b.offsetParent) b.click();
  });
});
await page.waitForTimeout(3000);

// Wait for the deal card to appear on the board
await page.waitForFunction(
  () => document.body.innerText.includes('TEST - Smith'),
  { timeout: 15000 }
);

// Click the deal card (find clickable ancestor of the text)
await page.evaluate(() => {
  function findParent(el, depth) {
    if (!el || el === document.body || depth > 5) return null;
    const t = el.tagName.toLowerCase();
    if (t === 'a' || t === 'button' || el.getAttribute('role') === 'button') return el;
    return findParent(el.parentElement, depth + 1);
  }
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
  let node;
  while (node = walker.nextNode()) {
    if (node.textContent.includes('TEST - Smith')) {
      const clickable = findParent(node.parentElement, 0);
      if (clickable) { clickable.click(); return; }
    }
  }
});
```

## Test Deal Data (Sam Smith + Amy Smith)

| Category | Item | Value |
|----------|------|-------|
| Employment | Employer | Wealth Wages, Sally Carmichael |
| | Occupation | Electrician |
| | Salary | $150,000/year |
| Assets | Vehicle | BMW X5, est 2018, $40,000, reg XYZ123 (Sam 100%) |
| | Home contents | $100,000 (Sam 50%, Amy 50%) |
| | Bank savings | ANZ Savings, BSB 123-456, Acc 987654321, $350,000 (Sam 50%, Amy 50%) |
| Liabilities | CC Sam | $5,000 limit, $0 balance |
| | CC Amy | $5,000 limit, $0 balance |
| | Vehicle loan | $20K financed, $10K balance, $260/mth |
| Expenses | Groceries | $270/week |
| | Clothing | $200/month |
| | Phone/Internet | $110/month |
| Insurance | Income Protection | Youi, $250K cover, $90/month premium |
