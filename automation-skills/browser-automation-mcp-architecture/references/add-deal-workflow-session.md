# Add Deal Form Workflow — Session Findings (28 Jul 2026)

## Verified Working Pattern

```python
import time
from patchright.sync_api import sync_playwright

BOARD = "24f7b6a0-545a-4f8c-9e0f-0dc9ed175269"

pw = sync_playwright().start()
browser = pw.chromium.connect_over_cdp('http://localhost:9222')
page = browser.contexts[0].pages[0]  # IS the Salestrekker page when logged in
cdp = page.context.new_cdp_session(page)

# 1. Board → Add new
page.evaluate(f"window.location.href = '/deals/board/{BOARD}'")
time.sleep(6)
page.evaluate("""()=>{for(var a of document.querySelectorAll('a,button,span,[role=button]')){if(a.textContent.trim()==='Add new'&&a.offsetParent){a.click();return}}return false}""")
time.sleep(10)

# 2. Title — evaluate prototype setter (locator.type hangs)
page.evaluate("""()=>{var i=document.querySelector('input[name="name"]');if(i){var s=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;if(s){s.call(i,'Test Deal');i.value='Test Deal';i.dispatchEvent(new Event('input',{bubbles:true}));i.dispatchEvent(new Event('change',{bubbles:true}));}}}""")

# 3. Value
page.evaluate("""()=>{var i=document.querySelector('input[name="value.total"]');if(i){var s=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;s.call(i,'800000');i.dispatchEvent(new Event('input',{bubbles:true}));i.dispatchEvent(new Event('change',{bubbles:true}));}}""")

# 4. Lead source — pointerdown avoids SPA nav
page.evaluate("""()=>{for(var s of document.querySelectorAll('span,div,label')){if(s.textContent.trim()==='Lead source'){var sibling=s.parentElement.nextElementSibling;if(sibling){var combo=sibling.querySelector('[role=combobox]');if(combo){combo.click();return}}}}}""")
time.sleep(2)
page.evaluate("""()=>{var opts=document.querySelectorAll('[role=option]');for(var o of opts){if(o.textContent.trim()==='Existing client'&&o.offsetParent){o.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true}));o.click();return}}}""")

# 5. Contact — CDP mouse + keyboard
box = page.evaluate("""()=>{for(var b of document.querySelectorAll('button')){if(b.textContent.trim()==='Add contact'&&b.offsetParent){var el=b;while(el){if(el.getAttribute('aria-haspopup')==='menu'){var r=el.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}}el=el.parentElement}}}return null}""")
if box:
    cdp.send('Input.dispatchMouseEvent',{'type':'mousePressed','x':box['x'],'y':box['y'],'button':'left','clickCount':1})
    cdp.send('Input.dispatchMouseEvent',{'type':'mouseReleased','x':box['x'],'y':box['y'],'button':'left','clickCount':1})
    time.sleep(2)
    items = page.evaluate("""()=>{return Array.from(document.querySelectorAll('[role=menuitem]')).filter(i=>i.offsetParent).map(i=>({t:i.textContent.trim(),x:i.getBoundingClientRect().x+i.getBoundingClientRect().width/2,y:i.getBoundingClientRect().y+i.getBoundingClientRect().height/2}))}""")
    for item in items:
        if 'Add existing person' in item['t']:
            cdp.send('Input.dispatchMouseEvent',{'type':'mousePressed','x':item['x'],'y':item['y'],'button':'left','clickCount':1})
            cdp.send('Input.dispatchMouseEvent',{'type':'mouseReleased','x':item['x'],'y':item['y'],'button':'left','clickCount':1}); break
    page.locator('input[name="query"]').last.type('Sam Smith', delay=5)
    time.sleep(3)
    page.keyboard.press('ArrowDown'); time.sleep(0.3)
    page.keyboard.press('ArrowDown'); time.sleep(0.3)
    page.keyboard.press('Enter'); time.sleep(3)
    page.evaluate("""()=>{for(var b of document.querySelectorAll('button')){if(b.textContent.trim()==='Add'&&!b.disabled&&b.offsetParent){b.click();return}}}""")
    time.sleep(4)
```

## Key Findings

- **Save stays disabled** after filling all fields. React state ignores programmatic value changes.
- **No `<form>` element** — `requestSubmit()` impossible.
- **`locator.type()` hangs on CfT** for Title/Value fields. Use evaluate prototype setter.
- **Lead source pointerdown** prevents SPA navigation triggered by element.click().
- **`pages[0]` IS the Salestrekker page** when logged in (not New Tab as previously reported).
- **Synchronous CDP** (no background reader) fixes FastMCP/uvicorn event loop conflict.
