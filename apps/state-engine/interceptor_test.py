"""Interceptor ON vs OFF test + latency measurement."""
import time, re, sys, json
from patchright.sync_api import sync_playwright

BOARD = "24f7b6a0-545a-4f8c-9e0f-0dc9ed175269"
t0 = time.time()
def log(m): print(f"  [{time.time()-t0:4.0f}s] {m}")

INTERCEPTOR_CODE = """
(function(){
    if(window.__h) return;
    window.__h = true;
    var _a = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function(t, h, o) {
        if(typeof h === 'function' && (t === 'click' || t === 'input' || t === 'change')) {
            var w = function() {
                var a = Array.from(arguments);
                if(a[0] && a[0].type) {
                    a[0] = new Proxy(a[0], {
                        get: function(target, prop) {
                            if(prop === 'isTrusted') return true;
                            return typeof target[prop] === 'function' ? target[prop].bind(target) : target[prop];
                        }
                    });
                }
                return h.apply(this, a);
            };
            return _a.call(this, t, w, o);
        }
        if(typeof h === 'object' && h.handleEvent && (t === 'click' || t === 'input' || t === 'change')) {
            var origHandle = h.handleEvent.bind(h);
            h.handleEvent = function() {
                var a = Array.from(arguments);
                if(a[0] && a[0].type) {
                    a[0] = new Proxy(a[0], {
                        get: function(target, prop) {
                            if(prop === 'isTrusted') return true;
                            return typeof target[prop] === 'function' ? target[prop].bind(target) : target[prop];
                        }
                    });
                }
                return origHandle.apply(this, a);
            };
            return _a.call(this, t, h, o);
        }
        return _a.call(this, t, h, o);
    };
})();
"""

def run_test(with_interceptor, test_name):
    pw = sync_playwright().start()
    b = pw.chromium.connect_over_cdp('http://localhost:9222')
    p = b.contexts[0].pages[0]
    
    # Navigate to board
    p.evaluate(f"window.location.href = '/deals/board/{BOARD}'")
    time.sleep(6)
    
    if with_interceptor:
        p.evaluate(INTERCEPTOR_CODE)
        log(f"Interceptor ON: {p.evaluate('()=>!!window.__h')}")
    else:
        log("Interceptor OFF")
    
    # Click Add new
    p.evaluate("""()=>{for(var a of document.querySelectorAll('a,button,span,[role=button]')){if(a.textContent.trim()==='Add new'&&a.offsetParent){a.click();return}}return false}""")
    time.sleep(12)
    
    # Fill
    p.evaluate("()=>document.querySelector('input[name=\"name\"]').focus()")
    time.sleep(0.3); p.keyboard.type(test_name, delay=2)
    p.evaluate("()=>document.querySelector('input[name=\"value.total\"]').focus()")
    time.sleep(0.3); p.keyboard.type('800000', delay=2)
    p.evaluate("()=>document.querySelector('[name=\"leadSource\"]').click()")
    time.sleep(1.5); p.keyboard.press('ArrowDown'); time.sleep(0.3); p.keyboard.press('Enter'); time.sleep(1.5)
    
    # Contact
    cdp_session = p.context.new_cdp_session(p)
    box = p.evaluate("""()=>{for(var b of document.querySelectorAll('button')){
        if(b.textContent.trim()==='Add contact'&&b.offsetParent){
            var el=b;while(el){if(el.getAttribute('aria-haspopup')==='menu'){
                var r=el.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}
            }el=el.parentElement}
        }
    }return null}""")
    if box:
        cdp_session.send('Input.dispatchMouseEvent',{'type':'mousePressed','x':box['x'],'y':box['y'],'button':'left','clickCount':1})
        cdp_session.send('Input.dispatchMouseEvent',{'type':'mouseReleased','x':box['x'],'y':box['y'],'button':'left','clickCount':1})
        time.sleep(2)
        for item in p.evaluate("""()=>{return Array.from(document.querySelectorAll('[role=menuitem]')).filter(i=>i.offsetParent).map(i=>({t:i.textContent.trim(),x:i.getBoundingClientRect().x+i.getBoundingClientRect().width/2,y:i.getBoundingClientRect().y+i.getBoundingClientRect().height/2}))}"""):
            if 'Add existing person' in item['t']:
                cdp_session.send('Input.dispatchMouseEvent',{'type':'mousePressed','x':item['x'],'y':item['y'],'button':'left','clickCount':1})
                cdp_session.send('Input.dispatchMouseEvent',{'type':'mouseReleased','x':item['x'],'y':item['y'],'button':'left','clickCount':1})
                time.sleep(2); break
        p.locator('input[name="query"]').last.type('Sam Smith', delay=5)
        time.sleep(3)
        p.keyboard.press('ArrowDown'); time.sleep(0.3)
        p.keyboard.press('ArrowDown'); time.sleep(0.3)
        p.keyboard.press('Enter'); time.sleep(3)
        p.evaluate("""()=>{for(var b of document.querySelectorAll('button')){if(b.textContent.trim()==='Add'&&!b.disabled&&b.offsetParent){b.click();return}}}""")
        time.sleep(4)
    
    # Save
    save = p.evaluate("""()=>{for(var b of document.querySelectorAll('button')){if(b.textContent.trim()==='Save')return{disabled:b.disabled}}return null}""")
    log(f"Save: {save}")
    
    if save and not save['disabled']:
        p.evaluate("""()=>{for(var b of document.querySelectorAll('button')){if(b.textContent.trim()==='Save'){b.removeAttribute('disabled');b.click();return}}}""")
        click_t = time.time()
        log(f"[{test_name}] Save clicked")
        
        # Poll for deal on board — every 15s, up to 5min
        found = False
        for i in range(300):
            time.sleep(1)
            # Check board
            if i % 15 == 0:
                p.evaluate(f"window.location.href = '/deals/board/{BOARD}'")
                time.sleep(2)
                body = p.evaluate("() => document.body.innerText")
                if test_name in body:
                    latency = time.time() - click_t
                    log(f"*** DEAL FOUND after {latency:.0f}s ***")
                    found = True
                    pw.stop()
                    return {'test': test_name, 'interceptor': with_interceptor, 'success': True, 'latency_s': round(latency)}
                # Go back to add deal page
                p.evaluate(f"window.location.href = '/deals/board/{BOARD}'")
                time.sleep(2)
                p.evaluate("""()=>{for(var a of document.querySelectorAll('a,button,span,[role=button]')){if(a.textContent.trim()==='Add new'&&a.offsetParent){a.click();return}}return false}""")
                time.sleep(6)
            if i > 0 and i % 60 == 0:
                log(f"  waiting... {i}s")
        
        if not found:
            log(f"NOT FOUND after 5min")
    
    pw.stop()
    return {'test': test_name, 'interceptor': with_interceptor, 'success': False}

# Run Test A: Interceptor ON
print("=== TEST A: Interceptor ON ===")
r1 = run_test(True, "Int ON Test")
print(f"Result: {json.dumps(r1)}")

# Run Test B: Interceptor OFF  
print("\n=== TEST B: Interceptor OFF ===")
r2 = run_test(False, "Int OFF Test")
print(f"Result: {json.dumps(r2)}")

print(f"\n=== FINAL RESULTS ===")
print(json.dumps([r1, r2], indent=2))
