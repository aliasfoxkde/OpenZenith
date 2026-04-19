# OpenZenith — Remaining Tasks & SAR Integration Plan

**Version:** 0.5.1 | **Last Updated:** 2026-04-18  
**Deploy Command:** `cd api && npm run build && npm run pages:build && npx wrangler pages deploy .vercel/output/static --project-name=openzenith --commit-dirty=true`

---

## Task Inventory

### TIER 1 — Quick Wins (no API keys, <2 hours each)

| # | Task | Description | Files |
|---|------|-------------|-------|
| 1 | **Fix military route to return 200 on error** | Currently returns 502 on timeout. Change to `status: 200` with empty `ac: []` to match all other data routes. | `api/src/app/api/military/route.ts` |
| 2 | **Add `military` to 2D layer handlers** | Create `layers/military.ts` (same pattern as flights.ts but fetching `/api/military`). Currently globe-only. | `api/src/app/map/lib/layers/military.ts`, `index.ts` |
| 3 | **Add `vessels` 2D handler** | Create `layers/vessels.ts` — fetch `/api/vessels` for config, then open WebSocket client-side. Currently globe-only. | `api/src/app/map/lib/layers/vessels.ts`, `index.ts` |
| 4 | **Add `spaceWeather` 2D handler** | Fetch aurora forecast KML from NOAA SWPC, render as GeoJSON polygon. | `api/src/app/map/lib/layers/space-weather.ts`, `index.ts` |
| 5 | **Add `volcanoes` 2D handler** | Fetch USGS volcano GeoJSON, add circle markers. Simple pattern. | `api/src/app/map/lib/layers/volcanoes.ts`, `index.ts` |
| 6 | **Add `gdacs` 2D handler** | Fetch GDACS ATOM feed, parse events, render markers. | `api/src/app/map/lib/layers/gdacs.ts`, `index.ts` |
| 7 | **Add `marineWeather` 2D handler** | Open-Meteo Marine API for wave/SST — raster or point markers. | `api/src/app/map/lib/layers/marine-weather.ts`, `index.ts` |
| 8 | **Add `lightning` 2D handler** | Blitzortung WebSocket — same pattern as vessels. | `api/src/app/map/lib/layers/lightning.ts`, `index.ts` |
| 9 | **Add `nightLights` 2D handler** | Raster tiles from NASA Black Marble. | `api/src/app/map/lib/layers/night-lights.ts`, `index.ts` |
| 10 | **Fix ESLint warnings** | 18 unused `setStatus` vars in layer modules (add `_setStatus` destructuring or remove unused import). Also 5 other warnings. | All `layers/*.ts` files |
| 11 | **Opacity sliders for raster layers** | Add slider controls for hillshade, elevationColor, bathymetry, radar, sentinel2, nightLights. Use `map.setPaintProperty(layerId, 'raster-opacity', value)`. | `api/src/app/map/page.tsx`, sidebar UI |
| 12 | **Fix `pip install` — add entry point** | Add `[project.scripts] openzenith = "openzenith.cli:main"` to `pyproject.toml` so `pip install` gives a working CLI. | `pyproject.toml` |

### TIER 2 — API Key Registration (<1 hour setup each)

| # | Task | How To | Config |
|---|------|--------|--------|
| 13 | **FIRMS wildfire key** | Register free at https://firms.modaps.eosdis.nasa.gov/api/area/ — instant email with MAP_KEY. Set in wrangler.toml as `FIRMS_MAP_KEY`. Unlocks real-time wildfire data globally. | `wrangler.toml` → `FIRMS_MAP_KEY` |
| 14 | **ADSB Exchange key** | Register at https://adsbexchange.com/data/ — free tier with rate limits. Add `api-key` header to military route. | `wrangler.toml` → `ADSB_EXCHANGE_KEY` |
| 15 | **AISstream vessel key** | Register free at https://www.aisstream.io/ — free tier: 100 vessels. Set `AISSTREAM_KEY`. Already wired up, just needs the key. | `wrangler.toml` → `AISSTREAM_KEY` |

### TIER 3 — Medium Effort (2-8 hours each)

| # | Task | Description |
|---|------|-------------|
| 16 | **OpenSky latency fix** | OpenSky takes 8-10s from CF edge. Options: (a) Move flights to client-side direct fetch (bypass CF), (b) Use cached snapshot refreshed every 2 min, (c) Try OpenSky's other endpoint `/states/all?lamin/lamax/lomin/lomax` with bbox. |
| 17 | **Celestrak latency fix** | Similar 8-10s CF edge issue. Cache strategy: pre-warm on deploy, 10min TTL, stale-while-revalidate. |
| 18 | **Elevation accuracy refinement** | Current `isLandHeuristic()` uses 18 bounding boxes. Improve with Natural Earth coastline data (vector tiles) for pixel-accurate land/ocean classification. |
| 19 | **Terrain 3D for 2D map** | MapLibre supports terrain with `setTerrain({ source, exaggeration })`. Wire up the DEM tiles for 3D terrain in 2D view. |
| 20 | **Measurement tools polish** | Add area measurement (polygon), bearing display, coordinate format toggle (DMS/DD/DM). |
| 21 | **Bookmarks system** | Save/restore viewport + enabled layers as named bookmarks. Store in localStorage. |
| 22 | **Annotation layer** | Allow users to place pins, draw lines/polygons on the map. Persist to localStorage or export GeoJSON. |
| 23 | **Python SDK: PyPI publish** | Add GitHub Actions workflow for publishing to PyPI on tag. Add `README.md` to package, fix metadata. |
| 24 | **Performance: bundle size** | Map page First Load JS is 128KB. Lazy-load layer modules on toggle (not on page load). |

### TIER 4 — Large Features (>1 day each)

| # | Task | Description |
|---|------|-------------|
| 25 | **Offline mode** | Service worker to cache basemap tiles + DEM tiles for offline use. |
| 26 | **Time-series playback** | Earthquake replay, hurricane track animation timeline. |
| 27 | **Custom basemap themes** | Let users create/save custom basemap color schemes. |
| 28 | **Geocoding search** | Add a search bar that geocodes place names → flies to location. Already have `/api/geocode`. |
| 29 | **Elevation profile tool** | Click two points → draw line → show elevation profile chart (using `/api/elevation/batch`). |
| 30 | **Export functionality** | Export current map view as PNG, GeoJSON of visible layers, KMZ for Google Earth. |

---

## SAR Data Integration — Gap Analysis

### What SAR Can Fill

SAR (Synthetic Aperture Radar) data from Sentinel-1, ALOS-2, RADARSAT, and CAP (Commercial) satellites provides **all-weather, day/night** Earth observation. Key applications for OpenZenith:

#### 1. **Wildfire Monitoring (replaces/enhances FIRMS)**
| Aspect | Current | SAR Enhancement |
|--------|---------|-----------------|
| Source | NASA FIRMS VIIRS (optical) | Sentinel-1 SAR + VIIRS fusion |
| Limitation | Cannot see through smoke/clouds | SAR penetrates smoke, detects burn scars |
| Data | Fire hotspots (point data) | Burn severity maps, active fire fronts |
| API | FIRMS CSV (needs API key) | **Copernicus Dataspace** — free, no key needed |

**Implementation:**
- `POST https://sh.dataspace.copernicus.eu/api/v1/process` — STAC query for Sentinel-1 GRD
- Process: Radiometric calibration → log ratio (pre/post fire) → threshold for burn scars
- Could serve as **tiles** from Cloudflare Workers (pre-computed on demand)
- Also: **ASF DAAC** (Alaska SAR Facility) has a free API: `https://api.daac.asf.alaska.edu/`

#### 2. **Flood Mapping (new layer)**
| Aspect | Details |
|--------|---------|
| Source | Sentinel-1 IW GRD (10m resolution, 6-day repeat) |
| Method | Change detection: pre-event vs post-event water extent |
| Products | Copernicus EMS Rapid Mapping, GLOFAS |
| API | Copernicus EMS API, or process Sentinel-1 via Dataspace |

**Implementation:**
- New layer: `floods` — fetch flood extent polygons from Copernicus EMS or process SAR directly
- Copernicus EMS Rapid Mapping: `https://emergency.copernicus.eu/mapping/` (free, REST API)
- GLOFAS: `https://floods.jrc.ec.europa.eu/` — global flood forecast (15-day)
- Could also show flood forecast from GLOFAS as raster tiles

#### 3. **Land Subsidence / Ground Deformation (new layer)**
| Aspect | Details |
|--------|---------|
| Source | Sentinel-1 InSAR (Interferometric SAR) |
| Method | Persistent Scatterer Interferometry (PSI) |
| Products | Velocity maps (mm/year) showing ground sinking |
| Resolution | ~20m for PSI, ~5m for advanced processing |

**Implementation:**
- New layer: `subsidence` — show InSAR velocity maps
- Pre-computed products from various agencies (JAXA, ESA, USGS)
- Could use pre-built mosaics from `https://comet.nerc.ac.uk/COMET-LiCS-portal/`

#### 4. **Sea Ice Monitoring (enhances bathymetry)**
| Aspect | Details |
|--------|---------|
| Source | Sentinel-1 EW GRD + AMSR2 passive microwave |
| Products | Daily sea ice edge, concentration, type |
| API | OSI SAF: `https://osi-saf.eumetsat.int/` (free) |

**Implementation:**
- New layer: `seaIce` — raster tiles showing ice concentration
- Overlay on bathymetry layer
- OSI SAF has WMS endpoints that can be proxied

#### 5. **Ship Detection (enhances vessels)**
| Aspect | Details |
|--------|---------|
| Source | Sentinel-1 for dark vessel detection |
| Limitation | Complementary to AIS — detects ships with AIS off |
| Products | Vessel density maps, dark ship detections |
| API | ESA Sentinel Hub, or EU ICE-SAR project |

#### 6. **Vegetation / Agriculture Monitoring (new layer)**
| Aspect | Details |
|--------|---------|
| Source | Sentinel-1 + Sentinel-2 fusion |
| Products | NDVI, crop health, deforestation alerts |
| API | Sentinel Hub (free tier), Open EO |

---

### SAR Data Sources — Practical Integration

| Source | Data | API | Auth | Rate Limit |
|--------|------|-----|------|------------|
| **Copernicus Dataspace** | Sentinel-1/2 SLC/GRD | REST + STAC | Free OAuth2 | 10 req/s |
| **ASF DAAC** | Sentinel-1, ALOS-2 | REST | Free API key | 30 req/min |
| **Sentinel Hub** | Processed products | REST/OGC | Free tier (30k req/mo) | Rate limited |
| **OSI SAF** | Sea ice, SST | WMS/FTP | Free | 1 req/s |
| **Copernicus EMS** | Flood/fire maps | REST | Free registration | 60 req/hour |
| **GLOFAS** | Flood forecasts | REST/NetCDF | Free | 1000 req/day |

### Recommended SAR Integration Priority

1. **🟢 Wildfire burn scars** — Sentinel-1 change detection via Copernicus Dataspace. Replaces FIRMS dependency. Free, no API key. Can process on CF edge or pre-compute tiles.
2. **🟢 Flood extent** — Copernicus EMS Rapid Mapping API. Free registration. Add as new `floods` layer.
3. **🟡 Sea ice** — OSI SAF WMS. Free, no key. Add as raster overlay.
4. **🟡 Ground deformation** — Use pre-built COMET-LiCS products. Static dataset, can host on R2.
5. **🔴 Ship detection** — Complex processing. Defer.

### SAR Technical Challenges

1. **Processing complexity** — Raw SAR (GRD/SLC) requires speckle filtering, terrain correction, radiometric calibration. These are CPU-intensive (minutes per scene on CF edge). **Recommendation**: Use pre-processed products (Copernicus EMS maps, GLOFAS forecasts) rather than raw SAR processing.
2. **Storage** — Sentinel-1 scenes are 1-4 GB each. Cannot store on R2 (6GB budget). **Recommendation**: Fetch on demand or use tile-based processed products.
3. **Latency** — SAR revisit is 6 days (Sentinel-1A+B). Not real-time. **Recommendation**: Use as supplementary layer, not primary.
4. **Cloudflare edge processing** — CF Workers have 128MB memory limit and 30s CPU time. SAR processing requires more. **Recommendation**: Process externally, serve tiles.

### Recommended Architecture for SAR Layers

```
User toggles "Floods" layer
  → MapLibre requests /api/floods/{z}/{x}/{y}
  → CF Worker checks cache (R2 or KV)
  → Cache miss: fetches pre-built flood extent from Copernicus EMS
  → Renders as vector tiles or raster PNG
  → Caches for 1 hour
```

---

## Data Gap Summary — What SAR Can/Cannot Fill

| Gap | Current State | SAR Solution | Effort |
|-----|--------------|--------------|--------|
| Wildfires | Empty (needs FIRMS key) | Sentinel-1 burn scars + VIIRS fusion via Copernicus | Medium |
| Floods | No layer exists | Copernicus EMS flood maps (free API) | Low |
| Sea ice | No layer exists | OSI SAF WMS (free) | Low |
| Subsidence | No layer exists | COMET-LiCS InSAR products (static) | Medium |
| Ship dark targets | AIS only | Sentinel-1 ship detection | High |
| Vegetation change | No layer exists | Sentinel-1/2 NDVI fusion | High |
| Night lights | Globe-only | Not SAR — use NASA Black Marble tiles (easy) | Low |
| Ground tracks | Globe-only | Not SAR — port Cesium code to MapLibre | Medium |

---

## Execution Checklist

Copy this into your next session:

```
[ ] T1: Fix military route 502 → 200
[ ] T2: Add military 2D layer handler
[ ] T3: Add vessels 2D layer handler  
[ ] T4: Add spaceWeather 2D handler (aurora forecast)
[ ] T5: Add volcanoes 2D handler (USGS GeoJSON)
[ ] T6: Add gdacs 2D handler (disaster alerts)
[ ] T7: Add marineWeather 2D handler (wave height)
[ ] T8: Add lightning 2D handler (Blitzortung WS)
[ ] T9: Add nightLights 2D handler (NASA tiles)
[ ] T10: Fix 18 ESLint unused setStatus warnings
[ ] T11: Add opacity sliders for raster layers
[ ] T12: Fix pip install entry point
[ ] T13: Register FIRMS API key → wrangler.toml
[ ] T14: Register ADSB Exchange key → wrangler.toml
[ ] T15: Register AISstream key → wrangler.toml
[ ] T16: Fix OpenSky CF edge latency
[ ] T17: Fix Celestrak CF edge latency
[ ] SAR-1: Add flood extent layer (Copernicus EMS)
[ ] SAR-2: Add sea ice layer (OSI SAF WMS)
[ ] SAR-3: Evaluate Sentinel-1 burn scars for wildfire enhancement
[ ] SAR-4: Evaluate COMET-LiCS subsidence layer
```

---

## Commit History This Session

```
9f41098 feat: Toast notifications, terrain CLI commands, version 0.5.1
0531ad3 feat: Systematic improvements — data sources, SDK, code quality
```
