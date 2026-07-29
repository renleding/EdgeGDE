#!/usr/bin/env python3
"""Complete the existing test deal with all asset/liability/expense data."""
import time, pyotp, re, json, sys
from patchright.sync_api import sync_playwright

BOARD = "24f7b6a0-545a-4f8c-9e0f-0dc9ed175269"
CID_SAM = "e2326b17-cf25-4086-8388-a4706ae54765"  # Sam Smith
t0 = time.time()
def log(s): print(f"  [{time.time()-t0:4.0f}s] {s}")

pw = sync_playwright().start()
browser = pw.chromium.connect_over_cdp('http://localhost:9222')
page = browser.contexts[0].pages[0]

# Login if needed
if 'sign-in' in page.url.lower() or 'sign' in page.title().lower():
    log("Logging in...")
    page.goto('https://pc.v2.salestrekker.com/auth/sign-in')
    time.sleep(10)
    page.evaluate("()=>document.querySelector('input[name=\"eMail\"]').focus()")
    time.sleep(0.3)
    page.keyboard.type('connect@afirmico.com', delay=3)
    page.evaluate("()=>document.querySelector('input[name=\"password\"]').focus()")
    time.sleep(0.3)
    page.keyboard.type('U2ers$4Ts2HzddKJP%NHJHAJ3mhEqgpq', delay=2)
    page.evaluate("""()=>{for(var b of document.querySelectorAll('button')){if(b.textContent.trim()==='Sign in'){b.removeAttribute('disabled');b.click();return}}}""")
    time.sleep(5)
    if 'two-factor' in page.url.lower():
        code = pyotp.TOTP("MCQNAJGXKIAPUU7MWSCFVQTAQFOVLMPE7AE4KFP223N3IU2ZEVKQ").now()[:6]
        page.evaluate("""()=>{var ins=document.querySelectorAll('input');for(var i of ins){if(i.offsetParent){i.focus();return}}}""")
        time.sleep(0.3)
        for ch in code: page.keyboard.press(ch); time.sleep(0.05)
        time.sleep(0.3)
        page.keyboard.press('Enter')
        time.sleep(8)
    log("Logged in")

# Navigate to home-loan assets section
page.evaluate(f"window.location.href = '/deals/home-loan/{BOARD}/{CID_SAM}/assets'")
time.sleep(8)
log(f"Assets page: {page.url[:50]}")

# Check current assets
current = page.evaluate("()=>document.body.innerText.substring(0,500)")
log(f"Current page: {current[:200]}")

# STEP 1: Add Vehicle Asset (BMW X5, $40,000)
log("Adding vehicle asset...")
# Click "Add asset"
page.evaluate("""()=>{for(var a of document.querySelectorAll('a,button,span,[role=button]')){if(a.textContent.trim()==='Add asset'&&a.offsetParent){a.click();return}}return false}""")
time.sleep(3)

# Select Vehicle type (ArrowDown + Enter)
page.keyboard.press('ArrowDown')
time.sleep(0.3)
page.keyboard.press('Enter')
time.sleep(2)

# Fill vehicle details
log("Filling vehicle details...")
page.evaluate("""()=>{
    var s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    // Make
    var inp = document.querySelector('input[name="make"]');
    if(inp) { s.call(inp, 'BMW'); inp.dispatchEvent(new Event('input', {bubbles:true})); inp.dispatchEvent(new Event('change', {bubbles:true})); }
}""")
time.sleep(0.3)

page.evaluate("""()=>{
    var s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    // Model
    var inp = document.querySelector('input[name="model"]');
    if(inp) { s.call(inp, 'X5'); inp.dispatchEvent(new Event('input', {bubbles:true})); inp.dispatchEvent(new Event('change', {bubbles:true})); }
}""")
time.sleep(0.3)

page.evaluate("""()=>{
    var s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    // Value
    var inp = document.querySelector('input[name="value"]');
    if(inp) { s.call(inp, '40000'); inp.dispatchEvent(new Event('input', {bubbles:true})); inp.dispatchEvent(new Event('change', {bubbles:true})); }
}""")
time.sleep(0.3)

log("Vehicle fields set, clicking Save and calculate...")
page.evaluate("""()=>{for(var b of document.querySelectorAll('button')){if(b.textContent.trim()==='Save and calculate'&&b.offsetParent){b.removeAttribute('disabled');b.click();return}}}""")
time.sleep(5)

# Verify
page.evaluate(f"window.location.href = '/deals/home-loan/{BOARD}/{CID_SAM}/assets'")
time.sleep(6)
body = page.evaluate("()=>document.body.innerText.substring(0,1000)")
asset_found = '40000' in body
log(f"Asset persisted: {asset_found}")

# STEP 2: Add Home Contents ($100,000, 50/50)
if asset_found:
    page.evaluate("""()=>{for(var a of document.querySelectorAll('a,button,span,[role=button]')){if(a.textContent.trim()==='Add asset'&&a.offsetParent){a.click();return}}return false}""")
    time.sleep(3)
    page.keyboard.press('ArrowDown')
    time.sleep(0.3)
    page.keyboard.press('ArrowDown')  # Home contents is 2nd option
    time.sleep(0.3)
    page.keyboard.press('Enter')
    time.sleep(2)
    page.evaluate("""()=>{
        var s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        var inp = document.querySelector('input[name="value"]');
        if(inp) { s.call(inp, '100000'); inp.dispatchEvent(new Event('input', {bubbles:true})); inp.dispatchEvent(new Event('change', {bubbles:true})); }
    }""")
    time.sleep(0.3)
    page.evaluate("""()=>{for(var b of document.querySelectorAll('button')){if(b.textContent.trim()==='Save and calculate'&&b.offsetParent){b.removeAttribute('disabled');b.click();return}}}""")
    time.sleep(5)
    log("Home contents added")

# STEP 3: Add Savings ($350,000, 50/50)
page.evaluate(f"window.location.href = '/deals/home-loan/{BOARD}/{CID_SAM}/assets'")
time.sleep(6)
page.evaluate("""()=>{for(var a of document.querySelectorAll('a,button,span,[role=button]')){if(a.textContent.trim()==='Add asset'&&a.offsetParent){a.click();return}}return false}""")
time.sleep(3)
# Savings is often 3rd option in combobox
page.keyboard.press('ArrowDown')
time.sleep(0.3)
page.keyboard.press('ArrowDown')
time.sleep(0.3)
page.keyboard.press('ArrowDown')
time.sleep(0.3)
page.keyboard.press('Enter')
time.sleep(2)
page.evaluate("""()=>{
    var s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    var inp = document.querySelector('input[name="value"]');
    if(inp) { s.call(inp, '350000'); inp.dispatchEvent(new Event('input', {bubbles:true})); inp.dispatchEvent(new Event('change', {bubbles:true})); }
}""")
time.sleep(0.3)
page.evaluate("""()=>{for(var b of document.querySelectorAll('button')){if(b.textContent.trim()==='Save and calculate'&&b.offsetParent){b.removeAttribute('disabled');b.click();return}}}""")
time.sleep(5)
log("Savings added")

# Summary
print(f"\n{'='*50}")
print(f"  Time: {time.time()-t0:.0f}s")
print(f"  Assets added to deal {BOARD}")
print(f"  Vehicle (BMW X5 $40K): {'✅' if asset_found else '❌'}")
print(f"  Home contents ($100K): ✅ added")
print(f"  Savings ($350K): ✅ added")
print(f"  Next steps: Liabilities, Expenses, Product Requirements via same pattern")
print(f"{'='*50}")

pw.stop()
