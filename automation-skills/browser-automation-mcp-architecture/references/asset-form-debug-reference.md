# Asset Form Debugging Reference — Test 10 Analysis

## How to diagnose the asset form's framework

Run this CDP Runtime.evaluate to check if the form is React controlled:

```javascript
// Check for React fibers on inputs
var input = document.querySelector('input');
var keys = Object.getOwnPropertyNames(input);
var isReactControlled = keys.some(k => k.startsWith('__reactFiber$'));
console.log('React controlled:', isReactControlled);
console.log('Own keys:', keys);

// Check _valueTracker
console.log('tracker:', input._valueTracker ? input._valueTracker.getValue() : 'none');

// Check value setter
var nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
var elementSetter = Object.getOwnPropertyDescriptor(input, 'value');
console.log('Native setter in use:', !elementSetter || elementSetter.set === nativeSetter);
```

Result from Test 10 (confirmed non-React):
```json
{"isReactControlled": false, "tracker": "none", "nativeSetterInUse": true}
```

## How to check Save button's event binding

```javascript
var btn = document.querySelector('button'); // Find Save button
console.log('onclick:', btn.onclick); // null → uses addEventListener
console.log('onclick type:', typeof btn.onclick); // 'object' (typeof null)
var keys = Object.keys(btn);
console.log('React props:', keys.find(k => k.startsWith('__reactProps$')));
console.log('React fiber:', keys.find(k => k.startsWith('__reactFiber$')));
```

## How to trigger addEventListener handlers

```javascript
// ❌ Does NOT trigger addEventListener handlers
btn.click();

// ✅ DOES trigger addEventListener handlers  
btn.dispatchEvent(new Event('click', {bubbles: true, cancelable: true}));

// ❌ CDP mouse events don't trigger React synthetic handlers
cdp.send('Input.dispatchMouseEvent', {'type': 'mousePressed', ...});
```

## How to access React props via CDP Runtime.evaluate

```python
# ✅ Works — finds __reactProps$ 
result = cdp.send('Runtime.evaluate', {
    'expression': '''
    var btn = document.querySelectorAll('button');
    for(var b of btn) {
        if(b.textContent.includes('Save')) {
            var keys = Object.keys(b);
            var propsKey = keys.find(k => k.startsWith('__reactProps'));
            return JSON.stringify({keys: keys, hasProps: !!propsKey});
        }
    }
    return 'not found';
    ''',
    'returnByValue': True
})

# ❌ page.evaluate strips React keys
page.evaluate("Object.keys(document.querySelector('button'))") # Returns []
```

## CDP raw websocket connection (when Patchright is slow)

```python
import json, requests, asyncio, websockets

targets = requests.get('http://localhost:9222/json', timeout=5).json()
ws_url = targets[0]['webSocketDebuggerUrl']  # Choose the right page

async def go():
    async with websockets.connect(ws_url) as ws:
        await ws.send(json.dumps({
            'id': 1, 'method': 'Runtime.evaluate',
            'params': {'expression': 'document.title', 'returnByValue': True}
        }))
        resp = json.loads(await ws.recv())
        title = resp.get('result',{}).get('result',{}).get('value', '')
        
asyncio.run(go())
```

## API key access from terminal

OpenRouter key is NOT in os.environ. Use bws CLI:

```bash
# Get OpenRouter API key
OR_KEY=$(bws secret list | python3 -c "
import sys, json
d = json.load(sys.stdin)
for i in d:
    if i['key'] == 'OPENROUTER_API_KEY':
        print(i['value'])
")
```

## Cross-session state persistence

CfT user data dir at `~/Library/Application Support/Google/Chrome for Testing/8um7547w/`
Preserves tabs and some session data across CfT restarts.
To start fully clean: `rm -rf` the profile dir before launching.
