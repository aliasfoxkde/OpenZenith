# OpenZenith

Global elevation data platform — query, analyze, and visualize terrain anywhere on Earth.

**Live:** [openzenith.cyopsys.com](https://openzenith.cyopsys.com) · [Map](https://openzenith.cyopsys.com/map) · [Globe](https://openzenith.cyopsys.com/globe) · [Explore](https://openzenith.cyopsys.com/explore) · [WASM Demo](https://openzenith.cyopsys.com/wasm-demo)

---

## What is OpenZenith?

OpenZenith is a geospatial SDK + REST API for working with global elevation data. It provides a unified Python interface for querying point elevations, loading terrain grids, and running terrain analysis (slope, aspect, hillshade, viewshed, hydrology) — with full offline support once local data is cached.

The key differentiator is **low-latency local processing**: no API calls needed for elevation queries when using local .merged tiles, and no complex DEM data setup required. Scientists, GIS engineers, and app developers get elevation data without managing SRTM/GEBCO tile downloads, coordinate conversions, or hydrology preprocessing.

Works entirely offline after installing the Python SDK and optional local data. Rust/WASM compute kernels handle CPU-intensive terrain analysis (D8 flow, viewshed, OZT2 decode) — running in-browser via WASM or as a local subprocess.

---

## Key Benefits

- **Zero-config**: pip install and query elevation in 2 lines of Python
- **Offline-first**: Local SRTM .merged tiles — no network required for elevation queries
- **Low-latency**: Rust/WASM compute kernels for D8 flow, viewshed, OZT2 decode — runs in-browser or subprocess
- **Complete terrain analysis**: slope, aspect, hillshade, viewshed, TPI, roughness, curvature, watersheds, stream extraction, downstream tracing
- **Production-ready**: Type hints, 255 unit tests, clippy-clean Rust, typed TypeScript API

---

## Quick Start

### 1. Install (30 seconds)

```bash
pip install openzenith              # Core SDK
pip install openzenith[all]         # All extras: async, rasterio, numba
```

### 2. Query Elevation (works offline if tiles cached)

```python
import openzenith as oz

# Single point — uses HuggingFace tiles if no local cache
elev = oz.get_elevation(40.7128, -74.0060)  # NYC → 10m
print(f"Elevation: {elev}m")

# Batch — parallel fetch with ThreadPoolExecutor
results = oz.get_elevation_batch([(40.7, -74.0), (48.8, 2.3), (35.7, 139.7)])
```

### 3. Terrain Analysis

```python
from openzenith import load_elevation_grid, slope, aspect, hillshade
from openzenith.terrain import viewshed

# Load a 10km × 10km region around a point
grid = load_elevation_grid(lat=36.0, lon=-118.0, zoom=12, radius=200)
dem = grid['grid']

slope_map = slope(dem)            # Degrees slope (Horn's method)
aspect_map = aspect(dem)          # Compass degrees (0-360)
hillshade_map = hillshade(dem)     # 0-255 analytical hillshade

# Viewshed from an observer point
visible = viewshed(dem, observer_row=100, observer_col=100, radius=50)
```

### 4. Hydrology (D8 flow, watersheds, streams)

```python
from openzenith.hydrology import (
    d8_flow_direction, flow_accumulation, extract_streams,
    delineate_watershed, trace_downstream
)

flow_dir = d8_flow_direction(dem)
accum = flow_accumulation(flow_dir)
streams = extract_streams(accum, threshold=100)

# Trace downstream from a point
trace = trace_downstream(36.0, -118.0)
print(f"Distance to ocean: {trace['total_distance']:.1f} km")

# Delineate entire watershed
ws = delineate_watershed(36.0, -118.0)
print(f"Watershed area: {ws['area_km2']:.1f} km²")
```

### 5. Local Data (optional — for offline use)

```bash
# Download SRTM tiles to ~/.cache/openzenith-dem/
openzenith download --region north-america --zoom-levels 0-10

# Or use HuggingFace directly (no local storage)
export HF_TOKEN=your_token_here
```

---

## Python SDK Reference

| Module | Functions | Notes |
|--------|-----------|-------|
| elevation | get_elevation, get_elevation_batch, load_elevation_grid | Parallel tile fetching |
| terrain | slope, aspect, hillshade, viewshed, tpi, roughness, curvature, tri | Vectorized NumPy |
| hydrology | d8_flow_direction, flow_accumulation, extract_streams, delineate_watershed, trace_downstream, twi, fill_depressions | D8 algorithm |
| tracing | trace_downstream | Adaptive tile loading |
| fuse | FusedDEM | SRTM + GEBCO seamless |
| viz | plot_*, terrain_to_3d_mesh, terrain_to_glb, terrain_to_png | Matplotlib + 3D export |
| geotiff | export_geotiff, export_cog | GeoTIFF/COG export |
| backends | OZT2Backend, OZT2R2Backend, OZT2HFBackend | Chunk-based tile access |

---

## CLI Commands

```
openzenith query --lat 40.7 --lon -74.0
openzenith trace --lat 36.0 --lon -118.0
openzenith watershed --lat 36.0 --lon -118.0
openzenith slope --lat 36.0 --lon -118.0 --radius 5km
openzenith hillshade --lat 36.0 --lon -118.0 --radius 5km
openzenith viewshed --lat 36.0 --lon -118.0 --height 10
openzenith fill-depressions --lat 36.0 --lon -118.0 --radius 10km
openzenith flow-accum --lat 36.0 --lon -118.0 --radius 10km
openzenith streams --lat 36.0 --lon -118.0 --threshold 100
openzenith info
openzenith validate
```

---

## REST API

Base URL: https://openzenith.cyopsys.com/api/

```
GET /elevation?lat=40.7&lon=-74.0
POST /elevation/batch  (up to 2000 points)
GET /slope?lat=40.7&lon=-74.0&radius=50
POST /watershed  {"lat": 36.0, "lon": -118.0}
POST /trace  {"lat": 36.0, "lon": -118.0}
GET /tile/{z}/{x}/{y}  (terrain tiles)
```

Full API docs: https://openzenith.cyopsys.com/api/openapi.json

---

## Architecture

```
Python SDK (local compute) ←→ REST API (cloud, 80+ edge routes)
                                     ↓
                              Cloudflare Pages
                                     ↓
                              R2 / HuggingFace
```

---

## Tech Stack

| | |
|-|-|
| SDK | Python 3.10+, NumPy, Rust (WASM + CLI) |
| API | Next.js 15, TypeScript, Cloudflare Edge |
| Data | SRTM 30m (HuggingFace), GEBCO 2025 |
| Tests | 255 pytest (Python), 17 cargo test (Rust), vitest (TypeScript) |

---

## Data Layers (37 total, 33 on 2D map)

### Weather & Climate
| Layer | Source | Details |
|-------|--------|---------|
| Earthquakes | USGS | Global seismic, magnitude + depth, timeline playback |
| Weather Radar | RainViewer | NEXRAD mosaic, animated precipitation |
| Weather Warnings | NOAA NWS | Watches, warnings, advisories (US) |
| Hurricane Tracks | NOAA NHC | Active cyclones with track animation |
| Wildfires | NASA FIRMS VIIRS | 3,000+ fire detections/day |
| Air Quality | Open-Meteo | AQI, PM2.5, PM10, NO₂, O₃ |
| Lightning | Blitzortung | Real-time global strikes (WebSocket) |
| SIGMETs/AIRMETs | NOAA AWC | Aviation weather hazards |
| Volcano Alerts | USGS | Real-time alert status |
| Disaster Alerts | GDACS | Global disaster aggregation |
| Flood Extent | Copernicus EMS | Flood monitoring |
| Sea Ice | NSIDC/OSI SAF | Polar ice coverage |
| Burn Scars | NASA FIRMS | Active fire perimeters |
| Space Weather | NOAA SWPC | Aurora forecast, Kp index |

### Aviation & Maritime
| Layer | Source | Details |
|-------|--------|---------|
| Flights (ADS-B) | OpenSky Network | 10,800+ live aircraft positions |
| Military ADS-B | ADSB Exchange | Military transponder data (requires key) |
| Vessels (AIS) | AISstream | Ship tracking (WebSocket) |

### Infrastructure & Science
| Layer | Source | Details |
|-------|--------|---------|
| NLNOG Nodes | NLNOG Ring | 750+ network measurement nodes |
| Buildings | Overture Maps | Global building footprints |
| Satellites | Celestrak | 1,500+ orbital positions, notable labels |
| Population Density | JRC GHSL | 100m resolution global |
| Land Cover | ESA WorldCover | 44-class land use |
| Waterways | HydroSHEDS/OSM | Rivers, lakes, water features |

### Terrain & Imagery
| Layer | Source | Details |
|-------|--------|---------|
| Hillshade | SRTM 30m | Terrain shading |
| Elevation Color | SRTM 30m | Hypsometric color ramp |
| Data Accuracy | Multi-source | Resolution heatmap (default on) |
| Topo Contours | SRTM 30m | 100m/500m contour intervals |
| Bathymetry | GEBCO 2025 | Ocean depth shading |
| Satellite Imagery | NASA GIBS | MODIS Terra true color |
| Night Lights | NASA VIIRS | Black Marble city lights |
| Marine Weather | Open-Meteo | Wave height, SST, wind |

---

## Map Features

- **9 basemaps** — Dark, Dark No-Labels, Voyager, Light, Positron, OSM, Satellite, Topo, Terrain
- **Opacity sliders** on all raster layers
- **DD/DMS coordinate toggle** in position panel
- **Elevation profiling** — SVG sparkline on distance measurement
- **Annotations** — draw points, lines, polygons with naming
- **Bookmarks** — save/restore viewport + layers to localStorage
- **Export** — GeoJSON (visible layers) + PNG screenshot
- **Earthquake timeline** — 24H/7D/30D feed with play/pause animation
- **Hurricane animation** — track position playback
- **Keyboard shortcuts** — `L` layers, `?` help, `Esc` close
- **Offline support** — service worker with cache-first navigation
- **Accessibility** — ARIA roles, keyboard navigation, live regions

---

## License

GPL-3.0
