# SDD-014: Multi-Channel Design Intent — System Design

**Status**: PROPOSED
**Version**: 1.0.1
**Author**: Hermes (Director)
**Date**: 2026-10-30
**Related**: FRS-015, IDD-017, SDD-010, IDD-010
**Canonical slug**: `multi-channel-design-intent`

---

## 1. Design Intent

One certified geometry engine, many authoring surfaces. A channel is a **thin adapter** that turns human intent into a validated Design Intent Package. It owns no geometry logic.

```
        Designer                 Internal user              Customer
            │                         │                        │
            ▼                         ▼                        ▼
  Grasshopper Design Studio    Web configurator          Product configurator
     (gh-design-studio)          (web-internal)            (web-customer)
            │                         │                        │
            └─────────────┬───────────┴────────────────────────┘
                          ▼
              Channel Adapter  (manifest load → validate → resolve)
                          │
                          ▼
              Design Intent Package  (13 keys, channel-free)
                          │
                          ▼
        ┌─────────────────┴──────────────────┐
        │                                    │
   Preview Service                    Publish Service
   (38³, cached, fast)          (0.30 mm, queued, certified)
        │                                    │
        ▼                                    ▼
   GLB / viewport                     Certified 3DM / STL
                                             │
                                             ▼
                                      Manufacturing
```

The single most important structural property: **everything below the dashed line is identical for every channel**. Channels cannot reach past the adapter.

---

## 2. Component Responsibilities

| Component | Owns | Must not own |
|-----------|------|--------------|
| **Channel front-end** | UI, control affordances, client-side validation | Geometry, defaults logic, package assembly |
| **Channel Adapter** | Manifest loading, request validation, defaults + mapping resolution, package assembly, audit emission | Geometry, certification |
| **Order Intent Store** | Write-once persistence of the human-readable request plus resolver and manifest versions | Any input to geometry generation |
| **Preview Service** | Low-resolution generation, caching, viewport payloads | Certification, package writes |
| **Publish Service** | Job queue, certified generation, artifact storage, certification report | Channel-specific behaviour |
| **Certified Geometry Engine** | `task034_engine.py` — the only geometry implementation | Any knowledge of channels |
| **Finish Service** | Non-geometric attributes bound to `certified_fp` | Geometry parameters |

The adapter is deliberately the *only* channel-aware component. It is generic: it is driven entirely by the manifest, so onboarding a channel is data, not code.

---

## 3. Data Flows

### 3.1 Preview (interactive)

```
control change
  → debounce 250 ms
  → adapter: resolve parameters (defaults → exposed → mapped)
  → preview cache key = sha256(resolved 12 values, grid)
  → HIT  → return cached GLB (~50 ms)
  → MISS → enqueue preview job → return job id → poll/stream
  → response { certified: false, geometry_ref, elapsed_ms }
```

Design notes:

- **Cache key is the resolved parameter set, not the request.** Two customers converging on the same lamp share one render. This is what makes 0.5–2 s achievable at all — without it, every slider drag is a fresh voxel job.
- **Preview never writes the package.** Preview and publish share a resolver, not a writer.
- **Debounce is mandatory**, not cosmetic. A drag producing 60 requests/second against a voxel pipeline will saturate the queue and starve publish jobs.

### 3.2 Publish (authoritative)

```
explicit publish action
  → adapter: resolve + validate → assemble 13-key package
  → schema check (exactly 13 keys, all in range)  [fail closed]
  → enqueue publish job (request_id, channel_id, package)
  → engine: generate certified geometry (10–90 s)
  → validation: topology + volume vs reference
  → artifacts: certified 3DM, STL, package, certification report
  → audit record emitted (append-only)
  → response with artifact refs
```

Publish is **asynchronous**. A request that returns before generation completes would either lie about certification or hold an HTTP connection for 90 s. Neither is acceptable, so publish returns a job handle and the client polls or subscribes.

### 3.3 Finish/order path

```
publish completes → certified_fp known
  → finish manifest { certified_fp, colour, notes }
  → order system
```

Colour never enters the geometry path. Binding finish to `certified_fp` guarantees a customer cannot order a finish against a geometry that was never certified.

### 3.4 Reproducibility path (the five-year test)

The binding requirement is that a stored package regenerates identically after the surrounding machinery is gone.

```
stored package + engine version
  → engine (no resolver, no manifest, no channel)
  → identical mesh
  → identical certified_fp
  → identical certification result
```

This is possible only because the resolver runs on the **near** side of the package boundary. Three artifacts are kept, with strictly different roles:

| Artifact | Role | Needed for regeneration |
|----------|------|-------------------------|
| Order Intent record | provenance: what the customer asked for | No |
| Design Intent Package | contract: what is manufactured | **Yes** — sufficient on its own |
| Manifest / resolver definitions | operational config, versioned | No |

The publish path therefore writes the Order Intent record **and** the package, and the Order Intent record carries `resolver_version` and `manifest_version`. Those versions are recorded for explainability only — they are never consulted when regenerating, which is what makes deleting an old resolver harmless.

Implementation rule: the publish service must never re-resolve a package. It receives a compiled package and generates from it. Any service that re-derives parameters from human vocabulary is a second resolver, and two resolvers eventually disagree.

---

## 4. Two-Speed Strategy

| Concern | Preview | Certified |
|---------|---------|-----------|
| Grid / voxel | 38³ | 0.30 mm production |
| Typical latency | 0.5–2 s (cache hit ~50 ms) | 10–90 s |
| Transport | synchronous or short-poll | queue + poll/stream |
| Caching | content-addressed by resolved params | content-addressed by package + engine version |
| Concurrency | worker pool, small jobs | separate queue, long jobs |
| Failure impact | degrade to last preview | hard fail with engine report |

**Separate queues are required.** A shared queue lets a burst of customer slider drags delay a production job behind thousands of previews — the failure mode that erodes trust in the certified path precisely when it matters.

---

## 5. Preview/Certified Consistency

FRS-015-15 requires preview to be the *same model* at lower resolution, not a separate approximation.

Implementation constraint: both services call the **same generator** with different `voxel_mm`/grid parameters. Any temptation to build a fast mesh approximation for preview is rejected — it would double the geometry implementations the project spent TASK-043 consolidating down to one.

Divergence in form between preview and certified output is a defect, not a tuning issue.

---

## 6. Channel Registry and Manifests

```
channels/
  gh-design-studio.json     tier A
  web-internal.json         tier B
  web-customer.json         tier C
```

- Loaded and validated at adapter startup; invalid manifest prevents the channel from starting (IDD-017 R-01…R-06).
- `manifest_version` is returned in every audit record, so any historical publish can be explained by the exact exposure rules in force at that time.
- Manifest changes need no engine change and no re-certification (FRS-015-18).

**Defaults are a certification concern, not a UI convenience.** A Tier C customer never sets `sheet_mm`; the manifest default decides it. If a default drifts, certified parts change silently. Therefore defaults are versioned, reviewed, and frozen alongside the certified parameter set.

---

## 7. Access and Tenancy

| Tier | Auth | Exposure | Notes |
|------|------|----------|-------|
| A | local/trusted operator | full 12 + 6 studio | GH desktop |
| B | internal SSO | approved subset | no studio params |
| C | public session | minimal subset | rate-limited, preview-quota |

| Rule | Detail |
|------|--------|
| R-01 | Tier is a property of the manifest and MUST be enforced server-side |
| R-02 | Client-side hiding of parameters is not access control |
| R-03 | Tier C publish MUST be rate-limited and quota-bounded to protect the certified queue |

---

## 8. Failure Modes

| Failure | Detection | Behaviour |
|---------|-----------|-----------|
| Manifest invalid at startup | validation | channel refuses to start; other channels unaffected |
| Request outside exposed set | adapter | reject `PARAM_NOT_EXPOSED` |
| Resolved set incomplete | adapter | reject `DEFAULTS_INCOMPLETE` |
| Preview queue saturated | depth metric | serve cache only; return `preview_degraded` |
| Preview job timeout | job timer | serve last good preview for that session, marked stale |
| Engine validation fails | validation report | publish fails; report surfaced verbatim, no fallback geometry |
| Artifact write fails | storage ack | publish fails; audit records the failure |
| Audit emission fails | write ack | publish fails — no uncertified-but-unaudited outcome |

The last row is deliberate: an unaudited publish is worse than a failed publish, because it breaks traceability from a physical part back to its intent.

---

## 9. Performance Model

| Quantity | Value | Basis |
|----------|-------|-------|
| Preview cache hit | ~50 ms | artifact reuse |
| Preview cold | 0.5–2 s | 38³ grid |
| Certified generation | 10–90 s | resolution dependent |
| Reference volume | 1,420,789 mm³ ±2 % | TASK-037 baseline |
| Concurrent previews | pool-bounded | prevents CPU starvation |
| Publish concurrency | small fixed number | memory-bound (reference mesh ~2.1 GB at 0.30 mm) |

The 2.1 GB reference-mesh footprint is the binding constraint on publish concurrency. This is an existing known cost from TASK-044, not introduced by multi-channel work.

---

## 10. Risks

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Preview diverges from certified model | Customer sees a lamp that cannot be manufactured | Single generator, different resolution only; form-consistency check |
| Defaults drift silently | Certified parts change with no parameter edit | Defaults versioned with manifest; reviewed against certified set |
| Colour/finish mistaken for geometry | Customer believes colour affects shape | Separate manifest; UI states finish does not alter certified geometry |
| Shared queue starves publish | Certification delayed under load | Separate queues (§4) |
| Channel proliferates parameters | Certified schema pressure | Manifest subset rule (FRS-015-02); no-widening rule |
| Second geometry implementation appears | Repeats TASK-043 failure | Explicit prohibition; review gate on `packages/generator-certified/` |
| Customer channel abused for free rendering | Cost and DoS | Rate limits, quotas, cache sharing |
| A second resolver appears inside the publish service | Two resolvers drift; archived packages stop matching new orders | Publish service accepts compiled packages only (§3.4) |
| Package stops being self-sufficient | Historic orders cannot be regenerated | AC-11 test: delete manifests + resolver, regenerate from package alone |
| Human vocabulary leaks into the engine | Engine gains product knowledge; re-certification required | FRS-015-26; engine rejects unknown keys rather than ignoring them |

---

## 11. Phasing

| Phase | Deliverable | Dependency |
|-------|-------------|-----------|
| 1 | `gh-design-studio` publishes valid package end to end | Milestone A |
| 2 | Channel Adapter + manifest loader, validated offline against GH output | Phase 1 |
| 3 | `web-internal` Tier B with preview cache | Phase 2 |
| 4 | `web-customer` Tier C with finish manifest and order handoff | Phase 3 |
| 5 | Additional channels by manifest only | Phase 4 |

Phase 2's acceptance test is the strongest single check available: take a package authored in Grasshopper, replay it through the adapter as a synthetic Tier C request, and require identical `certified_fp`. That proves channel independence **before** any web UI exists.

---

## 12. Open Questions

1. Where does the Publish Service run — local workstation (pc2), or a server with the voxel pipeline? The 2.1 GB footprint makes this a hosting decision, not a code one.
2. Does the preview service share the certified engine's worker process, or run isolated for blast-radius reasons?
3. Is STEP output in scope for customer tiers, or 3DM/STL only?
4. Retention policy for preview artifacts and audits.

None of these block Phase 1.

---

## 13. Changelog

| Version | Date | Change |
|---------|------|--------|
| 1.0.0 | 2026-10-30 | Initial multi-channel system design |
| 1.0.1 | 2026-10-30 | Adds Order Intent Store; adds §3.4 reproducibility path (five-year test); adds second-resolver, self-sufficiency and vocabulary-leak risks |

---

**End of SDD-014 v1.0.1**
