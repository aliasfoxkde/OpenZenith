# Fleet Improvement Plan — 2026-11-01

## Revalidation against current main — 2026-11-01

The Phase 1 list below is the original audit snapshot. Its four claimed
documentation defects were rechecked against the current repository tree
before implementation. They are already resolved in the current source and
must not be re-applied as blind edits:

| Original finding | Current source of truth | Revalidation |
|---|---|---|
| Next.js version prose stale | `api/package.json` pins Next.js 16.4.3; README, CLAUDE.md, `api/README.md`, `api/src/app/about/page.tsx`, and `docs/ARCHITECTURE.md` all say Next.js 16 | Resolved |
| Cesium version/load-path stale | `cesium-init.ts` loads vendored assets first; both jsDelivr and unpkg fallbacks are Cesium 1.146.0; CLAUDE.md records 1.146.0 | Resolved |
| GEBCO year contradiction | Layer registry, dataset manifest, README, CLAUDE.md, and architecture docs identify GEBCO 2025 | No current contradiction found |
| Basemap display labels stale | README's ten display labels match `BASEMAPS` in `api/src/lib/basemaps.ts` | Resolved |

The source-level docs gate already checks the Next.js major against
`api/package.json` and checks every README basemap label against the shared
registry (`api/src/lib/__tests__/docs-claims.test.ts`). Do not duplicate
those checks. The remaining improvement opportunity is to keep the source
gate comprehensive as new cross-file claims are introduced.

**Disposition:** no README, CLAUDE, registry, Cesium, or GEBCO edits are
needed for the original Phase 1 findings. The re-run workstreams and other
gaps below remain open unless their own receipts say otherwise.


Source: audit fleet run of 2026-11-01 (9 workstreams). Only **docs-claims**
completed substantively; edge-cache and frontend-audit returned skeletons and
coverage-plan / next16-plan died on gateway 502/429s — those workstreams are
re-queued below rather than their findings being fabricated.

## Phase 1 — Docs truth fixes (from docs-claims report, all file:line-verified)

All findings below come from `/var/tmp/oz-fleet/work/docs-claims-report.md`.

1. **Next.js version claims say 15, tree is on 16.4.3.** Fix all five sites:
   - `CLAUDE.md:63`, `CLAUDE.md:118`
   - `README.md:196`
   - `api/README.md:3`
   - `api/src/app/about/page.tsx:178` (user-visible tech tag)
   - `docs/ARCHITECTURE.md:11`
2. **CesiumJS claims stale on two counts.** `CLAUDE.md:121` says "1.119 —
   loaded via CDN". Actual: vendored 1.146.0 loaded local-first
   (`cesium-init.ts:11`, `copy-vendor-assets.mjs`), CDN 1.119 is only a
   fallback — and the fallback version itself lags the vendored copy
   (`cesium-init.ts:12-17`). Fix the doc, and bump the fallback URLs to 1.146.0
   (or drop the version-pinned fallback duplication).
3. **GEBCO year contradiction.** Registry says 2024 (`registry.ts:68`); docs say
   2025 (`CLAUDE.md:164`, README data-sources table). Resolve the year once —
   check the actual tile source — and fix whichever side is wrong. Note: this
   class of drift is **ungated** (docs-claims.test.ts only covers counts).
4. **README basemap labels don't match shipped UI labels.** README:255 says
   Voyager/OSM/Topo/Dark No-Labels; registry labels are
   Streets/OpenStreetMap/Topographic/Dark (no labels) (`basemaps.ts:90,116,133,80`).
   Fix README names or align registry labels — pick one naming authority.
5. **Counts verified TRUE (no action):** 62 layers, 81 route files, 36 CLI
   subcommands, 15 MCP tools, 10 basemaps, 31 highlight rows.

## Phase 2 — Re-run the dead workstreams

**Globe+studio frontend audit — COMPLETE 2026-11-01.** 17 confirmed
findings (file:line-verified by the auditor), none in the
already-fixed classes. **Fixes implemented 2026-11-01** (uncommitted-
at-crash, validated and committed post-recovery): stale `activeTool`
closure (ref), duplicate earthquake/event loads + `eq-` dedup on load,
stale `state.layers` in visibility resume and loaders (ref read),
`camera.changed`/`preRender` listener teardown, `ScreenSpaceEventHandler`
destroy, hash deep-link restore moved to lazy `useState` initializer,
`spaceWeather` added to `dynamicKeys` (coverage is a static imagery
layer, correctly excluded), `switchBasemapOnViewer` preserves
user-enabled overlays, `toggleLayer` updater purity, `__ozSetFollowEntity`
teardown; studio: `profile-layers.ts` module (N-marker existence-checked
removal, in-place line update, stale-marker sweep + 5 unit tests),
styledata boundary restore, worker-result token gating, map-init orphan
fix, ref-tracked overpass layer swap. Guard baseline 126/1774 → 127/1779.
Top items for the next execution cycle:

- **globe/page.tsx:433** — LEFT_CLICK handler captures mount-time
  `activeTool` (deps `[]`); elevation-profile clicks never reach
  `profile.addPoint`.
- **globe/page.tsx:1182/1196 + 1536-1548** — earthquakes/events toggle
  fires `loadEarthquakes` twice; duplicate `eq-${i}` entity ids throw.
- **globe/page.tsx:1188** — toggle passes pre-toggle `state.layers`
  (stale closure); the 60 s poll dies after the first fetch.
- **globe/lib/layers/earthquakes.ts:188** — `doLoad` skips
  `removeEntities("eq-")`; visibilitychange reload duplicates ids.
- **globe/page.tsx:502** — anonymous `camera.changed` listener leaks
  past unmount.
- **globe/page.tsx:360** — `ScreenSpaceEventHandler` never destroyed.
- **globe/page.tsx:352** — deep-link `#lat/lon/zoom` restore races
  viewer init and is ignored.
- **globe/page.tsx:309-334** — `dynamicKeys` omits `spaceWeather` and
  `coverage`; their polling dies after one tab hide/show.
- **globe/lib/helpers.ts:217** — `switchBasemapOnViewer` drops
  user-enabled overlays while their state flags stay true.
- **globe/page.tsx:1151-1436** — `toggleLayer` side effects inside the
  `setState` updater; StrictMode double-invokes.
- **studio/page.tsx:624-635** — profile cleanup only removes markers
  0/1; >2 points orphan `profile-marker-2+`.
- **studio/page.tsx:640-687** — `profile-line` re-added unguarded after
  basemap `setStyle`; styledata restore doesn't re-add profile layers.
- **studio/page.tsx:644-654** — no cancellation on worker profile
  results; stale result overwrites newer.
- **studio/page.tsx:97-100** — `boundaries: true` default but layer
  never added on load.
- **studio/page.tsx:188-385** — Map init throw orphans the MapLibre
  instance (never `.remove()`d).
- **studio/page.tsx:541-574** — rapid Overpass results can orphan the
  first result's layer.
- **globe/page.tsx:589-591** — `__ozSetFollowEntity` survives unmount
  while `__ozViewer` is cleared.

Verified clean: `useWidgetManager.ts`, `elevation-profile.ts`/`tools.ts`,
`cesium-init.ts`, `timers.ts`.

Gateway permitting, re-run as forks (bounded, one at a time to avoid the
circuit breaker):

1. **edge-cache design review** — **DONE 2026-11-01** (completed outside the
   fork; receipt in the session memory `edge-cache-audit-2026-11-01`):
   `api/src/lib/storage/edge-cache.ts` and its 7 consumers audited — sound
   design, no user-facing defects; known quirks (dead `dem-tile` type entry,
   deliberate route-local dem cache, fail-closed expiry, best-effort writes)
   documented as accepted.
2. **frontend map/globe audit** — **DONE 2026-11-01.** Executed as the
   globe/studio audit (17 findings fixed, commits recorded in Phase 2 above)
   plus the Phase 2.5 map audit (8 defects fixed in aed1d676). The
   `/var/tmp/oz-fleet/work/frontend-audit.md` skeleton is superseded by those
   receipts.
3. **coverage-plan** — the closure plan skeleton at
   `/var/tmp/oz-fleet/work/coverage-closure-plan.md` reports the real
   baseline: **99.8 stmts / 99.07 branch / 99.61 funcs / 99.97 lines against
   a floor of 99** — there are no coverage gaps to close at the current
   floor. Re-queue only if the floor is raised.
4. **next16-plan** — **DONE 2026-11-02.** Review recorded at the top of
   `NEXTJS16_OPENNEXT_MIGRATION.md`: Phase 2 (Next 15→16) already landed
   (16.4.3, e306d225); the T-016 32.2 MiB bundle blocker no longer reproduces
   (current build: 10.7 MiB gz, green since v0.9.9); the zstd-wasm webpack
   alias guards a dead import and is deletable. Remaining actionable work is
   Phase 1 only (OpenNext adapter swap, still user-gated as T-017).

## Phase 3 — Gates to close the ungated drift class

1. Extend `docs-claims.test.ts` beyond counts: assert the Next.js version in
   prose matches `package.json`, and basemap labels in README match
   `basemaps.ts` labels. — **DONE 2026-11-01** (commit 1a455a8b; 2 new
   assertions, 6/6 pass)
2. Add a source-attribution check for the GEBCO year (single source constant
   consumed by both registry and test). — **DONE 2026-11-01** (commit 7ec4b300;
   `GEBCO_YEAR` in `api/src/lib/gebco/tile-math.ts` now feeds the filename
   builder, filename parser, CEDA URL, registry description, and WMTS
   abstract; `quadNameToBounds` rejects foreign-year filenames; a third gate
   assertion checks every prose surface)

## Phase 2.5 — Map page audit findings (2026-11-01, all source-verified)

Eight confirmed defects in `api/src/app/map/`, found by the re-run frontend
audit and independently verified line-by-line:

1. **Stale `finishDrawing` closure wipes annotations** (`page.tsx:789-1042`
   effect has `[]` deps; handler captures mount-time `finishDrawing` whose
   `annotations` is the initial value; a point draw then
   `saveAnnotations([ann])` — permanent data loss of all prior annotations).
2. **Context-menu listeners never removed** (`page.tsx:989-1008`): the
   canvas `contextmenu`/capture-click and the `document` capture-click
   listeners have no cleanup — the document listener survives unmount.
3. **Tab-hide kills layer polling permanently** (`page.tsx:761-787` +
   `layers/index.ts`): visibility resume re-calls `addDataLayer`, but
   `add*` early-returns when the source exists, so the cleared intervals
   (and flights' `moveend` cleanup) are never re-registered.
4. **Timers survive unmount**: `eqPlayRef` interval (`page.tsx:269`) and the
   module-level `hurricaneAnimationInterval` (`layers/hurricanes.ts:307`)
   are outside `handle.intervals` and never cleared on unmount.
5. **Side effects inside a `setMapState` updater** (`page.tsx:1084-1124`):
   `toggleLayer` performs map mutations in the updater (impure; double-
   invoked under StrictMode).
6. **`switchBasemap` re-add race** (`page.tsx:1045`): `map.once("styledata")`
   fires on any styledata event, so two rapid switches interleave stale
   `mapState.layers` closures.
7. **Opacity sliders dead for many layers** (`page.tsx:152-179`): match
   is `layer.id.startsWith(registryId)` but map layer ids use kebab-case
   (`elevation-color-layer`, `land-cover-layer`, `sentinel2-layer`,
   `population-density-layer`, `accuracy-*`). Verified dead: elevationColor,
   elevationAccuracy, bathymetry, sentinel2, nightLights, populationDensity,
   landCover, seaIce, floods, fireTemperature, sarBackscatter.
8. **Blank screenshots** (`page.tsx:1181-1189` + `lib/map-export.ts`): both
   paths call `canvas.toDataURL` on a `preserveDrawingBuffer:false` canvas
   → empty PNG.

## Explicitly deferred / operator-gated

- Docs-vs-reality item flagged but not decided: whether "81 API routes" should
  count distinct public URLs (>81 with dynamic segments) — current phrasing
  counts route files, which is fine if stated.
- Rust CLI subcommand list (`CLAUDE.md:146`): **verified 2026-11-01** — all six
  (`d8`, `accum`, `reconstruct`, `viewshed`, `stream-order`,
  `gradient-predict`) dispatch in `core/src/main.rs:67-72`. TRUE.

## Receipts

- docs-claims report: `/var/tmp/oz-fleet/work/docs-claims-report.md` (complete,
  file:line-cited)
- Dead-run logs: `next16-plan.log`, `coverage-plan.log`, `edge-cache.log`,
  `frontend-audit.md` (all gateway 502/429 terminations, 2026-11-01)
- Phase 1 execution: commit 1a455a8b (docs truth fixes) + 9f5ce1f5 (minimatch
  direct dep); Dependabot #93 (minimatch <11.0.1) confirmed **fixed**, 0 open
  alerts after the push
- Phase 3 execution: commit 7ec4b300 (GEBCO single-source) — full local vitest
  green at 126 files / 1772 tests; CI unit-test guard baseline updated
  1769 → 1772 in `.gitforge.yml` to match the three new gate assertions
- Aegis re-triage 2026-11-01: commit a32a6167 — the docs-claims gate's
  `api/package.json` reads tripped the `package-json` detector; the class
  is the established "the literal IS the input contract" acceptance
  (same as `relink-bins.mjs` / `override_drift_check.sh`). Baseline
  regenerated 2117 → 2125; gate green across all five scopes.
  Disposition recorded in `docs/security/TRIAGE.md`.
- GitHub PR #53 ("Align live homepage version and data attribution")
  merged 2026-11-01; it adds two more `docs-claims` assertions (homepage
  Next.js major, footer data attribution). Local gate green at 9/9 for
  that file; full suite and CI re-run on the merge commit `8229ad56`.
