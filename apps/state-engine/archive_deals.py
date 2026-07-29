#!/usr/bin/env python3
"""Archive all test deals on the board."""
import time, re
from patchright.sync_api import sync_playwright

BOARD = "24f7b6a0-545a-4f8c-9e0f-0dc9ed175269"
t0 = time.time()
def log(m): print(f"  [{time.time()-t0:5.0f}s] {m}")

pw = sync_playwright().start()
b = pw.chromium.connect_over_cdp('http://localhost:9222')
p = b.contexts[0].pages[0]
cdp = p.context.new_cdp_session(p)

# ─── Ensure logged in — DO NOT LOGIN FROM SCRIPT ───
if '/auth/sign-in' in p.url.lower():
    log("Session expired — login manually in CfT browser first")
    pw.stop()
    exit(1)

log("Session active")

# Navigate to board
p.goto('https://pc.v2.salestrekker.com/deals/board')
time.sleep(12)
log(f"URL: {p.url[:50]}")

# Verify board loaded
txt = p.evaluate("()=>document.body.innerText")
log(f"Board content: {txt[:100]}")

# Get list of deals by scanning for "HOME LOAN" markers, then find the adjacent title
deals = p.evaluate("""()=>{
    var result = [];
    var body = document.body.innerText;
    var lines = body.split('\\n');
    for(var i = 0; i < lines.length; i++){
        var line = lines[i].trim();
        if(line === 'HOME LOAN'){
            // Next non-empty line should be the deal title
            for(var j = i+1; j < lines.length; j++){
                var next = lines[j].trim();
                if(next && next !== 'CREATED' && !next.startsWith('$')){
                    result.push(next);
                    break;
                }
            }
        }
    }
    return result;
}""")
log(f"Deals from text: {deals}")

archived = 0
failed = 0

for di, deal_title in enumerate(deals):
    log(f"[{di+1}/{len(deals)}] Archiving: {deal_title[:40]}")
    
    # Find the deal card position from its title
    card = p.evaluate(f"""()=>{{
        for(var el of document.querySelectorAll('*')){{
            var t = (el.textContent||'').trim();
            if(t === '{deal_title}' && el.offsetParent){{
                var r = el.getBoundingClientRect();
                return {{x: Math.round(r.x+r.width/2), y: Math.round(r.y+r.height/2)}};
            }}
        }}
        return null;
    }}""")
    
    if not card:
        log(f"  Could not find card on board")
        failed += 1
        continue
    
    # Click the deal title to open it
    cdp.send('Input.dispatchMouseEvent',{'type':'mousePressed','x':card['x'],'y':card['y'],'button':'left','clickCount':1})
    cdp.send('Input.dispatchMouseEvent',{'type':'mouseReleased','x':card['x'],'y':card['y'],'button':'left','clickCount':1})
    time.sleep(6)
    
    if 'sign-in' in p.url.lower():
        log("  Session expired — stopping")
        break
    
    # Find "Change deal" button
    change_btn = p.evaluate("""()=>{
        var btns = document.querySelectorAll('button, a, span');
        for(var b of btns){
            var t = (b.textContent||'').trim().toLowerCase();
            if(t === 'change deal' && b.offsetParent){
                var r = b.getBoundingClientRect();
                return {x: Math.round(r.x+r.width/2), y: Math.round(r.y+r.height/2)};
            }
        }
        return null;
    }""")
    
    if change_btn:
        # Click Change deal
        cdp.send('Input.dispatchMouseEvent',{'type':'mousePressed','x':change_btn['x'],'y':change_btn['y'],'button':'left','clickCount':1})
        cdp.send('Input.dispatchMouseEvent',{'type':'mouseReleased','x':change_btn['x'],'y':change_btn['y'],'button':'left','clickCount':1})
        time.sleep(3)
        
        # Check for dropdown menu with options
        arch_opt = p.evaluate("""()=>{
            var items = document.querySelectorAll('[role=menuitem], [role=option], li');
            for(var i of items){
                var t = (i.textContent||'').trim().toLowerCase();
                if((t.includes('archiv') || t.includes('settled') || t.includes('not proceed') || t.includes('remov')) && i.offsetParent){
                    var r = i.getBoundingClientRect();
                    return {text: i.textContent.trim(), x: Math.round(r.x+r.width/2), y: Math.round(r.y+r.height/2)};
                }
            }
            return null;
        }""")
        
        if arch_opt:
            log(f"  Clicking: {arch_opt['text']}")
            cdp.send('Input.dispatchMouseEvent',{'type':'mousePressed','x':arch_opt['x'],'y':arch_opt['y'],'button':'left','clickCount':1})
            cdp.send('Input.dispatchMouseEvent',{'type':'mouseReleased','x':arch_opt['x'],'y':arch_opt['y'],'button':'left','clickCount':1})
            time.sleep(3)
            
            # If a dialog appears for date/notes, save it
            save_btn = p.evaluate("""()=>{
                for(var b of document.querySelectorAll('button')){
                    var t = (b.textContent||'').trim();
                    if(t === 'Save' && b.offsetParent){
                        b.removeAttribute('disabled');
                        b.click(); return 'saved';
                    }
                }
                return null;
            }""")
            log(f"  Save: {save_btn}")
            time.sleep(3)
            archived += 1
        else:
            log("  No archive/settle option found in dropdown")
            failed += 1
            # Close dropdown by pressing Escape
            p.keyboard.press('Escape')
            time.sleep(1)
    else:
        log("  No 'Change deal' button found")
        failed += 1
    
    # Navigate back to board
    p.evaluate(f"window.location.href = '/deals/board/{BOARD}'")
    time.sleep(5)

log(f"\n=== Done: {archived} archived, {failed} failed ===")
log(f"Time: {time.time()-t0:.0f}s")
pw.stop()
