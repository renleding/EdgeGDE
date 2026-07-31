# Radix pointerdown Discovery (27 Jul 2026)

## Problem
Radix UI buttons in Salestrekker's "Add existing person" dialog cannot be triggered by:
- `element.click()` — dispatches `click`, Radix ignores
- `dispatchEvent(new MouseEvent('click'))` — same
- CDP `Input.dispatchMouseEvent({type: 'mousePressed'})` — sends `mousedown`, Radix ignores
- `document.createEvent('MouseEvents').initEvent('click')` — Radix ignores
- `locator().click()` — times out after 30s due to overlay interception

## Root Cause
Radix UI Primitives listen for **`pointerdown`** events on their trigger components, NOT `click`, `mousedown`, or `mouseup`. The React synthetic event system attached by Radix only fires on `pointerdown` with `bubbles: true`.

## Fix
```python
button.dispatchEvent(new Event('pointerdown', {bubbles: true, cancelable: true}));
```

Button must be visible AND enabled (`!button.disabled`). If disabled, Radix handler won't fire.

## Dialog Detection
`document.querySelector('[role="dialog"]') !== null` returns True even when dialog is visually hidden. Use:
```python
dialog_visible = document.querySelector('[role="dialog"]')?.offsetParent !== null
```

## Source
Stack Overflow: "How to click Radix UI React dropdown menu using Selenium IDE" — pointerdown with bubbles:true.
