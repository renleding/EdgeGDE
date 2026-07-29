#!/usr/bin/env python3
"""Complete Salestrekker 2.0 Test Deal v3.1 — Phase 1: Deal Creation."""
import time, re, sys, json, pyotp
from patchright.sync_api import sync_playwright

t0 = time.time()
def log(m): print(f"  [{time.time()-t0:5.0f}s] {m}")

pw = sync_playwright().start()
b = pw.chromium.connect_over_cdp('http://localhost:9222')
p = b.contexts[0].pages[0]
cdp = p.context.new_cdp_session(p)

DEAL = "TEST - Smith, S & A, Purch, OO $800K"

# ─── Ensure logged in ───
if '/auth/sign-in' in p.url:
    log("At sign-in page, logging in...")
    p.evaluate("()=>document.querySelector('input[name=\"eMail\"]').focus()")
    time.sleep(0.3); p.keyboard.type('connect@afirmico.com', delay=2)
    p.evaluate("()=>document.querySelector('input[name=\"password\"]').focus()")
    time.sleep(0.3); p.keyboard.type('U2ers$4Ts2HzddKJP%NHJHAJ3mhEqgpq', delay=2)
    p.evaluate("""()=>{for(var b of document.querySelectorAll('button')){if(b.textContent.trim()==='Sign in'){b.removeAttribute('disabled');b.click();return}}}""")
    time.sleep(5)
    if 'two-factor' in p.url.lower():
        code = pyotp.TOTP("MCQNAJGXKIAPUU7MWSCFVQTAQFOVLMPE7AE4KFP223N3IU2ZEVKQ").now()[:6]
        p.evaluate("""()=>{var ins=document.querySelectorAll('input');for(var i of ins){if(i.offsetParent){i.focus();return}}}""")
        time.sleep(0.3)
        for ch in code: p.keyboard.press(ch); time.sleep(0.05)
        time.sleep(1); p.keyboard.press('Enter'); time.sleep(8)

# ─── Navigate to board and create deal ───
p.goto('https://pc.v2.salestrekker.com/deals/board')
time.sleep(8)
log(f"Board: {p.url[:50]}")

# Try multiple approaches to open Add deal
add_success = False
for attempt in range(3):
    # Find Add new button or link
    btn = p.evaluate("""()=>{
        var targets = ['a', 'button', 'span', 'div'];
        for(var tag of targets){
            for(var el of document.querySelectorAll(tag)){
                var t = el.textContent.trim();
                if(t === 'Add new' && el.offsetParent){
                    var r = el.getBoundingClientRect();
                    return {x: r.x + r.width/2, y: r.y + r.height/2, tag: tag, text: t};
                }
            }
        }
        return null;
    }""")
    
    if btn:
        log(f"Clicking Add new at ({btn['x']:.0f},{btn['y']:.0f})")
        cdp.send('Input.dispatchMouseEvent',{'type':'mousePressed','x':btn['x'],'y':btn['y'],'button':'left','clickCount':1})
        cdp.send('Input.dispatchMouseEvent',{'type':'mouseReleased','x':btn['x'],'y':btn['y'],'button':'left','clickCount':1})
        time.sleep(8)
        
        # Check if we navigated to Add deal page
        if 'add' in p.url.lower():
            add_success = True
            break
        
        # Check for deal type selection dialog
        dlg = p.evaluate("""()=>document.querySelector('[role=dialog]')?.querySelector('button')?.click()""")
        time.sleep(3)
        if 'add' in p.url.lower():
            add_success = True
            break
    
    log(f"Attempt {attempt+1} failed, retrying...")
    time.sleep(3)

if not add_success:
    log("Could not open Add new deal — attempting direct URL")
    p.goto('https://pc.v2.salestrekker.com/deals/add')
    time.sleep(10)

log(f"Add deal loaded: {p.url[:50]}")

# ─── Check for workflow type selection dialog ───
# Check if we need to select Home Loan workflow
wf = p.evaluate("""()=>{
    var sel = document.querySelector('[role=listbox], select');
    if(sel) return 'has listbox';
    var dlg = document.querySelector('[role=dialog]');
    if(dlg) return 'has dialog';
    return 'none';
}""")
log(f"Workflow dialog: {wf}")

if 'dialog' in wf or 'listbox' in wf:
    # Select Home loans or Detailed HL
    p.evaluate("""()=>{
        var items = document.querySelectorAll('[role=option], [role=menuitem], [role=button]');
        for(var i of items){
            var t = i.textContent.trim().toLowerCase();
            if((t.includes('home loan') || t.includes('detailed')) && i.offsetParent){
                i.click(); return 'selected';
            }
        }
        return 'not found';
    }""")
    time.sleep(3)
    log("Selected workflow")

# ─── Fill deal info ───
deals_info = p.url[:50]

# Wait for form to render
time.sleep(3)

# Title
name_input = p.evaluate("""()=>{
    var i = document.querySelector('input[name="name"], input[placeholder*="Title"], input[placeholder*="Deal"]');
    if(i) { i.focus(); return i.name || 'found'; }
    return 'not found';
}""")
log(f"Name input: {name_input}")

if name_input != 'not found':
    p.keyboard.type(DEAL, delay=2)
    
    # Value
    val = p.evaluate("""()=>{
        var i = document.querySelector('input[name="value.total"], input[type="number"]');
        if(i) { i.focus(); return i.name; }
        return 'not found';
    }""")
    if val != 'not found':
        p.keyboard.type('640000', delay=2)
    
    # Lead source
    lead = p.evaluate("""()=>{
        var i = document.querySelector('[name="leadSource"], [aria-label*="lead"], [aria-label*="Lead"]');
        if(i) { i.click(); return 'clicked'; }
        return 'not found';
    }""")
    if lead != 'not found':
        time.sleep(1.5)
        p.keyboard.press('ArrowDown'); time.sleep(0.3)
        p.keyboard.press('Enter'); time.sleep(1.5)
    
    log("Deal info filled")
else:
    log("WARNING: Could not find name input")

# ─── Save ───
save_clicked = p.evaluate("""()=>{
    for(var b of document.querySelectorAll('button')){
        var t = b.textContent.trim();
        if(t === 'Save' || t === 'Next'){
            if(!b.disabled && b.offsetParent){
                b.removeAttribute('disabled');
                b.click();
                return t + ' clicked';
            }
        }
    }
    return null;
}""")
log(f"Save: {save_clicked}")

if save_clicked:
    log("Waiting for deal creation (up to 5min)...")
    prev_url = p.url
    for i in range(300):
        time.sleep(1)
        u = p.url
        if u != prev_url and '/deals/view/' in u:
            log(f"*** DEAL CREATED after {i+1}s ***")
            log(f"URL: {u[:60]}")
            break
        if i > 0 and i % 30 == 0:
            log(f"  [{i+1}s] {u[:50]}")
        prev_url = u
    else:
        log("No navigation detected — checking board for deal...")
        p.goto('https://pc.v2.salestrekker.com/deals/board')
        time.sleep(8)
        txt = p.evaluate("()=>document.body.innerText")
        if DEAL[:40] in txt:
            log("*** DEAL FOUND ON BOARD (async creation) ***")
        else:
            log("Deal not found on board either")

log(f"\nPhase 1 complete at {time.time()-t0:.0f}s")
pw.stop()
