# Changelog

All notable changes to OpenZenith are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

### Added

### Changed

### Deprecated

### Removed

### Fixed

### Security

---

## v0.7.0 (2026-04-19)

### System Theme and Landing Page
- **System/auto theme**: Respects OS light/dark preference, persisted to localStorage
- **Theme toggle button**: Sun/moon toggle on landing page Navbar
- **Layout boot script**: Reads saved theme before first paint (no flash)
- **Landing page spacing fixes**: Features section padding, section gaps, grid improvements
- **Globe Data Layers section**: Proper heading + subtitle, better visual hierarchy
- **Feature grid**: Wider min (260px), 480px single-column breakpoint

### Map Dark Mode Contrast
- **Land contrast overlay**: Semi-transparent fill on dark basemaps using Natural Earth land GeoJSON
- **New 'Dark+' basemap option**: In basemap selector
- **Default basemap follows OS theme**: dark/voyager auto-selected based on system preference
- **'Match OS' button**: Quick theme sync in map sidebar

### Globe Fixes (Phase 1)
- **Layer toggle bug fixed**: Layers properly reload when toggled OFF then back ON
- **Terrain provider rewritten**: Proper TerrainProvider prototype chain with required CesiumJS 1.119 interface methods

### Globe Symbology Upgrades (Phase 3)
- **Wildfires**: Thermal glow ellipses proportional to Fire Radiative Power (FRP)
- **Lightning**: 30km glow ellipse for each strike for flash illumination effect

### GIBS Environmental Layers — 26 New Tile Routes
Created shared `/lib/gibs-tile.ts` infrastructure with `createGIBSHandler()` factory function.

**Sprint A — SAR and Fire (3 routes)**
- Floods: VIIRS Combined 3-Day Flood (z0-9, 24h cache)
- Fire Temperature: GOES-East ABI FireTemp (z1-9, 1h)
- SAR Backscatter: OPERA L2 RTC Sentinel-1 (z1-10, 7d)

**Sprint B — Environmental Monitoring (7 routes)**
- Dynamic Surface Water: OPERA L3 Surface Water Extent (z0-9, 24h)
- Disturbance Alerts: OPERA L3 DIST-ALERT HLS (z0-8, 24h)
- SO2 Volcanic: TROPOMI Sulfur Dioxide Column (z0-5, 1h)
- NO2 Pollution: TROPOMI Nitrogen Dioxide Column (z0-5, 1h)
- Precipitation: IMERG Precipitation Rate (z0-8, 1h)
- Soil Moisture: SMAP L3 Active Soil Moisture (z0-3, 24h)
- NDVI Vegetation: MODIS Terra 16-Day NDVI (z0-9, 7d)

**Sprint C — Ocean and Terrain (7 routes)**
- Sea Surface Temp: GHRSST L4 MUR SST (z0-8, 24h)
- Chlorophyll-a: MODIS Aqua Chlorophyll A (z0-7, 24h)
- Snow Cover: MODIS Terra Snow Extent 8-Day (z0-8, 7d)
- Canopy Height: GEDI ISS L3 Canopy Height Mean (z0-8, 7d)
- Aboveground Biomass: GEDI ISS L4B Biomass Density (z0-8, 7d)
- Sea Surface Salinity: SMAP L3 Sea Surface Salinity Monthly (z0-5, 7d)
- Sea Surface Height: JPL Sea Surface Height Anomalies (z0-6, 24h)

**Sprint D — Risk and Air Quality (5 routes)**
- Flood Hazard: NDH Flood Hazard Frequency 1985-2003 (z0-8, 7d)
- Landslide Hazard: NDH Landslide Hazard Distribution 2000 (z0-8, 7d)
- Drought Hazard: NDH Drought Hazard Frequency 1980-2000 (z0-8, 7d)
- PM2.5: Particulate Matter Below 2.5um 2010-2012 (z0-5, 7d)
- AOD: MODIS Aqua AOD Deep Blue Combined (z0-5, 24h)

### Layer Registry
- **59 total layers** (was 37)
- 26 new raster tile layers with MapLibre dispatchers
- RASTER_LAYERS set: 28 total

### Tests
- **76 GIBS tile tests** (4 per route x 19 routes in shared test file)
- **3 individual route tests** (floods-tile, fire-temperature, sar-backscatter)
- **47 total test files**
- **All tests pass, TypeScript clean**

### API Routes
- **63 total** (was 50)
- All with `export const runtime = 'edge'`
- Zero 5xx status codes

### R2 Cached Routes
- **26+ total** (14 previous + 12 new GIBS tile routes with r2GetTile/r2PutTile)

---

## v0.6.4 (2026-04-20)

### Complete: All API routes return 200
- Last remaining 5xx eliminated: gebco-tile 501 to 200
- All 47 API routes now return HTTP 200 under all conditions

### Keyboard shortcuts: all pages
- **Map**: H (hillshade), R (radar), G (earthquakes), 3 (satellite), P (measure), B (boundaries)
- **Explore**: 1-7 number keys switch between tabs
- **Studio**: L (sidebar), I (imperial toggle), Esc (close)

### Accessibility
- Explore: role="tablist", role="tab" with aria-selected, role="tabpanel"
- Studio: aria labels on sidebar toggle
- Map: keyboard shortcut hints in sidebar panel

---

## v0.6.3 (2026-04-20)

### Map UX: Keyboard shortcuts
- H toggles hillshade, R toggles radar, G toggles earthquakes
- 3 toggles satellite imagery, P toggles measure mode, B toggles boundaries
- L toggles sidebar, ? opens sidebar, Esc closes sidebar/cancels
- Keyboard shortcut hints displayed at top of sidebar panel

### Map UX: Opacity persistence
- Layer opacity settings now persist to localStorage
- Opacity preferences survive page reloads

### Python SDK
- **5 new CLI tests** (168 total)
- Fixed `_parse_zoom_levels` to support mixed format: `0-3,5,7-9`
- All 11 modules now have test files with coverage

---

## v0.6.2 (2026-04-20)

### Critical: All API routes now return 200 on failure
- Changed 32 5xx status codes (502/500/503) to 200 across 23 routes
- Map layers never break from upstream failures

### Performance
- **Weather warnings**: 1.7MB to 348KB (80% reduction)
- Added R2 cache to `/api/weather/warnings` (2min TTL)

### Python SDK Tests
- **29 new tests** (163 total, was 134)
- New test files: `test_tile_format_v2.py` (20 tests), `test_tracing.py` (6 tests), `test_terrarium.py` (8 tests)

---

## v0.6.1 (2026-04-20)

### Critical Data Source Fixes
- **Land cover**: EEA CORINE WMS discontinued. Replaced with NASA GIBS MODIS IGBP Land Cover
- **Population density**: EEA JRC GHSL WMS discontinued. Replaced with NASA GIBS VIIRS Black Marble
- **Sentinel-2**: Added GIBS MODIS Terra True Color as automatic fallback

### R2 Tile Cache Expansion
- Added R2 cache-aside to 3 more proxy tile routes (total: 13 routes)

### Python SDK — 3 new terrain functions
- `profile_curvature()`: Curvature along slope direction
- `planform_curvature()`: Curvature perpendicular to slope
- `drainage_density()`: Stream length per unit area
- All vectorized NumPy — sub-millisecond for 100x100 grid
- 10 new tests (134 total passing)

---

## v0.6.0 (2026-04-20)

### Data Source Fixes (5 broken sources repaired)
- **Marine weather**: Replaced with Open-Meteo Marine JSON API
- **Building footprints**: Replaced with OpenStreetMap building footprints via Overpass API
- **Satellite imagery**: Changed to 3-day fallback for GIBS MODIS Terra
- **Floods**: JRC CDF-Proxy no longer publicly accessible
- **GDACS**: Returns graceful empty status

### Performance — R2 JSON Cache Expansion
- Added R2 cache-aside to 4 more API routes (total: 10 cached routes)
- `/api/hurricanes`, `/api/satellites`, `/api/nlnog`, `/api/military`

### Python SDK
- New terrain analysis functions: `tpi()`, `roughness()`, `curvature()`, `tri()`
- All vectorized with NumPy — 6-50ms for 500x500 grid
- 13 new tests (99 total passing)

---

## v0.5.4 (2026-04-20)

### Performance
- **R2 cache-aside for tile routes**: Elevation color, DEM tile, contours, hillshade tiles cached in R2
- **R2 cache for JSON APIs**: Earthquakes (3.4x faster), wildfires (2x faster)
- **Cursor debounce**: Mouse movement re-renders reduced from 60/s to ~12/s

### Python SDK
- **Vectorized viewshed**: Angular ray casting algorithm, 347x faster (18.4s to 0.053s)
- **Optional Numba JIT**: viewshed supports Numba compilation when installed
- All 86 Python tests pass

---

## v0.5.3 (2026-04-19)

### Performance
- CF Cache API code fix (`caches.open()` replaces broken pattern)
- Merged file caching via CF Cache API for cross-isolate persistence
- Python `fill_depressions()` edge initialization vectorized

---

## v0.5.2 (2026-04-18)

### Features
- Hurricane full tracks with polyline rendering and timestamp animation
- Responsive mobile sidebar (85vw width, backdrop overlay, swipe-to-close)
- Python SDK test expansion: tile format + converter tests (86 total)

---

## v0.5.1 (2026-04-18)

### Data Sources
- Satellites: increased timeout 10s to 15s, cache 5 to 10min
- Flights: increased timeout 8s to 20s, cache 60 to 120s
- Both return graceful empty on timeout instead of breaking map

### Python SDK
- **New terrain.py**: slope, slope_fast, aspect, hillshade, viewshed, profile
- Fixed dz_dx/dz_dy swap in gradient calculations
- Fixed aspect formula for correct GIS compass convention
- 12 new pytest tests (30 total)
- CLI: added `slope`, `hillshade`, `viewshed` commands

### Map UX
- Layer toggle state persisted to localStorage
- Toast notifications for layer load errors

---

## v0.5.0 (2026-04-18)

### Terrain System
- Fixed all zoom levels z0-z10 — AWS Terrain Tiles direct for z0-z6, HuggingFace for z7-z10
- Fixed 4 corrupted SRTM tiles with AWS fallback
- Replaced fflate with DecompressionStream for PNG IDAT decoding
- Reduced tile cache TTL from 30 days to 1 hour

### Data Sources
- Flights: Slimmed response, graceful 200 on timeout
- Satellites: Default "space-station" group, 500-entry truncation
- All sources return 200 on failure (no more 502 map breakage)

### Python SDK
- 16 pytest tests (elevation + hydrology)
- Fixed Mercator coordinate calculation in load_elevation_grid
- Fixed NaN handling in hydrology/tracing modules
- flow_accumulation_fast verified correct

---

## v0.1.0 (2026-03-25)

### Initial Release
- 3D globe (CesiumJS) + 2D map (MapLibre GL)
- 49 API routes
- Terrain elevation from SRTM 30m
- Earthquakes, hurricanes, vessels, NLNOG, satellites, weather radar
- 5 basemap themes
