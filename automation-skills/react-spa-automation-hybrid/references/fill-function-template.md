# Proven Field Fill Function (26 Jul 2026)

## Python helper
```python
def fill(page, name, value):
    """Fill a React-controlled input by name using native setter + dispatchEvent.
    
    Args are passed as a single array to page.evaluate() — this is the 
    CORRECT pattern that works across all Playwright/Patchright versions.
    """
    page.evaluate("""(args) => {
        const [name, val] = args;
        const s = Object.getOwnPropertyDescriptor(
            HTMLInputElement.prototype, 'value').set;
        const els = document.querySelectorAll(
            'input[name="' + name + '"]');
        for(let i=0;i<els.length;i++) {
            if(els[i].type !== 'hidden') {
                s.call(els[i], val);
                ['input', 'change'].forEach(e => 
                    els[i].dispatchEvent(new Event(e, {bubbles:true})));
                break;
            }
        }
    }""", [name, str(value)])
    time.sleep(0.3)
```

## Why single array arg?
`page.evaluate(expression, *args)` is ambiguous across Playwright versions:
- Some accept multiple positional args
- `patchright` accepts only 2 (`expr, arg`)
- Passing a single array and destructuring in JS is ALWAYS correct

```python
# ✅ WORKS everywhere
page.evaluate("([a, b]) => { ... }", [val1, val2])

# ❌ FAILS on Patchright, some Playwright versions
page.evaluate("(a, b) => { ... }", val1, val2)
```

## Save button
```python
def save(page):
    page.evaluate("""() => {
        const b = document.querySelectorAll('button');
        for(let i=0;i<b.length;i++)
            if(b[i].offsetParent && (b[i].textContent.trim() === 'Save'
                || b[i].textContent.trim() === 'Save and calculate'))
                    { b[i].click(); return; }
    }""")
    time.sleep(3)
    return "updated" in page.evaluate("document.body.innerText").lower()
```

## Click by text
```python
def click_text(page, text):
    page.evaluate("""(t) => {
        const b = document.querySelectorAll('button');
        for(let i=0;i<b.length;i++)
            if(b[i].offsetParent && b[i].textContent.trim() === t)
                { b[i].click(); return; }
    }""", text)
    time.sleep(1.5)

def menu_click(page, text):
    page.evaluate("""(t) => {
        const m = document.querySelectorAll('[role=menuitem]');
        for(let i=0;i<m.length;i++)
            if(m[i].textContent.trim() === t)
                { m[i].click(); return; }
    }""", text)
    time.sleep(1.5)
```

## SPA navigation
```python
def nav(page, path):
    page.evaluate("(x)=>{window.location.href=x}", path)
    time.sleep(5)
```
