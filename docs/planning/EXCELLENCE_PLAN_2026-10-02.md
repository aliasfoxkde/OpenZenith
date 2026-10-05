# Excellence Plan — 2026-10-02 (quality, docs, coverage, hygiene)

**Mandate:** systematic repo excellence pass — honest gap analysis, phased
execution: cleanup, strictest linting, 99% test/code/docs coverage, WCAG 2.1
AAA, code smells, E2E + GitForge CI validation, Aegis scanning, release +
deploy. No placeholders, no fake data, no fake metrics: every target below is
defined so it can be *measured*, and every exclusion is justified in writing.

**Inputs:** four parallel audits (lint/type strictness, documentation
coverage, code smells & structure, a11y/E2E coverage) plus live gate runs and
a sibling-repo best-practices scan (GitForge, StationAware, kubix). Audit
evidence is cited as `file:line` where it anchors a work item.

---

## 1. Baseline (verified 2026-10-02, `main` = 36a65d8, all three remotes in sync)

| Gate | State | Source |
|---|---|---|
| eslint (api/) | **0 errors**, **3,480 warnings** after the 2026-10-03 slices: the +15 regression fixed and the whole map consumer stack (loader, global.d.ts decls, map/demo/studio pages, HeroMap) typed — 253 warnings → **0** there. Was 3,759 at audit time | `api/eslint.config.mjs:42-51`, `.gitforge.yml` lint job, live runs 2026-10-02/03 |
| tsc (api/) | clean (`strict: true` only; `noUncheckedIndexedAccess` etc. absent) | audit §2 |
| vitest (api/) | floors 97/92/89/97; coverage **counts only `src/lib/**` + `src/app/api/**`** — globe/map/landing/studio/components/hooks are outside the instrumented set entirely | `api/vitest.config.ts:16-22` |
| pytest (openzenith/) | **1,479 passed / 14 deselected, 98.82% lines** (floor 97; 171 uncovered lines stand between here and the 99% target) | `pyproject.toml:103`, live run 2026-10-02 |
| cargo (core/) | fmt OK · clippy `-D warnings` OK · **51/51 tests pass** | live run 2026-10-02 |
| aegis | baseline 1,716 in `docs/security/aegis-baseline.json`; **local-only gate — not wired into the pipeline** | `.gitforge.yml` header |
| GitForge CI | `openzenith-ci` pipeline exists; push trigger materializes it; **no run had ever executed** until this pass; CLI `--run` POST decode error (platform CLI/server mismatch, see §5 P7) | live probe 2026-10-02 |
| OpenAPI | 80/80 routes in spec, version-locked, machine-gated (`openapi:check`) | audit §5 |
| a11y | axe `wcag2a+aa+aaa+best-practice` on 8 pages, green; **canvases unlabelled, 3 pages unaudited, zero keyboard/target-size checks** | `api/e2e/a11y.spec.ts` |
| npm audit | 5 dev-only residuals (esbuild, undici via miniflare) — accepted with rationale | memory + TRIAGE |

**Honest coverage statement:** "99% coverage" today is true only of the
*instrumented* surface (`src/lib` + API routes; Python SDK; Rust core). The
frontend (React components, page shells) has no harness at all (jsdom present,
no @testing-library). This plan measures and raises the instrumented surface
to ≥99% lines and *explicitly documents* the frontend boundary rather than
claiming a repo-wide number that doesn't exist.

---

## 2. Gap register (ranked; F-IDs referenced by phases)

| ID | Finding (evidence) | Impact |
|---|---|---|
| F-1 | `no-explicit-any` is nominal: **108 inline waivers**, 183 prod type escapes, ambient `Response.json(): Promise<any>` (`api/src/global.d.ts:5-9`) | type safety decorative at fetch/Cesium/MapLibre boundaries |
| F-2 | eslint warning ceiling 3,744 codified in CI as a ratchet | no pressure toward zero |
| F-3 | **9,887 LOC parallel globe/map layer stacks**, 8 near-identical pairs; ~24 copy-pasted raster layer files (map side) with drift already present (`ndvi.ts` forked guards) | 2× work per layer; drift |
| F-4 | root `tests/` is dead (never run: `pyproject.toml:102`, `ci.yml:49` target `openzenith/tests/`) and stale-diverged from `openzenith/tests/` (223–392-line diffs) | false test surface |
| F-5 | Placeholder-stub behaviors shipped: `api/src/app/api/gps-jamming/route.ts:16` ("placeholder stub" synthetic data); `openzenith/terrain/raster.py:277` (silent `0.0` for unimplemented metric) | violates repo no-placeholder policy; zeros read as data |
| F-6 | Layer catalog maintained 3 ways (`registry.ts` 664 lines + 56-entry hand-written loader map + 28 globe files) | silent divergence |
| F-7 | 7 copy-pasted `stubFetch` test helpers (2 byte-identical) | hermeticity fixes must be applied 7× |
| F-8 | mcp-server: ungoverned island — no lint, no typecheck script, no CI job, **tracked `.next/trace` artifacts**, hardcoded prod BASE_URL | contract drift undetectable |
| F-9 | Root strays tracked with **zero references**: `Dockerfile`, `docker-compose.yml`, `examples/` (only a README with a broken import), root `package.json` (Vercel-era) | repo noise; broken snippet |
| F-10 | Docs drift: README layer count 54 (actual 62), basemaps 9 (actual 10), test counts stale, R2 shown as active (deleted 2026-09-27); `CLAUDE.md` "54 layers / `terrain.py` / Click CLI / OZT2R2Backend" all stale; ARCHITECTURE.md 12 stale refs; `.gitforce.yml` misspelling in CHANGELOG+MASTER_PLAN | agents and contributors read wrong facts |
| F-11 | docs/CLAUDE.md canonical list missing 4 active docs; false claim that all archive files carry archival headers (18/21 don't); `docs/globe/README.md` stale + uncategorised | doc index not trustworthy |
| F-12 | TS JSDoc ~65% on sampled lib surface; 28/80 route files have no header comment; Python 97.6% (6 missing); rustdoc missing 4 `pub mod` docs, no `missing_docs` lint | docs coverage target unmet |
| F-13 | A11y: `/api/docs`, `/wasm-demo`, `/not-found` unaudited; `<main>` missing on `/api/docs` + `/wasm-demo`; all map/globe/hero/studio canvases lack `role`/`aria-label` (axe blind); no keyboard-traversal, focus-appearance, or target-size checks anywhere | real AAA gaps axe cannot see |
| F-14 | ruff far from ALL-adjacent (no S/ANN/PL/PERF/RET/ARG/N/TC/ERA groups; 286 errors under current config incl. 12 commented-out-code); **mypy not configured at all** | Python strictness gap |
| F-15 | GitHub `ci.yml` **auto-deploys to prod**, contradicting `.gitforge.yml`'s documented no-auto-deploy policy; no "non-authoritative mirror" header on any workflow | policy contradiction; two deploy paths |
| F-16 | No `.github/SECURITY.md`, CONTRIBUTING, CODEOWNERS; no findings register with stable IDs; no aegis CI job (kubix pattern) | governance gaps |
| F-17 | `console.log` residue in `dem-tile` route handler; 30 `print()` sites in SDK library modules (embedded CLI `main()`s in `converter.py`/`merged.py`) | log hygiene |
| F-18 | Perf residue from 2026-10-02 pass (task #174): abort-on-teardown typed slice, quiet-host re-measure, toggle crawl | open follow-ups |

---

## 3. Phases

Ordering rationale: hygiene first (cheap, de-risks everything after), then
lint/type strictness (its fixes touch many files — do before coverage/docs so
tests and docs describe the final shape), then coverage, docs, a11y, smells,
and validation/release last. Each phase ends committed+pushed (gitforge first)
and Aegis-scanned.

### Phase 0 — Audit (complete)
F-1…F-18 recorded above; live baselines in §1.

### Phase 1 — Repository cleanup (F-4, F-9, part F-8)
1. Remove tracked dead files (each zero-reference, verified by audit):
   root `Dockerfile`, `docker-compose.yml`, `examples/` (README with broken
   `marching_squares` import is its only content), root `tests/` (stale
   ancestors of `openzenith/tests/`, never executed). `git rm` — history
   preserves them; no `rm -rf` of anything untracked-and-unneeded without
   trash-dir move.
2. Untrack `mcp-server/.next/trace*` (gitignored pattern already exists at
   `.gitignore:9`; files predate the rule) + add `.gitignore` entries for
   `.smoke-persist-*/`, `.pkgprobe/` if still absent.
3. Root `package.json`: verify no consumer (Vercel-era `vercel-build`); if
   Pages deploy path (`api/` + wrangler) is confirmed sole path, remove it and
   root `node_modules` reference in docs.
4. `scripts/__init__.py` (0 bytes) + `__pycache__`: drop if unreferenced.
5. Decide `docs/globe/README.md`: archive with header (stalest doc, refs two
   deleted files) — refresh is not worth it while globe architecture is
   documented in MASTER_PLAN + code.
6. Aegis scan after the deletion slice (expected: fewer findings, baseline
   update only if legit).

**Verify:** `git status` clean; all gates re-run green; grep proves removed
paths have no dangling references in docs/CI.

### Phase 2 — Strictest linting (F-1, F-2, F-14, part F-8)
The big lift. Slices, each independently green (tsc + eslint + vitest):
1. **Slices to zero eslint warnings** — the 3,744 are `no-unsafe-*` +
   `restrict-template-expressions` on globe/map/landing boundaries. Work
   module-family by module-family (data-fetchers → layers → widgets →
   components → routes residue), typing fetch responses at the boundary
   (kills the `global.d.ts` `Promise<any>` ambient escape last, once callers
   are typed). Budget a tsc + focused-lint fixup pass per file (established
   recipe: graduating warnings surfaces new error classes that `any` hid).
2. Promote `no-unsafe-*` to **error**; re-tune `restrict-template-expressions`
   explicitly; lower CI baseline to 0 (make it a hard zero gate).
3. tsconfig strict flags in slices: `noUncheckedIndexedAccess`,
   `noImplicitOverride`, `noFallthroughCasesInSwitch`, `noImplicitReturns`,
   `noUnusedLocals`/`noUnusedParameters`; evaluate
   `exactOptionalPropertyTypes` last (most invasive; if the blast radius is
   disproportionate, record the decision here with counts).
4. Resolve the 108 `no-explicit-any` waivers file-by-file (type it, or convert
   to a justified narrow escape with reason). Remove dead devDeps
   (`eslint-config-next`, `eslint-config-prettier`) **or** wire
   eslint-config-prettier in if prettier is a real gate (`format:check`).
5. ruff: adopt strict groups in slices with measured counts first
   (S/ANN/PL/PERF/RET/ARG/N/TC/ERA ≈ 3,000+ raw hits — triage: fix, configure
   (e.g. ANN for tests), or per-file-ignore with justification; no bulk
   noqa). Add `ERA001` (12 commented-out-code) immediately.
6. mypy: introduce `[tool.mypy]` (start `disallow_untyped_defs` on
   `openzenith/`, non-test), fix findings incrementally, wire into a gate.
7. clippy: add `clippy::pedantic` as warn→fix→deny where measured-cheap
   (core is 1,722 LOC; documented cast declines stay); add
   `missing_docs` warn + document the 4 `pub mod`s.
8. mcp-server: add eslint + `typecheck` scripts, strict tsconfig flags, its
   own lint/typecheck/test jobs in `.gitforge.yml`; untrack `.next/trace*`.
9. Update `.gitforge.yml` baselines as slices land (3744 → 0; vitest counts
   when tests are added in Phase 3).

**Verify:** eslint `-W 0` style gate (warnings=errors), tsc clean per flag,
ruff/mypy green under new config, CI green.

### Phase 3 — Coverage to ≥99% of the instrumented surface (target: lines)
1. Fresh vitest coverage run → per-file uncovered report; add **real** tests
   (route handlers, lib edge cases) until lines ≥99%, functions ≥95 within
   the existing instrumented set; no mock-only tests that assert mocks.
2. Python: coverage report → close the gap to ≥99% lines (98.8% now);
   `raster.py` metric work in F-5 may add covered code paths naturally.
3. Rust: identify the uncovered fraction (CLI main error branches expected);
   add integration tests; target ≥99%.
4. Raise the floors to match reality: vitest thresholds 99/…, pytest
   `--cov-fail-under=99`, cargo gate documented; update `.gitforge.yml`
   completeness guard counts (99 files / N tests → new truth).
5. Explicitly out-of-scope, documented: component-test harness
   (@testing-library + jsdom) for globe/map/landing React trees — a harness
   decision with its own plan; NOT silently claimed in any coverage number.

**Verify:** coverage reports in the plan's progress log; floors enforced in
config so the number cannot regress.

### Phase 4 — Documentation coverage (F-10, F-11, F-12)
Definition of "documentation coverage" for this repo (measured, not vibes):
(a) Python docstrings ≥99% of public symbols (97.6% now — 6 missing);
(b) rustdoc 100% incl. `pub mod` lines + `missing_docs` warn (Phase 2);
(c) TS JSDoc ≥95% on exported symbols of `src/lib/**` + `app/**/lib/**`
(65% sampled now — count precisely, then fill);
(d) route header docs 80/80 (52/80 now);
(e) zero stale references in active docs (12 known, list in F-10);
(f) docs index accurate with swept-date.
Work items:
1. Fix README.md + root `CLAUDE.md` + `docs/ARCHITECTURE.md` drift (counts,
   R2 removal, terrain/ packages, argparse CLI, `.gitforce.yml` spellings).
2. docs/CLAUDE.md: add the 3 unlisted planning docs, resolve
   `docs/globe/README.md` (Phase 1), fix the archive-headers claim **by
   adding the 18 missing headers**.
3. Mechanical docstring fills (Python 6, rust 4, TS JSDoc, 28 route headers).
4. Create `api/README.md` (scripts, dev server, deploy path, env vars) and
   `.github/SECURITY.md` (points at `docs/security/TRIAGE.md` policy).
5. Add a **docs-claims gate** (`scripts/check-doc-claims.mjs` planned;
   **implemented 2026-10-05 as a vitest contract test instead** —
   `api/src/lib/__tests__/docs-claims.test.ts` — so it rides the existing
   CI unit-test job and derives truth from the real TS module graph):
   README/CLAUDE numeric claims (layer count, basemap count, route count)
   are asserted against the registry/config truth — the "99% docs
   coverage" enforcement mechanism, modeled on perf-budget.mjs.
6. `docs/README.md` numbered reading-order index with last-swept date
   (StationAware pattern).
7. `OPZENITH_DATA_REPO.md`: header marking it as a spec/proposal, not current
   state.

**Verify:** doc-claims gate green; grep sweep for stale paths returns only
archive/; docstring counters re-run and recorded.

### Phase 5 — WCAG 2.1 AAA expansion (F-13)
1. Add `/api/docs`, `/wasm-demo`, `/not-found` to `a11y.spec.ts` PAGES;
   add `<main>` landmarks to `/api/docs` + `/wasm-demo` (real axe findings
   once audited).
2. Label all first-party canvases (`role="img"` + `aria-label` describing the
   live map/globe) — closes the 1.1.1 blind spot axe cannot see.
3. New keyboard-traversal checks: Tab-order smoke per page, focus-visible on
   first-party controls, no-keyboard-trap on the flip card + tabs (2.1.1,
   2.4.3, 2.4.7).
4. Programmatic target-size check for first-party interactive controls
   (≥24×24 enforced; 44×44 reported as AAA delta per MASTER_PLAN §Phase C).
5. landing.spec.ts: uniform hydration marker wait (RELIABILITY_GAPS open
   item; a11y spec already has the pattern).
6. Keep the vendor-scope filter (log-not-fail) and the animation freeze;
   document both in the spec header.

**Verify:** full a11y suite green on chromium+firefox (load-permitting — the
suite is a local gate; NAS load flake discipline applies).

### Phase 6 — Code smells (F-3 partial, F-5, F-6 partial, F-7, F-17, F-18)
1. **Raster-layer factory** (map side): collapse ~24 identical 22–43-line
   layer files to one `createRasterLayer(config)` + data table; delete the
   `ndvi.ts` fork. Verified by map E2E + layer-by-layer toggle smoke.
2. Test-helper dedup: one `stubFetch` family in `__tests__/helpers.ts`.
3. `gps-jamming` route: investigate a real upstream (daily GPS jamming maps
   exist publicly); if none is licensable/reliable, the honest fix is a
   clearly-labeled simulated dataset — the route comment and the UI layer
   description must say "simulated" (no more "placeholder stub" language),
   recorded here as a product decision.
4. `terrain/raster.py:277`: implement the local-I metric properly or return
   documented NaN + raise in the docstring what's unimplemented — never
   silent zeros.
5. `dem-tile` route `console.log` → structured diagnostics; SDK `print()`
   sites: route through `logging` (module loggers), keeping CLI output on
   stdout only in `cli.py`.
6. `useToast` orphan (only dead export in api/src): wire or remove.
7. Perf residue (task #174): typed abort-on-teardown slice (make `signal`
   required so tsc enumerates all ~45 call sites), then quiet-host re-measure
   (loadavg < 12 gate) and the live toggle crawl.
8. Layer-catalog unification (F-6 full) and globe/map layer-stack merge
   (F-3 full) are **logged as architecture decisions, not scheduled here** —
   they are multi-session refactors; this pass does the mechanical pieces
   (items 1-2) and leaves the seam documented.

**Verify:** vitest+pytest+build green per slice; aegis scan; manual map-layer
toggle smoke for item 1.

### Phase 7 — Validation (E2E + GitForge CI + F-15, F-16)
1. GitForge: runs triggered via raw API (CLI `--run` has a response-decode
   bug — recorded as platform feedback, not an OpenZenith defect); drive the
   openzenith-ci pipeline to **green on main**, watching job logs; re-run
   under load-quiet if NAS flakes bite (documented runner reality).
2. Evaluate wiring aegis into the pipeline as a baseline-gated job (kubix
   pattern — needs a runner image or host binary path; document decision).
3. Full local E2E (chromium+firefox) + prod E2E via `scripts/ship.sh` path.
4. Fix F-15: remove the prod auto-deploy job from `.github/workflows/ci.yml`;
   add the "GitHub mirror validation — NON-AUTHORITATIVE" header to all three
   workflows (StationAware pattern). Keep `publish-pypi.yml` (release path).
5. F-16: SECURITY.md (Phase 4), findings register = F-table above (adopt the
   F-NN convention repo-wide).

**Verify:** GitForge run green; E2E green; no workflow on GitHub can deploy.

### Phase 8 — Release + closeout
1. Version bump in the lockstep trio (api/package.json,
   openzenith/__init__.py `__version__`, openapi spec info.version) —
   patch/minor decided by what landed (SDK behavior fix ⇒ minor candidate).
2. `.github/CHANGELOG.md` entry (Keep-a-Changelog style, matching existing
   entries); fix its `.gitforce.yml` misspelling while there.
3. Tag + push both remotes, **verify tags on both explicitly** (memory
   procedure); GitHub release via `gh` with changelog body.
4. Deploy via `scripts/ship.sh` (build → bundle-marker → deploy → prod E2E);
   prod cache/X-Cache spot checks.
5. Docs closeout: this file's progress log, MASTER_PLAN progress entry,
   HANDOFF update, memory updates (gate baselines).

---

## 4. Adopted practices (sibling scan)

- F-NN findings register (StationAware) — adopted as §2.
- "NON-AUTHORITATIVE" header on GitHub workflows (StationAware/GitForge).
- Aegis as a CI job against the committed baseline (kubix) — evaluated P7.
- Numbered reading-order docs index + swept date (StationAware).
- Completeness guard asserting exact test-file counts (already present here;
  keep counts in sync).
- Zero-warning lint gate + prettier/format gate (StationAware).
- docs-claims gate (this plan's invention, modeled on perf-budget.mjs).

## 5. Non-goals / honest boundaries

- **No fake coverage/docs numbers.** The frontend React tree has no component
  test harness; coverage claims are scoped to the instrumented surface and
  say so.
- **globe/map layer-stack unification** (F-3/F-6 full) is an architecture
  decision, deliberately not squeezed into this pass.
- **exactOptionalPropertyTypes** adopted only if its blast radius is
  proportionate; otherwise recorded with counts.
- **next-on-pages → OpenNext/Next 16** remains user-gated
  (NEXTJS16_OPENNEXT_MIGRATION.md).
- NAS load: E2E and wall-clock measurement gates respect `/proc/loadavg < 12`
  for anything timing-sensitive; deterministic gates run regardless.

## 6. Progress log

- 2026-10-02/03: audits complete (4 parallel + sibling scan); baseline §1
  recorded; core gates green (fmt/clippy/51 tests); ruff strict-group census
  taken (286 errors current config; ~3.0k under proposed groups); GitForge
  CI: first-ever run executed on push (event-drain stall resolved in current
  build) and **correctly failed** the lint job — +15 warning regression from
  the 2026-10-02 perf/landing work (3,759 vs 3,744), proving the baseline
  guard works; CLI `pipeline --run` has a separate response-decode bug
  (platform feedback, not an OZ defect). pytest live baseline: 1,479 passed
  / 14 deselected, 98.82% lines. vitest coverage baseline in flight.
- 2026-10-03: +15 lint regression root-caused via a pre-regression worktree
  per-file diff: +10 attributable (raw `resp.json()` in the new edge-cache
  tests ×8, HeroMap initMap `any` flows ×2) + 5 pre-existing drift the old
  3,744 baseline never measured (grep-count is +5 vs JSON messages). Fixed
  the +10 (typed `bodyAs<T>()` reads; `map: maplibregl.Map` annotation in
  HeroMap initMap — which also cleared 16 baseline `no-unsafe-*` warnings in
  that file and exposed one dead null-guard, removed; global.d.ts `getSource`
  return widened with the optional raster `tiles`/`setTiles` members the
  basemap swap effect already relied on). New measured guard baselines in
  .gitforge.yml: lint 3,733 (CI-visible grep count), vitest 99 files /
  1,424 passed (1,419 + the 5 edge-cache tests). HeroMap 44 → 26 warnings.
  Aegis Phase-1 triage: 214 gate findings → 203 line-shift + 11 triaged
  (all FP/accepted, dispositions in security/TRIAGE.md); baseline
  regenerated 1,716 → 1,710, gate green.
- 2026-10-03 (Phase 2, first real slice): `waitForMapLibre()` typed to
  `Promise<MapLibreGL>` (the two `as any` casts removed), HeroMap's
  `mapRef` → `maplibregl.Map | null`, and the hand-rolled global.d.ts
  declarations completed (Map constructor, MapMouseEvent overloads for
  `on()` with async-handler support, real `unproject` signature,
  `queryRenderedFeatures(): GeoJSON.Feature[]`, GeolocateControl, raster
  `tiles`/`setTiles` on getSource). The `any` loader had been silently
  defeating the typed annotations downstream: 12 latent tsc errors fixed
  at the declaration layer, 253 → 59 warnings across the five map
  consumers, 0 errors. Lint guard 3,733 → measured 3,539. Also learned:
  GitForge re-registers pipelines on push (the pipeline id changes; run
  triggers fire per push), and an ae222ff CI run failed in `npm ci` with
  exit 137 (OOM SIGKILL) under the co-tenant load spike — infra, not
  code; re-run when quieter.
- 2026-10-03 (Phase 2, slice 2): map consumers driven to **zero** —
  map.getStyle() declared, fetch responses typed at the res.json()
  boundary, demo page's `as any` refs/waivers deleted, studio vertex
  reads annotated. Map/demo/studio/HeroMap/loader/global.d.ts: 0w/0e.
  Guard ratchets 3,539 → 3,480 (measured). CI progress on run
  092b056e: install → typecheck → lint (3,539 guard green) → spec-check
  all succeeded; unit-test failed on the documented worker-start flake
  (98/99 files, parsers.test.ts) — retries bumped to two in-command
  attempts; isolation stays on (module-state leakage risk documented
  2026-10-01).
- 2026-10-03 (Phase 2, slice 3): the **entire test family converted to
  typed response bodies** — all 43 route/lib test files (785 warnings →
  0) now read bodies via `bodyAs<T>()` with a per-file interface per
  response shape (success + error-envelope variants), typed `vi.fn`
  returns where mock pass-throughs leaked `any`, and narrow casts for
  `expect.any(...)`/mock-call projections. No eslint-disables, no new
  `any`; tsc strict clean (3 strictNullChecks misses caught by the
  central tsc run and fixed by making member-accessed fields required:
  airquality `features`, flights `states`, hurricanes `coordinates`).
  Full suite: 1,405 passed + 3 known load-flake files (docs-md,
  openapi-generation, error-diagnostics — 15s timeouts at load ~70; all
  pass in isolation). Lint 3,475 → 2,690 (grep 2,694); guard ratcheted.
  Remaining debt: globe raster family ~1,890 (awaits Phase-6 factory),
  map lib ~322, routes ~148.
- 2026-10-03 (Phase 2, slice 4): **every non-globe source file typed** —
  map/lib layers (vessels, marine-weather, satellites, aviation, buildings,
  currents, hurricanes, space-weather, military, flights, burn-scars,
  measure, + 14 more), api route handlers (collections items, nlnog,
  airquality, sentinel2, military, weather-warnings, + 13 small routes),
  studio components (TileDownloadTool, OverpassTool, parsers, DataTable,
  + 7 more), shared lib (open-meteo, client-elevation, noaa tides,
  ozt2_decode, worker-utils), and the home/explore/landing/contribute
  pages: **800 warnings → 0** (eslint messages; 2,690 → 1,890 total).
  Honest boundary interfaces + guard narrowing, no behavior changes;
  8 pre-existing eslint-disable comments deleted along the way. tsc
  strict clean after two cross-slice fixes: a type predicate returning
  `a.lat && a.lon` (number) in map military.ts → Boolean(), and the
  ambient `off()` lacking the mouse-event overload that `on()` had
  (global.d.ts now mirrors them — handlers registered via on() can be
  removed via off()). Route suites re-run green by the slice agents
  (278 tests). global.d.ts candidates recorded for the globe pass:
  getContainer(), moveLayer(), getBounds S/W/N/E, fitBounds array form,
  studio geojson.d.ts discriminated union. Remaining lint debt is 100%
  app/globe/** (1,890) — the Phase-6 raster factory's payoff.
- 2026-10-03/04 (Phase 2, slices 5-8: strictness quartet, all gates green):
  - **tsconfig**: adopted `noFallthroughCasesInSwitch` (0 fallout),
    `noImplicitOverride` (2 fixes in ErrorBoundary), `noImplicitReturns`
    (0). Declined WITH MEASURED COUNTS: `noUnusedLocals/Parameters` (36;
    13 structurally inside the frozen globe zone — revisit after the
    Phase-6 factory), `noUncheckedIndexedAccess` (1,134 — 19x threshold),
    `exactOptionalPropertyTypes` (25; 3 in globe, plus non-mechanical
    reshaping of shared optional-prop surfaces).
  - **Python (ruff + mypy)**: adopted ERA (12 dead-code hits fixed),
    PERF (8), RET (12), N (19), TC (3), S (1,908 — 2 prod asserts removed,
    4 urllib HTTPS-guarded; 1,902 test-side per-file-ignores with written
    reasons). Declined with counts: ARG 157 (interface-symmetry +
    duck-typed fakes), ANN 1,816 (mypy already covers the prod surface),
    PL 1,095 (deliberate lazy imports + numpy kernels). **mypy
    introduced** (`[tool.mypy]` disallow_untyped_defs, non-test):
    68 findings fixed, exit 0 — including a REAL latent bug: fuse.py's
    GEBCO fallback returned a bare int where callers unpack a tuple
    (first ocean point would TypeError); fixed + regression test, suite
    1,479 → 1,480 green (98.81% lines).
  - **Rust (core/)**: `missing_docs = warn` (was already 0 hits; stub
    docs upgraded to real contract docs + crate-level totality contract),
    `clippy::pedantic = warn` adopted: 62 findings fixed properly
    (must_use x16, items_after_statements x12, doc_markdown x22,
    cast_lossless x11, needless_pass_by_value x2, …), 52 numeric-cast
    lints configured-allow with written reasons (crate's documented
    position), float_cmp scoped to the ozt2 test module only,
    decode_ozt2 decomposed into 6 named helpers (+7 new wasm-gated unit
    tests). clippy -D warnings exit 0 INCLUDING --features wasm; 51/51
    tests unchanged; cargo doc warning-free.
  - **mcp-server**: real gates added (typecheck/lint/test scripts, flat
    typed eslint — unsafe-family at ERROR, 0/0 achieved, strict tsconfig
    with measured flag adoption incl. noUncheckedIndexedAccess at 2
    fixes), deprecated SDK server.tool()/resource() migrated to
    registerTool/registerResource, `npm test` scoped to src (was
    silently testing stale dist/ output — 2 files/16 tests → 1 file/8).
    **Found + fixed a production bug**: apiFetch JSON.parsed the
    text/markdown /docs-md response, so the api_docs tool and docs
    resource always errored; a toContain() test masked it because the
    SyntaxError message embeds the body head. Fixed with a content-type
    branch + exact-equality regression test with a tail marker.
    `.gitforge.yml` gains an mcp-server job (typecheck+lint+tests) and
    precise warning-message grep for the lint guard.
  - CI infra note: 41db3f2's two runs failed at install
    (infrastructure_failure, empty logs) and 89f1549's first run hit
    install timed_out at 15m — co-tenant load; install/mcp-server
    timeouts raised to 30m/20m with the failure history documented.
- 2026-10-04 (Phase 3, coverage — three-language sweep, all floors raised
  and enforced):
  - **TypeScript**: +22 tests across hurricanes/terrain-routes/edge-cache/
    flow-path/elevation-color-zxy → 99 files / 1,446 passed + 5 skipped.
    Measured 99.11 stmts / 97.51 branches / 93.40 functions / 99.84 lines;
    thresholds ratcheted 97/92/89/97 → **99/96/92/99** (wave-5 note in
    vitest.config.ts). One generated test asserted backward-looking slope
    semantics computeElevationProfile does not have (slope at i is the
    *forward* segment, so a duplicated coordinate puts the zero-run at
    profile[0], where the dDist>0 guard holds 0; the duplicate itself slopes
    normally forward) — rewritten to pin the real contract including a
    no-NaN assertion. `.gitforge.yml` completeness guard → 99 files /
    1,446 passed.
  - **Python**: `--cov-fail-under` 97 → **99**; the pyproject comment holds
    the probe-verified census of every closed branch (PNG IHDR
    decompression-bomb decode arm — DecompressionBombError is not an OSError
    so it reached the generic handler the garbage-bytes tests missed, OZT1
    reject arms, documented zoom ladders, cmd_info cache reports, reach
    tracing junction cases, …). Measured **99.06%** (14,749 stmts,
    138 miss), 1,516 passed / 14 deselected.
  - **Rust (core/)**: measured with cargo-llvm-cov for the first time:
    default-feature surface **99.19% lines / 99.24% regions** (d8 + ozt2
    100%, viewshed 99.66%, main 95.9%). A /dev/full integration test drove
    the stdout write-failure arm and found a **real defect**: stdout is a
    line-buffered writer and the JSON payload has no newline, so write_all
    alone only filled the buffer and the deferred flush at process exit
    discards its error — a failed stdout silently lost the result (the
    binary exited 0). Fixed with an explicit `flush()` whose error reaches
    error_exit. wasm.rs measured for the first time (`--features wasm`):
    its js_sys glue cannot execute on a host target, so `decode_ozt2` now
    has an executable contract suite via wasm-bindgen-test under node
    (`wasm-pack test --node --features wasm`; identity-decompressor +
    compressor-0 paths, full metadata assertions) — dev-dependencies are
    target-gated so assert_cmd/wait-timeout never build for wasm32. The 91
    still-unmeasured wasm.rs lines are js_sys-bound only; the two throw_str
    rejection arms stay validated by the browser E2E (heavy opt-in spec).
    Function-coverage remainder (main.rs 7 / wasm.rs 11) is entirely
    closure instantiations (one documented-unreachable serde fallback);
    line-level LCOV shows no zero-execution lines.
  - **CI**: run 779f0f61 (head 3f96d97) validated the new mcp-server job
    and the 30m install timeout — both green; the only red was
    bundle-budget timing out at 15m under co-tenant load (empty step log,
    same infra class as install), timeout raised to 30m with the run cited.
- 2026-10-04/05 (Phase 4, documentation coverage — complete):
  - **Docstrings/JSDoc**: the audit's "65% JSDoc baseline" was wrong — the
    real measured baseline was **28.5%** (111/390 exported symbols), so the
    wave is bigger than planned: 114 TS files edited to reach **390/390
    exported symbols** documented (src/lib, app/globe/lib, app/map/lib,
    app/studio/lib — contract docs, no restatements), 6 Python public
    functions gained missing docstrings (async_client.fetch_chunk,
    elevation.load_tile/pixel_to_lat/pixel_to_lon, tracing.fetch_neighbor_elev,
    streams.count_upstream_streams), route handler doc headers completed to
    **80/80**. `missing_docs` stays 0 in core/.
  - **Stale-claims sweep** (grep-driven, corrected against derived truth,
    not edited-to-match): **62 layers** (registry LAYERS = curated =
    mountable — the old "54 mountable / 27 curated" pairing had no
    population; 54 is MAP_2D_LAYER_IDS, the 2D subset), **10 basemaps**
    (basemaps.ts BASEMAPS), **80 API routes** (route.ts files counted).
    README.md, CLAUDE.md, ARCHITECTURE.md (stale gebco-tile/{name} path,
    removed contours route, FIRMS priority chain) and docs/CLAUDE.md all
    reconciled; CLI subcommand counts pinned to the argparse census (26).
    9 `.gitforce.yml` typos → `.gitforge.yml` across planning/archive docs;
    18 archive files got why-archived headers; docs/README.md (new)
    indexes canonical docs with a reading order; stale docs/globe/README.md
    deleted (content contradicted the shipped globe).
  - **Docs-claims gate**: implemented as a **vitest** contract test
    (`docs-claims.test.ts`, 4 tests) instead of the planned standalone
    .mjs — deviation, deliberate: it then runs in every CI unit-test job
    with zero new plumbing, reuses the TS module graph to derive truth
    (import the registry, count), and fails the same gate everything else
    fails. Greps README/CLAUDE.md for the layer/basemap/route-count claim
    shapes and compares against module-derived counts; `.gitforge.yml`
    completeness guard → **100 files / 1,450 tests**.
  - **New docs**: api/README.md (all commands sourced from package.json,
    not invented; records HF_REPO/USE_MERGED as declared-but-unread env
    and .env.example's DEM_TILES as read by nothing) and
    .github/SECURITY.md (GitHub-Issues reporting path per the GitForge
    primary directive — issues are the mirror's supported surface — with
    the security/TRIAGE.md gate policy referenced).
  - **Real bugs the documentation pass surfaced (fixed, not just
    documented)**: (1) range-rings and ContextMenu drew ellipse rings with
    **degrees** where `EllipseGraphics.semiMajor/MinorAxis` takes **metres**
    — rings were microscopic; (2) military aircraft positions passed
    ADS-B **feet** where `Cartesian3.fromDegrees` height is **metres**
    (and alt_baro can be the string "ground" — now falls back to alt_geom,
    then 0); (3) the toggleLayer switch had **no off-branches for eight
    dynamic layers** (spaceWeather, airQuality, aviationWeather, volcanoes,
    gdacs, marineWeather, wildfires, lightning) — toggling them off left
    entities rendered forever; lightning was worst (its module-level
    WebSocket ignores the toggle, so strikes kept streaming after off —
    now closed via cleanupLightning() like unmount does). Also fixed 2
    eslint **errors** the Phase-3 wave had committed in edge-cache.test.ts
    (no-base-to-string on Cache keys → keyOf union resolver).
  - **Gates at close**: tsc 0; eslint 0 errors / **1,890 warnings** (guard
    exact, page.tsx HEAD-exact — the eight new cases add zero);
    vitest 100 files / 1,450 passed + 5 skipped at floors 99/96/92/99;
    ruff + mypy clean; pytest re-run after the docstring edits;
    scripts/core_coverage_gate.sh reconciled with the Phase-3 measurement
    (was stale at the 97.96% pre-stdout-fix baseline): floor 95 → **99**,
    new baseline comment cites 99.19% lines and the closure-instantiation
    remainder.

### 2026-10-05 — Phases 5 + 6 closed (a11y AAA, code smells, typed abort slice)

**Phase 5 (WCAG 2.1 AAA) — complete.** Suite expanded to 10 audited pages
plus the globe (vendor-scoped), with 2.1.1/2.4.3/2.4.7 keyboard checks and
a 2.5.8 24px target-size floor (44px AAA delta logged, not enforced). Real
findings found and fixed, not waived:
- FlipCard rebuilt as a disclosure pattern (axe nested-interactive plus a
  real 2.1.1 trap): the card is no longer a role="button" wrapper; a corner
  `aria-expanded` toggle is the only closed-card tab stop, the back face is
  visibility-gated on hover/.flipped, and the toggle precedes the faces in
  DOM order so Tab after activation lands in the revealed CTAs.
- `/api/docs` example blocks are keyboard-reachable scroll regions
  (scrollable-region-focusable); not-found CTA sky-500 → sky-800 (2.6:1 →
  8.1:1, AAA); wasm-demo was the only page without site chrome (Navbar
  added); 2.5.8 floors applied across Navbar/Footer/CodeBlock/StatCard,
  the landing sample buttons (inline styles deduplicated into the
  .oz-sample-btn/.oz-shuffle-btn classes), and the api-docs page's own
  header brand link.
- Tab-order floors scale with each page's visible tabbable count instead of
  asserting six stops unconditionally (honest on a one-link 404, strict on
  rich pages).
- Final local run: 89 passed / 0 failed / 3 flaky-retried (firefox globe
  axe + studio tab-order flake under host load — the documented
  environmental pattern; chromium-consistent failures were treated as real
  and fixed).
- **Gap caught later by the ship gate (recorded honestly):** the a11y
  suite was updated to the disclosure contract but `e2e/landing.spec.ts`
  still asserted the OLD FlipCard contract (`aria-pressed` on the card,
  `card.focus()` + Enter). The ship-gate prod E2E failed those two tests
  on both engines; the tests were re-based onto the disclosure contract
  (toggle `aria-expanded`, Enter on the toggle, Escape bubbling) and the
  full landing spec passed against prod (22 passed + 2 flaky, 0 failed).
  Lesson: when a component's contract changes, grep every spec for its
  selectors, not just the suite that surfaced the defect.

**Phase 6 (code smells) — complete.** Raster-layer factory (29 map layer
files → createRasterLayer + data table, +10-test suite); dead useToast
removed (Toast.tsx/Providers.tsx deleted, layout unwired); gps-jamming
route is a clearly-labeled static reference dataset (data-honesty
docstring, no invented fallback); local Moran's I implemented for real in
terrain/raster.py (+tests). Perf residue (task #174): the typed
abort-on-teardown slice landed — `dedupFetch(url, timeoutMs, signal?)`
with dedup-safe external-abort semantics (an abort on a shared in-flight
request abandons only that caller's await, never the shared request),
`isAbort` guards in every fetch-wrapping catch, and page-level per-layer
AbortControllers (toggle-off aborts in-flight fetches, unmount aborts all,
and a slow chunk import re-checks the signal before fetching).

**Gates at close:** tsc 0; eslint 0 errors / **1,887 warnings** (−3 net);
vitest **101 files / 1,460 passed + 5 skipped** (.gitforge.yml guard
updated to 101/1460); pytest 1,522 passed / **99.07%** lines; a11y +
landing e2e 89 passed / 0 failed.

### 2026-10-05 — Phase 7 closed (E2E validated) + Phase 8 executed (v0.9.0 released, deployed, prod-verified)

**Phase 7.** E2E validated locally across the full surface: a11y +
landing 89/0, globe-diag 2/0, production-verify 30/0 (against the prior
prod), ozt2-validate heavy 18/0 (full Cesium terrain pipeline). The
GitForge CI green run is the one item that did not close, and the
evidence says platform, not pipeline: run 1ad0ed81 went green on the
same pipeline def at 15:52 the previous day; then four consecutive runs
(8641ae0a, 38149ca0, 0607fb0a for 0f38146/c56f70d/8f86b4c) failed at
typecheck with `node_modules` missing despite a succeeded install job
(npx installs the bogus `tsc@2.0.4`), and the release-head runs split
the failure modes — 953eb744 passed install/typecheck/lint/spec-check
then lost unit-test to `sh: 1: vitest: Operation not permitted`
(exit 127, EPERM on exec, all three in-command attempts), while its
twin 088da185 failed at typecheck the missing-node_modules way. A
co-tenant run (d8df5807) failed the same era with `EPERM: operation not
permitted, open '/workspace/node_modules/...'` on its own pipeline —
the runner workspace layer on this host broke after ~18:00 and affects
both tenants. Nothing in this repo can fix another service's workspace
handling (and the GitForge tree is the co-tenant's); recorded here and
in memory as a platform blocker. The pipeline def itself is proven:
4/7 jobs green on the release head before the platform fault.

**Phase 8.** v0.9.0 cut and shipped:
- Version trio 0.8.4 → 0.9.0 (api/package.json + lockfile,
  openzenith/__init__.py, openapi base.json, spec re-generated — the
  openapi-generation test pins the package version, so this is a gate,
  not paperwork).
- `.github/CHANGELOG.md` entry for the 119 commits since v0.8.4
  (Added / Performance / Accessibility / Fixed / Security / Coverage).
- Tag v0.9.0 pushed **explicitly** to both remotes and verified via
  `git ls-remote --tags` on both (the `--follow-tags` lesson); GitHub
  release created from the changelog body.
- Deployed via `scripts/ship.sh` (marker `GPS Jamming` — a string new
  this release, so its presence proves the new bundle): build → marker
  grep → deploy → prod E2E. Hash URL
  https://148d43ed.openzenith.pages.dev reports version **0.9.0** on
  both `/api/health` and `/api/openapi.json`.
- The ship gate earned its keep on the E2E leg: the landing spec's two
  stale flip-card assertions (pre-disclosure contract) failed against
  prod — see the Phase 5 gap note above. The fix was test-only (prod
  serves the correct disclosure UI), and the full landing suite went
  green against prod (22 passed + 2 flaky-retried, 0 failed); the
  deployed bundle needed no redeploy.

**Remaining (task #174, next session):** quiet-host perf re-measure
(loadavg < 12 gate) + live layer-toggle crawl now that the abort slice
is complete; GitForge CI green run when the platform's workspace layer
is restored.
