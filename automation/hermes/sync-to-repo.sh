#!/usr/bin/env bash
# sync-to-repo.sh — mirror EdgeGDE Hermes automation into this repo.
#
# SOURCE OF TRUTH: ~/.hermes/scripts/  (this repo copy is review-visible only)
# Nothing here is executed by cron; cron runs the ~/.hermes/scripts/ originals.
#
# Usage:
#   ./sync-to-repo.sh           copy source -> repo, refusing anything with a secret
#   ./sync-to-repo.sh --check   report drift only, exit 1 if the repo copy is stale
#
# Run this after changing anything in ~/.hermes/scripts/, then commit + PR here.
set -euo pipefail

SRC="${HERMES_SCRIPTS_DIR:-$HOME/.hermes/scripts}"
DEST="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MODE="${1:-sync}"

# EdgeGDE operational automation only. Personal/non-EdgeGDE tooling stays out.
FILES=(
    edgegde-sdlc.sh
    edgegde-ci-poll.sh
    edgegde-cleanup-worktrees.sh
    edgegde-branch-cleanup.sh
    edgegde-self-heal.sh
    edgegde-deploy-auto-fix.py
    edgegde-security-scan.sh
    edgegde-upgrade-discover.sh
    droid-daily-infra.sh
    afirmico-kb-health.sh
    chat-health-check.sh
    continuous-improvement-loop.sh
    process-agent-ready-queue.sh
    d1-backup.sh
    cubbit-backup.sh
    kv-quota-audit.sh
    mempalace-kg-rebuild.py
    restructure_mempalace.py
)

# Deliberately excluded (see README "Exclusions"):
#   st_downloader.py, st_as_downloader.py   hardcoded live TOTP seed
#   cubbit-backup.sh.bak.2026-09-04         stale backup copy

[ -d "$SRC" ] || { echo "FATAL: source dir not found: $SRC" >&2; exit 1; }

# ── Secret gate ───────────────────────────────────────────────────────────
# A public-repo mirror means one leaked credential is a permanent, world-
# readable disclosure. Refuse rather than warn.
scan_secrets() {
    python3 - "$1" <<'PY'
import re, sys
p = sys.argv[1]
rules = [
    ("PRIVATE_KEY_BLOCK", re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----")),
    ("TOTP_SEED",       re.compile(r"(?i)\bTOTP_SECRET\s*[:=]\s*['\"][A-Z2-7]{20,}")),
    ("KEYED_TOKEN",     re.compile(r"\b(?:sk|rk|pk|ghp|gho|ghs|ghr|sk-ant|xox[baprs]|BWS_)[A-Za-z0-9_\-]{16,}")),
    ("AWS_KEY",         re.compile(r"\bAKIA[0-9A-Z]{16}\b")),
    ("TELEGRAM_BOT",    re.compile(r"\b\d{8,10}:[A-Za-z0-9_\-]{35}\b")),
    ("DB_URI_CREDS",    re.compile(r"\b(?:postgres|postgresql|mysql|redis|mongodb)://[^\s:@/]+:[^\s@/]+@")),
    ("URL_BASIC_AUTH",  re.compile(r"https?://[^\s:@/]+:[^\s@/]{8,}@")),
    ("BEARER",          re.compile(r"Bearer\s+[A-Za-z0-9\-._~+/]{30,}")),
]
# An env lookup / variable reference is not a secret literal.
benign = re.compile(r"^(?:os\.environ|getenv|\$\{?[A-Z_]|process\.env|None|null|\"\"|''|[A-Za-z_]+_(?:PATH|FILE|ID|NAME|CMD)\b)", re.I)
bad = []
for i, line in enumerate(open(p, errors="replace"), 1):
    s = line.strip()
    if s.startswith(("#", "//", "--")):
        continue
    for name, rx in rules:
        for m in rx.finditer(line):
            if m.groups() and benign.match(m.group(1).strip("\"'")):
                continue
            val = m.group(0).split("=")[-1].strip().strip("\"'")
            if benign.match(val):
                continue
            bad.append(f"{p}:{i} [{name}] {m.group(0)[:40]}")
for b in bad:
    print(b)
sys.exit(1 if bad else 0)
PY
}

changed=(); missing=(); blocked=(); stale=()

for f in "${FILES[@]}"; do
    s="$SRC/$f"; d="$DEST/$f"
    if [ ! -f "$s" ]; then missing+=("$f"); continue

    elif ! scan_secrets "$s" >/dev/null 2>&1; then
        blocked+=("$f"); continue
    fi

    if [ ! -f "$d" ]; then
        changed+=("$f (new)")
    elif ! cmp -s "$s" "$d"; then
        if [ "$MODE" = "--check" ]; then stale+=("$f"); else changed+=("$f (update)"); fi
    fi

    if [ "$MODE" != "--check" ]; then
        cp -p "$s" "$d"; chmod 755 "$d"
    fi
done

if [ ${#missing[@]} -gt 0 ]; then
    printf 'MISSING in %s:\n' "$SRC" >&2
    printf '  %s\n' "${missing[@]}" >&2
fi
if [ ${#blocked[@]} -gt 0 ]; then
    printf 'SECRET DETECTED — not staged:\n' >&2
    printf '  %s\n' "${blocked[@]}" >&2
    printf 'Move the credential to ~/.hermes/.env or the secret store.\n' >&2
fi

if [ "$MODE" = "--check" ]; then
    if [ ${#stale[@]} -gt 0 ]; then
        printf 'DRIFT — repo copy is stale:\n'
        printf '  %s\n' "${stale[@]}"
        printf 'Run ./sync-to-repo.sh and commit.\n'
        exit 1
    fi
    echo "in sync (${#FILES[@]} files)"
    exit 0
fi

if [ ${#changed[@]} -gt 0 ]; then
    printf 'synced %d file(s):\n' "${#changed[@]}"
    printf '  %s\n' "${changed[@]}"
else
    echo "already up to date (${#FILES[@]} files)"
fi

[ ${#blocked[@]} -eq 0 ] && [ ${#missing[@]} -eq 0 ] || exit 1
