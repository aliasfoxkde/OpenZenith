# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

OpenZenith is a global geospatial intelligence platform — an interactive 3D globe (CesiumJS) and 2D map (MapLibre) with 62 mountable data layers (62 curated in `api/src/lib/layers/registry.ts`), a Python SDK for elevation/terrain analysis, and a REST API deployed on Cloudflare Pages (Edge Workers).

**Live:** https://openzenith.cyopsys.com · **Map:** https://openzenith.cyopsys.com/map · **Globe:** https://openzenith.cyopsys.com/globe

---

## Development Commands

### Frontend (Next.js API / Map / Globe)

```bash
cd api
npm run dev          # Local dev server
npm run build        # Production build
npm run lint         # ESLint check
npm run lint:fix     # ESLint fix
npm run test         # Vitest (TypeScript tests)
npm run test:watch   # Vitest watch mode
npm run openapi:generate  # Regenerate src/app/api/openapi.json/spec.json (after routes/version change)
npm run openapi:check     # Verify committed spec is current (also enforced in vitest)
npx playwright test # E2E tests
npx playwright test -- --workers=2   # reliable on this host (renderer OOM at higher parallelism)
E2E_RUN_HEAVY=1 npx playwright test e2e/ozt2-validate.spec.ts   # opt-in: full Cesium terrain pipeline check
E2E_BASE_URL=http://localhost:9006 npx playwright test          # retarget (wrangler pages dev)
```

### Python SDK

```bash
pip install openzenith          # Install package
pip install openzenith[all]    # Install with all extras (compression, download, dev)

# Run tests
pytest openzenith/tests/ -v
pytest openzenith/tests/test_elevation.py::test_get_elevation -v  # Single test

# Lint
ruff check openzenith/

# CLI
openzenith info
openzenith query --lat 40.7 --lon -74.0
openzenith trace --lat 36.0 --lon -118.0
```

---

## Architecture

```
/nas/Temp/repos/OpenZenith/
├── api/                          # Next.js 15 App Router (Cloudflare Pages)
│   ├── src/app/                  # Pages and API routes (81 API routes)
│   │   ├── api/                 # REST API endpoints (earthquakes, flights, elevation, etc.)
│   │   ├── map/                 # 2D MapLibre map page
│   │   ├── globe/               # 3D CesiumJS globe page
│   │   ├── explore/             # Combined explore page
│   │   ├── studio/              # Geospatial studio (drawing, measurement, analysis)
│   │   ├── landing/             # Landing page shared components/hooks
│   │   ├── demo/                # API demonstration interface
│   │   ├── about/ + contribute/ # Project info and contribution pages
│   │   └── wasm-demo/            # Browser WASM demo (D8, viewshed, OZT2 decode)
│   ├── src/components/          # Shared React components
│   ├── src/lib/                 # Shared libraries (tile, elevation, cache, etc.)
│   ├── public/pkg/              # WASM package (core, web target)
│   └── vitest.config.ts         # Vitest configuration
│
├── openzenith/                   # Python SDK (pip install openzenith)
│   ├── cli.py                   # CLI entry point
│   ├── elevation.py             # Elevation query functions
│   ├── terrain/                 # Slope, aspect, hillshade, viewshed, profile (raster, shading,
│   │                            #   viewshed, profiles, gradients, indices, flow_metrics, filters)
│   ├── hydrology/               # D8 flow direction, flow accumulation, stream extraction, tracing
│   │                            #   (flow, streams, watersheds, depressions, channels, flowpaths,
│   │                            #   inundation, indices)
│   ├── tile_format.py           # OZT1 custom binary format (zstd)
│   ├── tile_format_v2.py        # OZT2 compression (gradient prediction + Zstd)
│   ├── merged.py                # Reader for .merged OZCHNK01 chunk files
│   ├── async_client.py          # Async aiohttp elevation client
│   ├── fuse.py                  # Multi-DEM fusion (SRTM + GEBCO bathymetry)
│   ├── geotiff.py               # GeoTIFF/COG export
│   ├── viz.py                   # Hillshade, contours, 3D mesh helpers
│   ├── backends/ozt2.py         # OZT2 backends: OZT2HFBackend (HuggingFace), OZT2Backend (local
│   │                            #   files), OZT2R2Backend (S3-compatible)
│   └── tests/                   # pytest tests
│
├── mcp-server/                   # MCP server (stdio) over the REST API — elevation, weather,
│                                 #   tides, address, waterways
├── core/                        # Rust crate (WASM + CLI binary)
│   ├── src/
│   │   ├── d8.rs               # D8 flow direction (WASM + CLI)
│   │   ├── viewshed.rs         # Viewshed computation (WASM + CLI)
│   │   ├── ozt2.rs              # OZT2 decode (WASM)
│   │   └── wasm.rs              # WASM bindings
│   └── python/                  # Python bindings via maturin
│
├── docs/                         # Design docs, audit reports, roadmaps
├── scripts/                      # Utility scripts (benchmarks, data conversion, uploads)
└── .gitforge.yml                 # GitForge CI pipeline (primary CI/CD; GitHub is a mirror)
```

### Frontend Architecture (Next.js)

- **App Router**: `api/src/app/` uses Next.js 15 App Router with React 19
- **Map client**: MapLibre GL JS — `src/lib/tile.ts`, `src/lib/point-elevation.ts`
- **Basemaps**: 10 basemaps in the shared registry `api/src/lib/basemaps.ts` (5 of them on the globe), with attribution and maxzoom per entry
- **Globe client**: CesiumJS 1.119 — loaded via CDN in the globe page
- **Data layers**: External real-time sources (USGS, OpenSky Network, NOAA, etc.)
- **Edge runtime**: API routes run as Cloudflare Edge Workers — `api/src/middleware.ts` handles routing
- **Storage**: HuggingFace datasets for terrain tiles (z7–z11 OZT2 + `.merged` sources); Cloudflare edge Cache API for hot tiles — no R2 (bucket decommissioned 2026-09-27)

### Python SDK Architecture

- **elevation.py**: Single-point and batch elevation queries via REST API
- **terrain/**: NumPy-based raster analysis package (raster, shading, viewshed, profiles, gradients, indices, flow_metrics, filters) — slope, aspect, hillshade, viewshed, profile, TPI, roughness, curvature
- **hydrology/**: D8 flow direction, flow accumulation, stream extraction, downstream tracing (flow, streams, watersheds, depressions, channels, flowpaths, inundation, indices)
- **tile_format.py**: OZT1 — custom binary with zstd compression (67% smaller than Terrarium PNG)
- **tile_format_v2.py**: OZT2 — gradient prediction + adaptive quantization; compressor is recorded per tile in the flags byte (0=Brotli, 1=Zstd, 2=zlib; Python encoder default is Brotli q11, `openzenith/tile_format_v2.py`) — 93% smaller than Terrarium PNG.
- **merged.py**: Reader for `.merged` OZCHNK01 chunk files from HuggingFace (aliasfox/srtm30m-merged)
- **async_client.py**: Async `aiohttp`-based batch elevation client (`ElevationClient`, `ElevationBatchProcessor`)
- **fuse.py**: Multi-DEM fusion — blends SRTM land elevation with GEBCO bathymetry
- **geotiff.py**: GeoTIFF/COG export of elevation grids
- **viz.py**: Hillshade, contour lines, 3D mesh generation
- **backends/ozt2.py**: `OZT2HFBackend` — direct access to HuggingFace OZT2 tile dataset
- **cli.py**: `argparse`-based CLI with 36 subcommands (terrain: slope, aspect, hillshade, multi-hillshade, viewshed, profile, contour, tri, tpi, roughness, curvature, profile-curvature, planform-curvature, color-relief, viz; hydrology: watershed, trace, fill-depressions, flow-accum, streams, drainage-density, twi, inundation, zonal-stats; data: download, tiles, query, batch, info, validate, encode, ingest, geojson, export-geotiff, export-cog, kml)

### Rust Core (core)

Rust crate for CPU-intensive terrain analysis primitives:

- **WASM** (`--target web`): Runs in browser — D8 flow direction, flow accumulation, viewshed, OZT2 decode, gradient reconstruct. Used by `api/src/app/wasm-demo/`.
- **CLI binary** (`cargo build --release`): Python subprocess via `openzenith_core` package. Exposes `d8`, `accum`, `reconstruct`, `viewshed`, `stream-order`, `gradient-predict` commands (`core/src/main.rs`).

```python
# Python: call Rust CLI binary
from openzenith_core import d8_flow_direction, flow_accumulation, viewshed

flow_dir = d8_flow_direction(dem, nodata=-32768.0)
accum = flow_accumulation(flow_dir, nodata_dir=-1)
visible = viewshed(dem, observer_row=100, observer_col=100)
```

### Key Data Sources

| Data | Source | Storage |
|------|--------|---------|
| SRTM 30m Elevation | HuggingFace (aliasfox/srtm30m-merged, 14,296 .merged files) | HuggingFace + local NAS mirror |
| OZT2 Tiles (z7-z10) | HuggingFace (aliasfox/srtm30m-ozt2-v2; z7–z9 = 53,565 tiles, z10 = 151,988 tiles, sync complete) | HuggingFace |
| OZT2 Tiles (z11) | `scripts/upload_ozt2_to_hf.py --zoom 11` (595,149 tiles from the local NAS copy; 2026-09-27 backfill) | HuggingFace |
| GEBCO 2025 Bathymetry | Copernicus/GEBCO | External live upstream (CEDA `dap.ceda.ac.uk`, overridable via `GEBCO_TILE_URL`; the old R2 copy was disposable cache, not origin) |
| Real-time layers | USGS, NOAA, OpenSky, AISstream | External APIs |

R2 is fully decommissioned (bucket emptied + deleted 2026-09-27); tile reads go to HuggingFace with the Workers Cache API in front (`api/src/lib/storage/edge-cache.ts`), and the DEM_TILES binding is gone from `wrangler.toml`.

### Local Data Setup

DEM data is downloaded to `data/srtm30m-merged/` (~65GB, 14,296 `.merged` files). The `.merged` format is the OZCHNK01 binary format with 15×15 chunks per 1°×1° tile, zlib-compressed with horizontal differencing prediction. Use `openzenith/merged.py` to read local `.merged` files directly without HTTP:

```python
from openzenith.merged import read_elevation_from_merged
elev = read_elevation_from_merged(28.0, 86.9, "/path/to/data/srtm30m-merged")
```

---

## Key Patterns

### API Routes
API routes are in `api/src/app/api/` — each directory is a route segment. Route handlers export `GET`, `POST`, etc. functions. Cloudflare Edge runtime is used.

### Tile Caching
Terrain tiles are cached at the edge with the Workers Cache API (`api/src/lib/storage/edge-cache.ts`) fronting HuggingFace origin reads, with explicit freshness headers. See `api/src/lib/cache.ts` for caching utilities and `api/src/lib/tile.ts` for tile generation.

### OGC WMTS Tile Service
`/api/tiles/WMTSCapabilities.xml` serves a WMTS 1.0.0 capabilities document advertising the Terrarium PNG elevation layer over two tile matrix sets, one `<Layer>` per set:
- **WebMercatorQuad** (EPSG:3857) — layer id `elevation-terrarium`, tiles at `/api/dem-tile/{z}/{x}/{y}`
- **WorldCRS84Quad** (OGC 17-083r2, true EPSG:4326) — layer id `elevation-terrarium-WorldCRS84Quad`, tiles at `/api/tiles/WorldCRS84Quad/{z}/{row}/{col}`, assembled by `api/src/lib/tile-crs84.ts` (z≤10: AWS Terrain resampled per pixel center; z>10: HuggingFace SRTM chunk assembly — so ocean is 0m at z>10, GEBCO bathymetry only via the z≤10 AWS source)

One layer per set is structural, not cosmetic: a WMTS `ResourceURL` carries no tileMatrixSet attribute, so a single layer offering both sets leaves clients to guess which template pairs with which set — GDAL guesses wrong. Also note the scale denominators: WorldCRS84Quad's level-0 denominator (279541132.0143589) is **half** the GoogleMapsCompatible one (559082264.0287178) because its 2×1 root matrix gives each pixel half the degrees; using the Mercator value makes clients derive a doubled extent. The surface is verified end-to-end with GDAL/rasterio as an independent client (`WMTS:<capabilities-url>,layer=...,tilematrixset=...`).

### Python SDK Elevation Queries
The SDK calls the REST API (`/api/elevation`) for point queries. For batch operations, it uses `/api/elevation/batch`. Tile data can be requested as OZT1/OZT2 (custom binary) or Terrarium PNG.

### OZT Tile Formats
- **OZT1**: Lossless zstd compression of raw 16-bit elevation values
- **OZT2**: Gradient prediction + adaptive quantization + Zstd/Brotli (compressor recorded per tile in the flags byte; 93% smaller than Terrarium PNG). Resolution: z7–z11 available (z11 ≈ 19m/pixel from SRTM 30m source — Nyquist-optimal; z13+ would be pure interpolation).

### OZT2 Tile Backend (HuggingFace)
OZT2 tiles (z7–z11) can be fetched directly from HuggingFace datasets via `OZT2HFBackend`:

```python
from openzenith.backends.ozt2 import OZT2HFBackend
from openzenith.tile_format_v2 import decode

# Direct HF access — fetch and decode a single tile
backend = OZT2HFBackend("aliasfox/srtm30m-ozt2-v2")
grid = backend.fetch_tile(z=10, x=163, y=395)
print(grid.shape)  # (256, 256), dtype=int16, NoData=-32768

# Get elevation at a specific lat/lon within a tile
elev = backend.get_elevation_at(z=10, x=163, y=395, lat=40.7128, lon=-74.006)
print(elev)  # ~10.5 (meters)

# Async batch prefetch
import asyncio
tiles = [(10, 163, 395), (10, 164, 395)]
count = await backend.prefetch_tiles_async(tiles)
print(f"Cached {count} tiles")

# High-level API (requires local tiles or configured DEFAULT_OZT2_DIR)
from openzenith import load_ozt2_tiles_from_hf, get_elevation_from_ozt2
tile_dir = load_ozt2_tiles_from_hf(repo_id="aliasfox/srtm30m-ozt2-v2", zoom_levels=[10])
elev = get_elevation_from_ozt2(40.7128, -74.0060)  # Uses DEFAULT_OZT2_DIR
```

**API classes:**
- `OZT2HFBackend` (`openzenith.backends.ozt2`) — HuggingFace dataset access with local cache
- `OZT2Backend` — Local file system access (`fetch_tile(z, x, y)` → `Int16Array`)
- `OZT2R2Backend` — any S3-compatible object store (kept for third-party buckets; the platform's own Cloudflare R2 bucket was decommissioned 2026-09-27)

**HuggingFace dataset**: https://huggingface.co/datasets/aliasfox/srtm30m-ozt2-v2 — z10 sync COMPLETE and byte-validated (2026-09-24): all 151,988 local tiles present and byte-identical on HF (validator: `scripts/validate_hf_ozt2.py`; 0 missing, 0 stale, 48/48 sample hash-matched). z7–z9 refreshed to the current encoder generation the same day (53,565 tiles: 0 missing; byte-diff clean, residual "stale" tree-index oids proven content-identical via resolve probes). Early test stubs (`tiles/z10/0/test338{,c}.ozt2`) deleted; 8 phantom "extra" z7 paths in the tree index 404 on resolve — index ghosts, not content. z11: **COMPLETE and byte-validated (2026-09-28)** — the historical HF copy was a partial legacy generation (403,483 tiles); the full 595,149-tile backfill from the local NAS copy (begun 2026-09-27, after R2 — the previous z11 origin — was decommissioned) finished across several resumed runs, and an exact git-blob-sha comparison of every `tiles/z11` path shows **0 missing, 0 stale, 0 extra**; prod `/api/dem-tile/11/...` spot-checks (incl. previously-missing tiles) return bytes sha-identical to local. Upload lesson: when calling `upload_batches` outside `main()`, `rel_of` must carry the `tiles/` prefix — a bare `z11/...` lands files at a stray root path, and a successful `create_commit` response alone does not prove landing (verify sampled files via `paths-info` with `expand: true`).

### WASM Demo
Browser-based terrain analysis at `/wasm-demo` — D8 flow direction, flow accumulation, viewshed, and OZT2 decode running entirely in the browser via WASM.

### Scripts
- `scripts/convert_to_ozt2.py` — Convert SRTM .merged files to OZT2 tiles
- `scripts/upload_ozt2_to_hf.py` — Upload local OZT2 tiles to HuggingFace dataset
- `scripts/validate_hf_ozt2.py` — Byte-validate the HuggingFace OZT2 copy against local tiles
- `scripts/core_coverage_gate.sh` — Rust line-coverage gate (`cargo llvm-cov`; two-pass: 99% default features, 95% with the wasm feature)
- `scripts/ship.sh` — Local ship gate: `pages:build` → bundle-marker check → `pages:deploy` → prod E2E verification
