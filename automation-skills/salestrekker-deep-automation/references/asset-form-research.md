# Asset Form Data Entry — Research Log (28 Jul 2026)

## Problem
Cannot persist asset/expense/liability data in Salestrekker 2.0 home loan editor sections using any CDP-based automation technique.

## Research Sources Consulted
1. StackOverflow #40894637 — setNativeValue function using `_valueTracker`
2. Cory Rylan's blog — prototype setter + dispatchEvent for React controlled inputs
3. Nick Korbel's blog — Selenium-specific prototype setter for React
4. React source code — InputValueTracking.js (_valueTracker mechanism)
5. Simular AI Agent-S — `github.com/simular-ai/Agent-S`

## Key Technical Findings

### Finding 1: Asset form inputs are NOT React-controlled
Evidence from CDP Runtime.evaluate:
```
inputOwnKeysCount: 0
inputFiberKey: None
inputPropsKey: None
_valueTracker: none
formCount: 0
valueSetterSameAsPrototype: True
```

### Finding 2: Save button uses addEventListener, not onclick
```
onclick: null
ownKeys: []  (via page.evaluate)
ownKeys: __reactFiber$vh8jbm6pwh, __reactProps$vh8jbm6pwh  (via CDP Runtime.evaluate)
```

### Finding 3: page.evaluate() hides React properties
CDP Runtime.evaluate reveals properties that page.evaluate() cannot see. This is because page.evaluate() serializes through the JavaScript API which drops React-injected symbols, while Runtime.evaluate serializes through CDP which preserves them.

### Finding 4: All CDP fill methods visually work but Save doesn't persist
All tested approaches fill the DOM value (confirmed by reading input.value before Save) but the Save handler reads from React fiber state (memoizedState), not the DOM.

## Tried Approaches (All Failed)

| Date | Approach | Result |
|------|----------|--------|
| 28 Jul | `page.evaluate()` prototype setter + input/change events | DOM filled, data lost |
| 28 Jul | `locator.type('BMW 3 Series', delay=2)` | DOM filled, data lost |
| 28 Jul | `keyboard.type()` character-by-character | DOM filled, data lost |
| 28 Jul | Vehicle type combobox (ArrowDown+Enter) + all fields | Type set, fields filled, data lost |
| 28 Jul | `pointerdown` event on Save button | Handler ran, data lost |
| 28 Jul | `dispatchEvent(new Event('click', {bubbles:true}))` on Save | Handler ran, data lost |
| 28 Jul | `props.onClick()` via CDP Runtime.evaluate | Handler called "anonymous", data lost |
| 28 Jul | CDP Input.dispatchMouseEvent on Save | Same as evaluate |
| 28 Jul | CDP Input.dispatchKeyEvent for each keystroke | DOM filled, data lost |
| 28 Jul | locator.click() for Save button | Same as evaluate |
| 28 Jul | Tab + Enter keyboard navigation to Save | Same |
| 28 Jul | Delete ALL vehicles first, then add one | Clean state but data still lost |

## Approaches Yet to Try

1. **pyautogui CGEvents**: `pip install gui-agents` → `pyautogui.typewrite()` sends real OS-level keystrokes. Requires window-to-screen coordinate calculation.

2. **React fiber state traversal**: From Save button's `__reactFiber$`, traverse alternate/child/sibling to find the component with `memoizedState` containing form data, then call its state setter:
```javascript
var fiberKey = Object.getOwnPropertyNames(saveBtn).find(k => k.startsWith('__reactFiber$'));
var fiber = saveBtn[fiberKey];
// Navigate up/down the fiber tree to find form state
```

3. **GraphQL API sniffing**: Set up CDP Network.requestWillBeSent listener, manually click Save in CfT, capture the POST payload.
