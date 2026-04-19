# OpenZenith — Remaining Tasks & Progress

**Version:** 0.5.1 | **Last Updated:** 2026-04-19  
**Deploy:** `cd api && npm run build && npm run pages:build && npx wrangler pages deploy .vercel/output/static --project-name=openzenith --commit-dirty=true`

---

## Task Status — 29/30 Complete

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
| T11 | Opacity sliders | ✅ | 13 raster layers |
| T12 | pip install entry point | ✅ | |
| **T13** | **FIRMS wildfire key** | **✅** | **Key set, validated: 3,000+ fires/day** |
| T14 | ADSB Exchange key | ⏭️ | $30/yr subscription — deferred |
| **T15** | **AISstream vessel key** | **✅** | **Key set, validated: WebSocket connects** |
| T16 | OpenSky latency fix | ✅ | SWR 15min stale window |
| T17 | Celestrak latency fix | ✅ | SWR 30min stale window |
| T18 | Elevation accuracy | ✅ | 360×180 binary land mask |
| T19 | Terrain 3D | ✅ | setTerrarium already existed |
| T20 | Measurement polish | ✅ | DD/DMS toggle, elevation profile |
| T21 | Bookmarks | ✅ | localStorage persistence |
| T22 | Annotation layer | ✅ | Point/line/polygon drawing |
| T23 | PyPI publish CI | ✅ | GitHub Actions on tag |
| T24 | Bundle size | ⏭️ | Skipped (minimal gain, risky) |
| T25 | Offline mode | ✅ | Service worker |
| T26 | Time-series playback | ✅ | Earthquake timeline |
| T27 | Basemap themes | ✅ | 9 basemaps |
| T28 | Geocode search | ✅ | Already in Toolbar |
| T29 | Elevation profile | ✅ | SVG sparkline |
| T30 | Export | ✅ | GeoJSON + PNG |
| SAR-1 | Flood extent | ✅ | Copernicus EMS |
| SAR-2 | Sea ice | ✅ | NSIDC/OSI SAF |
| SAR-3 | Active fires | ✅ | NASA VIIRS via FIRMS key |
| SAR-4 | Subsidence | 🔜 | COMET-LiCS (static dataset) |

---

## Configured API Keys

| Key | Set Via | Status | Rate Limit |
|-----|---------|--------|------------|
| FIRMS_MAP_KEY | wrangler secret + .env.local | ✅ Validated | 5000 tx / 10 min |
| AISSTREAM_KEY | wrangler secret + .env.local | ✅ Validated | Free tier |
| OPENSKY_CLIENT_ID | wrangler secret + .env.local | ✅ Working | Anonymous |
| ADSB_EXCHANGE_KEY | Not set (subscription required) | ⏭️ Deferred | $30/yr |

---

## Live Data Validation

| Endpoint | Status | Count | Source |
|----------|--------|-------|--------|
| /api/wildfires | ✅ 200 | 3,000+ | NASA FIRMS VIIRS |
| /api/vessels | ✅ 200 | Configured | AISstream.io |
| /api/military | ✅ 200 | 0 (no key) | ADSB Exchange |
| /api/earthquakes | ✅ 200 | 301 | USGS |
| /api/satellites | ✅ 200 | 30 | Celestrak |
| /api/nlnog | ✅ 200 | 741 | NLNOG |
| /api/flights | ⚠️ 0 (cached) | OpenSky | SWR helps |

---

## 2D Map Layers: 30 total

Geophysical: earthquakes, volcanoes, nlnogNodes, buildings  
Weather: radar, hurricaneTracks, wildfires, airQuality, gdacs, floods, seaIce, burnScars, marineWeather, spaceWeather, lightning, nightLights  
Aviation: flights, military, vessels  
Imagery: hillshade, elevationColor, elevationAccuracy, contours, bathymetry, populationDensity, landCover, sentinel2  
Navigation: boundaries  

---

## Future Enhancements

1. **ADSB Exchange subscription** ($30/yr) — unlocks military aircraft data
2. **COMET-LiCS subsidence** — static InSAR velocity maps
3. **Hurricane track animation** — timeline playback
4. **Layer comparison** — split view
5. **Annotation styling** — color picker, line width
