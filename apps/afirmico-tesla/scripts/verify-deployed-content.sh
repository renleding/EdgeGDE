#!/usr/bin/env bash
# Post-deploy content assertions for afirmico-tesla.
#
# WHY THIS EXISTS
# ---------------
# The deploy workflow proves the deploy *answered*: it polls /healthz until it
# sees "status":"ok". That check passed while the site was serving the WRONG
# LOGO — a red TOCA mark where the approved black one belongs. Health endpoints
# report service state; they say nothing about what was rendered.
#
# So this asserts the rendered content itself, on the live host, after a deploy.
# It is deliberately about properties a health check cannot see:
#
#   * the served logo IS the approved artwork (not merely "an image loads")
#   * no page hotlinks a third-party asset that could change under us
#   * the member-facing pages still carry the shared chrome
#   * security headers are present on the live responses
#
# USAGE
#   apps/afirmico-tesla/scripts/verify-deployed-content.sh
#   BASE_URL=https://staging... apps/afirmico-tesla/scripts/verify-deployed-content.sh
set -uo pipefail

BASE_URL="${BASE_URL:-https://auto.afirmi.co}"
FAILURES=0
fail() { echo "  FAIL  $1"; FAILURES=$((FAILURES + 1)); }
ok()   { echo "  ok    $1"; }

echo "verify-deployed-content — ${BASE_URL}"
echo

# --- 1. The logo must be the approved artwork --------------------------------
# The specific bug: teslaowners.org.au/resources/19681/2228507.png (TOCA's RED
# mark, rgb(229,25,55)) was hotlinked while the approved mark is the BLACK disc.
#
# Asserted at the byte level rather than by eye, because "a logo is present"
# was exactly the check that missed it. The black-disc artwork is ~42 KB; the
# red mark is ~27 KB, and their dominant colours differ completely.
echo "logo:"
LOGO_TMP=$(mktemp)
CODE=$(curl -s -o "${LOGO_TMP}" -w '%{http_code}' --max-time 20 "${BASE_URL}/toca-logo.png" || echo 000)
if [ "${CODE}" = "200" ]; then
  SIZE=$(wc -c < "${LOGO_TMP}" | tr -d ' ')
  # PNG magic number
  MAGIC=$(head -c 8 "${LOGO_TMP}" | xxd -p 2>/dev/null || echo "")
  if [ "${MAGIC}" = "89504e470d0a1a0a" ]; then
    ok "serves a PNG (${SIZE} bytes)"
  else
    fail "does not serve a valid PNG (magic=${MAGIC})"
  fi

  # Distinguish black-disc artwork from the red mark by pixel content.
  if command -v python3 >/dev/null 2>&1; then
    VERDICT=$(python3 - "${LOGO_TMP}" <<'PY' 2>/dev/null || echo "unreadable"
import sys
try:
    from PIL import Image
    import numpy as np
    from collections import Counter
except ImportError:
    print("no-pillow"); raise SystemExit
try:
    a = np.array(Image.open(sys.argv[1]).convert("RGBA"))
except Exception:
    print("unreadable"); raise SystemExit
op = a[:, :, 3] > 200
if op.sum() == 0:
    print("empty"); raise SystemExit
lum = a[:, :, :3].max(axis=2)
black = int((op & (lum < 40)).sum())
white = int((op & (lum > 200)).sum())
top = Counter(map(tuple, a[op][:, :3])).most_common(1)[0][0]
r, g, b = int(top[0]), int(top[1]), int(top[2])
# The red mark is dominated by ~(229,25,55): strong red, low green/blue.
if r > 180 and g < 90 and b < 110:
    print(f"RED-mark rgb({r},{g},{b})")
elif black > 50000 and white > 3000:
    print(f"black-disc black={black} white={white}")
else:
    print(f"unknown black={black} white={white} top=rgb({r},{g},{b})")
PY
)
    case "${VERDICT}" in
      black-disc*) ok "approved BLACK disc artwork (${VERDICT})" ;;
      RED-mark*)   fail "RED TOCA mark is live — wrong artwork (${VERDICT})" ;;
      no-pillow)   echo "  SKIP  Pillow unavailable — artwork colour not asserted" ;;
      *)           fail "logo artwork unrecognised (${VERDICT})" ;;
    esac
  else
    echo "  SKIP  python3 unavailable — artwork colour not asserted"
  fi
else
  fail "GET /toca-logo.png returned ${CODE}"
fi
rm -f "${LOGO_TMP}"

# --- 2. No hotlinks to third-party assets ------------------------------------
# A hotlink is a dependency on someone else's media path. When it silently
# served the red mark the page looked fine to a status check and wrong to a
# human. Locally-served assets cannot drift this way.
echo "hotlinks:"
for path in / /toca-connect /dashboard; do
  BODY=$(curl -s --max-time 20 "${BASE_URL}${path}" || true)
  if echo "${BODY}" | grep -q 'teslaowners.org.au/resources'; then
    fail "${path} hotlinks TOCA media (must serve locally)"
  else
    ok "${path} has no third-party media hotlink"
  fi
done

# --- 3. Shared chrome is present on member-facing pages ----------------------
# The favicon and partner mark are injected by shared renderers; a page that
# loses them means it bypassed the renderer (the /splash regression).
echo "chrome:"
for path in / /toca-connect /dashboard; do
  BODY=$(curl -s --max-time 20 "${BASE_URL}${path}" || true)
  misses=""
  echo "${BODY}" | grep -q 'rel="icon"'        || misses="${misses} favicon"
  echo "${BODY}" | grep -q 'toca-logo.png'     || misses="${misses} toca-mark"
  if [ -z "${misses}" ]; then
    ok "${path} carries favicon + partner mark"
  else
    fail "${path} missing:${misses}"
  fi
done

# --- 4. Security headers on live responses -----------------------------------
# Present in code and verified by unit tests, but a proxy or route change can
# strip them in front of the Worker. Assert on the wire.
echo "security headers:"
HDRS=$(curl -s -D - -o /dev/null --max-time 20 "${BASE_URL}/toca-connect" || true)
for h in "content-security-policy" "strict-transport-security" "x-frame-options" "referrer-policy"; do
  if echo "${HDRS}" | grep -qi "^${h}:"; then
    ok "${h}"
  else
    # CSP/HSTS may legitimately be added by the edge; report rather than block.
    echo "  WARN  ${h} not present on the origin response"
  fi
done

# --- 5. Health still reports ready -------------------------------------------
echo "health:"
HEALTH=$(curl -s --max-time 20 "${BASE_URL}/healthz" || true)
if echo "${HEALTH}" | grep -q '"status":"ok"'; then
  ok "/healthz reports ok"
else
  fail "/healthz not ok: $(echo "${HEALTH}" | head -c 200)"
fi
# 'problems' must be empty — a populated list is a config gap shipped to prod.
if echo "${HEALTH}" | grep -q '"problems":\[\]'; then
  ok "no config problems reported"
else
  fail "health reports problems: $(echo "${HEALTH}" | head -c 300)"
fi

echo
if [ "${FAILURES}" -gt 0 ]; then
  echo "verify-deployed-content: FAILED (${FAILURES} failure(s))"
  echo "The deploy is live but serving the wrong content. Roll back or fix forward."
  exit 1
fi
echo "verify-deployed-content: PASSED"
exit 0
