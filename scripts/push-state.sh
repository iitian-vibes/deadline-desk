#!/usr/bin/env bash
# Push state/ + reports/ from a local watcher pass to the watcher-state branch through a
# throwaway worktree (never switches the branch you are working on), then open the issue
# if the local report found something. Mirrors the CI steps.
#   node scripts/watch.mjs --local && scripts/push-state.sh
set -euo pipefail
cd "$(dirname "$0")/.."
DATE="$(date -u +%F)"
REPORT="reports/${DATE}-local.md"
WT="$(mktemp -d)/watcher-state"
git fetch -q origin watcher-state
git worktree add -q "$WT" origin/watcher-state
cp -R state/. "$WT/state/"
mkdir -p "$WT/reports" && cp -R reports/. "$WT/reports/"
pushd "$WT" >/dev/null
git add -f state/ reports/
if git commit -q -m "watcher (local): ${DATE}"; then git push -q origin HEAD:watcher-state; echo "pushed ${DATE} local pass to watcher-state"; else echo "nothing to push"; fi
popd >/dev/null
git worktree remove --force "$WT"
if [ -f "$REPORT" ] && grep -q "NEW__" "$REPORT"; then
  gh issue create --title "Opened/changed (local pass): $(grep -c 'NEW__' "$REPORT") source(s) — ${DATE}" --body-file "$REPORT" --label watcher
fi
