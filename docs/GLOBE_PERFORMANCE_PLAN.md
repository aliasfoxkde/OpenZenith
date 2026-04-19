# Globe Performance Improvement Plan

**Date:** 2026-04-19  
**CesiumJS Version:** 1.119  
**Current Issues:** Frame rate, load time, entity count

---

## Audit Findings

### Critical Issues

| # | Issue | Impact | Fix |
|---|-------|--------|-----|
| G1 | **Cesium + satellite.js loaded sequentially** | 2+ second blocking load | Load in parallel |
| G2 | **Cloud overlay hardcoded to 2026-03-31** | Stale imagery, no updates | Dynamic date (yesterday) |
| G3 | **FXAA always enabled** | Expensive post-processing, no toggle | Make configurable, default off |
| G4 | **requestRenderMode: true + maximumRenderTimeChange: Infinity** | Good for idle, but never auto-renders on data changes | Ensure `requestRender()` called after entity updates |

### Moderate Issues

| # | Issue | Impact | Fix |
|---|-------|--------|-----|
| G5 | **3,000 satellite entities** | Heavy entity count for points | Use PointPrimitiveCollection (batch rendering) |
| G6 | **500 flight entities** | Moderate | Use PointPrimitiveCollection |
| G7 | **No entity batching** | Each entity is a separate draw call | Batch homogeneous entities into PrimitiveCollections |
| G8 | **200 lightning strikes as entities** | Entities created/destroyed rapidly | Use PointPrimitiveCollection with recycling |
| G9 | **Terrain cache size limits unclear** | Could thrash on pan | Audit MAX_CACHE_SIZE, tune |

### Low Priority

| # | Issue | Impact | Fix |
|---|-------|--------|-----|
| G10 | **Cesium 1.119 from unpkg (full build)** | ~2.5MB gzipped | Could use custom Cesium build (strips unused features) |
| G11 | **No level-of-detail for entities** | All entities render at all zoom levels | Add distance-based visibility |
| G12 | **dedupFetch has no TTL** | Prevents re-fetch of stale data | Add cache-busting after TTL |

---

## Entity Budget (per layer)

| Layer | Current Max | Type | Recommended |
|-------|------------|------|-------------|
| Satellites | 3,000 | point+label | 500 visible, LOD hide at distance |
| Flights | 500 | point+path | 300, batch points |
| Military | ~100 | point+path | Keep as-is |
| Vessels | ~100 | point+path | Keep as-is |
| Earthquakes | ~300 | point+label | Keep as-is |
| Lightning | 200 (active) | point | Use PointPrimitiveCollection |
| NLNOG | ~750 | point | Batch, LOD |
| Wildfires | 500 | point | Batch, LOD |
| Flight Arcs | 100 | polyline | Keep as-is |
| Orbital Tracks | 20 | polyline | Keep as-is |

---

## Implementation Plan

### Phase G1: Quick Wins (immediate) ✅ COMPLETE
- [x] Fix cloud overlay date (dynamic)
- [x] Parallel script loading (Cesium + satellite.js)
- [x] Make FXAA toggleable (default off for performance)
- [x] Entity limit reductions (flights 300, satellites 1500, wildfires 300)
- [x] Critical render bug fix (requestRender after entity updates)

### Phase G2: Entity Batching (partial)
- [x] Satellites already use PointPrimitiveCollection for scatter
- [ ] Convert flights scatter to PointPrimitiveCollection
- [ ] Convert lightning to PointPrimitiveCollection with recycling
- [x] LOD system implemented (4 altitude zones: surface/low-orbit/high-orbit/deep-space)

### Phase G3: Terrain & Cache
- [ ] Audit terrain cache sizes and TTLs
- [ ] Pre-fetch terrain for visible tiles on camera change
- [ ] Add terrain loading progress indicator

### Phase G4: Advanced
- [ ] Custom Cesium build (strip unused: 3D Tiles, KML, CZML, etc.)
- [ ] WebWorker for TLE→position computation
- [ ] Incremental entity loading (chunked on scroll)
