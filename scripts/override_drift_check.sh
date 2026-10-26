#!/usr/bin/env bash
# Cycle-open drift check for npm security overrides (plan IX C-4).
#
# Verifies two things every cycle:
#  1. npm audit reports 0 vulnerabilities under the current override set.
#  2. Every resolved instance of each override target in the installed
#     tree satisfies the override's range — an override that silently
#     stopped applying (e.g. after a dep restructure) is a false pass.
#
# Usage: scripts/override_drift_check.sh
set -euo pipefail

repo=$(cd "$(dirname "$0")/.." && pwd)
cd "$repo/api"

fail=0

echo "== npm audit =="
audit_out=$(npm audit 2>&1) || fail=1
echo "$audit_out" | tail -3
if [[ $fail -ne 0 ]]; then
  echo "FAIL: npm audit reports vulnerabilities (or errored). Overrides may need a bump." >&2
  exit 1
fi

echo
echo "== override applicability =="
# name + ranges for each override target. A package may carry several
# declared ranges (tree-level ^7.30.1 AND nested-in-miniflare ^6.28.1);
# npm dedupes resolved paths, so nesting isn't recoverable from paths.
# Rule: every tree instance must satisfy at least one declared range.
pairs=$(node -e '
  const p = require(process.cwd() + "/package.json");
  const m = new Map();
  const walk = (o) => {
    for (const [k, v] of Object.entries(o ?? {})) {
      if (typeof v === "string") {
        if (!m.has(k)) m.set(k, []);
        m.get(k).push(v);
      } else walk(v);
    }
  };
  walk(p.overrides);
  for (const [k, ranges] of m) console.log(k + "\t" + ranges.join("\t"));
')

while IFS=$'\t' read -r pkg ranges; do
  # --parseable emits "<path>:name@version[:INVALID]"; keep INVALID rows too.
  got=$(npm ls "$pkg" --all --parseable --long 2>/dev/null | grep "[:/]$pkg@" | sort -u || true)
  if [[ -z "$got" ]]; then
    echo "WARN: override target '$pkg (${ranges//$'\t'/, })' not present in tree (override may be dead)"
    continue
  fi
  ok=1
  while IFS= read -r inst; do
    # "path:name@ver" or "path:name@ver:INVALID"; also matches bare "name@ver"
    inst="${inst##*:}"
    ver="${inst#"$pkg"@}"
    ver="${ver%%:*}"
    if [[ "$inst" == *INVALID ]]; then
      # INVALID here means a parent's own declared range is violated by the
      # override we imposed — expected when forcing e.g. undici ^7.30.1 into
      # wrangler's miniflare (which declares ^6.28.1). The audit-clean pass
      # is the security gate; this note is for awareness.
      echo "NOTE: $pkg@$ver conflicts with its parent's declared range (override-imposed; verify intentional)"
      continue
    fi
    sat=0
    IFS=$'\t' read -ra range_arr <<< "$ranges"
    for range in "${range_arr[@]}"; do
      if npx --yes semver -r "$range" "$ver" >/dev/null 2>&1; then sat=1; break; fi
    done
    if [[ $sat -ne 1 ]]; then
      echo "FAIL: $pkg@$ver in tree satisfies NONE of the override ranges (${ranges//$'\t'/, }) — override stopped applying"
      ok=0; fail=1
    fi
  done <<< "$got"
  [[ $ok -eq 1 ]] && echo "OK: $pkg — all tree instances satisfy a declared override range"
done <<< "$pairs"

echo
if [[ $fail -eq 0 ]]; then
  echo "PASS: audit clean, all overrides applying"
else
  echo "FAIL: drift detected — see lines above" >&2
  exit 1
fi
