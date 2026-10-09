# OpenZenith Architecture

High-level system overview of the OpenZenith geospatial intelligence platform.

---

## Components

```
┌─────────────────────────────────────────────────────────────┐
│  Frontend (Next.js 15, Cloudflare Pages Edge)               │
│  ├── /map     — MapLibre 2D map                             │
│  ├── /globe   — CesiumJS 3D globe                           │
│  └── /wasm-demo — Browser-based terrain analysis (WASM)      │
└──────────────────────────┬──────────────────────────────────┘
                           │ REST API (62 mountable data layers)
┌──────────────────────────▼──────────────────────────────────┐
│  Backend (Cloudflare Edge Workers, Python SDK)                │
│  ├── Elevation API  — Point/batch elevation queries           │
│  ├── Real-time     — Earthquakes, flights, weather, tides    │
│  └── WASM          — D8 flow, viewshed, OZT2 decode         │
└──────────────────────────┬──────────────────────────────────┘
                           │
        ┌──────────────────┼──────────────────┐
        │                  │                  │
   ┌────▼─────┐       ┌──────▼──────┐      ┌──────────┐
   │ Hugging  │       │ Cloudflare  │      │  SRTM    │
   │ Face HF  │       │ Cache API   │      │  .merged │
   │ OZT2 +   │       │ (edge tile  │      │  (local  │
   │ .merged  │       │  cache, not │      │   disk)  │
   │ datasets │       │  a source)  │      │          │
   └──────────┘       └─────────────┘      └──────────┘
```

---

## Data Storage Hierarchy

| Source | Format | Location | Purpose |
|--------|--------|----------|---------|
| SRTM 30m | `.merged` (OZCHNK01) | HuggingFace dataset + local disk mirror (~65GB, 14,296 files) | Primary DEM source |
| OZT2 tiles z7-z11 | `.ozt2` (custom) | HuggingFace dataset (`aliasfox/srtm30m-ozt2-v2`, ~801K tiles) | High-compression tile delivery |
| GEBCO bathymetry | COG | Live upstream (CEDA `dap.ceda.ac.uk`; no cache tier) | Ocean depth |
| Terrarium PNG | `.png` | Rendered at the edge from HuggingFace SRTM chunks | Legacy/interoperable format |

---

## Elevation Query Path

```
Python SDK / API Request
  │
  ├─► HuggingFace HF Backend (OZT2HFBackend)
  │     └─► aliasfox/srtm30m-ozt2-v2 on HuggingFace
  │           (z7-z11 tiles, ~801K tiles: 53,565 at z7–z9,
  │            151,988 at z10, 595,149 at z11)
  │
  ├─► HuggingFace Chunk Backend (HuggingFaceChunkBackend)
  │     └─► aliasfox/srtm30m-merged on HuggingFace
  │           (full SRTM 30m, 14,296 `.merged` tiles)
  │
  └─► Local Merged Backend
        └─► Local .merged files on disk
              (same OZCHNK01 format, offline)
```

Every read is fronted by the Cloudflare Cache API (`api/src/lib/storage/edge-cache.ts`) — a per-colo latency cache, never a source of truth. Cloudflare R2 is gone: the bucket was emptied and deleted on 2026-09-27 and no `r2_buckets` binding exists in `api/wrangler.toml`. The SDK's `OZT2R2Backend` remains for third-party S3-compatible buckets but is not used by the deployed API.

**Priority chain (server, `/api/elevation`)**: HF OZT2 z10 → HF SRTM `.merged` chunks → GEBCO 2025 (live upstream — ocean and outside-SRTM coverage). Four known-corrupt SRTM tiles fall back to AWS Terrain Tiles (`api/src/lib/point-elevation.ts`).

**Priority chain (Python SDK, offline)**: local `.merged` files → HuggingFace `.merged` / OZT2 → REST API fallback.

---

## OZT2 Tile Format

**OZT2** is a custom high-performance elevation tile format:

- **Compression**: ~93% smaller than Terrarium PNG
- **Prediction**: Gradient-based (left neighbor + vertical gradient)
- **Quantization**: Adaptive bit-depth (8/10/12/16-bit per channel)
- **Codec**: Brotli, Zstd, or zlib — recorded per tile in the flags byte (`api/src/lib/ozt2_decode.ts` bits 2-3); decoders handle all three (native `DecompressionStream` for Brotli, fflate for zlib, WASM zstd)
- **Resolution**: z7–z11 available (z11 ≈ 19m/pixel from SRTM 30m source)

Each tile is 256×256 pixels in Web Mercator projection (EPSG:3857).

---

## Python SDK Architecture

```
openzenith/
├── elevation.py      — Point/batch elevation queries
├── terrain/          — Slope, aspect, hillshade, viewshed, profile
│                       (raster, shading, viewshed, profiles, gradients,
│                        indices, flow_metrics, filters)
├── hydrology/        — D8 flow, flow accumulation, streams, tracing
│                       (flow, streams, watersheds, depressions, channels,
│                        flowpaths, inundation, indices)
├── tile_format.py    — OZT1 (zstd compression, legacy)
├── tile_format_v2.py — OZT2 (gradient prediction + adaptive quantization;
│                       Brotli/Zstd/zlib per the flags byte)
├── merged.py         — Reader for .merged OZCHNK01 chunk files
├── async_client.py   — Async aiohttp batch elevation client
├── fuse.py           — Multi-DEM fusion (SRTM + GEBCO)
├── geotiff.py        — GeoTIFF/COG export
├── backends/
│   └── ozt2.py       — OZT2HFBackend (HuggingFace), OZT2Backend (local files),
│                       OZT2R2Backend (S3-compatible)
└── cli.py            — argparse CLI, 36 subcommands (download, query, batch, trace, etc.)
```

---

## API Routes

Located in `api/src/app/api/` (80 route handlers). Highlights:

| Route | Purpose |
|-------|---------|
| `/api/elevation` | Point elevation query (plus `/api/elevation/batch`, 1–2000 points) |
| `/api/tile/{z}/{x}/{y}` | Raw Int16 elevation tiles (Terrarium-compatible grid) |
| `/api/dem-tile/{z}/{x}/{y}` | OZT2 (default) / Terrarium PNG terrain tiles |
| `/api/bathymetry` | Point bathymetry (SRTM land → GEBCO seafloor) |
| `/api/slope`, `/api/aspect`, `/api/contours/{z}/{x}/{y}`, `/api/profile` | Terrain analysis |
| `/api/streams`, `/api/trace`, `/api/watershed`, `/api/twi` | Hydrology (D8-based) |
| `/api/earthquakes` | USGS real-time earthquakes |
| `/api/flights` | OpenSky Network aircraft |
| `/api/weather/warnings` | NWS active weather warnings |
| `/api/wildfires` | NASA FIRMS (VIIRS default, MODIS optional) |
| `/api/satellites` | Celestrak TLE/JSON elements |
| `/api/vessels`, `/api/hurricanes` | AIS ships, storm tracks |
| `/api/collections`, `/api/stac` | STAC/OGC metadata surface |
| `/api/tiles/WMTSCapabilities.xml` | OGC WMTS 1.0.0 capabilities (Terrarium layer, two matrix sets; served by the dynamic `tiles/[tileMatrixSetId]` route) |
| `/api/docs`, `/api/openapi.json` | Interactive docs + OpenAPI spec |

`/api/gebco-tile/{name}` exists but requires the Node runtime (GEBCO COGs are a
local-dev/NAS resource); the edge build answers it with a guidance payload
pointing at `/api/dem-tile/{z}/{x}/{y}` and `/api/elevation`.

The full listing is the directory itself (`api/src/app/api/*/route.ts`);
`/api/docs` renders it from `openapi.json`. NOAA tide logic lives in
`api/src/lib/tides/noaa.ts` (library only — no public route yet).

---

## CI/CD

- **Primary**: GitForge — `.gitforge.yml` (repo root) runs on every push:
  `npm ci` → `tsc --noEmit` → eslint (warning-baseline guard) → openapi
  spec-check → vitest (completeness + count guard) → mcp-server
  typecheck/lint/test → `pages:build` + perf-budget check. Deliberately NOT in
  the pipeline (documented in the file header): Playwright E2E, pages deploy,
  pytest, cargo, and the aegis scan — those run locally.
- **Local ship gate**: `scripts/ship.sh` — `pages:build` → bundle-marker check
  → `pages:deploy` → prod E2E verification.
- **Mirror**: `.github/workflows/ci.yml` — python ruff/pytest, rust
  clippy/test, api lint/typecheck/coverage. The F-15 auto-deploy job has
  been removed; no mirror workflow deploys or uploads anything (the PyPI
  tag workflow is validation-only — `docs/PUBLISHING.md`). GitHub Actions
  is a billing-blocked mirror — a red run there is not a code signal.
- **Deploy**: Cloudflare Pages via `npm run pages:deploy` from `api/`
  (wrangler; artifact verified with `scripts/verify_pages_deployment.mjs`)
- **Secrets**: `CLOUDFLARE_API_TOKEN`, `HF_TOKEN`, `FIRMS_MAP_KEY` (no R2
  credentials — the bucket is gone)

---

## Key Trade-offs

| Decision | Rationale |
|----------|----------|
| Custom OZT2 vs Terrarium PNG | ~93% smaller; Brotli/Zstd/zlib recorded per tile |
| HF for tile dataset | Free hosting, global CDN — the whole platform runs on free storage |
| Cache API in front of reads | Per-colo latency cache with explicit TTLs; no storage binding, no origin of its own |
| .merged local files | No network needed for local processing |
| D8 flow in Rust WASM | CPU-intensive; WASM runs in browser and CLI |
