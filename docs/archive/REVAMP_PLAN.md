# OpenZenith Revamp Plan — Systematic Improvement Roadmap

**Created:** 2026-04-18
**Status:** Active Development
**Scope:** Map improvements, Python SDK, documentation

---

## Overview

Three parallel workstreams:

1. **Map Visual Enhancements** — Elevation heatmap, accuracy heatmap, elevation contours
2. **Python SDK Expansion** — Data download CLI, flow simulation, downstream tracing, examples
3. **Documentation & Integration** — Local vs API usage guide, website updates

---

## Workstream 1: Map Visual Enhancements

### 1A. Elevation Color Heatmap (`/api/elevation-color/{z}/{x}/{y}`)

**Goal:** Color-ramped elevation tiles showing actual terrain height.

**Implementation:**
- New API route that reuses the existing `getTileData()` assembler
- Maps elevation values → RGB colors via a standard hypsometric color ramp
- Served as raster tiles for MapLibre
- Colors: deep blue (ocean/low) → cyan → green → yellow → brown → gray → white (peaks)

**Color ramp (Atlas hypsometric):**
```
-500m:  #000044 (deep ocean)
   0m:  #08306b (sea level)
  50m:  #2171b5 (coast)
 200m:  #41ab5d (lowland)
 500m:  #addd8e (hills)
1000m:  #f7dc6f (foothills)
2000m:  #e6550d (mountains)
4000m:  #a52a2a (high mountains)
6000m:  #636363 (peaks)
8000m+: #ffffff (snow)
```

**Registry:** `defaultEnabled: false` — toggleable

### 1B. Elevation Accuracy Heatmap (`/api/elevation-accuracy/{z}/{x}/{y}`)

**Goal:** Static raster showing data source resolution/accuracy per tile.

**Implementation:**
- Pure server-side — no DEM tile assembly needed
- Resolution determined by lat/lon of each pixel:
  - Copernicus EEA 10m (Europe bounding box) → bright green
  - ArcticDEM 2m (lat > 60°N) → cyan
  - REMA 2m (Antarctica) → cyan
  - SRTM/Copernicus GLO-30 (±60° lat, land) → green
  - GLO-90 (rest of land) → yellow-green
  - GEBCO 450m (ocean) → blue
  - No data → dark gray

**Registry:** `defaultEnabled: true` — the DEFAULT visible layer

### 1C. Elevation Contours (`/api/contours/{z}/{x}/{y}`)

**Goal:** Topographic contour lines as vector tiles.

**Implementation:**
- Marching squares algorithm on assembled elevation grid
- Major contours every 500m, minor every 100m
- Served as GeoJSON or MVT vector tiles
- Line styling with color-coded elevation labels

**Registry:** `defaultEnabled: false` — toggleable

### 1D. Layer Registration & Defaults

- Add all 3 new layers to `registry.ts`
- Add accuracy heatmap as default-enabled
- Update `buildDefaultLayers()` in `map/page.tsx`
- Wire add/remove functions in `layers.ts`

---

## Workstream 2: Python SDK Expansion

### 2A. Installable Package (`pip install openzenith`)

**Current state:** `openzenith/` package with terrarium, OZT1/OZT2 codecs, elevation queries

**Additions:**
- `pyproject.toml` with proper metadata, CLI entry point, optional deps
- `openzenith download` CLI command for data acquisition
- Region-based downloading (by bbox, country name, or lat/lon/radius)
- Progress bars, resume support, disk space estimation

### 2B. Flow Simulation (`openzenith.hydrology`)

- D8 flow direction algorithm on elevation grids
- Flow accumulation (upstream area calculation)
- Stream network extraction (threshold-based)
- Watershed delineation (pour point → boundary)

### 2C. Downstream Tracing (`openzenith.tracing`)

- From any point, trace downstream path to river mouth/ocean
- Uses D8 flow directions
- Returns path coordinates, cumulative distance, elevation profile
- Useful for: spill tracking, flood routing, trajectory planning

### 2D. Examples & Tutorials

- `examples/01_quickstart.py` — Basic elevation query
- `examples/02_flow_simulation.py` — Watershed delineation
- `examples/03_downstream_trace.py` — Trace path to ocean
- `examples/04_contour_extraction.py` — Generate contour lines
- `examples/05_batch_processing.py` — Process large regions efficiently

---

## Workstream 3: Documentation & Integration

### 3A. SDK Documentation

- Comprehensive README.md for the Python package
- API reference for all public functions
- Performance comparison: local SDK vs web API latency
- When to use local SDK (batch processing, simulations, offline) vs API (simple queries, web apps)

### 3B. Website Documentation Updates

- Add "Developers" section to the website
- Document the Python SDK with installation and usage
- Add "Local Processing" page explaining benefits over API
- Link to PyPI package

### 3C. Progress Tracking

- This document serves as the master tracking doc
- Update status after each completed task

---

## Workstream 4: Cross-Validation Against External Elevation APIs

### 4A. Validation Strategy

Sanity-check OpenZenith elevation data against established free/open elevation APIs.
This catches encoding bugs, coordinate system errors, tile assembly mistakes,
and coverage gaps. It also quantifies accuracy relative to authoritative sources.

### 4B. External Reference APIs (Free/Open)

| API | Resolution | Coverage | Auth | Rate Limit | Format |
|-----|-----------|----------|------|-----------|--------|
| **Open-Elevation** (`api.open-elevation.com`) | 30m (SRTM/GTOPO) | Global | None | ~100/min | JSON |
| **USGS EPQS** (`epqs.nationalmap.gov`) | 30m/10m (NED) | US/territories | None | None | JSON |
| **OpenTopography** (`portal.opentopography.org`) | 30m-1m (multi) | Global (varies) | API key (free) | ~50/min | JSON |
| **AWS Terrain Tiles** (`s3.amazonaws.com/elevation-tiles-prod`) | 30m (Mapzen/Terrarium) | Global | None (public S3) | CDN | Terrarium PNG |
| **Maptiler** (`api.maptiler.com`) | 30m (Copernicus) | Global | API key (free tier) | 100K/mo | Terrarium PNG |
| **Google Elevation** (`maps.googleapis.com`) | ~30m | Global | API key (paid) | ~200/mo | JSON |

### 4C. Ground Truth Benchmark Points

A curated set of well-known elevation points for spot-checking:

| Point | Lat | Lon | Expected Elev (m) | Source | Data Source |
|-------|-----|-----|------------------|--------|-------------|
| Mount Everest summit | 27.9881 | 86.9250 | 8,848.86 | 2020 survey | SRTM/GLO-30 |
| Death Valley lowest | 36.4637 | -116.8661 | -85.5 | USGS NED | SRTM/GLO-30 |
| Dead Sea shore | 31.5 | 35.5 | -434 | Survey | GEBCO/SRTM gap |
| Mont Blanc summit | 45.8326 | 6.8652 | 4,805.59 | 2021 survey | GLO-30 |
| Denali summit | 63.0695 | -151.0074 | 6,190 | USGS | ArcticDEM |
| Kilimanjaro summit | -3.0674 | 37.3556 | 5,895 | Survey | GLO-30 |
| NY Central Park | 40.7829 | -73.9654 | ~34 | USGS 3DEP | SRTM |
| Mid-Atlantic Ridge | 0 | -25 | -2,000 to -3,500 | GEBCO | GEBCO 2025 |
| Mariana Trench | 11.3493 | 142.1996 | -10,935 | Survey | GEBCO 2025 |
| Ocean (mid-Pacific) | 0 | -160 | -4,500 to -5,500 | GEBCO | GEBCO 2025 |
| Paris (sea-level city) | 48.8566 | 2.3522 | ~35 | Survey | GLO-30 |
| Sahara (flat desert) | 23.4162 | 25.6628 | ~450 | GLO-30 | GLO-30 |
| Grand Canyon rim | 36.1069 | -112.1129 | ~2,100 | USGS NED | SRTM |
| Sydney Harbor | -33.8568 | 151.2153 | ~3 | Survey | GLO-30 |
| North Pole (ice) | 90 | 0 | ~0 (ice sheet) | GEBCO | GEBCO 2025 |
| Sahara coast (sea level) | 28.0 | 0.0 | 0 | GEBCO | GEBCO 2025 |

### 4D. Validation Modes

**1. Spot-check Mode (Python script)**
```bash
# Validate OpenZenith API against Open-Elevation + USGS at known points
python scripts/validate_elevation.py --mode spot

# Cross-validate against a specific external API
python scripts/validate_elevation.py --mode spot --reference open-elevation
```

**2. Statistical Sampling Mode**
```bash
# Random 1000 points, compare OpenZenith vs Open-Elevation
python scripts/validate_elevation.py --mode sample --n 1000 --reference open-elevation

# Regional deep-dive: 5000 points in Europe vs Maptiler
python scripts/validate_elevation.py --mode sample --n 5000 --bbox 35,0,60,30 --reference maptiler
```

**3. Tile Comparison Mode**
```bash
# Compare Terrarium PNG tiles: OpenZenith vs AWS Terrain Tiles
python scripts/validate_elevation.py --mode tile --z 8 --x 217 --y 151
```

**4. Coverage Audit Mode**
```bash
# Where does OpenZenith have data vs not, across global grid
python scripts/validate_elevation.py --mode coverage --step 1.0
```

### 4E. Metrics Collected

Per comparison:
- **RMSE** (root mean square error) in meters
- **MAE** (mean absolute error) in meters
- **Max absolute error** in meters
- **Mean bias** (systematic offset) in meters
- **Coverage %** (non-null results vs total queries)
- **Latency** (p50, p95, p99) for each API
- **Null agreement** (% where both return null = both say "ocean" or "no data")
- **Sign disagreement** (both non-null but different sign = one says ocean, other says land)

### 4F. Known Limitations to Document

- SRTM is C-band InSAR — penetration through vegetation canopy means elevations
  are DSM-like (not true DTM). Expect ~5-20m error in dense forests.
- SRTM void-filling in the original data causes artifacts in some mountain areas.
- GEBCO bathymetry is 450m (15 arcsec) — do not expect sub-100m accuracy for ocean depth.
- Open-Elevation itself uses SRTM/GTOPO — so comparing against it is circular for land.
  The real value is validating encoding, tile assembly, and interpolation correctness.
- USGS EPQS uses higher-resolution NED for the US — expect OpenZenith to diverge
  by ±10-16m in rough terrain (SRTM 30m vs NED 10m).

### 4G. Validation Deliverables

- `scripts/validate_elevation.py` — Reusable validation script
- `docs/VALIDATION_REPORT.md` — Results summary with tables and maps
- Automated CI check: fail if RMSE > 20m against Open-Elevation (catches encoding bugs)

---

## Execution Order

### Sprint 1 (this session): Map Visual Enhancements

1. [x] Read existing codebase and planning docs
2. [ ] Create `/api/elevation-color/{z}/{x}/{y}` endpoint
3. [ ] Create `/api/elevation-accuracy/{z}/{x}/{y}` endpoint
4. [ ] Create `/api/contours/{z}/{x}/{y}` endpoint (vector tiles)
5. [ ] Add all 3 layers to `registry.ts`
6. [ ] Add add/remove functions to `layers.ts`
7. [ ] Update `map/page.tsx` defaults (accuracy ON by default)
8. [ ] Test and verify

### Sprint 2: Cross-Validation

9. [ ] Create `scripts/validate_elevation.py` with spot-check mode
10. [ ] Implement statistical sampling against Open-Elevation
11. [ ] Implement tile-level comparison against AWS Terrain Tiles
12. [ ] Implement coverage audit mode
13. [ ] Run full validation and document results in `VALIDATION_REPORT.md`

### Sprint 3: Python SDK Expansion

14. [ ] Create `pyproject.toml` with CLI entry point
15. [ ] Build `openzenith download` CLI command (region-based, resume support)
16. [ ] Implement D8 flow direction algorithm
17. [ ] Implement flow accumulation + stream network extraction
18. [ ] Implement downstream tracing (point → river mouth/ocean)
19. [ ] Create examples directory with tutorials

### Sprint 4: Documentation

20. [ ] Write SDK README with full API docs
21. [ ] Write "Local vs API" comparison page
22. [ ] Update main project README
23. [ ] Add performance benchmarks (local SDK vs API latency)

---

## Storage Budget (R2, 6GB max)

Current usage estimate: ~1.7GB (z0-8 + z10)
New tile endpoints are computed on-the-fly (no R2 storage needed for accuracy heatmap)
Elevation color tiles could be optionally cached in R2 (lazy cache-on-demand)
Contours are computed on-the-fly (vector tiles are small)

**No additional R2 storage required for Sprint 1.**

---

## Key Files Modified

- `api/src/app/api/elevation-color/[z]/[x]/[y]/route.ts` (new)
- `api/src/app/api/elevation-accuracy/[z]/[x]/[y]/route.ts` (new)
- `api/src/app/api/contours/[z]/[x]/[y]/route.ts` (new)
- `api/src/lib/layers/registry.ts` (update)
- `api/src/app/map/lib/layers.ts` (update)
- `api/src/app/map/page.tsx` (update)
- `scripts/validate_elevation.py` (new)
- `docs/VALIDATION_REPORT.md` (new)
- `openzenith/pyproject.toml` (new/rewrite)
- `openzenith/hydrology.py` (new)
- `openzenith/tracing.py` (new)
- `openzenith/cli.py` (new)
- `examples/` (new directory)
