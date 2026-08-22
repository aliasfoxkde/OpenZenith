# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

OpenZenith is a global geospatial intelligence platform — an interactive 3D globe (CesiumJS) and 2D map (MapLibre) with 37 real-time data layers, a Python SDK for elevation/terrain analysis, and a REST API deployed on Cloudflare Pages (Edge Workers).

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
npx playwright test # E2E tests
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
│   ├── src/app/                  # Pages and API routes (47 routes)
│   │   ├── api/                 # REST API endpoints (earthquakes, flights, elevation, etc.)
│   │   ├── map/                 # 2D MapLibre map page
│   │   ├── globe/               # 3D CesiumJS globe page
│   │   ├── explore/             # Combined explore page
│   │   └── wasm-demo/            # Browser WASM demo (D8, viewshed, OZT2 decode)
│   ├── src/components/          # Shared React components
│   ├── src/lib/                 # Shared libraries (tile, elevation, cache, etc.)
│   ├── public/pkg/              # WASM package (core, web target)
│   └── vitest.config.ts         # Vitest configuration
│
├── openzenith/                   # Python SDK (pip install openzenith)
│   ├── cli.py                   # CLI entry point
│   ├── elevation.py             # Elevation query functions
│   ├── terrain.py               # Slope, aspect, hillshade, viewshed, profile
│   ├── hydrology.py             # D8 flow direction, flow accumulation, stream extraction, tracing
│   ├── tile_format.py           # OZT1 custom binary format (zstd)
│   ├── tile_format_v2.py        # OZT2 compression (gradient prediction + Zstd)
│   ├── merged.py                # Reader for .merged OZCHNK01 chunk files
│   ├── async_client.py          # Async aiohttp elevation client
│   ├── fuse.py                  # Multi-DEM fusion (SRTM + GEBCO bathymetry)
│   ├── geotiff.py               # GeoTIFF/COG export
│   ├── viz.py                   # Hillshade, contours, 3D mesh helpers
│   ├── backends/ozt2.py         # OZT2HFBackend for HuggingFace access
│   └── tests/                   # pytest tests
│
├── core/                        # Rust crate (WASM + CLI binary)
│   ├── src/
│   │   ├── d8.rs               # D8 flow direction (WASM + CLI)
│   │   ├── viewshed.rs         # Viewshed computation (WASM + CLI)
│   │   ├── ozt2.rs              # OZT2 decode (WASM)
│   │   └── wasm.rs              # WASM bindings
│   └── python/                  # Python bindings via maturin
│
├── docs/                         # Design docs, audit reports, roadmaps
└── scripts/                      # Utility scripts (benchmarks, data conversion, uploads)
```

### Frontend Architecture (Next.js)

- **App Router**: `api/src/app/` uses Next.js 15 App Router with React 19
- **Map client**: MapLibre GL JS — `src/lib/tile.ts`, `src/lib/point-elevation.ts`
- **Globe client**: CesiumJS 1.119 — loaded via CDN in the globe page
- **Data layers**: External real-time sources (USGS, OpenSky Network, NOAA, etc.)
- **Edge runtime**: API routes run as Cloudflare Edge Workers — `api/src/middleware.ts` handles routing
- **Storage**: Cloudflare R2 for terrain tiles (~1.7GB SRTM 30m data)

### Python SDK Architecture

- **elevation.py**: Single-point and batch elevation queries via REST API
- **terrain.py**: NumPy-based raster analysis (slope, aspect, hillshade, viewshed, profile)
- **hydrology.py**: D8 flow direction, flow accumulation, stream extraction, downstream tracing
- **tile_format.py**: OZT1 — custom binary with zstd compression (67% smaller than Terrarium PNG)
- **tile_format_v2.py**: OZT2 — gradient prediction + adaptive quantization + Zstd (93% compression). Zstd q3 is 30× faster encode than Brotli with same decode speed.
- **merged.py**: Reader for `.merged` OZCHNK01 chunk files from HuggingFace (aliasfox/srtm30m-merged)
- **async_client.py**: Async `aiohttp`-based batch elevation client (`ElevationClient`, `ElevationBatchProcessor`)
- **fuse.py**: Multi-DEM fusion — blends SRTM land elevation with GEBCO bathymetry
- **geotiff.py**: GeoTIFF/COG export of elevation grids
- **viz.py**: Hillshade, contour lines, 3D mesh generation
- **backends/ozt2.py**: `OZT2HFBackend` — direct access to HuggingFace OZT2 tile dataset
- **cli.py**: Click-based CLI with subcommands (download, query, trace, watershed, slope, hillshade, viewshed, profile)

### Rust Core (core)

Rust crate for CPU-intensive terrain analysis primitives:

- **WASM** (`--target web`): Runs in browser — D8 flow direction, flow accumulation, viewshed, OZT2 decode, gradient reconstruct. Used by `api/src/app/wasm-demo/`.
- **CLI binary** (`cargo build --release`): Python subprocess via `openzenith_core` package. Exposes `d8`, `accum`, `reconstruct`, `viewshed` commands.

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
| SRTM 30m Elevation | HuggingFace (aliasfox/srtm30m-merged, 14,296 .merged files) | Cloudflare R2 |
| OZT2 Tiles (z7-z11) | HuggingFace (aliasfox/srtm30m-ozt2-v2, ~747K tiles) | HuggingFace |
| GEBCO 2025 Bathymetry | Copernicus/GEBCO | Cloudflare R2 |
| Real-time layers | USGS, NOAA, OpenSky, AISstream | External APIs |

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
Terrain tiles are cached in R2 with a `Cache-Control` strategy. See `api/src/lib/cache.ts` for caching utilities and `api/src/lib/tile.ts` for tile generation.

### Python SDK Elevation Queries
The SDK calls the REST API (`/api/elevation`) for point queries. For batch operations, it uses `/api/elevation/batch`. Tile data can be requested as OZT1/OZT2 (custom binary) or Terrarium PNG.

### OZT Tile Formats
- **OZT1**: Lossless zstd compression of raw 16-bit elevation values
- **OZT2**: Gradient prediction + adaptive quantization + Zstd (93% smaller than Terrarium PNG, 30× faster encode than Brotli). Resolution: z7–z11 available (z11 ≈ 19m/pixel from SRTM 30m source — Nyquist-optimal; z13+ would be pure interpolation).

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
- `OZT2R2Backend` — Cloudflare R2 / S3-compatible storage

**HuggingFace dataset**: https://huggingface.co/datasets/aliasfox/srtm30m-ozt2-v2 — contains ~747K tiles across z7–z11.

### WASM Demo
Browser-based terrain analysis at `/wasm-demo` — D8 flow direction, flow accumulation, viewshed, and OZT2 decode running entirely in the browser via WASM.

### Scripts
- `scripts/convert_to_ozt2.py` — Convert SRTM .merged files to OZT2 tiles
- `scripts/upload_ozt2_to_hf.py` — Upload local OZT2 tiles to HuggingFace dataset
