# OpenZenith — Remaining Tasks & Progress

**Version:** 0.5.1 | **Last Updated:** 2026-04-19  
**Deploy:** `cd api && npm run build && npm run pages:build && npx wrangler pages deploy .vercel/output/static --project-name=openzenith --commit-dirty=true`

---

## Task Status — 35/37 Complete

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
3. **Hurricane track animation** ✅ Done
4. **Layer comparison** — split view
5. **Annotation styling** — color picker, line width
6. **Responsive mobile design** — collapsible sidebar/drawer
7. **AISHub feeder** — vessel data via RTL-SDR hardware
8. **Bundle size optimization** — lazy layer loading

See also:
- `docs/GAP_ANALYSIS.md` — Full gap analysis with priorities
- `docs/VESSEL_AIRCRAFT_DATA_OPTIONS.md` — AIS/ADS-B data source options
