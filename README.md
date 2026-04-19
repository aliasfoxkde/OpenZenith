# OpenZenith

Free, fast, global elevation data platform with interactive 3D globe, 2D map views, and Python SDK.

**Live:** [https://openzenith.cyopsys.com](https://openzenith.cyopsys.com) | **Map:** [/map](https://openzenith.cyopsys.com/map) | **Globe:** [/globe](https://openzenith.cyopsys.com/globe) | **Explore:** [/explore](https://openzenith.cyopsys.com/explore)

---

## Features

### 🗺️ Interactive Map & Globe
- **3D Globe** (CesiumJS) with terrain and real-time data layers
- **2D Map** (MapLibre) with dark theme, 5 basemaps, layer controls
- **Elevation heatmap** — hypsometric color ramp (toggleable)
- **Accuracy heatmap** — data source resolution overlay (default on)
- **Contour lines** — auto-generated major/minor topo contours
- **Hillshade** — terrain shading for depth perception

### 📡 Real-Time Data Layers
- **Earthquakes** (USGS) — global seismic activity
- **Flights** (OpenSky) — live aircraft positions
- **Vessels** (AISstream) — ship tracking
- **Military aircraft** (ADSB Exchange)
- **Satellites** (Celestrak) — orbital positions
- **Hurricanes** (NOAA) — active tropical cyclones
- **Weather radar** (RainViewer) — global precipitation
- **Wildfires** (NASA EONET) — fire events
- **Air quality** (WAQI) — AQI measurements
- **NLNOG nodes** — network infrastructure
- **Buildings** (Overture Maps) — building footprints
- **Population density** — census gridded data
- **Land cover** — ESA WorldCover classification

### 📐 Elevation Tools
- Click-to-query elevation at any point
- Elevation profiling
- Measurement tools (distance, area)
- Annotations and bookmarks
- Terrain 3D extrusion

### 🐍 Python SDK
- `openzenith download` — regional tile download with HuggingFace
- `openzenith query` — batch elevation queries
- `openzenith trace` — downstream flow tracing
- `openzenith watershed` — watershed delineation
- D8 flow direction, flow accumulation, stream extraction
- OZT2 compression (67% smaller than Terrarium PNG, lossless)
- Works offline after initial tile download

### 🔧 API Endpoints (47 routes)

| Category | Endpoints |
|----------|-----------|
| Elevation | `/api/elevation`, `/api/elevation/batch`, `/api/dem-tile/{z}/{x}/{y}`, `/api/elevation-color/{z}/{x}/{y}`, `/api/elevation-accuracy/{z}/{x}/{y}`, `/api/contours/{z}/{x}/{y}` |
| Real-time | `/api/earthquakes`, `/api/flights`, `/api/vessels`, `/api/satellites`, `/api/military` |
| Weather | `/api/hurricanes`, `/api/weather/warnings`, `/api/weather/radar` |
| Environment | `/api/wildfires`, `/api/airquality`, `/api/bathymetry` |
| Infrastructure | `/api/nlnog`, `/api/waterways` |
| Overlay tiles | `/api/landcover/{z}/{x}/{y}`, `/api/population/{z}/{x}/{y}` |
| Search | `/api/geocode` |

---

## Quick Start

### Query Elevation

```bash
curl "https://openzenith.cyopsys.com/api/elevation?lat=28.0&lon=86.9"
# {"elevation":8848,"unit":"meters","source":"huggingface","tile":"N28E086","resolution":30}
```

### Python SDK

```bash
pip install -e ".[download]"
openzenith download --region europe --zoom-levels 0-8
openzenith query --lat 40.7128 --lon -74.0060
```

```python
import openzenith
elev = openzenith.get_elevation(40.7128, -74.0060)
print(f"NYC: {elev:.1f}m")
```

### JavaScript

```js
const res = await fetch('/api/elevation?lat=48.8566&lon=2.3522');
const { elevation } = await res.json();
console.log(elevation); // 35
```

---

## Local SDK vs API

| Use Case | Recommended | Speed |
|----------|-------------|-------|
| Single query | API | 200-500ms |
| Web dashboard | API | Real-time |
| Flow simulation | Local SDK | <2s |
| Batch 100+ points | Local SDK | <10ms |
| Contour generation | Local SDK | <1s |
| Offline use | Local SDK | No network |

See [docs/LOCAL_VS_API.md](docs/LOCAL_VS_API.md) for full comparison.

---

## Data Sources

| Source | Resolution | Coverage | Accuracy |
|--------|-----------|----------|----------|
| SRTM 30m | 30m | ±60° latitude | ±16m |
| Copernicus GLO-30 | 30m | ±60° | ±16m |
| ArcticDEM | 2m | >60°N land | ±1m |
| EEA DTM | 10m | Europe | ±5m |
| GEBCO 2025 | 450m | Global ocean | ±100-500m |

Validation: 30 benchmark points tested, 76.7% pass rate (no encoding bugs found).
See [docs/VALIDATION_REPORT.md](docs/VALIDATION_REPORT.md) for details.

---

## Tech Stack

- **Frontend:** Next.js 15 App Router, MapLibre GL, CesiumJS
- **Runtime:** Cloudflare Pages (Edge Workers)
- **Storage:** HuggingFace Datasets (DEM tiles), Cloudflare R2 (cache)
- **Python SDK:** NumPy, Pillow, requests, optional Zstd/Brotli
- **Deploy:** GitHub Actions → Cloudflare Pages (automatic)

---

## Project Structure

```
api/                    # Next.js 15 application
  src/app/              # Pages and API routes (47 routes)
  src/lib/              # Shared libraries (elevation, weather, layers)
  src/components/       # React components
openzenith/             # Python SDK
  cli.py                # CLI: download/query/trace/watershed/info/validate
  elevation.py          # Elevation queries and grid loading
  hydrology.py          # D8 flow direction, accumulation, streams
  tracing.py            # Downstream tracing
  terrarium.py          # PNG tile encoding/decoding
  tile_format_v2.py     # OZT2 compression (gradient + Brotli)
scripts/                # Utility scripts (validation, benchmarking, DEM pipeline)
docs/                   # Documentation
examples/               # Tutorials
```

---

## Documentation

- [LOCAL_VS_API.md](docs/LOCAL_VS_API.md) — Local SDK vs API usage guide
- [VALIDATION_REPORT.md](docs/VALIDATION_REPORT.md) — Elevation data validation
- [REVAMP_PLAN.md](docs/REVAMP_PLAN.md) — Development roadmap and task tracking
- [examples/README.md](examples/README.md) — Python SDK tutorials

---

## License

MIT
