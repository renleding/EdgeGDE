# RCA — Why Memory Failure Went Unrecognised for 10+ Weeks

Status: COMPLETE (evidence-based)
Date: 2026-08-08
Owner: Hermes
Related: MEM-DOC-0001 (restoration plan), this feeds v2

## 1. What happened (the failure)

MemPalace stopped receiving new drawers on **2026-05-26** and the knowledge graph
froze at **19 triples / 21 entities (last extraction 2026-05-21)**. The write path
was dead for **74 days**. ~10 weeks of work (ART appeal, foreign-buyer report,
gateway fixes, cmux-herdr, config tuning) was never mined. Nobody — no cron job,
no improvement loop, no sweep, no status check — detected it until a manual
performance review on 2026-08-08.

## 2. Timeline of the failure (reconstructed from evidence)

| Date | Event | Evidence |
|---|---|---|
| 2026-05-21/22 | MemPalace MCP server wired; `/mem` command added; skill documents `mcp_servers.mempalace` | Session 20260522_123143; skill history |
| 2026-05-26 | LAST drawer ever written (embeddings created_at max) | chroma.sqlite3 `embeddings.created_at` |
| ≤ 2026-06-18 | Ladybug projection layer designed (telegram session) | Session 20260618_220824 |
| May 22 → Jul 14 | `mcp_servers.mempalace` entry removed from config.yaml; `memory.provider` switched '' → `mempalace_ladybug_projection` | Jul 14 pre-update snapshot shows provider set + mcp_servers has ONLY custom-tools |
| 2026-07-14 | Hermes update snapshot taken — MCP entry already gone, provider-only | `~/.hermes/state-snapshots/20260714-142256-pre-update/config.yaml` |
| Jul 14 → Aug 8 | 3.5 weeks more dormancy; all 30 cron jobs report `ok`; sweep/CI-loop/health checks all green | cron outputs, agent.log |
| 2026-08-08 | Manual review discovers dormancy; restoration plan created | This session |

**Removal window:** the MCP entry was present on 22 May and gone by 14 Jul.
Paper-search + tavily were added to mcp_servers AFTER the snapshot (they exist in
current config), but mempalace was never restored. The switch to the Ladybug
provider (3 read-only tools) made the palace *look* integrated while silently
removing the 30-tool write path.

## 3. Root causes (why the monitoring failed)

### RC1 — Coverage gap: no monitoring scope includes memory-stack health
All 30 cron jobs audited. Zero check MemPalace activity/freshness:
- **Daily system sweep** — audits codebases, git, CI, cron fleet, security headers, wrangler. NO memory section.
- **Continuous Improvement Loop** — runs `improvement_loop.py` (missions.db + PRs) and `chores_to_workflows.py`. Scans the EdgeGDE repo's `.hermes/memory/missions.db` — a different memory entirely.
- **droid-daily-infra** — "MEMORY" section is `vm_stat` (system RAM), not MemPalace.
- **weekly-session-to-skill-review** — greps sessions for the *keyword* mempalace; never checks live palace state (drawer count, filed_at freshness, KG triples).
- No job defines an expected drawer-growth or KG-growth baseline, so nothing could trip.

### RC2 — Silent-green failure mode (the trap)
Every signal that was checked looked healthy:
- Launchd server up, `:8888` → 200
- `memory.provider` active, 3 Ladybug tools registered in agent.log
- Daily Ladybug reseed runs — but rebuilds the SAME frozen 19-triple snapshot (manifest `mempalace-ladybug-20260808T000655Z` still 21/38/19)
- Viz regeneration "works" — re-reads the same 173 drawers

The architecture has no freshness *delta* check: "pipeline alive" and "source
dead" are indistinguishable without comparing drawer/KG counts over time.

### RC3 — No SLO / no baseline
Nothing defined "memory must grow by ≥N drawers/week" or "KG must have >N
triples". Without a target metric, no alert can fire. This is a governance
omission, not a tooling bug.

### RC4 — Skill drift masked the failure
The mempalace SKILL.md continued to state "MCP-connected via
`mcp_servers.mempalace`" long after the entry was removed. Any session loading
the skill assumed the write path existed and never verified. The skill was
actively wrong for the entire dormant period.

### RC5 — Improvement loops scan the wrong dimension
The CI loop and sweep are EdgeGDE-repo-scoped (missions, PRs, git). The memory
stack is infrastructure, outside every improvement job's scope. Improvement
tooling reviews *what changed in the repo* — not *whether the memory system is
still being fed*.

### RC6 — (contributing) config migration risk
The Hermes update on 2026-07-14 coincided with the provider switch. Config
rewrites/migrations that drop unknown `mcp_servers` entries are a known
silent-failure vector; no post-update config-diff check exists.

## 4. Why "the crons should have caught it" is the wrong expectation

They were never built to. The sweep/CI-loop/health jobs are:
- **Scope**: EdgeGDE repo + system services (RAM, Ollama, git, CI)
- **Memory checks**: none

The one job with "memory" in its name (`droid-daily-infra`) checks **RAM**.
The one job that greps for mempalace (`weekly-session-to-skill-review`) greps
**session text**, not **live palace state**. Expectation mismatch: Warren
reasonably assumed monitoring existed because the fleet is large and green;
in fact the fleet is repo-scoped and the memory stack has no watcher.

## 5. Recommended solutions (priority order)

### S1 — Memory freshness watchdog cron (the primary fix)
New `no_agent=true` script cron (e.g. daily 06:30) that checks:
1. `MAX(embeddings.created_at)` age — alert if > 7 days old
2. Drawer count delta vs last run — alert if unchanged for 14 days
3. KG triple count + `MAX(extracted_at)` — alert if < 50 triples or > 30 days
4. `mcp_servers.mempalace` present in config.yaml — alert if missing
5. `:8888` HTTP 200 — alert if down
Silent when healthy, one-line Telegram alert otherwise.
→ Tracked as **MEM-AUT-0003** (already in plan) — escalate to TOP priority, add
   the config-presence check.

### S2 — Add memory-stack section to system-sweep skill
Patch `system-sweep/SKILL.md` Discover phase with a 4-command memory freshness
check (drawer max date, KG triples, MCP entry, server). Sweep then catches
dormancy on its daily run even if the watchdog is missed.
→ Tracked as **MEM-SKL-0002** (new).

### S3 — Define memory SLO in the governance policy
In MEM-POL-0001 add explicit SLOs: drawer growth ≥ 1/week expected (mining
cron), KG ≥ 100 triples, projection reseed ≤ 24h old, MCP entry always present.
Health cron alerts on SLO breach, not just on "server down".

### S4 — Fix the skill drift (already tracked)
MEM-SKL-0001: correct SKILL.md MCP section to document BOTH integration paths
(30-tool MCP server + 3-tool Ladybug provider) and add the restoration runbook.
Prevents future sessions from trusting a stale "it's wired" claim.

### S5 — Config-drift guard after updates
Add a post-update config check (sweep or watchdog): diff `mcp_servers` keys
against a baseline file. Alert if entries vanish. Cheap, prevents the
May→Jul silent removal class.

### S6 — Immediate restoration (already planned)
The 13-task MEM-* restoration backlog (backup → re-wire MCP → smoke test →
mine backlog → KG rebuild → reseed → QA → compress → prune → policy → health
cron → skill patch) — see `restoration-mempalace-ladybug-plan.md`.

## 6. Corrective-action owners

| Action | Owner | Task |
|---|---|---|
| Freshness watchdog cron (with config check) | Hermes | MEM-AUT-0003 (upgraded) |
| Sweep skill memory section | Hermes | MEM-SKL-0002 (new) |
| SLOs in governance policy | Hermes | MEM-POL-0001 |
| Skill drift fix + runbook | Hermes | MEM-SKL-0001 |
| Config-drift guard | Hermes | MEM-SKL-0002 / sweep |
| Restoration execution | Hermes | MEM-OPS-0001…MEM-SKL-0001 |

## 7. Prevention statement

The dormancy recurrence is prevented when ALL of:
1. MEM-AUT-0003 health cron runs daily and alerts on freshness (not just liveness)
2. System sweep includes the memory-stack check (S2)
3. MEM-POL-0001 SLOs define minimum growth/age thresholds
4. The MCP entry presence is checked by both (S1 + S2)
5. Skill docs no longer claim integration that isn't configured (S4)
