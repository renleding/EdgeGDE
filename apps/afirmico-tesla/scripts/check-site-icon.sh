#!/usr/bin/env bash
# Gate for FRS-010 F01-R11 / F01-R12: prove test/site-icon.test.ts is not a
# tautology. It must FAIL for each way the icon was actually broken.
#
# Each case breaks one real defect, runs the suite, and restores the file.
# Restoration uses a temp copy of the ORIGINAL, never `git checkout` -- the
# files under test are the ones being edited, so git would revert the working
# changes this gate is meant to be validating.
# Run from the afirmico-tesla app directory.
set -uo pipefail
APP="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$APP/src/index.ts"
SPLASH="$APP/public/index.html"
CFG="$APP/wrangler.json"

TMP="$(mktemp -d)"
cp "$SRC" "$TMP/index.ts.orig"
cp "$SPLASH" "$TMP/index.html.orig"
cp "$CFG" "$TMP/wrangler.json.orig"
trap 'rm -rf "$TMP"' EXIT

reset_all() {
  cp "$TMP/index.ts.orig" "$SRC"
  cp "$TMP/index.html.orig" "$SPLASH"
  cp "$TMP/wrangler.json.orig" "$CFG"
}

fail=0
n=0

run_case() {
  local name="$1"
  n=$((n + 1))
  # The exit status is the signal; the output is only useful on failure.
  if bun run --cwd "$APP" test >"$TMP/gate-$n.log" 2>&1; then
    echo "FAIL  $name"
    echo "      suite still passed -- this case is a tautology"
    fail=1
  else
    echo "ok    $name  (suite rejected it; the test has teeth)"
  fi
  reset_all
}

echo "=== negative controls for test/site-icon.test.ts ==="

# 1. Chrome with no icon link at all -- the original state of page().
python3 - "$SRC" <<'PY'
import sys
p = sys.argv[1]
s = open(p).read()
for old in (
    '<link rel="icon" type="${FAVICON_CONTENT_TYPE}" href="${FAVICON_HREF}">',
    '<link rel="icon" href="/favicon.ico" sizes="32x32">',
    '<link rel="apple-touch-icon" href="${FAVICON_HREF}">',
):
    s = s.replace(old, '')
open(p, 'w').write(s)
PY
run_case "page() chrome carries no icon link"

# 2. Splash with its own private inline icon instead of the shared one.
python3 - "$SPLASH" <<'PY'
import sys, re
p = sys.argv[1]
s = open(p).read()
s = re.sub(r'<link rel="icon"[^>]*>\n?', '', s)
s = re.sub(r'<link rel="apple-touch-icon"[^>]*>\n?', '', s)
s = s.replace('<title>', '<link rel="icon" href="data:image/png;base64,iVBORw0KGgo=">\n<title>')
open(p, 'w').write(s)
PY
run_case "splash uses a private inline data-URI icon"

# 3. /favicon.ico unrouted -- the original defect, where it returned HTML.
python3 - "$SRC" <<'PY'
import sys, re
p = sys.argv[1]
s = open(p).read()
s2 = re.sub(r"app\.get\('/favicon\.ico'.*?\n\}\)\n\n", '', s, flags=re.S)
assert s2 != s, "favicon.ico route not found to remove"
open(p, 'w').write(s2)
PY
run_case "/favicon.ico has no route"

# 4. Host-wide route removed -- the original state, where "/" was answered by
#    the retired catch-all worker and the edited splash was served nowhere.
python3 - "$CFG" <<'PY'
import sys, json
p = sys.argv[1]
d = json.load(open(p))
d["routes"] = [{"pattern": "auto.afirmi.co/connect", "zone_name": "afirmi.co"}]
json.dump(d, open(p, 'w'), indent=2)
PY
run_case "worker routes do not cover the bare host"

# 5. notFound proxying back to the origin (would self-fetch under a host-wide
#    route and serve the retired worker's splash). Uses string search so a
#    reworded comment cannot make this a silent no-op.
python3 - "$SRC" <<'PY'
import sys
p = sys.argv[1]
s = open(p).read()
i = s.index('app.notFound(')
j = s.index('\n})', i) + 3
s2 = s[:i] + 'app.notFound((c) => fetch(c.req.raw))\n' + s[j:]
assert s2 != s, "notFound handler not found to replace"
open(p, 'w').write(s2)
PY
run_case "notFound proxies to the origin instead of ASSETS"

echo
if [ "$fail" -eq 0 ]; then
  echo "PASS: $n/$n negative controls detected. The icon tests are not tautologies."
else
  echo "PROBLEM: at least one defect was not detected."
fi
echo "=== working changes still intact (must show src/wrangler as modified) ==="
git -C "$(git -C "$APP" rev-parse --show-toplevel)" status --short
exit "$fail"
