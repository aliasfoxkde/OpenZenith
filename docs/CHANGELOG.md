# Changelog

All notable changes to OpenZenith.

## [0.2.0] - 2026-03-25

### Added
- Interactive API documentation page (`/api/docs`) with endpoint details, parameter tables, response examples, and try-it-out buttons
- Hero banner with mountain silhouette on landing page
- Sticky navigation bar that stays on top during scroll
- Self-hosting section to landing page features
- Bilinear interpolation for elevation queries (improved accuracy from nearest-neighbor)
- OpenAPI 3.0.3 specification endpoint (`/api/openapi.json`)
- USAGE.md documentation with detailed API guide
- CHANGELOG.md

### Fixed
- Map page (`/demo`) white screen - MapLibre GL script loading issue with polling retry
- MapLibre script loading strategy changed from `lazyOnload` to `afterInteractive`
- Turbopack root configuration for correct workspace resolution
- Elevation lookup card missing closing div causing build failure

### Changed
- Moved OpenAPI spec from `/api/docs` route to `/api/openapi.json` route
- API docs now render as interactive HTML instead of raw JSON

## [0.1.0] - 2026-03-22

### Added
- Initial deployment to Cloudflare Pages at openzenith.pages.dev
- Elevation API endpoint with SRTM 30m data
- Tile server endpoint (z/x/y) with raw Int16 binary format
- Health check endpoint
- Interactive demo map with MapLibre GL and hillshade
- Landing page with elevation lookup form
- HuggingFace storage backend with merged chunk format
- Cloudflare Cache API integration for edge caching
- Deflate decompression for chunk data (fflate)
