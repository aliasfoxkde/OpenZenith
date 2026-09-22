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
- z11 R2 upload (#26), HF tile integrity (#27), HF upload perf (#28) — data-plane
  work independent of this quality pass.
- GitForge event-drain stall (events queue, runs don't materialize) — GitForge
  repo issue, already surfaced to the harness.

## Progress log
- 2026-09-21: Audit complete, baseline measured, plan written. Phase 1 starting.
