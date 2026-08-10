# OpenZenith

**OpenZenith** is a global geospatial intelligence platform providing interactive 3D globe and 2D map visualization with real-time data layers, a Python SDK for elevation and terrain analysis, and a REST API deployed on Cloudflare Pages Edge Workers.

## Live Platforms

| Platform | URL |
|----------|-----|
| Landing Page | https://openzenith.cyopsys.com |
| 2D Map | https://openzenith.cyopsys.com/map |
| 3D Globe | https://openzenith.cyopsys.com/globe |
| WASM Demo | https://openzenith.cyopsys.com/wasm-demo |

## Key Features

### Interactive Maps
- **3D Globe** — CesiumJS-powered globe with terrain shading, terrain-exaggerated elevation, and 59 data layers
- **2D Map** — MapLibre GL JS with 37+ real-time data layers including earthquakes, flights, vessels, weather, environmental data, and more

### Python SDK
Full-featured Python SDK for elevation queries, terrain analysis, and hydrology:

```python
import openzenith as oz

# Query elevation at a point
elevation = oz.get_elevation(40.7128, -74.0060)

# Compute slope and aspect
slope_grid = oz.slope(dem)
aspect_grid = oz.aspect(dem)

# Delineate a watershed
watershed = oz.delineate_watershed(40.7, -74.0)
```

See [Python-SDK](Python-SDK.md) and [CLI-Reference](CLI-Reference.md) for full documentation.

### Custom Tile Formats

OpenZenith uses highly optimized custom tile formats for efficient terrain data storage and delivery:

- **OZT1** — Lossless zstd compression of raw 16-bit elevation (67% smaller than Terrarium PNG)
- **OZT2** — Gradient prediction + adaptive quantization + Zstd (93% smaller than Terrarium PNG, 30x faster encode than Brotli)

See [OZT-Tile-Formats](OZT-Tile-Formats.md) for details.

### REST API

82 API routes for terrain analysis, real-time data, and tile delivery. See [REST-API](REST-API.md) for the full reference.

### WASM Browser Demos

Run terrain analysis directly in the browser with WebAssembly bindings from `openzenith-core`:

- D8 flow direction
- Flow accumulation
- Viewshed computation
- OZT2 tile decoding

## Project Links

| Resource | Link |
|----------|------|
| GitHub | https://github.com/aliasfoxkde/OpenZenith |
| Python Package | https://pypi.org/project/openzenith |
| OZT2 Tiles Dataset | https://huggingface.co/datasets/aliasfox/srtm30m-ozt2-v2 |
| SRTM 30m Merged | https://huggingface.co/datasets/aliasfox/srtm30m-merged |
| Rust Core (openzenith-core) | https://github.com/aliasfoxkde/OpenZenith (see `openzenith-core/` directory) |

## Quick Start

```bash
# Install Python SDK
pip install openzenith

# Query elevation
openzenith query --lat 40.7 --lon -74.0

# Compute slope
openzenith slope --lat 40.7 --lon -74.0

# Trace downstream
openzenith trace --lat 36.0 --lon -118.0
```

See [Installation](Installation.md) and [Quick-Start](Quick-Start.md) for detailed setup instructions.

## Architecture Overview

```
openzenith/
├── api/                    # Next.js 15 App Router (Cloudflare Pages)
│   ├── src/app/           # Pages and API routes
│   ├── src/components/    # React components
│   └── src/lib/           # Shared libraries
├── openzenith/            # Python SDK
│   ├── elevation.py       # Elevation queries
│   ├── terrain.py         # Terrain analysis (slope, aspect, hillshade, viewshed)
│   ├── hydrology.py       # Hydrology (D8, watersheds, streams)
│   ├── tile_format_v2.py  # OZT2 compression
│   ├── fuse.py            # Multi-DEM fusion
│   └── cli.py             # CLI commands
├── openzenith-core/       # Rust crate (WASM + CLI)
└── wiki/                  # This documentation
```

## Version

Current version: **0.7.0**

## Contributing

See [Contributing](Contributing.md) for development setup, testing, and coding standards.
