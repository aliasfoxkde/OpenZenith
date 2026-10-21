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
# Findings whose pattern appears in docs/security/aegis-profile.json
# ("disabled_patterns") are suppressed by the gate itself — aegis always
# scans at full strength; the repo-level denylist keeps its documented,
# reviewed false-positive classes out of the baseline-diff arithmetic.
# The interactive `aegis` binary is untouched, so other projects keep
# their own policy.
#
# Scopes are explicit (never repo root) so 65GB under data/ is never crawled.
#
# Paths in findings/fingerprints are REPO-RELATIVE: aegis echoes the scope
# path it is given, so the gate always passes relative scopes from the repo
# root. The baseline therefore works from any checkout path — the CI runner
# (workspace mounted at /workspace in the job container) and this dev host
# produce identical fingerprints (2026-10-06; before this the baseline was
# absolute-path-bound to the development checkout).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BASELINE="$REPO_ROOT/docs/security/aegis-baseline.json"
PROFILE="$REPO_ROOT/docs/security/aegis-profile.json"
SCOPES=(api/src openzenith core/src core/tests scripts)

cd "$REPO_ROOT"

# Preflight: the `aegis` on PATH must be the SECURITY SCANNER, not the
# unrelated `aegis-cli` PyPI package (whose console script is also named
# `aegis` and which installs to the same ~/.local/bin). The two have
# incompatible CLIs — the scanner has a `scan` subcommand and a top-level
# `--format` flag; the starter-file generator has neither. A wrong binary
# otherwise fails with a bare "No such option: --format", which reads like a
# scanner bug rather than a shadowed PATH entry.
AEGIS_BIN="${AEGIS_BIN:-aegis}"
if ! "$AEGIS_BIN" scan --help >/dev/null 2>&1; then
    cat >&2 <<EOF
error: '$AEGIS_BIN' is not the aegis security scanner.

  The scanner is the one with a 'scan' subcommand and a top-level '--format'
  flag. A different tool (the 'aegis-cli' PyPI package, which installs a
  console script of the same name) will fail here with "No such option:
  --format" and looks like a scanner defect.

  Point AEGIS_BIN at the real scanner, or run the gate inside the image the
  CI job uses, which carries it (the tag is the one the .gitforge.yml aegis
  job runs; the registry prefix is documented in that file's header):
      docker run --rm -v "\$PWD":/workspace:z -w /workspace \\
        openzenith-ci-aegis:1 ./scripts/aegis_scan.sh
EOF
    exit 2
fi

# Load a findings array from a aegis JSON output file, dropping every
# finding whose pattern is on the repo denylist. Used by both modes.
filter_findings() {
    python3 - "$1" "$PROFILE" <<'PY'
import json, sys
doc = json.load(open(sys.argv[1]))
# Accept both the aegis output document and a bare findings array.
findings = doc["findings"] if isinstance(doc, dict) else doc
deny = set(json.load(open(sys.argv[2])).get("disabled_patterns", []))
kept = [f for f in findings if f["pattern"] not in deny]
out = {"findings": kept} if isinstance(doc, dict) else kept
json.dump(out, open(sys.argv[1], "w"), indent=2)
print(len(kept))
PY
}

# A finding's aegis fingerprint is `pattern:file:line:content-hash`. The
# LINE component makes the identity positional: any unrelated edit that shifts
# a flagged line re-flags already-triaged code, so the gate reports churn
# instead of signal (2026-10-21: 65 of 65 reported findings were pure
# line-shifts of baseline entries — the same pattern, file and content hash,
# moved by one or two lines after unrelated commits).
#
# Line-shift tolerance: a finding counts as NEW only when its
# (pattern, file, content-hash) triple is absent from the baseline. The
# content hash is the security-relevant identity — it changes if and only if
# the flagged code changes. This keeps the gate strict for new code (a fresh
# `any`, a fresh innerHTML sink, a fresh SSRF-shaped URL) while making an
# unrelated refactor elsewhere in the file invisible to it.
#
# Path stays in the key: the same code moved to a different file is a new
# finding, because that is a new place to review it.
shift_tolerance() {
    python3 - "$1" "$BASELINE" <<'PY'
import json, sys

def split_fp(fp):
    """pattern:file:line:hash -> (pattern, file, hash). The file may itself
    contain ':' only on exotic paths; the last two fields are line and hash."""
    parts = fp.rsplit(":", 2)
    if len(parts) != 3:
        return None
    head, line, digest = parts
    pat, _, fil = head.rpartition(":")
    return pat, fil, digest

doc = json.load(open(sys.argv[1]))
findings = doc["findings"] if isinstance(doc, dict) else doc
baseline = json.load(open(sys.argv[2]))["findings"]

known = set()
for b in baseline:
    parts = split_fp(b.get("fingerprint", ""))
    if parts:
        known.add(parts)

new, shifted = [], []
for f in findings:
    parts = split_fp(f.get("fingerprint", ""))
    if parts and parts in known:
        shifted.append(f)
    else:
        new.append(f)

out = {"findings": new} if isinstance(doc, dict) else new
json.dump(out, open(sys.argv[1], "w"), indent=2)
print(f"{len(new)} new, {len(shifted)} line-shifted (already triaged)")
PY
}

if [[ "${1:-check}" == "update" ]]; then
    mkdir -p "$(dirname "$BASELINE")"
    tmp="$(mktemp)"
    trap 'rm -f "$tmp"' EXIT
    python3 - "$BASELINE" "$tmp" "${SCOPES[@]}" <<'PY'
import json, sys, os
out_path, tmp_path, *scopes = sys.argv[1:]
merged = []
for scope in scopes:
    import subprocess
    proc = subprocess.run(
        [os.environ.get("AEGIS_BIN", "aegis"), "--format", "json", "scan", scope, "--output-file", tmp_path, "-q"],
        capture_output=True, text=True)
    if proc.returncode not in (0, 1):  # 1 = findings present (expected)
        sys.exit(f"aegis scan failed for {scope}: {proc.stderr}")
    with open(tmp_path) as fh:
        merged.extend(json.load(fh)["findings"])
with open(out_path, "w") as fh:
    json.dump({"findings": merged}, fh, indent=2)
    fh.write("\n")
print(f"raw findings: {len(merged)}")
PY
    # Apply the repo denylist to the freshly written baseline in place.
    count="$(filter_findings "$BASELINE")"
    echo "baseline written: $count findings (after profile filter) -> $BASELINE"
    exit 0
fi

if [[ ! -f "$BASELINE" ]]; then
    echo "missing baseline: $BASELINE (run scripts/aegis_scan.sh update after triage)" >&2
    exit 2
fi

tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT
new_total=0
shift_total=0
for scope in "${SCOPES[@]}"; do
    # Aegis exits 0 for a clean scan and 1 when findings survive the baseline
    # filter; anything else is a tool failure and must abort the gate.
    # ($? must be captured outside `if !` — the negation clobbers it.)
    set +e
    "$AEGIS_BIN" --format json scan "$scope" \
        --baseline "$BASELINE" --output-file "$tmp" -q >/dev/null
    rc=$?
    set -e
    if (( rc != 0 && rc != 1 )); then
        echo "aegis failed on $scope (rc=$rc)" >&2
        exit "$rc"
    fi
    # Denylisted patterns are policy-suppressed, not "new findings".
    filter_findings "$tmp" > /dev/null
    # Line-shift tolerance: findings whose (pattern, file, content-hash) is
    # already in the baseline are the SAME reviewed code at a moved line —
    # not new findings. Genuinely new content still fails the gate.
    shift_line="$(shift_tolerance "$tmp")"
    count="$(echo "$shift_line" | awk '{print $1}')"
    shifted="$(echo "$shift_line" | awk '{print $3}')"
    shift_total=$((shift_total + ${shifted:-0}))
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
if (( shift_total > 0 )); then
    echo "aegis: ${shift_total} line-shifted finding(s) matched the baseline by content hash (not new)."
fi
echo "aegis gate passed: no new findings across ${#SCOPES[@]} scopes."
