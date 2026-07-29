"""Forensic analysis: check deal timestamps and run reproduction test."""
import time, re, json
from patchright.sync_api import sync_playwright

BOARD = "24f7b6a0-545a-4f8c-9e0f-0dc9ed175269"
DEALS = [
    ("Test Interceptor", "b515f858-b172-49"),
    ("Unknown 2", "d4c81344-c6a6-4e"),
]

pw = sync_playwright().start()
b = pw.chromium.connect_over_cdp('http://localhost:9222')
p = b.contexts[0].pages[0]

# Step 1: Check deal timestamps
for name, cid in DEALS:
    p.evaluate(f"window.location.href = '/deals/view/{BOARD}/{cid}'")
    time.sleep(6)
    title = p.evaluate("()=>document.title")
    txt = p.evaluate("()=>document.body.innerText")
    dates = re.findall(r'\d{2}/\d{2}/\d{4}|\d{4}-\d{2}-\d{2}|\d{1,2}\s+\w+\s+\d{4}', txt)
    print(f"[{name}] Title: {title[:50]}")
    print(f"  Created: {dates[:3] if dates else 'not found'}")

# Step 2: Check the action journal
try:
    with open('/Users/warren/.hermes/logs/state-engine/actions.jsonl') as f:
        journal = [json.loads(l) for l in f.readlines()]
    print(f"\nJournal entries: {len(journal)}")
    for entry in journal[-10:]:
        ts = entry.get('_timestamp','?')[:19]
        action = entry.get('action','?')
        status = entry.get('status','?')
        tier = entry.get('tier','?')
        print(f"  [{ts}] {tier:5s} {action:25s} {status}")
except FileNotFoundError:
    print(f"\nJournal not found")

# Step 3: Controlled reproduction — inject interceptor, create deal, wait
print(f"\n=== Step 3: Controlled Reproduction ===")
p.evaluate(f"window.location.href = '/deals/board/{BOARD}'")
time.sleep(6)

# Inject interceptor
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
print(f"Interceptor: {p.evaluate('()=>!!window.__h')}")

# Click Add new
p.evaluate("""()=>{for(var a of document.querySelectorAll('a,button,span,[role=button]')){if(a.textContent.trim()==='Add new'&&a.offsetParent){a.click();return}}return false}""")
time.sleep(12)
print(f"URL: {p.url[:50]}")

# Fill
p.evaluate("()=>document.querySelector('input[name=\"name\"]').focus()")
time.sleep(0.3); p.keyboard.type('Repro Test - ' + str(int(time.time())), delay=2)
p.evaluate("()=>document.querySelector('input[name=\"value.total\"]').focus()")
time.sleep(0.3); p.keyboard.type('800000', delay=2)
p.evaluate("()=>document.querySelector('[name=\"leadSource\"]').click()")
time.sleep(1.5); p.keyboard.press('ArrowDown'); time.sleep(0.3); p.keyboard.press('Enter'); time.sleep(1.5)

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

# Save
save = p.evaluate("""()=>{for(var b of document.querySelectorAll('button')){if(b.textContent.trim()==='Save')return{disabled:b.disabled}}return null}""")
print(f"Save: {save}")

if save and not save['disabled']:
    import datetime
    click_time = datetime.datetime.now()
    p.evaluate("""()=>{for(var b of document.querySelectorAll('button')){if(b.textContent.trim()==='Save'){b.removeAttribute('disabled');b.click();return}}}""")
    print(f"Save clicked at: {click_time.isoformat()}")
    
    # Wait up to 3 minutes
    for i in range(180):
        time.sleep(1)
        m = re.search(r'/deals/view/([^/]+)/([^/]+)', p.url)
        if m:
            print(f"  [{i+1}s] *** DEAL CREATED! CID: {m.group(2)[:16]} ***")
            print(f"  Click-to-create: {i+1}s")
            break
        if i > 0 and i % 30 == 0:
            print(f"  [{i+1}s] URL: {p.url[:50]}")

pw.stop()
