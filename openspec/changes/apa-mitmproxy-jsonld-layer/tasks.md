# Tasks — APA mitmproxy + JSON-LD Layer

## Phase 1: mitmproxy client (est. 2-3h)

- [ ] `mitmproxy_client.py` — daemon lifecycle (start/stop/restart), TLS CA cert setup
- [ ] `mitmproxy_client.py` — HAR capture: async iterator over HAR entries, custom `_cdp_frame_id` field
- [ ] `mitmproxy_client.py` — correlation: `correlate(cdp_frame_id)` → matching HAR entries
- [ ] Unit tests: daemon start/stop, HAR parsing, correlation logic
- [ ] Integration: `main.py` starts mitmproxy client alongside CDP connection

## Phase 2: JSON-LD extractor (est. 2h)

- [ ] `jsonld_extractor.py` — CDP `Page.addScriptToEvaluateOnNewDocument` injection script
- [ ] `jsonld_extractor.py` — extraction script walks `itemtype`/`property`/`typeof` + `<script type="application/ld+json">`
- [ ] `jsonld_extractor.py` — normalize entities to `JSONLDSnapshot` format
- [ ] Unit tests: extraction on sample HTML (schema.org + Salestrekker)
- [ ] Integration: `state_cache.py` injects extractor on refresh

## Phase 3: PP analysis (est. 3-4h)

- [ ] `pp_analysis.py` — extraction: JSON-LD `Offer.priceSpecification.price` → DOM fallback
- [ ] `pp_analysis.py` — lender criteria loader (`lender_criteria/*.json`)
- [ ] `pp_analysis.py` — validation: `max_lvr`, `postcode_blacklist`, `fee_schedule` (variance >5% flag)
- [ ] `pp_analysis.py` — confidence scoring (JSON-LD source > DOM fallback)
- [ ] Unit tests: full PP analysis on sample snapshots
- [ ] Integration: `verification.py` calls `analyze_pp` on deal pages

## Phase 4: Journal + end-to-end (est. 1-2h)

- [ ] `action_journal.py` — new fields: `har_ref`, `jsonld_snapshot`, `pp_analysis`
- [ ] `action_engine.py` — capture HAR ref per action
- [ ] End-to-end: Test 4 (full deal creation) with all three components
- [ ] `openspec validate apa-mitmproxy-jsonld-layer` passes

## Phase 5: Documentation

- [ ] Update `docs/FRS-007` — new capabilities
- [ ] Update `docs/IDD-005` — State Engine interface additions
- [ ] Update `automation-skills/state-engine-mcp-automation/SKILL.md`

## Definition of Done

- [ ] All unit tests pass
- [ ] Test 4 full deal creation with mitmproxy + JSON-LD + PP analysis
- [ ] `openspec validate apa-mitmproxy-jsonld-layer` passes
- [ ] No new `any` types in state-engine
- [ ] Action Journal entries contain `har_ref`, `jsonld_snapshot`, `pp_analysis` fields