#!/bin/bash
# EdgeGDE — Automated Deploy Script
# Bumps version, commits, tags, deploys, and pushes.
set -euo pipefail

cd "$(dirname "$0")/.."

# ── Parse arguments ─────────────────────────────────────────────────────────
BUMP_TYPE="${1:-patch}"  # patch, minor, major
COMMIT_MSG="${2:-}"       # optional override

# ── Preflight ───────────────────────────────────────────────────────────────
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "❌ Uncommitted changes. Commit or stash first."
  exit 1
fi

git fetch origin --tags 2>/dev/null || true

# ── Version bump ────────────────────────────────────────────────────────────
CURRENT=$(node -p "require('./package.json').version")
NEW_VERSION=$(node -e "
  const v = '$CURRENT'.split('.').map(Number);
  if ('$BUMP_TYPE' === 'major') { v[0]++; v[1]=0; v[2]=0; }
  else if ('$BUMP_TYPE' === 'minor') { v[1]++; v[2]=0; }
  else { v[2]++; }
  console.log(v.join('.'));
")

echo "📦 $CURRENT → $NEW_VERSION ($BUMP_TYPE)"

node -e "const p=require('./package.json'); p.version='$NEW_VERSION'; require('fs').writeFileSync('./package.json', JSON.stringify(p, null, 2)+'\n')"

# ── Compile check ────────────────────────────────────────────────────────────
npx tsc --noEmit || { echo "❌ TypeScript compilation failed"; exit 1; }

# ── Lint check ──────────────────────────────────────────────────────────────
npm run lint 2>&1 | grep -q "0 errors" || { echo "❌ Lint failed"; npm run lint 2>&1 | tail -5; exit 1; }

# ── Run tests ───────────────────────────────────────────────────────────────
npm run test > /dev/null 2>&1 || { echo "❌ Tests failed"; exit 1; }

# ── Deploy ───────────────────────────────────────────────────────────────────
echo "🚀 Deploying v$NEW_VERSION..."
npx wrangler deploy --var WORKER_VERSION:"$NEW_VERSION" 2>&1 | tail -3

# ── Commit + tag ────────────────────────────────────────────────────────────
AUTO_MSG="${COMMIT_MSG:-chore: release v$NEW_VERSION}"

git add .
git commit -m "$AUTO_MSG"
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
git pull --rebase origin "$CURRENT_BRANCH" 2>/dev/null || true
git tag -a "v$NEW_VERSION" -m "v$NEW_VERSION"
git push origin "$CURRENT_BRANCH" --tags 2>&1

echo "✅ v$NEW_VERSION deployed, committed, and pushed."
