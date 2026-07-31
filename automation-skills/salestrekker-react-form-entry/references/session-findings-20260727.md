# Session Findings — 27 Jul 2026 (Updated)

## Test 10 Deal — Last Clean Deal
- Title: "Test 10 - Purple Circle"
- Deal ID: 24f7b6a0-545a-4f8c-9e0f-0dc9ed175269
- Contact ID: e2326b17-cf25-4086-8388-a4706ae54765
- Value: $800,000 (correct via evaluate setter)
- Lead source: Existing client
- Contact: Sam Smith (clean, no duplication)
- Status: Created on board, no section data filled

## Key Discoveries This Session

### 1. Dialog Detection was Wrong
The earlier worry about "SmithSmith" name duplication was a false alarm. 
- `document.querySelector('[role="dialog"]') !== null` returns True even when dialog is visually hidden
- Check `offsetParent !== null` instead
- Contacts were being added CLEANLY (Sam Smith once, not SamSam SmithSmith)

### 2. Radix Event Model (Research)
Stack Overflow confirmed: Radix buttons listen for `pointerdown` with `{bubbles: true}`, NOT click/mousedown. This explains why ALL click approaches failed. Untested in practice on Salestrekker's Add button.

### 3. Asset Section Data Entry Does Not Persist
THIS is the real unsolved problem — not the contact dialog. Every known CDP method fails to persist asset data:
- locator.type() fills DOM but Save reads React state (empty)
- evaluate setter same
- keyboard.type() same  
- pointerdown on Save same

### 4. Lead Source Label Sibling Traversal
`page.keyboard.type('Existing client')` often hits the DEAL TYPE combobox instead of LEAD SOURCE. Use label sibling traversal instead.

### 5. Verify Section Scrolled Into View
Asset fields at Y coordinate -34 (off-screen) received keystrokes that went to the wrong element. Always scroll fields into view and verify Y > 50 before filling.

### 6. Save URL Stays on /deals/add/
Even when deal IS created, the SPA stays on `/deals/add/...` URL. Always navigate to the board to verify.

## Corrections from Previous Sessions
- "SmithSmith" duplication: Was a DISPLAY artifact, not data corruption. Contacts were clean.
- CUA session daemon runs but existing sessions cannot be revived. New session must be created.
- browser-act sessions time out quickly (seconds). Not reliable for multi-step flows.
- `page.evaluate("window.location.href")` works for SPA nav but requires SPA to be initialized first.
