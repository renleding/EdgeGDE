# Salestrekker Add Deal Form Architecture (28 Jul 2026)

## React Fiber Analysis

### Title Input
- `allReactKeys: []` — NO `__reactFiber$`, `__reactProps$`, `__reactState$`
- No `_valueTracker`. `valueSetterIsOverridden: false`
- Conclusion: NOT a React controlled component

### Value Input (name="value.total")
- `allReactKeys: []` — NO React properties
- Standard DOM input with formatting (prefixes "$ " to values)

### Lead Source Combobox (name="leadSource")
- `allReactKeys: []` — NO React properties
- Standard Radix combobox (handles keyboard ArrowDown+Enter natively)

### Save Button
- `allReactKeys: []` — NO React properties (current build)
- `onclick: null` → `typeof null === 'object'`
- Event handler via `addEventListener` with `handleEvent` object

## Form Validation Architecture

Save button enabled/disabled NOT controlled by individual input React components
but by a **parent wrapper component**. This parent reads DOM values via refs
(React.createRef) attached during render, or a mutation observer/DOM read in
useEffect/useLayoutEffect. Or uses React Hook Form's `register()` with refs.

The parent's state determines Save button `disabled`. Keyboard events
(`page.keyboard.type`) trigger React's synthetic event system which IS captured
by the Ref-based reading. But even when enabled, clicking Save fires the handler
which validates against internal state and returns early if state doesn't match DOM.

## Event System — Why Everything Fails

| Method | Trusted? | Result |
|--------|----------|--------|
| `element.click()` | Trusted (but only on enabled elements) | ❌ addEventListener handlers NOT called on disabled buttons |
| `dispatchEvent(new MouseEvent(...))` | ❌ Untrusted (`isTrusted=false`) | React v17+ may check isTrusted and drop the event |
| CDP `Input.dispatchMouseEvent` | ✅ Trusted | Handler checks internal state → returns early → zero API calls |
| pyautogui OS click | ✅ Trusted (CGEvent) | Same handler constraint — internal state mismatch |

## What DID Work on Earlier Build

`create_deal_v2.py` used `page.locator('button:has-text("Save")').first.click()`.
This worked because the previous ST build used `onclick` property (not addEventListener)
and form state was synchronized with DOM values. The SPA redirected on success.

## Verified Approaches

### Works ✅
- `page.keyboard.type()` for Title/Value (focus first)
- CDP `Input.dispatchMouseEvent` for Radix menus/combobox options
- CDP mouse dispatch for sidebar navigation
- `page.evaluate` prototype setter for home-loan editor fields
- `page.locator('button:has-text("Save")').click()` — ONLY on older ST builds

### Fails ❌
- All programmatic clicks on Save button (current build)
- `dispatchEvent` with any event type (untrusted)
- pyautogui OS click on Save (same internal state check)
