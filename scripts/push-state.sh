#!/usr/bin/env bash
# Push state/ + reports/ from a local watcher pass to the watcher-state branch,
# and open the issue if the local report found something. Mirrors the CI steps.
#   node scripts/watch.mjs --local && scripts/push-state.sh
set -euo pipefail
cd "$(dirname "$0")/.."
DATE="$(date -u +%F)"
REPORT="reports/${DATE}-local.md"
git stash push -q -m "local-watch" -- state reports 2>/dev/null || true
git fetch -q origin watcher-state
git checkout -q -B watcher-state origin/watcher-state
git checkout -q stash@{0} -- state reports 2>/dev/null || true
git stash drop -q 2>/dev/null || true
git add -f state/ reports/
git commit -q -m "watcher (local): ${DATE}" || { echo "nothing to push"; git checkout -q main; exit 0; }
git push -q origin watcher-state
git checkout -q main
if [ -f "$REPORT" ] && grep -q "NEW__" "$REPORT"; then
  gh issue create --title "Opened/changed (local pass): $(grep -c 'NEW__' "$REPORT") source(s) — ${DATE}" --body-file "$REPORT" --label watcher
fi
echo "pushed ${DATE} local pass to watcher-state"
