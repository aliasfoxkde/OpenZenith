# Changelog

Format follows Keep a Changelog; versions match git tags. Fuller history
(latest: v0.6.4) lives in `docs/archive/CHANGELOG.md`.

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
