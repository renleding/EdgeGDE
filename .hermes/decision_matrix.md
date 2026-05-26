# EdgeGDE Decision Matrix — Coding Agent Selection
## Hermes vs Aider vs Routa/Aider
*Generated from benchmark data — Phase 26*

---

## 1. Benchmark Results Summary

### Single-File Patch (Scenario A — buildInlineStyle)

| Metric | Hermes | Aider | Routa/Aider |
|---|---|---|---|
| **Time** | 9s | 10s | N/A (requires git repo) |
| **Accuracy** | 14/14 | 14/14 | N/A |
| **Retries** | 0 | 0 | N/A |
| **Infra needed** | None | LiteLLM on :4000 | LiteLLM + Routa Web + git repo |
| **Context required** | Files in session | Auto-reads via repo-map | Auto-reads via worker |

### Multi-File Feature (Scenario B — 3 files, cross-file imports)

| Metric | Hermes | Aider | Routa/Aider |
|---|---|---|---|
| **Time** | 8s | 20s | N/A (requires git repo) |
| **Accuracy** | 12/12 | 12/12 | N/A |
| **Retries** | 0 | 0 | N/A |
| **File reads** | Manual (read_file) | Auto (repo-map) | Auto (worker traversal) |

---

## 2. Decision Matrix

| Condition | Hermes | Aider CLI | Routa/Aider |
|---|---|---|---|
| **1 file, in session context** | ✅ **Use this** — fastest path, 9s | ⚠️ Overkill — model warmup costs 10s | ❌ Pipeline overhead not justified |
| **1 file, cold (not seen this session)** | ⚠️ Must read_file first (~15s total) | ✅ **Use this** — auto-reads, 15s total | ❌ Same as Aider but with task overhead |
| **2-3 files, same package** | ✅ **Use this** — if files are related and small | ⚠️ Works but slower on reasoning tasks | ⚠️ Use only if traceability needed |
| **3+ files, cross-package** | ❌ Context fills up, risk of missed files | ✅ **Use this** — repo-map handles file discovery | ✅ **Use this** — adds task tracking + branch isolation |
| **Repetitive/mechanical change across N files** | ❌ Manual per-file, error-prone | ✅ **Use this** — same prompt, repeats consistently | ✅ **Use this** — best for batch operations |
| **Production deploy (staging → promote)** | ❌ Cannot do — needs MCP endpoint | ❌ Cannot do — no task state | ✅ **Use this** — full pipeline: task → branch → code → merge → deploy |
| **Quick bugfix on known code** | ✅ **Use this** — 9s, 0 retries | ❌ Not faster | ❌ Not appropriate |
| **Architecture/design work** | ✅ **Use this** — reasoning quality higher | ⚠️ Good for implementation after design | ⚠️ Good if task decomposition needed |
| **Cold exploration (unfamiliar codebase)** | ❌ Must manually read everything | ✅ **Use this** — repo-map auto-discovers structure | ✅ **Use this** — worker traverses and reports |
| **No infra running (LiteLLM down)** | ✅ **Use this** — works standalone | ❌ Cannot run | ❌ Cannot run |

---

## 3. When NOT to use each

| Agent | Avoid when |
|---|---|
| **Hermes** | Task spans 4+ files across different packages. Files outside current session context. |
| **Aider CLI** | LiteLLM is down. Task requires multi-step state tracking (TDD cycle). Need production deployment. |
| **Routa/Aider** | Quick one-off fix. Task is in a throwaway directory (not a git repo). LiteLLM or Routa Web is down. |

---

## 4. Recommended Default Workflow

```
1. Is LiteLLM running?
   ├─ No  → Use Hermes (always available)
   └─ Yes → Continue

2. How many files?
   ├─ 1      → Hermes (fastest)
   ├─ 2-3    → Hermes if in context, Aider if cold
   └─ 4+     → Routa/Aider

3. Does the task need traceability?
   ├─ No  → Aider CLI (simpler)
   └─ Yes → Routa/Aider (task tracking, branch isolation)

4. Is this a production deploy?
   ├─ No  → Aider CLI or Hermes
   └─ Yes → Routa/Aider (must go through pipeline)
```

## 5. Observed Weaknesses

| Agent | Known issue |
|---|---|
| **Hermes** | Can't hold 4+ files in context reliably. No automatic file discovery. |
| **Aider CLI** | Thinking blocks are verbose (~1.5k tokens overhead per task). 2x slower than Hermes on reasoning-heavy tasks. |
| **Routa/Aider** | Requires Routa Web UI on :3001 + git repo context. High infra overhead. Worker not currently configured for auto-start. |
