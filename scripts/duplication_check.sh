#!/usr/bin/env bash
# Duplication gate (plan X B-1). Floors the tree-wide jscpd duplicate-line
# ratio so regressions fail CI instead of waiting for a manual census.
#
# History: manual censuses recorded 4.40% → 4.19% → 4.09% (cycles VI–VII,
# TS/Python scope). The gate widens scope to core/src (Rust) and pins
# --min-tokens 50; first gated measurement at that scope is 4.64%, so the
# floor starts at 5.0% — below it there is headroom, above it the gate
# fails and the offending clones must be extracted or the floor moved
# deliberately (with a TRIAGE-style note in this file).
#
# Usage: scripts/duplication_check.sh [floor_percent]  (default 5.0)
set -euo pipefail

repo=$(cd "$(dirname "$0")/.." && pwd)
cd "$repo"

floor="${1:-5.0}"

out=$(npx jscpd api/src openzenith core/src \
  --min-tokens 50 --reporters consoleFull \
  --format "typescript,python,rust" --silent 2>&1) || true

pct=$(echo "$out" | grep -oE '[0-9.]+%\) duplicated lines' | grep -oE '^[0-9.]+')
if [[ -z "$pct" ]]; then
  echo "FAIL: could not parse jscpd output" >&2
  echo "$out" | tail -5 >&2
  exit 1
fi

echo "jscpd: ${pct}% duplicated lines (floor ${floor}%)"
if awk -v p="$pct" -v f="$floor" 'BEGIN{exit !(p <= f)}'; then
  echo "PASS: duplication within floor"
else
  echo "FAIL: duplication ${pct}% exceeds floor ${floor}% — extract the new clones or move the floor deliberately" >&2
  exit 1
fi
