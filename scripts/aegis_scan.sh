#!/usr/bin/env bash
# Aegis security/pattern gate for OpenZenith.
#
# Modes:
#   scripts/aegis_scan.sh           — scan source trees against the committed
#                                     baseline; exit non-zero on NEW findings
#                                     only (existing, triaged findings stay in
#                                     docs/security/aegis-baseline.json).
#   scripts/aegis_scan.sh update    — regenerate the baseline. Only run this
#                                     AFTER triaging the diff; see
#                                     docs/security/TRIAGE.md for the policy.
#
# Scopes are explicit (never repo root) so 65GB under data/ is never crawled.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BASELINE="$REPO_ROOT/docs/security/aegis-baseline.json"
SCOPES=(api/src openzenith core/src core/tests scripts)

if [[ "${1:-check}" == "update" ]]; then
    mkdir -p "$(dirname "$BASELINE")"
    tmp="$(mktemp)"
    python3 - "$BASELINE" "$tmp" "${SCOPES[@]/#/$REPO_ROOT/}" <<'PY'
import json, sys
out_path, tmp_path, *scopes = sys.argv[1:]
merged = []
for scope in scopes:
    import subprocess
    proc = subprocess.run(
        ["aegis", "--format", "json", "scan", scope, "--output-file", tmp_path, "-q"],
        capture_output=True, text=True)
    if proc.returncode not in (0, 1):  # 1 = findings present (expected)
        sys.exit(f"aegis scan failed for {scope}: {proc.stderr}")
    with open(tmp_path) as fh:
        merged.extend(json.load(fh)["findings"])
with open(out_path, "w") as fh:
    json.dump({"findings": merged}, fh, indent=2)
    fh.write("\n")
print(f"baseline written: {len(merged)} findings -> {out_path}")
PY
    exit 0
fi

if [[ ! -f "$BASELINE" ]]; then
    echo "missing baseline: $BASELINE (run scripts/aegis_scan.sh update after triage)" >&2
    exit 2
fi

tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT
new_total=0
for scope in "${SCOPES[@]}"; do
    # Aegis exits 0 for a clean scan and 1 when findings survive the baseline
    # filter; anything else is a tool failure and must abort the gate.
    # ($? must be captured outside `if !` — the negation clobbers it.)
    set +e
    aegis --format json scan "$REPO_ROOT/$scope" \
        --baseline "$BASELINE" --output-file "$tmp" -q >/dev/null
    rc=$?
    set -e
    if (( rc != 0 && rc != 1 )); then
        echo "aegis failed on $scope (rc=$rc)" >&2
        exit "$rc"
    fi
    count="$(python3 -c "import json;print(len(json.load(open('$tmp'))['findings']))")"
    if (( count > 0 )); then
        echo "NEW findings in $scope: $count"
        python3 - "$tmp" <<'PY'
import json, sys
for f in json.load(open(sys.argv[1]))["findings"]:
    loc = f["location"]
    print(f"  [{f['severity']}] {f['pattern']} {loc['file']}:{loc['line']} — {f['description']}")
PY
        new_total=$((new_total + count))
    fi
done

if (( new_total > 0 )); then
    echo "aegis gate FAILED: $new_total new finding(s). Triage them, then update" \
         "docs/security/aegis-baseline.json deliberately (see docs/security/TRIAGE.md)." >&2
    exit 1
fi
echo "aegis gate passed: no new findings across ${#SCOPES[@]} scopes."
