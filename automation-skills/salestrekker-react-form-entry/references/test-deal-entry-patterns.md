# Test Deal Entry — Discovered Patterns (27 Jul 2026)

## Add Deal Form (B. Home loans)

### Required fields to unlock Save
1. **Title** — `input[name="name"]`
2. **Lead source** — first `[role="combobox"]`, select "Existing client"
3. **At least one contact** — "Add existing person" for Sam/Amy Smith
4. **Value** — `input[name="value.total"]`, type "800000" (renders as "$ 800,000")

### Lead source selection (unreliable via evaluate)
`page.evaluate().click()` on `[role="option"]` with text "Existing client" often
registers visually but reverts to "Select one" on re-render.
**Working approach:** Use `page.keyboard.type('Existing client')` then
`page.keyboard.press('Enter')` after clicking the combobox.

### Value field quirks
- Selector: `input[name="value.total"]`
- Formatting: typing "800000" shows "$ 800,000" on blur
- Bug observed: typing "800000" showed "$ 8,000,000" (8M) — may be
  interference from previous value or cursor position. **Fix:** triple-click
  to select all before typing.

### Contact search dialog
After clicking "Add existing person", a dialog appears with:
- Search input = `input[name="query"]` (second occurrence — first is Owner field)
- Results appear as `[role="option"]` elements
- "Add" button in the dialog to confirm

## Login Detection

### Page title states
| Title text | State |
|------------|-------|
| "Sign in | Salestrekker" | Not authenticated |
| "2F authentication | Salestrekker" | TOTP required |
| "Dashboard: Sales | Afirmico | Salestrekker" | Authenticated |
| "Loading ..." | SPA loading (may be transient) |

### CfT profile auto-fill
The Chrome for Testing profile `8um7547w` has saved credentials.
After `page.goto()` to sign-in, check `input.value` before filling:

```python
email_val = page.evaluate("""() => {
    return document.querySelector('input[type="email"]')?.value || '';
}""")
```

## Section URLs (Home Loan editor)

Base URL pattern:
```
/deals/home-loan/{DEAL_ID}/{CONTACT_ID}/{section}
```

| Section | URL suffix |
|---------|------------|
| Client profile (applicant 1) | `/applicant-1` |
| Assets | `/assets` |
| Liabilities | `/liabilities` |
| Income | `/income` |
| Expenses | `/expenses` |
| Needs and objectives | `/needs-and-objectives` |
| Product requirements | `/product-requirements` |
| Insurance | `/insurance` |
| Other advisers | `/other-advisers` |
| Security details | `/security-details` |
| Funding worksheet | `/funding-worksheet` |
| Product search | `/products-search` |
| Compare products | `/compare-products` |
| Commissions | `/commissions` |
| Compliance comments | `/compliance-comments-and-documents` |
| Summary | `/summary` |

## Data Persistence Verification

After filling fields and clicking Save/Next:
1. Navigate away from the section (click another section in sidebar)
2. Navigate back to verify values persisted
3. Use `page.evaluate()` to read `input.value` after reload

If data didn't persist despite appearing to save:
- Try `page.locator().type()` instead of evaluate setter
- Try `page.locator().click()` instead of evaluate `.click()`
- Check for server-side validation errors (HTTP 200 with `status:true,errors:null`
  but field value silently discarded — observed with `lenderPolicy:most_important`)
