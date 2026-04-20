# OpenZenith — Remaining Tasks & Progress

**Version:** 0.6.3 | **Last Updated:** 2026-04-20  
**Deploy:** `cd api && npm run build && npx vercel build && npx @cloudflare/next-on-pages && npx wrangler pages deploy .vercel/output/static --project-name=openzenith --commit-dirty=true`

---

## Task Status — 40/42 Complete

| # | Task | Status | Notes |
|---|------|--------|-------|
| T1 | Fix military route 502 → 200 | ✅ | Returns 200 with error msg on 402/403/429 |
| T2 | Military 2D layer | ✅ | |
| T3 | Vessels 2D handler | ✅ | WebSocket via /api/vessels config |
| T4 | Space weather handler | ✅ | |
| T5 | Volcanoes handler | ✅ | |
| T6 | GDACS handler | ✅ | |
| T7 | Marine weather handler | ✅ | |
| T8 | Lightning handler | ✅ | |
| T9 | Night lights handler | ✅ | |
| T10 | ESLint fixes | ✅ | |
| T11 | Opacity sliders | ✅ | 14 raster layers |
| T12 | pip install entry point | ✅ | |
| **T13** | **FIRMS wildfire key** | **✅** | **Key set, validated: 3,000+ fires/day** |
| T14 | ADSB Exchange key | ⏭️ | $30/yr subscription — deferred |
| **T15** | **AISstream vessel key** | **✅→⚠️** | **Key set but service returns zero data (free tier dead)** |
| T16 | OpenSky latency fix | ✅ | SWR 15min stale window |
| T17 | Celestrak latency fix | ✅ | SWR 30min stale window |
| T18 | Elevation accuracy | ✅ | 360×180 binary land mask |
| T19 | Terrain 3D | ✅ | setTerrarium already existed |
| T20 | Measurement polish | ✅ | DD/DMS toggle, elevation profile |
| T21 | Bookmarks | ✅ | localStorage persistence |
| T22 | Annotation layer | ✅ | Point/line/polygon drawing |
| T23 | PyPI publish CI | ✅ | GitHub Actions on tag |
| T24 | Bundle size | ⏭️ | Skipped (minimal gain, risky) |
| T25 | Offline mode | ✅ | Service worker (deduplicated) |
| T26 | Time-series playback | ✅ | Earthquake timeline + hurricane animation |
| T27 | Basemap themes | ✅ | 9 basemaps |
| T28 | Geocode search | ✅ | Already in Toolbar |
| T29 | Elevation profile | ✅ | SVG sparkline |
| T30 | Export | ✅ | GeoJSON + PNG |
| SAR-1 | Flood extent | ✅ | Copernicus EMS |
| SAR-2 | Sea ice | ✅ | NSIDC/OSI SAF |
| SAR-3 | Active fires | ✅ | NASA VIIRS via FIRMS key |
| SAR-4 | Subsidence | 🔜 | COMET-LiCS (static dataset) |
| **A** | **Hurricane animation** | **✅** | **Play/pause + progress bar** |
| **B** | **4 new 2D layers** | **✅** | **Aviation weather, satellites, bathymetry, GOES imagery** |
| **C** | **Accessibility** | **✅** | **ARIA roles, keyboard shortcuts, live regions** |
| **D** | **Visibility-aware polling** | **✅** | **Pause/resume when tab hidden** |
| **E** | **Python geo_utils tests** | **✅** | **12 new tests (42 total)** |
| **F** | **Vessel timeout fix** | **✅** | **15s empty timeout, 30s reconnect** |
| **G** | **Hurricane full tracks** | **✅** | **API returns track polylines, 2D renders track lines + animation** |
| **H** | **Responsive mobile sidebar** | **✅** | **85vw on mobile, backdrop overlay, swipe-to-close, hamburger button** |
| **I** | **Globe LOD system** | **✅** | **4 altitude zones, entity visibility toggle per zone** |
| **J** | **Python tile_format tests** | **✅** | **34 tests (encode/decode, quantization, compression ratios)** |
| **K** | **Python converter tests** | **✅** | **7 tests (convert_tile, convert_directory, quantization)** |
| **L** | **Globe performance G1** | **✅** | **Parallel scripts, FXAA off, entity limits, render bug fix** |
| **M** | **CF Cache API fix** | **✅** | **caches.open() replaces broken (caches as any).default** |
| **N** | **R2 cache-aside for tiles** | **✅** | **3-9x faster cached tiles (500ms → 150ms TTFB)** |
| **O** | **Cursor debounce** | **✅** | **80ms throttle, 6x fewer re-renders** |
| **P** | **Service Worker TTL** | **✅** | **Per-path TTL: 24h terrain, 2min data, 24h geo** |
| **Q** | **Vectorize slope()** | **✅** | **3.4s → 0.022s (154x faster)** |
| **R** | **Vectorize viewshed()** | **✅** | **18.4s → 0.053s (347x faster)** |
| **S** | **Performance audit doc** | **✅** | **PERFORMANCE_AUDIT.md with 12 prioritized items** |

---

## Layer Coverage: 33/37 2D + 37 Registry

| Layer | 2D | 3D | Category |
|-------|:--:|:--:|----------|
| Hillshade | ✅ | ✅ | Terrain |
| Elevation Color | ✅ | ✅ | Terrain |
| Data Accuracy | ✅ | ✅ | Terrain |
| Topo Contours | ✅ | ✅ | Terrain |
| Bathymetry | ✅ | ✅ | Terrain |
| Earthquakes | ✅ | ✅ | Weather |
| Weather Radar | ✅ | ✅ | Weather |
| Weather Warnings | ✅ | ✅ | Weather |
| Hurricane Tracks | ✅ | ✅ | Weather |
| Flights (ADS-B) | ✅ | ✅ | Aviation |
| Vessels (AIS) | ✅ | ✅ | Maritime |
| Military ADS-B | ✅ | ✅ | Aviation |
| Flight Arcs | — | ✅ | Aviation |
| NLNOG Nodes | ✅ | ✅ | Infrastructure |
| Building Footprints | ✅ | ✅ | Infrastructure |
| Population Density | ✅ | ✅ | Infrastructure |
| Land Cover | ✅ | ✅ | Infrastructure |
| Satellite Imagery | ✅ | ✅ | Imagery |
| Waterways | ✅ | ✅ | Hydro |
| Blue Marble | — | ✅ | Imagery |
| Night Lights | ✅ | ✅ | Imagery |
| Satellite (GOES) | ✅ | ✅ | Imagery |
| Satellites | ✅ | ✅ | Space |
| Natural Events | ✅ | ✅ | Space |
| Space Weather | ✅ | ✅ | Weather |
| Air Quality | ✅ | ✅ | Weather |
| SIGMETs/AIRMETs | ✅ | ✅ | Aviation |
| Volcano Alerts | ✅ | ✅ | Weather |
| Disaster Alerts | ✅ | ✅ | Weather |
| Marine Weather | ✅ | ✅ | Maritime |
| Wildfires | ✅ | ✅ | Weather |
| Flood Extent | ✅ | ✅ | Weather |
| Sea Ice | ✅ | ✅ | Weather |
| Burn Scars | ✅ | ✅ | Weather |
| Lightning | ✅ | ✅ | Weather |
| Orbital Tracks | — | ✅ | Space |
| Ground Tracks | — | ✅ | Space |

---

## Future Enhancements

1. **ADSB Exchange subscription** ($30/yr) — unlocks military aircraft data
2. **COMET-LiCS subsidence** — static InSAR velocity maps
3. **Layer comparison** — split view
4. **Annotation styling** — color picker, line width
5. **AISHub feeder** — vessel data via RTL-SDR hardware
6. **Bundle size optimization** — lazy layer loading
7. **Custom Cesium build** — strip unused features (~2.5MB savings)
8. **WebWorker TLE computation** — offload satellite propagation

See also:
- `docs/GAP_ANALYSIS.md` — Full gap analysis with priorities
- `docs/VESSEL_AIRCRAFT_DATA_OPTIONS.md` — AIS/ADS-B data source options
- `docs/PERFORMANCE_AUDIT.md` — Performance profiling results and optimization plan
