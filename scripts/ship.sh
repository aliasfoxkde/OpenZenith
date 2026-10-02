#!/usr/bin/env bash
# ship.sh — OpenZenith front-end ship gate.
#
# Commits are not deploys: this is the definition of done for user-facing
# work (see docs/planning/RELIABILITY_GAPS_2026-10-01.md #1 and
# memory/openzenith-deploy-and-prod-verify.md). Chain:
#   1. pages:build            (next-on-pages bundle into .vercel/output/static)
#   2. bundle-marker grep     (prove the new code is IN the bundle)
#   3. pages:deploy           (wrangler → Cloudflare Pages)
#   4. landing E2E vs PROD    (Playwright; the zone 403s curl — browser only)
#
# Usage:
#   scripts/ship.sh                       # full gate, default marker
#   SHIP_MARKER="oz-flip-card" scripts/ship.sh
#   SHIP_MARKER="" scripts/ship.sh        # skip the marker grep
#   E2E_BASE_URL=http://localhost:9006 scripts/ship.sh   # verify a preview instead
#
# Credentials come from wrangler's stored auth (wrangler login / CLOUDFLARE_API_TOKEN
# in the environment) — never pass tokens as arguments or commit them.
set -euo pipefail

API_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../api" && pwd)"
MARKER="${SHIP_MARKER-oz-flip-card}"   # default: current landing feature
E2E_SPEC="${E2E_SPEC-e2e/landing.spec.ts}"
E2E_WORKERS="${E2E_WORKERS-2}"

cd "$API_DIR"

echo "== [1/4] pages:build =="
npm run pages:build

STATIC=".vercel/output/static"
if [ -n "$MARKER" ]; then
  echo "== [2/4] bundle marker: $MARKER =="
  # Minified chunk dirs, not file names — class strings survive minification.
  if ! grep -rl "$MARKER" "$STATIC/_next/static/chunks/" >/dev/null 2>&1; then
    echo "FAIL: marker '$MARKER' not in bundle — stale build? Aborting before deploy." >&2
    exit 1
  fi
  echo "marker present in: $(grep -rl "$MARKER" "$STATIC/_next/static/chunks/" | head -3 | tr '\n' ' ')"
else
  echo "== [2/4] bundle marker: SKIPPED (SHIP_MARKER empty) =="
fi

echo "== [3/4] pages:deploy =="
npm run pages:deploy

echo "== [4/4] E2E vs ${E2E_BASE_URL:-https://openzenith.cyopsys.com} =="
LOG="$(mktemp /tmp/oz-ship-e2e.XXXXXX.log)"
# Piped playwright buffers until exit — always redirect to a file and poll it.
if npx playwright test "$E2E_SPEC" --workers="$E2E_WORKERS" >"$LOG" 2>&1; then
  tail -6 "$LOG"
  echo "SHIP OK: deployed and verified on ${E2E_BASE_URL:-prod}."
else
  status=$?
  tail -40 "$LOG"
  echo "SHIP FAILED at E2E (exit $status). The deploy already happened — verify or roll back." >&2
  exit "$status"
fi
