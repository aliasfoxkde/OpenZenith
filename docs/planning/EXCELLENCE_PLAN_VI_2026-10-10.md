# Excellence plan VI — 2026-10-10

Cycle VI of the excellence series (V closed 2026-10-09 as v0.9.3; see
[EXCELLENCE_PLAN_V_2026-10-08.md](EXCELLENCE_PLAN_V_2026-10-08.md)).
Seeded by a fresh gap sweep on the morning after the v0.9.3 cut, not by
re-running cycle V's checklist. Tasks #240+ in the session task list.

## Baseline at plan time

v0.9.3 (13d8a23, closeout 11334cd) — tree clean, both remotes synced.
Gates of record (2026-10-09 receipts): eslint 0w/0e; tsc clean with
`noUncheckedIndexedAccess`; vitest 1,704+5 / 115 files at 99.46/97.26/
95.21/99.92 (floors 99/96/94/99); pytest 1,650 @ 99%; mypy strict +
interrogate 100%; clippy + two-pass core gate green; aegis green against
the 95c69e3 baseline; jscpd 4.19% lines; chromium prod E2E 97/97; ship
26/26 both browsers; GitForge runs ef7c9dae + cc9d958c 8/8.

## Gap register (sweep receipts 2026-10-10)

| # | Gap | Evidence at sweep time | Phase |
|---|-----|------------------------|-------|
| G1 | **mcp-server PRODUCTION high CVE**: `@modelcontextprotocol/sdk` 1.30.0 is in [GHSA-6qxp-vccf-f47h](https://github.com/advisories/GHSA-6qxp-vccf-f47h) (1.12.0–1.30.1: OAuth client could send credentials to an attacker-chosen authorization server). `npm audit --omit=dev` = 1 high; fix = 1.32.1 | npm audit, mcp-server/ | A1 |
| G2 | api/ dev-path audit grew 5 → **11 findings** (2 moderate, 9 high): `undici` <6.28.1 chain under `miniflare` (via `@cloudflare/next-on-pages`), `braces` ≤3.0.3 under `fast-glob`/`micromatch` (via `@next/eslint-plugin-next`), `esbuild` ≤0.24.2 (via next-on-pages). All dev-only (`--omit=dev` = 0) but the undici chain is overrideable | npm audit, api/ | A2 |
| G3 | `pip-audit` is **not installed on this host** (CI-only coverage since the last env changed); the claim "pip_audit clean" is currently unverifiable locally | `python3 -m pip_audit` → No module named | A4 |
| G4 | react/react-dom 19.2.8 → 19.3.0 available (minor, `Wanted`); next stays 15.5.27 (16.x = user-gated migration) | npm outdated, api/ | A3 |
| G5 | mcp-server wanted bumps: typescript-eslint 8.71.1, @types/node 22.20.5 (patch) | npm outdated, mcp-server/ | A1 |
| G6 | **No SECURITY.md** — a public repo with 81 API routes and no security policy/reporting channel | ls | B1 |
| G7 | **No dependabot.yml** — GitHub is the mirror, but the mirror still surfaces outdated-dependency PRs for free; config is cheap and marked non-authoritative like the workflows | ls | B2 |
| G8 | Perf P2 items **11–15 all still open** (verified against current code): theme flash (17 `dark ?` branches in `src/app/page.tsx`), globe chunk split, main-thread OZT2 decode + SGP4, Cesium quality/cost knobs absent (`requestRenderMode: true` only), 16-bit icon PNGs + dead 580px hero rule (now at globals.css:109) | grep receipts in PERFORMANCE_PLAN_2026-10-02.md P2 | C |
| G9 | jscpd residual clones named at cycle-V close: profile↔trace tile-window math (19L), hydro-trio `assembleTerrainGrid` opener (11–18L), GeoJSON response shaping (12L) | cycle V progress log | D |
| G10 | Quiet-host perf re-measure still owed (`/proc/loadavg` < 12 gate); sweep-time load 33 | loadavg | E (conditional) |
| G11 | Next16/OpenNext migration — **user-gated**, unchanged; out of scope | NEXTJS16_OPENNEXT_MIGRATION.md | — (stays gated) |

Rejected from scope: CODEOWNERS (solo maintainer — the file would name one
person and rot); dependabot *auto-merge* (gates run on GitForge; mirror PRs
are advisory); publishing the SDK to PyPI (user decision, docs/PUBLISHING.md
records the path).

## Phases

### Phase A — dependency security (fix the production high first)
- **A1.** mcp-server: bump `@modelcontextprotocol/sdk` ^1.12.1 → ^1.32.1
  (clears GHSA-6qxp-vccf-f47h), typescript-eslint ^8.71.1, @types/node
  ^22.20.5; `npm install --package-lock-only`-grade lockfile refresh
  (real install), typecheck + typed lint + 21 contract tests green.
  The server's own code does not do OAuth, but the advisory is
  prod-scope and the fix is semver-minor — take it, don't TRIAGE it.
- **A2.** api/: add npm `overrides` for `undici` (≥6.28.1) scoped under
  `miniflare` if `pages:build` + bundle-marker + local smoke stay green;
  record remaining dev-only findings (braces/esbuild — unpatched in the
  pinned majors) as accepted with justification in
  docs/security/TRIAGE.md. No source changes.
- **A3.** api/: react + react-dom → 19.3.0; full vitest + a11y + prod E2E
  after (React minor releases have broken hydration assumptions before —
  this repo felt it in the studio hydration flake).
- **A4.** Re-provision pip-audit (`pip install pip-audit --user`), run
  against the installed SDK, record the receipt next to the cargo-audit
  one. cargo audit re-run for the record (76 deps, was clean).

### Phase B — governance + docs truth
- **B1.** SECURITY.md at repo root: supported versions (only latest),
  where to report (GitHub private vulnerability reporting + the project
  contact), what's in scope (api surface, SDK, mcp-server, tile formats),
  and the 24h-ack/90d-fix expectation. No credentials anywhere.
- **B2.** .github/dependabot.yml: npm (api/, mcp-server/), pip (root),
  cargo (core/), github-actions — weekly, grouped minor/patch; header
  comment marking it mirror-side advisory tooling (GitForge stays the
  gate of record).
- **B3.** Docs-claims sweep of README/CLAUDE.md facts that the A-phase
  bumps touch (dependency versions quoted in docs if any).

### Phase C — performance P2 closure (items 11–15)
- **C1. (P2-11)** Theme flash: replace the 17 `dark ?` inline-style
  branches in `src/app/page.tsx` with `[data-theme]` CSS custom
  properties; `useTheme` keeps toggling `data-theme` only. Verify with
  the landing E2E + a `prefers-color-scheme: dark` Playwright probe
  (no light-styled first paint).
- **C2. (P2-12)** Globe chunk split: lazy-load the non-boot tools
  (ContextMenu, elevation-profile canvas, space-scene, widgets) behind
  `next/dynamic` like the layer modules already are; verify the
  `page-*.js` first-load delta in the perf budget and that every globe
  E2E still passes (tools must hydrate on first use, not on import).
- **C3. (P2-13)** Move OZT2 decode (and satellite SGP4 propagation if it
  profiles hot) off the main thread through `lib/worker-utils.ts`;
  the wasm-demo decode path is browser-WASM and stays where it is.
  Verify terrain renders identically and the long-task count drops in
  the CDP harness.
- **C4. (P2-14)** Cesium cost knobs: set
  `maximumScreenSpaceError`/`tileCacheSize`/`resolutionScale` to
  measured defaults in `cesium-init.ts` (not user-facing yet — Settings
  widget stays a later idea). Receipt = frame-budget note in the perf
  log, not vibes.
- **C5. (P2-15)** Re-encode the three icon PNGs to 8-bit; delete the
  dead 580px hero rule (globals.css:109; inline 660px wins).
  `npm run build` + visual check on the landing icons.
- Perf budget gate re-run; deploy slices through ship.sh when the phase
  is green (commits are not deploys).

### Phase D — duplication residuals
- **D1.** profile↔trace tile-window math (~19L) → shared helper in the
  terrain-sampler kernel's module.
- **D2.** hydro-trio `assembleTerrainGrid` destructure opener (11–18L)
  → shared prologue helper (extends `hydro-params.ts`).
- **D3.** GeoJSON response shaping (~12L) → shared response builder if
  the third site confirms it is a true clone (cycle V counted 12L).
- Re-census with `npx jscpd`; stop when the named clusters are gone and
  the census is ≤ 4.19%, or record why a candidate was a false positive.

### Phase E — receipts + CI validation
- **E1.** Full gate sweep: eslint 0w/0e, tsc, vitest (update the
  unit-test count guard in .gitforge.yml if the suite grows), pytest +
  ruff + mypy + interrogate, clippy + core two-pass gate, aegis
  (TRIAGE + re-baseline on line drift per policy), jscpd census,
  Playwright local, docs-claims.
- **E2.** GitForge pipeline green on the final commit (mint JWT →
  pipeline --create bigdata-ci/OpenZenith --file .gitforge.yml →
  pipeline --run → --watch; the per-push ghost-id dance is documented).
- **E3.** Quiet-host perf re-measure attempt (G10): only if
  `/proc/loadavg` < 12 at that moment; otherwise record "still gated"
  with the observed load — no fake numbers.

### Phase F — release v0.9.4 + deploy + closeout
- **F1.** Version bump at all six sync points (api/package.json,
  openzenith/__init__.py, mcp-server/package.json AND
  mcp-server/src/index.ts serverInfo, package-locks, openapi regen +
  base.json); CHANGELOG entry; HANDOFF closeout block; plan progress
  log.
- **F2.** Annotated tag v0.9.4, push gitforge then origin, ls-remote
  verify both; GitHub release with the CHANGELOG text; ship.sh deploy;
  prod verify /api/health + /api/openapi.json report 0.9.4; release
  commit's GitForge run green.
- **F3.** Memory updates (gate baselines, any new environment facts).

## Progress log

- 2026-10-10: plan written from the sweep receipts above. Phases A–F
  open.
- 2026-10-10 (A): A1 mcp-server MCP-SDK 1.13.0→1.32.1 (prod-high
  GHSA fix) + patch bumps, locks regenerated, suite green. A2 undici
  override (dev-only chain) + TRIAGE entry. A3 react/react-dom
  19.2.x→19.3.0 minor bump — regression arm is the CI unit-test job.
  A4 pip-audit re-provisioned; python/cargo audit receipts clean.
- 2026-10-10 (B): SECURITY.md policy added (supported versions,
  reporting path); dependabot.yml for the mirror; docs-claims sweep
  over the bump-affected claims.
- 2026-10-10 (C): C1 landing theme flash — `data-theme` custom
  properties, pre-paint, prefers-color-scheme probe rides ship.sh.
  C2 globe chunk split — lazy non-boot tools, bundle-budget job now
  verifies the delta. C3 premise-corrected: OZT2 decode measured
  1-2 ms/tile async (not a long-task source; deferral recorded in
  PERFORMANCE_PLAN P2-13) — real target was SGP4: ~6,050 synchronous
  propagations per load + 1,500 per refresh moved into an inline Blob
  worker via `importScripts("/vendor/satellite.min.js")`
  (`propagateCatalogueInWorker`), main-thread fallback kept, 9 tests.
  C4 explicit Cesium knobs (maximumScreenSpaceError 2, tileCacheSize
  512 MB) with measured-default rationale; resolutionScale evaluated
  out. C5 icons re-encoded 8-bit (76.5→18.6 KB, RMSE 0.05%); dead
  hero CSS block removed after per-declaration shadowing check.
  Also fixed en route: CI unit-test retry was dead under `set -e`
  (first vitest failure would abort before `code=$?` and lose the
  log with the container) — `|| code=$?` form + count guard.
- 2026-10-10 (D): D1 `tileWindowBounds` extracted from profile/trace
  (19L ×2, verbatim statement order; 6 tests). D2 `openHydroGrid`
  opener over the hydro trio (~27L ×3; 7 tests; hostile-DEM 502
  fixtures preserved by calling it inside each route's try).
  D3 premise-corrected: the "GeoJSON response shaping" cluster was
  actually the 502 catch tail — `errorResponse` extracted, 11 routes
  rewired; `/api/elevation`'s different error contract and the studio
  parser's message interpolation recorded as not-clones. jscpd census
  4.19% → 4.09% (config run from repo root); named clusters gone.
  Aegis: 40 line-drift re-flags triaged, baseline 2,039 → 2,041;
  guard 115/1718 → 117/1731.
- 2026-10-10 (E): gate receipts under the new execution policy (CI on
  fedora, swarmone hosts only cheap static checks). GitForge run
  66738487 (a406b25) exposed a real defect on the first fedora
  unit-test exercise: the container-local materialization (b0473fe)
  packs only `api/` into /build, while docs-claims.test.ts reads
  repo-root README.md/CLAUDE.md — 3 arms failed "/build/README.md is
  missing", retried consistently (the set -e retry fix worked as
  designed). Fix bb756cd carries both files in api-deps.tar; run
  769febc6 green 8/8 on fedora. Local receipts: eslint 0w/0e, tsc
  clean, jscpd 4.09% census, openapi:check green. Carried from v0.9.3
  (trees byte-identical since the tag — `git diff v0.9.3..HEAD --stat`
  is empty for openzenith/ and core/): pytest 1,650 @ 99%, mypy +
  interrogate 100%, ruff clean, clippy + core two-pass gate green.
  Playwright rides ship.sh at deploy (documented non-CI gate). E3
  perf re-measure: **still gated** — /proc/loadavg 45-50 all day
  (co-tenant rustc/agent load), far above the <12 gate; no numbers
  fabricated. GitForge ops learned en route: zero-jobs strands were
  sqlite `database is locked` during job creation under co-tenant
  push storms (trigger_requests.error holds the proof) and can
  SELF-HEAL when contention subsides — wait ~15 min before re-pushing;
  dispatch under saturation is FIFO across repos, so a run waits
  behind co-tenant waves (5-slot runner).
