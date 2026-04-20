# OpenZenith

Global geospatial intelligence platform — interactive 3D globe, 2D map, real-time data layers, and Python SDK.

**Live:** [openzenith.cyopsys.com](https://openzenith.cyopsys.com) · [Map](https://openzenith.cyopsys.com/map) · [Globe](https://openzenith.cyopsys.com/globe) · [Explore](https://openzenith.cyopsys.com/explore)

---

## 🌍 What is OpenZenith?

OpenZenith is a single-platform geospatial dashboard that combines:

- **3D Globe** (CesiumJS) with terrain elevation and orbital mechanics
- **2D Map** (MapLibre) with 33 data layers across 9 basemaps
- **37 real-time data layers** — earthquakes, flights, vessels, satellites, weather, and more
- **Python SDK** — offline elevation queries, terrain analysis, hydrology, flow tracing
- **REST API** — 47 endpoints for elevation, tiles, geospatial data

---

## 📡 Data Layers (37 total, 33 on 2D map)

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

## 🗺️ Map Features

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

## 🐍 Python SDK

```bash
pip install openzenith
```

### CLI Commands
```bash
openzenith download --region europe --zoom-levels 0-8   # Download DEM tiles
openzenith query --lat 40.7128 --lon -74.0060          # Query elevation
openzenith query --batch "40.7,-74.0 48.8,2.3"         # Batch query
openzenith trace --lat 36.0 --lon -118.0                # Downstream flow trace
openzenith watershed --lat 36.0 --lon -118.0            # Watershed delineation
openzenith info                                        # System info + cache stats
openzenith slope input.tif output.tif                   # Slope analysis
openzenith hillshade input.tif output.tif               # Hillshade generation
openzenith viewshed input.tif output.tif --lat 36 --lon -118 --radius 50km
openzenith profile input.tif --start 36,-118 --end 37,-117
```

### Python API
```python
import openzenith

# Elevation queries
elev = openzenith.get_elevation(28.0, 86.9)      # → 8848.0 (Everest)
results = openzenith.get_elevation_batch([(40.7, -74.0), (48.8, 2.3)])

# Terrain analysis
import numpy as np
from openzenith import terrain
slope = terrain.slope(dem_array)
aspect = terrain.aspect(dem_array)
hs = terrain.hillshade(dem_array, azimuth=315, altitude=45)
visible = terrain.viewshed(dem_array, observer_row, observer_col, radius=50)
profile = terrain.profile(dem_array, start=(0, 0), end=(100, 100))

# Hydrology
from openzenith import hydrology
flow_dir = hydrology.d8_flow_direction(dem_array)
accum = hydrology.flow_accumulation(flow_dir)
streams = hydrology.extract_streams(accum, threshold=100)
trace = hydrology.trace_downstream(flow_dir, start_row, start_col)
```

### Compression
- **OZT1** — Custom binary with zstd (67% smaller than Terrarium PNG, lossless)
- **OZT2** — Adaptive quantization + gradient prediction + Brotli (93% compression)

---

## 🔌 API Endpoints (47 routes)

| Category | Endpoints |
|----------|-----------|
| Elevation | `/api/elevation`, `/api/elevation/batch`, `/api/dem-tile/{z}/{x}/{y}`, `/api/elevation-color/{z}/{x}/{y}`, `/api/elevation-accuracy/{z}/{x}/{y}`, `/api/contours/{z}/{x}/{y}` |
| Real-time | `/api/earthquakes`, `/api/flights`, `/api/vessels`, `/api/satellites`, `/api/military` |
| Weather | `/api/hurricanes`, `/api/weather/warnings`, `/api/weather/radar` |
| Environment | `/api/wildfires`, `/api/airquality`, `/api/bathymetry` |
| Infrastructure | `/api/nlnog`, `/api/waterways` |
| Overlay tiles | `/api/landcover/{z}/{x}/{y}`, `/api/population/{z}/{x}/{y}`, `/api/sentinel2/{z}/{x}/{y}` |
| Search | `/api/geocode` |
| Proxy | `/api/proxy/{...path}` (CORS proxy for 30+ external domains) |

---

## 🚀 Quick Start

### API Query
```bash
curl "https://openzenith.cyopsys.com/api/elevation?lat=28.0&lon=86.9"
# {"elevation":8848,"unit":"meters","source":"huggingface","tile":"N28E086","resolution":30}
```

### JavaScript
```js
const res = await fetch('/api/elevation?lat=48.8566&lon=2.3522');
const { elevation } = await res.json(); // 35m (Paris)
```

---

## 🏗️ Tech Stack

| Component | Technology |
|-----------|-----------|
| Frontend | Next.js 15 App Router, React 19 |
| 2D Map | MapLibre GL JS |
| 3D Globe | CesiumJS 1.119 + satellite.js |
| Runtime | Cloudflare Pages (Edge Workers) |
| Storage | Cloudflare R2 (terrain tiles, ~1.7GB) |
| Elevation Data | [HuggingFace Datasets](https://huggingface.co/datasets/aliasfox/srtm30m-merged) (SRTM 30m global terrain) |
| Python | NumPy, Pillow, requests, Zstd/Brotli |
| Tests | 178 TypeScript (Vitest) + 42 Python (pytest) |

---

## 📁 Project Structure

```
api/                          # Next.js 15 application
  src/app/                    # Pages and API routes (47 routes)
  src/app/map/                # 2D MapLibre map (33 layers)
  src/app/globe/              # 3D CesiumJS globe (37 layers)
  src/lib/                    # Shared libraries
  src/components/             # React components
openzenith/                   # Python SDK (pip install openzenith)
  cli.py                      # CLI commands
  elevation.py                # Elevation queries
  terrain.py                  # Slope, aspect, hillshade, viewshed, profile
  hydrology.py                # D8 flow, accumulation, streams, tracing
  tile_format_v2.py           # OZT2 compression
docs/                         # Documentation
examples/                     # Tutorials
scripts/                      # Utility scripts
```

---

## 📊 Data Sources

| Source | Resolution | Coverage | Accuracy |
|--------|-----------|----------|----------|
| SRTM 30m | 30m | ±60° latitude | ±16m |
| GEBCO 2025 | 450m | Global ocean | ±100-500m |
| Copernicus GLO-30 | 30m | ±60° | ±16m |
| ArcticDEM | 2m | >60°N | ±1m |
| EEA DTM | 10m | Europe | ±5m |

Elevation tiles sourced from [aliasfox/srtm30m-merged](https://huggingface.co/datasets/aliasfox/srtm30m-merged) on HuggingFace Datasets.

**Benchmark:** 30 validation points, Everest 8,729m, Kilimanjaro 5,832m, Death Valley -83m, Denali 6,141m.

---

## 📖 Documentation

| Doc | Description |
|-----|-------------|
| [GAP_ANALYSIS.md](docs/GAP_ANALYSIS.md) | Remaining improvements plan |
| [GLOBE_PERFORMANCE_PLAN.md](docs/GLOBE_PERFORMANCE_PLAN.md) | CesiumJS performance tuning |
| [VESSEL_AIRCRAFT_DATA_OPTIONS.md](docs/VESSEL_AIRCRAFT_DATA_OPTIONS.md) | AIS/ADS-B data source options |
| [LOCAL_VS_API.md](docs/LOCAL_VS_API.md) | SDK vs API decision guide |
| [VALIDATION_REPORT.md](docs/VALIDATION_REPORT.md) | Elevation accuracy validation |
| [REMAINING_TASKS.md](docs/REMAINING_TASKS.md) | Task tracking (35/37 complete) |

---

## 📋 Pending (requires external resources)

- **ADSB Exchange** ($30/yr subscription) — military aircraft data
- **Vessel tracking** — AISstream free tier non-functional; needs AISHub feeder (~$100 RTL-SDR + integration) or paid API
- **COMET-LiCS** — InSAR subsidence monitoring (needs dataset identification)

See [VESSEL_AIRCRAFT_DATA_OPTIONS.md](docs/VESSEL_AIRCRAFT_DATA_OPTIONS.md) for hardware/software setup details.

---

## License

GPL-3.0
