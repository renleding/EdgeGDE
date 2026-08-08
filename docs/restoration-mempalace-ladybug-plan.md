# MemPalace / Ladybug Restoration Implementation Plan

Status: READY FOR EXECUTION
Created: 2026-08-08
Owner: Hermes (assignee on all MEM-* tasks)
Board: edgegde-core-dev (kanban)

## 1. Context — Measured State (2026-08-08)

| Component | Measured state | Health |
|---|---|---|
| Palace | 173 drawers, 4.4 MB, structure clean (agent 145, hermes 21, edgegde 4, routa 2, warren 1) | OK (structure), DORMANT (data) |
| Drawer additions | Last write 2026-05-26. Zero additions Jun / Jul / Aug | FAIL — 10 weeks dead |
| Knowledge graph | 19 triples / 21 entities, last extraction 2026-05-21, `source_drawer_id` coverage = 0 | FAIL — near-empty, no provenance |
| MCP integration | `mcp_servers.mempalace` MISSING from config.yaml (binary exists at hermes_workspace venv, unwired) | FAIL — write path dead |
| Memory provider | `memory.provider = mempalace_ladybug_projection` (3 read-only tools) — active, daily reseed | OK but feeds from frozen KG |
| Ladybug projection | 21 entities / 38 edges / 19 facts, `mempalace-ladybug-20260808T000655Z`, daily rebuild | OK mechanically, stale data |
| Server | launchd `com.hermes.mempalace-server` up, :8888 = 200, viz regenerated Aug 7 | OK |
| Mining cron | None exists | FAIL — no ingestion |
| agent/conversations | 110 raw drawers (compression threshold = 50) | Bloat |
| Test residue | 2 drawers in wing `mempalace_test` (from /private/tmp) | Cleanup |

**Summary:** the pipeline (server, projection, provider) is alive but the source (drawers + KG) is dead. Memory content stops at 26 May; ~10 weeks of work (ART appeal, foreign-buyer report, gateway fixes, cmux-herdr, config tuning) is un-mined.

## 2. Architecture Target (post-restoration)

```
Write path (restored)
  MemPalace drawer/event (mempalace-mcp 30+ tools)
    -> Droid deterministic extractor / projection mission
    -> Aegis policy gate (edgegde-memory-policy-v1)
    -> SQLite KG append (valid_from, valid_to, confidence, source_drawer_id, adapter_name, extracted_at)
    -> Ladybug read-only projection (daily reseed)
    -> audited MCP read contract (mempalace_ladybug_* 3 tools)

Ingestion cadence
  weekly mining cron  -> agent/conversations (--mode convos --wing agent)
  weekly health cron  -> dormancy + freshness alert
  compress trigger    -> conversations > 50 drawers
```

Authority: MemPalace drawers = source of truth. SQLite KG = deterministic projection. Ladybug = read-only cache. No autonomous memory manager (Graphiti / Cognee / LlamaIndex / LangGraph) may mutate. KuzuDB excluded (archived upstream).

## 3. Execution Backlog — Priority Order

Dependency chain: MEM-DOC-0001 (plan) → all phases.

### P0 — Safety (do first, nothing mutates before this)
| # | Task | ID | Depends |
|---|---|---|---|
| 1 | Pre-restoration backup (palace + KG + config → Cubbit) + baseline snapshot | MEM-OPS-0001 | — |

### P1 — Restore the write path
| # | Task | ID | Depends |
|---|---|---|---|
| 2 | Re-wire `mcp_servers.mempalace` in config.yaml (binary exists, unwired); gateway restart; verify 30+ tools | MEM-FIX-0001 | 1 |
| 3 | Write-path smoke test: add → search → delete test drawer; count returns to 173 | MEM-TEST-0001 | 2 |

### P2 — Restore ingestion
| # | Task | ID | Depends |
|---|---|---|---|
| 4 | Mine 10-week session backlog → agent/conversations (`--mode convos`) | MEM-AUT-0001 | 2 |
| 5 | Scheduled weekly mining cron (deterministic script job, no LLM) | MEM-AUT-0002 | 4 |

### P3 — Restore the semantic layer
| # | Task | ID | Depends |
|---|---|---|---|
| 6 | Rebuild KG with provenance: 19 → 100+ triples, `source_drawer_id` > 50% coverage, idempotent extractor | MEM-FIX-0002 | 4 |
| 7 | Reseed Ladybug projection from ROOT KG (`~/.mempalace/knowledge_graph.sqlite3`, NOT palace/ copy — that has 0 triples) | MEM-FIX-0003 | 6 |
| 8 | Retrieval QA: deterministic speed/accuracy test + 5 live searches + 3 Ladybug subgraph queries | MEM-TEST-0002 | 7 |

### P4 — Restore structure / hygiene
| # | Task | ID | Depends |
|---|---|---|---|
| 9 | Compress agent/conversations (110 raw drawers; additive — originals stay) | MEM-OPS-0002 | 4 |
| 10 | Prune `mempalace_test` residue (2 drawers) + config.json verify | MEM-OPS-0003 | 4 |

### P5 — Governance (enterprise hardening)
| # | Task | ID | Depends |
|---|---|---|---|
| 11 | Memory governance policy document (write path, cadence, authority, retention) | MEM-POL-0001 | 6 |
| 12 | Weekly health-check cron: drawer growth, KG size, projection freshness, server :8888 — silent when healthy, alert on dormancy | MEM-AUT-0003 | 7 |

### P6 — Documentation
| # | Task | ID | Depends |
|---|---|---|---|
| 13 | Patch mempalace skill: MCP drift (both integration paths) + restoration runbook section | MEM-SKL-0001 | 7 |

## 4. Key Technical Facts (verified 2026-08-08)

- **KG source path:** root `~/.mempalace/knowledge_graph.sqlite3` has the real triples; `~/.mempalace/palace/knowledge_graph.sqlite3` has 0 (ChromaDB-era stale copy). Reseed must use the root.
- **MCP binary:** `/Users/warren/Documents/_HQ_AI/hermes_workspace/venv/bin/mempalace-mcp` exists (218 bytes launcher, 21 May) — just not wired in config.
- **Cron turn cap:** Hermes 0.18.2 has no per-job cron turn knob; cron inherits `agent.max_turns` (just lowered 90 → 60, applied 2026-08-08).
- **Compression is additive:** originals remain in `mempalace_drawers`; compressed copies go to `mempalace_compressed` (currently 145 entries).
- **Cubbit backup:** requires `s3={'addressing_style': 'path'}` in boto3 config (virtual addressing fails with SignatureDoesNotMatch). Creds `CUBBIT_DS3_*` in `~/.hermes/.env`.
- **Gateway restart:** use `launchctl kill SIGTERM gui/501/ai.hermes.gateway` + `launchctl bootstrap gui/501 ~/Library/LaunchAgents/ai.hermes.gateway.plist` when restarting from inside the gateway process.
- **Config.json:** already clean (only `palace_path` + `collection_name`; no topic_wings/hall_keywords).

## 5. Definition of Done

Restoration is complete when all of the following hold:

1. **Backup** exists on Cubbit, head_object verified, baseline counts recorded.
2. **MCP** 30+ mempalace tools registered (`hermes mcp test mempalace` clean).
3. **Write path** proven: add → search → delete round-trip, count returns to baseline.
4. **Backlog mined:** Jun–Aug sessions present in `agent/conversations`; search for 'cmux-herdr' / 'ART appeal' returns results.
5. **Weekly mining cron** scheduled and manually triggered once successfully.
6. **KG ≥ 100 triples** with `source_drawer_id` on the majority; extractor idempotent.
7. **Ladybug reseeded:** manifest entity/edge/fact counts > 21/38/19, new projection_id.
8. **Retrieval QA:** accuracy + mean/p95 latency recorded; 5/5 live searches relevant.
9. **Conversations compressed** (additive), stale test drawers removed, count consistent.
10. **Policy document** written and attached; **health cron** live; **skill patched** with both integration paths + runbook.

## 6. Rollback / Compensation

| Step | Compensate with |
|---|---|
| Any mutation before backup | Forbidden — backup is P0 #1, gating everything |
| MCP re-wire breaks gateway | Remove `mcp_servers.mempalace` entry, restart gateway (config-backed: revert is a yaml edit) |
| Mining adds duplicates | Compression is additive; prune offending drawers via ChromaDB delete (MEM-OPS-0003 pattern) |
| KG rebuild produces bad triples | Restore KG from Cubbit backup (pre-restoration tar), re-run extractor after fixing rules |
| Ladybug reseed wrong | `rollback_to: mempalace-ladybug-20260807T235009Z` pointer exists in manifest |

## 7. Kanban Task Map

| Priority | Kanban ID | Task |
|---|---|---|
| 1 | t_5199b7d8 | MEM-OPS-0001: Pre-restoration backup + baseline snapshot |
| 2 | t_7869f70d | MEM-FIX-0001: Re-wire mempalace-mcp MCP server |
| 3 | t_e0d20cba | MEM-TEST-0001: Write-path smoke test |
| 4 | t_e07959b1 | MEM-AUT-0001: Conversation mining pipeline |
| 5 | t_19a08f9e | MEM-AUT-0002: Scheduled weekly mining cron |
| 6 | t_2d76f723 | MEM-FIX-0002: Rebuild KG with provenance |
| 7 | t_5a2585a7 | MEM-FIX-0003: Reseed Ladybug projection |
| 8 | t_17a9c27c | MEM-TEST-0002: Retrieval QA |
| 9 | t_5f8fbd84 | MEM-OPS-0002: Compress agent/conversations |
| 10 | t_b143bf77 | MEM-OPS-0003: Prune stale test drawers |
| 11 | t_1ba1c9cf | MEM-POL-0001: Memory governance policy |
| 12 | t_fdb8c0cc | MEM-AUT-0003: Weekly health-check cron |
| 13 | t_e8cebd15 | MEM-SKL-0001: Patch mempalace skill |
| — | t_bb433c45 | MEM-DOC-0001: This plan (deliverable) |
