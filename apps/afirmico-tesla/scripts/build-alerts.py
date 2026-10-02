#!/usr/bin/env python3
"""
Generate the seed SQL for the alert dictionary (18,436 rows).

Why this is marked LARGE_ASSET
------------------------------
The generated file is ~8 MB. Committing it directly would bloat every clone and
every CI checkout for data that is fully reproducible from a source file we
already hold plus a documented command. FRS-010 F03-N01/N02 require the catalog
to be complete and its completeness provable, not that the bytes sit in git.

So: regenerate on demand, and record the source checksum in `tesla_catalog_load`
so a running database can always prove which source it was loaded from.

Keying (FRS-010 F03-R04a)
-------------------------
The primary key is the composite (signal_name, models). 853 signal names carry
up to three model-specific variants whose message text genuinely differs;
keying on signal_name alone would silently drop 857 rows of safety content.

Usage:
  python3 scripts/build-alerts.py --csv "<path>/alert_dictionary.csv" \\
                                  [--out migrations/0003_seed_tesla_alerts.sql]
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import os
import sys
from pathlib import Path

BATCH = 500


def sql_str(value: str | None) -> str:
    if value is None or value == "":
        return "NULL"
    return "'" + str(value).replace("'", "''") + "'"


def main() -> int:
    here = Path(__file__).resolve().parent.parent
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--csv", required=True, type=Path)
    ap.add_argument("--out", type=Path,
                    default=here / "migrations" / "0003_seed_tesla_alerts.sql")
    args = ap.parse_args()

    if not args.csv.exists():
        print(f"error: csv not found: {args.csv}", file=sys.stderr)
        return 2

    raw = args.csv.read_bytes()
    sha = hashlib.sha256(raw).hexdigest()

    rows = list(csv.DictReader(raw.decode("utf-8-sig").splitlines()))
    cols = ("signal_name", "models", "condition", "clear_condition", "description",
            "potential_impact", "customer_message_1", "customer_message_2", "audiences")

    seen: set[tuple[str, str]] = set()
    out = [
        "-- Seed the Tesla alert dictionary.",
        "--",
        "-- GENERATED FILE - do not edit by hand.",
        "-- Regenerate with: python3 scripts/build-alerts.py \\",
        '--                    --csv "<path>/alert_dictionary.csv"',
        "--",
        f"-- source sha256 {sha}",
        f"-- source rows   {len(rows)}",
        "--",
        "-- Keyed on the composite (signal_name, models), never signal_name alone:",
        "-- 853 signal names carry up to three model-specific variants whose text",
        "-- genuinely differs (FRS-010 F03-R04a).",
        "--",
        "-- Idempotent: DELETE + INSERT, so a re-run yields an identical row set.",
        "",
        "DELETE FROM tesla_alert_catalog;",
        "",
    ]

    values: list[str] = []
    dupes = 0
    for i, r in enumerate(rows, start=2):  # row 1 is the header
        signal = (r.get("SignalName") or "").strip()
        models = (r.get("Models") or "").strip()
        if not signal:
            continue
        key = (signal, models)
        if key in seen:
            dupes += 1
            continue
        seen.add(key)
        values.append(
            "  ({sig}, {mod}, {cond}, {clr}, {desc}, {imp}, {m1}, {m2}, {aud}, {row})".format(
                sig=sql_str(signal), mod=sql_str(models),
                cond=sql_str(r.get("Condition")), clr=sql_str(r.get("ClearCondition")),
                desc=sql_str(r.get("Description")), imp=sql_str(r.get("PotentialImpact")),
                m1=sql_str(r.get("CustomerFacingMessage1")),
                m2=sql_str(r.get("CustomerFacingMessage2")),
                aud=sql_str(r.get("Audiences")), row=i,
            )
        )

    header = ("INSERT OR IGNORE INTO tesla_alert_catalog ("
              + ", ".join(cols) + ", source_row) VALUES")
    for start in range(0, len(values), BATCH):
        chunk = values[start:start + BATCH]
        out.append(header)
        out.append(",\n".join(chunk) + ";")
        out.append("")

    out.append("INSERT OR REPLACE INTO tesla_catalog_load (catalog_name, source_name,")
    out.append("  source_sha256, source_rows, loaded_rows, loaded_at, loader_version) VALUES")
    out.append("  ('alert', 'alert_dictionary.csv', {sha}, {src}, {loaded}, {ts}, {ver});".format(
        sha=sql_str(sha), src=len(rows), loaded=len(values),
        ts=sql_str(os.environ.get("SOURCE_DATE_EPOCH_ISO", "2026-10-02T00:00:00Z")),
        ver=sql_str("build-alerts.py/1.0.0"),
    ))
    out.append("")

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text("\n".join(out), encoding="utf-8")

    distinct = len({k[0] for k in seen})
    print(f"source rows      {len(rows)}")
    print(f"loaded rows      {len(values)}")
    print(f"distinct signals {distinct}")
    print(f"skipped dupes    {dupes}")
    print(f"source sha256    {sha[:16]}...")
    print(f"size             {args.out.stat().st_size / 1024 / 1024:.1f} MB")
    print(f"wrote {args.out}")

    # F03-N02 / AC2 / AC7: 18,436 rows and 17,579 distinct signal names.
    if len(values) != 18436:
        print(f"WARNING: expected 18436 rows, wrote {len(values)}", file=sys.stderr)
    if distinct != 17579:
        print(f"WARNING: expected 17579 distinct signals, found {distinct}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
