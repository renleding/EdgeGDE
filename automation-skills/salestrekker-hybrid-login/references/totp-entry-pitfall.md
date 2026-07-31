# TOTP Entry Pitfall

## The Evaluate Setter Trap

The 2FA TOTP input is a React controlled component that only registers values typed via **real keyboard events**. Using `page.evaluate()` with the prototype setter will visually fill the field but React will not register the value, causing the form to redirect to the recovery page on submit.

### Fails silently:
```python
# WRONG: field fills visually but React ignores it
page.evaluate(f"()=>{{var i=document.querySelector('input');if(i){{
    var s=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
    if(s){{s.call(i,'{code}');i.dispatchEvent(new Event('input',{{bubbles:true}}));
    i.dispatchEvent(new Event('change',{{bubbles:true}}));}}}}}}")
page.keyboard.press('Enter')
# Result: navigates to /auth/two-factor-authentication-recovery
```

### Works correctly:
```python
code = pyotp.TOTP(secret).now()[:6]
page.evaluate("()=>{var i=document.querySelector('input');if(i)i.focus();}")
time.sleep(0.5)
for ch in code:
    page.keyboard.press(ch)
    time.sleep(0.05)
page.keyboard.press('Tab')
page.keyboard.press('Enter')
time.sleep(8)
# Result: navigates to dashboard
```

## Diagnostic: Check Page Title After TOTP Submit

After pressing Enter on the TOTP form, check the page title:
- `'dashboard'` or `'deals'` → authenticated
- `'two-factor authentication recovery'` → TOTP failed (evaluate setter used or wrong code)
- `'sign in'` → session expired, need full re-login
- `'two-factor authentication'` → TOTP not submitted or input empty

Recovery page URL: `/auth/two-factor-authentication-recovery`
To recover: navigate back to `/auth/sign-in` and try again with keyboard events.
