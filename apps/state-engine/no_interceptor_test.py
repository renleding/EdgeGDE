"""Interceptor OFF — pure b.click() without any patching."""
import time, re
from patchright.sync_api import sync_playwright

BOARD = "24f7b6a0-545a-4f8c-9e0f-0dc9ed175269"
TEST_NAME = "No Interceptor Test"
t0 = time.time()
def log(m): print(f"  [{time.time()-t0:4.0f}s] {m}")

pw = sync_playwright().start()
b = pw.chromium.connect_over_cdp('http://localhost:9222')
p = b.contexts[0].pages[0]

# Navigate to board
p.evaluate(f"window.location.href = '/deals/board/{BOARD}'")
time.sleep(6)

# Verify NO interceptor
h_val = p.evaluate("() => window.__h")
log(f"Interceptor present: {h_val}")

# Navigate to Add deal
p.evaluate("""()=>{for(var a of document.querySelectorAll('a,button,span,[role=button]')){if(a.textContent.trim()==='Add new'&&a.offsetParent){a.click();return}}return false}""")
time.sleep(12)
log(f"URL: {p.url[:50]}")

# Fill Title
p.evaluate("()=>document.querySelector('input[name=\"name\"]').focus()")
time.sleep(0.3); p.keyboard.type(TEST_NAME, delay=2)

# Fill Value
p.evaluate("()=>document.querySelector('input[name=\"value.total\"]').focus()")
time.sleep(0.3); p.keyboard.type('800000', delay=2)

# Lead source
p.evaluate("()=>document.querySelector('[name=\"leadSource\"]').click()")
time.sleep(1.5); p.keyboard.press('ArrowDown'); time.sleep(0.3); p.keyboard.press('Enter'); time.sleep(1.5)

# Contact via CDP
cdp_session = p.context.new_cdp_session(p)
box = p.evaluate("""()=>{for(var b of document.querySelectorAll('button')){
    if(b.textContent.trim()==='Add contact'&&b.offsetParent){
        var el=b;while(el){if(el.getAttribute('aria-haspopup')==='menu'){
            var r=el.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}
        }el=el.parentElement}
    }
}return null}""")

if box:
    # Click Add contact via CDP mouse
    cdp_session.send('Input.dispatchMouseEvent',{'type':'mousePressed','x':box['x'],'y':box['y'],'button':'left','clickCount':1})
    cdp_session.send('Input.dispatchMouseEvent',{'type':'mouseReleased','x':box['x'],'y':box['y'],'button':'left','clickCount':1})
    time.sleep(2)
    
    # Click Add existing person via CDP mouse
    for item in p.evaluate("""()=>{return Array.from(document.querySelectorAll('[role=menuitem]')).filter(i=>i.offsetParent).map(i=>({t:i.textContent.trim(),x:i.getBoundingClientRect().x+i.getBoundingClientRect().width/2,y:i.getBoundingClientRect().y+i.getBoundingClientRect().height/2}))}"""):
        if 'Add existing person' in item['t']:
            cdp_session.send('Input.dispatchMouseEvent',{'type':'mousePressed','x':item['x'],'y':item['y'],'button':'left','clickCount':1})
            cdp_session.send('Input.dispatchMouseEvent',{'type':'mouseReleased','x':item['x'],'y':item['y'],'button':'left','clickCount':1})
            time.sleep(2); break
    
    # Search for Sam Smith via keyboard
    p.locator('input[name="query"]').last.type('Sam Smith', delay=5)
    time.sleep(3)
    p.keyboard.press('ArrowDown'); time.sleep(0.3)
    p.keyboard.press('ArrowDown'); time.sleep(0.3)
    p.keyboard.press('Enter'); time.sleep(3)
    
    # Click Add button
    p.evaluate("""()=>{for(var b of document.querySelectorAll('button')){if(b.textContent.trim()==='Add'&&!b.disabled&&b.offsetParent){b.click();return}}}""")
    time.sleep(4)
    log("Contact added")

# Check Save button
save = p.evaluate("""()=>{for(var b of document.querySelectorAll('button')){if(b.textContent.trim()==='Save')return{disabled:b.disabled}}return null}""")
log(f"Save: {save}")

if save and not save['disabled']:
    # Click Save — NO interceptor, just b.click()
    p.evaluate("""()=>{for(var b of document.querySelectorAll('button')){if(b.textContent.trim()==='Save'){b.removeAttribute('disabled');b.click();return}}}""")
    click_t = time.time()
    log("Save clicked (NO interceptor)")
    
    # Poll board every 15s for up to 5min
    found = False
    for i in range(300):
        time.sleep(1)
        if i % 15 == 0:
            p.evaluate(f"window.location.href = '/deals/board/{BOARD}'")
            time.sleep(2)
            body = p.evaluate("() => document.body.innerText")
            if TEST_NAME in body:
                latency = time.time() - click_t
                log(f"*** DEAL FOUND after {latency:.0f}s ***")
                if i % 30 == 0 and i > 0:
                    pass
                found = True
                break
            # Navigate back to add deal page for next poll
            p.evaluate(f"window.location.href = '/deals/board/{BOARD}'")
            time.sleep(2)
            p.evaluate("""()=>{for(var a of document.querySelectorAll('a,button,span,[role=button]')){if(a.textContent.trim()==='Add new'&&a.offsetParent){a.click();return}}return false}""")
            time.sleep(6)
        if i > 0 and i % 60 == 0:
            log(f"  waiting... {i}s")
    
    if not found:
        log("NOT FOUND after 5min — interceptor MAY be required")
else:
    log("Save disabled")

pw.stop()
