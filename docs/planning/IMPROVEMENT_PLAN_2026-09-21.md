# OpenZenith Improvement Plan — 2026-09-21

Status: active · Baseline: v0.8.1 (919d0fd) · Scope: repo-wide audit → phased execution

## Audit Baseline (measured, not estimated)

| Area | State |
|---|---|
| API unit tests | 60 files, 419 passing, 5 skipped |
| API coverage (vitest v8) | **43.95%** stmts / 64.22% branch / 53.77% funcs |
| Python tests | 688 tests, 19 files (README claims 255 — stale) |
| Rust tests | 17 (README accurate) |
| API routes | 80 route.ts files (CLAUDE.md claims 47 — stale) |
| Aegis scan | 12,200 findings, zero HIGH/CRITICAL (all LOW/INFO CI markers) |
| E2E | 4 specs, 29 active tests, **all hardcoded to production**, chromium-only |
| Lint | eslint 9 flat, passes; coverage-v8 now a real devDependency |

### Key zero-coverage clusters (api/)

- Terrain REST surface: `aspect`, `profile`, `slope`, `streams`, `trace`, `twi`, `watershed` — 0%
- `lib/` storage/data layer: `r2-json-cache`, `r2-tile-cache`, `hf-backend`, both `cache.ts`
  modules, `tides/noaa`, `weather/open-meteo`, `gebco/cog-reader` + `gebco/tile-math`,
  elevation readers, `terrain-cache`, `point-elevation`, `flow-path` — 0%
  (existing tests pin exported constants only; the functions are unexercised)
- `/api/tile/[z]/[x]/[y]` — 0 tests; masked by substring collision with
  `dem-tile`/`gebco-tile` test names

## Phases

### Phase 1 — Correctness & hygiene (HIGH, low risk)
1. `/api/health` reports hardcoded `0.8.0` while package.json is `0.8.1` — derive
   version from package.json so it cannot drift again.
2. Remove 4 per-request `console.log` from Edge paths: `dem-tile/.../route.ts:213`,
   `lib/tile.ts:111,120,124` (keep `console.warn/error`).
3. Git-hygiene: 28 debug PNGs (4.7 MB) under `output/playwright/` are tracked;
   `.gitignore` lacks `output/`. Also committed `tests/results*/` benchmark artifacts.
4. `api/public/offline.html` is unreachable (service worker has no navigation
   fallback) while README claims offline support — wire the SW fallback or remove
   page + claim.
5. `api/public/AGENTS.txt` advertises `openzenith.pages.dev`; canonical domain is
   `openzenith.cyopsys.com`.
6. One-off migration scripts `reencode_ozt2_brotli.py` / `reencode_xdir.py` —
   migration finished; archive.
7. Commit the `@vitest/coverage-v8` devDependency (currently uncommitted).

### Phase 2 — Documentation refresh (HIGH)
1. README: 255 → 688 pytest count; verify offline/deploy claims post-Phase-1.
2. CLAUDE.md: 47 → 80 routes; add missing app segments (`about`, `contribute`,
   `demo`, `landing`, `studio`); note studio surface.
3. ARCHITECTURE.md: remove nonexistent `/api/terrain`, `/api/tides` (helper
   `lib/tides/noaa.ts` has no route), dead `deploy.yml` reference; add current
   segments.
4. `docs/DATASET_MANIFEST.md` + `V2_DATASET_IMPLEMENTATION_PLAN.md`: reference
   `scripts/convert_gebco_to_ozt2.py` which does not exist — correct the pipeline
   description; annotate past-due archive date (2026-09-01).
5. `.github/CHANGELOG.md`: add v0.8.0/v0.8.1 entries (history lives in
   `docs/archive/CHANGELOG.md`, stale since then).
6. Archive `docs/CLAUDE_HANDOFF_PRODUCTION_AUDIT_2026-08-14.md`; fix
   `docs/CLAUDE.md` CHANGELOG pointer; mark shipped items in
   `ENHANCEMENT_PLAN.md` (gps-jamming/space-weather/coverage routes now exist).

### Phase 3 — WCAG 2.1 fixes (HIGH, user-facing)
1. Globe widgets: 8 `<div onClick>` section headers → shared `<SectionHeader>`
   rendering `<button aria-expanded>` (Keyboard 2.1.1, NRV 4.1.2).
2. `LayersWidget.tsx:43` checkbox unlabeled (label is sibling, no htmlFor).
3. `map/page.tsx:2361` icon-only `+` button without accessible name.
4. 11 placeholder-only inputs (ToolsWidget, SettingsWidget, map, globe) get
   `aria-label`s; `SettingsWidget` `<select>` has no name at all.
5. `page.tsx:1150` hover-only 14×14 help span → focusable button +
   `aria-describedby` (1.4.13, 2.5.8).
6. `globe/page.tsx:1321` compass div → `role="button"` + key handler.
7. Range inputs at `height: 3` → 24px+ target (2.5.8).
8. Contrast: `textMuted #64748b` (map, 40 uses), `#666/#555` (globe theme) below
   AA at 8–10px sizes — raise tokens to AA-passing values.

### Phase 4 — Test coverage expansion (biggest lever: 43.95% → 80%+)
1. Parameterized raster-tile route suite: 15+ `[z]/[x]/[y]` routes share the same
   R2-put/cache-fallthrough shape — one suite, many route prefixes.
2. Terrain routes (7 zero-coverage): happy path + silent-catch-200 error paths.
3. `/api/tile/[z]/[x]/[y]` suite (name-collision-masked gap).
4. `lib/` data layer: refactor storage modules for injection (task #61) then test
   `r2-json-cache`, `r2-tile-cache`, `cachedFetch`/`staleWhileRevalidate`,
   `noaa.ts`, `open-meteo.ts`, `gebco/*`.
5. Python/Rust: run pytest --cov and cargo llvm-cov to replace guessed numbers in
   README/CI thresholds with measured ones.

### Phase 5 — Structure & code smells
1. Basemap URLs: 19 literals across 6 files in 5 competing registries → single
   `lib/basemaps.ts`; proxy allowlists (`proxy/tile`, `proxy/wms`) derive hosts
   from it so new basemaps are proxyable by construction.
2. Diagnostics: ~60 `map/lib/layers/*` `addX` paths set `"error"` status while
   discarding the exception → `console.warn(layerId, err)`; keep benign teardown
   `catch {}` as-is (138 of the 182 bare catches are teardown idempotence).
3. Monolith pages (Home 2,130 / Map 2,554 / Globe 1,457 lines): incremental
   extraction following the `globe/lib/{widgets,tools,layers}` pattern the globe
   surface already uses. Landing page first (user-facing); map/globe sequenced
   after. Multi-session effort — tracked as its own task, not crammed here.

### Phase 6 — E2E hardening
1. `playwright.config.ts` baseURL from env (`E2E_BASE_URL`, default local dev) —
   today every spec hardcodes production, violating AGENTS.md's "tests must not
   require provider credentials/network" posture and making prod outages read as
   code failures.
2. Add a second browser engine (firefox) to projects.
3. `ozt2-validate.spec.ts:135` skipped Cesium terrain suite: implement or remove
   (currently a no-op describe block).
4. Run suite against production post-deploy as the live check.

### Phase 7 — Validation, CI, release
1. Full parity chain: eslint, tsc --noEmit, vitest (+coverage), pytest, ruff,
   cargo fmt/clippy/test — locally before any push.
2. GitForge pipeline (`.gitforce.yml`) stays the primary CI mirror; GitHub
   Actions remains billing-blocked (not a code signal).
3. `pages:build` → artifact verify → `pages:deploy` → production verify →
   smoke_public_api.
4. GitHub release + `.github/CHANGELOG.md` entries.

## Out of scope / sequenced later
- Monolith page extraction beyond landing (Phase 5.3) — own task, multi-session.
- GitForge event-drain stall (events queue, runs don't materialize) — GitForge
  repo issue, already surfaced to the harness.

## Progress log
- 2026-09-21: Audit complete, baseline measured, plan written. Phase 1 starting.
- 2026-09-22: Phases 1–3 committed (hygiene `319132c`, docs `4027098`, WCAG
  `e7a4eaf`); v0.8.1 tile-429/light-mode fix shipped earlier same week.
- 2026-09-22: Phase 4 first wave committed (`d474d49`): terrain
  (slope/aspect/profile/trace/twi/watershed/streams), tile/[z]/[x]/[y],
  coverage routes. Found+fixed real bug: slope/aspect/twi border cells were
  left as 0 from Float32Array init and leaked into stats/grid as fake
  zero-slope values — now NaN → excluded from stats, emitted as null.
  Vitest 419→460; statements 43.95%→57.66% (CI gate: 70%).
- 2026-09-22: Phase 4 second wave in flight — 5 parallel test-authoring
  agents over the 20 zero-coverage files (7 routes, 13 libs) + 5 low-coverage
  routes/libs. Note: tasks #54–#59 were marked completed in a prior session
  but the coverage data shows those lib tests do not exist; re-covered here.
- 2026-09-22: Phase 4 complete (`d474d49`, `dac1c41`): 90 files / 969 tests,
  coverage 92.1% statements / 83.2% branches / 81.1% functions / 92.1% lines
  (from 43.95%; gate raised to 80/70/70/80 and passing). 16 production
  defects fixed en route — headline: A* flow-trace paths never left the
  start point; degrees/radians unit bug made sphere-neighbour probes 57x
  too far; missing-chunk values bled across 256px chunk boundaries; batch
  elevation dropped caller ids and returned normalized longitudes.
- 2026-09-22: Phase 5 complete (`cf6c570`, `a95099d`). 5.1 basemap registry
  (`lib/basemaps.ts`) — 19 literals across 5 competing tables collapsed into
  one typed source of truth; map/globe/theme derive from it and both proxy
  allowlists derive their hosts, so new basemaps are proxyable by
  construction. 5.2 catch diagnostics — `lib/diagnostics.ts`
  (`warnLayerError`, `domEventCause`) wired into 36 map + 16 globe layer
  failure paths, 20 globe fetchers, 4 WebSocket onerror handlers; fixed
  events.ts reporting under the "warnings" status id; 8 map layers that
  swallowed fetch failures with no status now flag "error";
  error-diagnostics.test.ts pins the invariant in source. 5.3 landing
  extraction wave 1 — page.tsx 2,151→1,520 lines; HeroMap/SearchBox/
  SnippetTabs extracted; fixed stale-coordinate geocoder picks and the
  Tile-tab lng-fallback bug; landing verified in-browser (both themes).
- 2026-09-22: Phase 6 complete — playwright config already env-driven
  (E2E_BASE_URL) with a firefox project (plan items 1–3 were done in an
  earlier pass; the heavy Cesium suite is E2E_RUN_HEAVY opt-in). Installed
  the firefox browser binary and ran the full suite against the LOCAL dev
  server: chromium 32 passed / firefox 32 passed, 1 skipped (heavy), zero
  production dependency.
- 2026-09-22: Phase 7 complete (v0.8.2, deploy `1e99b1b1`). Validation chain
  green: tsc clean, eslint clean, production build ok, vitest 977 passed /
  5 skipped across 92 files (92.1/83.25/81.25/92.1). GitForge: push trigger
  fires (pipeline object materializes) but run execution still stalls on the
  known event-drain issue; all stored tokens 401 the pipeline API — fresh
  `/auth/login` JWT works for read-only status. Harness-jobs has no
  OpenZenith profile (only `dsc-test-node`) — gap stands as surfaced.
  Deployed via `pages:build` → artifact verify (new chunk hash live in
  worker bundle + static chunks) → local workerd smoke (landing/map/globe/
  elevation/tile all 200; needed fresh `--persist-to`, stale `_cf_ALARM`
  SQLite schema crashed workerd) → `pages:deploy`. Production verified:
  v0.8.2 chunk hash served, E2E 64 passed/2 skipped, heavy suite
  E2E_RUN_HEAVY=1 16 passed after fixing the globe-terrain assertion
  (uncaught JS + first-party request failures instead of zero console
  errors — third-party feed outages are environmental, not regressions).
- 2026-09-22: #61 complete (`refactor(api): injectable R2, Cache API, and
  fetch seams in lib/`). r2-binding.ts gained `setR2BucketProvider` +
  structural env reading; r2-json-cache writes stringified customMetadata
  (real R2 contract); cache.ts gained `setCacheStorageProvider` and a
  never-throwing resolver; tides/noaa.ts takes optional `fetchImpl`.
  Tests inject fakes through the seams — the `@cloudflare/next-on-pages`
  module (un-loadable under node vitest: needs `server-only` with the
  react-server condition) is aliased to a stub in vitest.config.ts;
  production imports are unchanged. Verification: tsc clean, eslint clean,
  vitest 978 passed / 5 skipped (92 files).
- 2026-09-22: #26 complete — all 595,149 z11 OZT2 tiles (21 GB) are in R2
  (`openzenith-dem`, prefix `ozt2/11/{x}/{y}`) and production-verified:
  delta pass reports 0 to upload; `/api/dem-tile/11/{x}/{y}?format=ozt2`
  serves `x-dem-tile-source: r2-cache` byte-identical to local across the
  x range (land + ocean stubs). Path learned: the R2 REST object API
  throttles (~all-429 at 96 concurrent PUTs, ~5-16 obj/s sustained); the
  fast path was a temporary Cloudflare Worker with a direct DEM_TILES
  binding (8-wide parallel puts, ≤40 tiles/request under the free-plan
  50-subrequest cap, ~80-100 obj/s, 0 errors) — worker deleted after the
  run. The durable uploader is `scripts/upload_ozt2_to_r2.py` (delta +
  cursor pagination via `result_info.is_truncated`). No route or globe
  code change was needed (`MAX_TERRAIN_ZOOM = 12` already consumes z11).
- 2026-09-22: #28 (HF upload perf) — uploader rewritten
  (`scripts/upload_ozt2_to_hf.py`): one-call `dataset_info(files_metadata)`
  remote listing, git-blob-sha hash delta (missing + byte-stale overwrites),
  1,500-file commits with a rolling 100/hour pacing window and
  Retry-After-aware retries. Measured HF constraint: dataset commits are
  hard-capped at 128/hour — 250-file batches mathematically cannot finish
  a 150K-tile sync; big commits are the only viable shape. hf_hub's httpx
  timeouts (10s read / 60s write) are widened to 10 min: a 40 MB commit
  outlives 60 s through this link, and the timed-out commit lands anyway
  (retries would duplicate it). z10 sync (missing + stale) running; final
  state to be confirmed by a validator re-run.
- 2026-09-22: #27 complete — HF z10 integrity validated
  (scripts/validate_hf_ozt2.py, report /tmp/hf_validation_report.json):
  remote 92,714 / local 151,988 z10 tiles → 59,276 missing (39% synced);
  48-tile byte sample: 10 byte-identical, 38 hash-mismatch BUT all decode
  cleanly with sane ranges and RMSE ≤ 1m — an older encoder generation on
  HF, not corruption; landmarks sane (Everest 3031–8740 m). 2,980 stray
  root-level duplicate tiles remain unreachable by the SDK (surfaced, not
  deleted). Fix for the staleness/missing = the #28 z10 sync, which
  overwrites hash-stale tiles and fills missing ones.
- 2026-09-24: #127 complete — HF z10 sync end-state CONFIRMED
  (scripts/validate_hf_ozt2.py re-run, report /tmp/hf_validation_post.json):
  remote z10 = 151,990 / local = 151,988 → **0 missing, 0 stale** — the
  exhaustive byte-diff found all 151,988 local tiles byte-identical on HF
  (vs the #27 baseline of 92,714 remote / 59,276 missing / 38-of-48 stale
  hash-mismatch). 48-tile download sample: 48/48 ok, 48/48 hash-matched,
  roundtrip RMSE within tolerance. Landmarks all OK with hash MATCH (Everest
  3031–8740 m, Dead Sea −416 m, NYC −78..139 m, La Paz 2419–5506 m). The
  2,980 root-level strays from #27 are gone (0 now); the only extras are two
  early test artifacts (`tiles/z10/0/test338{,c}.ozt2`) — surfaced for a
  future housekeeping pass, harmless to the SDK (valid tiles, never
  requested by path).
  Validator fixes that made the re-run possible: the one-call
  `dataset_info(files_metadata=True)` listing hung forever on this
  150K+-file repo (tens-of-MB response vs hf_hub's 10 s read timeout — the
  #28 failure again). Replaced with manual pagination over the HF tree REST
  API (1,000 entries/page, Link-header cursor, per-page retry with backoff
  capped at 60 s after a transient DNS outage killed a full walk at page
  ~510). Listing is scoped to `tiles/z<zoom>` by default (`--all-zooms` for
  the full walk — the repo also holds z0/z1/z5/z7/z8/z9/z11 dirs; counts
  unverified). File `oid` from the plain listing IS the git blob sha1, so
  the no-download byte-diff works unchanged. Report gains per-zoom counts.
  No api/ source change → no deploy.
