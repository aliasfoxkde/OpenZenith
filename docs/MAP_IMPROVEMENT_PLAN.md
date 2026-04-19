# Map Improvement Plan — Comprehensive Audit & Implementation

**Created:** 2026-04-18
**Status:** Implementation Plan
**Scope:** 2D Map page — first-load experience, "No Data" fixes, performance, elevation heatmaps

---

## Table of Contents

1. [Audit Findings](#1-audit-findings)
2. [Root Cause Analysis: "No Data" Issues](#2-root-cause-analysis-no-data-issues)
3. [Performance Bottlenecks](#3-performance-bottlenecks)
4. [Implementation Plan](#4-implementation-plan)
5. [R2 Storage Budget](#5-r2-storage-budget)
6. [Phased Rollout](#6-phased-rollout)

---

## 1. Audit Findings

### 1.1 "No Data" Root Causes

| Layer/Feature | "No Data" Frequency | Root Cause | Fix |
|---|---|---|---|
| **Elevation click** | High (ocean areas) | SRTM coverage is ±60° lat only, NODATA=-32768 = ocean. GEBCO fallback fails silently on CEDA range request errors (CORS, timeouts) | Fix GEBCO fallback reliability; show ocean depth instead of "No data" |
| **Vessels (AIS)** | Always | `AISSTREAM_KEY` not configured → 503 response with error message | Graceful degradation: show "AIS requires API key" in sidebar, not as data layer error |
| **Flights** | Moderate | OpenSky Network rate-limits anonymous access heavily (returns empty states array) | Better error messaging; show "Rate limited" status |
| **Military ADS-B** | High | ADSB Exchange requires API key (402/403) | Same graceful degradation |
| **Waterways** | High | Overpass API timeout (25s) + only fetches around current center with 50km radius | Increase radius, improve bbox calculation from viewport |
| **Air Quality** | Moderate | Only queries single lat/lon center point → returns 1 station feature | Query a grid of stations for visible area |
| **Wildfires** | Moderate | `FIRMS_API_KEY` not configured → empty features | Check API key status in layer loader |
| **Hurricanes** | Seasonal | No active storms = empty data → shows nothing | Show "No active storms" indicator |
| **Weather Warnings** | US-only | API only covers US NWS alerts | Note in layer description |

### 1.2 Data Layer Issues

1. **Earthquakes layer** (default ON): Fetches from USGS directly (not via /api proxy) — no CORS headers for GeoJSON. Works because USGS has CORS, but if it fails the layer silently has no data.

2. **Hurricane Tracks** (layers.ts): Fetches entire 3-year IBTrACS CSV (~10MB) client-side and parses it in the browser. Very slow on first load, includes a buggy `wind` lookup that references `lines.find()` inside a loop (O(n²)).

3. **Natural Events** (layers.ts): Uses `marker-15` icon from MapLibre default style but no icon source is defined in the dark basemap style → invisible markers.

4. **NLNOG Nodes**: `/api/nlnog` returns `{nodes: [...], count: N}` but the layer loader expects `data.features` GeoJSON format → mismatch → no data rendered.

5. **No loading indicators**: Users see nothing while data fetches. Only earthquakes and a few others have auto-refresh intervals.

### 1.3 Map Initialization Issues

1. **Default view**: Dark basemap + hillshade + boundaries + earthquakes + natural events. Looks decent but not "graphically stunning."
2. **No elevation data shown by default** — user must click to query.
3. **No elevation heatmap by default** — the `elevationColor` layer exists in the registry but has NO implementation in the 2D map layers.ts.
4. **No resolution/accuracy overlay** — doesn't exist at all.
5. **Sidebar hidden by default** — users must click "Layers" button to discover available layers.

### 1.4 Performance Issues

1. **DEM tile assembly**: Each `/api/dem-tile/{z}/{x}/{y}` request fetches 1-4 chunks from HuggingFace, decompresses with fflate, and encodes Terrarium PNG. Average cold start: ~2-5s per tile.
   - Chunk size: 256x256 = ~131KB raw, ~5-20KB compressed
   - Merge files: ~2-5MB per SRTM tile (15x15 chunks)
   - No server-side caching to R2

2. **Point elevation**: Each click queries HuggingFace → merged file → chunk → decompress. Cold: ~1-3s. The in-memory `cache.ts` uses Map with TTL but edge workers have isolated memory per request.

3. **No pre-warming**: When user loads the map, no data is fetched until they toggle layers.

4. **Terrarium PNG encoding**: Done on-the-fly per request. Could be pre-built and stored on R2.

5. **Hurricane CSV parsing**: The entire IBTrACS 3-year CSV is fetched and parsed client-side — this is ~10MB of text data.

---

## 2. Root Cause Analysis: "No Data" Issues

### Primary Causes (by frequency):

1. **Missing API keys** (vessels, wildfires, military flights) — 3 layers permanently broken
2. **SRTM coverage gaps** (ocean, >60° lat) — GEBCO fallback unreliable on edge
3. **Data format mismatches** (NLNOG) — server returns one format, client expects another
4. **Missing style resources** (Natural Events icons) — basemap style lacks icon sprites
5. **Rate limiting** (OpenSky) — anonymous access heavily throttled
6. **Seasonal data gaps** (hurricanes) — no storms = no data
7. **Geographic scope** (warnings) — US-only but shown globally without explanation

### Impact Assessment:
- **Critical**: 3 layers never show data (API keys)
- **High**: 2 layers frequently show no data (elevation ocean, GEBCO failures)
- **Medium**: 2 layers intermittently empty (flights rate limit, waterways timeout)
- **Low**: 2 layers contextually empty (hurricanes seasonal, warnings US-only)

---

## 3. Performance Bottlenecks

### DEM Tile Pipeline (Critical Path)

```
User loads map → MapLibre requests /api/dem-tile/{z}/{x}/{y}
  → Edge Worker: check in-memory cache (miss on cold start)
  → Fetch merged file from HuggingFace (~2-5MB, 8s timeout)
  → Parse OZCHNK01 header
  → Extract 1-4 chunks from merged file
  → Decompress with fflate unzlibSync
  → Undo TIFF horizontal predictor
  → Assemble 256x256 Int16Array
  → Encode Terrarium PNG with fflate zlibSync
  → Return PNG to browser

Cold start: 3-8 seconds per tile
Warm (cached merged file): 200-500ms per tile
With R2 pre-built tiles: 10-50ms (CDN cache hit)
```

### Optimization Opportunities:

| Optimization | Effort | Impact | Storage Cost |
|---|---|---|---|
| Pre-build z0-z10 tiles → R2 | Medium | 10-50x faster tile serving | ~4.5 GB |
| HuggingFace merged file cache → R2 | Low | 2-5x fewer upstream fetches | ~30 MB |
| WebP tiles instead of PNG | Low | 28% less bandwidth | ~3.2 GB (vs 4.5 GB) |
| Batch elevation API optimization | Low | Better profile/analysis performance | 0 |
| Parallel chunk fetching | Medium | 2-4x faster tile assembly | 0 |
| Cloudflare Cache API tuning | Low | Better warm-cache hit rate | 0 |

---

## 4. Implementation Plan

### Phase 1: Fix "No Data" Issues + Better Defaults (Priority: Critical)

#### 1A. Fix NLNOG Data Format Mismatch

**File:** `api/src/app/api/nlnog/route.ts` + `api/src/app/map/lib/layers.ts`

The `/api/nlnog` endpoint returns `{nodes: [...], count: N}` but the 2D map layer expects GeoJSON `{features: [...]}`. 

**Fix:** Transform NLNOG nodes to GeoJSON FeatureCollection in the layer loader, or add a `?format=geojson` parameter to the API.

#### 1B. Fix Natural Events Invisible Markers

**File:** `api/src/app/map/lib/layers.ts`

The layer uses `icon-image: "marker-15"` but the dark basemap has no sprites source. The markers render invisibly.

**Fix:** Switch to circle layers (like earthquakes) instead of symbol layers.

#### 1C. Graceful API Key Handling

**Files:** Multiple layer loaders in `layers.ts`

Show informative status for layers requiring API keys that aren't configured:
- Vessels → "Set AISSTREAM_KEY"
- Wildfires → "Set FIRMS_API_KEY" 
- Military → "ADSB Exchange may require key"

#### 1D. Fix GEBCO Fallback Reliability

**File:** `api/src/lib/client-elevation.ts`

The GEBCO client-side fetch uses range requests to CEDA, which can fail due to CORS or timeouts. The fallback should:
1. Try CEDA first
2. Fall back to /api/elevation server endpoint (which also tries GEBCO with better timeout handling)
3. For ocean points, return `{elevation: 0, surfaceType: "ocean"}` instead of null

#### 1E. Better Ocean/No-Data Display

Instead of showing "No data" for ocean clicks, show:
- Ocean depth if available
- "Ocean (depth unavailable)" if GEBCO fails
- Never show bare "No data"

### Phase 2: Elevation Accuracy Heatmap (Priority: High)

#### 2A. Create Resolution Metadata Layer

Build a new raster tile layer that visualizes SRTM/GEBCO data resolution coverage:

| Region | Resolution | Source | Color |
|---|---|---|---|
| ±60° lat, land | 30m (~1 arcsec) | SRTM v3 / Copernicus GLO-30 | Green (#22c55e) |
| >60° lat, land | 90m (~3 arcsec) | Copernicus GLO-90 | Yellow (#eab308) |
| Global ocean | 450m (15 arcsec) | GEBCO 2025 | Blue (#3b82f6) |
| Europe land | 10m | Copernicus EEA 10m | Bright green (#4ade80) |
| Arctic/Antarctic | 2m | ArcticDEM/REMA | Cyan (#22d3ee) |

**Implementation:** Create a static resolution raster served as tiles. This is a lightweight layer (~500KB total at low zoom) that can be pre-built and stored on R2.

#### 2B. Create Elevation Color Heatmap (Actual Height)

Implement the `elevationColor` layer for the 2D map. Currently only implemented for Cesium (globe) as scattered point primitives.

**Implementation for 2D:** Use the existing DEM tile endpoint to generate color-ramped tiles:
- Add `/api/elevation-color/{z}/{x}/{y}` endpoint
- Color ramp: deep blue (-5000m) → blue (0m) → green (500m) → yellow (2000m) → brown (4000m) → white (8000m+)
- Serve as raster tiles with transparency

#### 2C. Create Elevation Accuracy Heatmap (Default Layer)

New endpoint: `/api/elevation-accuracy/{z}/{x}/{y}`

Returns a raster tile showing data source/resolution per pixel:
- Pre-compute from known coverage boundaries
- Static data (coverage doesn't change)
- Can be a simple polygon overlay at low zoom, raster at high zoom

**Default map state:** Show accuracy heatmap ON by default with hillshade for stunning first impression.

### Phase 3: Performance Optimization (Priority: High)

#### 3A. Pre-build Terrarium Tiles to R2

**Estimated storage:** z0-z10 = ~4.5 GB (fits in 6GB budget with room)

Create a build script that:
1. Iterates all z0-z10 tiles
2. Fetches elevation data from HuggingFace merged files
3. Encodes Terrarium PNG
4. Uploads to R2 bucket: `dem-tiles/{z}/{x}/{y}.png`

Update `/api/dem-tile/{z}/{x}/{y}` to:
1. Try R2 first (instant, CDN-cached)
2. Fall back to on-the-fly assembly
3. Store newly assembled tiles to R2 for future requests

#### 3B. Cache HuggingFace Merged Files to R2

**Estimated storage:** ~30 MB (4 merged files for a typical viewport)

When a merged file is fetched from HuggingFace, store it to R2 with long TTL.
This dramatically reduces cold-start latency for subsequent requests in the same region.

#### 3C. Parallel Chunk Fetching

Current: Chunks fetched sequentially (one at a time per SRTM tile overlap).
Fix: Use `Promise.all()` for parallel chunk fetching within a tile assembly.

#### 3D. Batch Elevation Optimization

The current batch endpoint uses zoom 8 tiles (~1.7km resolution). For elevation profiles, this is insufficient.

Fix: Use zoom 10 (~150m) for better precision while still caching efficiently.

#### 3E. Fix Hurricane CSV Parsing

Current: Fetches entire 3-year CSV (~10MB) client-side and parses with buggy O(n²) lookup.

Fix:
1. Use the `/api/hurricanes` endpoint (server-side parsing, GeoJSON output)
2. Remove the client-side CSV parsing from `layers.ts`
3. The API already returns clean GeoJSON with active storms

### Phase 4: Stunning First-Load Experience (Priority: Medium)

#### 4A. Default Layer Configuration

New default layers for the 2D map:
```
ON by default:
  - Hillshade (terrain shading)
  - Elevation Accuracy Heatmap (NEW - shows 30m/90m/450m coverage)
  - Earthquakes (live data)
  - Country Boundaries (glowing borders)

OFF by default but easy to toggle:
  - Elevation Color Heatmap (actual height colors)
  - Bathymetry (ocean depth)
  - Weather Radar
  - All other layers
```

#### 4B. Pre-fetch Visible Data

On map load, immediately fetch data for default layers:
- Earthquakes: Already auto-fetches
- Add loading spinners/progress indicators for each layer
- Show layer count badges (e.g., "142 earthquakes")

#### 4C. Improved Visual Design

- Animated gradient glow on boundaries
- Pulsing dots for earthquakes (magnitude-based)
- Subtle grid overlay at low zoom
- Better sidebar UX with layer status indicators

### Phase 5: Smart R2 Caching Strategy (Priority: Medium)

#### Storage Budget Allocation (6 GB max)

| Category | Size | Description |
|---|---|---|
| DEM tiles z0-z10 | ~4.5 GB | Pre-built Terrarium PNG tiles |
| Elevation color tiles | ~800 MB | Color-ramped elevation visualization |
| Resolution heatmap tiles | ~200 MB | Static resolution/accuracy overlay |
| HuggingFace merged cache | ~300 MB | Frequently-accessed merged SRTM files |
| Other cached data | ~200 MB | NLNOG, earthquakes, etc. |
| **Total** | **~6.0 GB** | Within free tier |

#### Cache Eviction Policy

Use LRU with priority tiers:
1. **Hot tiles** (z7-z9, recently accessed): Never evict
2. **Warm tiles** (z0-z6, z10): Evict after 7 days of no access
3. **Cold tiles**: Evict after 30 days
4. **One-time data** (merged files): Evict after 24 hours

---

## 5. R2 Storage Budget

### Current Usage Estimate
- Terrain tiles (z0-z10, Terrarium PNG): Not pre-built, generated on-the-fly
- R2 bucket: Used for terrarium tiles if uploaded manually

### Proposed Usage
| Data | Tiles | Avg Size | Total |
|---|---|---|---|
| DEM z0-z6 | 5,461 | 50 KB | 273 MB |
| DEM z7 | 16,384 | 67 KB | 1,070 MB |
| DEM z8 | 65,536 | 56 KB | 3,530 MB |
| DEM z9 | 261,632 | 43 KB | 10,976 MB |
| DEM z10 | 1,046,712 | 33 KB | 33,116 MB |

**Problem:** z0-z10 is ~49 GB — way over 6 GB budget.

### Revised Strategy: Cache-on-Demand (Lazy Populating)

Instead of pre-building ALL tiles, use a lazy cache:
1. Only store tiles that have been requested (cache-on-demand)
2. Popular tiles (z0-z8 global + z9-z10 near populated areas) will be cached naturally
3. Expected steady-state: ~3-4 GB of frequently-accessed tiles
4. Add cache headers for browser CDN caching

**Revised budget:**
| Data | Expected Size |
|---|---|
| Cached DEM tiles (z0-z8 full + z9-z10 hot areas) | ~3.5 GB |
| Elevation color tiles (generated on-demand, cached) | ~1.0 GB |
| Resolution heatmap (static, small) | ~0.2 GB |
| Merged file cache | ~0.3 GB |
| Reserved | ~1.0 GB |
| **Total** | **~6.0 GB** |

---

## 6. Phased Rollout

### Sprint 1: Fix "No Data" + Accuracy Heatmap
- [ ] Fix NLNOG GeoJSON format mismatch
- [ ] Fix Natural Events invisible markers
- [ ] Add graceful API key handling for vessels/wildfires/military
- [ ] Fix GEBCO fallback for ocean points
- [ ] Create `/api/elevation-accuracy/{z}/{x}/{y}` endpoint
- [ ] Create `/api/elevation-color/{z}/{x}/{y}` endpoint
- [ ] Add both new layers to 2D map with defaults
- [ ] Fix hurricane CSV parsing to use server API
- [ ] Add loading indicators for all layers

### Sprint 2: Performance + Visual Polish
- [ ] Implement R2 cache-on-demand for DEM tiles
- [ ] Parallel chunk fetching in tile assembler
- [ ] Cache HuggingFace merged files
- [ ] Improve batch elevation to use z10
- [ ] Visual polish: animated boundaries, pulsing earthquakes, grid overlay
- [ ] Add layer status/count badges

### Sprint 3: Smart Caching + Monitoring
- [ ] Implement LRU cache eviction for R2
- [ ] Add cache hit/miss metrics
- [ ] Pre-warm popular tiles (z0-z8)
- [ ] Monitor R2 usage and adjust cache policy

---

*This plan is ordered by impact and effort. Sprint 1 fixes the most user-visible issues. Sprint 2 delivers the performance gains. Sprint 3 optimizes the caching strategy.*
