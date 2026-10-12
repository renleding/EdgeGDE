# FRS-011: APA MITM Proxy + JSON-LD + PP Analysis Layer

**Version:** v1.0
**Status:** Implemented
**Date:** 2026-10-11
**Change:** `openspec/changes/apa-mitmproxy-jsonld-layer/`

## Overview

Extends the State Engine (FRS-007) with three capabilities:

1. **mitmproxy daemon** — HTTP/S traffic capture with CDP frame correlation
2. **JSON-LD extractor** — semantic entity extraction via CDP injection
3. **PP analysis** — purchase price validation against lender criteria

## Capabilities

### APA-M: MITM Proxy Daemon

| ID | Requirement |
|----|-------------|
| M01 | mitmproxy daemon starts/stops with CDP connection |
| M02 | CA cert auto-generated at `~/.mitmproxy/mitmproxy-ca.pem` |
| M03 | HAR entries carry `_cdp_frame_id` for correlation |
| M04 | Daemon restarts once on crash, then surfaces FailureEnvelope |

**MCP tool:** `mcp_har(frame_id, summary_only)` — query captured HAR

### APA-J: JSON-LD Extraction

| ID | Requirement |
|----|-------------|
| J01 | Extraction script injected via `Page.addScriptToEvaluateOnNewDocument` |
| J02 | Extracts `application/ld+json`, microdata, RDFa entities |
| J03 | Normalizes to `JSONLDSnapshot` with URL and timestamp |
| J04 | Recognizes `schema.org` + `salestrekker:` vocabulary |

**MCP tool:** `mcp_pp_analysis(lender_id, lenders_json)` — PP analysis with JSON-LD

### APA-P: PP Analysis

| ID | Requirement |
|----|-------------|
| P01 | Extracts 8 PP fields from JSON-LD with DOM fallback |
| P02 | Loads lender criteria from `lender_criteria/*.json` |
| P03 | Validates LVR against `max_lvr` |
| P04 | Validates postcode against `postcode_blacklist` |
| P05 | Validates fees against `fee_schedule` (5% tolerance) |
| P06 | Produces confidence score `[0.0, 1.0]` |
| P07 | Analysis is deterministic (pure function) |

**MCP tool:** `mcp_pp_analysis(lender_id, lenders_json)` — single/multi-lender

## File Structure

```
apps/state-engine/
├── mitmproxy_client.py       # APA-M: daemon lifecycle, HAR capture
├── jsonld_extractor.py       # APA-J: CDP injection, entity extraction
├── pp_analysis.py            # APA-P: pure analysis function
├── lender_criteria/          # APA-P: per-lender JSON configs
│   ├── common.json
│   ├── cba.json
│   ├── anz.json
│   └── westpac.json
├── main.py                   # MCP tools: mcp_har, mcp_pp_analysis
├── action_engine.py          # har_ref enrichment
└── tests/
    ├── test_mitmproxy_client.py   # 11 tests
    ├── test_jsonld_extractor.py   # 9 tests
    └── test_pp_analysis.py        # 21 tests
```

## Dependencies

- `mitmproxy>=12.0` — HTTP/S proxy daemon (optional, degrades gracefully)
- `pyotp` — TOTP for login (existing)
- No new runtime deps for edge-runtime (workers)

## Security

- Mitmproxy CA cert never leaves machine
- HAR may contain auth tokens — journal entries are local-only
- Lender criteria configs are read-only JSON, no secrets
- `Security.setIgnoreCertificateErrors` scoped to CfT profile only

## Verification

- 41 unit tests pass (`pytest tests/test_*.py`)
- `openspec validate apa-mitmproxy-jsonld-layer` — PASS
- Edge-runtime typecheck — PASS (1358 tests)
- All TS workspaces typecheck — PASS

## Integration

- `mcp_interact(cdp_frame_id=...)` — correlates action to HAR entries
- `mcp_har(frame_id=...)` — queries HAR by CDP frame ID
- `mcp_pp_analysis(lender_id=...)` — single lender analysis
- `mcp_pp_analysis(lenders_json='["cba","anz"]')` — multi-lender

## Known Limitations

- mitmproxy daemon is optional — system degrades gracefully if not running
- JSON-LD extraction depends on page providing structured data
- DOM fallback uses regex patterns — may miss non-standard formats
- PP analysis is deterministic but depends on input data quality