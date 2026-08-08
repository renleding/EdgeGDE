# MemPalace / Ladybug Restoration Plan — v2 (RCA-corrected)

Status: READY FOR EXECUTION (supersedes v1)
Created: 2026-08-08
Owner: Hermes
Board: edgegde-core-dev
Docs: `docs/restoration-mempalace-ladybug-plan.md` (v1), `docs/restoration-mempalace-ladybug-rca.md` (RCA)

## Why v2

v1 restored function (backup → MCP → mine → KG → reseed → QA → hygiene →
governance). v2 adds the **monitoring corrective actions** that the RCA
identified as the actual failure: the palace was dormant 74 days with every
existing check green because no check had memory freshness in scope.

## RCA verdict (one line)

**The monitoring crons did not fail — they never covered the memory stack.**
All 30 jobs audit EdgeGDE repo dimensions (missions, PRs, git, CI, RAM);
none check drawer growth, KG freshness, or MCP wiring. The Ladybug provider
being active + server up + daily reseed created a silent-green appearance.

## RCA root causes → corrective actions

| # | Root cause | Corrective action | Task |
|---|---|---|---|
| RC1 | No monitoring scope includes memory health | Freshness watchdog cron + sweep skill section | MEM-AUT-0003 (upgraded), MEM-SKL-0002 |
| RC2 | Silent-green (liveness ≠ freshness) | Watchdog checks deltas/ages, not just up/down | MEM-AUT-0003 |
| RC3 | No SLO/baseline | Explicit SLOs in governance policy | MEM-POL-0001 |
| RC4 | Skill drift claimed MCP wired | Correct SKILL.md both paths + runbook | MEM-SKL-0001 |
| RC5 | Improvement loops repo-scoped | Memory block in sweep; watchdog independent of repo | MEM-SKL-0002, MEM-AUT-0003 |
| RC6 | Config migration dropped mcp_servers entry | Config-drift guard (baseline diff) | MEM-SKL-0002 |

## Full execution backlog (v2 = v1 tasks + corrective actions)

### P0 — Safety
1. **MEM-OPS-0001** Backup palace + ROOT KG + config → Cubbit; baseline snapshot. Gates everything.

### P1 — Restore write path
2. **MEM-FIX-0001** Re-wire `mcp_servers.mempalace` (venv binary) → gateway restart → verify 30+ tools.
3. **MEM-TEST-0001** Write-path smoke: add → search → delete; count returns to baseline.

### P2 — Restore ingestion
4. **MEM-AUT-0001** Mine 10-week backlog → `agent/conversations` (`--mode convos --wing agent`).
5. **MEM-AUT-0002** Weekly mining cron (deterministic script job).

### P3 — Restore semantic layer
6. **MEM-FIX-0002** Rebuild KG with provenance: 19 → 100+ triples, `source_drawer_id` > 50%.
7. **MEM-FIX-0003** Reseed Ladybug from ROOT KG (never `palace/` copy — 0 triples).
8. **MEM-TEST-0002** Retrieval QA: deterministic accuracy/latency + live searches.

### P4 — Hygiene
9. **MEM-OPS-0002** Compress agent/conversations (110 raw, additive).
10. **MEM-OPS-0003** Prune `mempalace_test` residue + verify config.json.

### P5 — Governance + MONITORING (v2 corrective core)
11. **MEM-POL-0001** Governance policy with **explicit SLOs**:
    - Drawer growth ≥ 1/week (mining cron running)
    - KG ≥ 100 triples, `MAX(extracted_at)` ≤ 30 days
    - Ladybug reseed ≤ 24 h old (manifest check)
    - `mcp_servers.mempalace` entry ALWAYS present
12. **MEM-AUT-0003** **Freshness watchdog cron (upgraded — the primary fix)**:
    Daily `no_agent=true` script; alert on any of:
    - `MAX(embeddings.created_at)` > 7 days old
    - Drawer count unchanged for 14 days
    - KG < 50 triples or `MAX(extracted_at)` > 30 days
    - `mcp_servers.mempalace` missing from config.yaml
    - `:8888` not HTTP 200
    Silent when healthy; one-line Telegram alert otherwise.
13. **MEM-SKL-0002** **System-sweep skill memory section + config-drift guard (NEW)**:
    - Sweep Discover phase gains the 4-command memory freshness block
    - Config-drift guard: baseline `mcp_servers` keys, alert on vanished entries
    (prevents the RC6 May→Jul silent removal class)

### P6 — Documentation
14. **MEM-SKL-0001** Patch mempalace skill: both integration paths + restoration runbook + RCA pointer.
15. **MEM-DOC-0002** This v2 document (deliverable).

## Definition of done (v2 additions)

v1 DoD plus:
- [ ] MEM-AUT-0003 watchdog live, daily, alerts on freshness (not just liveness)
- [ ] Sweep skill includes memory-stack check (manual sweep run reports it)
- [ ] MEM-POL-0001 SLOs defined (≥1 drawer/wk, KG ≥100, reseed ≤24h, MCP entry present)
- [ ] Config-drift guard script exists and passes against current config
- [ ] Skill no longer claims MCP wired when it isn't

## Prevention statement

Dormancy recurrence is prevented when ALL of: watchdog (MEM-AUT-0003) runs
daily with freshness checks; sweep includes memory block (MEM-SKL-0002);
policy SLOs exist (MEM-POL-0001); MCP-entry presence checked by both; skill
docs accurate (MEM-SKL-0001).

## Rollback / compensation

Unchanged from v1: Cubbit backup restores KG; Ladybug manifest `rollback_to`
pointer; MCP re-wire reverts as config yaml edit + gateway restart; mining
duplicates prunable via ChromaDB delete.
