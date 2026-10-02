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
2026-10-01). **Hardening shipped:** `scripts/ship.sh` chains
pages:build → bundle-marker grep (default `oz-flip-card`, override via
`SHIP_MARKER`) → pages:deploy → landing E2E vs prod.

### 2. No CI anywhere — pipeline authored; activation needs user auth
`.gitforge.yml` committed (2026-10-01): linear chain
install → typecheck → lint (4,111-warning baseline hold) → spec-check →
unit-test (vitest with in-command retry + 99-file/1,419-test completeness
guard). Schema and host constraints derived from
`GitForge crates/gitforge-ci/src/pipeline.rs` + the two running sibling
pipelines (StationAware, kubix). The CI service reads the file from the
pushed commit (no CLI registration). **Remaining (user-gated):** a
verified `gitforge auth --login`, then watch the first push-triggered run
on :42781. E2E/deploy/aegis/cargo/pytest deliberately stay local gates
(see the header of `.gitforge.yml` for why).

## P1 — Product correctness

### 3. Fallible API routes without try/catch — RETRACTED (false positive)
The original grep (routes lacking `try {`) flagged 35 of 80 routes.
Full audit (2026-10-01): every route without try/catch awaits only
Next's `params` promise — zero of them fetch upstream or touch storage;
all I/O-bearing routes (dem-tile, elevation, geocode, proxy family)
already wrap handlers. The heuristic matched static metadata routes.
No code change needed; the error contract is consistent.

### 4. E2E hydration-race fragility on the heavy landing page
The landing (hero map + particles + flip cards) hydrates late; pre-
hydration interactions are dropped. New address-search test carries a
re-fill guard; `shows error for invalid coordinates` and
`performs elevation lookup` each needed retries under box load. **Next:**
apply the same guard or a hydration marker wait across landing.spec.ts.

## P2 — Debt and modernization (tracked, not urgent)

### 5. Route-layer lint debt — SLICE 2 SHIPPED (4,111 → 3,744)
eslint 4,111 warnings / 0 errors after #155 slice 1. **2026-10-01 slice:**
the three largest `__tests__` files typed via the established body-reader
pattern — terrain-routes (211), collections-deep (81), query (75) = 367
warnings retired, all four files graduated to `error` in
eslint.config.mjs so they cannot regress. Shared `bodyAs<T>()` reader
added to `__tests__/helpers.ts`. Remaining residue is `src/app/`
(globe/map pages and layers: 2,858) — the Cesium/MapLibre boundary
typing from the #155 pattern, plus 101 in lib/components.

### 6. Next.js 16 / OpenNext Cloudflare migration (decision pending, user)
`@cloudflare/next-on-pages` is archived/deprecated and caps next at
≤15.5.2 (app runs 15.5.26 via legacy-peer-deps). Full plan and staged
phases in `docs/planning/NEXTJS16_OPENNEXT_MIGRATION.md`. Side benefit:
clears the 5 npm-audit dev-only findings (miniflare transitive).

### 7. SDK test suite "cannot run" — RETRACTED (box-load artifact)
The hangs (pytest startup/collection ≥2 min) were CPU starvation from the
co-tenant llama-server, not a pytest/plugin/package defect. Bounded
re-test (2026-10-01, quiet-ish box): plugin bisect clean with and without
autoload; full `openzenith/tests/` collection = 1,493 tests in 2.07s.
**Result:** the suite was never broken. One real nit found en route:
`pyproject.toml` addopts hard-requires pytest-cov (unloaded plugins make
pytest exit on unknown args — fast, not hung).

### 8. Rust core tests ungated — RESOLVED (verified green)
`cargo test` in core/ (2026-10-01): **26 unit tests + 25 further tests,
all passing, 0 failed.** No workflow runs them; they are cheap (<1s
compute after build) and a candidate to add to CI once a rust image is
pre-pulled on the runner host.

### 9. Dependency-audit surface — audited; one fix shipped
Three real npm trees: repo root (scripts-only, no deps, no lockfile —
zero audit surface), mcp-server/ (2 deps), api/ (the known 5, all
miniflare-transitive dev-only, cleared by the Next16 migration — user
decision #6). **Fixed 2026-10-01:** mcp-server vitest 3.2.7 → 5.0.3
(clears GHSA-82fw-gwwq-j7x9 path traversal; 16/16 tests green; tree now
0 vulnerabilities). Dependabot's 11 likely counted these dev-only
findings; recheck its dashboard after the vitest bump propagates.

### 10. Repo-root scratch accumulation — TRIMMED
Trash-moved (never rm) to `/nas/Temp/tmp/oz-trash/` on 2026-10-01:
`ozt2/` (stale tiles), `output/` (4.7MB playwright debug PNGs), `temp/`
(empty), `.build-tmp/`, `.tmp-test/`, tonight's `elevation.geojson` +
`contours_100.0m.geojson` pytest artifacts, `api/.smoke-persist-119/120`
(workerd persists), `api/test-results/`. `.pkgprobe/` was already
relocated by an earlier pass. Also removed the tracked-but-dead
`.gitforce.yml` (pre-rename pipeline spelling, map-style jobs the current
parser rejects, superseded by `.gitforge.yml` which wins resolution
order). Co-tenant live artifacts left alone.

## Verification facts (2026-10-01)
- Prod serves the flip-card landing + fixed banner search (Playwright
  against https://openzenith.cyopsys.com; curl is 403-challenged zone-wide).
- `address search zooms to a picked place` E2E: PASS 7.4s on prod.
- HEAD 6bff1fb pushed to gitforge and origin.
