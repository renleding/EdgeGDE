#!/usr/bin/env bash
# Afirmico Broker Knowledge Base — keep-alive health check (no_agent replacement
# for LLM cron job 92319ad1, converted 2026-08-11 system sweep).
# Checks both KB servers and restarts any that are down. Deterministic; no LLM needed.
set -uo pipefail
trap '' PIPE

WIKI_DIR="$HOME/wiki/afirmico-kb"
FILE_DIR="/Users/warren/Documents/_HQ_AI/EdgeGDE/apps/EdgeGDE - Document DB/AFIRMICO Documents DB/AFIRMICO - PCFS - LMS Data/Mortgage Lenders"
RESTARTED=""

echo "=== Afirmico KB server health check — $(date '+%Y-%m-%d %H:%M:%S') ==="

# 1. MkDocs wiki on :8000
if curl -s -o /dev/null --max-time 5 http://localhost:8000; then
  echo "1. MkDocs wiki (:8000): UP"
else
  echo "1. MkDocs wiki (:8000): DOWN — restarting"
  cd "$WIKI_DIR" || { echo "   ERROR: wiki dir missing: $WIKI_DIR"; exit 1; }
  nohup mkdocs serve -a 0.0.0.0:8000 >/tmp/afirmico-kb-mkdocs.log 2>&1 &
  sleep 4
  if curl -s -o /dev/null --max-time 5 http://localhost:8000; then
    echo "   RESTARTED: OK"
    RESTARTED="$RESTARTED mkdocs(:8000)"
  else
    echo "   RESTARTED: FAILED (see /tmp/afirmico-kb-mkdocs.log)"
    RESTARTED="$RESTARTED mkdocs(:8000)-FAILED"
  fi
fi

# 2. File server on :8081
if curl -s -o /dev/null --max-time 5 http://localhost:8081; then
  echo "2. File server (:8081): UP"
else
  echo "2. File server (:8081): DOWN — restarting"
  cd "$FILE_DIR" || { echo "   ERROR: file dir missing: $FILE_DIR"; exit 1; }
  nohup python3 -m http.server 8081 >/tmp/afirmico-kb-files.log 2>&1 &
  sleep 3
  if curl -s -o /dev/null --max-time 5 http://localhost:8081; then
    echo "   RESTARTED: OK"
    RESTARTED="$RESTARTED fileserver(:8081)"
  else
    echo "   RESTARTED: FAILED (see /tmp/afirmico-kb-files.log)"
    RESTARTED="$RESTARTED fileserver(:8081)-FAILED"
  fi
fi

if [ -n "$RESTARTED" ]; then
  echo ""
  echo "RESTARTED:$RESTARTED"
else
  echo ""
  echo "Both servers healthy — no action required."
fi
