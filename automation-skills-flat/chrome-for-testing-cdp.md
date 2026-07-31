---
name: chrome-for-testing-cdp
description: >
  macOS Chrome 150+ hardened runtime blocks CDP ports. Chrome for Testing
  (unhardened Chromium) fixes this. Covers install, launchd agent, connect_over_cdp,
  and persistent session management for Playwright/Patchright automation.
tags: [cdp, chrome-for-testing, playwright, browser-automation, macos, launchd, hardened-runtime]
related_skills:
  - agent-process-automation
  - salestrekker-react-automation
---

# Chrome for Testing — Permanent CDP Fix for macOS

## When to Use

macOS Chrome 150+ hardened runtime blocks `--remote-debugging-port`. This prevents `connect_over_cdp()` from attaching to a running Chrome instance. Chrome for Testing is a separate Chromium binary WITHOUT hardened runtime — CDP binds freely. **This is the permanent infrastructure fix for all browser automation on macOS.**

## Installation (One-Time)

```bash
# Install to /tmp (downloads the latest stable)
npx @puppeteer/browsers install chrome@stable --path /tmp/chrome-for-testing

# Move to permanent location (survives reboot)
mkdir -p ~/Applications
cp -R /tmp/chrome-for-testing/chrome/mac_arm-*/chrome-mac-arm64/*.app ~/Applications/
```

Binary path after move:
```
~/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing
```

## Launchd Agent (Auto-Start on Login)

**This is required** — CfT must always be running with CDP for automation to work.

```bash
launchctl load ~/Library/LaunchAgents/com.edgegde.chrome-for-testing.plist
```

The agent (see `references/launchd-plist.md`):
- Starts CfT with `--remote-debugging-port=9222` and `--user-data-dir` pointing to the 8um7547w profile
- `KeepAlive=true` — auto-restarts if killed
- Logs to `~/.hermes/logs/chrome-for-testing.log`

## Verify CDP is Online

```bash
curl -s http://localhost:9222/json/version | python3 -c "import json,sys; d=json.load(sys.stdin); print(f'CfT v{d[\"Browser\"].split(\"/\")[1]} — CDP online')"
```

## Connect from Playwright

```python
from playwright.sync_api import sync_playwright

pw = sync_playwright().start()
browser = pw.chromium.connect_over_cdp('http://localhost:9222')
page = browser.contexts[0].pages[0]
```

Always use `connect_over_cdp` — never `launch()`, never kill Chrome. The session persists across script executions.

## Login (First Run or After Session Expiry)

The auto-login with TOTP is handled by the `agent-process-automation` skill's `auto_login()` function. The TOTP secret (`SALESTREKKER_TOTP_SECRET`) is auto-injected from Bitwarden — never ask the user for a code.

```python
import os, pyotp
code = pyotp.TOTP(os.environ["SALESTREKKER_TOTP_SECRET"]).now()
```

## Key Difference from Regular Chrome

| Feature | Regular Chrome 150+ | Chrome for Testing |
|---|---|---|
| CDP port binding | ❌ Blocked by hardened runtime | ✅ Binds freely |
| Auto-update | ✅ Automatic | ❌ Manual via npx |
| Profile reuse | ✅ | ✅ with --user-data-dir |
| Persistence | Manual restart | ✅ Launchd KeepAlive |

## Related Skills

- `agent-process-automation` — generic browser automation engine (uses CfT + CDP)
- `salestrekker-react-automation` — Salestrekker-specific field maps and patterns
- `references/gateway-launchd-setup.md` — gateway FD limit, launchd agent, webhook conflict fixes
