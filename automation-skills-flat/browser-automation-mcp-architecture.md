---
name: browser-automation-mcp-architecture
description: Unified MCP State Engine for browser automation — architecture for removing the LLM from the tier-escalation loop. Persistent browser + state cache + resolver + action engine + verification.
tags: [architecture, mcp, browser-automation, state-engine, cua, cdp, salestrekker]
related_skills:
  - salestrekker-react-automation
  - four-tier-sensory-test
  - browser-automation-patterns
---

# Unified MCP State Engine — Architecture

## The Problem

The 4-tier sensory array (CDP → Chrome MCP → browser-act → Qwen3 VL → CUA) works in theory but is slow because **Hermes sits in the middle of every escalation loop**:

```
Hermes → Try Tier 0 → fail → think → Try Tier 1 → fail → think → Try Tier 2 → success
```

Each tier switch costs 5-15s of LLM token generation. The Python-level escalation is ~50ms — a 100-300x slowdown from LLM context switching.

## The Solution: State Engine MCP

Build a single MCP server that manages a persistent browser session and handles all 4 tiers internally. Hermes issues one command; the MCP escalates internally at machine speed.

## Architecture

### Layer 1: Browser State (Persistent)

A single Chromium instance stays open in the MCP background process. State is cached and refreshed on demand:

```python
PageState {
    dom: str,              # Full DOM HTML
    accessibility_tree: [], # AX tree
    screenshot: bytes,     # PNG screenshot
    url: str,              # Current URL
    viewport: {},           # Width, height
    element_map: {},        # Computed element index
    semantic_index: {}      # Text → element mapping
}
```

**Refresh strategy:** Event-driven, not polled. Use CDP `DOM.childNodeInserted`/`DOM.childNodeRemoved` and `Runtime.executionContextCreated` to invalidate cache. Refresh lazily on next command.

**Two-tier dirty flag (Dirty/DirtyCritical):** Avoid over-rebuilding on React mutation storms:

| Mutation Type | Flag | Behavior |
|--------------|------|----------|
| Text node changes, attribute updates, hover effects | `Dirty` | Rebuild DOM summary only on next call. AX + screenshot reused. |
| Dialog open/close, page navigation, React re-root | `DirtyCritical` | Rebuild ALL layers (DOM + AX + screenshot) on next call. |
| `mcp_interact()` with click/select | — | Force rebuild all layers after execution (for before/after verification). |

### Layer 2: Resolver Engine

When Hermes says "click Add Asset", the resolver tries cascading lookups internally:

```python
def resolve(target_description: str) -> Element:
    # Cascade: role → accessible name → text → DOM → visual
    element = try_ax_role(target)
        or try_accessible_name(target)
        or try_text_content(target)
        or try_dom_selector(target)
        or try_vision(target)  # OCR on cached screenshot
    return element  # {tier, confidence, selector, bounds}
```

Returns structured result with confidence score:
```json
{"tier": "AXTree", "confidence": 0.96, "element": "button#asset-add"}
```

**Contextual targeting:** When Salestrekker has duplicate elements (7x "Delete" buttons, 9x "Add vehicle loan"), use `container` parameter to scope search:

```json
{
  "target": "Delete",
  "container": "Vehicle Card #3",
  "index": "last"
}
```

Tiebreaker order for ambiguous matches:
1. **Container match** — inside the specified container wins
2. **Proximity** — closest to last interacted element (DOM distance)
3. **Index** — first, last, or numeric N among siblings
4. **Visual** — Qwen VL screenshot resolves remaining ambiguity

### Layer 3: Action Engine

Executes actions with before/after verification:

```python
def interact(action_type, target_description, value=None):
    before_state = capture_state()
    target = resolver.resolve(target_description)
    
    if target.tier == "AX":
        click_ax(target.selector)
    elif target.tier == "CDP":
        click_cdp(target.bounds)
    elif target.tier == "Vision":
        click_vision(target.coordinates)
    
    after_state = capture_state()
    
    if state_changed(before_state, after_state):
        return {"status": "success", "tier": target.tier}
    else:
        return escalate_and_retry(action_type, target, value)
```

### Layer 4: MCP Tools (4 tools exposed to Hermes)

| Tool | Purpose |
|------|---------|
| `mcp_state()` | Return structured page state: URL, title, active dialog, available buttons/forms |
| `mcp_interact(action_type, target, value)` | Execute action with auto-escalation through all tiers |
| `mcp_inspect(selector)` | Read-only: return DOM value, AX attrs, bounding box |
| `mcp_screenshot()` | Return current page screenshot for debugging |

## Key Implementation Details

### CDP: Runtime.evaluate vs page.evaluate

**CRITICAL:** `page.evaluate()` (Playwright/Patchright) strips React-injected properties from serialized results. `__reactProps$` and `__reactFiber$` keys on DOM elements are invisible via `page.evaluate()`.

Use raw CDP `Runtime.evaluate` (via `cdp.send()` or direct websocket) to access React internals:
```python
# ✅ Works — finds __reactProps$
result = cdp.send('Runtime.evaluate', {
    'expression': 'Object.keys(document.querySelector("button"))',
    'returnByValue': True
})

# ❌ Fails — returns [] for React-injected keys
result = page.evaluate("Object.keys(document.querySelector('button'))")
```

### Save button: addEventListener, not onclick

Salestrekker Save buttons have `onclick === null` — the handler is attached via React's event delegation (`addEventListener` at the root).

- `element.click()` via evaluate → does NOT trigger addEventListener handlers
- `dispatchEvent(new Event('click', {bubbles: true}))` → DOES trigger them
- `props.onClick()` via CDP Runtime.evaluate → handler runs but React state is empty

### Asset form inputs are NOT React controlled

Confirmed: inputs have no `__reactFiber$`, no `__reactProps$`, no `_valueTracker`. 
`Object.getOwnPropertyNames(input)` returns `[]` — the input has ZERO own properties.
The HTMLInputElement prototype's native value setter is NOT overridden.

### No `<form>` element

`document.querySelectorAll('form').length === 0` — the editor section has no wrapping `<form>` tag.
No `form.submit()`, `form.requestSubmit()`, or `form.dispatchEvent(new Event('submit'))` is possible.
The only way to trigger Save is through the button's React event handler chain.

## Verification Engine (Quality Principle: Verification-First)

The core innovation of the State Engine is that **success = state changed, not method returned**.

Most browser agents assume:
```python
click()
return success  # Wrong!
```

The correct flow:
```python
before_state = snapshot()
click()
after_state = snapshot()
verify(before_state, after_state)  # Did the page actually change?
```

### Per-Action-Type Success Rules

| Action | Success Criteria (any one) |
|--------|---------------------------|
| `click` on button | New dialog opened OR toast appeared OR URL changed OR API request fired |
| `click` on menu item | Menu closed AND new section appeared |
| `type` into input | `after_state.input_value === expected_value` |
| `select` combobox | `after_state.selected_value !== before_state.selected_value` |
| `save` / submit | Success toast OR dialog closed OR API request with 2xx |

### Quality Requirements

- **Verification-first**: All actions capture before/after state. Verification checks for state change, not method return.
- **Confidence thresholds**: Element resolution below 0.5 confidence is rejected. No blind action execution.
- **Known-bug registry**: Salestrekker-specific bugs (Radix portal blocking, false-positive "Client profile updated" with no data persistence) are catalogued and checked during verification.
- **Tier auto-tuning**: Tiers that fail >30% for a given action type are automatically skipped (from Action Journal data).
- **Failure envelope**: Structured error response with page errors, not just "failed".

### Salestrekker False-Positive Detection

Known bug: "Client profile successfully updated" often appears WITHOUT data persisting. The verification engine MUST check for actual state change (URL, API call, dialog close) and NOT accept this toast as proof of success:

```python
# ❌ Do NOT treat as success
if "Client profile successfully updated" in after_state.toasts:
    return verified  # False positive — data didn't save

# ✅ Check for actual state change
if after_state.url != before_state.url:
    return verified
if after_state.api_requests > before_state.api_requests:
    return verified
```

### IDD/SDD Documentation

Every State Engine component requires two design documents alongside the FRS:

- **IDD (Intent Driven Design)** — Defines the intent behind component interfaces: what each component is designed to achieve, the contracts it fulfills, and the invariants it maintains. Location: `docs/IDD-*.md`.
- **SDD (System Design Document)** — Defines internal architecture: component boundaries, data flow, escalation policy, file structure. Location: `docs/SDD-*.md`.

Document ordering: **FRS → SDD → IDD → Implementation**. Required for any new MCP tool, CDP subscription, or subsystem.

On failure, return structured context so Hermes can diagnose, not just retry:

```json
{
  "status": "failed",
  "action": "click",
  "target": "Save and calculate",
  "tiers_attempted": [
    {"tier": "AX", "error": "element_not_found"},
    {"tier": "CDP", "error": "click_no_state_change"}
  ],
  "verification": {
    "verified": false,
    "reason": "no_state_change_detected"
  },
  "state": {
    "url": "https://pc.v2.salestrekker.com/.../assets",
    "dialog": null,
    "buttons": ["Prev", "Save and calculate", "Next"],
    "errors": ["Vehicle type is required"]
  }
}
```

The `state.errors` field is critical — Hermes reads it to decide WHAT to fix, not just THAT it's broken.

## Action Journal (FR-10)

Every action generates a JSON-Lines entry at `~/.hermes/logs/state-engine/actions.jsonl`:

```json
{
  "timestamp": "2026-07-28T14:30:00.000Z",
  "session_id": "a1b2c3d4",
  "action": "click",
  "target": "Save and calculate",
  "tier_used": "REACT",
  "verified": true,
  "duration_ms": 274,
  "errors_on_page": []
}
```

Failed actions include `failure_reason`, `state_snapshot`, and `tiers_attempted_detail`.

**Tier performance tracking:** If a tier fails >30% of the time for a given action type, skip it and start from the next tier. Auto-tuning from journal data.

## Workflow Engine (FR-11 — Lite)

Deterministic multi-step workflows (NOT AI-generated plans):

```json
{
  "add_vehicle_asset": [
    {"action": "click", "target": "Add asset"},
    {"action": "click", "target": "Vehicles make and model"},
    {"action": "type", "target": "Vehicle make and model", "value": "{make} {model}"},
    {"action": "type", "target": "Value", "value": "{value}"},
    {"action": "click", "target": "Save and calculate"}
  ]
}
```

Stored as YAML in `~/.hermes/workflows/`. Hermes calls `mcp_workflow("add_vehicle_asset", {make: "BMW", value: "40000"})` — one LLM call replaces 6 micro-interactions.

Steps execute sequentially. On failure, return the failure envelope with `workflow_step` field indicating which step failed. No auto-retry at workflow level — Hermes decides.

## Build Phases & Effort

| Phase | Components | Effort | Dependencies |
|-------|-----------|--------|-------------|
| 1 | CDP connection manager, State Cache, State Diff, Verification Engine | 1.5d | Nothing |
| 2 | Cascade Resolver, Action Engine (wrapping SensoryArray), pyautogui | 1.5d | Phase 1 |
| 3 | FastMCP server, 4 MCP tools, Workflow Engine, Action Journal, Salestrekker rules | 1.5d | Phase 2 |
| 4 | Full Salestrekker asset form end-to-end test, reliability measurement | 1d | Phase 3 |

The existing SensoryArray (~37KB) provides ~60% of Phases 1-2. The largest new pieces are the state cache (lazy invalidation), resolver (confidence-based cascade), and verification (before/after diff).

## Agent-S3 (Tier 5) as Ultimate Fallback

Agent-S3 (`gui-agents`) sends real OS-level events via `pyautogui` (CGEvent). These are genuine hardware-level events that React's synthetic event system CANNOT ignore.

```bash
pip install gui-agents
brew install tesseract
```

Target config:
```bash
python3 -m gui_agents.s3.cli_app \
  --provider open_router \
  --model "nvidia/nemotron-3-ultra-550b-a55b:free" \
  --model_url "https://openrouter.ai/api/v1" \
  --model_api_key "$(bws secret list | python3 -c \"import sys,json;d=json.load(sys.stdin);[print(i['value']) for i in d if i['key']=='OPENROUTER_API_KEY']\")" \
  --ground_provider openai \
  --ground_url "http://localhost:11434/v1" \
  --ground_model "qwen3-vl:4b" \
  --grounding_width 1920 \
  --grounding_height 1080
```

**Note:** OpenRouter API key is NOT available in `os.environ` from terminal subprocesses. Access it via `bws` CLI:
```bash
bws secret list | python3 -c "import sys,json;d=json.load(sys.stdin);[print(i['value']) for i in d if i['key']=='OPENROUTER_API_KEY']"
```

## Build Order

1. **Persistent CfT connection** (already done — launchd agent)
2. **State cache** (DOM + AX + screenshot on single capture)
3. **Resolver** (text → role → AX → visual cascade, returns confidence)
4. **Action Engine** with before/after verification
5. **Expose as 4 MCP tools** (`mcp_state`, `mcp_interact`, `mcp_inspect`, `mcp_screenshot`)

Estimated effort: 1-2 days using FastMCP Python framework. The existing SensoryArray Python code (~37KB) provides ~60% of the implementation — needs cache layer, resolver, and verification loop added.
