#!/usr/bin/env bash
# fleetctl — manifest-driven EdgeGDE agent fleet (fleet-state.json is the source of truth)
# Usage:
#   fleetctl.sh verify          — pane labels, cwd markers, identity files, ports
#   fleetctl.sh align           — send-text cd + identity reassert to every idle pane
#   fleetctl.sh identity <agent-N> — print the identity file for a slot
set -euo pipefail

STATE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FLEET="$STATE_DIR/fleet-state.json"
WORKTREES="/Users/warren/Documents/_HQ_AI/EdgeGDE-worktrees"

json_field() { python3 -c "
import json,sys
d=json.load(open('$FLEET'))
for s in d['slots']:
    if s['agent']=='$1':
        print(s['$2']); break
" 2>/dev/null; }

cmd_verify() {
  echo "== pane labels =="
  herdr pane list 2>/dev/null | python3 -c "
import json,sys
for p in json.load(sys.stdin)['result']['panes']:
    print(f\"{p['pane_id']} | {p['label']} | {p.get('foreground_cwd','?')}\")"
  echo
  echo "== identity files (authoritative self-check) =="
  for f in /Users/warren/Documents/_HQ_AI/EdgeGDE/.hermes/worktree-identity.json \
           "$WORKTREES"/agent-{1,2,3,5}/.hermes/worktree-identity.json \
           "$WORKTREES"/tesla-app/.hermes/worktree-identity.json; do
    if [ -f "$f" ]; then
      python3 -c "import json; d=json.load(open('$f')); print(f\"{d['worktree_name']}: port={d['assigned_port']} branch={d['branch']}\")"
    else
      echo "MISSING: $f"
    fi
  done
  echo
  echo "== live cwd per pane (send pwd, verify via pane read) =="
  echo "run: fleetctl.sh align, then grep each pane for its worktree marker"
}

cmd_align() {
  for agent in agent-1 agent-2 agent-3 agent-4 agent-5 agent-6; do
    pane="$(json_field "$agent" pane)"
    wt="$(json_field "$agent" abs_path)"
    [ -z "$pane" ] && { echo "no slot for $agent"; continue; }
    # Only send when the pane is at an idle prompt (no msg=interrupt mid-turn)
    if herdr pane read "$pane" 2>/dev/null | grep -q 'msg=interrupt'; then
      echo "SKIP $agent ($pane): mid-turn"
      continue
    fi
    if [ "$agent" = "agent-6" ]; then
      # coordinator slot: assert identity only, cwd stays where its session lives
      herdr pane send-text "$pane" "cat .hermes/worktree-identity.json 2>/dev/null | head -3" >/dev/null
      herdr pane send-keys "$pane" Enter >/dev/null
      echo "sent identity-check to $agent ($pane)"
      continue
    fi
    herdr pane send-text "$pane" "cd $wt && cat .hermes/worktree-identity.json | python3 -c \"import json,sys; d=json.load(sys.stdin); print('ID=%s PORT=%s BRANCH=%s' % (d['worktree_name'], d['assigned_port'], d['branch']))\"" >/dev/null
    herdr pane send-keys "$pane" Enter >/dev/null
    echo "sent align to $agent ($pane) -> $wt"
  done
}

cmd_identity() {
  f=""
  case "$1" in
    agent-6) f="/Users/warren/Documents/_HQ_AI/EdgeGDE/.hermes/worktree-identity.json";;
    agent-4) f="$WORKTREES/tesla-app/.hermes/worktree-identity.json";;
    agent-*) f="$WORKTREES/$1/.hermes/worktree-identity.json";;
  esac
  [ -f "$f" ] && cat "$f" || echo "MISSING identity file for $1"
}

case "${1:-}" in
  verify)  cmd_verify;;
  align)   cmd_align;;
  identity) cmd_identity "${2:-}";;
  *) echo "usage: fleetctl.sh {verify|align|identity <agent-N>}"; exit 2;;
esac
