# Salestrekker SPA Automation Reference

## Login Automation (Playwright)

```javascript
const { chromium } = require('playwright');
const { TOTP } = require('otpauth');
const ctx = await chromium.launchPersistentContext(PROFILE, {
  channel: 'chrome', headless: false,
  args: ['--no-first-run', '--window-position=-3000,0'],
});
const p = ctx.pages()[0];
await p.goto('https://pc.v2.salestrekker.com/auth/sign-in');
await p.locator('input[type=email]').fill(username);
await p.locator('input[type=password]').fill(password);
await p.locator('button[type=submit]').click();
// TOTP: fill 6 inputs
const code = new TOTP({secret}).generate();
const ins = await p.locator('input').all();
for(let i=0;i<6;i++) await ins[i].fill(code[i]);
await p.locator('button[type=submit]').click();
```

## Login Automation (AppleScript)

```python
import pyotp, tempfile, subprocess, json
code = pyotp.TOTP(secret).now()
def js(code):
    with tempfile.NamedTemporaryFile(mode='w', suffix='.applescript', delete=False) as f:
        f.write(f'tell app "Google Chrome" to execute active tab of window 1 javascript {json.dumps(code)}')
        r = subprocess.run(['osascript',f.name], capture_output=True, text=True, timeout=15)
        os.unlink(f.name)
    return (r.stdout or '').strip()

def fill(sel, val):
    return f'''(function(){{
        var el=document.querySelector({json.dumps(sel)});
        if(!el)return;
        var ns=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
        ns.call(el,{json.dumps(val)});
        el.dispatchEvent(new Event('input',{{bubbles:true}}));
        el.dispatchEvent(new Event('change',{{bubbles:true}}));
    }})()'''

def click_native(sel):
    return f'(function(){{var el=document.querySelector({json.dumps(sel)});if(el)el.click();}})()'

# Sequence:
js("window.location.href='https://pc.v2.salestrekker.com/auth/sign-in'")
js(fill('input[type=email]', username))
js(fill('input[type=password]', password))
js(click_native('button[type=submit]'))
for i, d in enumerate(code):
    js(fill(f'input[type=text]:nth-child({i+1})', d))
js(click_native('button[type=submit]'))
```

## SPA Navigation Sequence (Playwright)

```javascript
// WORKING path - DO NOT use page.goto to deal URLs
await p.locator('li#deals').click();
await p.waitForTimeout(1000);
await p.locator('button:has-text("B. Home loans")').click();
await p.waitForFunction(() => document.body.innerText.includes('TEST - Smith'));
await p.locator('text=TEST - Smith').click();
await p.waitForTimeout(3000);
```

## SPA Navigation Sequence (AppleScript)

```python
js(click_native('li#deals a'))  # or click_native('li#deals')
# Wait. Then find board button and click
js('''(function(){
    var b=document.querySelectorAll('button');
    for(var i=0;i<b.length;i++){if(b[i].offsetParent&&b[i].textContent.includes('B. Home loans')){b[i].click();return;}}
})()''')
```

## Edit Deal Flow
After deal card opens:
1. Click `a:has-text("Edit deal")` 
2. Click `summary:has-text("Home loan")` to expand
3. Click `a:has-text("Sam SmithApplicant")` for personal details
4. Click `button:has-text("Add current employment")` for employment
5. Or click sidebar links for Assets/Liabilities/Income/Expenses/Insurance

## Asset Add Flow
On Assets section:
1. Click `button:has-text("Add asset")` — opens type dropdown
2. Click type: "Vehicles make and model", "Home content", "Bank account"
3. Fields appear with name attributes: `name`, `vehicleBuildDate`, `value`, `vehicleRegoNumber`, `percent`
4. For "Add new details" type buttons: click first, then fill visible fields

## Known Pitfalls

- **Board shows 0 deals**: headless Chrome issue. Use headed off-screen
- **"Loading..." on deal page**: used direct URL navigation. Must go sidebar→board→card
- **Edit deal button invisible**: deal landed on board view, not overview. Click card through tree walker
- **AppleScript `set r` error**: variable collision with JS. Use `set output`
- **Currency fields ($ 0)**: React-controlled formatting. Native setter may not update display
- **osascript keystroke blocked**: needs System Accessibility permissions
- **Login max 2 attempts then ask**: Hard security constraint
