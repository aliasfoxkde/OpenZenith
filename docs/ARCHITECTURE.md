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
                           │ REST API (37 data layers)
┌──────────────────────────▼──────────────────────────────────┐
│  Backend (Cloudflare Edge Workers, Python SDK)                │
│  ├── Elevation API  — Point/batch elevation queries           │
│  ├── Real-time     — Earthquakes, flights, weather, tides    │
│  └── WASM          — D8 flow, viewshed, OZT2 decode         │
└──────────────────────────┬──────────────────────────────────┘
                           │
        ┌──────────────────┼──────────────────┐
        │                  │                  │
   ┌────▼────┐       ┌─────▼─────┐      ┌─────▼─────┐
   │ Hugging  │       │ Cloudflare│      │  SRTM     │
   │ Face HF  │       │    R2    │      │  .merged  │
   │ OZT2     │       │  (tile   │      │  (local   │
   │ dataset  │       │  cache)  │      │   disk)   │
   └──────────┘       └───────────┘      └───────────┘
```

---

## Data Storage Hierarchy

| Source | Format | Location | Purpose |
|--------|--------|----------|---------|
| SRTM 30m | `.merged` (OZCHNK01) | Local disk (~65GB) | Primary DEM source |
| OZT2 tiles z7-z11 | `.ozt2` (custom) | HuggingFace dataset | High-compression tile delivery |
| OZT2 tiles z10-z11 | `.ozt2` | Cloudflare R2 | Edge tile serving |
| GEBCO bathymetry | COG | Cloudflare R2 | Ocean depth |
| Terrarium PNG | `.png` | Cloudflare R2 | Fallback/legacy |

---

## Elevation Query Path

```
Python SDK / API Request
  │
  ├─► HuggingFace HF Backend (OZT2HFBackend)
  │     └─► aliasfox/srtm30m-ozt2-v2 on HuggingFace
  │           (z7-z11 tiles, ~747K tiles)
  │
  ├─► R2 Backend (OZT2R2Backend)
  │     └─► Cloudflare R2 bucket
  │           (z10-z11 tiles, deployed from local)
  │
  └─► Local Merged Backend (MergedBackend)
        └─► Local .merged files on disk
              (full SRTM 30m, ~14,296 tiles)
```

**Priority chain**: HF OZT2 → R2 OZT2 → local merged → API fallback

---

## OZT2 Tile Format

**OZT2** is a custom high-performance elevation tile format:

- **Compression**: ~93% smaller than Terrarium PNG
- **Prediction**: Gradient-based (left neighbor + vertical gradient)
- **Quantization**: Adaptive bit-depth (8/10/12/16-bit per channel)
- **Codec**: Zstd q3 (30× faster encode than Brotli, same decode speed)
- **Resolution**: z7–z11 available (z11 ≈ 19m/pixel from SRTM 30m source)

Each tile is 256×256 pixels in Web Mercator projection (EPSG:3857).

---

## Python SDK Architecture

```
openzenith/
├── elevation.py      — Point/batch elevation queries
├── terrain.py        — Slope, aspect, hillshade, viewshed, profile
├── hydrology.py      — D8 flow, flow accumulation, streams, tracing
├── tile_format.py    — OZT1 (zstd compression, legacy)
├── tile_format_v2.py — OZT2 (gradient prediction + Zstd)
├── merged.py         — Reader for .merged OZCHNK01 chunk files
├── async_client.py   — Async aiohttp batch elevation client
├── fuse.py           — Multi-DEM fusion (SRTM + GEBCO)
├── geotiff.py        — GeoTIFF/COG export
├── backends/
│   └── ozt2.py       — OZT2HFBackend for HuggingFace access
└── cli.py            — Click CLI (download, query, trace, etc.)
```

---

## API Routes

Located in `api/src/app/api/`:

| Route | Purpose |
|-------|---------|
| `/api/elevation` | Point elevation query |
| `/api/elevation/batch` | Batch elevation |
| `/api/terrain` | Slope, aspect, hillshade, profile |
| `/api/waterways` | D8 flow accumulation |
| `/api/trace` | Downstream trace |
| `/api/watershed` | Watershed delineation |
| `/api/earthquakes` | USGS real-time earthquakes |
| `/api/flights` | OpenSky Network aircraft |
| `/api/weather` | Open-Meteo weather |
| `/api/tides` | NOAA tide predictions |
| `/api/wildfires` | MODIS active fires |
| `/api/openapi.json` | OpenAPI spec |

---

## CI/CD

- **CI**: `.github/workflows/ci.yml` — lint, typecheck, test, coverage
- **Deploy**: `.github/workflows/deploy.yml` — triggered via `workflow_run` from CI
- **Secrets**: `CLOUDFLARE_API_TOKEN`, `HF_TOKEN`, `R2_*`

---

## Key Trade-offs

| Decision | Rationale |
|----------|----------|
| Custom OZT2 vs Terrarium PNG | 93% smaller, 30× faster encode |
| HF for tile dataset | Free hosting, global CDN, no R2 egress |
| R2 for active tiles | Fast edge delivery, custom domain |
| .merged local files | No network needed for local processing |
| D8 flow in Rust WASM | CPU-intensive; WASM runs in browser and CLI |
