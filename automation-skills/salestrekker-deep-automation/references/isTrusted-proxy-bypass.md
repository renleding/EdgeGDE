# isTrusted Proxy Bypass — Research Log 2026-07-28

## Problem

Salestrekker's Add deal form Save button handler checks `event.isTrusted` AND
internal React/Formik state. All programmatic click approaches fail:

| Approach | isTrusted | Handler fires? | API call? |
|----------|-----------|----------------|-----------|
| `element.click()` | false | No (disabled) | No |
| `removeAttribute('disabled')` + `element.click()` | false (untrusted) | Handler runs but returns early | No |
| `dispatchEvent(new MouseEvent('click'))` | false (untrusted) | React ignores isTrusted check | No |
| CDP `Input.dispatchMouseEvent` | true (Chrome pipeline) | Handler checks form state, returns | No |
| Keyboard Tab → Enter | true (CDP dispatchKeyEvent) | Handler checks form state, returns | No |
| pyautogui OS click | true (CGEvent) | Handler checks form state, returns | No |

The Save button has NO `__reactProps$` — it uses `addEventListener` with a
`handleEvent` object (`typeof onclick === 'object'`).

## Solution Approach: Proxy EventTarget.addEventListener

Override before React/SPA mounts to wrap every event listener with a Proxy
that forces `event.isTrusted = true`:

```javascript
(function(){
    if(window.__h) return; window.__h = true;
    var _a = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function(t, h, o) {
        if(typeof h === 'function') {
            var w = function() {
                var a = Array.prototype.slice.call(arguments);
                if(a[0] && a[0].type) {
                    a[0] = new Proxy(a[0], {
                        get: function(target, prop) {
                            return prop === 'isTrusted' ? true : target[prop];
                        }
                    });
                }
                return h.apply(this, a);
            };
            return _a.call(this, t, w, o);
        }
        return _a.call(this, t, h, o);
    };
})();
```

## Injection Methods

**Preferred:** `page.add_init_script(code)` — Patchright API. Runs before every 
page script. Limited support with `connect_over_cdp()`.

**CDP:** `cdp.send('Page.addScriptToEvaluateOnNewDocument', {'source': code})` — 
origin-scoped. May not inject on cross-origin navigations. Injected script persists
for same-origin `page.goto()`.

**evaluate:** `page.evaluate(code)` — runs in current JS context. Cleared on any
navigation. Use before SPA navigation (`window.location.href` or `page.goto()`)
to intercept handlers registered after injection.

## Key Finding: addEventListener with handleEvent

The Save button in the Add deal form uses this pattern:
```javascript
// Internal in the SPA bundle:
btn.addEventListener('click', {
    handleEvent: function(event) {
        // Reads from React/Formik ref, not DOM
        // Returns early if form state is invalid
        // Makes zero network requests
    }
});
```

`typeof btn.onclick === 'object'` is the detection signal. Normal handlers
show `'function'`.

## Remaining Gap

Even with `isTrusted` bypassed, the handler checks internal form state 
(React/Formik `ref.current.values`) which our keyboard events never populate.
The handler returns before making any API call regardless of isTrusted.

**Resolution path:** Either (a) find and call the React state setter for each
form field, or (b) POST directly to the GraphQL API endpoint (requires
capturing the endpoint and mutation from a real human click).
