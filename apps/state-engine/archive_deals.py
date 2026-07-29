"""Archive all deals on the board — uses page.goto for navigation."""
import time
from patchright.sync_api import sync_playwright

BOARD = "24f7b6a0-545a-4f8c-9e0f-0dc9ed175269"
t0 = time.time()
def log(m): print(f"  [{time.time()-t0:5.0f}s] {m}")

pw = sync_playwright().start()
b = pw.chromium.connect_over_cdp('http://localhost:9222')
p = b.contexts[0].pages[0]
cdp = p.context.new_cdp_session(p)

# Load board via page.goto (works with specific board ID)
p.goto(f'https://pc.v2.salestrekker.com/deals/board/{BOARD}')
time.sleep(10)
log(f"Board loaded: {p.url[:50]}")

# Get deals
deals = p.evaluate("""()=>{var ls=document.body.innerText.split('\\n');var r=[];for(var i=0;i<ls.length;i++){if(ls[i].trim()==='HOME LOAN'){for(var j=i+1;j<ls.length;j++){var n=ls[j].trim();if(n&&n!=='CREATED'&&!n.startsWith('$')){r.push(n);break}}}}return r}""")
log(f"Deals ({len(deals)}): {deals}")

archived = 0
failed = 0

for di, dt in enumerate(deals):
    log(f"[{di+1}/{len(deals)}] {dt[:35]}")
    
    card = p.evaluate(f"""()=>{{for(var el of document.querySelectorAll('*')){{var t=(el.textContent||'').trim();if(t==='{dt}'&&el.offsetParent){{var r=el.getBoundingClientRect();return{{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}}}}}}return null;}}""")
    if not card: log(f"  no card"); failed += 1; continue
    
    cdp.send('Input.dispatchMouseEvent',{'type':'mousePressed','x':card['x'],'y':card['y'],'button':'left','clickCount':1})
    cdp.send('Input.dispatchMouseEvent',{'type':'mouseReleased','x':card['x'],'y':card['y'],'button':'left','clickCount':1})
    time.sleep(6)
    
    btn = p.evaluate("""()=>{for(var b of document.querySelectorAll('button')){var t=(b.textContent||'').trim().toLowerCase();if(t==='change deal'&&b.offsetParent){var r=b.getBoundingClientRect();return{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}}}return null}""")
    if btn:
        cdp.send('Input.dispatchMouseEvent',{'type':'mousePressed','x':btn['x'],'y':btn['y'],'button':'left','clickCount':1})
        cdp.send('Input.dispatchMouseEvent',{'type':'mouseReleased','x':btn['x'],'y':btn['y'],'button':'left','clickCount':1})
        time.sleep(2)
        
        opt = p.evaluate("""()=>{for(var i of document.querySelectorAll('[role=menuitem],li')){var t=(i.textContent||'').trim().toLowerCase();if(t.includes('not proceed')&&i.offsetParent){i.click();return i.textContent.trim()}}return null}""")
        if not opt:
            opt = p.evaluate("""()=>{for(var i of document.querySelectorAll('[role=menuitem],li')){var t=(i.textContent||'').trim().toLowerCase();if(t.includes('remove')&&i.offsetParent){i.click();return i.textContent.trim()}}return null}""")
        log(f"  {opt}")
        time.sleep(2)
        if opt:
            p.evaluate("""()=>{for(var b of document.querySelectorAll('button')){var t=(b.textContent||'').trim();if(t==='Save'&&!b.disabled&&b.offsetParent){b.removeAttribute('disabled');b.click();return}}return null}""")
            time.sleep(3)
            archived += 1
    else:
        log(f"  no Change deal — trying archived status")
        # Try finding "Settled" option directly in the deal view
        status_opts = p.evaluate("""()=>{
            var all = document.querySelectorAll('*');
            for(var el of all){
                var t = el.textContent.trim().toLowerCase();
                if((t === 'settled' || t === 'archived' || t === 'not proceeding' || t === 'remove from board') && el.offsetParent){
                    el.click(); return el.textContent.trim();
                }
            }
            return null;
        }""")
        if status_opts:
            log(f"  Direct: {status_opts}")
            time.sleep(2)
            p.evaluate("""()=>{for(var b of document.querySelectorAll('button')){var t=(b.textContent||'').trim();if(t==='Save'&&!b.disabled&&b.offsetParent){b.removeAttribute('disabled');b.click();return}}return null}""")
            time.sleep(3)
            archived += 1
        else:
            failed += 1
    
    # Back to board
    p.goto(f'https://pc.v2.salestrekker.com/deals/board/{BOARD}')
    time.sleep(5)

log(f"\n=== Done: {archived} archived, {failed} failed ===")
log(f"Time: {time.time()-t0:.0f}s")
pw.stop()
