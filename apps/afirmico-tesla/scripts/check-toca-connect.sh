#!/usr/bin/env bash
# Gate for FRS-010 F01-R13: prove test/toca-connect.test.ts is not a tautology.
#
# It must FAIL when the rename is undone, and must pass once restored. Each case
# reproduces a way the rename could be done incompletely — which is the real
# risk here, since a rename touches 18 call sites and missing one is invisible
# until a member follows that specific path.
#
# Restores from saved copies, never `git checkout`: this script runs against a
# working tree with uncommitted changes, and `git checkout` would silently
# discard them (that bug happened once already).
set -uo pipefail
cd "$(dirname "$0")/.."          # apps/afirmico-tesla
SRC=src/index.ts
BK=$(mktemp -d)
cp "$SRC" "$BK/index.ts"
restore() { cp "$BK/index.ts" "$SRC"; }
trap 'restore; rm -rf "$BK"' EXIT

run() { bunx vitest run test/toca-connect.test.ts >/dev/null 2>&1; }

echo "=== baseline: suite must PASS with the real source ==="
if run; then echo "  ok    baseline passes"; else echo "  FAIL  baseline does not pass"; exit 1; fi

fail_case() { # label
  if run; then
    echo "  FAIL  $1 — test still passed; it is a tautology"
    restore; exit 1
  else
    echo "  ok    $1 detected"
  fi
  restore
}

echo "=== case 1: rename undone (page back at /connect) ==="
perl -0pi -e "s/app\.get\('\/toca-connect'/app.get('\/connect'/" "$SRC"
fail_case "old path restored as the page"

echo "=== case 2: old path deleted instead of redirected ==="
perl -0pi -e "s/app\.get\('\/connect', \(c\) => c\.redirect\('\/toca-connect', 301\)\)\n//" "$SRC"
fail_case "retired path removed (would 404)"

echo "=== case 3: redirect made temporary (302) ==="
perl -0pi -e "s/c\.redirect\('\/toca-connect', 301\)/c.redirect('\/toca-connect', 302)/" "$SRC"
fail_case "temporary redirect"

echo "=== case 4: one internal link left pointing at the old path ==="
perl -0pi -e "s|<a class=\"cta\" href=\"/toca-connect\">Connect your Tesla</a>|<a class=\"cta\" href=\"/connect\">Connect your Tesla</a>|" "$SRC"
fail_case "stale internal link"

echo "=== case 5: POST also exposed on the retired path ==="
perl -0pi -e "s|app\.get\('\/connect', \(c\) => c\.redirect|app.all('/connect', (c) => c.redirect|" "$SRC"
fail_case "retired path widened to all methods"

echo
echo "all negative controls passed — the test detects an incomplete rename"
git -C .. status --short
