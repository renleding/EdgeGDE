#!/usr/bin/env bash
# Gate for FRS-010 F01-R11: prove test/site-icon.test.ts is not a tautology.
# It must FAIL against each of the three ways the icon was actually broken.
set -uo pipefail
APP="$(cd "$(dirname "$0")/.." && pwd)"
cd "$APP"

run() { npx vitest run test/site-icon.test.ts 2>&1; }

echo "=== (0) current code: expect PASS ==="
run | grep -E "Test Files|Tests " | tail -2

echo
echo "=== (1) restore the ORIGINAL splash (inline data-URI, no shared link) ==="
cp public/index.html /tmp/splash.fixed
git show origin/main:apps/afirmico-tesla/public/index.html > public/index.html
run | grep -E "Test Files|Tests |splash" | tail -3
cp /tmp/splash.fixed public/index.html

echo
echo "=== (2) delete the worker's icon routes: expect FAIL ==="
cp src/index.ts /tmp/index.fixed
python3 - <<'PY'
import re
p = "src/index.ts"
s = open(p).read()
s2 = re.sub(r"app\.get\('/favicon\.(svg|ico)', \(c\) => \{.*?\n\}\)\n\n", "", s, flags=re.S)
assert s2 != s, "route removal did not match - check the regex"
open(p, "w").write(s2)
PY
run | grep -E "Test Files|Tests " | tail -2
cp /tmp/index.fixed src/index.ts

echo
echo "=== (3) restore page() to declare no icon: expect FAIL ==="
cp src/index.ts /tmp/index.fixed2
python3 - <<'PY'
p = "src/index.ts"
s = open(p).read()
for tag in ('<link rel="icon" type="${FAVICON_CONTENT_TYPE}" href="${FAVICON_HREF}">\n',
            '<link rel="icon" href="/favicon.ico" sizes="32x32">\n',
            '<link rel="apple-touch-icon" href="${FAVICON_HREF}">\n'):
    assert tag in s, f"missing expected tag: {tag!r}"
    s = s.replace(tag, "", 1)
open(p, "w").write(s)
PY
run | grep -E "Test Files|Tests " | tail -2
cp /tmp/index.fixed2 src/index.ts

echo
echo "=== (4) restored: expect PASS ==="
run | grep -E "Test Files|Tests " | tail -2
