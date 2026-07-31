# AppleScript JS Injection via Python Tempfile

## Problem

Inline AppleScript with nested JavaScript quotes is brittle and breaks easily:
```applescript
execute active tab of window 1 javascript "
    document.querySelector('input[placeholder=\"Select one\"]')?.click();
"
```
Each wrong escape breaks the entire osascript call. Errors report AppleScript line numbers, not JS source lines.

## Fix: Python Tempfile Wrapper

Write the AppleScript to a temp file using Python's `tempfile.NamedTemporaryFile`, then execute via `osascript`:

```python
import tempfile, subprocess, json

def run_js(js_code, label=''):
    script = f'''
tell application "Google Chrome"
    execute active tab of window 1 javascript {json.dumps(js_code)}
end tell
'''
    with tempfile.NamedTemporaryFile(mode='w', suffix='.applescript', delete=False) as f:
        f.write(script)
        f.flush()
        result = subprocess.run(['osascript', f.name], 
            capture_output=True, text=True, timeout=15)
        os.unlink(f.name)  # Clean up immediately
    
    if result.returncode != 0:
        print(f'{label}: ERR {result.stderr.strip()[:80]}')
        return None
    out = (result.stdout or '').strip()
    if out:
        print(f'{label}: {out[:80]}')
    return out
```

## Key Benefits

- **No quoting issues** — `json.dumps()` handles all JavaScript string escaping correctly
- **Clean error messages** — AppleScript errors reference the temp file path
- **Auto-cleanup** — `os.unlink()` deletes the temp file immediately after execution
- **Return values** — Capture JS return values via `result.stdout`

## Usage

```python
# Execute JS and capture return value
result = run_js("document.title", 'title check')
# Returns: "Dashboard: Sales | Afirmico | Salestrekker"

# Fill a React input
run_js('''
(function() {
    var ns = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype, 'value'
    ).set;
    ns.call(input, 'Wealth Wages');
    input.dispatchEvent(new Event('input', {bubbles: true}));
    input.dispatchEvent(new Event('change', {bubbles: true}));
    return 'ok';
})();
''', 'fill employer')

# Click an element
run_js('''
(function() {
    var el = document.querySelector('button:has-text("Add expense")');
    if (el) { el.click(); return 'clicked'; }
    return 'not found';
})();
''', 'click button')
```

## Prerequisite

The user must have Chrome's **View → Developer → Allow JavaScript from Apple Events** toggle enabled. This is per-Chrome-profile and can reset on Chrome updates. Test before each automation sequence:

```python
def check_js_toggle():
    result = run_js("document.title", 'toggle check')
    if result is None:
        print('JS toggle is OFF — ask user to enable it')
        return False
    return True
```

## Limitations

- **Toggle can reset** — Chrome updates, profile switches reset the toggle
- **Multi-monitor** — `menu bar 1` of `process "Google Chrome"` may target wrong display
- **No keyboard shortcuts** — `osascript` keystroke is blocked by macOS security (needs Accessibility permissions)
- **Only works on the active window** — `execute active tab of window 1` targets the frontmost Chrome window
