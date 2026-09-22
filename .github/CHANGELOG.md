# Changelog

Format follows Keep a Changelog; versions match git tags. Fuller history
(latest: v0.6.4) lives in `docs/archive/CHANGELOG.md`.

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
- `.gitforce.yml` — GitForge CI pipeline (primary CI/CD; GitHub is a mirror).

## v0.8.0 (2026-08-10)

### Added
- Python SDK: 70 WhiteboxTools-parity functions — terrain analysis (47) +
  hydrology (23), all scipy-vectorized, lazy import.
