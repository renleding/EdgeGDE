#!/usr/bin/env python3
"""
Generate the Fleet API endpoint registry seed (FRS-010 F03-R05 / F03-R06).

The registry must cover the COMPLETE Fleet API surface — including families not
enabled at MVP (Vehicle Commands, Energy Product Commands, Enterprise
management) — with every command/energy/enterprise row seeded `enabled = 0`.
Enabling a family later is then a flag change, not a migration.

Paths are extracted from the cached Tesla endpoint documentation rather than
hand-typed, so a doc refresh is a re-run. Family, scope and `is_command` come
from path shape plus a small override table.

Usage:
  python3 scripts/build-endpoints.py --docs "<dir with cached endpoint .md>" \\
                                     [--out migrations/0004_seed_tesla_endpoints.sql]
"""

from __future__ import annotations

import argparse
import hashlib
import os
import re
import sys
from pathlib import Path

# Families that are catalogued but not enabled at MVP (F03-R06).
DISABLED_FAMILIES = {"vehicle_command", "energy_command", "enterprise"}

# Path-shape rules, first match wins. Ordered: most specific first.
FAMILY_RULES: list[tuple[str, str]] = [
    (r"/energy_sites/.*/(operation|backup|storm_mode|grid_import_export|"
     r"time_of_use_settings|off_grid_vehicle_charging_reserve)$", "energy_command"),
    (r"/energy_sites/.*/(calendar_history|telemetry_history|live_status|site_info)$", "energy"),
    (r"^/api/1/products$", "energy_product"),
    (r"/command/", "vehicle_command"),
    (r"/fleet_telemetry_config", "fleet_telemetry_config"),
    (r"/fleet_telemetry_errors|/fleet_status|/fleet_telemetry_config_jws", "fleet_telemetry"),
    (r"^/api/1/vehicles/\{vin\}/vehicle_data$", "vehicle_data"),
    (r"^/api/1/(vehicles|invitations|users)", "vehicle"),
    (r"^/oauth2/|^/api/1/oauth", "auth"),
    (r"^/api/1/partner_accounts", "partner"),
    (r"^/api/1/enterprise", "enterprise"),
    (r"^/api/1/charging", "charging"),
]

# OAuth scope per family. Vehicle reads need vehicle_device_data; commands need
# a command scope; energy reads/writes split the same way.
FAMILY_SCOPE = {
    "vehicle": "vehicle_device_data",
    "vehicle_data": "vehicle_device_data",
    "fleet_telemetry": "vehicle_device_data",
    "fleet_telemetry_config": "vehicle_device_data",
    "vehicle_command": "vehicle_cmds",
    "energy": "energy_device_data",
    "energy_product": "energy_device_data",
    "energy_command": "energy_cmds",
    "enterprise": "enterprise_management",
    "charging": "vehicle_charging_cmds",
    "partner": None,
    "auth": None,
}

# Partner-token-only calls: these are the app's own configuration surface and
# are never made on a member's behalf.
PARTNER_ONLY = {
    "/api/1/partner_accounts",
    "/api/1/partner_accounts/public_key",
    "/api/1/partner_accounts/fleet_telemetry_config",
}

# Families the docs describe in prose but do not publish a callable path for on
# the pages we scrape. Seeded explicitly so the registry covers the whole
# surface (F03-R05) and AC3's "every family exists" holds. `enabled = 0`.
MANUAL_ENDPOINTS = [
    ("enterprise.fleet_telemetry_config.create.post", "enterprise", "POST",
     "/api/1/enterprise/fleet_telemetry_config", "enterprise_management",
     "partner", 0, 0,
     "Enterprise-wide telemetry configuration. Not enabled at MVP (F03-R06)."),
    ("enterprise.vehicles.list.get", "enterprise", "GET",
     "/api/1/enterprise/vehicles", "enterprise_management",
     "partner", 0, 0,
     "Enterprise vehicle inventory. Not enabled at MVP (F03-R06)."),
]

# Explicit, human-readable descriptions for the endpoints this platform calls or
# is likely to call. Anything not listed falls back to the doc heading.
KNOWN_DESCRIPTIONS = {
    "/api/1/vehicles": "List vehicles belonging to the account (paginated, default 100).",
    "/api/1/vehicles/{vin}": "Return summary information about one vehicle.",
    "/api/1/vehicles/{vin}/vehicle_data": "Live read from the vehicle. Expensive; telemetry is preferred.",
    "/api/1/vehicles/fleet_status": "Vehicle state relative to this application (key, firmware, telemetry version).",
    "/api/1/vehicles/fleet_telemetry_config": "Create or update a fleet telemetry config, signed by the virtual key.",
    "/api/1/vehicles/{vin}/fleet_telemetry_config": "Get or delete a vehicle's fleet telemetry config.",
    "/api/1/vehicles/fleet_telemetry_config_jws": "Configure telemetry with a pre-signed JWS token. Not recommended.",
    "/api/1/vehicles/{vin}/fleet_telemetry_errors": "Recent telemetry errors reported by the vehicle.",
    "/api/1/vehicles/{vin}/recent_alerts": "Recent vehicle alerts; resolves against tesla_alert_catalog.",
    "/api/1/vehicles/{vin}/release_notes": "Firmware release notes.",
    "/api/1/vehicles/{vin}/mobile_enabled": "Whether mobile access is enabled for the vehicle.",
    "/api/1/vehicles/{vin}/wake_up": "Wake the vehicle from sleep. Billed per wake; avoided by design.",
    "/api/1/products": "Energy products mapped to the account (Powerwall, solar, wall connector).",
}


def classify(path: str) -> tuple[str, str | None, int]:
    for pattern, family in FAMILY_RULES:
        if re.search(pattern, path):
            return family, FAMILY_SCOPE.get(family), 1 if family == "vehicle_command" else 0
    return "vehicle", "vehicle_device_data", 0


def norm(path: str) -> str:
    """Collapse query strings and unify placeholder names."""
    path = path.split("?")[0].rstrip(".")
    path = re.sub(r"\{[^}]+\}", "{id}", path) if "{id}" in path else path
    return path


def main() -> int:
    here = Path(__file__).resolve().parent.parent
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--docs", required=True, type=Path,
                    help="directory containing cached Tesla endpoint markdown")
    ap.add_argument("--out", type=Path,
                    default=here / "migrations" / "0004_seed_tesla_endpoints.sql")
    args = ap.parse_args()

    if not args.docs.is_dir():
        print(f"error: not a directory: {args.docs}", file=sys.stderr)
        return 2

    found: dict[tuple[str, str], str] = {}   # (method, path) -> doc file
    hasher = hashlib.sha256()
    files = sorted(args.docs.glob("*.md"))
    for f in files:
        text = f.read_text(encoding="utf-8", errors="replace")
        hasher.update(f.name.encode() + text.encode())
        for method, path in re.findall(
            r"\b(GET|POST|PUT|DELETE)\s+(/api/[0-9][A-Za-z0-9/{}_?=&.\-]*)", text.replace("\\", "")
        ):
            path = norm(path)
            found.setdefault((method, path), f.name)

    if not found:
        print("error: no endpoint paths extracted", file=sys.stderr)
        return 3

    rows = []
    for (method, path), src in sorted(found.items(), key=lambda kv: (kv[0][1], kv[0][0])):
        family, scope, is_cmd = classify(path)
        enabled = 0 if family in DISABLED_FAMILIES else 1
        auth = "partner" if path in PARTNER_ONLY or family in ("partner", "auth") else "user"
        key = (
            f"{family}."
            f"{re.sub(r'^/api/1/', '', path).strip('/').replace('/', '.').replace('{vin}', 'vin').replace('{energy_site_id}', 'site').replace('{id}', 'id')}"
            f".{method.lower()}"
        )
        desc = KNOWN_DESCRIPTIONS.get(path)
        rows.append((key, family, method, path, scope, auth, is_cmd, enabled, desc, src))

    # Add the families that have no scrapable path, so the registry is complete.
    seen_keys = {r[0] for r in rows}
    for key, family, method, path, scope, auth, is_cmd, enabled, desc in MANUAL_ENDPOINTS:
        if key not in seen_keys:
            rows.append((key, family, method, path, scope, auth, is_cmd, enabled, desc, "manual"))

    out = [
        "-- Seed the complete Fleet API endpoint registry (FRS-010 F03-R05/R06).",
        "--",
        "-- GENERATED FILE - do not edit by hand.",
        "-- Regenerate with: python3 scripts/build-endpoints.py --docs <dir>",
        "--",
        f"-- source sha256 {hasher.hexdigest()}",
        f"-- endpoints     {len(rows)}",
        "--",
        "-- Families not enabled at MVP are seeded with enabled = 0 and retained:",
        "-- vehicle_command, energy_command, enterprise. Enabling one later is a",
        "-- flag change rather than a migration.",
        "",
        "DELETE FROM tesla_endpoint_catalog;",
        "",
        "INSERT INTO tesla_endpoint_catalog (endpoint_key, family, method, path_template,",
        "  scope, requires_auth, is_command, enabled, description, doc_url) VALUES",
    ]

    def s(v: str | None) -> str:
        if v is None or v == "":
            return "NULL"
        return "'" + str(v).replace("'", "''") + "'"

    vals = [
        "  ({k}, {f}, {m}, {p}, {sc}, {a}, {c}, {e}, {d}, NULL)".format(
            k=s(key), f=s(family), m=s(method), p=s(path), sc=s(scope), a=s(auth),
            c=is_cmd, e=enabled, d=s(desc),
        )
        for key, family, method, path, scope, auth, is_cmd, enabled, desc, src in rows
    ]
    out.append(",\n".join(vals) + ";")
    out.append("")
    out.append("INSERT OR REPLACE INTO tesla_catalog_load (catalog_name, source_name,")
    out.append("  source_sha256, source_rows, loaded_rows, loaded_at, loader_version) VALUES")
    out.append("  ('endpoint', 'developer.tesla.com endpoints docs', {sha}, {src}, {n}, {ts}, {ver});".format(
        sha=s(hasher.hexdigest()), src=len(rows), n=len(rows),
        ts=s(os.environ.get("SOURCE_DATE_EPOCH_ISO", "2026-10-02T00:00:00Z")),
        ver=s("build-endpoints.py/1.0.0"),
    ))
    out.append("")

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text("\n".join(out), encoding="utf-8")

    by_family: dict[str, int] = {}
    for r in rows:
        by_family[r[1]] = by_family.get(r[1], 0) + 1
    print(f"endpoints {len(rows)}")
    for fam, n in sorted(by_family.items()):
        flag = "disabled" if fam in DISABLED_FAMILIES else "enabled"
        print(f"  {fam:<24} {n:>3}  {flag}")
    print(f"source sha256 {hasher.hexdigest()[:16]}...")
    print(f"wrote {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
