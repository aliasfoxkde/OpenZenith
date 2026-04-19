# OpenZenith — Remaining Tasks & Progress

**Version:** 0.5.1 | **Last Updated:** 2026-04-18  
**Deploy Command:** `cd api && npm run build && npm run pages:build && npx wrangler pages deploy .vercel/output/static --project-name=openzenith --commit-dirty=true`

---

## Completed Tasks

### Tier 1 — Quick Wins ✅ ALL DONE
| # | Task | Status |
|---|------|--------|
| T1 | Fix military route 502 → 200 | ✅ |
| T2 | Add military 2D layer handler | ✅ |
| T3 | Add vessels 2D handler | ✅ |
| T4 | Add spaceWeather 2D handler | ✅ |
| T5 | Add volcanoes 2D handler | ✅ |
| T6 | Add gdacs 2D handler | ✅ |
| T7 | Add marineWeather 2D handler | ✅ |
| T8 | Add lightning 2D handler | ✅ |
| T9 | Add nightLights 2D handler | ✅ |
| T10 | Fix 18 ESLint warnings | ✅ |
| T11 | Opacity sliders for raster layers | ✅ |
| T12 | Fix pip install entry point | ✅ |

### Tier 2 — API Keys (user action needed)
| # | Task | Status | Action |
|---|------|--------|--------|
| T13 | FIRMS wildfire key | 🔒 | Register at https://firms.modaps.eosdis.nasa.gov/api/area/ |
| T14 | ADSB Exchange key | 🔒 | Register at https://adsbexchange.com/data/ |
| T15 | AISstream vessel key | 🔒 | Register at https://www.aisstream.io/ |

### Tier 3 — Medium Effort
| # | Task | Status |
|---|------|--------|
| T16 | OpenSky latency fix | ✅ stale-while-revalidate (15min) |
| T17 | Celestrak latency fix | ✅ stale-while-revalidate (30min) |
| T18 | Elevation accuracy refinement | ✅ pre-computed 360×180 binary land mask |
| T19 | Terrain 3D for 2D map | ✅ already existed (setTerrain) |
| T20 | Measurement tools polish | ✅ coordinate format toggle, elevation profile |
| T21 | Bookmarks system | ✅ save/restore viewport + layers |
| T22 | Annotation layer | ✅ draw points, lines, polygons |
| T23 | Python SDK PyPI publish | ✅ GitHub Actions on tag |
| T24 | Bundle size optimization | ⏭️ skipped (risky, minimal gain) |

### Tier 4 — Large Features
| # | Task | Status |
|---|------|--------|
| T25 | Offline mode (service worker) | ✅ SW with cache-first + tile caching |
| T26 | Time-series playback | ✅ earthquake timeline with play/pause |
| T27 | Custom basemap themes | ✅ 9 basemaps with grid selector |
| T28 | Geocode search | ✅ already existed in Toolbar |
| T29 | Elevation profile tool | ✅ SVG sparkline in sidebar |
| T30 | Export functionality | ✅ GeoJSON + PNG export |

### SAR Integration
| # | Task | Status |
|---|------|--------|
| SAR-1 | Flood extent layer | ✅ Copernicus EMS / GLOFAS |
| SAR-2 | Sea ice layer | ✅ NSIDC / OSI SAF WMS |
| SAR-3 | Burn scars / active fires | ✅ NASA VIIRS (no key needed) |
| SAR-4 | Ground deformation (COMET-LiCS) | 🔜 deferred (static dataset needed) |

---

## Current State

### 2D Map Layers: 30 total
`hillshade, elevationColor, elevationAccuracy, contours, earthquakes, warnings, events, radar, hurricaneTracks, wildfires, nlnogNodes, buildings, populationDensity, landCover, airQuality, sentinel2, flights, military, vessels, marineWeather, spaceWeather, lightning, nightLights, volcanoes, gdacs, floods, seaIce, burnScars`

### Raster layers with opacity: 13
`hillshade, elevationColor, elevationAccuracy, contours, bathymetry, radar, sentinel2, nightLights, marineWeather, populationDensity, landCover, seaIce, burnScars`

### Map Features
- 🗺️ 9 basemaps (Dark, Dark no-labels, Voyager, Light, Positron, OSM, Satellite, Topo, Terrain)
- 📏 Distance + area measurement tools
- ⛰️ Elevation profile (SVG sparkline in sidebar)
- 📌 Pins with elevation query
- ✏️ Annotations (point, line, polygon drawing)
- 🔖 Bookmarks (save/restore viewport + layers)
- 🎚️ Opacity sliders for raster layers
- 🌍 Coordinate format toggle (DD ↔ DMS)
- 📤 Export GeoJSON + PNG screenshot
- 🔍 Geocode search
- ⏱️ Earthquake timeline playback
- 📡 Layer state persistence (localStorage)
- 🔔 Toast notifications for layer errors
- 📴 Service worker offline caching

### Test Counts
- TypeScript: 178 ✅
- Python: 30 ✅ (18 hydrology/elevation + 12 terrain)

### Commits This Session
```
e48738a fix: Add node_modules to .gitignore
0ac0a9b chore: Remove accidentally committed node_modules
0f040d2 feat: Annotations, earthquake timeline, burn scars, offline SW, more basemaps
1f4af10 fix: Remove leftover dead code in elevation-accuracy route
c41838e feat: Flood extent, sea ice layers, accuracy refinement, more features
3f153f7 feat: Bookmarks, elevation profile, coordinate format, GeoJSON export, PyPI CI
eb2a31f fix: Use any cast for map.getStyle() in opacity slider
9d382ad feat: Opacity sliders for raster layers + flights cache improvement
```

---

## Remaining Items

### Requires User Action
1. **Register API keys** to unlock military aircraft, wildfire, and vessel data
2. **Test SAR layers** at different zoom levels (floods, sea ice, burn scars)

### Future Enhancements (no blocking issues)
- SAR-4: COMET-LiCS subsidence layer (static InSAR velocity maps)
- Custom annotation styling (color picker)
- Hurricane track animation
- Batch elevation export
- Layer comparison (split view)
