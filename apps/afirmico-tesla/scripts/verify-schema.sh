#!/usr/bin/env bash
# Verify the Tesla schema against FRS-010's own acceptance criteria.
#
# Runs the migrations into a throwaway SQLite database and asserts the counts and
# behaviours the FRS specifies, then re-runs the seed files to prove idempotency
# (F03 AC4). Exit code is the number of failed assertions, so CI can gate on it.
#
# Usage: scripts/verify-schema.sh [--keep]
set -uo pipefail

cd "$(dirname "$0")/.."
DB="$(mktemp -t tesla-schema-XXXXXX).db"
KEEP=0
[[ "${1:-}" == "--keep" ]] && KEEP=1

pass=0
fail=0
check() { # check <label> <actual> <expected>
  if [[ "$2" == "$3" ]]; then
    printf '  ok    %-46s %s\n' "$1" "$2"
    pass=$((pass + 1))
  else
    printf '  FAIL  %-46s got %s want %s\n' "$1" "$2" "$3"
    fail=$((fail + 1))
  fi
}

q() { sqlite3 -noheader "$DB" "$1" 2>/dev/null | tr -d '[:space:]'; }

echo "Tesla schema verification (FRS-010)"
echo

# --- D1 platform limits (checked BEFORE applying) ---------------------------
# Local SQLite allows ~1 GB per statement; D1 caps a statement at 100,000 bytes.
# A migration can therefore apply cleanly here and die in production with
# `statement too long: SQLITE_TOOBIG [code: 7500]` — which is exactly what
# happened on 2026-10-02. This check is the gate that was missing, and it runs
# first so the failure is reported as a limit violation, not a mysterious
# downstream error.
echo "D1 platform limits"
D1_MAX_STATEMENT=100000
for f in migrations/*.sql; do
  name=$(basename "$f")
  maxb=$(awk 'BEGIN{RS=";\n"; m=0} {if (length($0)+1>m) m=length($0)+1} END{print m}' "$f")
  nstmt=$(awk 'BEGIN{RS=";\n"; c=0} /[^[:space:]]/ {c++} END{print c}' "$f")
  if [[ "$maxb" -gt "$D1_MAX_STATEMENT" ]]; then
    printf '  FAIL  %-34s %4s stmts  max %8s B exceeds %s\n' "$name" "$nstmt" "$maxb" "$D1_MAX_STATEMENT"
    fail=$((fail + 1))
  else
    printf '  ok    %-34s %4s stmts  max %8s B (%s%% of cap)\n' \
      "$name" "$nstmt" "$maxb" "$((maxb * 100 / D1_MAX_STATEMENT))"
    pass=$((pass + 1))
  fi
done
echo

# --- apply -----------------------------------------------------------------
if ! sqlite3 "$DB" <<'SQL' >/dev/null 2>&1
PRAGMA foreign_keys=ON;
.read migrations/0001_create_tesla_schema.sql
.read migrations/0002_seed_tesla_catalog.sql
.read migrations/0003_seed_tesla_alerts.sql
.read migrations/0004_seed_tesla_endpoints.sql
SQL
then
  echo "  FATAL: migrations failed to apply"
  sqlite3 "$DB" <<'SQL' 2>&1 | head -5
PRAGMA foreign_keys=ON;
.read migrations/0001_create_tesla_schema.sql
SQL
  exit 99
fi

echo "Structure"
check "tables created"            "$(q "SELECT count(*) FROM sqlite_master WHERE type='table'")" 28
check "triggers created"          "$(q "SELECT count(*) FROM sqlite_master WHERE type='trigger'")" 4
check "foreign keys declared"     "$(q "SELECT count(*) FROM pragma_foreign_key_list('tesla_telemetry_fact')")" 3

echo
echo "F03 acceptance criteria"
check "AC1 field catalog = 272"   "$(q "SELECT count(*) FROM tesla_field_catalog")" 272
check "AC2 alert catalog = 18436" "$(q "SELECT count(*) FROM tesla_alert_catalog")" 18436
check "AC7 distinct signals 17579" "$(q "SELECT count(DISTINCT signal_name) FROM tesla_alert_catalog")" 17579
check "AC7 model variants = 853"  "$(q "SELECT count(*) FROM (SELECT signal_name FROM tesla_alert_catalog GROUP BY signal_name HAVING count(*)>1)")" 853
check "AC3 disabled families"     "$(q "SELECT group_concat(DISTINCT family) FROM tesla_endpoint_catalog WHERE enabled=0 ORDER BY family")" "energy_command,enterprise,vehicle_command"

echo
echo "Collected subset"
check "collected fields"          "$(q "SELECT count(*) FROM tesla_field_catalog WHERE collected=1")" 14
check "event tier"                "$(q "SELECT count(*) FROM tesla_field_catalog WHERE collection_tier='event'")" 3
check "on_change tier"            "$(q "SELECT count(*) FROM tesla_field_catalog WHERE collection_tier='on_change'")" 8
check "once tier"                 "$(q "SELECT count(*) FROM tesla_field_catalog WHERE collection_tier='once'")" 3
check "FSD field collected"       "$(q "SELECT collected FROM tesla_field_catalog WHERE field_key='SelfDrivingMilesSinceReset'")" 1
check "Odometer collected"        "$(q "SELECT collected FROM tesla_field_catalog WHERE field_key='Odometer'")" 1
check "FSD min_delta = 1"         "$(q "SELECT min_delta FROM tesla_field_catalog WHERE field_key='SelfDrivingMilesSinceReset'")" 1.0
check "RouteLine marked broken"   "$(q "SELECT is_broken FROM tesla_field_catalog WHERE field_key='RouteLine'")" 1
check "broken field not collected" "$(q "SELECT collected FROM tesla_field_catalog WHERE field_key='RouteLine'")" 0
check "location fields classified" "$(q "SELECT count(*) FROM tesla_field_catalog WHERE sensitivity IN ('location','trace')")" 4

echo
echo "Endpoint registry"
check "endpoints"                 "$(q "SELECT count(*) FROM tesla_endpoint_catalog")" 107
check "enabled families"          "$(q "SELECT count(DISTINCT family) FROM tesla_endpoint_catalog WHERE enabled=1")" 6
check "vehicle_command disabled"  "$(q "SELECT count(*) FROM tesla_endpoint_catalog WHERE family='vehicle_command' AND enabled=0")" 72

echo
echo "Catalog load ledger (F03-R09)"
check "load records"              "$(q "SELECT count(*) FROM tesla_catalog_load")" 3
check "every load has a sha256"   "$(q "SELECT count(*) FROM tesla_catalog_load WHERE length(source_sha256)=64")" 3

echo
echo "Guards (F03 AC5, F04 integrity)"
setup_ok=$(sqlite3 "$DB" <<'SQL' 2>&1
PRAGMA foreign_keys=ON;
INSERT INTO tesla_vehicle (vin, member_id, first_seen_at) VALUES ('TESTVIN', NULL, 'x');
SQL
)
uncollected=$(sqlite3 "$DB" "INSERT INTO tesla_telemetry_fact (fact_id,vin,field_key,observed_at,received_at,value_int,value_kind,collection_tier) VALUES ('T1','TESTVIN','Soc','t','t',50,'int','event');" 2>&1)
check "uncollected field rejected" "$([[ "$uncollected" == *"not marked collected"* ]] && echo yes || echo no)" yes

collected=$(sqlite3 "$DB" "INSERT INTO tesla_telemetry_fact (fact_id,vin,field_key,observed_at,received_at,value_real,value_kind,collection_tier) VALUES ('T2','TESTVIN','Odometer','t','t',1234.5,'real','event');" 2>&1)
check "collected field accepted"  "$([[ -z "$collected" ]] && echo yes || echo no)" yes

twovals=$(sqlite3 "$DB" "INSERT INTO tesla_telemetry_fact (fact_id,vin,field_key,observed_at,received_at,value_real,value_int,value_kind,collection_tier) VALUES ('T3','TESTVIN','Odometer','t3','t3',1.0,2,'real','event');" 2>&1)
check "two value columns rejected" "$([[ "$twovals" == *"CHECK constraint"* ]] && echo yes || echo no)" yes

invalid=$(sqlite3 "$DB" "INSERT INTO tesla_telemetry_fact (fact_id,vin,field_key,observed_at,received_at,value_kind,collection_tier) VALUES ('T4','TESTVIN','Odometer','t4','t4','invalid','event');" 2>&1)
check "invalid datum accepted"    "$([[ -z "$invalid" ]] && echo yes || echo no)" yes

wringsent=$(sqlite3 "$DB" "INSERT INTO tesla_vehicle_snapshot (vin,field_key,value_text,observed_at) VALUES ('TESTVIN','Odometer','x','t');" 2>&1)
check "event field rejected in snapshot" "$([[ "$wringsent" == *"once-only"* ]] && echo yes || echo no)" yes

ok1=$(sqlite3 "$DB" "INSERT INTO tesla_vehicle_snapshot (vin,field_key,value_text,observed_at) VALUES ('TESTVIN','CarType','Model Y','t');" 2>&1)
ok2=$(sqlite3 "$DB" "INSERT INTO tesla_vehicle_snapshot (vin,field_key,value_text,observed_at) VALUES ('TESTVIN','Version','2025.44.25.5','t');" 2>&1)
ok3=$(sqlite3 "$DB" "INSERT INTO tesla_vehicle_snapshot (vin,field_key,value_text,observed_at) VALUES ('TESTVIN','EfficiencyPackage','P1','t');" 2>&1)
check "all 3 once-only fields accepted" "$([[ -z "$ok1$ok2$ok3" ]] && echo yes || echo no)" yes

echo
echo "Idempotency (F03 AC4 / N03)"
before=$(q "SELECT (SELECT count(*) FROM tesla_field_catalog)||'/'||(SELECT count(*) FROM tesla_alert_catalog)||'/'||(SELECT count(*) FROM tesla_endpoint_catalog)||'/'||(SELECT count(*) FROM tesla_field_enum_value)")
if ! sqlite3 "$DB" <<'SQL' >/dev/null 2>&1
.read migrations/0002_seed_tesla_catalog.sql
.read migrations/0003_seed_tesla_alerts.sql
.read migrations/0004_seed_tesla_endpoints.sql
SQL
then
  echo "  FAIL  re-running the seed files errored"
  fail=$((fail + 1))
fi
after=$(q "SELECT (SELECT count(*) FROM tesla_field_catalog)||'/'||(SELECT count(*) FROM tesla_alert_catalog)||'/'||(SELECT count(*) FROM tesla_endpoint_catalog)||'/'||(SELECT count(*) FROM tesla_field_enum_value)")
check "re-run yields identical counts" "$after" "$before"
check "no duplicate load records" "$(q "SELECT count(*) FROM tesla_catalog_load")" 3

echo
echo "Reconciliation example (F05)"
sqlite3 "$DB" "INSERT INTO tesla_telemetry_fact (fact_id,vin,field_key,observed_at,received_at,value_real,value_kind,collection_tier) VALUES ('R1','TESTVIN','MilesSinceReset','2026-10-01T00:00:00Z','t',1000.0,'real','event'), ('R2','TESTVIN','SelfDrivingMilesSinceReset','2026-10-01T00:00:00Z','t',400.0,'real','event');" 2>&1
ratio=$(q "SELECT printf('%.2f', (SELECT value_real FROM tesla_telemetry_fact WHERE field_key='SelfDrivingMilesSinceReset') / (SELECT value_real FROM tesla_telemetry_fact WHERE field_key='MilesSinceReset'))")
check "FSD share computes as a ratio" "$ratio" "0.40"

[[ $KEEP -eq 1 ]] && echo && echo "database kept at $DB" || rm -f "$DB"
echo
echo "passed $pass, failed $fail"
exit $fail
