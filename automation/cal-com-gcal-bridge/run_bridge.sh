#!/bin/sh
# cal.com -> Google Calendar bridge runner.
# Enforces the schedule window (08:00-20:00 Australia/Sydney) and the
# weekday/weekend cadence (15 min Mon-Fri, 30 min Sat-Sun), because
# launchd StartInterval cannot vary by weekday or time-of-day.
#
# The plist fires this every 15 minutes; this script decides whether a
# given fire is inside the allowed window and cadence.

BRIDGE_DIR="$HOME/Documents/_HQ_AI/EdgeGDE/automation/cal-com-gcal-bridge"
LOG="$HOME/.hermes/logs/calcom-gcal-bridge.log"
STATE="$HOME/.hermes/calcom_gcal_bridge_state.json"

mkdir -p "$(dirname "$LOG")"

# Current time in Australia/Sydney.
NOW_SYD=$(TZ=Australia/Sydney date +%H%M)
DOW=$(TZ=Australia/Sydney date +%u)   # 1=Mon .. 7=Sun

# Outside 08:00-20:00 Sydney -> do nothing.
if [ "$NOW_SYD" -lt 800 ] || [ "$NOW_SYD" -ge 2000 ]; then
  exit 0
fi

# Weekend (Sat=6, Sun=7): only run on the half hour (every 30 min).
if [ "$DOW" -ge 6 ]; then
  MIN=$(TZ=Australia/Sydney date +%M)
  if [ "$MIN" != "00" ] && [ "$MIN" != "30" ]; then
    exit 0
  fi
fi

# Resolve CAL_COM_API_KEY from Bitwarden if not already in the env.
if [ -z "$CAL_COM_API_KEY" ] && command -v bws >/dev/null 2>&1; then
  export CAL_COM_API_KEY=$(bws secret list 20c461f4-8dc7-43f2-bec5-b48e00a1d7a9 2>/dev/null \
    | python3 -c "import json,sys; d=json.load(sys.stdin); print(next((s['value'] for s in d if s['key']=='CAL_COM_API_KEY'),''))" 2>/dev/null)
fi

if [ -z "$CAL_COM_API_KEY" ]; then
  echo "$(date -u +%FT%TZ) ERROR: CAL_COM_API_KEY not resolvable" >> "$LOG"
  exit 2
fi

# Run the bridge.
cd "$BRIDGE_DIR" || exit 3
exec python3 bridge.py >> "$LOG" 2>&1
