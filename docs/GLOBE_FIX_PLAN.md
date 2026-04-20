# OpenZenith — Globe Fix, Optimization & Data Gap Plan

**Date:** 2026-04-19  
**Scope:** Globe rendering, layer toggling, symbology, terrain, data gaps

---

## Plan Summary

### Problem Diagnosis

**Three critical bugs found:**

1. **Layer toggle is broken** — `dataLoadedRef` is never reset when toggling layers OFF. Toggling OFF→ON silently does nothing because the guard `if (dataLoadedRef.current[key]) return` fires immediately. This affects ALL 17 dynamically-loaded layers (flights, vessels, satellites, radar, hurricanes, etc.).

2. **Terrain not rendering** — `terrain-csr.ts` patches `requestTileGeometry` onto `EllipsoidTerrainProvider`, which is NOT a standard CesiumJS terrain provider API surface. CesiumJS 1.119 likely ignores the override, resulting in a flat ellipsoid with no elevation. The `getTileDataAvailable` override returning `undefined` may also be interpreted as "no tiles available."

3. **Symbology is flat** — Most layers (vessels, warnings, NLNOG, wildfires, etc.) render as simple point sprites or tiny billboards. The globe looks like scattered dots rather than a rich intelligence display. Key layers lack:
   - Heatmaps / density visualization
   - Size-coded circles proportional to magnitude/count
   - Gradient rings / glow effects for active events
   - Proper altitude-aware billboards

### Fix Plan (4 phases)

**Phase 1: Fix Critical Bugs** (layer toggling + terrain)
- Reset `dataLoadedRef` on every toggle OFF for all 27 layer keys
- Replace `EllipsoidTerrainProvider` hack with proper `UrlTemplateTerrainProvider` pointing at `/api/dem-tile/{z}/{x}/{y}` (Terrarium PNG) — native CesiumJS support, no override needed
- Add `depthTestAgainstTerrain = true` for proper entity occlusion

**Phase 2: Elevation Data Gaps** (fill bathymetry + land coverage)
- **Bathymetry gap:** Ocean areas show as flat 0m. Fix: Use AWS Terrain Tiles (which include GEBCO bathymetry encoded as negative Terrarium values) as primary terrain source — they cover the entire globe including ocean floor
- **Polar gap:** SRTM only covers ±60°. Fix: AWS Terrain Tiles include GLO-90 and GEBCO for polar regions (±90°)
- **Accuracy heatmap update:** Update `elevation-accuracy` route to reflect actual coverage (AWS: global 30m land + bathymetry)
- **Elevation color:** The `/api/elevation-color/{z}/{x}/{y}` route uses HuggingFace SRTM which lacks ocean data. Fix: Use AWS Terrain Tiles as primary source for color ramp generation

**Phase 3: Layer Symbology Upgrade** (visual quality)
- **Earthquakes:** Already good (ellipses + rings + labels). Minor tweaks for better color contrast
- **Wildfires:** Upgrade from tiny 14px fire icons to 3-tier system: thermal glow ellipses (large, low alpha) + billboard icon + FRP-proportional point size
- **Volcanoes:** Add SO₂ plume ring (scaled to alert level), eruption column visualization for WARNING status
- **Flights:** Already good (aircraft SVGs + contrails + velocity vectors). No changes needed
- **Vessels:** Add wake trail lines behind moving vessels, size proportional to vessel length
- **Hurricanes:** Upgrade from basic polylines to filled wind-radius polygons (SAFFIR-SIMPSON color coding), eye wall circle for major hurricanes
- **Satellites:** Already good (orbital tracks + ground tracks). No changes needed
- **Events (EONET):** Upgrade from single point to event-type-specific rendering: wildfire polygons, storm system circles, flood extent areas
- **Warnings:** Add colored alert polygons instead of just point markers
- **Air Quality:** Add pollution heatmap overlay (raster tiles from GIBS TROPOMI NO₂)
- **Lightning:** Add glow ellipses at strike locations instead of just points

**Phase 4: Data Source Improvements**
- Replace dead volcano source (USGS → already Smithsonian GVP in code)
- Replace dead GDACS with empty state (already done)
- Add GIBS raster overlays for: SO₂ volcanic gas, NDVI vegetation, PM2.5 air quality
- Switch population layer from VIIRS proxy to GPW 2020 census data
- Add GEBCO bathymetry color overlay for ocean areas

---

## Detailed Implementation

### Phase 1: Fix Critical Bugs

#### 1A: Fix Layer Toggle (page.tsx)

**Root cause:** `dataLoadedRef` is set to `true` when a layer loads, but NEVER set back to `false` when the layer is toggled OFF. When toggling OFF→ON, `loadLayerDynamic()` returns immediately because `dataLoadedRef.current[key]` is still `true`.

**Fix:** Add `dataLoadedRef.current[key] = false` in every `!on` branch of `toggleLayer`. Also clear the layer module cache so it re-imports fresh.

```typescript
// In toggleLayer, for EVERY case that has "if (on) loadLayerDynamic(key)":
// Add to the !on branch:
if (!on) {
  removeEntities("prefix-");
  dataLoadedRef.current[key] = false;  // ← ADD THIS
  // Also clear intervals for this layer
}
```

**Affected layer keys (17):** radar, flights, militaryFlights, vessels, warnings, satellites, hurricaneTracks, nlnogNodes, flightArcs, orbitalTracks, groundTracks, currents, spaceWeather, airQuality, aviationWeather, volcanoes, gdacs, marineWeather, wildfires, lightning

#### 1B: Fix Terrain Rendering (terrain-csr.ts)

**Root cause:** `EllipsoidTerrainProvider` doesn't natively support `requestTileGeometry`. The code monkey-patches it, but CesiumJS 1.119's internal terrain system may not call the method on this provider type.

**Fix:** Use `UrlTemplateTerrainProvider` with Terrarium encoding, pointing at our own `/api/dem-tile/{z}/{x}/{y}` endpoint. This is a native CesiumJS provider type that properly supports tile fetching.

```typescript
// Replace the entire createCSRTerrainProvider() with:
export function createCSRTerrainProvider(Cesium: any) {
  return new Cesium.UrlTemplateTerrainProvider({
    url: "/api/dem-tile/{z}/{x}/{y}",
    maximumLevel: 10,
    credit: "OpenZenith Terrain (SRTM 30m + GEBCO)",
    // Terrarium encoding: height_m = (R * 256 + G + B / 256) - 32768
    encoding: Cesium.HeightmapTerrainData.fromUrlTemplateTerrainProvider, // not needed for UrlTemplate
  });
}
```

Wait — `UrlTemplateTerrainProvider` expects imagery tiles, not terrain heightmap tiles. For Terrarium-encoded terrain, we need to use `CesiumTerrainProvider` with a custom URL, or keep the custom provider approach but use the correct base class.

**Correct approach:** Use `Cesium.CesiumTerrainProvider` with a custom URL pointing to our tile server, since our tiles are Terrarium-encoded PNG (same format as Cesium ion terrain):

Actually, the cleanest approach for non-Ion terrain is to create a proper `TerrainProvider` subclass or use the `requestVertexNormals` approach. But the simplest working fix is:

**Option A:** Keep `EllipsoidTerrainProvider` but ensure the method override works by also setting `hasVertexNormals = false` and `ready = true`.

**Option B (recommended):** Use AWS Terrain Tiles directly via `UrlTemplateTerrainProvider` as an **imagery overlay** for hillshade/visualization, and use a simple custom terrain provider that fetches our `/api/dem-tile` PNGs and decodes Terrarium. The key fix is ensuring the provider is properly recognized by CesiumJS.

**Option C (simplest):** Just use the AWS Terrain Tiles URL directly — they're free, global, Terrarium-encoded, and ~250ms latency. No custom code needed:

```typescript
export function createCSRTerrainProvider(Cesium: any) {
  return new Cesium.CesiumTerrainProvider({
    url: "https://s3.amazonaws.com/elevation-tiles-prod/terrarium",
    requestVertexNormals: false,
  });
}
```

Wait — `CesiumTerrainProvider` expects the Cesium ion API format, not a simple tile URL. For raw Terrarium tiles, the correct approach is `UrlTemplateTerrainProvider` with proper height decoding... but that's for imagery, not terrain.

Let me reconsider. The actual working approach for custom terrain in CesiumJS is:

```typescript
// Custom terrain provider using EllipsoidTerrainProvider as base
// but with proper tile request handling
const provider = new Cesium.EllipsoidTerrainProvider();
// This IS the correct approach — the issue might be something else
```

Actually, looking at the code more carefully, the `EllipsoidTerrainProvider` override DOES work in older CesiumJS versions. The issue might be specific to 1.119. Let me check if there's a simpler problem — like the HuggingFace client-side fetch failing silently.

**Revised plan:** Keep the custom provider approach but add proper error handling and fallback to AWS Terrain Tiles directly. Also add logging to diagnose what's actually failing.

### Phase 2: Elevation Data Gaps

#### 2A: Bathymetry Coverage

**Current state:** 
- SRTM only covers ±60° latitude, land only
- HuggingFace chunks = SRTM 30m data (no bathymetry)
- GEBCO 2025 exists as a COG reader (server-side) but not used for terrain tiles
- AWS Terrain Tiles include negative elevation (ocean depth) from GEBCO

**Fix for terrain tiles:** Use AWS Terrain Tiles as primary source for the CesiumJS terrain provider. They encode the full globe including ocean floor as Terrarium PNG. Our `/api/dem-tile` endpoint can also proxy these.

**Fix for elevation-color route:** Currently only renders land elevation (ocean = dark blue). Enhance to show actual bathymetry colors (deep blue gradients based on depth).

**Fix for elevation-accuracy heatmap:** Update to show actual data source coverage:
- ±60° land: SRTM 30m (green)
- Polar land: GLO-90 90m (yellow-green)
- Ocean: GEBCO 450m (blue)
- With proper Natural Earth land mask

#### 2B: Fix /api/elevation-color for Ocean

Current code only uses HuggingFace SRTM which returns NODATA for ocean. The `lerpColor()` function starts at -500m for "deep ocean" but never actually gets real ocean depth data.

**Fix:** When HuggingFace returns all-NODATA for a tile (ocean tile), fetch from AWS Terrain Tiles instead and decode the Terrarium values to get real bathymetry.

#### 2C: Fix Bathymetry Layer

Current bathymetry layer just applies CSS filters to the elevation-color layer (saturation, contrast, brightness). This makes everything look washed out.

**Fix:** Create a dedicated `/api/bathymetry-tile/{z}/{x}/{y}` endpoint that:
1. Fetches AWS Terrain Tile (has real bathymetry)
2. Applies ocean-only color ramp (deep navy → medium blue → cyan for shallow)
3. Makes land transparent
4. Returns as PNG

Then the MapLibre bathymetry layer uses this dedicated endpoint.

### Phase 3: Layer Symbology

Key changes per layer:

| Layer | Current | Upgrade |
|-------|---------|---------|
| Earthquakes | Ellipses + points + M4+ labels | ✅ Already good — minor color tweaks |
| Wildfires | 14px fire icons + 3px points | Glow ellipses scaled by FRP + icon + confidence rings |
| Volcanoes | 22px triangle icon + label | Add SO₂ detection ring, eruption column for WARNING |
| Hurricanes | Polylines | Filled wind-radius polygons + eye wall circle + category colors |
| Events | SVG icons + labels | Type-specific rendering (fire polygons, storm circles) |
| Warnings | Point markers | Colored alert polygons |
| Vessels | 16px ship icon + heading line | Wake trails, size proportional to length |
| Air Quality | Single point | Add NO₂ raster overlay from GIBS |
| Lightning | Points | Glow ellipses at strike locations |
| Flights | ✅ Already good | No changes |
| Satellites | ✅ Already good | No changes |

### Phase 4: Data Sources

| Source | Current | Action |
|--------|---------|--------|
| Volcanoes | Smithsonian GVP RSS | ✅ Working — keep |
| GDACS | Dead (returns empty) | ✅ Already handled |
| Population | VIIRS Black Marble (proxy) | Switch to GPW 2020 (census-based) |
| Bathymetry | None (flat ocean) | Add GEBCO via AWS Terrain Tiles |
| Sentinel-2 | TiTiler (often 530) | ✅ GIBS fallback already added |
| NLNOG | 404 | Needs new endpoint or graceful disable |

---

## Execution Order

1. **Phase 1A:** Fix layer toggle bug (~15 min) — add `dataLoadedRef.current[key] = false` to all OFF branches
2. **Phase 1B:** Fix terrain rendering (~20 min) — switch to AWS Terrain Tiles or fix custom provider
3. **Phase 2A:** Fix elevation-color for ocean (~15 min) — add AWS fallback for ocean tiles
4. **Phase 2B:** Create dedicated bathymetry tile endpoint (~20 min)
5. **Phase 2C:** Update elevation-accuracy heatmap (~15 min)
6. **Phase 3A:** Upgrade wildfire symbology (~15 min)
7. **Phase 3B:** Upgrade hurricane symbology (~15 min)
8. **Phase 3C:** Upgrade vessel symbology (~10 min)
9. **Phase 3D:** Upgrade events/warnings symbology (~15 min)
10. **Phase 4A:** Switch population to GPW 2020 (~5 min)
11. **Test all changes, deploy**
