"""Reproduction test: inject interceptor -> create deal -> wait for result."""
import time, re, json, datetime
from patchright.sync_api import sync_playwright

BOARD = "24f7b6a0-545a-4f8c-9e0f-0dc9ed175269"
t0 = time.time()
def log(m): print(f"  [{time.time()-t0:4.0f}s] {m}")

pw = sync_playwright().start()
b = pw.chromium.connect_over_cdp('http://localhost:9222')
p = b.contexts[0].pages[0]

# ─── Check session — DO NOT LOGIN ───
if '/auth/sign-in' in p.url.lower():
    log("Session expired — login manually")
    pw.stop()
    exit(1)

# Log existing deals before test
existing = p.evaluate("""()=>document.body.innerText.substring(0,300)""")
log(f"Dashboard: {existing[:100]}")

# Navigate to board
p.evaluate(f"window.location.href = '/deals/board/{BOARD}'")
time.sleep(6)
log("Board loaded")

# INJECT INTERCEPTOR
p.evaluate("""() => {
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
}""")
log(f"Interceptor: {p.evaluate('()=>!!window.__h')}")

# Click Add new (SPA navigation)
p.evaluate("""()=>{for(var a of document.querySelectorAll('a,button,span,[role=button]')){if(a.textContent.trim()==='Add new'&&a.offsetParent){a.click();return}}return false}""")
time.sleep(12)
log(f"Add deal page: {p.url[:50]}")

# Fill form
p.evaluate("()=>document.querySelector('input[name=\"name\"]').focus()")
time.sleep(0.3); p.keyboard.type('Repro Test v2', delay=2)
p.evaluate("()=>document.querySelector('input[name=\"value.total\"]').focus()")
time.sleep(0.3); p.keyboard.type('800000', delay=2)
p.evaluate("()=>document.querySelector('[name=\"leadSource\"]').click()")
time.sleep(1.5); p.keyboard.press('ArrowDown'); time.sleep(0.3); p.keyboard.press('Enter'); time.sleep(1.5)
log("Fields filled")

cdp = p.context.new_cdp_session(p)
box = p.evaluate("""()=>{for(var b of document.querySelectorAll('button')){
    if(b.textContent.trim()==='Add contact'&&b.offsetParent){
        var el=b;while(el){if(el.getAttribute('aria-haspopup')==='menu'){
            var r=el.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}
        }el=el.parentElement}
    }
}return null}""")
if box:
    cdp.send('Input.dispatchMouseEvent',{'type':'mousePressed','x':box['x'],'y':box['y'],'button':'left','clickCount':1})
    cdp.send('Input.dispatchMouseEvent',{'type':'mouseReleased','x':box['x'],'y':box['y'],'button':'left','clickCount':1})
    time.sleep(2)
    for item in p.evaluate("""()=>{return Array.from(document.querySelectorAll('[role=menuitem]')).filter(i=>i.offsetParent).map(i=>({t:i.textContent.trim(),x:i.getBoundingClientRect().x+i.getBoundingClientRect().width/2,y:i.getBoundingClientRect().y+i.getBoundingClientRect().height/2}))}"""):
        if 'Add existing person' in item['t']:
            cdp.send('Input.dispatchMouseEvent',{'type':'mousePressed','x':item['x'],'y':item['y'],'button':'left','clickCount':1})
            cdp.send('Input.dispatchMouseEvent',{'type':'mouseReleased','x':item['x'],'y':item['y'],'button':'left','clickCount':1})
            time.sleep(2); break
    p.locator('input[name="query"]').last.type('Sam Smith', delay=5)
    time.sleep(3)
    p.keyboard.press('ArrowDown'); time.sleep(0.3)
    p.keyboard.press('ArrowDown'); time.sleep(0.3)
    p.keyboard.press('Enter'); time.sleep(3)
    p.evaluate("""()=>{for(var b of document.querySelectorAll('button')){if(b.textContent.trim()==='Add'&&!b.disabled&&b.offsetParent){b.click();return}}}""")
    time.sleep(4)
    log("Contact added")

# Save
save = p.evaluate("""()=>{for(var b of document.querySelectorAll('button')){if(b.textContent.trim()==='Save')return{disabled:b.disabled}}return null}""")
log(f"Save enabled: {save}")

if save and not save['disabled']:
    click_time = datetime.datetime.now()
    p.evaluate("""()=>{for(var b of document.querySelectorAll('button')){if(b.textContent.trim()==='Save'){b.removeAttribute('disabled');b.click();return}}}""")
    log(f"Save clicked at {click_time.isoformat()}")
    
    for i in range(180):
        time.sleep(1)
        m = re.search(r'/deals/view/([^/]+)/([^/]+)', p.url)
        if m:
            log(f"*** DEAL CREATED! CID: {m.group(2)[:16]} after {i+1}s ***")
            
            # Log to file for evidence
            with open('/tmp/repro_result.json', 'w') as f:
                f.write(json.dumps({
                    'success': True,
                    'cid': m.group(2),
                    'click_time': click_time.isoformat(),
                    'creation_delay_s': i+1,
                    'timestamp': datetime.datetime.now().isoformat(),
                    'interceptor': True,
                }))
            break
        if i > 0 and i % 30 == 0:
            log(f"  still waiting... URL: {p.url[:50]}")

pw.stop()

# Final report
try:
    with open('/tmp/repro_result.json') as f:
        result = json.load(f)
    log(f"\nRESULT: {'SUCCESS' if result.get('success') else 'FAILURE'}")
    log(f"Details: {json.dumps(result, indent=2)}")
except:
    log("\nRESULT: No deal created in 180s")
