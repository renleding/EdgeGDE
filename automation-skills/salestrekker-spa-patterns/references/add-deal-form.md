# Add Deal Form — Field Map & Flow

## Page Flow

```
B. Home loans board → "Add new" button → Add deal form
```

Deal type defaults to "Home loan". Owner defaults to "Warren Ledingham".

## Required Fields

| Field | Selector | Notes |
|-------|----------|-------|
| Title | `input[name="name"]` | Must be > 0 chars |
| Lead source | `[role="combobox"]` containing "Select one" | Click to open, select `[role="option"]` |
| At least 1 contact | Via Add contact + Add existing person | Sam Smith already in DB |

## Optional Fields

| Field | Selector | Notes |
|-------|----------|-------|
| Value | `input[name="value.total"]` | NOT `aria-label="Value"`, NOT `name="value"` |
| Team member(s) | `input[name="teamMember"]` | Can leave empty |
| Partner(s) | `input[name="partners"]` | Can leave empty |

## Contact Addition Flow

### Add existing person (contacts already in Salestrekker) — USUALLY BLOCKED

Steps to attempt:
1. CDP `Input.dispatchMouseEvent` on `div[aria-haspopup="menu"]` parent of "Add contact" button
2. Click `[role="menuitem"]` with text "Add existing person" via page.evaluate()
3. Search: find the EMPTY `input[name="query"]` field (first is Owner, pre-filled; second is search)
4. Type "Sam Smith" via locator.type()

⚠️ **KNOWN BLOCKER**: Step 4 works (search populates), but selecting a contact result fails via all automation approaches. The Radix portal `[role="option"]` elements require REAL browser mouse events that CDP/Playwright/CUA can't deliver. The "Add" button stays disabled.

### Add new person (fresh contact, NOT in database) ✅ WORKS

1. Same CDP mouse event on popup trigger
2. Click `[role="menuitem"]` with text "Add new person" via page.evaluate()
3. Fill `input[name="firstName"]`, `input[name="lastName"]` via locator.type()
4. Fill `input[type="email"]` (email), `input[name="value"]` (phone) via locator.type()
5. Click "Add" button — may still fail if Radix blocks the button

## Value Field — Currency Formatting Fix

The Value field (`input[name="value.total"]`) has a formatting bug when using CDP `.type()`:

- **Typing "800000" via `.type()`** → displays "$8,000,000" (wrong — 10x amount)
- **Typing "800000" via browser_act `browser_type`** → displays "$800,000" (correct)
- **Setting via evaluate native setter** → displays "$800,000" (correct):

```python
page.evaluate("""() => {
    var i = document.querySelector('input[name="value.total"]');
    if(i) {
        var s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        s.call(i, '800000');
        i.dispatchEvent(new Event('input', {bubbles: true}));
        i.dispatchEvent(new Event('change', {bubbles: true}));
    }
}""")
```

## Save Behavior

Save button is disabled until ALL required fields are filled (Title + Lead source + 1 contact).
When Save is clicked, the page may stay on `/deals/add/...` URL — check the B. Home loans board to confirm creation.

## Common Issues

- **Value shows $8,000,000 instead of $800,000**: Caused by CDP `.type()` keystrokes being misinterpreted by the currency formatter. Fix: use evaluate native setter + dispatchEvent input/change.
- **browser-act shows correct value**: `browser_type` sends real keyboard events that the currency formatter handles correctly. CDP `.type()` does NOT.
- **Lead source reverts to "Select one"**: evaluate click didn't trigger React. Use `locator()` click or keyboard navigation instead.
- **Save stays disabled**: Missing Lead source selection (most common) or contact not fully added.
- **Title/name duplication**: Title may appear twice in page header (e.g. "Test 4 - Purple Circle OnboardingTest 4 - Purple Circle Onboarding"). This is a SPA display bug from adding contact after title was set.
- **Fresh start**: Always navigate explicitly to the add deal URL before starting. Previous failed attempts leave the page in an inconsistent state.
- **Auto-fix visible errors**: If you see "$8,000,000" instead of "$800,000" or any other formatting error on screen, fix it immediately — don't ask for permission.
