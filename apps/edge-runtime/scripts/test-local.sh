#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

PORT="${EDGE_RUNTIME_PORT:-8787}"
BASE="${EDGE_RUNTIME_BASE_URL:-http://127.0.0.1:${PORT}}"
TENANT="${EDGE_RUNTIME_TENANT:-afirmico}"
WRANGLER_PID=""
started=0

UNIT_TESTS=(
  "tests/admin-pages.test.ts"
  "tests/canvas/canvas-engine.test.ts"
  "tests/canvas/canvas-editor.test.ts"
  "tests/canvas/compile-from-canvas.test.ts"
  "tests/cloner/website-cloner.test.ts"
  "tests/transpiler/design-extractor.test.ts"
  "tests/unit-chat-constraint.test.ts"
  "tests/unit-schema.test.ts"
)

cleanup_started_wrangler() {
  if [ "$started" -eq 1 ] && [ -n "${WRANGLER_PID:-}" ]; then
    kill "$WRANGLER_PID" >/dev/null 2>&1 || true
    wait "$WRANGLER_PID" >/dev/null 2>&1 || true
  fi
}

run_unit_tests() {
  for test_file in "${UNIT_TESTS[@]}"; do
    tsx "$test_file"
  done
}

export EDGE_RUNTIME_BASE_URL="$BASE"
export EDGE_RUNTIME_TENANT="$TENANT"

seed_contacts_table() {
  local d1_file=""
  if [ -d .wrangler/local-test/v3/d1/miniflare-D1DatabaseObject ]; then
    d1_file=$(find .wrangler/local-test/v3/d1/miniflare-D1DatabaseObject -type f -name '*.sqlite' ! -name 'metadata.sqlite' -print | sort | tail -n 1 || true)
  fi

  if [ -n "$d1_file" ] && ! sqlite3 "$d1_file" "SELECT 1 FROM contacts LIMIT 1;" >/dev/null 2>&1; then
    sqlite3 "$d1_file" <<'SQL'
CREATE TABLE IF NOT EXISTS contacts (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_tenant_email
  ON contacts(tenant_id, email)
  WHERE email != '';
CREATE INDEX IF NOT EXISTS idx_contacts_tenant_phone
  ON contacts(tenant_id, phone)
  WHERE phone != '';
SQL
  elif [ -z "$d1_file" ]; then
    echo "Local D1 sqlite file was not found after starting Wrangler" >&2
    exit 1
  fi
}

start_wrangler() {
  npx wrangler dev --local --config wrangler.local.toml --port "$PORT" --persist-to .wrangler/local-test >/tmp/edge-runtime-wrangler-test.log 2>&1 &
  WRANGLER_PID=$!

  for _ in $(seq 1 60); do
    if ! kill -0 "$WRANGLER_PID" >/dev/null 2>&1; then
      echo "Wrangler exited before $BASE became healthy" >&2
      cat /tmp/edge-runtime-wrangler-test.log >&2 || true
      return 1
    fi
    if curl -fsS "$BASE/healthz" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done

  echo "Local EdgeGDE runtime did not become healthy at $BASE" >&2
  cat /tmp/edge-runtime-wrangler-test.log >&2 || true
  return 1
}

trap cleanup_started_wrangler EXIT
if ! curl -fsS "$BASE/healthz" >/dev/null 2>&1; then
  started=1

  run_unit_tests
  start_wrangler
  kill "$WRANGLER_PID" >/dev/null 2>&1 || true
  wait "$WRANGLER_PID" >/dev/null 2>&1 || true

  seed_contacts_table
  start_wrangler
fi

if ! curl -fsS "$BASE/healthz" >/dev/null 2>&1; then
  echo "Local EdgeGDE runtime is not healthy at $BASE" >&2
  exit 1
fi
run_unit_tests
tsx tests/scoring-engine.test.ts && \
tsx tests/phase13-hypermedia.test.ts && \
tsx tests/domain-workspace.test.ts && \
tsx tests/domain-swarm.test.ts
