# Async Save Verification — Correction to Prior Findings

**Date:** 29 Jul 2026  
**Session:** 10+ hour investigation into Salestrekker Save button

## The Real Problem

The Save button on the Add deal page **was working correctly the entire time**. The verification engine was wrong.

## What Was Actually Happening

```
b.click() on Save
    ↓
Async API call (no response returned to page)
    ↓
Page stays on /deals/add/...  ← URL NEVER changes
    ↓
2-5 minutes later
    ↓
Deal appears on the board
```

## What We Got Wrong

Every hypothesis proposed and tested was unnecessary:

| Hypothesis | Verdict |
|-----------|--------|
| React 18 rejecting automation events | ❌ Disproven |
| Formik/closure state isolation | ❌ Disproven |
| Need Fiber mutation | ❌ Disproven |
| Need event interceptor | ❌ Disproven |
| Need OS-level input | ❌ Disproven |
| Need internal API bypass | ❌ Disproven |
| **Verification timing bug** | **✅ Proven** |

## What Works

**Save button:** `b.click()` on the enabled Save button. No interceptor, no React hack, no OS event, no CDP magic needed.

**Verification:** Poll the board for the deal title. Do NOT check URL change:

```python
# DO NOT use URL-based verification
if '/deals/view/' in page.url:  # ❌ Will NEVER fire
    return success

# Instead, poll the board for deal title
import re
for i in range(300):  # Up to 5 min
    time.sleep(1)
    if i % 15 == 0:
        page.evaluate(
            f"window.location.href = '/deals/board/{BOARD_ID}'"
        )
        time.sleep(2)
        body = page.evaluate("() => document.body.innerText")
        if deal_title in body:
            print(f"*** DEAL FOUND after {i+1}s ***")
            break
```

## Key Facts

- **5 deals created with interceptor** (all worked)
- **1 deal created WITHOUT interceptor** (3s to appear, proved interceptor unnecessary)
- **Save latency:** 3s to 5min (unpredictable async processing)
- **URL never changes:** SPA stays on `/deals/add/...` indefinitely
- **Board shows deal** when refreshed (regardless of current Add page state)

## The State Engine Fix

The verification engine was updated to:

1. `_verify_save_async()` — returns `pending_async_save` instead of `fail` when no immediate state change detected
2. `check_save_result()` — polls board content for deal title (30s interval, 5min timeout)
3. `action_engine.execute()` — invokes async polling when verification returns `pending_async_save`

## Hard Rule: Never Login from Scripts

This session triggered account lockout due to 5+ login attempts. All automation scripts now:

- Check session status (URL contains `/auth/sign-in` → exit 1)
- **Never** include credential fill or TOTP code
- Report "Session expired" and stop, rather than attempting to authenticate

## Corrected Claim

> "The Save button does not work through any automation technique."

**False.** The Save button works with `b.click()`. The verification layer was looking at the wrong signal (URL change instead of board content).
