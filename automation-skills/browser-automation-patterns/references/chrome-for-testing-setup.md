# Chrome for Testing Setup — macOS

## Why

macOS 15.7+ hardened runtime blocks `--remote-debugging-port` on Google Chrome 150+. Chrome for Testing (CfT) is an unhardened Chromium build that binds the port freely, enabling `connect_over_cdp` and eliminating the profile-lock / session-loss loop.

## Installation

```bash
npx @puppeteer/browsers install chrome@stable --path /tmp/chrome-for-testing
```

Installs to `/tmp/chrome-for-testing/chrome/mac_arm-<version>/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`

## Launch (Background)

```bash
"/path/to/Google Chrome for Testing" \
  --remote-debugging-port=9222 \
  --user-data-dir="$HOME/Library/Application Support/Google/Chrome/8um7547w" \
  --no-first-run
```

## Connect from Python

```python
from playwright.sync_api import sync_playwright
pw = sync_playwright().start()
browser = pw.chromium.connect_over_cdp('http://localhost:9222')
page = browser.contexts[0].pages[0]
```

## Verify CDP is online

```bash
curl -s http://localhost:9222/json/version
```

## Profile Notes

- CfT shares the `--user-data-dir` with regular Chrome — cookies/sessions are shared
- Do NOT run CfT and regular Chrome on the same profile simultaneously (profile lock)
- CfT has different fingerprinting than regular Chrome — may trigger bot detection on some sites
- If bot detection is a concern, use `launchPersistentContext` (pipe transport) instead

## TOTP Entry Pattern

When logging in, the 6 TOTP fields have class `_bS`. Use `keyboard.type()` with delay — individual `.fill()` calls fail due to React state management:

```python
code = pyotp.TOTP(secret).now()
page.locator('input._bS').first.focus()
page.keyboard.type(code, delay=50)  # 50ms delay between digits
time.sleep(1)
page.locator('button:has-text("Verify code")').click()
```

## Popover Component Interaction

The "Add contact" button uses a Popover/Radix wrapper that does NOT respond to CDP clicks or keyboard activation. Use native `.click()` via `page.evaluate()`:

```python
page.evaluate("""
    var divs = document.querySelectorAll('div[aria-haspopup]');
    for (var i = 0; i < divs.length; i++) {
        if (divs[i].textContent.trim() === 'Add contact') {
            divs[i].click();
            break;
        }
    }
""")
```

Then click the floating menu item with a Playwright locator:

```python
page.locator('text="Add new person"').first.click()
```

The contact form renders inline — fill with:
- `input[name="firstName"]` — first name
- `input[name="lastName"]` — last name
- `input[name="value"]` nth(0) — phone
- `input[name="value"]` nth(1) — email
