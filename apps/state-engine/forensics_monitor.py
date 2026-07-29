#!/usr/bin/env python3
"""Forensics Monitor — capture network traffic during manual Save click.

Run this, then manually click Save in the CfT browser.
Will capture ALL API calls with full payload and response.
"""
import time, json, sys, os
from patchright.sync_api import sync_playwright

pw = sync_playwright().start()
browser = pw.chromium.connect_over_cdp('http://localhost:9222')
page = browser.contexts[0].pages[0]
cdp = page.context.new_cdp_session(page)

# Enable full network tracking
cdp.send('Network.enable')
cdp.send('Network.setCacheDisabled', {'cacheDisabled': True})

requests = []

def on_req(params):
    req = params.get('request', {})
    rid = params.get('requestId', '')
    url = req.get('url', '')
    # Filter noise
    skip_exts = ('.js', '.css', '.png', '.svg', '.ico', '.woff', '.ttf', '.map')
    if any(url.endswith(e) for e in skip_exts): return
    if any(d in url for d in ['google', 'facebook', 'intercom', 'sentry', 'analytics', 'cdn.']): return
    
    requests.append({
        'id': rid,
        'url': url,
        'method': req.get('method', ''),
        'headers': dict(req.get('headers', {})),
        'postData': req.get('postData', ''),
        'type': params.get('type', ''),
        'time': time.strftime('%H:%M:%S'),
    })

def on_resp(params):
    rid = params.get('requestId', '')
    resp = params.get('response', {})
    for r in requests:
        if r['id'] == rid:
            r['status'] = resp.get('status', 0)
            r['statusText'] = resp.get('statusText', '')
            break

cdp.on('Network.requestWillBeSent', on_req)
cdp.on('Network.responseReceived', on_resp)

print("=" * 60)
print("FORENSICS MONITOR — Manual Save Click Capture")
print("=" * 60)
print(f"Current URL: {page.url[:50]}")
print(f"Current Title: {page.title()[:40]}")
print()
print("Instructions:")
print("  1. Navigate to Add deal page (if not already there)")
print("  2. Fill the form fields (Title, Value, Lead Source, Contact)")
print("  3. Click SAVE normally")
print("  4. Wait 10 seconds after clicking")
print()
print("Monitor will run for 3 minutes...")
print("=" * 60)

import re
deal_id = None

for i in range(180):
    time.sleep(1)
    
    # Check for URL change (deal created)
    m = re.search(r'/deals/view/([^/]+)/([^/]+)', page.url)
    if m:
        deal_id = m.group(2)
        print(f"\n*** DEAL CREATED! CID: {deal_id[:16]} ***")
        break
    
    # Check for new API calls
    api_calls = [r for r in requests if r.get('method') == 'POST' and (
        'graphql' in r['url'].lower() or 
        'api/' in r['url'] or 
        r['headers'].get('Content-Type', '').startswith('application/json')
    )]
    
    if api_calls and i > 3:  # Ignore initial page load
        print(f"\n[{i}s] {len(api_calls)} API calls detected!")
        for r in api_calls:
            print(f"\n  === [{r['method']}] {r['url'][:120]} ===")
            print(f"  Time: {r['time']}")
            print(f"  Status: {r.get('status', '?')} {r.get('statusText', '')}")
            
            # Print headers
            auth_hdrs = {k:v for k,v in r['headers'].items() 
                        if k.lower() in ('content-type','accept','x-csrf-token','x-xsrf-token','authorization')}
            if auth_hdrs:
                print(f"  Auth Headers:")
                for k,v in auth_hdrs.items():
                    print(f"    {k}: {v[:80]}...")
            
            # Print payload
            if r['postData']:
                print(f"  PAYLOAD:")
                try:
                    p = json.loads(r['postData'])
                    print(f"    {json.dumps(p, indent=2)[:2000]}")
                except:
                    print(f"    {r['postData'][:500]}")
            
            # Get response body
            if r.get('id') and r.get('status', 0) < 400:
                try:
                    resp = cdp.send('Network.getResponseBody', {'requestId': r['id']})
                    body = resp.get('body', '')
                    if body:
                        print(f"  RESPONSE:")
                        try:
                            p = json.loads(body)
                            print(f"    {json.dumps(p, indent=2)[:1000]}")
                        except:
                            print(f"    {body[:300]}")
                except:
                    pass
        break
    
    if i % 30 == 0 and i > 0:
        print(f"  [{i}s] Waiting... URL: {page.url[:50]}")

# Save results
if requests:
    api_calls = [r for r in requests if r.get('method') == 'POST' and 
                 ('graphql' in r['url'].lower() or 'api/' in r['url'] or 
                  r['headers'].get('Content-Type','').startswith('application/json'))]
    
    output = '/tmp/forensics_capture.json'
    with open(output, 'w') as f:
        json.dump(api_calls if api_calls else requests, f, indent=2, default=str)
    print(f"\nSaved {len(api_calls if api_calls else requests)} requests to {output}")
    
    # Print summary
    print(f"\n=== SUMMARY ===")
    print(f"Total requests: {len(requests)}")
    print(f"API calls found: {len(api_calls)}")
    if deal_id:
        print(f"Deal created: {deal_id[:16]}")
    
    if not api_calls and not deal_id:
        print("\n⚠️  No API calls detected and no deal created.")
        print("   The Save handler may not be making network requests.")
        print("   Check if the form has validation errors visible on screen.")

pw.stop()
