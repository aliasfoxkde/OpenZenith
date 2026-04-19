# Changelog

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
