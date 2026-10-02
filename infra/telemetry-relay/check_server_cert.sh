#!/usr/bin/env bash
#
# Thin wrapper over Tesla's own certificate validator.
#
# SDD-010 section 5 lists check_server_cert.sh in this directory. It is a WRAPPER
# rather than a copy on purpose: the validation logic belongs to Tesla, and a
# vendored copy drifts silently the moment their trust rules change. This script
# fetches the authoritative version and runs it.
#
# What it proves: our server certificate chain validates against Tesla's vehicle
# CA, which is a precondition for any vehicle connecting. It does NOT prove the
# server rejects clients lacking a Tesla certificate -- that is a separate check
# (see deploy.md step 5b).
#
# Usage:  ./check_server_cert.sh [hostname] [port]
#         ./check_server_cert.sh telemetry.afirmi.co 443

set -euo pipefail

HOSTNAME="${1:-telemetry.afirmi.co}"
PORT="${2:-443}"

WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

VALIDATOR_URL="https://raw.githubusercontent.com/teslamotors/fleet-telemetry/main/tools/check_server_cert.sh"

echo "==> Fetching Tesla's validator"
if ! curl -fsSL "$VALIDATOR_URL" -o "$WORKDIR/check_server_cert.sh"; then
  echo "ERROR: could not fetch $VALIDATOR_URL" >&2
  echo "       Check connectivity, or run Tesla's validator manually." >&2
  exit 1
fi
chmod +x "$WORKDIR/check_server_cert.sh"

echo "==> Retrieving the served certificate chain for ${HOSTNAME}:${PORT}"
# -servername is required: without SNI the server may present the wrong cert and
# the result is a misleading failure.
if ! openssl s_client -connect "${HOSTNAME}:${PORT}" -servername "$HOSTNAME" \
      -showcerts </dev/null 2>/dev/null | tee "$WORKDIR/chain.pem" >/dev/null; then
  echo "ERROR: could not retrieve a certificate from ${HOSTNAME}:${PORT}" >&2
  echo "       Is anything listening? Is DNS pointing at the relay?" >&2
  exit 1
fi

if ! grep -q 'BEGIN CERTIFICATE' "$WORKDIR/chain.pem"; then
  echo "ERROR: no certificate in the response -- nothing is serving TLS on that port." >&2
  exit 1
fi

cat > "$WORKDIR/validate_server.json" <<JSON
{
  "hostname": "${HOSTNAME}",
  "port": ${PORT},
  "ca": "$WORKDIR/chain.pem"
}
JSON

echo "==> Running Tesla's validator"
cd "$WORKDIR"
./check_server_cert.sh validate_server.json
STATUS=$?

echo
echo "==> Reminder (see deploy.md step 5b)"
echo "    Chain validation is necessary but NOT sufficient. Also confirm the server"
echo "    REJECTS a client with no Tesla-issued certificate:"
echo
echo "      openssl s_client -connect ${HOSTNAME}:${PORT} -servername ${HOSTNAME} </dev/null"
echo
echo "    A session that succeeds with any client cert means RequireAndVerifyClientCert"
echo "    is not in force -- a security failure, not a pass."

exit $STATUS
