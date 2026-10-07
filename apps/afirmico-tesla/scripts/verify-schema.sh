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
#
# THE MEASUREMENT USES SQLITE'S OWN TOKENIZER, not a text heuristic.
# It previously split on `;` immediately followed by a newline, which is not SQL's rule
# for ending a statement. `;` inside a string literal ends nothing, so the split produced
# fragments that were not statements: on 0011_seed_consent_policy.sql the true INSERT is
# 2,222 B while the heuristic reported 3,018 B by folding a comment block into it. That
# over-reports (so it failed safe), but a limit check whose number is wrong is a check
# nobody can act on — and the whole point of this gate is that the number is actionable.
# `sqlite3.complete_statement()` is SQLite's own parser: it is the same authority that
# decides, so the split cannot disagree with the engine about where a statement ends.
#
# THE 80% ALARM is the early warning for the case this gate cannot fix: a seed migration
# grows by appending rows, so it will breach eventually. Measured 2026-10-07, the largest
# is 0002_seed_tesla_catalog.sql at 60.4% — 39.6 KB of headroom. Crossing 80% means the
# next row-batch risks a production-only failure, and the answer is then to move that seed
# to a split-by-row-count loader rather than to keep appending. It warns rather than fails
# because a large-but-legal statement is not a defect.
echo "D1 platform limits"
D1_MAX_STATEMENT=100000
D1_WARN_STATEMENT=$(( D1_MAX_STATEMENT * 80 / 100 ))
for f in migrations/*.sql; do
  name=$(basename "$f")
  read -r maxb nstmt <<< "$(python3 - "$f" <<'PY'
import sqlite3, sys
src = open(sys.argv[1]).read()
# Accumulate characters until SQLite says the text so far is a complete statement.
# complete_statement() returns True only at a genuine top-level ';', so string literals
# and comments are handled by the engine rather than by a regex.
statements, buf = [], ''
for ch in src:
    buf += ch
    if ch == ';' and sqlite3.complete_statement(buf):
        statements.append(buf)
        buf = ''
if buf.strip():
    statements.append(buf)
longest = max((len(s) for s in statements), default=0)
print(longest, len(statements))
PY
)"
  if [[ "$maxb" -gt "$D1_MAX_STATEMENT" ]]; then
    printf '  FAIL  %-34s %4s stmts  max %8s B exceeds %s\n' "$name" "$nstmt" "$maxb" "$D1_MAX_STATEMENT"
    fail=$((fail + 1))
  elif [[ "$maxb" -gt "$D1_WARN_STATEMENT" ]]; then
    printf '  WARN  %-34s %4s stmts  max %8s B (%s%% of cap — split the seed before adding rows)\n' \
      "$name" "$nstmt" "$maxb" "$((maxb * 100 / D1_MAX_STATEMENT))"
    pass=$((pass + 1))
  else
    printf '  ok    %-34s %4s stmts  max %8s B (%s%% of cap)\n' \
      "$name" "$nstmt" "$maxb" "$((maxb * 100 / D1_MAX_STATEMENT))"
    pass=$((pass + 1))
  fi
done
echo

# --- apply -----------------------------------------------------------------
# Applied in filename order over EVERY migration, discovered rather than listed.
# The previous hardcoded list stopped at 0004, so 0005-0007 were silently never
# applied here and the checks below ran against a stale schema — a gate that
# passes while testing the wrong thing.
MIGRATIONS=()
while IFS= read -r m; do MIGRATIONS+=("$m"); done < <(ls migrations/*.sql | sort)

if ! sqlite3 "$DB" <<SQL >/dev/null 2>&1
PRAGMA foreign_keys=ON;
$(for m in "${MIGRATIONS[@]}"; do echo ".read $m"; done)
SQL
then
  echo "  FATAL: migrations failed to apply"
  sqlite3 "$DB" <<SQL 2>&1 | head -5
PRAGMA foreign_keys=ON;
$(for m in "${MIGRATIONS[@]}"; do echo ".read $m"; done)
SQL
  exit 99
fi

echo "Structure"
# Expected table count is derived from the migration SQL, not hardcoded, so
# adding a table cannot leave this assertion quietly out of date. Internal
# sqlite_* tables are excluded because their presence is an implementation
# detail of AUTOINCREMENT/stat, not something the FRS specifies.
EXPECTED_TABLES=$(grep -ch '^CREATE TABLE' migrations/*.sql | paste -sd+ - | bc)
check "tables created"            "$(q "SELECT count(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")" "$EXPECTED_TABLES"
# Guard triggers are DERIVED from the migration files, not pinned to a number.
# The hardcoded `4` here was already stale once (migration 0007/0008 add two), and
# a count that is edited to match reality proves nothing — it just moves the point
# at which someone forgets to edit it. What matters is that every trigger declared
# in the migrations actually got created, so a CREATE TRIGGER that silently failed
# (or was dropped while resolving a duplicate) is caught.
want_triggers=$(grep -hc '^CREATE TRIGGER' migrations/*.sql 2>/dev/null | paste -sd+ - | bc)
check "triggers created"          "$(q "SELECT count(*) FROM sqlite_master WHERE type='trigger'")" "$want_triggers"
check "foreign keys declared"     "$(q "SELECT count(*) FROM pragma_foreign_key_list('tesla_telemetry_fact')")" 3
check "migrations applied"        "${#MIGRATIONS[@]}" "$(ls migrations/*.sql | wc -l | tr -d ' ')"

echo
echo "F03 acceptance criteria"
check "AC1 field catalog = 272"   "$(q "SELECT count(*) FROM tesla_field_catalog")" 272
check "AC2 alert catalog = 18436" "$(q "SELECT count(*) FROM tesla_alert_catalog")" 18436
check "AC7 distinct signals 17579" "$(q "SELECT count(DISTINCT signal_name) FROM tesla_alert_catalog")" 17579
check "AC7 model variants = 853"  "$(q "SELECT count(*) FROM (SELECT signal_name FROM tesla_alert_catalog GROUP BY signal_name HAVING count(*)>1)")" 853
check "AC3 disabled families"     "$(q "SELECT group_concat(DISTINCT family) FROM tesla_endpoint_catalog WHERE enabled=0 ORDER BY family")" "energy_command,enterprise,vehicle_command"

echo
echo "Collected subset"
check "collected fields"          "$(q "SELECT count(*) FROM tesla_field_catalog WHERE collected=1")" 15
check "event tier"                "$(q "SELECT count(*) FROM tesla_field_catalog WHERE collection_tier='event'")" 3
check "on_change tier"            "$(q "SELECT count(*) FROM tesla_field_catalog WHERE collection_tier='on_change'")" 8
check "once tier"                 "$(q "SELECT count(*) FROM tesla_field_catalog WHERE collection_tier='once' AND collected=1")" 4
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
ok4=$(sqlite3 "$DB" "INSERT INTO tesla_vehicle_snapshot (vin,field_key,value_text,observed_at) VALUES ('TESTVIN','Trim','Performance','t');" 2>&1)
check "all 4 once-only collected fields accepted" "$([[ -z "$ok1$ok2$ok3$ok4" ]] && echo yes || echo no)" yes

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

echo
echo "Wide read model (F04 — column-per-field pivot, migration 0012)"
# The view must exist and expose one column per collected time-varying signal.
check "telemetry_record view exists" "$(q "SELECT count(*) FROM sqlite_master WHERE type='view' AND name='tesla_telemetry_record'")" 1
check "vehicle_attribute view exists" "$(q "SELECT count(*) FROM sqlite_master WHERE type='view' AND name='tesla_vehicle_attribute'")" 1
check "record view exposes 11 signals + 5 provenance" \
  "$(q "SELECT count(*) FROM pragma_table_info('tesla_telemetry_record')")" 19

# The three distance signals appear twice: once as reported (miles) and once converted
# (km). Both must be present — an analyst reading the record view must not have to
# convert by hand, and the conversion must not replace the reported value.
check "miles columns present" \
  "$(q "SELECT count(*) FROM pragma_table_info('tesla_telemetry_record') WHERE name IN ('odometer_mi','miles_since_reset_mi','self_driving_miles_since_reset_mi')")" 3
check "km columns present" \
  "$(q "SELECT count(*) FROM pragma_table_info('tesla_telemetry_record') WHERE name IN ('odometer_km','miles_since_reset_km','self_driving_miles_since_reset_km')")" 3

# The owner asked specifically for the since-reset distance with km. It is easy to
# read as "already covered" because the FSD column also says "since reset", so pin the
# pair explicitly: both reset counters must carry a km column, and the conversion must
# actually be applied to the reported value.
check "total-since-reset km = mi x 1.609344" \
  "$(q "SELECT CASE WHEN ABS(miles_since_reset_km - (miles_since_reset_mi * 1.609344)) < 0.000001 THEN 'ok' ELSE 'mismatch' END FROM tesla_telemetry_record WHERE vin='TESTVIN' AND observed_at='2026-10-01T00:00:00Z'")" "ok"
check "FSD-since-reset km = mi x 1.609344" \
  "$(q "SELECT CASE WHEN ABS(self_driving_miles_since_reset_km - (self_driving_miles_since_reset_mi * 1.609344)) < 0.000001 THEN 'ok' ELSE 'mismatch' END FROM tesla_telemetry_record WHERE vin='TESTVIN' AND observed_at='2026-10-01T00:00:00Z'")" "ok"
# The reset counters must be DISTINCT columns with independent values -- if a view
# edit ever aliased one to the other, the FSD share would read as 1.0 and be silently
# wrong. 1000 total vs 400 FSD is the fixture above.
check "the two reset counters are independent" \
  "$(q "SELECT CASE WHEN miles_since_reset_mi <> self_driving_miles_since_reset_mi THEN 'distinct' ELSE 'aliased' END FROM tesla_telemetry_record WHERE vin='TESTVIN' AND observed_at='2026-10-01T00:00:00Z'")" "distinct"

# The `once` tier is a vehicle attribute, not a time series, and must NOT be
# pivoted into the record stream -- presenting a constant as if it were observed
# at every instant is the defect this guards.
check "once-tier fields absent from series" \
  "$(q "SELECT count(*) FROM pragma_table_info('tesla_telemetry_record') WHERE name IN ('car_type','version','efficiency_package')")" 0
check "once-tier fields present as attributes" \
  "$(q "SELECT count(*) FROM pragma_table_info('tesla_vehicle_attribute') WHERE name IN ('car_type','version','efficiency_package','trim')")" 4

# The attribute view must report an observed-at RANGE, not a single instant: a partial
# payload advances only the fields it carries, so one MAX() implied all attributes were
# observed together when they were not. `observed_at` must be GONE -- leaving the old
# name available would let a caller keep making the wrong claim by accident.
check "attribute view has oldest_observed_at" \
  "$(q "SELECT count(*) FROM pragma_table_info('tesla_vehicle_attribute') WHERE name='oldest_observed_at'")" 1
check "attribute view has newest_observed_at" \
  "$(q "SELECT count(*) FROM pragma_table_info('tesla_vehicle_attribute') WHERE name='newest_observed_at'")" 1
check "the misleading single observed_at is gone" \
  "$(q "SELECT count(*) FROM pragma_table_info('tesla_vehicle_attribute') WHERE name='observed_at'")" 0

# The pivot must collapse to one row per (vin, observed_at) -- the grain that makes
# it a true record rather than an approximation. Three facts sharing one instant
# must yield exactly one row.
check "one row per (vin, observed_at)" \
  "$(q "SELECT count(*) FROM tesla_telemetry_record WHERE vin='TESTVIN' AND observed_at='2026-10-01T00:00:00Z'")" 1
check "pivot carries the signal values" \
  "$(q "SELECT CAST(miles_since_reset_mi AS INT)||'/'||CAST(self_driving_miles_since_reset_mi AS INT) FROM tesla_telemetry_record WHERE vin='TESTVIN' AND observed_at='2026-10-01T00:00:00Z'")" "1000/400"
# The conversion must be applied, and must equal the same constant derive.ts uses
# (1.609344) so the record view and the derived profile cannot disagree.
check "km conversion applied (1000 mi = 1609.344 km)" \
  "$(q "SELECT CAST(ROUND(miles_since_reset_km, 3) AS TEXT) FROM tesla_telemetry_record WHERE vin='TESTVIN' AND observed_at='2026-10-01T00:00:00Z'")" "1609.344"
check "km conversion preserves NULL (absent stays absent)" \
  "$(q "SELECT CASE WHEN odometer_km IS NULL THEN 'null' ELSE 'set' END FROM tesla_telemetry_record WHERE vin='TESTVIN' AND observed_at='2026-10-01T00:00:00Z'")" "null"
# The same row has no odometer fact, so that column must be NULL rather than 0 --
# the concat above would have collapsed to empty if any operand were NULL.
check "unset signal in a populated row is NULL" \
  "$(q "SELECT CASE WHEN odometer_mi IS NULL THEN 'null' ELSE 'set' END FROM tesla_telemetry_record WHERE vin='TESTVIN' AND observed_at='2026-10-01T00:00:00Z'")" "null"

# NULL (not reported) and 0 (a measured zero) must render differently. An absent
# signal silently reading as 0 would fabricate a reading.
sqlite3 "$DB" "INSERT INTO tesla_telemetry_fact (fact_id,vin,field_key,observed_at,received_at,value_bool,value_kind,collection_tier) VALUES ('N1','TESTVIN','SpeedLimitMode','2026-10-02T00:00:00Z','t',0,'bool','event');" 2>&1
check "absent signal pivots to NULL" \
  "$(sqlite3 -noheader "$DB" "SELECT CASE WHEN pin_to_drive_enabled IS NULL THEN 'null' ELSE 'val' END FROM tesla_telemetry_record WHERE observed_at='2026-10-02T00:00:00Z';" | tr -d '[:space:]')" "null"
check "measured zero pivots to 0" \
  "$(sqlite3 -noheader "$DB" "SELECT CASE WHEN speed_limit_mode = 0 THEN 'zero' ELSE 'other' END FROM tesla_telemetry_record WHERE observed_at='2026-10-02T00:00:00Z';" | tr -d '[:space:]')" "zero"

# A view over the facts cannot drift from them: every fact instant it exposes must
# correspond to a real fact row. This is the property that makes the view safer
# than a second, hand-maintained table.
check "view cannot invent instants" \
  "$(q "SELECT count(*) FROM tesla_telemetry_record r WHERE NOT EXISTS (SELECT 1 FROM tesla_telemetry_fact f WHERE f.vin=r.vin AND f.observed_at=r.observed_at)")" 0

# --- admin query column validity ---------------------------------------------
#
# A GUARD ADDED AFTER A REAL PRODUCTION 500. `/admin/api/telemetry/latest` was written
# as `SELECT MAX(observed_at) ... FROM tesla_telemetry_batch`, but `observed_at` lives on
# tesla_telemetry_fact; the batch table has only `received_at`. The unit tests could not
# catch it: the admin tests run against a MOCKED D1 whose prepare() accepts any SQL, so an
# invalid column is invisible there and valid only until it reaches the real database. The
# endpoint returned 500 in production.
#
# This closes the class rather than the instance: every column referenced as
# `tesla_x.col` in src/admin.ts is checked against the schema built from the migrations,
# using pragma_table_info. A column that does not exist fails here, in CI, instead of
# returning 500 in front of an operator.
ADMIN_SRC="src/admin.ts"
[[ -f "$ADMIN_SRC" ]] || ADMIN_SRC="../apps/afirmico-tesla/src/admin.ts"
if [[ -f "$ADMIN_SRC" ]]; then
  ADMIN_TABLES=$(grep -oE '\b(FROM|JOIN)[[:space:]]+tesla_[a-z_]+' "$ADMIN_SRC" \
    | awk '{print $2}' | sort -u)
  bad_cols=0
  checked_tables=0
  for t in $ADMIN_TABLES; do
    exists=$(sqlite3 -noheader "$DB" "SELECT count(*) FROM sqlite_master WHERE name='$t'" 2>/dev/null | tr -d '[:space:]')
    [[ "$exists" == "1" ]] || continue
    checked_tables=$((checked_tables + 1))
    while IFS= read -r col; do
      [[ -z "$col" ]] && continue
      has=$(sqlite3 -noheader "$DB" "SELECT count(*) FROM pragma_table_info('$t') WHERE name='$col'" 2>/dev/null | tr -d '[:space:]')
      if [[ "$has" != "1" ]]; then
        printf '  FAIL  %-46s %s.%s does not exist\n' "admin column validity" "$t" "$col"
        bad_cols=$((bad_cols + 1))
      fi
    done < <(grep -oE "${t}\.[a-z_]+" "$ADMIN_SRC" | sed "s/^${t}\.//" | sort -u)
  done
  # A zero here would mean the scan matched nothing and the next check is vacuous.
  check "admin column scan found tables" "$(( checked_tables > 0 ? 1 : 0 ))" 1
  check "admin references only real columns" "$bad_cols" 0
else
  echo "  FAIL  admin source not found — column validity not checked"
  fail=$((fail + 1))
fi

[[ $KEEP -eq 1 ]] && echo && echo "database kept at $DB" || rm -f "$DB"
echo
echo "passed $pass, failed $fail"
exit $fail
