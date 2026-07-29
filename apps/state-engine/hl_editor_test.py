"""Test Home Loan Editor Save and calculate — async verification fix."""
import time, re
from patchright.sync_api import sync_playwright

BOARD = "24f7b6a0-545a-4f8c-9e0f-0dc9ed175269"
CONTACT = "d4c81344-c6a6-4e52-ba53-a69b8df7847c"
TEST_NAME = "HL Save Test"
t0 = time.time()
def log(m): print(f"  [{time.time()-t0:4.0f}s] {m}")

pw = sync_playwright().start()
b = pw.chromium.connect_over_cdp('http://localhost:9222')
p = b.contexts[0].pages[0]

# Navigate to home loan editor
p.evaluate(f"window.location.href = '/deals/add/{BOARD}/home-loan/{CONTACT}/assets'")
time.sleep(10)
log(f"URL: {p.url[:60]}")
log(f"Title: {p.title()[:50]}")

# Check Save and calculate button
save_info = p.evaluate("""()=>{
    var btns = document.querySelectorAll('button');
    for(var b of btns){
        var t = b.textContent.trim();
        if(t === 'Save and calculate' || t === 'Save'){
            return {
                text: t,
                disabled: b.disabled,
                offsetParent: !!b.offsetParent,
                rect: b.getBoundingClientRect()
            };
        }
    }
    return null;
}""")
log(f"Save button: {save_info}")

# Add a vehicle asset
p.evaluate("""()=>{
    // Click Add vehicle
    var btns = document.querySelectorAll('button');
    for(var b of btns){
        if(b.textContent.trim().includes('Add vehicle') && b.offsetParent){
            b.click(); return 'clicked Add vehicle';
        }
    }
    return 'not found';
}""")
time.sleep(3)
log("Clicked Add vehicle")

# Fill vehicle fields
p.evaluate("()=>document.querySelector('input[name=\"vehicleMake\"]')?.focus()")
time.sleep(0.3); p.keyboard.type('BMW', delay=2)
p.evaluate("()=>document.querySelector('input[name=\"vehicleModel\"]')?.focus()")
time.sleep(0.3); p.keyboard.type('X5', delay=2)
p.evaluate("()=>document.querySelector('input[name=\"vehicleYear\"]')?.focus()")
time.sleep(0.3); p.keyboard.type('2022', delay=2)

# Value field
val = p.evaluate("""()=>{
    var ins = document.querySelectorAll('input');
    for(var i of ins){
        if(i.name && (i.name.includes('value') || i.name.includes('amount')) && i.offsetParent){
            i.focus(); return i.name;
        }
    }
    return 'not found';
}""")
if val != 'not found':
    p.keyboard.type('40000', delay=2)
log(f"Value field: {val}")
time.sleep(1)

# Click Save and calculate
save_clicked = p.evaluate("""()=>{
    var btns = document.querySelectorAll('button');
    for(var b of btns){
        var t = b.textContent.trim();
        if((t === 'Save and calculate' || t === 'Save') && !b.disabled && b.offsetParent){
            b.removeAttribute('disabled');
            b.click();
            return t;
        }
    }
    return null;
}""")
log(f"Clicked: {save_clicked}")

if save_clicked:
    click_t = time.time()
    
    # Poll for asset to appear — check page content every 15s
    for i in range(200):
        time.sleep(1)
        if i % 15 == 0:
            # Check if page has changed (toast, new content, or form reset)
            p.evaluate(f"window.location.href = '/deals/add/{BOARD}/home-loan/{CONTACT}/assets'")
            time.sleep(3)
            body = p.evaluate("() => document.body.innerText")
            
            # Check for BMW in the page (our added asset)
            if ('BMW' in body and 'X5' in body) or 'Total assets' in body:
                latency = time.time() - click_t
                log(f"*** ASSET PERSISTED after {latency:.0f}s ***")
                
                # Find Total assets
                for line in body.split('\n'):
                    line = line.strip()
                    if 'Total' in line or 'BMW' in line or 'X5' in line:
                        log(f"  {line[:80]}")
                break
        if i > 0 and i % 30 == 0:
            log(f"  waiting... {i}s")

pw.stop()
