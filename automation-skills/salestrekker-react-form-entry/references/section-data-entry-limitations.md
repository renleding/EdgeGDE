# Section Data Entry Persistence Findings (27 Jul 2026)

## Overview
The home loan editor sections (Assets, Liabilities, Income, Expenses, etc.) use a different React state management pattern than the deal creation form. Data filled via CDP evaluate setters or locator.type() shows in the DOM but does NOT persist when Save is clicked.

## Verified Persistence Matrix

### Deal Creation Form — ✅ WORKS
| Field | Approach | Persists? |
|-------|----------|-----------|
| Title | `locator.type()` | ✅ |
| Value | evaluate prototype setter + input/change events | ✅ |
| Lead source | evaluate on role="option" | ✅ |
| Contact | CDP mouse event + keyboard select + evaluate click Add | ✅ |
| Save | evaluate click on enabled button | ✅ |

### Home Loan Editor Sections — ❌ FAILS
| Section | Fields | Result |
|---------|--------|--------|
| Assets (Vehicle) | name, vehicleBuildDate, value, vehicleRegoNumber | ❌ DOM filled, Save returns ok, data gone on reload |
| Client Profile | firstName, lastName, etc. | ❌ Same (script interrupted before verify) |

## Suspected Root Cause
The asset/liability/expense editors use React controlled form components where:
1. Each field has a React state variable initialized as empty string
2. The `<input>` displays `state.value` as its visible value
3. `onChange` handler updates the state with `event.target.value`
4. Save handler reads `formState` (React state), NOT the DOM

When CDP sets `input.value = 'BMW 3 Series'`:
- The DOM shows "BMW 3 Series" (visible to human)
- React state stays `''` (empty)
- Save sends `''` to the server
- On reload, the empty state is displayed

`locator.type()` dispatches keyboard events that SHOULD trigger `onChange`... but in the asset editor, these keyboard events may go to the wrong field (due to focus issues) or be intercepted by the Radix combobox wrapper.

## Attempted Fixes That All Failed
1. `page.locator('input[name="name"]').last.type('BMW', delay=2)` — field fills but Save doesn't persist
2. `page.keyboard.type('BMW')` after focus — same
3. evaluate prototype setter + dispatchEvent('input') — same
4. Vehicle type selection + all fields filled + pointerdown on Save — same
5. CDP Input.dispatchKeyEvent for each character — same
6. Scrolling field into view + focus + type — same

## Most Likely Fix (Untested)
The asset editor's fields are inside a `<fieldset>` or `<form>` that uses `useRef` or `useForm` with a submit handler that reads from refs, not the DOM. The fix would be to:
1. Use locator.click() to focus each field
2. Use keyboard.type() to send real keystrokes
3. Ensure FOCUS is on each field before typing
4. Use page.keyboard.press('Tab') to move between fields (triggers onBlur which may flush state)
5. Use locator.click() for Save (not evaluate)

OR: Use CUA (T4) for the entire data entry flow — CUA sends genuine OS-level events that React cannot distinguish from human input.
