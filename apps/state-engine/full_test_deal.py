#!/usr/bin/env python3
"""Salestrekker 2.0 Test Deal v3.1 — Phase 1: Deal Creation (fixed timing)."""
import time, re, sys, json
from patchright.sync_api import sync_playwright

t0 = time.time()
def log(m): print(f"  [{time.time()-t0:5.0f}s] {m}")

pw = sync_playwright().start()
b = pw.chromium.connect_over_cdp('http://localhost:9222')
p = b.contexts[0].pages[0]
cdp = p.context.new_cdp_session(p)

# ─── Ensure logged in — DO NOT LOGIN FROM SCRIPT ───
if '/auth/sign-in' in p.url.lower():
    log("At sign-in page — session expired. Please login manually in the CfT browser.")
    log("Cannot proceed without active session. Aborting.")
    pw.stop()
    exit(1)

log("Session appears active")

DEAL = "TEST - Smith, S & A, Purch, OO $800K"

# ─── Navigate to Add deal via page.goto ───
# page.goto() fully hydrates the SPA for this URL
p.goto('https://pc.v2.salestrekker.com/deals/add')
time.sleep(12)
log(f"URL: {p.url[:50]}")

# Check for workflow type dialog
wf_dlg = p.evaluate("""()=>{
    var dlg = document.querySelector('[role=dialog]');
    if(dlg) return dlg.textContent.substring(0,200);
    var lb = document.querySelector('[role=listbox]');
    if(lb) return 'listbox: ' + lb.textContent.substring(0,100);
    return 'none';
}""")
log(f"Dialog: {wf_dlg[:80]}")

# Select workflow if dialog is present
if 'dialog' in wf_dlg.lower() or 'listbox' in wf_dlg.lower():
    p.evaluate("""()=>{
        var opts = document.querySelectorAll('[role=option], [role=menuitem], button');
        for(var o of opts){
            var t = o.textContent.trim().toLowerCase();
            if(t.includes('home loan') || t.includes('detailed') || t.includes('home loans')){
                o.click(); return 'clicked: ' + t;
            }
        }
        // Try clicking dialog button directly
        var btns = document.querySelectorAll('[role=dialog] button');
        for(var b of btns){
            if(b.offsetParent){ b.click(); return 'clicked dialog btn'; }
        }
        return 'no match';
    }""")
    time.sleep(8)  # Critical: wait for form to render after selection
    log("Workflow selected, waiting for form...")

# ─── Check all inputs on page ───
inputs = p.evaluate("""()=>{
    var all = document.querySelectorAll('input');
    return Array.from(all).map(i => ({name: i.name, type: i.type, ph: i.placeholder, id: i.id, visible: !!i.offsetParent})).slice(0, 15);
}""")
log(f"Inputs on page: {len(inputs)}")
for inp in inputs:
    log(f"  name={inp['name']:25s} type={inp['type']:10s} visible={inp['visible']}")

# ─── Find and fill name field ───
name_input = p.evaluate("""()=>{
    var i = document.querySelector('input[name="name"], input[placeholder*="Title"], input[placeholder*="Deal"]');
    if(i && i.offsetParent) { i.focus(); return true; }
    // Search all visible inputs
    for(var inp of document.querySelectorAll('input')){
        if(inp.offsetParent && (inp.type === 'text' || inp.type === '')){
            if(!inp.value || inp.value.trim() === ''){
                inp.focus(); return 'found at ' + inp.name;
            }
        }
    }
    return false;
}""")
log(f"Name input found: {name_input}")

if name_input:
    p.keyboard.type(DEAL, delay=2)
    
    # Value field
    val_input = p.evaluate("""()=>{
        for(var inp of document.querySelectorAll('input')){
            if(inp.offsetParent && (inp.type === 'number' || inp.name.includes('value') || inp.name.includes('total'))){
                if(!inp.value || inp.value === '0' || inp.value === ''){
                    inp.focus(); return inp.name || 'found';
                }
            }
        }
        return false;
    }""")
    if val_input:
        time.sleep(0.3); p.keyboard.type('640000', delay=2)
        log(f"Value filled: {val_input}")
    
    # Lead source
    lead = p.evaluate("""()=>{
        for(var inp of document.querySelectorAll('input, [role=combobox], select')){
            var n = inp.name || inp.id || '';
            if(n.toLowerCase().includes('lead') || n.toLowerCase().includes('source')){
                inp.click(); return true;
            }
        }
        return false;
    }""")
    if lead:
        time.sleep(1.5); p.keyboard.press('ArrowDown'); time.sleep(0.3)
        p.keyboard.press('Enter'); time.sleep(1.5)
        log("Lead source selected")
    
    log("Deal info filled")
else:
    log("WARNING: Could not find focusable input")
    # Debug: print all text on page
    txt = p.evaluate("()=>document.body.innerText.substring(0,500)")
    log(f"Page text: {txt[:200]}")

# ─── Save ───
save_btn = p.evaluate("""()=>{
    for(var b of document.querySelectorAll('button')){
        var t = b.textContent.trim();
        if(t === 'Save' && b.offsetParent){
            b.removeAttribute('disabled');
            b.click();
            return 'clicked';
        }
        if(t === 'Next' && b.offsetParent){
            b.click();
            return 'clicked Next';
        }
    }
    return null;
}""")
log(f"Save: {save_btn}")

if save_btn:
    log("Waiting for deal creation (up to 5min)...")
    for i in range(300):
        time.sleep(1)
        if '/deals/view/' in p.url:
            log(f"*** DEAL CREATED after {i+1}s ***")
            break
        if i > 0 and i % 30 == 0:
            log(f"  [{i+1}s] {p.url[:50]}")
    else:
        log("No navigation — checking board")
        p.goto('https://pc.v2.salestrekker.com/deals/board')
        time.sleep(8)
        txt = p.evaluate("()=>document.body.innerText")
        if DEAL[:20] in txt:
            log("*** DEAL FOUND ON BOARD ***")
        else:
            log("Deal not found")

log(f"\nTime: {time.time()-t0:.0f}s")
pw.stop()
