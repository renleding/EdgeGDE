# FRS-015: Multi-Channel Design Intent — Many Front-Ends, One Certified Engine

**Status**: PROPOSED
**Version**: 1.0.1
**Author**: Hermes (Director)
**Date**: 2026-10-30
**Related**: FRS-010, IDD-010, IDD-017, SDD-010, SDD-014, FRS-011
**Companion docs**: IDD-017 (interface contracts), SDD-014 (system design)

> Document numbering note: FRS-013 is reserved-but-absent and FRS-014 already exists; IDD-015/016 and SDD-013 are allocated to unrelated afirmico work. The canonical key for this capability is the slug `multi-channel-design-intent`, not the number.

---

## 1. Objective

Formalise the consequence of ADR-2026-10-30: once Grasshopper is **only** a Design Studio that publishes a Design Intent Package, it stops being privileged. Any number of authoring front-ends can feed the same certified geometry engine, provided they emit the same package.

| Front-end | Channel ID | Audience |
|-----------|-----------|----------|
| Grasshopper Design Studio | `gh-design-studio` | Designer, R&D, power user |
| Internal web configurator | `web-internal` | Sales, engineers, operations, interns |
| Customer product configurator | `web-customer` | End customer |
| (future) tablet, portal, sales app | `*` | any |

All channels produce the **same** Design Intent Package schema, and therefore the **same** certified geometry for the same parameter values.

---

## 2. Architectural Decision Record

### ADR-2026-10-30-c: Design Intent Channel Abstraction

**Context**: The two-layer architecture separated Design Intent from Certified Geometry. Design Intent is now a portable artifact — a JSON package — rather than a live GH canvas. Nothing in the certified engine depends on *where* the package was authored.

**Decision**:
1. A **Design Intent Channel** is any front-end that can emit a schema-valid Design Intent Package.
2. Channels differ only in *which subset* of the certified parameters they expose and in the UI affordances they provide.
3. No channel may introduce a parameter that the certified engine does not consume.
4. The certified engine is channel-agnostic and gains no knowledge of channels.

**Consequences**:
- One geometry implementation to certify and maintain, forever
- Channel permissioning is a configuration concern, not an engineering one
- Determinism must hold *across* channels: identical values must yield an identical fingerprint and byte-identical certified geometry regardless of authoring tool
- Chromatic/finish attributes that do not affect geometry must be handled outside the package (see §5)

---

## 2.1 Resolver Placement (Ratified 2026-10-30)

The resolver — the component that turns channel vocabulary into certified parameters — sits **before** the package boundary.

```
Order Intent (human)  →  Resolver  →  Design Intent Package (13 certified keys)  →  Engine
```

The alternative (resolver *after* the package) was evaluated and rejected: the package would no longer be compilable without historical resolver logic. If a mapping later changed, replaying an archived package would silently yield different certified geometry — the same stored file, a different physical part.

| ID | Requirement |
|----|-------------|
| FRS-015-23 | The Design Intent Package MUST be self-sufficient: given only the package and the engine version, certified geometry MUST be regenerable without any manifest, resolver definition, or historical business rule |
| FRS-015-24 | The Order Intent — the human-readable request (`mount_type`, `size`, `colour`) — MUST be persisted as an immutable record alongside the package, and MUST NOT be required for regeneration |
| FRS-015-25 | A resolver mapping change MUST NOT alter any already-published package, its `certified_fp`, or the geometry regenerated from it |
| FRS-015-26 | The certified engine MUST NOT accept human-vocabulary keys (`mount_type`, `size`, `finish`, `colour`) under any circumstances |

Reproducibility is the decisive property, not convenience. A customer's order must regenerate identically years later, so provenance is stored *beside* the contract, never inside it.

---

## 3. Non-Goals (Explicitly Settled — Do Not Reopen)

| Non-goal | Status |
|----------|--------|
| Adding parameters to the certified generator | Forbidden |
| Revisiting Union All | Closed — architectural legacy |
| Revisiting GH ↔ Python geometric equivalence | Settled — NOT EQUIVALENT, Python authoritative |
| Moving geometry generation into a web front-end | Forbidden — front-ends author intent only |
| Making Grasshopper the required master UI | Rejected — channels are peers |

A web channel is an **additional** authoring surface. It never becomes a second geometry engine.

---

## 4. Channel Tiers

### 4.1 Tier Definitions

| Tier | Channel | Exposed parameters | Typical latency budget |
|------|---------|--------------------|------------------------|
| **Tier A — Designer** | `gh-design-studio` | 12 certified + 6 studio (non-certified) | preview < 5 s, certified < 90 s |
| **Tier B — Internal** | `web-internal` | approved subset of the 12 certified (e.g. 5) | preview 0.5–2 s, certified 10–90 s |
| **Tier C — Customer** | `web-customer` | minimal subset (e.g. 3) | preview 0.5–2 s, certified on demand |

Tiers B and C expose **fewer** parameters, with ranges **narrowed** to a safe commercial envelope — never widened beyond the certified range.

### 4.2 Functional Requirements

| ID | Requirement |
|----|-------------|
| FRS-015-01 | Every channel MUST emit a Design Intent Package that validates against the same schema used by the certified engine |
| FRS-015-02 | A channel MUST expose only a **subset** of the 12 certified parameters; it MUST NOT introduce geometry parameters |
| FRS-015-03 | Parameter ranges exposed by a channel MUST be equal to or narrower than the certified range; widening is forbidden |
| FRS-015-04 | Parameters not exposed by a channel MUST be filled from a declared, versioned channel default set, not from an implicit value |
| FRS-015-05 | Every channel MUST declare a `channel_id` and a `manifest_version` in its requests and audit records |
| FRS-015-06 | `channel_id` MUST NOT be written into the Design Intent Package; the package key set stays exactly `product` + the 12 certified keys |
| FRS-015-07 | The certified engine MUST behave identically regardless of originating channel, and MUST NOT read channel metadata |
| FRS-015-08 | Identical parameter values authored through different channels MUST produce an identical `certified_fp` and byte-identical certified geometry |
| FRS-015-27 | A channel MAY expose a **preset** control (e.g. `Small` / `Medium` / `Large`) that resolves to several certified parameters at once; presets MUST be declared in the manifest, MUST resolve deterministically, and MUST NOT be treated as a new geometry parameter *(added v1.0.1)* |

Presets are the primary mechanism for making a customer channel genuinely simple: instead of exposing five dimensional sliders, expose three named sizes that resolve to a consistent set of values. The engine still receives twelve numeric parameters.

---

## 5. Attributes That Are Not Geometry

Customer-facing channels tempt features that are not geometric parameters: colour, finish, mount style, packaging, branding.

| Attribute class | Example | Handling |
|-----------------|---------|----------|
| Geometric (certified) | height, diameter, twist, cell size | Design Intent Package |
| Geometric (mapped) | "mount type" that selects a bore/collar combination | Channel resolves it into certified parameter values *before* publishing |
| Non-geometric | colour, finish, packaging, engraving | Order/finish manifest — **never** in the Design Intent Package |

| ID | Requirement |
|----|-------------|
| FRS-015-09 | Non-geometric attributes MUST be captured in a separate finish/order manifest, never merged into the Design Intent Package |
| FRS-015-10 | Any channel attribute described as "mapped" MUST resolve deterministically into certified parameter values before publish, and the resolution MUST be recorded in the audit record |
| FRS-015-11 | The UI MUST NOT imply that a non-geometric attribute changes certified geometry |

Rationale: a configurator that shows "Colour" beside "Height" implies both shape the part. One does; one is applied later. Conflating them breaks both the schema guarantee and the customer's mental model.

---

## 6. Two Modes, One Pipeline

Every channel offers the same two modes, mirroring the Design Studio.

| Mode | Purpose | Resolution | Latency | Certified |
|------|---------|-----------|---------|-----------|
| **Preview** | Interactive feedback while manipulating controls | designer-friendly (e.g. 38³) | 0.5–2 s (web), < 5 s (GH) | No |
| **Publish / Generate Production Model** | Authoritative geometry | production (e.g. 0.30 mm) | 10–90 s | Yes |

| ID | Requirement |
|----|-------------|
| FRS-015-12 | Preview output MUST be visibly and explicitly marked non-certified |
| FRS-015-13 | Preview MUST NOT write or overwrite the Design Intent Package |
| FRS-015-14 | Only an explicit publish action may produce the authoritative package and certified geometry |
| FRS-015-15 | Preview and certified geometry for the same values MUST be visually consistent in form (same features, same proportions), differing only in resolution |

FRS-015-15 is the acceptance test that catches a channel whose preview is faked or driven by a different model than the one that manufactures the part.

---

## 7. Channel Capability Manifest

Each channel is defined by a manifest, versioned independently of the engine.

| Field | Meaning |
|-------|---------|
| `channel_id` | stable identifier, e.g. `web-customer` |
| `manifest_version` | semver of this exposure definition |
| `tier` | `A` / `B` / `C` |
| `exposed` | parameter names with display label, unit, and narrowed range |
| `defaults` | values applied to non-exposed certified parameters |
| `mapped_attributes` | channel controls that resolve into certified parameters |
| `non_geometric` | attributes routed to the finish manifest |
| `preview_preset` | grid/resolution used for interactive preview |

| ID | Requirement |
|----|-------------|
| FRS-015-16 | A channel MUST be fully described by a manifest; behaviour MUST NOT depend on hard-coded UI logic |
| FRS-015-17 | Defaults MUST be explicit in the manifest and MUST be within certified ranges |
| FRS-015-18 | Manifest changes MUST NOT require a certified-engine change or re-certification |

---

## 8. Governance

| ID | Requirement |
|----|-------------|
| FRS-015-19 | Adding a channel MUST NOT require changes to `packages/generator-certified/` |
| FRS-015-20 | Every publish MUST record `channel_id`, `manifest_version`, resolved parameters, and timestamp in the audit trail |
| FRS-015-21 | A channel that cannot produce a schema-valid package MUST fail closed and MUST NOT emit a partial package |
| FRS-015-22 | Customer-facing channels MUST NOT expose studio parameters (§4.1.1 of FRS-010), which carry no certified meaning |

---

## 9. Acceptance Criteria

| ID | Criterion |
|----|-----------|
| AC-01 | Same 12 values via GH and via `web-customer` produce identical `certified_fp` |
| AC-02 | Same 12 values produce byte-identical certified geometry across channels |
| AC-03 | A channel cannot emit a parameter outside the certified 12 |
| AC-04 | A channel cannot emit a range wider than the certified range |
| AC-05 | Non-exposed parameters resolve from declared manifest defaults |
| AC-06 | Design Intent Package key set is exactly 13 keys for every channel |
| AC-07 | Preview is labelled non-certified and never overwrites the package |
| AC-08 | Customer channel rejects studio parameters |
| AC-09 | Audit record captures channel, manifest version, and resolved parameters |
| AC-10 | Adding a new channel requires zero changes under `packages/generator-certified/` |
| AC-11 | Given only a stored package and the engine version — with manifests and resolver deleted — certified geometry regenerates byte-identically |
| AC-12 | Deleting or changing a resolver mapping leaves existing packages, their `certified_fp`, and their regenerated geometry unchanged |
| AC-13 | A preset control resolves to the same certified values every time, and the resolved set appears in the audit record |
| AC-14 | The engine rejects a package containing `mount_type`, `size`, `finish`, or `colour` |

---

## 10. Non-Functional

| Requirement | Target |
|-------------|--------|
| Web preview latency | 0.5–2 s |
| GH preview latency | < 5 s |
| Certified generation | 10–90 s depending on resolution |
| Channel onboarding | manifest + UI only; no engine change |
| Determinism | identical values → identical geometry, across channels |
| Audit completeness | 100 % of publishes recorded with channel provenance |

---

## 11. Migration / Phasing

| Phase | Scope | Status |
|-------|-------|--------|
| 1 | Grasshopper Design Studio as `gh-design-studio` (Tier A) | In progress (Milestone A) |
| 2 | `web-internal` Tier B configurator over the same package schema | Not started |
| 3 | `web-customer` Tier C with live preview and order handoff | Not started |
| 4 | Additional channels (tablet, sales portal) via manifest only | Not started |

Phase 1 must be proven first: one channel, one package, one engine, end to end.

---

## 12. References

- FRS-010: Parametric Lattice Lamp — two-layer architecture, Product DNA, Current Design panel
- IDD-010 / SDD-010: lamp interfaces and design
- IDD-017: multi-channel interface contracts
- SDD-014: multi-channel system design
- FRS-011: agentic Grasshopper automation
- `packages/generator-certified/task034_engine.py` — the single certified engine

---

## 13. Changelog

| Version | Date | Change |
|---------|------|--------|
| 1.0.0 | 2026-10-30 | Initial multi-channel requirements |
| 1.0.1 | 2026-10-30 | Ratifies resolver-before-package (§2.1); adds package self-sufficiency, Order Intent persistence, engine rejection of human vocabulary (FRS-015-23…26); adds presets (FRS-015-27); adds AC-11…AC-14 |

---

**End of FRS-015 v1.0.1**
