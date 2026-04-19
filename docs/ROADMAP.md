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

## Planned: Elevation Data Optimization

### Phase 1: WebP Lossless Tiles (est. 1 week, 28% storage reduction)
- **Switch**: Terrarium PNG → WebP lossless for all z0-z10 tiles
- **Storage**: 70 GB → ~50 GB on R2
- **Effort**: Low — regenerate tiles, update content-type, `Vary: Accept`
- **Risk**: None — WebP supported by MapLibre 3.x+, CesiumJS 1.100+
- **See:** `ELEVATION_STORAGE_AND_RESOLUTION_PLAN.md` Phase 1

### Phase 2: OZT2 Format + WASM Decoder (est. 3-4 weeks, 93% storage reduction)
- **Format**: 4-byte header + Brotli-compressed adaptive-gradient residuals
- **Storage**: 70 GB → ~5 GB on R2 (30m land + 450m ocean)
- **Decode**: ~2ms per 256×256 tile via Rust WASM module (~5KB)
- **Compression**: Auto-selects bit depth per tile (8-16 bits based on local elevation range)
- **See:** `ELEVATION_STORAGE_AND_RESOLUTION_PLAN.md` Phase 2

### Phase 3: 10m Global Land (est. 4-6 weeks)
- **Source**: Copernicus EEA 10m (EU), NASADEM (±60°), ArcticDEM (>60°N), HMA 8m
- **Storage**: ~16 GB total (multi-resolution pyramid)
- **See:** `ELEVATION_STORAGE_AND_RESOLUTION_PLAN.md` Phase 3

### Phase 4: Regional 1m + NISAR Integration (ongoing)
- **Free LiDAR**: USGS 3DEP (CONUS), AHN (Netherlands), government open data
- **NISAR**: Global 30m change detection post-2025 launch
- **Storage**: ~33 GB for 13% global 1m + 87% 30m (OZT2 compressed)
- **See:** `ELEVATION_STORAGE_AND_RESOLUTION_PLAN.md` Phase 4

### Storage Estimates (OZT2 compressed, all resolutions)

| Resolution | Storage | vs Current (70GB) |
|-----------|---------|---------------------|
| 30m land + 450m ocean (current) | ~5 GB | 0.07× |
| 10m land + 450m ocean | ~16 GB | 0.2× |
| 5m land + 450m ocean | ~35 GB | 0.5× |
| 2m land + 450m ocean | ~95 GB | 1.4× |
| 1m land + 450m ocean | ~204 GB | 2.9× |

### Future: z11 Terrain Tiles
- **Tiles**: ~4M tiles at ~78m resolution (z11)
- **Source**: Copernicus GLO-30 + GEBCO 2025
- **Encoding**: OZT2 (after Phase 2) or Terrarium WebP (Phase 1)
- **Storage**: ~2 GB on R2 (OZT2) vs ~3-4 GB (WebP)
- **Status**: Tiles exist locally at `/nas/Temp/DEMs/data/terrarium-tiles/`

---

## Future Improvements

### High Priority
- [ ] Landing page component split (2,331 lines — extract sections into components)
- [ ] Shareable map state via URL hash (map + globe pages)
- [ ] WASM geospatial (GDAL/geozero for client-side format conversion in Studio)
- [ ] **WebP lossless tile delivery** (28% R2 storage reduction, see `ELEVATION_STORAGE_AND_RESOLUTION_PLAN.md`)
- [ ] **OZT2 format + WASM decoder** (93% R2 storage reduction, see `ELEVATION_STORAGE_AND_RESOLUTION_PLAN.md`)

### Medium Priority
- [ ] PWA offline support (service worker tile caching)
- [ ] Time-series animation (hurricane tracks with play/pause)
- [ ] Heatmap/choropleth visualization for uploaded data
- [ ] Shapefile/GeoPackage import in Studio
- [ ] Mobile-responsive sidebar (collapsible on small screens)
- [ ] **10m global land elevation** (multi-resolution pyramid, see `ELEVATION_STORAGE_AND_RESOLUTION_PLAN.md`)
- [ ] **Free government LiDAR ingestion** (USGS 3DEP, AHN, etc., see `ELEVATION_STORAGE_AND_RESOLUTION_PLAN.md`)
- [ ] **NISAR integration** (post-2025 launch, global 30m change detection)

### Low Priority
- [ ] AI-powered geospatial queries
- [ ] Real-time collaboration (shared maps)
- [ ] 3D building extrusion on globe
- [ ] i18n (internationalization)
- [ ] WCAG 2.1 AA accessibility compliance
- [ ] **Regional 1m elevation** (community contributions, commercial tasked SAR)
- [ ] **4D elevation / temporal change tracking** (per-tile versioning, NISAR diff)
- [ ] **Community data submission pipeline** (`oz ingest` CLI, PR-based workflow)
