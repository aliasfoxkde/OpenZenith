# Reliability Gap Analysis — 2026-10-01

Systematic audit of gaps, improvement areas, and the next work queue.
Findings are evidence-backed (commands/greps noted); priorities assume the
/ goal of reliability and cleanup.

## P0 — Process gaps (root cause of user-visible misses)

### 1. "Done" ends at commit; nothing deploys or verifies prod
The landing flip cards (789793b, Sep 29), banner fixes (4ca38bb, a41a20f),
and the trim pass (9554bb1, Sep 30) all shipped to git but the deployed
bundle was from Sep 27 — the user saw none of it. Second recurrence of the
a11y stale-bundle incident. **Fix adopted:** deploy + prod E2E is the
definition of done for user-facing work (see
`memory/openzenith-deploy-and-prod-verify.md` and the MASTER_PLAN entry of
2026-10-01). **Candidate hardening:** a `scripts/ship.sh` that chains
pages:build → bundle-marker grep → pages:deploy → landing E2E vs prod.

### 2. No CI anywhere
No GitHub Actions (account billing-blocked — red runs are noise), no
GitForge pipeline config in the repo, no gate script in `scripts/`. Every
gate (tsc, eslint, aegis, vitest) runs only when an agent remembers to.
GitForge is the designated CI/CD platform and its orchestrator exists
(:42781); what's missing is (a) the repo pipeline definition and (b) a
verified `gitforge auth --login` (user-gated). **Next:** author the
pipeline config against the GitForge pipeline format (docs in
/nas/Temp/repos/GitForge/docs/), verify on the user's auth.

## P1 — Product correctness

### 3. Fallible API routes without try/catch
4 confirmed of 80 routes do awaited I/O with no error handling:
`api/gebco-tile/[name]`, `api/collections/[id]`, `api/tiles/[tileMatrixSetId]`,
`api/stac/[...path]` (awaits params → HF/GEBCO/tile assembly). An upstream
throw escapes as a framework 500, breaking the JSON/CORS error contract.
3 more flagged by grep were false positives (static responses:
geoip, pmtiles, tiles landing; coverage reads only comments). **Next:**
one batch — wrap handlers, return the standard `{ ok:false, error }` shape
with CORS headers, matching `api/geocode`'s pattern.

### 4. E2E hydration-race fragility on the heavy landing page
The landing (hero map + particles + flip cards) hydrates late; pre-
hydration interactions are dropped. New address-search test carries a
re-fill guard; `shows error for invalid coordinates` and
`performs elevation lookup` each needed retries under box load. **Next:**
apply the same guard or a hydration marker wait across landing.spec.ts.

## P2 — Debt and modernization (tracked, not urgent)

### 5. Route-layer lint debt: ~4,100 warnings (Phase D)
eslint 4,111 warnings / 0 errors after #155 slice 1; the residue is
response-model typing across ~80 routes + tests. Slice per area
(api/__tests__ first — test files carry most of it).

### 6. Next.js 16 / OpenNext Cloudflare migration (decision pending, user)
`@cloudflare/next-on-pages` is archived/deprecated and caps next at
≤15.5.2 (app runs 15.5.26 via legacy-peer-deps). Full plan and staged
phases in `docs/planning/NEXTJS16_OPENNEXT_MIGRATION.md`. Side benefit:
clears the 5 npm-audit dev-only findings (miniflare transitive).

### 7. SDK test suite cannot currently run on this host
`pytest` startup/collection hangs ≥2 min under box load (direct module
imports succeed in ≤11s, so it's pytest startup or a plugin, not the
package). Needs a quiet-box rerun to separate load from a real defect
(suspect plugin autoload). Until then the Python SDK (~30 test files) is
effectively ungated.

### 8. Rust core tests ungated
`core/` has 26 unit tests (d8 16, ozt2 5, viewshed 5) run by no workflow.

### 9. Dependency-audit surface is wider than reported
GitHub dependabot counts 11 vulns on default branch (9 moderate, 2 low)
vs `npm audit` 5 in api/ — the repo root and mcp-server/ are separate npm
trees never audited. Enumerate all package.json manifests and audit each.

### 10. Repo-root scratch accumulation
`ozt2/`, `output/`, `temp/`, `elevation.geojson`, `contours_100.0m.geojson`
at repo root; a `.coverage.SWARMONE.*` temp file appears when the co-tenant
session works here. Trim pass needed (trash-move, never rm; leave the other
session's live artifacts alone).

## Verification facts (2026-10-01)
- Prod serves the flip-card landing + fixed banner search (Playwright
  against https://openzenith.cyopsys.com; curl is 403-challenged zone-wide).
- `address search zooms to a picked place` E2E: PASS 7.4s on prod.
- HEAD 6bff1fb pushed to gitforge and origin.
