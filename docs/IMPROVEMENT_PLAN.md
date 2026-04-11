# OpenZenith Comprehensive Improvement & Enhancement Plan

**Version:** 1.1
**Last Updated:** 2026-04-10
**Status:** Draft

---

## Current State Summary

### What Exists

**Pages (8):**
- Landing page (2,187 lines) — hero, features, data sources, tech stack
- Map (1,144 lines) — MapLibre 2D with sidebar layers, surveillance UI
- Globe (1,303 lines) — CesiumJS 3D with widget system (basemaps, layers, tools, settings)
- Studio (385 lines) — MapLibre sandbox with tool panel (elevation, geocode, overpass, weather, data upload, layers)
- Explore (1,624 lines) — ArcGIS service discovery + Overpass query builder
- Demo (268 lines) — minimal demo page
- About (349 lines), Contribute (384 lines)

**API Endpoints (20+):**
- Elevation (single + batch), DEM tiles (R2), GEBCO tiles, bathymetry
- Geocode, reverse geocode, Overpass proxy
- Weather warnings, earthquakes, radar, hurricane tracks
- Flights (OpenSky), military ADS-B, vessels (AISstream), waterways
- NLNOG nodes, BGP routing, GeoIP, CORS proxy, health

**Data Layers (20):** Terrain (hillshade, elevation color, bathymetry), Weather (earthquakes, radar, warnings, hurricanes), Aviation (flights, military, arcs), Maritime (vessels), Infrastructure (NLNOG), Hydrography (waterways), Imagery (Blue Marble, Night Lights, GOES), Space (satellites, EONET events, orbital/ground tracks)

**Infrastructure:** Cloudflare Pages (edge runtime), R2 (DEM tiles), HuggingFace (dataset hosting), PWA ready (service worker + manifest)

### Completed Since Last Update

- **G1 (OGC API):** `/api/tiles`, `/api/collections`, `/api/stac` endpoints added
- **G2 (Vector tiles):** `/api/pmtiles/[key]` endpoint + Overture Maps MVT tiles on map
- **G4 (Tests):** 178 unit tests across 22 test files, all passing, zero integration dependencies
- **G5 (CI/CD):** GitHub Actions pipeline: lint, format, typecheck, test, build, deploy
- **T2 (Middleware):** Rate limiting + CORS middleware in `src/middleware.ts`
- **T7 (TypeScript strict):** `strict: true` enabled, zero type errors
- **F1 (Sentinel imagery):** `/api/sentinel2/[z]/[x]/[y]` route
- **F2 (CORINE land cover):** `/api/landcover/[z]/[x]/[y]` route
- **F3 (Population density):** `/api/population/[z]/[x]/[y]` route
- **F4 (Overture Maps):** Buildings layer on map, Overture Maps tab on Explore page
- **F5 (Air quality):** `/api/airquality` endpoint (WAQI)
- **Quick win #7:** Explore page ArcGIS replaced with Overture Maps
- **Quick win #9:** robots.txt and sitemap.xml exist
- **GEBCO 2025 bathymetry:** Server-side (COG reader via CEDA) + client-side (direct browser fetch)
- **Terrain tiles:** z0-z10 uploaded to R2 (~1.1M tiles, ~1.7GB)

### What's In Progress

- z9/z10/z13 DEM tile uploads to HuggingFace (active)
- z13 Quantized Mesh generation (14 shards, ~50% complete)

---

## Gap Analysis

### Critical Gaps

| # | Gap | Impact | Priority |
|---|-----|--------|----------|
| G1 | **No OGC API compliance** — all endpoints are custom REST, no standard OGC API - Tiles/Features/Maps | Interoperability with QGIS, ArcGIS, other GIS tools | High |
| G2 | **No vector tile support** — all basemaps are raster, no MVT/PMTiles | Performance, styling flexibility, bandwidth | High |
| G3 | **Studio page is skeletal** (385 lines) — tools are stub implementations, no drawing, no measurement, no data table preview | Core GIS sandbox functionality missing | High |
| G4 | **No test coverage** — ~~Vitest/Playwright configured but minimal tests~~ 178 unit tests, needs E2E | Code quality, regression prevention | High |
| G5 | **No CI/CD pipeline** — ~~manual builds and deploys~~ GitHub Actions pipeline active | Release reliability, collaboration | High |
| G6 | **No offline support** — PWA manifest exists but no service worker tile caching | Usability in low-connectivity areas | Medium |
| G7 | **No coordinate reference system (CRS) support** — everything is WGS84 only | Professional GIS use cases | Medium |
| G8 | **No data export** — can't export GeoJSON, CSV, shapefile from Studio | User workflow completion | Medium |

### Feature Gaps

| # | Gap | Description |
|---|-----|-------------|
| F1 | No Sentinel satellite imagery layer |
| F2 | No CORINE land cover / land use layer |
| F3 | No population density layer (GHSL/WorldPop) |
| F4 | No Overture Maps buildings/places layer |
| F5 | No air quality layer (Copernicus Atmosphere) |
| F6 | No flood/fire risk layer (Copernicus EMS) |
| F7 | No terrain profile tool on 2D map (only on Globe) |
| F8 | No distance/area measurement on 2D map |
| F9 | No drawing/annotation tools on 2D map |
| F10 | No KML/GPX/Shapefile/GeoPackage import in Studio |
| F11 | No collaborative features (share map state, URL params) |
| F12 | No map print/export (screenshot, PDF) |
| F13 | No time-series animation (e.g., hurricane tracks) |
| F14 | No heatmap/choropleth visualization for uploaded data |
| F15 | No STAC catalog for data discovery |

### Technical Debt

| # | Issue | Description |
|---|-------|-------------|
| T1 | Explore page ArcGIS placeholder URL — `servicesX.arcgis.com/XXXX` |
| T2 | No middleware — no rate limiting, CORS, auth |
| T3 | No error boundaries — component crashes kill the page |
| T4 | No loading states — maps show blank while initializing |
| T5 | No image optimization — `images.unoptimized: true` |
| T6 | Large page bundles — globe (1,303 lines), map (1,144 lines) not code-split |
| T7 | No TypeScript strict mode — `strict: false` implied |
| T8 | Duplicate layer loading code between map/globe/studio |
| T9 | Hardcoded API keys in .env.local (no secrets management) |
| T10 | No environment variable validation at startup |

---

## Enhancement Plan

### Phase 1: Foundation (Code Quality & Testing)

**Goal:** Solid codebase foundation for all future features.

#### 1.1 Test Suite
- Unit tests for all `api/src/lib/` utilities (cache, theme, parsers, map-helpers)
- Unit tests for all API route handlers (elevation, geocode, overpass, etc.)
- Integration tests for layer registry (add/remove/toggle)
- E2E tests for critical user flows (map loads, click for elevation, search address)
- Target: 80% coverage on lib/ and api/ directories
- Add `npm run test:coverage` and `npm run test:e2e` scripts

#### 1.2 Error Handling
- Add React error boundaries around map components (map crash ≠ page crash)
- Add try/catch to all API routes with consistent error response format
- Add loading/skeleton states for map initialization
- Add toast/notification system for user-facing errors

#### 1.3 TypeScript Strictness
- Enable `strict: true` in tsconfig.json incrementally
- Add proper types to all component props
- Type the MapLibre and CesiumJS map instances (currently `any`)

#### 1.4 CI/CD Pipeline
- GitHub Actions: lint, type-check, test, build on PR
- Deploy to Cloudflare Pages on merge to main
- Lighthouse CI for performance/accessibility scores
- Add status badges to README

#### 1.5 Code Splitting & Bundle Optimization
- Lazy load globe page (CesiumJS is 2MB+)
- Dynamic import for Studio tool components
- Extract shared layer logic into `api/src/lib/layers/` hooks
- Tree-shake unused MapLibre/CesiumJS features

### Phase 2: Studio Completion (GIS Sandbox)

**Goal:** Studio becomes a fully functional GIS workspace.

#### 2.1 Drawing Tools
- Point, line, polygon drawing on map
- Vertex editing (move, delete, add)
- Undo/redo stack
- Export drawn features as GeoJSON
- Keyboard shortcuts (Escape to cancel, Enter to finish)

#### 2.2 Measurement Tools
- Distance measurement (click points along path)
- Area measurement (draw polygon)
- Bearing/azimuth between two points
- Elevation profile along drawn line (using batch elevation API)

#### 2.3 Data Import (Complete)
- GeoJSON/TopoJSON — already working via parsers.ts
- CSV/TSV — auto-detect lat/lon columns (already partial)
- GPX — tracks and waypoints (already partial)
- KML — placemarks and polygons (already partial)
- Shapefile — .shp + .dbf + .shx bundle
- GeoPackage — via SQL.js WASM
- GeoTIFF/COG — as overlay with transparency

#### 2.4 Data Visualization
- Choropleth coloring for uploaded polygon data (classify by numeric field)
- Heatmap rendering for point data (MapLibre heatmap layer type)
- Proportional symbol sizing
- Color ramps (sequential, diverging, categorical)

#### 2.5 Data Table & Export
- Attribute table showing uploaded data properties
- Sort, filter, search table
- Export as GeoJSON, CSV, KML, GeoPackage
- Copy coordinates to clipboard

#### 2.6 Map State Persistence
- Encode current view (center, zoom, layers, basemap) in URL hash
- Shareable map links
- LocalStorage persistence of user preferences
- Bookmark save/load (like globe page has)

### Phase 3: Data Layer Expansion

**Goal:** Richer data catalog with modern open data sources.

#### 3.1 Sentinel-2 Imagery (Priority: High)
- Use AWS Earth Search or Copernicus Data Space for recent Sentinel-2 imagery
- Near-infrared (NIR) false color composite
- 10m resolution, 5-day revisit
- Implementation: WMS proxy or pre-cached tile layer via TiTiler

#### 3.2 Overture Maps Buildings (Priority: High)
- Free global building footprints from Overture Maps Foundation
- Available as GeoParquet or via Overture API
- Implementation: Pre-process to MVT/PMTiles, serve from R2 or CDN
- Enables building footprint overlay on map and globe

#### 3.3 Population Density (Priority: Medium)
- Global Human Settlement Layer (GHSL) at 100m/1km resolution
- WorldPop population grids
- Implementation: Pre-tile as raster overlay, serve from R2
- Use with choropleth classification

#### 3.4 CORINE Land Cover (Priority: Medium)
- European land cover/land use (44 classes, 100m resolution)
- From Copernicus Land Monitoring Service
- Implementation: Pre-tile as raster overlay, serve from R2
- Unique to Europe — valuable for EU users

#### 3.5 Air Quality (Priority: Medium)
- Copernicus Atmosphere Monitoring Service (CAMS)
- NO2, PM2.5, O3, SO2 concentrations
- Implementation: CAMS global forecasts via WMS or pre-tiled
- Relevant for health/urban planning

#### 3.6 Fire/Thermal Anomalies (Priority: Low)
- NASA FIRMS (Fire Information for Resource Management System)
- VIIRS active fire detections, near real-time
- Implementation: API proxy to FIRMS, render as point layer

### Phase 4: Modern Standards & Interoperability

**Goal:** OpenZenith works with standard GIS tools.

#### 4.1 OGC API - Tiles
- Implement `/tiles/{tileMatrixSetId}/{tileMatrix}/{tileRow}/{tileCol}` endpoint
- Follow OGC API - Tiles 1.0 specification
- Support multiple tileMatrixSets (WebMercator, WGS84)
- Enable direct consumption by QGIS, ArcGIS, OpenLayers

#### 4.2 OGC API - Features
- Implement `/collections/{collectionId}/items` endpoint
- GeoJSON output with CQL2 filtering
- Pagination, bbox filtering, spatial operations
- Standard collection metadata

#### 4.3 STAC Catalog
- Catalog all data sources using STAC Item/Collection specification
- Static STAC catalog served from R2 or generated at build time
- Enables discovery by STAC-aware tools (pystac, stac-browser)
- Links to external STAC catalogs (Copernicus, USGS)

#### 4.4 PMTiles Support
- Convert existing Terrarium PNG tiles to PMTiles format for z0-z8
- Serve PMTiles from R2 with `Content-Range` headers
- MapLibre GL JS v5+ has native PMTiles protocol support
- Eliminates per-tile R2 lookups, improves performance

#### 4.5 WMS/WMTS Proxy (Optional)
- Lightweight WMS proxy for Copernicus/USGS data sources
- Enables QGIS/ArcGIS direct connection to OpenZenith as WMS server
- On-the-fly reprojection from WGS84 to requested CRS

### Phase 5: Performance & Infrastructure

**Goal:** Fast, reliable, globally distributed.

#### 5.1 Tile Caching Strategy
- Implement `Cache-Control: public, max-age=31536000, immutable` for static tiles
- Add `ETag` headers for conditional requests
- Use Cloudflare Cache API for dynamic data (flights, vessels)
- Implement tile pre-fetching based on viewport trajectory

#### 5.2 WASM Geospatial
- Compile GDAL to WASM for client-side format conversion
- Use geozero/flatgeobuf WASM for fast spatial operations
- Enable client-side reprojection, clipping, and format conversion in Studio

#### 5.3 Web Workers
- Offload heavy computation to web workers:
  - GeoJSON parsing and simplification
  - Elevation profile calculation
  - Coordinate transformation
  - File format conversion
- Worker pool pattern with `navigator.hardwareConcurrency`

#### 5.4 CDN & Global Distribution
- Ensure all static assets served from Cloudflare CDN
- Pre-compress tiles with Brotli at edge
- Implement HTTP/2 and HTTP/3 server push for tile batches
- Regional edge caching for frequently-accessed areas

#### 5.5 Quantized Mesh for 3D Terrain
- Current: Terrarium PNG raster decoded in CesiumJS fragment shader
- Upgrade: Quantized Mesh provides true 3D surface with proper normals
- Already generating QM tiles (z13 pipeline in progress)
- Serve QM tiles via 3D Tiles spec for CesiumJS native consumption

### Phase 6: UX & Accessibility

**Goal:** Professional, accessible, mobile-friendly.

#### 6.1 Mobile Optimization
- Touch-friendly controls for drawing tools
- Pinch-zoom gestures
- Responsive sidebar (collapsible on mobile)
- Offline tile caching via Service Worker
- Reduce JavaScript bundle for mobile (lazy load CesiumJS only on desktop)

#### 6.2 Accessibility (WCAG 2.1 AA)
- ARIA labels on all interactive map controls
- Keyboard navigation for tool panels
- High-contrast mode support
- Screen reader announcements for data layer changes
- Skip links for map controls

#### 6.3 Internationalization (i18n)
- Date/number formatting by locale
- Measurement units (metric/imperial toggle)
- Layer names translatable
- Right-to-left (RTL) support for Arabic/Hebrew maps

#### 6.4 Onboarding
- Interactive tutorial for first-time users
- Tooltips on map controls
- Example datasets to load in Studio
- "Try this" prompts for each tool

### Phase 7: Advanced Features

**Goal:** Differentiate from other GIS platforms.

#### 7.1 AI-Powered Geospatial Analysis
- Natural language queries: "Show me elevation above 3000m near Denver"
- Auto-classification of uploaded data
- Smart layer suggestions based on uploaded data type
- Anomaly detection in time-series geospatial data

#### 7.2 Real-Time Collaboration
- Shareable map links with embedded layer/view state
- WebSocket-based multi-user cursor/annotation sync
- Version history for shared maps (CRDT-based)

#### 7.3 3D Data Visualization
- Extrude building footprints to 3D on globe
- Point cloud visualization (LAS/LAZ via Potree or deck.gl)
- Subsurface visualization (geological cross-sections)

#### 7.4 Time-Series Explorer
- Animated hurricane tracks with play/pause
- Historical satellite imagery comparison (before/after slider)
- Temporal data filtering (show data for specific date range)

#### 7.5 Copernicus Data Space Integration
- Direct access to Sentinel-2, Sentinel-1, Sentinel-3 imagery
- STAC search interface for Copernicus datasets
- On-demand processing: select area → get analysis results

---

## Implementation Priority Matrix

| Phase | Effort | Impact | Dependencies | Recommended Order |
|-------|--------|--------|-------------|-------------------|
| Phase 1: Foundation | Medium | High | None | **1st** — blocks everything else |
| Phase 2: Studio | High | High | Phase 1 | **2nd** — core differentiator |
| Phase 3: Data Layers | Medium | High | Phase 1 | **3rd** — enriches all views |
| Phase 4: Standards | Medium | Medium | Phase 1 | **4th** — enables ecosystem |
| Phase 5: Performance | High | High | Phase 1, 4 | **5th** — ongoing optimization |
| Phase 6: UX | Medium | Medium | Phase 1, 2 | **6th** — broadens audience |
| Phase 7: Advanced | Very High | High | All | **7th** — long-term vision |

## Quick Wins (Can Do Now)

These require minimal effort and provide immediate value:

1. **URL hash for map state** — encode center/zoom/basemap in URL, enable shareable links
2. **Distance measurement on map** — simple two-click distance using Turf.js
3. **Better loading states** — skeleton UI while MapLibre/CesiumJS loads
4. **Error boundaries** — prevent map crashes from killing the page
5. **Elevation profile on 2D map** — reuse globe's elevation-profile tool logic
6. **KML import in Studio** — parsers.ts already partially supports this
7. **Fix explore page ArcGIS placeholder URL** — one-line fix
8. **Add favicon and OG meta tags** — better link previews when sharing
9. **Add robots.txt and sitemap.xml** — SEO for documentation pages
10. **Shard layer loading code** — extract shared hooks from map/globe/studio

## Metrics & Success Criteria

| Metric | Current | Target |
|--------|---------|--------|
| Test coverage | ~0% | 80%+ |
| Lighthouse Performance | Unknown | 90+ |
| Lighthouse Accessibility | Unknown | 90+ |
| Build time | Unknown | < 60s |
| JS bundle size (landing) | Unknown | < 200KB |
| JS bundle size (map) | Unknown | < 500KB |
| JS bundle size (globe) | Unknown | < 2MB (lazy) |
| First Contentful Paint | Unknown | < 2s |
| Time to Interactive | Unknown | < 4s |
| Data layers available | 20 | 35+ |
| API endpoints | 20+ | 30+ |
| OGC API compliance | 0% | 100% (Tiles + Features) |
| Mobile usability | Poor | Good |
| PWA installable | Partial | Full |
