# Asset Form Deep Research — 28 Jul 2026

## Framework Analysis
- **Main app:** React 18 (hasReact=True in main.1ff6a457bf4091ff713d.js)
- **Asset form inputs:** NOT React controlled (0 own properties, no __reactFiber$, no __reactProps$, no _valueTracker)
- **Save button:** IS React (has `__reactFiber$vh8jbm6pwh` and `__reactProps$vh8jbm6pwh` via CDP Runtime.evaluate)
- **Event handler:** addEventListener('click'), NOT onclick (onclick === null)
- **No `<form>` element:** formCount = 0 on the assets page
- **No detected frameworks:** Vue, Angular, Preact, Svelte, Solid all negative

## Exhaustive Test Results (25+ approaches)

| # | Approach | Values in DOM? | Data persisted? |
|---|----------|---------------|-----------------|
| 1 | `page.evaluate` prototype setter + input/change events | ✅ | ❌ |
| 2 | `locator.type()` on each field | ✅ | ❌ |
| 3 | `locator.fill()` | ✅ | ❌ |
| 4 | `keyboard.type()` character-by-character | ✅ | ❌ |
| 5 | `page.keyboard.press()` per character | ✅ | ❌ |
| 6 | CDP `Input.dispatchKeyEvent` raw key events | ✅ | ❌ |
| 7 | Prototype setter with `_valueTracker.setValue()` | ✅ (no tracker) | ❌ |
| 8 | Prototype setter + `input` event only | ✅ | ❌ |
| 9 | Prototype setter + `change` event only | ✅ | ❌ |
| 10 | Prototype setter + `input` + `change` + `blur` | ✅ | ❌ |
| 11 | Prototype setter + `beforeinput` + `input` + `change` | ✅ | ❌ |
| 12 | `pointerdown` on Save button (Radix fix) | ✅ | ❌ (handler ran) |
| 13 | Save button `evaluate.click()` | ✅ | ❌ (handler ran) |
| 14 | Save button `locator.click()` | ✅ | ❌ (handler ran) |
| 15 | Save button CDP `Input.dispatchMouseEvent` | ✅ | ❌ |
| 16 | Save button `dispatchEvent(new Event('click',{bubbles:true}))` | ✅ | ❌ |
| 17 | Save button `__reactProps$.onClick()` via CDP Runtime.evaluate | ✅ | ❌ (called "anonymous") |
| 18 | Vehicle type set (keyboard ArrowDown+Enter) + fields filled | ✅ | ❌ (type persisted, fields lost) |
| 19 | Deal creation (Title, Value, Lead source, Contact) | — | ✅ (works for deal info) |
| 20 | Save deal button | — | ✅ (works for deal info) |

## Agent-S3 Installation (Tier 5)
```bash
pip install gui-agents
brew install tesseract
```
Version: gui-agents-0.3.2
Key deps: pyautogui, pyobjc, selenium, paddleocr, pytesseract

## bws CLI for API Keys
```bash
bws secret list | python3 -c "
import sys, json
data = json.load(sys.stdin)
for item in data:
    if item.get('key') == 'OPENROUTER_API_KEY':
        print(item.get('value', ''))
"
```
bws lives at `~/.hermes/bin/bws`.

## Free OpenRouter Models (Jul 2026)
- **Largest:** `nvidia/nemotron-3-ultra-550b-a55b:free` — 550B total, 55B active, 1M context
- **Vision/multimodal:** `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free` — 256K context
- **UI grounding:** `bytedance/ui-tars-1.5-7b` via OpenRouter (pay-per-use)
