# IDD-017: Multi-Channel Design Intent — Interface Contracts

**Status**: PROPOSED
**Version**: 1.0.2
**Author**: Hermes (Director)
**Date**: 2026-10-30
**Related**: FRS-015, SDD-014, IDD-010, FRS-010
**Canonical slug**: `multi-channel-design-intent`

---

## 1. Purpose

Defines the contracts that let multiple authoring front-ends feed one certified geometry engine:

| Interface | Direction |
|-----------|-----------|
| I-01 Channel → Package builder | publish request |
| I-02 Channel manifest → validator | capability definition |
| I-03 Package → Certified Geometry Engine | unchanged from IDD-010 |
| I-04 Channel → Finish/order manifest | non-geometric attributes |
| I-05 Publish → Audit record | provenance |

The Design Intent Package itself is **unchanged**. Its schema remains exactly `product` + the 10 certified keys (IDD-010 §3.5 / §4.2). Channel identity lives in the envelope and audit trail, never in the package.

---

## 2. Channel Manifest Schema

```json
{
  "schema_version": "1.0",
  "channel_id": "web-customer",
  "manifest_version": "1.0.0",
  "tier": "C",
  "product": "LatticeLamp",
  "exposed": [
    {"param": "height",    "label": "Height",     "unit": "mm", "min": 200, "max": 400, "step": 5,  "default": 300},
    {"param": "diameter",  "label": "Diameter",   "unit": "mm", "min": 120, "max": 180, "step": 5,  "default": 150},
    {"param": "twist_deg", "label": "Twist",      "unit": "°",  "min": 0,   "max": 90,  "step": 5,  "default": 45}
  ],
  "defaults": {
    "wall_mm": 1.6,
    "gyroid_cell": 8.0,
    "sheet_mm": 1.2,
    "band_mm": 25.0,
    "bore_mm": 40.0,
    "dome_mm": 1.6,
    "voxel_mm": 0.30
  },
  "mapped_attributes": [
    {"control": "mount_type", "label": "Mount",
     "options": {"pendant": {"bore_mm": 40.0},
                 "floor":   {"bore_mm": 50.0}}}
  ],
  "non_geometric": [
    {"attr": "colour", "label": "Colour", "options": ["ivory", "charcoal", "sand"]}
  ],
  "preview_preset": {"grid": "38x38x38", "target_ms": 2000}
}
```

### Validation rules

| Rule | Detail |
|------|--------|
| R-01 | `exposed[].param` MUST be one of the 10 certified keys |
| R-02 | `min`/`max` MUST be within the certified range for that parameter |
| R-03 | `defaults` MUST cover exactly the certified keys **not** in `exposed` or resolvable via `mapped_attributes` |
| R-04 | `defaults` values MUST be within certified ranges |
| R-05 | `tier` `B`/`C` MUST NOT reference studio parameters |
| R-06 | `non_geometric[].attr` MUST NOT collide with a certified key |

A manifest failing any rule is rejected at load; the channel does not start.

---

## 3. Publish Request Envelope

Channels send a request, not a package. The package is assembled server-side after validation and mapping.

```json
{
  "channel_id": "web-customer",
  "manifest_version": "1.0.0",
  "mode": "publish",
  "parameters": {"height": 320, "diameter": 150, "twist_deg": 60},
  "mapped": {"mount_type": "floor"},
  "non_geometric": {"colour": "charcoal"},
  "request_id": "uuid4"
}
```

| Field | Required | Notes |
|-------|----------|-------|
| `channel_id` | yes | must match a loaded manifest |
| `manifest_version` | yes | mismatch with loaded manifest is an error |
| `mode` | yes | `preview` or `publish` |
| `parameters` | yes | only keys declared in `exposed` |
| `mapped` | conditional | required if manifest declares `mapped_attributes` |
| `non_geometric` | conditional | routed to the finish manifest only |
| `request_id` | yes | correlation and idempotency |

### Resolution order (deterministic)

1. Take `defaults` for all certified keys
2. Overlay `exposed` values from `parameters`
3. Overlay values produced by resolving `mapped`
4. Validate the result: all 12 keys present, each within certified range
5. Emit the package

Any failure at step 4 is a hard rejection. No partial packages.

---

## 4. Assembled Design Intent Package (unchanged schema)

```json
{
  "product": "LatticeLamp",
  "height": 320,
  "diameter": 150,
  "twist_deg": 60,
  "wall_mm": 1.6,
  "gyroid_cell": 8.0,
  "sheet_mm": 1.2,
  "band_mm": 25.0,
  "bore_mm": 50.0,
  "dome_mm": 1.6,
  "voxel_mm": 0.30
}
```

Exactly 11 keys — verified schema-equal to `BASE` in `task034_engine.py`. No `channel_id`, no `colour`, no `mount_type`. `mount_type: floor` has already become `bore_mm: 50.0`.

**Correction (v1.0.2)**: earlier revisions of this document specified 13 keys. Four keys it named — `bore_diameter`, `collar_height`, `dome_height`, `top_closure_ratio` — do not exist in the engine. The real keys are `bore_mm` (default 40.0) and `dome_mm` (default 1.6, a shell *thickness*). Mount mapping therefore resolves to `bore_mm` alone, since the engine has no collar parameter.

---

## 4.1 Order Intent Record (persisted beside the package)

The human-readable request is stored as an immutable record **alongside** the package, never inside it. It answers "what did the customer ask for?"; the package answers "what is manufactured?".

```json
{
  "schema_version": "1.0",
  "order_intent_id": "uuid4",
  "channel_id": "web-customer",
  "manifest_version": "1.0.0",
  "resolver_version": "1.0.0",
  "intent": {"mount_type": "pendant", "size": "medium", "colour": "charcoal"},
  "resolved_package_path": "orders/uuid4/lattice_lamp_params.json",
  "certified_fp": "sha256:...",
  "created_at": "2026-10-30T14:02:11+11:00",
  "immutable": true
}
```

| Rule | Detail |
|------|--------|
| R-16 | The Order Intent record MUST be written before the publish response returns |
| R-17 | It MUST reference `resolved_package_path` and `certified_fp`, binding intent to an exact certified artifact |
| R-18 | It MUST record `resolver_version` and `manifest_version`, so a historical decision is explainable even if those definitions are later deleted |
| R-19 | Records are append-only; superseding an intent creates a new record, it does not mutate the old one |
| R-20 | The Order Intent MUST NOT be needed to regenerate geometry — it is provenance, not input (FRS-015-24) |

R-18 is what makes deletion safe. The resolver and manifest may disappear; the record still states which version converted `medium` into `height 280 / diameter 140`, and that conversion is already frozen in the package.

### Presets (multi-key resolution)

A preset resolves one human choice into several certified parameters:

```json
{"control": "size", "label": "Size",
 "options": {
   "small":  {"height": 220.0, "diameter": 120.0},
   "medium": {"height": 280.0, "diameter": 140.0},
   "large":  {"height": 375.0, "diameter": 150.0}
 }}
```

| Rule | Detail |
|------|--------|
| R-21 | A preset MUST declare every key it sets; unset certified keys fall back to manifest `defaults` |
| R-22 | Preset values MUST be within certified ranges |
| R-23 | A preset MUST resolve identically on every call for the same option (FRS-015-27, AC-13) |
| R-24 | The resolved key/value set MUST appear in `mapped_resolutions` in the audit record |

---

## 5. Finish / Order Manifest (non-geometric)

```json
{
  "schema_version": "1.0",
  "product": "LatticeLamp",
  "channel_id": "web-customer",
  "request_id": "uuid4",
  "certified_fp": "sha256:...",
  "attributes": {"colour": "charcoal"},
  "notes": "engraving text if any"
}
```

| Rule | Detail |
|------|--------|
| R-07 | The finish manifest MUST reference `certified_fp` so a finish is always bound to a specific certified geometry |
| R-08 | The finish manifest MUST NOT contain any of the 10 certified keys |
| R-09 | Changes to finish attributes MUST NOT alter `certified_fp` |

---

## 6. Preview Response

```json
{
  "status": "ok",
  "mode": "preview",
  "certified": false,
  "grid": "38x38x38",
  "elapsed_ms": 1420,
  "geometry_ref": "preview/web-customer/uuid4.glb",
  "resolved_parameters": { "...": "10 keys, for display only" }
}
```

| Rule | Detail |
|------|--------|
| R-10 | `certified` MUST be `false` for every preview response |
| R-11 | Preview MUST NOT write to the Design Intent Package path |
| R-12 | `resolved_parameters` is informational; it is not a package and MUST NOT be consumed as one |

---

## 7. Audit Record

```json
{
  "schema_version": "1.0",
  "request_id": "uuid4",
  "channel_id": "web-customer",
  "manifest_version": "1.0.0",
  "tier": "C",
  "mode": "publish",
  "resolved_parameters": { "...": "10 keys" },
  "mapped_resolutions": {"mount_type": {"bore_mm": 50.0}},
  "certified_fp": "sha256:...",
  "package_path": "C:/temp/lattice_lamp_params.json",
  "timestamp": "2026-10-30T14:02:11+11:00",
  "outcome": "published"
}
```

| Rule | Detail |
|------|--------|
| R-13 | Every publish MUST emit an audit record before the response returns |
| R-14 | `mapped_resolutions` MUST record how each mapped attribute became certified values |
| R-15 | Audit records are append-only |

---

## 8. Error Contracts

| Code | Cause | Behaviour |
|------|-------|-----------|
| `MANIFEST_INVALID` | manifest fails R-01…R-06 | channel refuses to start |
| `MANIFEST_VERSION_MISMATCH` | request version ≠ loaded version | reject, no fallback |
| `PARAM_NOT_EXPOSED` | request contains a key not in `exposed` | reject |
| `PARAM_OUT_OF_RANGE` | value outside channel or certified range | reject, name the parameter and both bounds |
| `MAPPED_ATTR_UNRESOLVED` | mapped control missing or unknown option | reject |
| `DEFAULTS_INCOMPLETE` | resolvable certified keys ≠ 12 | reject |
| `PACKAGE_INVALID` | assembled package fails schema | reject, emit nothing |
| `CERTIFIED_FAILED` | engine validation failed (topology/volume) | surface engine report verbatim |

All rejections fail closed. No partial package, no silent default substitution beyond what the manifest declares.

---

## 9. Invariants to Test

| Invariant | Test |
|-----------|------|
| Channel independence | same 12 values via `gh-design-studio` and `web-customer` → identical `certified_fp` |
| Determinism | same 12 values via either channel → byte-identical certified geometry |
| Schema purity | package from every channel has exactly 11 keys |
| No widening | manifest with `max` above certified max is rejected |
| No studio leakage | Tier B/C manifest referencing a studio param is rejected |
| Finish isolation | changing `colour` leaves `certified_fp` unchanged |
| Mapping transparency | `mapped_resolutions` present for every resolved mapped attribute |
| Package self-sufficiency | delete every manifest and resolver definition, regenerate from the stored package alone → identical geometry and `certified_fp` |
| Mapping change isolation | alter a preset mapping, replay a stored package → geometry unchanged |
| Preset determinism | the same preset option resolves to an identical value set on repeated calls |
| Vocabulary rejection | engine handed `mount_type` / `size` / `finish` / `colour` → rejected, not ignored |

---

## 10. Changelog

| Version | Date | Change |
|---------|------|--------|
| 1.0.0 | 2026-10-30 | Initial multi-channel contracts |
| 1.0.2 | 2026-10-30 | Corrects the package to 11 keys / 10 certified parameters against the real engine `BASE`; replaces `bore_diameter`+`collar_height` mount mapping with `bore_mm` |
| 1.0.1 | 2026-10-30 | Adds Order Intent record (R-16…R-20) and presets (R-21…R-24); adds self-sufficiency, mapping-isolation, preset-determinism and vocabulary-rejection invariants |

---

**End of IDD-017 v1.0.2**
