#!/usr/bin/env python3
"""
Generate the seed SQL for the alert dictionary (18,436 rows).

D1 statement-size limit (the reason this batches by BYTES, not rows)
-------------------------------------------------------------------
Cloudflare D1 caps a single SQL statement at 100,000 bytes
(https://developers.cloudflare.com/d1/platform/limits/). Local SQLite allows
~1 GB, so a migration can apply cleanly against SQLite and still die in
production with `statement too long: SQLITE_TOOBIG [code: 7500]`.

That happened. The first version of this file batched 500 rows per INSERT,
which produced ~309 KB statements: `verify-schema.sh` was green (32/32) and the
D1 apply failed. Batching by row count was the mistake — alert rows vary in
width by more than 10x because several columns carry long prose. The budget is
now bytes with a hard target well under the cap, plus a generator-side assert
so the failure cannot come back silently.

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

# D1 hard limit is 100,000 bytes per statement. Stay well inside it: the
# statement also has to survive whatever transport adds, and a migration that
# only just fits is a migration that breaks on the next row-width change.
D1_MAX_STATEMENT_BYTES = 100_000
STATEMENT_BUDGET_BYTES = 60_000


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
    ap.add_argument("--budget", type=int, default=STATEMENT_BUDGET_BYTES,
                    help=f"target bytes per INSERT statement "
                         f"(D1 hard cap is {D1_MAX_STATEMENT_BYTES:,})")
    args = ap.parse_args()

    if not args.csv.exists():
        print(f"error: csv not found: {args.csv}", file=sys.stderr)
        return 2
    if args.budget >= D1_MAX_STATEMENT_BYTES:
        print(f"error: --budget must stay under D1's "
              f"{D1_MAX_STATEMENT_BYTES:,}-byte statement cap", file=sys.stderr)
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
        "-- Statements are batched to stay under D1's 100,000-byte per-statement",
        "-- limit. Row-count batching is NOT safe here: alert prose varies in width",
        "-- by more than 10x, so 500 rows can exceed 300 KB. Local SQLite permits",
        "-- ~1 GB per statement, so this file can only be validated against a",
        "-- byte budget, never by 'it applied locally'.",
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
    header_len = len(header) + 1

    # Greedy byte-budget packing: accumulate tuples until adding the next one
    # would push the statement past the budget, then emit.
    batches: list[list[str]] = []
    cur: list[str] = []
    cur_bytes = header_len
    for v in values:
        v_bytes = len(v) + 3          # ",\n" separator plus terminator slack
        if cur and cur_bytes + v_bytes > args.budget:
            batches.append(cur)
            cur, cur_bytes = [], header_len
        cur.append(v)
        cur_bytes += v_bytes
    if cur:
        batches.append(cur)

    biggest = 0
    for chunk in batches:
        body = ",\n".join(chunk) + ";"
        stmt_len = header_len + len(body)
        biggest = max(biggest, stmt_len)
        if stmt_len >= D1_MAX_STATEMENT_BYTES:
            print(f"error: generated a {stmt_len:,}-byte statement, over D1's "
                  f"{D1_MAX_STATEMENT_BYTES:,}-byte cap (lower --budget)",
                  file=sys.stderr)
            return 3
        out.append(header)
        out.append(body)
        out.append("")

    out.append("INSERT OR REPLACE INTO tesla_catalog_load (catalog_name, source_name,")
    out.append("  source_sha256, source_rows, loaded_rows, loaded_at, loader_version) VALUES")
    out.append("  ('alert', 'alert_dictionary.csv', {sha}, {src}, {loaded}, {ts}, {ver});".format(
        sha=sql_str(sha), src=len(rows), loaded=len(values),
        ts=sql_str(os.environ.get("SOURCE_DATE_EPOCH_ISO", "2026-10-02T00:00:00Z")),
        ver=sql_str("build-alerts.py/1.1.0"),
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
    print(f"INSERT stmts     {len(batches)}  (budget {args.budget:,} B)")
    print(f"largest stmt     {biggest:,} B  ({biggest / D1_MAX_STATEMENT_BYTES * 100:.0f}% "
          f"of D1's {D1_MAX_STATEMENT_BYTES:,}-byte cap)")
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
