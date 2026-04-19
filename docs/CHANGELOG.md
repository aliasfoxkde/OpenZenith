# Changelog

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
