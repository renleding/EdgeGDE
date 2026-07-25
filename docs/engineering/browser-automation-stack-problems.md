# Browser Automation Stack — Technical Problem Inventory

**Audience:** Systems Engineer  
**Context:** EdgeGDE / Purple Circle Financial Services — Salestrekker 2.0 React SPA  
**Date:** 23 July 2026  
**Author:** Hermes Agent (compiled from production issues across 6+ weeks)

---

## 1. Architecture Overview (Current State)

```
┌─────────────────────────────────────────────────────────────────────┐
│                        HERMES AGENT (macOS)                         │
│                                                                     │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────────────┐ │
│  │  cua-driver  │  │   Headless   │  │  AppleScript JS Injection │ │
│  │  (v0.8.3)    │  │   Browser    │  │  (View → Developer →      │ │
│  │              │  │  (Playwright │  │   Allow JS from Apple     │ │
│  │  SOM capture │  │   Chromium)  │  │   Events)                 │ │
│  │  CGEvent     │  │              │  │                           │ │
│  │  foreground  │  │  Isolated    │  │  JS executes inside page  │ │
│  │  click       │  │  session     │  │  React context            │ │
│  └──────┬───────┘  └──────┬───────┘  └────────────┬──────────────┘ │
│         │                │                        │                │
│         ▼                ▼                        ▼                │
│  ┌──────────────────────────────────────────────────────────┐      │
│  │              CHROME (Warren profile, PID 637)              │      │
│  │                                                            │      │
│  │  3 displays: Built-in (1512x944), 4K MONITOR (1920x2135),│      │
│  │  iPad (Sidecar)                                            │      │
│  │  2 Chrome profiles: Warren (main), 8um7547w (automation)  │      │
│  │  16+ tabs across 2 windows                                 │      │
│  │                                                            │      │
│  │  Salestrekker 2.0 = React 18 SPA                           │      │
│  │  Uses PointerEvents, synthetic event system,               │      │
│  │  controlled inputs with onChange handlers,                 │      │
│  │  floating portals for dropdowns                            │      │
│  └──────────────────────────────────────────────────────────┘      │
│                                                                     │
│  ┌──────────────────────────┐  ┌──────────────────────────────┐    │
│  │   LITELLM GATEWAY        │  │   HERMES GATEWAY             │    │
│  │   Podman container       │  │   launchd (PID 56475)        │    │
│  │   port 4000              │  │   port 8642                  │    │
│  │   DeepSeek V4 routing    │  │   Bitwarden secrets          │    │
│  └──────────────────────────┘  └──────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────┘
         │                     │
         ▼                     ▼
┌─────────────────────┐  ┌──────────────────┐
│  D1 (edgegde-prod)  │  │  Vectorize       │
│  ~3,600 lender docs │  │  3,589 vectors   │
│  81 lender profiles │  │  768-d embeddings│
│  FTS5 search        │  │  cosine sim      │
└─────────────────────┘  └──────────────────┘
```

---

## 2. Layer 1: cua-driver (Computer Use Agent Driver)

### 2.1 Session Expiry / Cache Invalidated Mid-Turn

**Problem:** cua-driver sessions expire after an indeterminate period. Once expired, ALL operations fail with:
```
cua-driver list_windows failed: session 'hermes-<id>' has ended
```

The only recovery path is `cua-driver restart` (requiring a subprocess kill + wait). There is no documented heartbeat, keepalive, or session-revive endpoint.

**Impact:** Every ~10-15 minutes of real-world usage, the agent loses all window state and must restart the daemon.

### 2.2 Element Token Staleness (Per-Operation Invalidation)

**Problem:** After ANY successful operation (`click`, `type`, `set_value`), all cached AX element indices become stale. Subsequent operations by element index fail with:
```
element_token is stale; call get_window_state again to refresh
```

This means every single interaction requires: `capture → parse SOM → find element → click → capture → parse SOM → find next element → click → ...`

For a form with 20+ fields (our test deal has ~50 data points), this is 50+ round-trips of capture+parse instead of a single batch fill.

**Root cause:** cua-driver's element cache is tied to an in-memory token that the OS Accessibility API invalidates after any mutation. The driver does not re-query the AX tree automatically.

### 2.3 React 18 Synthetic Events — CGEvent Clicks NOT Trusted

**Problem:** cua-driver sends Core Graphics events (CGEventPost). React 18 uses `PointerEvents` and checks `event.isTrusted`. CGEvent-synthesized clicks have `isTrusted: false` and are silently dropped by the SPA.

```javascript
// What React 18 expects (trusted user interaction):
//   pointerdown → mousedown → pointerup → mouseup → click
//   event.isTrusted === true

// What cua-driver sends (CGEvent):
//   CGEventPost(kCGHIDEventTap, mouseDown) 
//   CGEventPost(kCGHIDEventTap, mouseUp)
//   event.isTrusted === false ← React drops this
```

**Impact:** All button clicks, combo-box selections, and link clicks in Salestrekker fail silently when sent via cua-driver. The button appears to be clicked (visual feedback) but the SPA does not execute the handler.

**Workaround:** AppleScript JS injection (see §4).

### 2.4 Foreground Delivery Not Supported

**Problem:** When background delivery fails (the default escalation path), cua-driver v0.8.3 does NOT support `delivery_mode='foreground'`:
```
This cua-driver build does not support foreground delivery (no `input.delivery_mode` capability).
```

**Impact:** There is no fallback from background mode. The agent cannot escalate to a more reliable delivery mechanism.

### 2.5 `set_value` Does Not Trigger React onChange

**Problem:** cua-driver's `set_value` action sets the AXValue attribute of an AXTextField. This does NOT fire React's synthetic `onChange` handler, which is the only way React-controlled inputs register value changes.

**Result:** The field visually appears filled, but the SPA's internal state is unchanged. Submitting the form shows "this field is required" errors on fields that appear filled.

**Workaround:** Requires native property setter via JS injection:
```javascript
var setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype, 'value'
).set;
setter.call(inputElement, 'value');
inputElement.dispatchEvent(new Event('input', {bubbles: true}));
inputElement.dispatchEvent(new Event('change', {bubbles: true}));
```

### 2.6 Multi-Monitor Coordinate / Window Targeting

**Problem:** The user has 3 displays (Built-in Retina, 4K external, iPad Sidecar). Chrome windows span multiple displays with negative coordinates on external displays:
```
Main display:    x=0,    y=38,   w=1512, h=944
4K external:     x=-3840, y=-3216, w=1920, h=2135
iPad (Sidecar):  x=-1920, y=-3216, w=1920, h=2135
```

`cua-driver call list_windows` returns ALL windows but `capture(app='Google Chrome')` grabs the first Chrome window in the list, which is often on the wrong display. Without explicit `pid` + `window_id`, the agent targets the secondary display window (Purple Circle portal) instead of the main display window (Salestrekker app).

**Impact:** The user sees the agent interacting with a window they're not looking at, or getting 0x0 captures from empty Spaces.

### 2.7 0x0 Captures on Non-Current Spaces

**Problem:** macOS Spaces/mission control. Windows on a different Space return:
```
capture mode=vision 0x0 window='...'
0 interactable element(s)
```

cua-driver does not have a "switch to Space" or "bring window to front" capability without disrupting the user.

### 2.8 SOM Output Excessive for Dense UIs

**Problem:** Chrome with 16+ tabs + Salestrekker SPA renders ~800-1000 AX elements. Each SOM capture produces 100-200KB of JSON. When truncated, the agent needs 2-3 additional read_file calls per capture to find elements.

**Impact:** ~30% of tokens per automation turn are consumed by AX tree parsing overhead.

---

## 3. Layer 2: Headless MCP Browser (Hermes Built-In)

### 3.1 No Shared Auth Session

**Problem:** The headless browser runs in a separate Chromium instance with zero shared cookies, IndexedDB, or localStorage with the user's real Chrome profile. Salestrekker requires re-authentication with full 2FA every time.

### 3.2 2FA Timing Constraint

**Problem:** TOTP has a 60-second window. Headless browser login (email → password → TOTP → submit) requires 3-4 sequential API calls with session-state between calls. 60 seconds is tight for multi-turn conversational auth flow.

### 3.3 Bot Detection (Login Blocking)

**Problem:** After 1-2 successful login attempts, Salestrekker's bot detection blocks headless browser sessions:
```
<denied_access>
```
The server sees rapid POSTs to `/auth/sign-in` from automated browser fingerprints (missing GPU, WebGL, font fingerprint mismatches). This is NOT a retry-with-different-tool scenario — the server-level detection is per-IP/fingerprint, not per-tool-name.

### 3.4 CDP Port Binding Failure (macOS Chrome)

**Problem:** Chrome's `--remote-debugging-port` flag is accepted but never opens the port on macOS 15+. Chrome's security policy (hardened runtime, sandbox restrictions) prevents the DevTools Protocol listener from binding. Attempts:
- All fail: CDP port 0, port 9222, any port
- No iptables/firewall block — Chrome itself refuses

### 3.5 File Download Sandbox (No User-Facing Filesystem)

**Problem:** The headless browser's sandboxed environment cannot save downloaded files to the user's `~/Downloads/`. JavaScript-triggered downloads execute but the file goes to `/dev/null` or a sandboxed tmp that's inaccessible to the user.

**Workaround:** Real Chrome via cua-driver + AppleScript, which DOES save to `~/Downloads/`.

---

## 4. Layer 3: AppleScript JavaScript Injection

### 4.1 Prerequisite Toggle Not Persistent

**Problem:** Requires Chrome menu: **View → Developer → Allow JavaScript from Apple Events**. This toggle has been observed to reset:
- After Chrome updates (auto-update)
- After profile changes/switches
- Possibly after system sleep/wake cycles

**Impact:** The agent discovers the toggle is off only when the first `execute` call fails with:
```
Google Chrome got an error: Executing JavaScript through AppleScript is turned off.
```

### 4.2 Multi-Monitor Menu Bar Targeting

**Problem:** `menu bar 1` of `process "Google Chrome"` may resolve to the external display's menu bar even when Chrome is frontmost on the main display. Programmatic toggling of "Allow JavaScript from Apple Events" via `click menu item "Developer"` fails silently — it clicks the wrong display's menu bar.

**Impact:** When the toggle is off, the agent cannot re-enable it programmatically. Requires manual user intervention.

### 4.3 SPA Navigation via `window.location.href` Causes Page Reload

**Problem:** Navigating Salestrekker's SPA via `window.location.href = '/deals/view/{id}'` triggers a full page reload. This:
1. Causes the React app to re-render from scratch (slow, 3-5s)
2. Can trigger sign-out if the SPA's auth check runs before the client-side router intercepts
3. Often leaves the page stuck on "Loading..." indefinitely (seen ~40% of attempts)

**Fix:** Use `window.history.pushState()` instead, which navigates without a page load. However, pushState only works AFTER the SPA has finished initial render — calling it too early (during loading) has no effect.

### 4.4 Modal / Overlay Conflict (Client Portal Share)

**Problem:** Salestrekker shows a "Client portal share" modal (apparently triggered by certain navigation events or auto-detection). This modal overlays the main content area. Clicking elements behind the modal either:
- Clicks through to the modal (dismissing or triggering it)
- Clicks on the obscured content (which doesn't register because the modal has a higher z-index)

**Detection:** The modal has a red warning: "Deal must have a file with 'Privacy disclosure' label to enable sharing the client portal." It appears unpredictably and must be dismissed before any further interaction.

### 4.5 AppleScript String Escaping Complexity

**Problem:** Multi-line AppleScript with embedded JavaScript requires extreme care with quote escaping:
```applescript
set r to execute active tab of window 1 javascript "
    document.querySelector('input[placeholder=\\\"Select one\\\"]')?.click();
"
```
Each escaping mistake breaks the entire AppleScript. Hard to debug because errors are reported as line numbers in the generated AppleScript, not the source.

**Workaround:** Write `.applescript` files to disk and execute via `osascript /tmp/script.applescript` instead of inlining.

---

## 5. Cross-Cutting Issues

### 5.1 No Reliable Element Targeting for React SPAs

**Summary of failures across all three tools:**

| Tool | Method | React 18 Compat? | Reliable? |
|------|--------|-------------------|-----------|
| cua-driver | CGEvent click | ❌ (isTrusted=false) | ❌ |
| cua-driver | element index click | ❌ (stale after 1 use) | ❌ |
| cua-driver | set_value | ❌ (no onChange) | ❌ |
| Headless browser | CDP click | ✅ (isTrusted=true) | ⚠️ (bot detection) |
| AppleScript JS | `.click()` | ⚠️ (no PointerEvent chain) | ⚠️ |
| AppleScript JS | PointerEvent dispatch | ✅ | ✅ (proven) |
| AppleScript JS | Native value setter + events | ✅ | ✅ (proven) |

### 5.2 No Uniquely Reliable Approach — Three Tools, Three Failure Modes

No single tool works for all scenarios:
- cua-driver: Best for screen capture and observation, worst for interaction
- Headless browser: Best for standalone auth flows, blocked by bot detection after 2 attempts
- AppleScript JS: Best for interaction, requires fragile toggle, menu-bar blocked on multi-monitor

### 5.3 Session / State Loss Between Turns

**Problem:** The Hermes agent processes one turn per tool call. SPA page state is not preserved between turns — the DOM re-renders, modals appear/disappear, and element references become stale between any two tool invocations.

**Workaround:** Chain multiple operations in a single `execute_code` invocation or a single AppleScript call.

### 5.4 Gateway Instability

**Problem:** The Hermes gateway (launchd process on port 8642) periodically becomes unloaded:
```
✗ Gateway service is not loaded
⚠ Service definition is stale relative to the current Hermes install
```

**Root cause:** Hermes config migrations or version updates invalidate the launchd plist without triggering reload. The stale-definition detection prevents auto-start.

**Fix:** `hermes gateway start` (addressed by cron-based watchdog, deployed 23 Jul 2026).

### 5.5 Apple Events JS Toggle Not Monitored

**Problem:** There is no watchdog for the "Allow JavaScript from Apple Events" Chrome setting. When it resets, the agent's primary interaction mechanism stops working until the user manually re-enables it.

**Fix:** A 5-second test after every AppleScript JS call could detect the failure and either self-heal (via `cliclick` on the menu bar as fallback) or alert the user.

---

## 6. Environmental Constraints (Non-Negotiable)

### 6.1 Multi-Chrome Profile Confusion

Chrome has multiple profiles (Warren, 8um7547w, Admin, etc.). All share the same PID (637). `cua-driver call list_windows` lists windows by title, not by profile. The agent must infer profile from window title, which changes when navigation occurs.

### 6.2 16+ Chrome Tabs

The Warren profile has 16+ pinned tabs across bookmark groups. The SOM output for any Chrome capture includes AX elements for all open tabs, even tabs on different windows/displays. This inflates every capture by ~50-100KB.

### 6.3 synergy-core Display Sharing

`synergy-core` (KVM software) runs in the background and occasionally intercepts focus events during cua-driver operations, causing the click to land on a different machine's display.

### 6.4 Two Salestrekker-Appearing Windows

The user has two windows that appear related to Salestrekker:
1. `"Salestrekker"` (main display, correct — PID 637, WID 1605)
2. `"Salestrekker - Purple Circle Financial Services"` (external display, wrong — PID 637, WID 677)

The second is the Purple Circle member portal, not the Salestrekker app. Both have "Salestrekker" in the title, making it easy to target the wrong one.

---

## 7. Root Cause Analysis

### Primary Constraint: React 18 PointerEvent Trust Model

The root cause of most interaction failures is React 18's `isTrusted` check on PointerEvents. This is a **by-design security hardening** in React 18 — the framework explicitly rejects programmatic events that don't originate from the browser's input event pipeline.

**React 18 synthetic event pipeline (simplified):**
```
OS HID event → Browser event loop → isTrusted=true → React synthetic event → handler
                                                                         ↑
CGEvent click ─────────────────────────────────────────────────────────┘
                             Event is dispatched but React ignores it
                             because event.isTrusted === false
```

**This is NOT a cua-driver bug** — it's a React 18 framework constraint. Any tool that injects events below the browser's event loop (CGEvent, XTest, Win32 SendInput) will have `isTrusted=false`.

**The only reliable solutions are:**
1. Run JavaScript inside the page context where events are trusted by default (AppleScript JS injection)
2. Use browser DevTools Protocol where `Input.dispatchMouseEvent` sets `isTrusted=true` (but CDP port won't bind on macOS Chrome)
3. Use Playwright's `page.click()` which goes through CDP (same CDP port limitation)

### Secondary Constraint: macOS Chrome CDP Port Lockdown

CmacOS 15+ with Chrome's hardened runtime blocks the `--remote-debugging-port` flag. This is a **security policy decision by Apple + Google** — not a configurable setting. Remote debugging requires launching Chrome with specific flags that trigger "unidentified developer" warnings.

### Tertiary Constraint: Multi-Monitor Window Management

macOS Spaces + 3 displays + multiple Chrome profiles creates a combinatorial explosion of window states. The agent has no reliable way to know which window the user is currently looking at, and bringing windows to the front disrupts the user's workflow.

---

## 8. Recommendations

### Immediate (High Impact, Low Effort)

1. **Persist AppleScript JS in temp files, not inlined** — eliminates quoting errors
2. **Test "Allow JS from Apple Events" before every automation sequence** — detect failure early
3. **Chain multi-field fills in single JS execution** — avoids per-field capture overhead
4. **Increase cua-driver capture refresh cadence** — reduce stale element hits

### Short Term (Medium Impact)

1. **Screenpipe integration for workflow recording** — capture successful workflows once, replay via "pipe" automation
2. **Playwright with `channel: 'chrome'`** — uses real Chrome profile via Launcher API instead of bundled Chromium (may bypass some bot detection)
3. **launchPersistentContext with real profile directory** — shares cookies/extensions with real Chrome

### Medium Term (Highest Impact)

1. **Single-purpose automation script** — a standalone Playwright/Puppeteer script that logs in, fills the test deal, and exits. No agent round-trips, no cua-driver, no AppleScript. Run via `terminal()` in one shot. This eliminates all the per-field overhead and React event problems by doing everything in one browser session.
2. **cua-driver upgrade to v0.9+** — if foreground delivery and React-compatible click injection are added
3. **Gateway watchdog cron** — ✅ Done (23 Jul 2026, every 5min)

### Architectural

1. **Rethink the interaction layer**: Current stack uses three tools for three sub-tasks (observe cua-driver, auth headless, interact AppleScript). A single Playwright script with the real Chrome profile would handle all three in one tool.
2. **Add a workflow cache**: Store successful automation sequences (SOPs) and replay them, rather than rediscovering the UI structure each time.
