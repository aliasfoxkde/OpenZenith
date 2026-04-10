# OpenZenith Roadmap

## Current State

- **Live**: openzenith.cyopsys.com / openzenith.pages.dev
- **Runtime**: Cloudflare Pages (Edge Workers)
- **Terrain**: z0-z10 Terrarium PNG tiles on R2 (~1.1M tiles, ~1.7GB)
- **Elevation**: SRTM 30m (land, HuggingFace) + GEBCO 2025 (ocean/bathymetry, CEDA)
- **API**: 30+ endpoints covering elevation, bathymetry, flights, vessels, earthquakes, hurricanes, weather, satellites, and more

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

## Completed

- [x] GEBCO 2025 bathymetry (server-side COG reader with CEDA range requests)
- [x] Client-side GEBCO bathymetry (direct browser fetch, bypasses server)
- [x] SRTM 30m merged chunks on HuggingFace (client-side elevation)
- [x] z0-z10 terrain tiles on R2
- [x] Unit test suite (178 tests, zero integration test dependency)
- [x] CI/CD pipeline (GitHub Actions: lint, typecheck, test, build, deploy)
- [x] Overture Maps integration on Explore page
