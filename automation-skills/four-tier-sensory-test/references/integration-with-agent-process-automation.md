# 4-Tier Sensory Array — Integration with Agent Process Automation

This reference documents how the 4-tier sensory array integrates with the
existing `agent-process-automation` engine. The execution layer is always
the generic engine (CDP via CfT + Playwright/Patchright). The 4-tier array
is the sensory/discovery layer that resolves element targets when the
primary CDP path fails.

## Integration Architecture

```
agent-process-automation (execution engine)
    auto_login() | click_safe() | handle_popover() | navigate_wizard()
    │
    ▼ (when a locator/discovery is needed)
four-tier-sensory-test (discovery/resolution protocol)
    SensoryArray.resolve(label, selector, js_code)
    │
    ├── Tier 0: CDP page.evaluate()          ← primary, fastest
    ├── Tier 1: Chrome DevTools MCP           ← DOM inspection
    ├── Tier 2: browser-act CLI               ← compressed AX tree
    ├── Tier 3: Ollama Qwen3 VL               ← vision bounding box
    └── Tier 4: CUA-driver                    ← OS-level background
```

## When to Load Which Skill

| Task | Load |
|------|------|
| Writing browser automation scripts | `agent-process-automation` |
| Debugging element discovery issues | `four-tier-sensory-test` |
| Running the full Test 4 (Salestrekker deal) | `four-tier-sensory-test` |
| Understanding escalation logging format | Both |
| Fixing login/popover/SPA issues | `salestrekker-react-automation` |

## Integration Pattern

```python
# 1. Use agent-process-automation for execution
from patchright.sync_api import sync_playwright
pw = sync_playwright().start()
browser = pw.chromium.connect_over_cdp('http://localhost:9222')
page = browser.contexts[0].pages[0]

# 2. Use 4-tier array for discovery
sensory = SensoryArray(page, None)

# 3. Try CDP first (fast path)
ok, _ = sensory.tier0_cdp("""() => {
    var b = document.querySelector('button:has-text("Save")');
    if (b) { b.click(); return true; }
    return false;
}()""")
if not ok:
    # 4. Escalate through 4-tier
    target = sensory.resolve("Save button",
        selector="button:has-text('Save')",
        role="AXButton")
    if target:
        # Interact based on target.strategy
        if target.strategy == "ax_index":
            # Use browser-act or CUA to click element_index
            ...
```

## Escalation Logging

See the spec at `EdgeGDE/openspec/specs/4-tier-sensory-test/spec.md` for
the full escalation logging schema. All escalations produce structured JSONL.
