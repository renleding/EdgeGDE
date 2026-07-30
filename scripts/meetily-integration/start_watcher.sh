#!/bin/bash
# Meetily SQLite watcher — starts on login via launchd
# Launches the Hermes-managed meetily-integration pipeline.
# Pulls CAL_COM_API_KEY from Bitwarden Secrets Manager at startup.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

export PYTHONPATH="${SCRIPT_DIR}/src:${PYTHONPATH:-}"
export MEETILY_DB_PATH="${MEETILY_DB_PATH:-$HOME/Library/Application Support/com.meetily.ai/meeting_minutes.sqlite}"

# Pull CAL_COM_API_KEY from Bitwarden (if not already set)
if [ -z "${CAL_COM_API_KEY:-}" ]; then
    BWS_PATH="${HOME}/.hermes/bin/bws"
    if [ -x "$BWS_PATH" ]; then
        export CAL_COM_API_KEY="$("$BWS_PATH" secret list 20c461f4-8dc7-43f2-bec5-b48e00a1d7a9 2>/dev/null | python3 -c "import json,sys; d=json.load(sys.stdin); [print(s['value']) for s in d if s['key']=='CAL_COM_API_KEY']" 2>/dev/null)"
    fi
fi

# Default event type for follow-up bookings
export CAL_COM_EVENT_TYPE_ID="${CAL_COM_EVENT_TYPE_ID:-6424768}"

cd "$SCRIPT_DIR" || exit 1
source .venv/bin/activate 2>/dev/null || {
    echo "ERROR: venv not found at $SCRIPT_DIR/.venv"
    exit 1
}

exec python -m src.main watch
