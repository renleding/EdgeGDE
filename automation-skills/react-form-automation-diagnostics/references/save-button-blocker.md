# Save Button Blocker — Definitive Analysis

**Date:** 28 Jul 2026
**Tested against:** Salestrekker Add deal form + home-loan editor
**Framework:** Hybrid (React shell + custom framework with closure state)

## Architecture

```
React Shell (navigation, sidebar, dialogs)
  └── Custom Framework (deal forms)
        ├── Title input (plain DOM, no __reactProps$)
        ├── Value input (plain DOM, no __reactProps$)
        ├── Save button (plain DOM, no __reactProps$)
        │     └── addEventListener('click', {handleEvent: fn})
        │           └── fn checks CLOSURE state
        │                 └── invalid → return (zero API calls)
        └── React Event Delegation (document level)
              └── $n/Jr handlers catch all clicks first
                    └── forward to appropriate fiber → bail out
```

## All Approaches Exhausted

| Layer | Approaches | Result |
|-------|-----------|--------|
| CDP | Input.dispatchMouseEvent | ❌ |
| JS | element.click(), dispatchEvent(MouseEvent/PointerEvent) | ❌ |
| Keyboard | Tab+Enter, dispatchKeyEvent (trusted) | ❌ |
| OS mouse | pyautogui, CGEventPost, AppleScript click at | ❌ |
| Network | CDP Network.requestWillBeSent (all types) | ❌ 0 calls |
| Debugger | DOMDebugger breakpoints, closure capture via WS | ❌ State unreachable |
| State scan | Globals, DOM, fibers, WeakMaps, all window keys | ❌ Closure-based |
| Injection | addEventListener interceptor (5 injection methods) | ❌ Handlers pre-registered |
| CDP injection | Page.addScriptToEvaluateOnNewDocument | ❌ Non-functional in CfT |
| Bundle injection | Fetch.enable response interception | ❌ |

## Root Cause

The custom framework's minified bundle (`main.1ff6a4...js`) stores ALL form state in JavaScript closures created during bundle initialization. The Save button's click handler references variables from these closures. When we set DOM values via keyboard/evaluate, the DOM changes but the closure variables remain at their default values. The handler checks the closure, finds them empty, and returns before reaching any API code.

**Proof:** CDP `Network.requestWillBeSent` captures ZERO network requests when Save is clicked. The handler exits before any fetch/XHR call.

## The Interceptor — Partial Success

Injected via `page.evaluate()` on the board page BEFORE navigating to Add deal:
- Interceptor **does survive** client-side SPA navigation
- `window.__h` remains `true` after "Add new" click
- BUT: the framework's handlers were already registered during initial page load (at login time)
- Interceptor only wraps FUTURE `addEventListener` calls, not past ones

**To work, the interceptor must run DURING page load, before the framework mounts.** The only CDP method for this is `Page.addScriptToEvaluateOnNewDocument`, which does NOT work in the current CfT/Playwright CDP environment (confirmed: injected script never runs).

## React Detection — Unique Suffix Trap

Salestrekker's React build uses unique suffixes on internal property keys:

```
Actual:   __reactFiber$7aljpldl56b
Expected: __reactFiber$
```

`k.startsWith('__reactFiber')` returns FALSE because the key has a unique suffix.

**Fix:** Use `k.toLowerCase().includes('reactfiber')` or `k.toLowerCase().includes('react')`.

This applies to all six React internal keys:
- `__reactFiber${suffix}` → search for `reactfiber`
- `__reactProps${suffix}` → search for `reactprops`
- `__reactContainer${suffix}` → search for `reactcontainer`
- `__reactEvents${suffix}` → search for `reactevents`
- `__reactListeners${suffix}` → search for `reactlisteners`
- `__reactHandles${suffix}` → search for `reacthandles`

## Remaining Options (Unverified)

1. **CDP `Fetch.enable` via continuation** — intercept the main.js bundle request and inject the interceptor code into the response body. Requires: (a) the CDP session handles `Fetch.requestPaused` events, (b) the response is binary/text, (c) appending to the bundle doesn't break source maps.
2. **Service Worker injection** — use CDP to register a Service Worker that intercepts network requests and patches responses.
3. **Raw CDP WS with Page.navigate** — establish a raw WebSocket to CfT, bypass Patchright's CDP session wrapper entirely, navigate via `Page.navigate`, and inject via `Page.addScriptToEvaluateOnNewDocument` on the same WS connection.
