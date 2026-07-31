# CDP Runtime.evaluate — Key Snippets

These snippets work via CDP Runtime.evaluate (NOT page.evaluate) for accessing React internals.

## Finding React Props on a Button

```python
result = cdp.send('Runtime.evaluate', {
    'expression': """
        (function() {
            var btns = document.querySelectorAll('button');
            for(var b of btns) {
                if(b.textContent.includes('Save and calculate') && !b.disabled) {
                    var keys = Object.getOwnPropertyNames(b);
                    var propsKey = keys.find(k => k.startsWith('__reactProps'));
                    if(propsKey) {
                        var props = b[propsKey];
                        if(typeof props.onClick === 'function') {
                            props.onClick();
                            return 'React onClick called';
                        }
                        return 'onClick type: ' + typeof props.onClick;
                    }
                    return 'keys found: ' + keys.filter(k => k.startsWith('__react')).join(',');
                }
            }
            return 'Save button not found';
        })()
    """,
    'returnByValue': True
})
```

## Checking Asset Form React Status

```python
result = cdp.send('Runtime.evaluate', {
    'expression': """
        (function() {
            var info = {};
            var input = document.querySelector('input[name="name"]');
            if(input) {
                var keys = Object.getOwnPropertyNames(input);
                info.inputReactKeys = keys.filter(k => k.startsWith('__react'));
                info.ownKeysCount = keys.length;
            }
            // Check Save button
            for(var b of document.querySelectorAll('button')) {
                if(b.textContent.includes('Save')) {
                    var bKeys = Object.getOwnPropertyNames(b);
                    info.saveReactKeys = bKeys.filter(k => k.startsWith('__react'));
                    info.saveOnclickIsNull = b.onclick === null;
                    break;
                }
            }
            return info;
        })()
    """,
    'returnByValue': True
})
```

## Getting All Page Targets (Find a Tab)

```bash
curl -s http://localhost:9222/json | python3 -c "
import sys, json
for p in json.load(sys.stdin):
    t = p.get('title','')[:40]
    u = p.get('url','')[:80]
    print(f'  [{p[\"id\"][:8]}] {t:40s} {u}')
"
```

## Connecting via Python websockets

```python
import asyncio, json, websockets, requests

targets = requests.get('http://localhost:9222/json', timeout=5).json()
ws_url = targets[0]['webSocketDebuggerUrl']

async def go():
    async with websockets.connect(ws_url) as ws:
        await ws.send(json.dumps({
            'id':1,'method':'Runtime.evaluate',
            'params':{'expression':'document.title','returnByValue':True}
        }))
        resp = json.loads(await asyncio.wait_for(ws.recv(), timeout=5))
        title = resp.get('result',{}).get('result',{}).get('value','')
        print(f'Title: {title}')
asyncio.run(go())
```

## Navigating SPA (Safe)

```python
await ws.send(json.dumps({
    'id':2,'method':'Runtime.evaluate',
    'params':{'expression':"window.location.href='/deals/home-loan/{BOARD}/{CID}/assets'"}
}))
```

DO NOT use `Page.navigate` — it triggers sign-out on authenticated SPA pages.
