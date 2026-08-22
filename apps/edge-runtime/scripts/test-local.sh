#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

PORT="${EDGE_RUNTIME_PORT:-8787}"
BASE="${EDGE_RUNTIME_BASE_URL:-http://127.0.0.1:${PORT}}"
TENANT="${EDGE_RUNTIME_TENANT:-afirmico}"
WRANGLER_PID=""
started=0

# Files using node:assert (custom test runner) — run with tsx (no vitest context needed)
TSX_TESTS=(
  "tests/admin-pages.test.ts"
  "tests/canvas/canvas-engine.test.ts"
  "tests/canvas/canvas-editor.test.ts"
  "tests/canvas/compile-from-canvas.test.ts"
  "tests/cloner/website-cloner.test.ts"
  "tests/transpiler/design-extractor.test.ts"
)

# Files importing from vitest (describe/it/expect) — must use vitest run because
# vitest 4.x's describe() requires a runner context that tsx doesn't initialize.
# These are pure unit tests and can run before wrangler starts.
VITEST_UNIT_TESTS=(
  "tests/unit-chat-constraint.test.ts"
  "tests/unit-schema.test.ts"
  "tests/scoring-engine.test.ts"
  "tests/phase13-hypermedia.test.ts"
  "tests/domain-swarm.test.ts"
)

# These vitest-based tests need a running wrangler dev server for HTTP calls.
# MUST use vitest.integration.config.ts — the default vitest.config.ts `include`
# list does not contain these files, so without --config vitest exits with
# "No test files found, exiting with code 1".
VITEST_INTEGRATION_TESTS=(
  "tests/domain-workspace.test.ts"
)

# Where wrangler dev persists local state (D1/KV/DO) during tests.
PERSIST_DIR=".wrangler/local-test"
D1_NAME="edgegde-local"

cleanup_started_wrangler() {
  if [ "$started" -eq 1 ] && [ -n "${WRANGLER_PID:-}" ]; then
    kill "$WRANGLER_PID" >/dev/null 2>&1 || true
    wait "$WRANGLER_PID" >/dev/null 2>&1 || true
  fi
  # wrangler dev spawns workerd child processes that survive `kill` on the npm
  # wrapper; they keep PORT bound and answer /healthz with stale (unseeded)
  # state. Kill the whole tree so the next start_wrangler binds a fresh server.
  pkill -f "wrangler dev --local --config wrangler.local.toml --port $PORT" >/dev/null 2>&1 || true
  pkill -f "workerd serve --binary" >/dev/null 2>&1 || true
  sleep 1
}

run_unit_tests() {
  for test_file in "${TSX_TESTS[@]}"; do
    tsx "$test_file"
  done
  if [ ${#VITEST_UNIT_TESTS[@]} -gt 0 ]; then
    vitest run "${VITEST_UNIT_TESTS[@]}"
  fi
}

run_integration_tests() {
  if [ ${#VITEST_INTEGRATION_TESTS[@]} -gt 0 ]; then
    vitest run --config vitest.integration.config.ts "${VITEST_INTEGRATION_TESTS[@]}"
  fi
}

export EDGE_RUNTIME_BASE_URL="$BASE"
export EDGE_RUNTIME_TENANT="$TENANT"

# Seeds the local D1 with the schema + data the integration suite needs.
# Uses `wrangler d1 execute --local` (NOT direct sqlite file access): wrangler
# 4.x creates the D1 data file lazily with a content-hash name, so the old
# `find .wrangler/... -name '*.sqlite'` glob finds nothing before the first
# D1 write. The seed SQL is self-contained and idempotent (CREATE IF NOT EXISTS
# + row reset), and mirrors migrations 0005/0009/0010 — the migration chain
# itself cannot be replayed here because its 0001-bootstrap ALTERs fail
# atomically on re-run.
seed_local_d1() {
  npx wrangler d1 execute "$D1_NAME" --local \
    --persist-to "$PERSIST_DIR" \
    --config wrangler.local.toml \
    --file scripts/seed-local-integration-d1.sql >/dev/null
}

start_wrangler() {
  npx wrangler dev --local --config wrangler.local.toml --port "$PORT" --persist-to "$PERSIST_DIR" >/tmp/edge-runtime-wrangler-test.log 2>&1 &
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
cleanup_started_wrangler  # ensure port is free before deciding

if ! curl -fsS "$BASE/healthz" >/dev/null 2>&1; then
  started=1

  # Fresh, deterministic local state — wipes any stale D1 rows/KV pipeline
  # cache left by a previous run (tests assert exact per-stage counts).
  rm -rf "$PERSIST_DIR"

  run_unit_tests
  start_wrangler
  kill "$WRANGLER_PID" >/dev/null 2>&1 || true
  wait "$WRANGLER_PID" >/dev/null 2>&1 || true
  cleanup_started_wrangler

  seed_local_d1
  start_wrangler
else
  # A wrangler was already healthy at BASE — make sure it has the seed
  # schema/data (idempotent, safe to re-run) before testing against it.
  seed_local_d1
fi

if ! curl -fsS "$BASE/healthz" >/dev/null 2>&1; then
  echo "Local EdgeGDE runtime is not healthy at $BASE" >&2
  exit 1
fi
run_unit_tests
run_integration_tests
