# Async Save Polling — Verification Design Lesson (2026-07-29)

## The Bug

The State Engine's Save verification checked for URL change immediately after
clicking Save. On Salestrekker this ALWAYS failed because:

1. The SPA stays on `/deals/add/` after Save (URL never changes)
2. Deals are created asynchronously (30-300s delay)
3. The board updates independently via API poll

Result: every save was reported as `no_state_change_detected`, leading to
10 hours of investigation into React fibers, closure state, event interception,
and OS automation — all of which were red herrings.

## The Fix

### Verification layer (`verification.py`)

1. `_verify_save_async()` — returns `pending_async_save` when no immediate
   state change detected, instead of `fail`

2. `check_save_result(check_url, deal_title, poll_seconds=300, interval=30)`
   — polls the BOARD for the deal title by:
   - Getting body text via state_fn
   - Checking if `deal_title in body_text`
   - 30s interval, 5 minute timeout
   - Returns success when deal title found

### Action engine (`action_engine.py`)

When verification returns `pending_async_save`, the action engine:
1. Extracts the deal title from action params
2. Calls `check_save_result()` with the title
3. If found, returns `success + async_poll` tier
4. If not found after 5 minutes, returns `fail`

## Architectural Lesson

**"Could not observe" is not "does not exist."**

The verification layer was:
- TECHNICALLY correct (URL did not change)
- BUSINESS incorrect (deal was created)

The fix changed the success criterion from a technical signal (URL change) to
a business outcome (deal presence on board). This is the correct pattern for
enterprise SPA automation.

## Priority Order for Save Verification

1. Immediate: Check URL change (fast path — if it changed, we're done)
2. Immediate: Check for error toast (fast path — save definitely failed)
3. Async: Poll board for deal title (30s, 5min timeout)
4. Fallback: Check network for API response (CDP getResponseBody)
