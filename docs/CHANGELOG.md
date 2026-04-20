# Changelog

## v0.6.1 (2026-04-20)

### Critical Data Source Fixes (2 dead WMS services replaced)
- **Land cover**: EEA CORINE WMS infrastructure fully discontinued. Replaced with NASA GIBS MODIS IGBP Land Cover (EPSG:3857).
- **Population density**: EEA JRC GHSL WMS also discontinued. Replaced with NASA GIBS VIIRS Black Marble (nighttime lights as population proxy).
- **Sentinel-2**: Microsoft TiTiler intermittently down (530 errors). Added GIBS MODIS Terra True Color as automatic fallback.

### Lazy-Load Layer Investigation
- Investigated dynamic imports for 34 off-by-default layers (~8-12KB potential savings).
- **Result: Not viable** — `@cloudflare/next-on-pages` bundles all dynamic imports into single 64KB worker at build time. No code splitting on CF Pages Edge runtime. Reverted cleanly.

### R2 Tile Cache Expansion
- Added R2 cache-aside to 3 more proxy tile routes:
  - `/api/landcover/{z}/{x}/{y}` — GIBS MODIS Land Cover
  - `/api/population/{z}/{x}/{y}` — GIBS VIIRS Black Marble
  - `/api/sentinel2/{z}/{x}/{y}` — PC TiTiler + GIBS MODIS fallback
- Total R2 cached routes: 7 tile + 6 JSON = 13 routes.

### Python SDK — 3 new terrain functions
- `profile_curvature()`: Curvature along slope direction (erosion/deposition indicator)
- `planform_curvature()`: Curvature perpendicular to slope (ridge/valley indicator)
- `drainage_density()`: Stream length per unit area from flow accumulation
- All vectorized NumPy — sub-millisecond for 100×100 grid.
- 10 new tests (134 total passing).

### Service Worker
- Bumped cache version v2 → v3 to bust stale cached tiles.

## v0.6.0 (2026-04-20)

### Data Source Fixes (5 broken sources repaired)
- **Marine weather**: Open-Meteo tile endpoint dead. Replaced with Open-Meteo Marine JSON API, displaying wave height data as color-coded grid points across 36 ocean sample locations.
- **Building footprints**: Overture Maps free tile endpoint dead. Replaced with OpenStreetMap building footprints via Overpass API, loaded on-demand at zoom 12+.
- **Satellite imagery**: GIBS MODIS Terra 1-day date often 404 due to processing delay. Changed to 3-day fallback.
- **Floods**: JRC CDF-Proxy no longer publicly accessible. Returns graceful empty status.
- **GDACS**: RSS feed returns only header (requires auth). Returns graceful empty status.

### Performance — R2 JSON Cache Expansion
- Added R2 cache-aside to 4 more API routes (total: 6 JSON + 4 tile = 10 cached routes).
- `/api/hurricanes` — NOAA IBTrACS (30 min TTL)
- `/api/satellites` — Celestrak (10 min TTL) — eliminates 8-15s cold starts from CF edge
- `/api/nlnog` — Ring NLNOG (60 min TTL)
- `/api/military` — ADSB Exchange (60s TTL)

### SEO
- Enhanced page titles with descriptive keywords for all 4 sub-pages.
- Added OpenGraph metadata to /map, /globe, /explore, /studio.

### Python SDK
- New terrain analysis functions: `tpi()`, `roughness()`, `curvature()`, `tri()`.
- All vectorized with NumPy — 6-50ms for 500×500 grid.
- 13 new tests (99 total passing).

## v0.5.4 (2026-04-20)

### Performance
- **R2 cache-aside for tile routes**: Elevation color, DEM tile, contours, and hillshade tiles cached in R2. 3-9× faster on repeat requests (500ms → 130-190ms TTFB).
- **R2 cache for JSON APIs**: Earthquakes (3.4× faster) and wildfires (2× faster) cached in R2 with TTL.
- **Cursor debounce**: Mouse movement re-renders reduced from 60/s to ~12/s (80ms throttle).
- **Globe CallbackProperty reduction**: 12 per-frame JS callbacks removed (13→2). Remaining 2 are legitimate animations.
- **Cesium preloading**: CSS preload + preconnect hints in layout for faster first paint on globe page.

### Python SDK
- **Vectorized viewshed**: Angular ray casting algorithm replaces triple-nested Python loops. 347× faster (18.4s → 0.053s for 200×200 grid). 500×500 grid in 0.088s.
- **Optional Numba JIT**: viewshed supports Numba compilation when installed for even faster execution.
- All 86 Python tests pass.

### Data Source Fixes
- **NOAA Aurora**: API URL changed from `ovation_aurora_forecast_map.json` → `ovation_aurora_latest.json`. Updated both 2D and 3D layers.
- **Volcanoes**: USGS volcano feed discontinued. Migrated to Smithsonian GVP weekly RSS feed with georss:point parsing.
- **GDACS**: Public API discontinued. Returns graceful empty status.

### UX
- **Landing page**: Added elevation-accuracy overlay to hero map (satisfies default visible layer requirement).
- **Duplicate basemap selector**: Removed broken second basemap panel from sidebar.
- **Basemap ordering**: Fixed to use BASEMAP_ORDER constant for consistent display.
- **Version bump**: Health endpoint and OpenAPI spec updated to 0.5.4.

### Infrastructure
- New: `r2-json-cache.ts` — Generic R2 cache module for JSON API responses with TTL.
- New: `r2-tile-cache.ts` — R2 cache-aside for generated tile data.
- Updated: `PERFORMANCE_AUDIT.md` — 11/13 items complete with live metrics.

## v0.5.3 (2026-04-19)

### Performance
- CF Cache API code fix (`caches.open()` replaces broken `(caches as any).default`).
- Merged file caching via CF Cache API for cross-isolate persistence.
- Python `fill_depressions()` edge initialization vectorized.

## v0.5.2 (2026-04-18)

### Features
- Hurricane full tracks with polyline rendering and timestamp animation.
- Responsive mobile sidebar (85vw width, backdrop overlay, swipe-to-close).
- Python SDK test expansion: tile format + converter tests (86 total).

## v0.5.1 (2026-04-18)

### Data Sources
- Satellites: increased timeout 10s→15s, cache 5→10min (Celestrak slow from CF edge)
- Flights: increased timeout 8s→20s, cache 60→120s (OpenSky slow from CF edge)
- Both return graceful empty on timeout instead of breaking map

### Python SDK
- **New terrain.py**: slope, slope_fast, aspect, hillshade, viewshed, profile
- Fixed dz_dx/dz_dy swap in gradient calculations (columns vs rows)
- Fixed aspect formula for correct GIS compass convention (N=0°, CW)
- 12 new pytest tests (slope, aspect, hillshade, viewshed, profile)
- Total: 30 Python tests across 3 test files
- CLI: added `slope`, `hillshade`, `viewshed` commands
- Fixed `pip install`: setuptools → hatchling build backend (Python 3.13 compatible)

### Map UX
- Layer toggle state persisted to localStorage (`openzenith-map-layers`)
- Layer preferences survive page reload
- Toast notifications for layer load errors (fixed position, auto-dismiss)

### Code Quality
- Split monolithic `layers.ts` (1380 lines) into 18 per-layer modules
- Each layer in its own file: types.ts, earthquakes.ts, warnings.ts, events.ts, etc.
- Barrel index: `layers/index.ts` with `addDataLayer`/`removeDataLayer`/`MAP_2D_LAYER_IDS`
- Deleted 13 archived planning docs (208KB→48KB)

## v0.5.0 (2026-04-18)

### Terrain System
- Fixed all zoom levels z0-z10 — AWS Terrain Tiles direct for z0-z6, HuggingFace for z7-z10
- Fixed 4 corrupted SRTM tiles (N36W116, S03E037, S32W070, N19W155) with AWS fallback
- Replaced fflate inflateSync with DecompressionStream("deflate") for PNG IDAT decoding
- Reduced tile cache TTL from 30 days to 1 hour
- Added elevation-color heatmap (minzoom 7), elevation-accuracy overlay, topo contours

### Data Sources
- Flights: Slimmed response, graceful 200 on timeout, 60s cache
- Satellites: Default "space-station" group, 500-entry truncation
- NLNOG: Fixed nested API response parsing (results.nodes)
- Wildfires: Graceful empty response with helpful message
- All sources return 200 on failure (no more 502 map breakage)

### Map UX
- Layer status tracking: loading ⟳, loaded ✓, empty ∅, error ✕
- Live status badges in sidebar layer toggles
- LayerHandle with onStatusChange callback

### Python SDK
- 16 pytest tests (elevation + hydrology)
- Fixed Mercator coordinate calculation in load_elevation_grid
- Fixed NaN handling in hydrology/tracing modules
- flow_accumulation_fast (topological sort) verified correct

### Code Quality
- Version: 0.1.0 → 0.5.0
- TypeScript: 0 errors, 7 pre-existing warnings
- All 178 tests passing
- Prettier formatted
- Documentation consolidated (13 planning docs → archive)

## v0.1.0 (2026-03-25)

### Initial Release
- 3D globe (CesiumJS) + 2D map (MapLibre GL)
- 49 API routes
- Terrain elevation from SRTM 30m
- Earthquakes, hurricanes, vessels, NLNOG, satellites, weather radar
- Hillshade, boundaries, measurement tools
- 5 basemap themes

## v0.6.2 (2026-04-20)

### Critical: All API routes now return 200 on failure
- Changed 32 5xx status codes (502/500/503) → 200 across 23 routes
- Map layers never break from upstream failures
- Error details still included in response body

### Performance
- **Weather warnings**: 1.7MB → 348KB (80% reduction)
  - Stripped verbose `description` (369KB), `parameters` (337KB), `instruction` (67KB)
  - Retains display-relevant fields: headline, severity, event, geometry
- Added R2 cache to `/api/weather/warnings` (2min TTL)

### Python SDK Tests
- **29 new tests** (163 total, was 134)
- New test files: `test_tile_format_v2.py` (20 tests), `test_tracing.py` (6 tests), `test_terrarium.py` (8 tests)
- Tests use proper tolerance for lossy OZT2 format (±1m precision)

### Documentation
- Fixed OG url: `openzenith.cyopsys.com` → `openzenith.pages.dev`
