# Salestrekker Automation — Full Workflow Scripts

## 1. Credential Resolution (Python wrapper)

```python
#!/usr/bin/env python3
import os, sys
sys.path.insert(0, '/Users/warren/Documents/_HQ_AI/hermes_workspace/hermes-agent')
from hermes_cli.env_loader import load_hermes_dotenv
load_hermes_dotenv()  # triggers Bitwarden secret resolution

for key in ['SALESTREKKER_USERNAME', 'SALESTREKKER_PASSWORD', 'SALESTREKKER_TOTP_SECRET']:
    val = os.environ.get(key)
    if val:
        with open(f'/tmp/.{key}', 'w') as f:
            f.write(val.strip())
        os.chmod(f'/tmp/.{key}', 0o600)
```

## 2. Login + Session Persistence (Node.js)

```javascript
const { chromium } = require('playwright');
const { TOTP } = require('otpauth');
const fs = require('fs');
const path = require('path');

const PROFILE = path.join(process.env.HOME,
  'Library/Application Support/Google/Chrome/8um7547w');

async function login(page) {
  await page.goto('https://pc.v2.salestrekker.com/dashboard', {waitUntil:'load',timeout:20000});
  await page.waitForTimeout(3000);
  
  // Check if already logged in
  if (!page.url().includes('sign-in') &&
      !await page.locator('input[type=email]').isVisible({timeout:3000}).catch(()=>false)) {
    return; // Session still active
  }
  
  // Auto-login
  const read = k => fs.readFileSync(`/tmp/.${k}`, 'utf-8').trim();
  await page.locator('input[type=email]').fill(read('SALESTREKKER_USERNAME'));
  await page.locator('input[type=password]').fill(read('SALESTREKKER_PASSWORD'));
  await page.locator('button[type=submit]').click();
  await page.waitForTimeout(2000);
  
  // TOTP 2FA
  const code = new TOTP({secret: read('SALESTREKKER_TOTP_SECRET')}).generate();
  const inputs = await page.locator('input').all();
  if (inputs.length >= 6) {
    for (let i = 0; i < 6; i++) await inputs[i].fill(code[i]);
  }
  await page.locator('button[type=submit]').click();
  await page.waitForTimeout(3000);
}
```

## 3. SPA Navigation to Deal

```javascript
// Dashboard → Deals → Board → Deal card
await page.locator('li#deals').click();
await page.waitForTimeout(1000);

// Click board from flyout
await page.evaluate(() => {
  document.querySelectorAll('button').forEach(b => {
    if (b.textContent.includes('B. Home loans') && b.offsetParent) b.click();
  });
});
await page.waitForTimeout(2000);

// Click deal card
const deal = page.locator('a:has-text("TEST - Smith")');
await deal.click();
await page.waitForTimeout(3000);
```

## 4. Fill React Field (Native Setter + Events)

```javascript
// Only needed if locator.fill() doesn't work (very rare)
const ns = Object.getOwnPropertyDescriptor(
  window.HTMLInputElement.prototype, 'value'
).set;
const input = document.querySelector('input[placeholder="Employer name"]');
ns.call(input, 'Wealth Wages');
input.dispatchEvent(new Event('input', {bubbles: true}));
input.dispatchEvent(new Event('change', {bubbles: true}));
```

## Key Selectors
| Element | Selector |
|---------|----------|
| Deals sidebar | `li#deals` |
| Flyout menu button | `button` with text matching "B. Home loans" |
| Deal card | `a:has-text("TEST - Smith")` |
| Edit deal | `a:has-text("Edit deal")` |
| Sam Smith profile | `a:has-text("Sam SmithApplicant")` |
| Add employment | `button:has-text("Add current employment")` |
| Home loan section | `summary:has-text("Home loan")` |
