---
name: browser-automation-react-spa
description: Techniques for automating React 18 SPAs (especially Salestrekker 2.0) on macOS 15.7. Covers Playwright launchPersistentContext pipe transport, AppleScript JS injection, native value setter for controlled inputs, SPA navigation patterns, and secret resolution via Bitwarden.
tags: [browser-automation, react-spa, playwright, applescript, salestrekker, macos]
---

# Browser Automation — React 18 SPAs on macOS

## Root Constraint — And Workaround

macOS 15.7 + Chrome hardened runtime blocks `--remote-debugging-port`. CDP-over-TCP is unavailable. Two proven workarounds:

**Workaround A — Pipe Transport:** Playwright's `launchPersistentContext` uses pipe-based CDP (stdin/stdout), no TCP port needed.

**Workaround B — Chrome for Testing:** An unhardened Chromium binary that binds CDP port freely. Install via:
```
npx @puppeteer/browsers install chrome@stable --path /tmp/chrome-for-testing
```
Launch with `--remote-debugging-port=9222` and connect via `connect_over_cdp('http://localhost:9222')`.

## Tool Selection Guide

| Tool | Use for | Limitation |
|------|---------|------------|
| Playwright `launchPersistentContext` | Login, TOTP, filling fields, headed mode | Headless SPA rendering broken for Salestrekker board/overview |
| AppleScript JS injection | Real Chrome window interaction | 'Allow JS from Apple Events' toggle resets |
| cua-driver | Screen capture only | CGEvent clicks have `isTrusted=false` in React 18 |

## Playwright Approach (Headed, Off-Screen)

```js
const ctx = await chromium.launchPersistentContext(profilePath, {
  channel: 'chrome',
  headless: false,
  args: ['--no-first-run', '--window-size=1920,1080', '--window-position=-3000,0'],
});
```

- Position off-screen to avoid disturbing the user
- Profile persists session cookies across launches
- Secrets: `load_hermes_dotenv()` from `hermes_cli.env_loader` resolves Bitwarden secrets

### SPA Navigation

```
Dashboard → li#deals → flyout button (text match) → board
→ tree-walker text match for deal card → clickable ancestor click
→ deal overview renders → "Edit deal" link → sidebar → form sections
```

**DO NOT** use `page.goto()` for deal URLs — SPA stays on "Loading..."
**DO** use sidebar clicks + tree-walker text clicks

### AppleScript File-Read Pattern (Avoids Quoting Hell)

Inline AppleScript with nested JavaScript strings inevitably breaks on quote characters. **Always write JS to a temp file, then have AppleScript read it:**

```bash
# Write JS to temp file
cat > /tmp/fill_form.js << 'JSEOF'
(function() {
  // Your JavaScript here — use single and double quotes freely
  var result = [];
  document.querySelectorAll('input').forEach(function(el) {
    result.push(el.getAttribute('name') || 'unnamed');
  });
  return result.join(', ');
})();
JSEOF

# AppleScript reads the file via `read posix file`
osascript -e '
set jsPath to "/tmp/fill_form.js"
set jsScript to read posix file jsPath
tell application "Google Chrome"
    set r to execute active tab of window 1 javascript jsScript
    return r
end tell
'
```

For multi-step automation in Python:

```python
import subprocess, tempfile, time

script = '''
set jsPath to "/tmp/fill_fields.js"
set jsScript to read posix file jsPath
tell application "Google Chrome"
    set r to execute active tab of window 1 javascript jsScript
    return r
end tell
'''

with tempfile.NamedTemporaryFile(mode='w', suffix='.applescript', delete=False) as f:
    f.write(script)
    f.flush()
    r = subprocess.run(['osascript', f.name], capture_output=True, text=True, timeout=15)
    import os; os.unlink(f.name)  # Clean up
    print(r.stdout if r.stdout else r.stderr)
```

**Write to temp files** — never inline AppleScript with nested JavaScript quotes:

```bash
osascript /tmp/fill_form.applescript
```

### Native Value Setter (React Controlled Inputs)

```javascript
var ns = Object.getOwnPropertyDescriptor(
  window.HTMLInputElement.prototype, 'value'
).set;
ns.call(inputElement, 'desired value');
inputElement.dispatchEvent(new Event('input', {bubbles: true}));
inputElement.dispatchEvent(new Event('change', {bubbles: true}));
```

This pattern is required for ALL React controlled inputs in Salestrekker. Setting `.value` directly doesn't trigger React's onChange.

### Field Names (Salestrekker 2.0)

| Section | Name attributes |
|---------|----------------|
| Sam personal | `firstName`, `lastName`, `middleName`, `preferredName` |
| Vehicle asset | `name`, `vehicleBuildDate`, `value`, `vehicleRegoNumber` |
| Home contents | `name`, `value` |
| Bank account | `bankName`, `bankBSB`, `bankAccountNumber`, `value` |
| Credit cards | `limit`, `balance`, `repayment` |
| Vehicle loan | `limit`, `balance`, `repayment` (same names as CC — use nth occurrence to differentiate) |
| PAYG income | `grossSalary`, `bonus`, `overtimeEssential`, `commission` |

### Finding Elements Without Selectors

When elements lack meaningful class/ID/aria attributes, use a tree walker:

```javascript
function findClickableAncestor(el, depth) {
  if (!el || el === document.body || depth > 5) return null;
  var t = el.tagName.toLowerCase();
  if (t === 'a' || t === 'button' || el.getAttribute('role') === 'button') return el;
  return findClickableAncestor(el.parentElement, depth + 1);
}

var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
var node;
while (node = walker.nextNode()) {
  if (node.textContent.includes('TARGET TEXT')) {
    var clickable = findClickableAncestor(node.parentElement, 0);
    if (clickable) { clickable.click(); break; }
  }
}
```

## Login Automation (Full End-to-End)

1. Resolve Bitwarden secrets: `load_hermes_dotenv()` from `hermes_cli.env_loader`
2. Generate TOTP: `pyotp.TOTP(secret).now()`
3. Playwright fill email/password, submit
4. Detect 2FA page (6x `input._bS` fields), fill TOTP digits via `keyboard.type(code, delay=50)` — NOT individual `.fill()` calls
5. Navigate to `/dashboard` to confirm login
6. Session persists in Playwright profile

## Popover Component Pattern (New)

Some React components (e.g. the "Add contact" button) use Popover/Radix wrappers that:
- Do NOT respond to Playwright `locator.click()` (CDP `Input.dispatchMouseEvent`)
- Do NOT respond to `keyboard.press('Enter')`
- DO respond to native `page.evaluate(".click()")` on the wrapper `div[aria-haspopup]`

The resulting form content renders **inline on the page** (not in a dialog):

## Known Pitfalls

- **Headless board rendering**: Salestrekker's kanban board shows "All deals (0)" in headless Chrome. Must use headed mode.
- **Currency/masked inputs**: Value fields show "$ 0" as default placeholder. Use native setter to set raw number, events trigger formatting.
- **Question-type fields** (`Select one` placeholders): These are `<input>` elements rendered as comboboxes. Need to click to open dropdown, then select option.
- **Add asset/liability**: Button opens a type-selection dropdown. Click the specific type (e.g. "Vehicles make and model"), not "Add asset" again.
- **'Add current employment'** button: Clicking doesn't create inline fields in all views. May open a separate section.
- **DOM value ≠ saved data**: Setting a field value via JS injection and clicking "Save" does NOT guarantee the data was persisted. React may have ignored the change because the synthetic onChange was never triggered. ALWAYS verify by reloading the page and checking that field values survive the reload cycle.
- **Don't hallucinate data entry success**: If the field value reverts to its default (e.g. "$ 0") after your dispatchEvent, React didn't register it. Check actual values by re-reading them from the DOM after your fill attempt.
- **textarea ≠ input**: The native setter pattern (`Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')`) only works on `<input>` elements. For `<textarea>`, use direct `.value = 'text'` + dispatchEvent.
- **React combobox/select dropdowns cannot be automated**: Elements with `role="combobox"` in Salestrekker (used on the Product Search page) do NOT respond to programmatic events. No `__reactProps`/`__reactFiber` found on any ancestor. Dispatched `KeyboardEvent` has `isTrusted=false` which React 18 ignores. Playwright's trusted CDP events would work but the SPA renders a completely different DOM tree in Playwright Chrome vs real Chrome (even with the same profile). **These fields must be filled manually.**
- **Multi-Chrome-profile**: The 8um7547w profile (automation) has different settings/cookies than the Default/Warren profile (user). They are independent.
