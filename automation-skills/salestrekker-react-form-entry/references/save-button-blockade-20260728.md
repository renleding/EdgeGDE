# Save Button Blockade — Full Diagnostic (28 Jul 2026)

## Symptom
All form fields filled via keyboard/evaluate, Lead source selected, Contact added. Save button stays disabled.

## Investigation Results

### 1. Title Input Has No React Fibers
`Object.keys(input).filter(k => k.startsWith('__react'))` returns `[]` — no `__reactFiber$`, `__reactProps$`, `__reactState$`. The input is NOT React-controlled.

### 2. Save Button Has React Props
The Save button DOES have `__reactProps$`. Its `onClick` is a function. But calling `onClick()` doesn't trigger API calls.

### 3. Save Button onClick Returns Early
Removing `disabled` attribute and clicking the Save button produces ZERO network requests. The onClick handler validates internal React state (not DOM), finds it invalid, and returns without making any API call.

### 4. fetch Interception Fails
window.fetch interceptors injected after SPA load are silently overwritten by the SPA's bundled code. XHR interceptors also fail.

### 5. page.keyboard.type() Works for Title/Value
`page.keyboard.type('text', delay=3)` after `focus()` fills fields correctly. But this still doesn't enable the Save button — the parent component's form state (React Hook Form or custom) doesn't propagate DOM changes.

### 6. CDP Network.requestWillBeSent Not Tried
The CDP `Network.enable` + `requestWillBeSent` event was not fully tested. This would show ALL outbound requests including any the Save button triggers.

## Working Techniques From Earlier Script (create_deal_v2.py)
The `create_deal_v2.py` script successfully created deals on an earlier Salestrekker build. It used:
- `page.locator().type()` for all inputs (worked on earlier CfT version)
- `page.locator('button:has-text("Save")').click()` for Save (button was enabled)

## Conclusion
The current Salestrekker build has changed its form architecture. The Save button's disabled state is managed by a parent React component that doesn't propagate DOM value changes to its internal state. The only reliable workaround is to POST directly to the GraphQL API, bypassing the React form entirely — but the API endpoint and payload schema need to be discovered via CDP network monitoring.
