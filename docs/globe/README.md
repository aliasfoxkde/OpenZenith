# Globe Page — Architecture & Developer Guide

**Path:** `api/src/app/globe/`
**Live:** https://openzenith.pages.dev/globe | Preview: https://50b9ffcc.openzenith.pages.dev/globe
**Status:** Fully functional (2026-05-01)

---

## Overview

The `/globe` page is a full-screen 3D geospatial visualization platform powered by CesiumJS 1.119. It renders real-time data layers (earthquakes, flights, vessels, satellites, hurricanes, weather radar, etc.) on a 3D globe with terrain, imagery basemaps, and interactive tools.

**Key characteristics:**
- CesiumJS loaded dynamically from CDN (unpkg, with jsdelivr fallback)
- Terrain: CSR-first SRTM 30m from HuggingFace, server PNG fallback
- All data fetched via `/api/proxy/` to avoid CORS issues
- 25 data layer types, 5 basemap themes, 4 UI themes
- No Cesium Ion token required — fully self-hosted

---

## File Structure

```
globe/
├── page.tsx                      # Main component (1,423 → with fixes)
├── layout.tsx                    # Globe layout (metadata)
├── loading.tsx                  # Loading skeleton
└── lib/
    ├── cesium-init.ts           # Viewer creation, terrain, imagery setup
    ├── terrain-csr.ts            # Custom terrain provider (CSR SRTM)
    ├── helpers.ts              # Hash parsing, basemap switching, utilities
    ├── constants.ts             # Themes, basemaps, sidebar sections, icons
    ├── types.ts                 # TypeScript interfaces
    ├── data-fetchers.ts        # All API fetchers with retry + dedup
    ├── lod.ts                   # Level-of-detail entity management
    ├── clustering.ts            # Supercluster-based point aggregation
    ├── space-scene.ts           # Stars + planets for deep-space views
    ├── styles.ts                # All globe CSS (236 lines)
    ├── cesium-types.d.ts        # Cesium type declarations
    ├── layers/                  # 25 data layer loaders
    │   ├── earthquakes.ts        # USGS GeoJSON
    │   ├── flights.ts            # OpenSky Network (via /api/opensky)
    │   ├── vessels.ts            # AISstream.io (via /api/vessels)
    │   ├── military.ts            # ADSB Exchange (via /api/military)
    │   ├── satellites.ts         # Celestrak TLE + satellite.js
    │   ├── hurricanes.ts        # NOAA IBTrACS CSV
    │   ├── warnings.ts           # NWS weather warnings (via /api/weather/warnings)
    │   ├── radar.ts              # RainViewer API (via /api/proxy)
    │   ├── events.ts             # NASA EONET (wildfires, volcanoes, storms)
    │   ├── lightning.ts          # Blitzortung (via /api/proxy)
    │   ├── volcanoes.ts          # Smithsonian GVP RSS
    │   ├── wildfires.ts         # NASA FIRMS (via /api/wildfires)
    │   ├── currents.ts           # CMEMS ocean currents
    │   ├── space-weather.ts      # NOAA SWPC solar/aurora data
    │   ├── air-quality.ts        # Open-Meteo (via /api/proxy)
    │   ├── aviation-weather.ts   # AviationWeather.gov SIGMET/AIRMETS
    │   ├── gdacs.ts              # GDACS (deprecated, returns empty)
    │   ├── marine-weather.ts     # Open-Meteo marine
    │   ├── orbital-tracks.ts     # Celestrak TLE → orbital paths
    │   ├── ground-tracks.ts      # Satellite ground tracks
    │   ├── flight-arcs.ts        # Great-circle flight arcs
    │   ├── nlnog.ts              # NLNOG RING network nodes
    │   ├── gps-jamming.ts        # GPS jamming events
    │   └── day-night.ts          # Day/night terminator
    ├── widgets/                  # Sidebar panel widgets
    │   ├── useWidgetManager.ts    # Widget layout persistence (localStorage)
    │   ├── BasemapWidget.tsx      # Basemap selector
    │   ├── LayersWidget.tsx       # Layer toggles with status
    │   ├── ToolsWidget.tsx         # Tools: measure, search, bookmarks, etc.
    │   ├── SettingsWidget.tsx      # Settings: UI toggles, theme
    │   ├── WidgetShell.tsx         # Draggable panel shell
    │   ├── WidgetBar.tsx           # Collapsed widget bar
    │   └── types.ts               # Widget interfaces
    ├── tools/                     # Interactive globe tools
    │   ├── tools.ts               # ToolManager (measure, area, elevation profile)
    │   ├── measure.ts             # Haversine distance, polygon area
    │   ├── elevation-profile.ts   # Terrain cross-section profiler
    │   ├── bookmarks.ts           # Camera position bookmarks
    │   ├── annotations.ts         # Marker/line/polygon/text annotations
    │   ├── range-rings.ts         # Range ring overlays
    │   └── screenshot.ts          # Canvas screenshot export
    ├── components/
    │   ├── ContextMenu.tsx        # Right-click context menu
    │   └── HudOverlays.tsx        # HUD: LOD zone, camera alt, compass, data status
    └── __tests__/
        ├── helpers.test.ts
        ├── lod.test.ts
        └── space-scene.test.ts
```

---

## Key Architecture Decisions

### Cesium Ion Token Not Required
All Ion default behavior is disabled:
```typescript
Cesium.Ion.defaultAccessToken = undefined;
Cesium.Ion._terrainProvider = undefined;
// Override factory to prevent Viewer() from creating Ion imagery
Cesium.createDefaultImageryProvider = () => new UrlTemplateImageryProvider({...});
```
Our basemap system provides all imagery via `switchBasemapOnViewer`.

### CSR Terrain Provider
The `terrain-csr.ts` creates a custom Cesium TerrainProvider that:
1. First tries SRTM 30m chunks from HuggingFace (direct browser fetch)
2. Falls back to server-side Terrarium PNG tiles (`/api/dem-tile/`)
3. Uses `Object.defineProperty` to set `hasVertexNormals`/`hasWaterMask` (read-only getters in CesiumJS 1.119)

### Level of Detail (LOD)
The `lod.ts` system hides/shows entity types based on camera altitude:
- **SURFACE** (0–500km): all entity types visible
- **LOW ORBIT** (500km–5Mm): flights, vessels, earthquakes, satellites
- **HIGH ORBIT** (5Mm–50Mm): satellites, earthquakes, events
- **DEEP SPACE** (50Mm+): only satellite-related entities

### Dynamic Layer Loading
Layers are loaded on-demand via `import()` (code splitting):
- 25 layer modules, only loaded when layer is toggled on
- Each layer has its own polling interval (1–60 minutes)
- Data deduplication prevents duplicate concurrent fetches
- All fetches routed through `/api/proxy/` for CORS

### URL Hash State
Camera position and layer state are encoded in the URL hash:
```
https://openzenith.pages.dev/globe#2.0/20.0000/0.0000/bm=dark/l=earthquakes+events+space
```

---

## Data Sources & Refresh Rates

| Layer | Source | Refresh | Requires Key |
|-------|--------|---------|-------------|
| Earthquakes | USGS GeoJSON | 1 min | No |
| Flights | OpenSky Network | 30s | No (limited) |
| Vessels | AISstream.io | 30s | Yes |
| Military Flights | ADSB Exchange | 60s | Yes (subscription) |
| Satellites | Celestrak TLE | 6h | No |
| Hurricanes | NOAA IBTrACS | Daily | No |
| Weather Warnings | NWS API | 5 min | No |
| Radar | RainViewer | 10 min | No |
| Wildfires | NASA FIRMS | 6h | Yes (free) |
| Volcanoes | Smithsonian GVP | Weekly | No |
| Lightning | Blitzortung | Real-time | No |
| Ocean Currents | CMEMS | 6h | No |
| NLNOG Nodes | NLNOG RING | Static | No |
| GPS Jamming | LANL | Daily | No |

---

## Console Error Reference (2026-05-01)

| Error | Severity | Cause | Fix |
|-------|----------|-------|-----|
| `hasVertexNormals only getter` | **FIXED** | CesiumJS 1.119 has read-only getter | `Object.defineProperty(provider, "hasVertexNormals", {value:false,writable:true,configurable:true})` |
| `api.cesium.com/v1/assets/2 401` | **FIXED** | Ion token undefined but asset request still fires | Override `createDefaultImageryProvider` to return empty provider |
| `Tracking Prevention blocked storage` | Benign | Browser extension / ETP | All localStorage wrapped in try/catch |
| `beacon.min.js ERR_BLOCKED_BY_CLIENT` | Benign | Ad-blocker extension | Not in our code |
| `requestAnimationFrame handler 173ms` | Performance | LOD loop + atmosphere updates | Throttled to 250ms; zone check prevents redundant loops |

---

## Deployment

```bash
# Build Next.js
cd api && npm run build

# Build for Cloudflare Pages
npm run pages:build

# Deploy
npx wrangler pages deploy .vercel/output/static --project-name=openzenith

# Or via CI/CD (GitHub Actions — pushes to main trigger deploy automatically)
git push origin main
```

---

## Backup

Pre-revamp source code (before 2026-05-01 fixes) is archived at:
```
_archive/globe.bak/
```

This includes all original files from:
- `terrain-csr.ts` (before Object.defineProperty fix)
- `cesium-init.ts` (before Ion 401 fix)
- `lod.ts` (before optimization)
- `data-fetchers.ts` (before timeout handling)
- `page.tsx` (before error boundary improvement)

---

## Known Issues

1. **Cesium 1.119 terrain provider API**: Some terrain methods (`getTileDataAvailable`, `getLevelMaximumGeometricError`) return `undefined` for levels above z10. The terrain provider returns `null` for tiles above max zoom, which shows flat terrain at close zoom.
2. **Flight layer requires API key**: OpenSky Network has rate limits without authentication. Military flights require ADSB Exchange subscription.
3. **OGC API - Tiles**: `/api/tiles/` route not yet integrated into globe UI (only available via API).
4. **Page.tsx is 1,423 lines**: Should be refactored into sub-components (planned).
5. **Vessels layer shows "error" when no API key configured**: Should show friendly message.
6. **Playwright E2E tests not implemented for globe page**: Should add integration tests.

---

## Future Improvements (from ROADMAP.md)

See `docs/ROADMAP.md` for the full planned feature list:
- Time-series animation (hurricane tracks)
- PWA / offline tile caching
- Mobile-responsive sidebar
- WASM client-side format conversion (for Studio)
- Shareable map state via URL hash (partially done)
- 10m global land elevation
- OZT2 compressed terrain format
