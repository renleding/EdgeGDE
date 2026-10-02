#!/usr/bin/env python3
"""
Build the complete Tesla Fleet Telemetry catalog for the D1 schema.

FRS-010 F03 requires the FULL field universe to be stored up front so that
expanding the collected subset is a config change rather than a schema
migration. F03's original 239-row source was
`fleet_streaming_fields.csv`; the authoritative upstream source is the
`Field` enum in Tesla's own `vehicle_data.proto`, which is larger. This script
merges both so the catalog is complete and every row is traceable to a source.

Sources (both read-only):
  1. apps/EdgeGDE - Document DB/Tesla APP DB/fleet_streaming_fields.csv
     -> Category, Type, Vehicle Data Equivalent, Description (239 rows)
  2. protos/vehicle_data.proto from github.com/teslamotors/fleet-telemetry
     -> authoritative field names, numbers, enum names, and the set of
        value enums (272 Field entries, 42 value enums)

Proto wins on name/number; the CSV supplies the human-facing metadata that the
proto does not carry. Fields present only in the proto are still catalogued so
a later firmware release does not need a migration.

Outputs:
  migrations/0002_seed_tesla_catalog.sql   deterministic INSERTs for both tables
  catalog/tesla_catalog.json               the same data, for review/diffing

Usage:
  python3 scripts/build-catalog.py --proto /path/to/vehicle_data.proto \
                                   --csv  "/path/to/fleet_streaming_fields.csv"
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import sys
from pathlib import Path

# --------------------------------------------------------------------------
# Collection tier
#
# The catalog holds every field; only a subset is collected. Tier records HOW a
# collected field is stored, which is what keeps the fact table narrow:
#   event      - a reading that changes and must be stored per observation
#   on_change  - state that only matters when it flips (stored as a change row)
#   once       - a vehicle attribute constant across a software/hardware
#                version; stored in the snapshot table, not per observation
#   never      - catalogued but not collected
# --------------------------------------------------------------------------
TIER_NEVER = "never"

# Fields whose value is a property of the vehicle build/release, not a reading.
# Storing these per observation would multiply rows for no analytical gain.
ONCE_FIELDS = {
    "CarType", "Trim", "ExteriorColor", "RoofColor", "WheelType",
    "ChargePort", "SunroofInstalled", "RightHandDrive", "EuropeVehicle",
    "Version", "EfficiencyPackage", "OffroadLightbarPresent",
    "SettingDistanceUnit", "SettingTemperatureUnit", "Setting24HourTime",
    "SettingTirePressureUnit", "SettingChargeUnit",
    "VehicleName", "HomelinkDeviceCount", "PairedPhoneKeyAndKeyFobQty",
}

# State/boolean settings: a reading, but only its transitions carry meaning.
ON_CHANGE_FIELDS = {
    "SentryMode", "PinToDriveEnabled", "Locked", "SpeedLimitMode",
    "SpeedLimitWarning", "AutomaticBlindSpotCamera",
    "BlindSpotCollisionWarningChime", "EmergencyLaneDepartureAvoidance",
    "AutomaticEmergencyBrakingOff", "ForwardCollisionWarning",
    "LaneDepartureAvoidance", "CruiseFollowDistance", "ValetModeEnabled",
    "GuestModeEnabled", "GuestModeMobileAccessState", "ServiceMode",
    "RemoteStartEnabled", "RemoteStartActive", "DefrostMode",
    "ClimateKeeperMode", "HvacPower", "HvacAutoMode", "CabinOverheatProtectionMode",
    "WiperHeatEnabled", "RearDefrostEnabled", "SeatVentEnabled",
    "LightsHazardsActive", "LightsTurnSignal", "LightsHighBeams",
    "MediaPlaybackStatus", "MediaPlaybackSource", "PowershareStatus",
    "TonneauPosition", "TonneauTentMode", "CenterDisplay",
    "ChargePortDoorOpen", "ChargePortLatch", "SoftwareUpdateInProgress",
}

# The launch collection set (owner, 2026-10-02): odometer + FSD kilometres are
# the product; the remainder is the safety/settings context that makes the
# mileage interpretable. Everything else stays catalogued and uncollected.
LAUNCH_SET = {
    "MilesSinceReset",
    "SelfDrivingMilesSinceReset",
    "Odometer",
    "CarType",
    "Version",
    "AutomaticBlindSpotCamera",
    "SpeedLimitMode",
    "SpeedLimitWarning",
    "SentryMode",
    "AutomaticEmergencyBrakingOff",
    "BlindSpotCollisionWarningChime",
    "EmergencyLaneDepartureAvoidance",
    "PinToDriveEnabled",
    "EfficiencyPackage",
}

# Collection group per field: the name Tesla's config uses to bundle fields
# that must travel together (`$vehicleInfo`, `$vehicleState`). Grouped fields
# cannot be requested individually, which is a real constraint on narrowing the
# set further.
LAUNCH_GROUPS = {
    "MilesSinceReset": "vehicleState",
    "SelfDrivingMilesSinceReset": "vehicleState",
    "Odometer": "vehicleState",
    "CarType": "$vehicleInfo",
    "Version": "$vehicleInfo",
    "EfficiencyPackage": "$vehicleInfo",
    "SentryMode": "$vehicleState",
    "SpeedLimitMode": "$vehicleState",
    "SpeedLimitWarning": "$vehicleState",
    "PinToDriveEnabled": "$vehicleState",
    "AutomaticBlindSpotCamera": "$vehicleState",
    "BlindSpotCollisionWarningChime": "$vehicleState",
    "EmergencyLaneDepartureAvoidance": "$vehicleState",
    "AutomaticEmergencyBrakingOff": "$vehicleState",
}

# Tesla's `minimum_delta` per field, where the docs state one. Omitted means
# unset (every push is recorded). Odometer defaults to 0.1 and the FSD counters
# require at least 1, per Tesla's fleet-telemetry field documentation.
MIN_DELTA = {
    "MilesSinceReset": 1.0,
    "SelfDrivingMilesSinceReset": 1.0,
    "Odometer": 0.1,
}

# Minimum firmware per proto comment ranges, keyed by first field number.
FIRMWARE_GATES = [
    (107, "2024.26"),
    (179, "2024.38"),
    (180, "2024.44.25"),
    (184, "2024.44.32"),
    (229, "2024.44.32"),
    (239, "2025.2.6"),
    (258, "2025.44.25.5"),
    (260, "2026.32"),
]


def firmware_for(number: int) -> str | None:
    version = None
    for first, ver in FIRMWARE_GATES:
        if number >= first:
            version = ver
    return version


def sql_str(value: str | None) -> str:
    if value is None or value == "":
        return "NULL"
    return "'" + str(value).replace("'", "''") + "'"


def parse_proto(text: str) -> tuple[dict[str, tuple[int, str]], dict[str, list[tuple[str, int]]]]:
    text = text.replace("\\_", "_")
    block = re.search(r"enum Field \{(.*?)\n\}", text, re.S)
    if not block:
        raise SystemExit("could not find `enum Field` in the proto")

    fields: dict[str, tuple[int, str]] = {}
    for line in block.group(1).splitlines():
        m = re.match(r"\s*([A-Za-z_]\w*)\s*=\s*(\d+)\s*;(.*)$", line)
        if m:
            fields[m.group(1)] = (int(m.group(2)), m.group(3).strip())

    enums: dict[str, list[tuple[str, int]]] = {}
    for name, body in re.findall(r"enum (\w+) \{(.*?)\n\}", text, re.S):
        if name == "Field":
            continue
        values = [
            (m.group(1), int(m.group(2)))
            for m in re.finditer(r"^\s*([A-Za-z_]\w*)\s*=\s*(\d+)\s*;", body, re.M)
        ]
        # Keep only real enumerations, not the optional/boolean wrappers.
        if values:
            enums[name] = values
    return fields, enums


def build(proto_path: Path, csv_path: Path) -> dict:
    proto_fields, proto_enums = parse_proto(proto_path.read_text(encoding="utf-8"))
    csv_rows = {
        r["Field"]: r
        for r in csv.DictReader(csv_path.open(encoding="utf-8-sig"))
    }

    # The proto is authoritative for identity; match the CSV case-insensitively
    # so a capitalisation difference does not create a phantom second field.
    csv_by_lower = {k.lower(): v for k, v in csv_rows.items()}

    records = []
    for name, (number, comment) in sorted(proto_fields.items(), key=lambda kv: kv[1][0]):
        csv_row = csv_rows.get(name) or csv_by_lower.get(name.lower()) or {}

        is_deprecated = name.startswith("Deprecated_")
        is_experimental = name.startswith("Experimental_")
        is_semitruck = "Semi-truck only" in comment or name.startswith("Semitruck")

        if name == "Unknown":
            value_type = "unknown"
        elif is_deprecated or is_experimental:
            value_type = "internal"
        else:
            value_type = (csv_row.get("Type") or "").strip() or "unknown"

        if name in LAUNCH_SET:
            collected = 1
            tier = (
                "once" if name in ONCE_FIELDS
                else "on_change" if name in ON_CHANGE_FIELDS
                else "event"
            )
        else:
            collected = 0
            tier = TIER_NEVER

        records.append({
            "field_key": name,
            "field_number": number,
            "category": (csv_row.get("Category") or "").strip() or "Uncategorised",
            "value_type": value_type,
            "vehicle_data_equivalent": (csv_row.get("Vehicle Data Equivalent") or "").strip(),
            "description": (csv_row.get("Description") or "").strip(),
            "proto_enum_name": (csv_row.get("Proto Enum Name") or "").strip(),
            "collection_tier": tier,
            "collected": collected,
            "collection_group": LAUNCH_GROUPS.get(name),
            "min_delta": MIN_DELTA.get(name),
            "sensitivity": (
                "trace" if name == "RouteLine"
                else "location" if value_type == "Location" or name.endswith("Location")
                else "standard"
            ),
            # F03-R11: RouteLine is a movement trace and Tesla does not reliably
            # populate it, so it is marked broken and can never be collected.
            "is_broken": 1 if name == "RouteLine" else 0,
            "min_firmware_version": firmware_for(number),
            "is_deprecated": int(is_deprecated),
            "is_experimental": int(is_experimental),
            "is_semitruck": int(is_semitruck),
            "source": "proto+csv" if csv_row else "proto",
        })

    enum_records = [
        {"enum_name": enum_name, "value_int": value_int, "value_label": label}
        for enum_name, values in sorted(proto_enums.items())
        for label, value_int in sorted(values, key=lambda kv: kv[1])
    ]

    return {
        "fields": records,
        "enums": enum_records,
        "stats": {
            "field_total": len(records),
            "collected": sum(r["collected"] for r in records),
            "csv_rows": len(csv_rows),
            "proto_fields_only": sum(1 for r in records if r["source"] == "proto"),
            "enum_names": len(proto_enums),
            "enum_values": len(enum_records),
            # Provenance for the load record. Deterministic: both source hashes
            # plus the field count, so an unchanged input produces an unchanged
            # value and the loader can be proven idempotent (F03-N03).
            "source_sha256": __import__("hashlib").sha256(
                (
                    proto_path.read_bytes()
                    + csv_path.read_bytes()
                    + str(len(records)).encode()
                )
            ).hexdigest(),
            # Passed in so the output is byte-reproducible when SOURCE_DATE_EPOCH
            # is set, which is what makes a "re-run the loader" diff meaningful.
            "generated_at": __import__("os").environ.get(
                "SOURCE_DATE_EPOCH_ISO", "2026-10-02T00:00:00Z"
            ),
        },
    }


def emit_sql(catalog: dict) -> str:
    out = []
    out.append("-- Seed the complete Tesla Fleet Telemetry catalog.")
    out.append("--")
    out.append("-- GENERATED FILE - do not edit by hand.")
    out.append("-- Regenerate with: python3 scripts/build-catalog.py \\")
    out.append("--                    --proto <vehicle_data.proto> \\")
    out.append('--                    --csv  "<path>/fleet_streaming_fields.csv"')
    out.append("--")
    out.append("-- FRS-010 F03-R07: every field is catalogued so widening the collected")
    out.append("-- subset is a config change, not a schema migration.")
    out.append("--")
    out.append(f"-- field rows    {catalog['stats']['field_total']}")
    out.append(f"-- collected     {catalog['stats']['collected']}")
    out.append(f"-- source sha256 {catalog['stats']['source_sha256']}")
    out.append("--")
    out.append("-- Idempotent: this file deletes and re-inserts the two catalogs, so")
    out.append("-- re-running it produces an identical row set (F03-R08). The load is")
    out.append("-- recorded in tesla_catalog_load for staleness auditing (F03-R09).")
    out.append("")
    out.append("DELETE FROM tesla_field_enum_value;")
    out.append("DELETE FROM tesla_field_enum_def;")
    out.append("DELETE FROM tesla_field_catalog;")
    out.append("")

    out.append("INSERT INTO tesla_field_catalog (")
    out.append("  field_key, field_number, category, value_type, vehicle_data_equivalent,")
    out.append("  description, proto_enum_name, collection_tier, collected, collection_group,")
    out.append("  min_delta, sensitivity, is_broken, min_firmware_version,")
    out.append("  is_deprecated, is_experimental, is_semitruck, source")
    out.append(") VALUES")
    rows = []
    for r in catalog["fields"]:
        rows.append(
            "  ({fk}, {n}, {cat}, {vt}, {vde}, {desc}, {pen}, {tier}, {col}, {grp}, "
            "{md}, {sens}, {brk}, {fw}, {dep}, {exp}, {semi}, {src})".format(
                fk=sql_str(r["field_key"]), n=r["field_number"],
                cat=sql_str(r["category"]), vt=sql_str(r["value_type"]),
                vde=sql_str(r["vehicle_data_equivalent"]),
                desc=sql_str(r["description"]), pen=sql_str(r["proto_enum_name"]),
                tier=sql_str(r["collection_tier"]), col=r["collected"],
                grp=sql_str(r["collection_group"]),
                md="NULL" if r["min_delta"] is None else r["min_delta"],
                sens=sql_str(r["sensitivity"]), brk=r["is_broken"],
                fw=sql_str(r["min_firmware_version"]),
                dep=r["is_deprecated"], exp=r["is_experimental"],
                semi=r["is_semitruck"], src=sql_str(r["source"]),
            )
        )
    out.append(",\n".join(rows) + ";")
    out.append("")

    # Enum definitions, with the value count, so a field's enum can be validated
    # as complete rather than partially loaded.
    if catalog["enums"]:
        by_name: dict[str, int] = {}
        for e in catalog["enums"]:
            by_name[e["enum_name"]] = by_name.get(e["enum_name"], 0) + 1

        out.append("INSERT INTO tesla_field_enum_def (enum_name, description, value_count) VALUES")
        defs = [
            "  ({en}, NULL, {n})".format(en=sql_str(n), n=c)
            for n, c in sorted(by_name.items())
        ]
        out.append(",\n".join(defs) + ";")
        out.append("")

        out.append("INSERT INTO tesla_field_enum_value (enum_name, value_int, value_label) VALUES")
        enums = [
            "  ({en}, {vi}, {vl})".format(
                en=sql_str(e["enum_name"]), vi=e["value_int"], vl=sql_str(e["value_label"])
            )
            for e in catalog["enums"]
        ]
        out.append(",\n".join(enums) + ";")
        out.append("")

    # Record the load so staleness is auditable (F03-R09). OR REPLACE, not a
    # plain INSERT: the key includes loaded_at, which is deterministic when
    # SOURCE_DATE_EPOCH_ISO is pinned, so a re-run must not violate the primary
    # key (F03-R08 "re-running MUST NOT duplicate rows").
    out.append("INSERT OR REPLACE INTO tesla_catalog_load (catalog_name, source_name, source_sha256,")
    out.append("  source_rows, loaded_rows, loaded_at, loader_version) VALUES")
    out.append("  ('field', 'vehicle_data.proto + fleet_streaming_fields.csv',")
    out.append("   {sha}, {src}, {loaded}, {ts}, {ver});".format(
        sha=sql_str(catalog["stats"]["source_sha256"]),
        src=catalog["stats"]["csv_rows"],
        loaded=catalog["stats"]["field_total"],
        ts=sql_str(catalog["stats"]["generated_at"]),
        ver=sql_str("build-catalog.py/1.0.0"),
    ))
    out.append("")
    return "\n".join(out)


def main() -> int:
    here = Path(__file__).resolve().parent.parent
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--proto", required=True, type=Path)
    ap.add_argument("--csv", required=True, type=Path)
    ap.add_argument("--out-sql", type=Path,
                    default=here / "migrations" / "0002_seed_tesla_catalog.sql")
    ap.add_argument("--out-json", type=Path,
                    default=here / "catalog" / "tesla_catalog.json")
    args = ap.parse_args()

    for path, label in ((args.proto, "proto"), (args.csv, "csv")):
        if not path.exists():
            print(f"error: {label} not found: {path}", file=sys.stderr)
            return 2

    catalog = build(args.proto, args.csv)

    args.out_sql.parent.mkdir(parents=True, exist_ok=True)
    args.out_json.parent.mkdir(parents=True, exist_ok=True)
    args.out_sql.write_text(emit_sql(catalog), encoding="utf-8")
    args.out_json.write_text(json.dumps(catalog, indent=1) + "\n", encoding="utf-8")

    s = catalog["stats"]
    print(f"fields          {s['field_total']}")
    print(f"  collected     {s['collected']}")
    print(f"  proto-only    {s['proto_fields_only']}  (absent from the CSV)")
    print(f"  csv rows      {s['csv_rows']}")
    print(f"enum names      {s['enum_names']}")
    print(f"enum values     {s['enum_values']}")
    print(f"source sha256   {s['source_sha256'][:16]}...")
    print()
    print(f"wrote {args.out_sql}")
    print(f"wrote {args.out_json}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
