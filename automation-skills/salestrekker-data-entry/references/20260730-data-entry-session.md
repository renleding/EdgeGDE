# 30 Jul 2026 — Full Deal Data Entry Session

## Summary

Attempted to fill all 13 sections of Test Deal - Smith, S & A, $800K 
(deal `24f7b6a0-545a-4f8c-9e0f-0dc9ed175269`, contact `a62141fb-fc7a-41d5-b452-eb226997a280`).

## Key Discovery: `window.location.href` Causes Sign-out

Repeated SPA navigation via `page.evaluate("window.location.href = '...'")` 
triggers sign-out after ~5-10 navigations. The session degrades gradually:
1. Page returns empty `body.innerText` (0 lines)
2. Body text contains only "Deals: B. Home loans" and "WL" (partial render)
3. Final redirect to `/auth/sign-out`

**First sign of trouble: verification returns empty text but no sign-out page.**
This is a session-expiry warning, not a loading delay.

## React Form Persistence Confirmed

The persistence matrix from `salestrekker-data-entry` was re-validated:
- **evaluate setter (prototype + dispatchEvent)**: Works only for some sections.
- **keyboard typing (page.keyboard.type)**: Same result — React discards.
- **Liabilities, Income, Needs, Insurance**: Partial success with evaluate.
- **Assets, Expenses, Product Requirements**: No method works.

The root cause: React controlled forms maintain internal state separate from DOM.
The Save button submits React state (empty), not DOM values (filled).

## Home Loan Editor Entry Flow

Correct path to enter the home loan editor without triggering sign-out:
1. Navigate to board: `/deals/board/{deal_id}`
2. Click deal card (via `window.location.href` to `/deals/view/{deal_id}/{contact_id}`)
3. Deal view loads with tabs: "Home loan", "Change deal", "Add client", etc.
4. Click the "Home loan" tab → navigates to `/deals/home-loan/{deal_id}/{contact_id}/applicant-1`
5. Section links appear in the sidebar as `<a class="_U0 _R0">` elements

## Scripts Created

- `test-deal-complete-fill.py` — First attempt. Unawaited coroutines caused silent data loss.
- `test-deal-phase2.py` — Amy profile, risks, product, insurance, security, funding.
- `test-deal-complete-v2.py` — Properly awaited version of phase 1.
- `test-deal-v3.py` — Keyboard-typing approach (page.keyboard.type + Tab) for React persistence.

## CfT Tab Management

- `curl -s http://localhost:9222/json` with 0 tabs = session fully dead
- Create tab: `curl -X PUT "http://localhost:9222/json/new?url"`
- Both regular Chrome AND CfT may be on port 9222 simultaneously. Check PIDs.
- `ctx.new_page()` fails with "Browser context management is not supported" for CfT profiles
