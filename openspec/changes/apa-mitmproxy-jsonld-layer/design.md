# APA mitmproxy + JSON-LD Layer — Design

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          STATE ENGINE MCP (:9110)                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   │
│  │  State Cache │  │   Resolver   │  │ Action Engine│  │Verification  │   │
│  │  (DOM/AX/SS) │  │  (AX→text→..)│  │  (T0→T4)     │  │   Engine     │   │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘   │
└─────────┼─────────────────┼─────────────────┼─────────────────┼───────────┘
          │                 │                 │                 │
          ▼                 ▼                 ▼                 ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         NEW COMPONENTS (this change)                        │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                     │
│  │  Mitmproxy   │  │  JSON-LD     │  │   PP         │                     │
│  │  Client      │  │  Extractor   │  │   Analysis   │                     │
│  │  (WS + HAR)  │  │  (CDP inject)│  │  (pure fn)   │                     │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘                     │
└─────────┼─────────────────┼─────────────────┼─────────────────────────────┘
          │                 │                 │
          ▼                 ▼                 ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           ACTION JOURNAL (JSON-Lines)                       │
│  {action_id, tier, dom_before, dom_after, har_ref, jsonld_snapshot,       │
│   pp_analysis, verification_result, timestamp}                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Component Details

### 1. Mitmproxy Client (`apps/state-engine/mitmproxy_client.py`)

- **Lifecycle**: Starts mitmproxy daemon via subprocess on configurable port (default 8080). Generates TLS CA cert on first run (`~/.mitmproxy/mitmproxy-ca.pem`), installs into CfT profile via `--ignore-certificate-errors` + CDP `Security.setIgnoreCertificateErrors`.
- **Interface**: Async context manager. `async with MitmproxyClient(port=8080) as mcp:` → `mcp.har` (async iterator of HAR entries), `mcp.correlate(cdp_frame_id)` → matching HAR entries.
- **HAR format**: Standard HAR 1.2 with custom `_cdp_frame_id` field for correlation.
- **Error handling**: Daemon crash → restart once, then surface `FailureEnvelope` with partial HAR.

### 2. JSON-LD Extractor (`apps/state-engine/jsonld_extractor.py`)

- **Injection**: At `StateCache.refresh()` → `page.addScriptToEvaluateOnNewDocument(extractorScript)` via CDP (Tier 0). Script walks `document.querySelectorAll('[itemtype], [property], [typeof]')` + `<script type="application/ld+json">`, builds normalized entity list.
- **Output**: `JSONLDSnapshot { entities: Entity[], extraction_url: string, timestamp: ISO8601 }` where `Entity { @context, @type, @id?, properties: Record<string, any> }`.
- **Schema vocabulary**: Recognizes `schema.org/Product`, `Offer`, `RealEstateListing`, `PostalAddress`, `MonetaryAmount` + custom `salestrekker:Deal`, `salestrekker:SecurityProperty`.

### 3. PP Analysis (`apps/state-engine/pp_analysis.py`)

- **Signature**: `analyze_pp(jsonld: JSONLDSnapshot, dom: StateSnapshot, lender_db: LenderCriteriaDB) → PPAnalysisResult`
- **Extraction priority**: JSON-LD `@type: Offer` → `priceSpecification.price` → DOM fallback (Salestrekker React props via Resolver).
- **Validation rules per lender**:
  - `max_lvr`: reject if `loanAmount / purchasePrice > max_lvr`
  - `postcode_blacklist`: reject if property postcode in list
  - `fee_schedule`: compute expected `stampDuty`, `lmi`, `legalFees`; flag variance > 5%
- **Result**: `PPAnalysisResult { extracted: PPFields, validation: LenderValidation[], warnings: string[], confidence: number }`

## Data Flow

1. `StateEngineMCP.start()` → launches mitmproxy client alongside CDP connection
2. `StateCache.refresh()` → injects JSON-LD extractor script before page load
3. `ActionEngine.execute()` → each action captures `har_ref` from mitmproxy client (by frame ID)
4. `VerificationEngine.verify()` → calls `pp_analysis.analyze_pp(jsonld, dom, lender_db)` for deal pages
5. `ActionJournal.append()` → writes complete record with all three new fields

## File Structure

```
apps/state-engine/
├── mitmproxy_client.py       # NEW — daemon lifecycle, HAR capture, correlation
├── jsonld_extractor.py       # NEW — CDP injection, entity extraction
├── pp_analysis.py            # NEW — pure analysis fn + lender criteria loader
├── lender_criteria/          # NEW — JSON configs per lender
│   ├── common.json
│   ├── cba.json
│   ├── anz.json
│   └── westpac.json
├── state_cache.py            # MODIFIED — inject extractor on refresh
├── action_engine.py          # MODIFIED — capture HAR ref per action
├── verification.py           # MODIFIED — call pp_analysis on deal pages
├── action_journal.py         # MODIFIED — new fields in journal entry
└── main.py                   # MODIFIED — start mitmproxy client
```

## Dependencies

- `mitmproxy>=12.0` — daemon + HAR export
- `jsonld` (or custom walker — stdlib preferred to avoid dep)
- `jsonschema` — validate lender criteria configs
- No new runtime deps for edge-runtime (workers)

## Security

- Mitmproxy CA cert never leaves machine; auto-cleanup on daemon stop
- HAR may contain auth tokens — journal entries are local-only, not sent to external APIs
- Lender criteria configs are read-only JSON, no secrets