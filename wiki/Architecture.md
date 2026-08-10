# Architecture

OpenZenith is a global geospatial intelligence platform built on a multi-tier architecture spanning browser, edge, and cloud infrastructure.

## System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Client Layer                                 │
├─────────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  │
│  │  CesiumJS   │  │  MapLibre   │  │  WASM Demo  │  │  Python SDK │  │
│  │  3D Globe   │  │  2D Map     │  │  Browser    │  │  Local/CI   │  │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘  │
│         │               │               │               │            │
└─────────┼───────────────┼───────────────┼───────────────┼────────────┘
          │               │               │               │
          ▼               ▼               ▼               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      Edge Layer (Cloudflare)                         │
├─────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────────────────┐ │
│  │              Next.js 15 App Router (Edge Workers)                │ │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐   │ │
│  │  │  /map   │ │ /globe  │ │/explore │ │/wasm-demo│ │ /studio │   │ │
│  │  └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘   │ │
│  │                                                                  │ │
│  │  ┌──────────────────────────────────────────────────────────┐   │ │
│  │  │                   82 API Routes                            │   │ │
│  │  │  /api/elevation  /api/slope  /api/watershed  /api/flights │   │ │
│  │  └──────────────────────────────────────────────────────────┘   │ │
│  └─────────────────────────────────────────────────────────────────┘ │
│                              │                                        │
│                              ▼                                        │
│  ┌─────────────────────────────────────────────────────────────────┐ │
│  │                    Cache Layer (CF Cache + R2)                  │ │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐           │ │
│  │  │  Tiered      │  │  R2 Object   │  │  In-Worker   │           │ │
│  │  │  CDN Cache   │  │  Storage     │  │  Memory      │           │ │
│  │  │  (tiles)     │  │  (terrain)   │  │  (JSON API)  │           │ │
│  │  └──────────────┘  └──────────────┘  └──────────────┘           │ │
│  └─────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                       External Services                              │
├─────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────┐   │
│  │  HuggingFace    │  │  Cloudflare R2  │  │  External APIs      │   │
│  │  Datasets       │  │  (terrain tiles)│  │  USGS/NOAA/OpenSky │   │
│  │  srtm30m-merged │  │                 │  │                     │   │
│  │  srtm30m-ozt2   │  │  ~65GB SRTM     │  │  37 real-time       │   │
│  │                 │  │  ~2GB OZT2      │  │  data layers        │   │
│  └─────────────────┘  └─────────────────┘  └─────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

## Frontend

### Next.js 15 App Router

| Property | Value |
|----------|-------|
| **Framework** | Next.js 15 with React 19 |
| **Runtime** | Cloudflare Pages Edge Workers |
| **Routing** | App Router with route groups |

**Page Structure**:
```
api/src/app/
├── page.tsx              # Landing page
├── map/                  # 2D MapLibre map
├── globe/                # 3D CesiumJS globe
├── explore/              # Combined explore view
├── wasm-demo/            # Browser WASM demos
└── api/                  # 82 API routes
```

### CesiumJS Globe

- **Version**: CesiumJS 1.119
- **Terrain**: Custom TerrainProvider using SRTM 30m tiles
- **Data Layers**: 59 total layers (33 vector, 26 raster)
- **Rendering**: WebGL with terrain exaggeration

### MapLibre 2D Map

- **Version**: MapLibre GL JS
- **Basemaps**: Dark, light, satellite, nautical
- **Layers**: 37+ data layers with real-time updates
- **Interaction**: Hover tooltips, click details, time scrubber

## API Layer

### Edge Runtime

All API routes run as Cloudflare Edge Workers for:
- Low latency globally (requests route to nearest edge)
- No cold starts (Workers are instant)
- Automatic scaling

### Caching Strategy

| Data Type | Cache | TTL |
|-----------|-------|-----|
| Terrain tiles (static) | CF CDN + R2 | 1 hour |
| GeoJSON APIs | CF Cache | 5-60 min |
| Real-time APIs | In-worker | 1-2 min |
| User requests | None | — |

### R2 Storage

Cloudflare R2 provides object storage for:
- SRTM 30m terrain tiles (~65GB)
- GEBCO bathymetry tiles
- Generated OZT1/OZT2 tiles
- Cached API responses

## Python SDK

### Architecture

```
openzenith/
├── elevation.py           # Point/batch queries
├── terrain.py            # NumPy terrain analysis
├── hydrology.py          # D8 flow, watershed
├── tile_format.py        # OZT1 codec
├── tile_format_v2.py     # OZT2 codec
├── fuse.py              # Multi-DEM fusion
├── geotiff.py           # GeoTIFF export
├── viz.py               # Visualization
└── backends/            # Tile access abstraction
    ├── ozt2.py          # OZT2Backend, OZT2R2Backend, OZT2HFBackend
    └── merged.py        # .merged file reader
```

### Performance Features

- **Numba JIT**: Optional acceleration for viewshed computation
- **Async I/O**: aiohttp for concurrent batch queries
- **Vectorized NumPy**: All terrain functions operate on full grids
- **Lazy Imports**: Heavy modules loaded on-demand

## Rust Core (openzenith-core)

### WASM Bindings

```
openzenith-core/
├── src/
│   ├── wasm.rs           # WASM exports
│   ├── d8.rs             # D8 flow direction
│   ├── viewshed.rs       # Viewshed computation
│   └── ozt2.rs           # OZT2 decode
├── python/                # maturin Python bindings
└── Cargo.toml
```

Rust core provides:
- Browser-based terrain analysis (no server needed)
- OZT2 decode for tile viewing
- D8 flow direction
- Viewshed computation

## Data Flow

### Elevation Query

```
1. Client → GET /api/elevation?lat=40.7&lon=-74.0
2. Edge Worker checks CF Cache
3. Cache miss → check R2 for tile
4. R2 miss → fetch from HuggingFace
5. Decode tile, extract point
6. Cache result in R2 + CF Cache
7. Return {"elevation": 10.0}
```

### Tile Serving

```
1. Client → GET /api/tile/10/163/395
2. Edge Worker checks R2
3. R2 hit → return cached OZT2 bytes
4. R2 miss → generate/fetch, store in R2, return
```

## Key Design Decisions

### Custom Tile Formats (OZT1/OZT2)

Terrarium PNG is inefficient for terrain data. Custom formats provide:
- 67-93% size reduction
- 30x faster encoding (OZT2)
- Adaptive precision for terrain complexity

### Edge-First Architecture

Running on Cloudflare Edge provides:
- Global low latency
- Zero cold starts
- Automatic DDoS protection
- Built-in CDN caching

### Multi-Source Fusion

SRTM for land, GEBCO for ocean provides seamless global coverage. The `FusedDEM` class handles blending at coastlines.

### Lazy Loading Layers

Off-by-default map layers use dynamic imports to reduce initial bundle size. Cloudflare Pages bundles all dynamic imports into the worker, so the benefit is memory/CPU rather than initial load time.
