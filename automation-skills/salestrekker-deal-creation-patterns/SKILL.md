---
name: salestrekker-deal-creation-patterns
description: Proven patterns for creating Salestrekker 2.0 deals on CfT
---

# Salestrekker Deal Creation Patterns

## Overview
Create a deal on Salestrekker 2.0 via CDP (CfT browser `8um7547w` on port 9222) using a coordinated multi-tier approach.

## 4-Tier Sensory Array
- **T0**: CDP Patchright (`page.evaluate`, `page.locator`)
- **T1**: Chrome MCP (`browser_console` DOM access)
- **T2**: Browser-act CLI (real browser events)
- **T3**: Qwen3 VL vision (`vision_analyze`)
- **T4**: CUA-driver (`computer_use` OS-level events)

## Proven Working Patterns

### 1. Login (via CfT CDP)
```python
page.locator('button:has-text("Sign in")').first.click()  # locator.click triggers React
```
Credentials auto-filled by CfT profile. For TOTP use `page.keyboard.type(code, delay=60)`.

### 2. SPA Navigation
- NEVER use `page.goto()` to authenticated URLs (triggers sign-out)
- Use `page.evaluate("window.location.href = '/path'")` for SPA navigation
- Only `/auth/sign-in` is safe for `page.goto()`

### 3. Form Field Filling
- **Title**: `page.locator('input[name="name"]').first.type('...', delay=2)`
- **Value**: Use evaluate prototype setter (NOT .type() — causes $8M formatting bug):
```python
page.evaluate("""()=>{var i=document.querySelector('input[name="value.total"]');if(i){var s=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;s.call(i,'800000');i.dispatchEvent(new Event('input',{bubbles:true}));i.dispatchEvent(new Event('change',{bubbles:true}));}}""")
```
- **Lead source**: Click label sibling then click option:
```python
page.evaluate("""()=>{var spans=document.querySelectorAll('span,div,label');for(var s of spans){if(s.textContent.trim()==='Lead source'){var sibling=s.parentElement.nextElementSibling;if(sibling){var combo=sibling.querySelector('[role="combobox"]')||sibling;if(combo.getAttribute('role')==='combobox'){combo.click();return}}}}return false}""")
```

### 4. Add Contact (Radix Popup)
- Use CDP `Input.dispatchMouseEvent` for Radix triggers (NOT evaluate click)
- **KEY INSIGHT**: Radix Primitives listen for `pointerdown` events, NOT `click` or `mousedown`
  - Use: `new Event('pointerdown', { bubbles: true })` to trigger Radix handlers
  - This is why `b.click()`, `dispatchEvent(new MouseEvent('click'))`, and CDP mouse events all failed
- **KNOWN ISSUE**: ArrowDown+Enter for selecting existing contact causes "SamSam SmithSmith" name duplication

#### Fix for Radix Button Click
```javascript
// To trigger a Radix button handler:
const event = new Event('pointerdown', { bubbles: true });
button.dispatchEvent(event);
// This fires the correct Radix event handler
```

### 5. Save
- Check Save enabled, then `page.evaluate click`

## Known Failures
- Radix "Add existing person" → Add button cannot be clicked programmatically
- Evaluate.click() on Radix button doesn't trigger React handlers
- CDP Input.dispatchMouseEvent on Radix button doesn't work
- Tab navigation doesn't reach dialog action buttons
- ArrowDown+Enter for result selection causes name duplication ("SamSam SmithSmith")
- `page.goto()` to authenticated SPA URLs causes sign-out
- Currency field `.type()` produces $8M instead of $800K (use evaluate setter)
