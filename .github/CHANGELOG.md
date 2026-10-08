# Changelog

Format follows Keep a Changelog; versions match git tags. Fuller history
(latest: v0.6.4) lives in `docs/archive/CHANGELOG.md`.

## v0.9.2 (2026-10-08)

33 commits since v0.9.1: excellence-cycle IV — strictness gates
graduated across all four language surfaces, the two hottest analysis
paths extracted into shared kernels, new analysis primitives in the
Rust core, terrain tooling in the SDK and MCP server, and
click-to-identify on the map. No breaking changes.

### Added
- API: Terrain-RGB tile encoding, configurable elevation params, EGM96
  undulation correction, and PMTiles archive serving.
- Rust core: D∞ flow direction, cut/fill, and solar-radiation analysis;
  the OZT2 decoder moved to a host-testable core that is parity-tested
  against the WASM binding.
- Python SDK: documented exception hierarchy, `py.typed` marker,
  sentinel-safe OZT2 decode, four new CLI subcommands; mypy strict
  bundle and ruff FURB110 adopted.
- MCP server: terrain analysis tools backed by the REST API.
- Map: click-to-identify surfaces the features under the cursor for
  the layers present on the current style.
- Globe: Cesium and satellite.js vendor assets are self-hosted — no
  runtime CDN dependency.

### Fixed
- API routes return honest status codes — the 200-on-error contract is
  gone.
- Explore: dataset/theme cards are real buttons (a nested-interactive
  controls defect), placebo controls are wired to real behavior, layer
  fetch errors surface, and the sea-ice layer is repaired.
- Studio: the tab-switch E2E race (a click landing before React
  hydration) is fixed with a retry-until-hydrated pattern; a functional
  E2E suite now covers the click-paths behind each surface.
- Root configs (next/playwright/vitest) documented to the same JSDoc
  bar as `src/` — found by CI because the local gate check had been
  scoped to `src/`.

### Gates
- TypeScript: `no-unsafe-*` promoted to error; zero-warning,
  zero-error `eslint .` over the full directory (444 files).
- eslint-plugin-jsdoc requires export docstrings at error, with a
  measured 186-file grandfather block and a documented ratchet
  protocol.
- Python: interrogate docstring coverage >= 99% (422/422 exports).
- Rust: clippy nursery fixed classes adopted; pedantic lint continues.
- Receipts: 99.53% statement coverage (1,704 vitest tests, 31 thin
  arms closed with real tests), E2E 95 passed, bundle budget
  re-baselined with documented rationale, aegis re-baselined with a
  triage log (docs/security/TRIAGE.md).

## v0.9.1 (2026-10-06)

18 commits since v0.9.0: the map/globe defect backlog from a layer-crawl
audit, an Aegis security delta gate wired into GitForge CI, the globe
surface typed to zero ESLint warnings, and the last WCAG 2.4.1 gap
closed. No breaking changes.

### Fixed
- Map layers (crawl-audit wave): duplicated glyph styles collapsed to a
  single source (`buildMapStyle`); a toggle dispatcher race that could
  leave a layer half-registered; unguarded layer removers across all 24
  modules (removing a never-added layer no longer throws); the waterways
  triple defect (style contract, fetch path, remover).
- Volcano layers (map + globe) now read USGS HANS alerts — the previous
  RSS upstream bot-gates non-browser clients; the map fetch goes through
  a same-origin CORS proxy.
- Terrain tiles overlapping a SRTM cell's edge decoded from the wrong
  cell: the `.merged` naming convention is the cell's SW corner; the
  decoder's inverse-property tests now pin it.
- OZT2 tiles compressed with Brotli (the Python encoder default) failed
  on the edge where workerd silently returns empty for `br` — decoding
  now goes through the WASM decoder (Brotli and Zstd), matching the
  per-tile flags byte.
- Globe (surfaced by typing the surface): the elevation-color loader
  stored its `PointPrimitiveCollection` under the wrong object (dot
  field never drew); the nlnog layer constructed `CustomDataSource`
  without `new` (layer never rendered); `coverage.ts` discarded the
  `ImageryLayer` handle (alpha tuning was a no-op);
  `annotations.setLabel` replaced the whole `LabelGraphics` bag (captions
  lost font/colour/offset); `bookmarks.loadBookmarks` now shape-checks
  stored entries instead of crashing on a malformed payload.
- SDK: `print` residue in `elevation.py` progress and the hydrology
  error paths moved to the `_logger` idiom (return contracts unchanged);
  the GEBCO fallback returned a bare tuple where callers expected
  `(grid, meta)`.

### Added
- GitForge CI: Aegis secret/vuln pattern scan as the pipeline's first
  job, fingerprinted as a delta gate — new findings fail the run;
  dispositioned classes are recorded in `docs/security/TRIAGE.md` with
  their mapping so line drift alone cannot re-trip the gate.
- WCAG 2.4.1 skip links: root-layout "Skip to content" link (explicit
  `target.focus()` on activate — fragment navigation alone leaves
  `activeElement` on body in Firefox/Safari), `id="main-content"`
  landmarks on all 13 pages, and the globe's Cesium container now names
  itself (`role="application"`, `aria-label`), as the 2D map already
  did. E2E presses the actual keys on every audited page.

### Performance
- Quiet-host re-measure pass; bundle budget baseline ratcheted down for
  the embedded Brotli decoder.

### Coverage
- TypeScript: the entire globe surface typed against ambient Cesium
  declarations — ESLint **1,909 warnings → 0** across all 444 files
  (`npx eslint . --max-warnings=0` is now the CI gate of record); three
  stricter tsconfig flags adopted.
- Python SDK: ruff extended to the strict measured-cheap groups
  (PERF/RET/N/TC/S); mypy clean; the 5 format-drifted files conformed.
- Rust core: clippy pedantic clean; coverage 99.19% lines (floor 95).

### Security
- The 5 Aegis ssrf-localhost findings the CI gate caught on its first
  run were triaged (registry references — intended), the baseline
  re-based, and the runner hazard documented (a fedora-docker runner
  with a noexec workspace cannot execute job binaries; needs a
  platform-level fix).

## v0.9.0 (2026-10-05)

119 commits since v0.8.4: map/globe performance work (lazy layers, fetch
teardown, timer reclamation), a WCAG 2.1 AAA accessibility wave, static
typing at every fetch boundary, and raised quality floors across all four
surfaces (TS / Python SDK / Rust core / MCP server).

### Added
- SDK: `image_autocorrelation` in `openzenith.terrain.raster` now computes
  a real local spatial autocorrelation (Anselin's local Moran's I over a
  kernel window — a texture/edge detector, not a hypothesis test),
  replacing placeholder behavior.
- API: `gps-jamming` reference endpoint serving a documented synthetic
  demonstration dataset (honestly labeled — not live measurements).
- GitForge CI pipeline extended: mcp-server job (typecheck + lint +
  contract tests), bundle-budget tripwire (production build compared
  against `api/perf-budget-baseline.json`), and coverage-count guards.
- `scripts/ship.sh` — one gate for build → bundle-marker check → deploy →
  production E2E verification.
- MCP server: `/docs-md` endpoint served as `text/plain` with
  lint/typecheck/test gates added to CI.

### Performance
- Map layer modules load on demand — 29 identical raster layer modules
  collapse to one typed raster factory; layer chunks are imported only on
  first toggle-on (bundle budget re-baselined for the lazy chunks).
- Globe layer fetches are abortable end-to-end: toggling a layer off or
  leaving the page cancels its in-flight requests (`AbortSignal` threaded
  through all 21 loader modules, dedup-safe in `data-fetchers.ts`).
- Layer polling timers are reclaimed on toggle-off; globe polling pauses
  when the tab is hidden.
- Self-hosted mono font (no third-party font fetch); Cesium preloaded on
  `/globe`; edge cache now fronts geocode and elevation point queries;
  tile route TTLs aligned with the declared immutable policy.

### Accessibility
- WCAG 2.1 AAA wave: flip cards converted to the disclosure pattern
  (single tab stop when closed, no nested-interactive, no focus trap,
  Escape closes); 2.5.8 target-size floors on icon-only controls;
  scrollable-region keyboard access; docs page header contrast and hit
  area; wasm-demo chrome contrast.

### Fixed
- Landing banner address search could render pre-hydration text on slow
  connections; hydration-race e2e guards added for landing interactions.
- Globe layer units corrected to metres; 8 layers were missing their
  toggle-off cleanup (interval/fetch leaks).
- SDK GEBCO fallback returned a bare tuple where callers expected
  `(grid, meta)`; cache-key construction no longer routes through
  `String()` (flaky `vi.mock` bypass).
- Rust core: WASM D8/viewshed entry points flush stdout before returning;
  ozt2 decode split into testable halves.

### Security
- Aegis line-shift findings triaged and the baseline re-based; GitHub
  Actions workflows marked explicitly NON-AUTHORITATIVE (GitForge is the
  primary CI/CD platform; no GitHub workflow can deploy).

### Coverage
- TypeScript (vitest): 1,460 passed + 5 skipped across 101 files;
  thresholds raised to 99 statements / 96 branches / 92 functions /
  99 lines. ESLint warnings 3,744 → 1,887 (globe raster layers remain,
  tracked); three stricter tsconfig flags adopted.
- Python SDK: 1,522 passed, 99.07% line coverage (floor raised to 99);
  ruff strict rule groups, mypy at exit 0.
- Rust core: clippy pedantic clean; coverage floor 99 with wasm32
  contract tests.
- Documentation: all 390 exported TypeScript symbols JSDoc'd, 26 route
  headers, 6 undocumented SDK functions docstring'd, docs-claims gate
  added (README/CLAUDE.md/ARCHITECTURE.md reconciled against code).

## v0.8.4 (2026-09-24)

### Security
- Zero known CVEs in production dependencies: `next` 15.4.11 → 15.5.26
  (middleware-bypass and Edge-runtime Server Action advisory classes),
  `postcss` pinned ^8.5.26, `sharp` pinned ^0.35.4 (inherited
  libvips/libheif CVEs). `cargo audit` clean (58 crates); `pip_audit`
  clean on SDK runtime deps.
- Closed an ArcGIS proxy allowlist bypass: suffix hosts
  (`evil-services9.arcgis.com`) no longer match the allowlist.
- GIBS tile route uses a strict integer grammar (`parseInt` accepted
  `"3abc"` as `3`); negatives still reach the range check and 404.

### Fixed
SDK (Python):
- The inverted-D8 family in `hydrology` — upstream tracing, watershed
  delineation, stream basins, stream order, and link/reach builders used
  opposite-of-d geometry, tracing the wrong cells; first-come-wins basin
  claims; two unbounded hangs under cycles. Also: `flowpaths`
  broadcast crashes and reversed upslope propagation, the tracing
  oscillation guard flagging straight descents, viewshed NumPy/kernel
  divergence on NODATA observers.
- `channels`: `cross_section_area`/`hydraulic_radius` were always 0.0;
  `elevation_above_stream`/`depth_to_water` measured distance from the
  stream mask instead of to it.
- `inundation`: depression depth/volume were sign-inverted.
- `vector`: a `POLYLINZ` typo meant POLYLINEZ shapefiles silently fell
  through to GeometryCollection.
- `tile_format_v2`: the fallback compressor recorded in the flags byte
  was wrong (zlib tiles labelled brotli — unreadable on brotli hosts);
  encode now rejects non-square arrays. `geotiff`: NaN filled before
  cast, dtype overrides clip via iinfo, Pillow fallback writes signed
  int16 correctly.
- Packaging: `typing_extensions`/`cachetools`/`scipy` were undeclared
  module-scope imports (clean-venv import probe now 0 failures); the
  minimal install imports without zstandard; `[viz]` extra added;
  hatchling source builds restored via `[tool.hatch.version]` (pip
  install . / -e . were broken).

API:
- Terrain tiles overlapping a SRTM cell's last 17 pixel columns
  decoded with constant-stripe corruption (-6,385 m): OZCHNK01 edge
  chunks are stored 256×256 with zero-delta padding and the four inline
  decoders undid the predictor at the real extent. Consolidated into
  one shared stride-256 decoder.
- Stale pre-fix renders persisted in R2 and the edge Cache API (1-year
  immutable TTL) after decoder fixes; rendered types are now salted
  with `RENDER_SCHEMA_VERSION` so future decode fixes self-invalidate.
- Cold multi-cell tiles serialised N × ~9.4 MB HuggingFace downloads
  inside one request, blowing the edge wall-time budget as sticky
  empty-body 503s (56% of first-wave requests in one sweep); cell
  assembly is now concurrent with single-flight merged downloads.
- The AWS terrarium fallback always threw: it inflated zlib-wrapped
  IDAT with fflate's raw-DEFLATE `inflateSync`.
- STAC `/items` bbox filtering recursed into coordinate arrays as
  Geometry objects, dropping every Polygon/LineString result.
- Profile API `total_gain` was identically 0 for every request (the
  reduce indexed the filtered array instead of the profile).
- Aspect compass mirrored N↔S (atan2 double negation), in the API and
  the SDK's terrain module alike.
- Waterways layer never returned features (Overpass query lacked the
  geom modifier; parser expected arrays not `{lat,lon}`); geoip dropped
  legitimate 0 coordinates; military forwarded negative distances; the
  WMS proxy swallowed appended params after a fragment.
- WorldCRS84Quad served EPSG:3857 bytes with a row-flip under an
  EPSG:4326 label — deprecated across metadata/data/list/capabilities;
  the conformant set (below) replaces it, with GDAL-caught level-0
  scale denominators and per-layer capabilities.
- Globe active basemap preview label: 5.19:1 contrast on the accent
  glow background → 10.8:1 (WCAG AAA for 10px text; axe
  color-contrast-enhanced, serious).

### Added
- Single-source OpenAPI 3.1 spec generated from the route tree
  (`/api/openapi.json`, 80 paths): hand-authored base plus a generated
  skeleton for every undocumented route; a `--check` gate fails if the
  committed spec drifts from the routes or package version.
- Conformant WorldCRS84Quad tile set (OGC 17-083r2), independently
  verified with GDAL 3.12.1.
- MCP tool contract aligned with the live API, pinned by a contract
  test suite.
- Test-surface campaign across the repo: TS vitest floors raised to
  95/90/86/95 with functions coverage 100% (375/375) and every route's
  CORS preflight handler under test; Python floor 97 (measured 98.8%),
  1,479 tests; Rust core 98% (llvm-cov floor).

### Changed
- HF uploader/validator hardening: the upload landing probe no longer
  trusts CDN-cached HEAD bytes (reported 0 failed while half the z7-z9
  refresh had not landed); listing uses retry-safe cursor pagination
  (a 150K+-file `dataset_info` never returns); zoom-scoped
  completeness-only audit mode for ~600K-tile zooms.
- Globe page: ISS TLE lookup and tooltip/orbit builders extracted into
  `lib/`; Cesium init result typed against CesiumType.
- ESLint 0 errors repo-wide, warnings 5,800 → 5,381; `tsc --noEmit`
  clean; 1,434 TS + 1,479 Python tests green against the raised gates.

## v0.8.3 (2026-09-22)

### Security
- Globe hover tooltips rendered third-party feed content (USGS quake place
  strings, OpenSky callsigns, AIS vessel names, EONET event titles) as raw
  HTML via `dangerouslySetInnerHTML`; every feed-derived interpolation is
  now HTML-escaped (`escapeHtml`), closing a stored-XSS vector from
  hostile upstream feeds.

### Fixed
- `point-elevation.ts` DecompressionStream path could deadlock when
  compressed tile bytes exceeded the writable high-water mark: the reader
  loop now starts before `writer.write()`/`close()` are awaited.
- Clearing an elevation profile in Studio left the profile line and
  marker layers on the map; the null branch now removes them (and the
  close path shares one cleanup loop).

### Added
- Aegis security/pattern gate (`scripts/aegis_scan.sh`) with committed
  finding baseline and reviewed triage policy
  (`docs/security/TRIAGE.md`); baseline 7,488 findings across 5 scopes,
  every high/critical class individually verified.
- WCAG 2.1 AAA regression gate: axe-core E2E audit
  (`e2e/a11y.spec.ts`, wcag2a/2aa/2aaa + best-practice) on 8 pages.
- Coverage ratchets wired into CI-equivalent local gates: vitest
  thresholds 92/83/81/92 (from measured 92.3/83.15/81.28), Python
  `--cov-fail-under=81` (measured 82.08%).

### Changed
- `openzenith/terrain.py` (3,486 lines) split into a `terrain/` package
  (9 submodules) and `openzenith/hydrology.py` (2,491 lines) into
  `hydrology/` (10 submodules); full public surface preserved
  (77 + 42 re-exported names).
- WCAG AAA contrast across both themes: secondary text `#a3a3a3`
  (dark) / `#525252` (light), accent text ≥ 7:1 on every studio tool
  panel; attribution links underlined (1.4.1); globe/explore `<main>`
  landmarks + globe sr-only `<h1>`.
- ESLint at 0 errors repo-wide (5,800 warn-level); `tsc --noEmit` clean;
  977 vitest + 718 pytest tests green against the raised gates.

## v0.8.2 (2026-09-22)

### Changed
- Landing page monolith extracted (2,151 → 1,520 lines): hero map lifecycle
  (`HeroMap`), geocoder search (`SearchBox`), and result/snippet panel
  (`SnippetTabs`) are self-contained components with callback props.
- Basemap URLs on the hero map now come from the shared registry
  (`src/lib/basemaps.ts`) instead of inline Carto literals; the API-edge
  proxy allowlists are derived from that same registry.
- E2E heavy globe-terrain check asserts what the code owns — uncaught JS
  exceptions and first-party request failures — instead of zero console
  errors (any third-party feed outage on the 15+ feed globe page no longer
  reads as a code regression).

### Fixed
- Geocoder picks used stale coordinates (the click handler read the previous
  render's `lat`/`lon` state before `setState` committed); `lookup()` now
  takes explicit coordinate overrides.
- Snippet "Tile" tab built its map link with the latitude in the `lng`
  parameter when latitude was empty.
- 8 map layers (radar, earthquakes, warnings, events, air quality, waterways,
  NLNOG, wildfires) swallowed fetch failures silently — they now log a
  `[layer:<id>]` diagnostic and flag the layer "error" status.
- Every globe data fetcher, retry guard, TLE fetch, and WebSocket `onerror`
  now logs through the shared `warnLayerError` diagnostic
  (`src/lib/diagnostics.ts`); the events layer set its status under the
  wrong layer id ("warnings").
- A source-scanning vitest invariant pins the rule: any layer that flags
  error status must log the exception.

### Added
- `api/src/lib/diagnostics.ts` — shared `warnLayerError` / `domEventCause`
  helpers used by map layers, globe layers, and data fetchers.
- E2E suite runs against any `E2E_BASE_URL` (defaults to production); heavy
  Cesium terrain suite is opt-in via `E2E_RUN_HEAVY=1`; firefox project added
  (chromium 32 + firefox 32, local and production parity verified).

### Coverage
- Vitest: 977 passed | 5 skipped across 92 files; statements 92.1%,
  branches 83.25%, functions 81.25%, lines 92.1%.

## Unreleased

- Added contributor guidance for validating the core, API, UI, and MCP
  surfaces independently.
- Added the repository handoff used by Platform-Architecture qualification.

## v0.8.1 (2026-09-21)

### Fixed
- Landing page tile 429s: tile endpoints (`dem-tile`, `gebco-tile`,
  `elevation-accuracy`, `elevation-color`, `floods-tile`, `contours`) are
  exempt from the edge rate limiter — map views burst dozens of immutable,
  CDN-cached tile requests per load.
- Light-mode hero map never initialized (skip-first-render effect with a
  `dark` dependency could not re-run for light-preference users).
- Removed stale Cesium CSS preload from the landing `<head>` (Early Hints
  kept serving it after removal, producing console warnings).

### Added
- `.gitforge.yml` — GitForge CI pipeline (primary CI/CD; GitHub is a mirror).

## v0.8.0 (2026-08-10)

### Added
- Python SDK: 70 WhiteboxTools-parity functions — terrain analysis (47) +
  hydrology (23), all scipy-vectorized, lazy import.
