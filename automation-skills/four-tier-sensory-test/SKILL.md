---
name: four-tier-sensory-test
description: >
  Execute Test 4 — full Salestrekker deal creation using the 4-tier sensory
  array (CDP → Chrome MCP → browser-act → Qwen3 VL → CUA-driver). Captures
  escalation events, root-cause analysis, and learning patterns.
tags: [salestrekker, test, 4-tier, sensory, automation, testing, analysis]
related_skills:
  - agent-process-automation
  - salestrekker-react-automation
  - macos-computer-use
---

# 4-Tier Sensory Array — Test 4 Execution Guide

## Overview

Execute Test 4: Purple Circle Onboarding against Salestrekker 2.0 using the
4-tier sensory array. Tiers work **in unison** — every interaction starts at
Tier 0 (CDP Patchright evaluate) and escalates through 1→2→3→4 only when
the preceding tier cannot resolve the target.

This skill documents HOW to run the test and analyze results. The actual
automation script lives at:
`EdgeGDE/automation/test-4-purple-circle-onboarding/test4_onboarding.py`

## Prerequisites

- **Chrome for Testing** running with CDP port 9222 (launchd agent auto-starts)
- **Environment variables** injected from Bitwarden:
  - `SALESTREKKER_USERNAME`
  - `SALESTREKKER_PASSWORD`
  - `SALESTREKKER_TOTP_SECRET`
- **Python packages:** `playwright` (or `patchright`), `pyotp`, `requests`
- **CfT launchd agent** loaded: `launchctl load ~/Library/LaunchAgents/com.edgegde.chrome-for-testing.plist`
- **CUA-driver daemon** running (for Tier 4 fallback)
- **Ollama** running with `qwen3:4b-vl` model loaded

## The 4-Tier Sensory Array

```
Tier 0: CDP (Patchright page.evaluate)          ← PRIMARY PATH
  ↓ if element not found or click fails
Tier 1: Chrome DevTools MCP                      ← DOM inspection
  ↓ if MCP can't resolve (shadow DOM, canvas)
Tier 2: Agent Browser CLI (browser-act)          ← Compressed AX tree
  ↓ if AX tree ambiguous
Tier 3: Ollama Qwen3 VL (vision_analyze)         ← Visual bounding box
  ↓ if browser-level fails or OS dialog
Tier 4: CUA-driver (computer_use)                ← OS-level background control
```

### Tier Activation Rules

| Condition | Action |
|-----------|--------|
| CDP querySelector returns null | Escalate to Tier 1 |
| MCP DOM.getDocument times out or returns empty | Escalate to Tier 2 |
| AX tree element not found by role+label | Escalate to Tier 3 |
| Canvas/shadow DOM/obfuscated element | Start at Tier 3 (skip 0-2) |
| Native OS dialog, WAF block, CAPTCHA | Escalate to Tier 4 |
| CDP click succeeds (element found) | No escalation — log nothing |

## Execution Procedure

### Step 1: Verify Environment

```bash
# Check CfT CDP connectivity
curl -s http://localhost:9222/json/version | head -5

# Check CUA-driver daemon
cua-driver status

# Check Ollama qwen3-vl
ollama list | grep qwen3
```

### Step 2: Connect to CfT

```python
from patchright.sync_api import sync_playwright
pw = sync_playwright().start()
browser = pw.chromium.connect_over_cdp('http://localhost:9222')
page = browser.contexts[0].pages[0]
```

### Step 3: Run the Test

```bash
cd ~/Documents/_HQ_AI/EdgeGDE
bws run -- 'python3 automation/test-4-purple-circle-onboarding/test4_onboarding.py'
```

### Step 4: Monitor Progress

The script outputs:
- **INFO** lines — normal progress through phases
- **WARN** lines — tier escalation events (expected, means lower tier failed)
- **ERROR** lines — failures requiring analysis
- **ESCALATION** blocks — structured JSON for each escalation

Example output:
```
INFO  | Phase A | Login successful (attempt 1)
WARN  | Phase B | Tier 0→Tier 2 escalation: 'Add New Deal' behind shadow DOM
INFO  | Phase D | Sam Smith: 14/14 fields entered
ESCAL| {"step":"click Add New","failed_tier":0,"reason":"Shadow DOM","resolving_tier":2}
```

### Step 5: Generate Post-Test Analysis

After completion, the script produces:

```
automation/test-4-purple-circle-onboarding/logs/test4_20260727_143000.jsonl
automation/test-4-purple-circle-onboarding/reports/escalations.json
automation/test-4-purple-circle-onboarding/reports/summary.yaml
automation/test-4-purple-circle-onboarding/reports/deal_confirmation.png
```

## Escalation Logging Format

Every escalation event is logged both stdout (readable) and JSONL (structured):

### Readable log
```
ESCALATION [Step: click Save button]
  Tier 0 FAIL: page.evaluate('button:has-text("Save")') returned null
    → DOM state: URL=/deals/home-loan/..., visible buttons=["Calculate", "Back"]
  Tier 1 FAIL: MCP DOM.getDocument — button found but React disabled (aria-disabled=true)
  Tier 2 SUCCESS: AX tree → role=AXButton "Save" at element_index=47, isEnabled=true
  Resolution: AXPress via browser-act, duration 120ms
  Root Cause: React disabled state not reflected in HTML (__reactProps.onClick required)
```

### Structured JSONL
```json
{"ts":"...","step":"click Save","tier":0,"result":"FAIL","reason":"element not found","dom_state":"..."}
{"ts":"...","step":"click Save","tier":1,"result":"FAIL","reason":"React disabled state"}
{"ts":"...","step":"click Save","tier":2,"result":"SUCCESS","method":"AXPress index=47","duration_ms":120}
```

## Root Cause Analysis Pattern

After test completion, cluster escalations by root cause:

```python
# In analysis, group by failure_reason:
clusters = {
    "Shadow DOM encapsulation": ["click Add New Deal", "click Home Loan", ...],
    "React disabled state": ["Save button", "Next button", ...],
    "Radix popover not triggering": ["Add Contact", "Add Asset", ...],
    "Canvas element (no DOM)": ["Signature field", "Chart interaction"],
}
```

For each cluster, determine:
1. **Can CDP be improved?** (add shadow-piercing selector, pre-register locator)
2. **Is a new helper function needed?** (e.g., `click_react_disabled()`)
3. **Is this a permanent Tier 2/3/4 requirement?** (document in baseline)

## Performance Targets

| Metric | Target | Stretch |
|--------|--------|--------|
| Tier 0 success rate | >90% of interactions | >95% |
| Avg escalation depth | <1.5 tiers per escalation | <1.2 |
| Total run time | <30 min | <15 min |
| Login attempts | 1 | 1 |
| Manual interventions | 0 | 0 |

## Login Lockout SOP (Hard Rule)

```
Attempt 1: Full login
  ✓ → continue
  ✗ → log failure, attempt 2

Attempt 2: Full login (same session)
  ✓ → continue
  ✗ → STOP. DO NOT RETRY.
       Report: login URL, error text, visible state.
       Wait for user instruction.
```

Salestrekker rate limit: 15s silence → 45s → 20min+ lockout.

## Common Failure Modes

| Symptom | Likely Cause | Tier Fix |
|---------|-------------|----------|
| `page.evaluate()` returns null for known element | Element inside closed shadow DOM | Tier 2 (AX tree) |
| `locator.click()` succeeds but nothing happens | React event not triggered by synthetic click | Use native `.click()` via evaluate |
| Button visible but `is_enabled()` returns false | React-controlled disabled state | `__reactProps.onClick()` bypass |
| Popover opens but menu items don't respond | Radix/Floating UI wrapper | native `.click()` on aria-haspopup div |
| TOTP field fills but form doesn't submit | React onChange not fired | native setter + dispatchEvent |
| `page.goto()` navigates to sign-out page | Bot detection from full URL navigation | Use `window.location.href` instead |
| CUA-driver click lands but nothing changes | SPA JS handler ignores CGEvent | Escalate to CDP evaluate instead |

## Post-Test Artifacts

| What | Where | Purpose |
|------|-------|---------|
| Full execution log | `logs/test4_<date>.jsonl` | Replay and audit |
| Escalation report | `reports/escalations.json` | Which tiers fired and why |
| Performance summary | `reports/summary.yaml` | Metrics dashboard |
| Deal confirmation | `reports/deal_confirmation.png` | Visual proof of completion |
| Updated skill | This SKILL.md | Learning capture |

## Skill Update Protocol

After each Test 4 execution:

1. Review the escalation report
2. Identify recurring patterns (3+ same root cause)
3. For each pattern:
   - Can CDP be improved to avoid escalation? → Update the script
   - Is it a permanent tier 2/3/4 requirement? → Document in this skill's "Known Failure Modes"
   - Is the escalation handler itself broken? → Fix the escalation logic
4. Update this SKILL.md with new findings
5. Commit updated script to repo
