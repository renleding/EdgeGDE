---
name: browser-automation-stack-review
description: Technical inventory of problems with the Hermes browser automation stack for React SPAs focusing on cua-driver, headless browser, and AppleScript JS injection approaches. Covers React 18 isTrusted failures, session expiry, multi-monitor issues, CDP port lockdown.
tags: [browser-automation, react-spa, cua-driver, salestrekker, applescript]
---

# Browser Automation Stack - Problem Inventory

Full document in EdgeGDE repo: docs/engineering/browser-automation-stack-problems.md

## Root Cause
React 18 rejects programmatic PointerEvents (event.isTrusted === false). Only JS running inside the page context (AppleScript execute javascript) or CDP (Input.dispatchMouseEvent) produce trusted events. CDP port is locked down on macOS Chrome 15+ (hardened runtime).

## Tool-by-Tool Issues

### cua-driver (v0.8.3)
- Sessions expire every 10-15 min - no keepalive
- Element tokens stale after ANY operation - must re-capture between each click
- set_value on AXTextField does NOT trigger React onChange
- delivery_mode=foreground not supported
- SOM output 100-200KB per capture on dense Chrome windows

### AppleScript JS Injection
- 'Allow JavaScript from Apple Events' toggle resets on Chrome updates
- Multi-monitor menu bar click hits wrong display
- window.location.href triggers full page reload (use pushState instead)
- Quote escaping complexity with inline AppleScript

### Headless MCP Browser
- No shared cookies with user Chrome - 2FA every time
- Bot detection blocks after 1-2 login attempts
- Cannot save file downloads to user filesystem

## Key Workarounds
1. Native value setter: Object.getOwnPropertyDescriptor pattern + dispatch input/change events
2. PointerEvent chain: dispatch pointerdown,mousedown,pointerup,mouseup,click
3. SPA nav: window.history.pushState() not window.location.href
4. Window ID: cua-driver list_windows -> parse by title and bounds.x
5. Multi-field fill: one single AppleScript execute javascript call, not per-field

## Recommended Fix
Playwright with channel=chrome using launchPersistentContext with real profile directory.
