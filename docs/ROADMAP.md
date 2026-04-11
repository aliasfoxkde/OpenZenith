# OpenZenith Roadmap

## Current State

- **Live**: openzenith.cyopsys.com / openzenith.pages.dev
- **Runtime**: Cloudflare Pages (Edge Workers)
- **Terrain**: z0-z10 Terrarium PNG tiles on R2 (~1.1M tiles, ~1.7GB)
- **Elevation**: SRTM 30m (land, HuggingFace) + GEBCO 2025 (ocean/bathymetry, CEDA)
- **API**: 47 routes — elevation, bathymetry, flights, vessels, earthquakes, hurricanes, weather, satellites, Overture Maps, and more
- **Tests**: 236 unit tests across 45 test files, 25 E2E tests (Playwright)
- **CI/CD**: GitHub Actions pipeline (lint, format, typecheck, test, build, deploy)
- **Security**: API keys stored as Cloudflare secrets (not in repo), rate limiting middleware (120 req/min per IP)

## Completed

### Core Infrastructure
- [x] z0-z10 terrain tiles on R2
- [x] SRTM 30m merged chunks on HuggingFace (client-side elevation)
- [x] GEBCO 2025 bathymetry — server-side COG reader + client-side direct browser fetch
- [x] CI/CD pipeline (GitHub Actions)
- [x] Rate limiting + CORS middleware
- [x] API keys moved from wrangler.toml to Cloudflare secrets
- [x] API response consistency (JSON error format across all proxy endpoints)

### Testing
- [x] 236 unit tests across 45 test files (Vitest)
- [x] 25 E2E tests (Playwright, production URL)
- [x] Zero TypeScript errors (`strict: true`)

### Data Layers & Endpoints
- [x] Overture Maps integration (buildings, places, transportation, base_geography)
- [x] Sentinel-2 satellite imagery tile proxy
- [x] CORINE land cover tile proxy
- [x] Population density tile proxy (JRC GHSL)
- [x] Air quality endpoint (Open-Meteo)
- [x] OGC API — Tiles, Collections, STAC endpoints

### Studio Tools
- [x] Drawing tools (point, line, polygon with undo/redo/vertex editing)
- [x] Measurement tools (distance, area)
- [x] Elevation profile
- [x] GeoJSON/CSV/GPX/KML import
- [x] GeoJSON export + Copy JSON
- [x] Metric/Imperial unit toggle

### Code Quality
- [x] Error boundaries (ErrorBoundary component)
- [x] Dead code removal (unused lib/elevation.ts)
- [x] ESLint warnings reduced (407 remaining — all legitimate CesiumJS/MapLibre `any` types)
- [x] React hooks exhaustive-deps compliance

---

## Planned: z11 Terrain Tiles

### Scope
- **Tiles**: ~4M tiles at ~78m resolution (z11)
- **Source**: Copernicus GLO-30 + GEBCO 2025
- **Encoding**: Terrarium PNG
- **Storage**: ~3-4GB on R2

### Infrastructure Requirements
The current Cloudflare Pages instance has limited R2 storage and Worker limits. Deploying z11 tiles requires a dedicated Cloudflare setup:

- **Dedicated Cloudflare account** or Workers Paid plan with higher limits
- **R2 bucket**: 10GB capacity
- **D2 databases**: Up to 10 (for caching/indexing)
- **Worker memory**: Higher limits for larger tile processing

### Implementation
- **No code changes needed** — the existing tile pipeline (`scripts/`) and serving endpoints (`/api/tile/[z]/[x]/[y]`, `/api/dem-tile/[z]/[x]/[y]`) already support arbitrary zoom levels
- **Purely infrastructure**: Generate tiles locally, upload to R2, configure DNS/routing
- **Tile generation**: Tiles already exist locally at `/nas/Temp/DEMs/data/terrarium-tiles/`

### Future: z13 Quadtree Tiles
- **Tiles**: 32.2M QM tiles at ~1m resolution (z13)
- **Storage**: Estimated ~80-120GB on R2
- **Status**: Generated locally, NOT yet uploaded
- **Blocks**: R2 storage limits, upload time, CDN cache strategy for massive tile sets

---

## Future Improvements

### High Priority
- [ ] Landing page component split (2,331 lines — extract sections into components)
- [ ] Shareable map state via URL hash (map + globe pages)
- [ ] WASM geospatial (GDAL/geozero for client-side format conversion in Studio)

### Medium Priority
- [ ] PWA offline support (service worker tile caching)
- [ ] Time-series animation (hurricane tracks with play/pause)
- [ ] Heatmap/choropleth visualization for uploaded data
- [ ] Shapefile/GeoPackage import in Studio
- [ ] Mobile-responsive sidebar (collapsible on small screens)

### Low Priority
- [ ] AI-powered geospatial queries
- [ ] Real-time collaboration (shared maps)
- [ ] 3D building extrusion on globe
- [ ] i18n (internationalization)
- [ ] WCAG 2.1 AA accessibility compliance
