# MemPalace / Ladybug Memory Governance Policy

Version: 1.0
Date: 2026-08-08
Owner: Hermes (Director)
Board: edgegde-core-dev (MEM-POL-0001)
Policy version tag: `edgegde-memory-policy-v1` (matches Ladybug projection policy_version)

## 1. Authority Model

```
MemPalace drawers   = SOURCE OF TRUTH (write path, semantic memory)
SQLite KG           = deterministic projection of drawer/event facts
Ladybug             = read-only graph projection (cache, never mutated in place)
Hermes memory tools = read-only consumers (mempalace_ladybug_entity/subgraph/manifest)
```

- MemPalace is the **only** writable layer. All memory mutations go through
  `mempalace add_drawer` / `mempalace mine` / the MCP server.
- The KG is a materialized projection — built by deterministic extractors
  (`mempalace-kg-rebuild.py`), never hand-edited except through the extractor.
- Ladybug is rebuilt by `DroidProjectionWorker.build()` from the ROOT KG.
- NO autonomous memory manager (Graphiti, Cognee, LlamaIndex, LangGraph,
  DeepKE, KuzuDB) may mutate MemPalace or the KG. KuzuDB is excluded
  (upstream archived).

## 2. Write Path (approved pipeline)

```text
MemPalace drawer/event (MCP 30-tool server — REQUIRED wiring)
  -> deterministic extractor (no LLM in loop)
  -> Aegis policy gate (predicate whitelist, entity types)
  -> SQLite KG append (INSERT OR REPLACE, idempotent, provenance required)
  -> Ladybug reseed (DroidProjectionWorker from ROOT knowledge_graph.sqlite3)
  -> audited MCP read contract (mempalace_ladybug_* tools)
```

**Hard requirements:**
- `mcp_servers.mempalace` MUST be present in `~/.hermes/config.yaml`
  (30 tools). Its absence is an alert condition (see SLOs).
- Every KG triple MUST carry `source_drawer_id` (provenance).
- Extractors MUST be idempotent (deterministic IDs, INSERT OR REPLACE).
- Predicates MUST be in the Aegis `allowed_predicates` whitelist.

## 3. Service Level Objectives (SLOs)

| Metric | SLO | Alert when |
|---|---|---|
| Drawer growth | ≥ 1 new drawer/week from mining cron | 0 new in 14 days |
| Drawer freshness | `MAX(embeddings.created_at)` within 7 days | > 7 days old |
| KG size | ≥ 100 triples | < 50 triples |
| KG freshness | `MAX(extracted_at)` within 30 days | > 30 days |
| KG provenance | ≥ 50% triples with `source_drawer_id` | < 50% |
| Ladybug reseed age | ≤ 24 h since last projection | > 24 h |
| MCP wiring | `mcp_servers.mempalace` present | entry missing |
| Vector index | sqlite count == hnsw count (repair-status) | divergence > 0 |
| Server | `:8888` HTTP 200 | non-200 |
| Manifest growth | entity/edge/fact counts non-decreasing vs prior | regression |

## 4. Cadence (scheduled jobs)

| Job | Schedule | Responsibility |
|---|---|---|
| `mempalace-weekly-mine` (3babe78f3f58) | Mondays 06:00, no_agent | Mine last-7d sessions → agent/conversations |
| `mempalace-health` (MEM-AUT-0003) | Daily 06:30, no_agent | Check all SLOs above; silent when green, Telegram alert on breach |
| KG rebuild | On demand / after mining | `mempalace-kg-rebuild.py` (idempotent) |
| Ladybug reseed | After each KG rebuild | `/tmp/reseed-ladybug.py` pattern → `~/.hermes/mempalace-ladybug-projection` |

## 5. Compression & Retention

- `agent/conversations` > 50 drawers → run `mempalace compress --wing agent`.
- Compression is **additive**: originals stay in `mempalace_drawers`,
  compressed copies land in `mempalace_compressed`.
- Pre-mutation backup to Cubbit DS3 (path addressing style required) before
  any restructure/repair/migration.

## 6. Verification (Definition of Healthy)

```bash
mempalace status                                   # drawer count by wing/room
mempalace repair-status                            # vector index divergence == 0
sqlite3 ~/.mempalace/knowledge_graph.sqlite3 "SELECT COUNT(*) FROM triples;"
sqlite3 ~/.mempalace/knowledge_graph.sqlite3 "SELECT COUNT(*) FROM triples WHERE source_drawer_id != '';"
grep -n mempalace ~/.hermes/config.yaml            # mcp_servers entry present
curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8888/mempalace_visualization.html  # 200
cat ~/.hermes/mempalace-ladybug-projection/active.json  # fresh projection_id
```

## 7. Incident Response (dormancy detection)

1. Health cron (MEM-AUT-0003) alerts on any SLO breach.
2. Hermes runs the health-review reference checks (`mempalace` skill
   `references/health-review.md`) — freshness timeline, KG staleness, MCP
   wiring, server, cron feeds.
3. Follow the restoration runbook (skill MEM-SKL-0001, plan v2): backup →
   re-wire → smoke test → mine → KG rebuild → reseed → QA.
4. Record RCA; update this policy if the failure mode is new.

## 8. Related Documents

- Restoration plan v2: `docs/restoration-mempalace-ladybug-plan-v2.md`
- RCA: `docs/restoration-mempalace-ladybug-rca.md`
- MemPalace skill: `~/.hermes/skills/autonomous-ai-agents/mempalace/`
- Health-review reference: `references/health-review.md`
- Governed projection reference: `references/governed-memory-projection.md`
