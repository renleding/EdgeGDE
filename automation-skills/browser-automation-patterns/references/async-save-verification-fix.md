# Async Save Verification — Session Evidence (2026-07-29)

## The Finding

The Salestrekker Save button **always worked**. The verification layer was checking for URL change (which never occurs) instead of polling the board for the deal title. This caused 10+ hours of debugging into incorrect theories.

## Proven by Controlled Test

```
Test: NO interceptor, pure b.click() on enabled Save button
Result: Deal appeared on board in 3 seconds
URL: Never changed from /deals/add/...
Verification: Would have returned no_state_change_detected (wrong)
```

## Total Evidence

6 deals created on 2026-07-28/29 across different test methods:
- Test Interceptor (interceptor ON) → found on board
- Test Interceptor v2 → found on board
- Test Long Wait Save → found on board
- Repro Test v2 → found on board (script reported "no deal created in 180s")
- Async Poll Test → found on board
- No Interceptor Test → found on board in 3s (pure b.click())

## Implication

The interceptor (addEventListener Proxy with isTrusted override) showed CORRELATION
with deal creation but was NOT the cause. The same `b.click()` + keyboard fill
created a deal in 3 seconds without it. The interceptor happened to be active
during earlier successful runs because the test script always injected it.

## Corrected Verification Strategy

```python
# OLD (wrong): check URL change
if '/deals/view/' in page.url:
    return success

# NEW (correct): poll board for deal title
def poll_board(deal_title, timeout_s=300, interval_s=30):
    start = time.time()
    while time.time() - start < timeout_s:
        time.sleep(interval_s)
        # Navigate to board
        page.evaluate(f"window.location.href = '/deals/board/{BOARD_ID}'")
        time.sleep(2)
        body = page.evaluate("() => document.body.innerText")
        if deal_title in body:
            return True
        # Navigate back to Add deal
        page.evaluate(f"window.location.href = '/deals/board/{BOARD_ID}'")
        time.sleep(2)
        page.evaluate("""()=>{for(var a of document.querySelectorAll('a,button,span,[role=button]')){
            if(a.textContent.trim()==='Add new'&&a.offsetParent){a.click();return}
        }}""")
        time.sleep(6)
    return False
```

## Root Cause Summary

| Layer | What Went Wrong |
|-------|-----------------|
| Verification | Checked URL → got false → marked failure |
| Framework ASSUMED broken | React fibers, closure state, event interception — all unnecessary |
| Actual fix | Poll board for business outcome (deal title) |
