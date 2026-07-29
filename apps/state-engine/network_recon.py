#!/usr/bin/env python3
"""Network Reconnaissance — capture ALL requests from Save button."""
import time, json, sys, pyotp
from patchright.sync_api import sync_playwright

BOARD = "24f7b6a0-545a-4f8c-9e0f-0dc9ed175269"
CID_SAM = "e2326b17-cf25-4086-8388-a4706ae54765"

pw = sync_playwright().start()
browser = pw.chromium.connect_over_cdp('http://localhost:9222')
page = browser.contexts[0].pages[0]
cdp = page.context.new_cdp_session(page)

# Enable ALL network monitoring
cdp.send('Network.enable')
cdp.send('Network.setCacheDisabled', {'cacheDisabled': True})

# Track all requests with full details
requests = []

def on_request(params):
    req = params.get('request', {})
    request_id = params.get('requestId', '')
    requests.append({
        'id': request_id,
        'url': req.get('url', ''),
        'method': req.get('method', ''),
        'headers': dict(req.get('headers', {})),
        'postData': req.get('postData', ''),
        'type': params.get('type', ''),
        'wallTime': params.get('wallTime', 0),
    })

def on_response(params):
    req_id = params.get('requestId', '')
    resp = params.get('response', {})
    # Find matching request and add response info
    for r in requests:
        if r['id'] == req_id:
            r['status'] = resp.get('status', 0)
            r['statusText'] = resp.get('statusText', '')
            r['responseHeaders'] = dict(resp.get('headers', {}))
            r['responseUrl'] = resp.get('url', '')
            break

cdp.on('Network.requestWillBeSent', on_request)
cdp.on('Network.responseReceived', on_response)

# Login
page.goto('https://pc.v2.salestrekker.com/auth/sign-in')
time.sleep(10)
page.evaluate("()=>document.querySelector('input[name=\"eMail\"]').focus()")
time.sleep(0.3)
page.keyboard.type('connect@afirmico.com', delay=3)
page.evaluate("()=>document.querySelector('input[name=\"password\"]').focus()")
time.sleep(0.3)
page.keyboard.type('U2ers$4Ts2HzddKJP%NHJHAJ3mhEqgpq', delay=2)
page.evaluate("""()=>{for(var b of document.querySelectorAll('button')){if(b.textContent.trim()==='Sign in'){b.removeAttribute('disabled');b.click();return}}}""")
time.sleep(5)
if 'two-factor' in page.url.lower():
    code = pyotp.TOTP("MCQNAJGXKIAPUU7MWSCFVQTAQFOVLMPE7AE4KFP223N3IU2ZEVKQ").now()[:6]
    page.evaluate("""()=>{var ins=document.querySelectorAll('input');for(var i of ins){if(i.offsetParent){i.focus();return}}}""")
    time.sleep(0.3)
    for ch in code: page.keyboard.press(ch); time.sleep(0.05)
    time.sleep(0.3)
    page.keyboard.press('Enter')
    time.sleep(8)

# Navigate to Add deal and fill form
page.evaluate(f"window.location.href = '/deals/board/{BOARD}'")
time.sleep(6)
page.evaluate("""()=>{for(var a of document.querySelectorAll('a,button,span,[role=button]')){if(a.textContent.trim()==='Add new'&&a.offsetParent){a.click();return}}return false}""")
time.sleep(12)

page.evaluate("()=>document.querySelector('input[name=\"name\"]').focus()")
time.sleep(0.3); page.keyboard.type('Test Network Capture', delay=2)
page.evaluate("()=>document.querySelector('input[name=\"value.total\"]').focus()")
time.sleep(0.3); page.keyboard.type('800000', delay=2)
page.evaluate("()=>document.querySelector('[name=\"leadSource\"]').click()")
time.sleep(1.5); page.keyboard.press('ArrowDown'); time.sleep(0.3); page.keyboard.press('Enter'); time.sleep(1.5)

# Clear all navigation/login requests from capture
requests.clear()
print(f"Form filled at: {page.url[:50]}")
print("="*70)
print("SETUP COMPLETE — Navigate to the browser and click SAVE manually")
print("="*70)

# Wait for manual Save click
print("Waiting up to 120 seconds for Save click...")
for i in range(120):
    time.sleep(1)
    
    # Check URL for deal creation
    import re
    m = re.search(r'/deals/view/([^/]+)/([^/]+)', page.url)
    if m:
        print(f"\n*** DEAL CREATED! CID: {m.group(2)[:16]} ***")
        break
    
    if requests:
        print(f"\n[{i+1}s] {len(requests)} API calls captured!")
        break
    
    if i > 0 and i % 15 == 0:
        print(f"  [{i+1}s] URL: {page.url[:50]}")

if requests:
    print("\n" + "="*70)
    print("CAPTURED REQUESTS:")
    print("="*70)
    for r in requests:
        print(f"\n--- [{r['method']}] {r['url'][:100]} ---")
        print(f"  Status: {r.get('status', '?')} {r.get('statusText', '')}")
        print(f"  Type: {r['type']}")
        
        # Show key headers
        auth_headers = {k:v for k,v in r['headers'].items() 
                       if k.lower() in ('content-type', 'accept', 'x-csrf-token', 'x-xsrf-token', 
                                        'authorization', 'cookie')}
        if auth_headers:
            print(f"  Auth Headers:")
            for k,v in auth_headers.items():
                v_short = v[:80] + '...' if len(v) > 80 else v
                print(f"    {k}: {v_short}")
        
        # Show body
        if r['postData']:
            print(f"  PAYLOAD:")
            try:
                parsed = json.loads(r['postData'])
                print(f"    {json.dumps(parsed, indent=2)[:1500]}")
            except json.JSONDecodeError:
                print(f"    {r['postData'][:800]}")
        
        # Try to get response body
        if r.get('id') and r.get('status', 0) < 400:
            try:
                resp = cdp.send('Network.getResponseBody', {'requestId': r['id']})
                body = resp.get('body', '')
                if body and len(body) > 10:
                    print(f"  RESPONSE BODY:")
                    try:
                        parsed = json.loads(body)
                        print(f"    {json.dumps(parsed, indent=2)[:1000]}")
                    except:
                        print(f"    {body[:500]}")
            except Exception as e:
                pass
    
    # Save to file
    output = '/tmp/salestrekker_network_capture.json'
    with open(output, 'w') as f:
        json.dump(requests, f, indent=2, default=str)
    print(f"\nFull capture saved to: {output}")
else:
    print("\nNo requests captured in 120s")

pw.stop()
