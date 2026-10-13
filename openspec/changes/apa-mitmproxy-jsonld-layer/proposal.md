# APA mitmproxy + JSON-LD Layer

## Why this change

The current APA (Agentic Process Automation) stack runs Patchright against Chrome for Testing (CfT) via CDP at Tier 0. This works for DOM interaction but has three gaps:

1. **No network visibility** — Patchright/Playwright `page.on('request')` misses pre-navigation, redirect chains, and auth header flows. We need a MITM proxy to capture full HTTP/S traffic, correlate with CDP actions, and replay with modified headers/cookies.

2. **No semantic extraction** — The state engine returns DOM/AX tree + screenshot. Downstream agents (Hermes, Nerve) must infer meaning from raw HTML. We need JSON-LD microdata extraction so every page state carries machine-readable `schema.org` / custom vocabulary entities.

3. **No purchase-price (PP) analysis pipeline** — Salestrekker deal pages contain property price, loan amount, LVR, fees. Today this is parsed ad-hoc per automation script. A reusable PP analysis module should extract, validate, and enrich these fields from JSON-LD + DOM cross-reference.

## What changes

| Capability | New artifact |
|---|---|
| `mitmproxy` | Dedicated daemon on :8080 (configurable), TLS cert auto-gen, HAR export, request/response correlation with CDP frame IDs |
| `jsonld-extractor` | Runs in browser context (Tier 0 CDP `Page.addScriptToEvaluateOnNewDocument`), emits `JSONLDSnapshot` to Action Journal |
| `pp-analysis` | Pure function: `(jsonld: JSONLDSnapshot, dom: StateSnapshot) → PPAnalysisResult` — validates price/LVR/fees against lender criteria DB |

## Capabilities affected

- `state-engine` — adds mitmproxy client, JSON-LD extractor injection, PP analysis call in Verification Engine
- `salestrekker-automation` — consumes `PPAnalysisResult` for deal validation, auto-populates deal form fields
- `lender-criteria-db` — new capability: lender-specific PP validation rules (LVR caps, postcode restrictions, fee schedules)

## Acceptance criteria

1. `mitmproxy` daemon starts with CfT profile, captures HAR for full deal creation flow, correlates requests with Action Journal `action_id`
2. JSON-LD extractor runs on every page load, finds `Product`, `Offer`, `RealEstateListing` entities, emits to journal
3. PP analysis extracts: `purchasePrice`, `loanAmount`, `deposit`, `lvr`, `stampDuty`, `lmi`, `legalFees`, `totalCosts` — validates against at least 2 lender configs
4. All three components typecheck, unit test, and integrate into existing 4-tier sensory test (Test 4: full deal creation)