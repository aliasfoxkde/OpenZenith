# OpenZenith — Local SDK vs API Usage Guide

## Quick Decision

| Use Case | Recommended | Why |
|----------|-------------|-----|
| Single elevation query | **API** | Zero setup, 200-500ms |
| Web dashboard/visualization | **API** | Direct tile rendering |
| Flow simulation/watershed | **Local SDK** | Hundreds of tile lookups needed |
| Batch processing (>100 pts) | **Local SDK** | No HTTPS overhead per tile |
| Offline use | **Local SDK** | Works without internet |
| Contour generation | **Local SDK** | Requires full grid access |
| Custom algorithms | **Local SDK** | Full NumPy array access |
| Simple integration | **API** | One HTTP call |

---

## HTTP API

Base URL: `https://openzenith.cyopsys.com`

### Single Point Elevation

```bash
curl "https://openzenith.cyopsys.com/api/elevation?lat=40.7128&lon=-74.0060"
```

Response:
```json
{"elevation": 13.0, "surface_type": "land", "unit": "meters",
 "location": {"lat": 40.7128, "lon": -74.0060},
 "source": "huggingface", "tile": "N40W074", "resolution": 30}
```

### Batch Elevation

```bash
curl -X POST "https://openzenith.cyopsys.com/api/elevation/batch" \
  -H "Content-Type: application/json" \
  -d '{"points": [[40.7,-74.0],[35.7,139.7],[-33.9,151.2]]}'
```

### DEM Tile (Terrarium PNG)

```bash
curl -o tile.png "https://openzenith.cyopsys.com/api/dem-tile/8/217/151.png"
```

### Elevation Color Heatmap

```bash
curl -o heatmap.png "https://openzenith.cyopsys.com/api/elevation-color/8/217/151.png"
```

### Accuracy Heatmap

```bash
curl -o accuracy.png "https://openzenith.cyopsys.com/api/elevation-accuracy/8/217/151.png"
```

### Contour Lines (GeoJSON)

```bash
curl "https://openzenith.cyopsys.com/api/contours/8/217/151"
```

### Other Endpoints

| Endpoint | Description |
|----------|-------------|
| `/api/earthquakes` | USGS earthquake feed |
| `/api/flights` | OpenSky flight tracking |
| `/api/vessels` | AIS vessel tracking |
| `/api/satellites` | Celestrak satellite positions |
| `/api/hurricanes` | NOAA active hurricanes |
| `/api/wildfires` | NASA EONET fire events |
| `/api/airquality` | WAQI air quality index |
| `/api/nlnog` | NLNOG network nodes |
| `/api/bathymetry` | GEBCO 2025 bathymetry |

### Performance Characteristics

| Metric | Value |
|--------|-------|
| Cold start (first query) | 3-8 seconds |
| Warm cache | 200-500ms |
| Rate limiting | None (Edge runtime) |
| SRTM coverage | ±60° latitude |
| GEBCO coverage | Global ocean |
| Spatial resolution | 30m (land), 450m (ocean) |
| Vertical accuracy | ±16m absolute (SRTM) |

---

## Local Python SDK

### Installation

```bash
pip install -e .                    # Core SDK
pip install -e ".[download]"        # + HuggingFace download
pip install -e ".[compression]"     # + Zstd + Brotli
pip install -e ".[all]"             # Everything
```

### Download Tiles

```bash
# Download specific region
openzenith download --region europe --zoom-levels 0-8

# Download by bounding box
openzenith download --bbox 35,0,60,30 --zoom-levels 0-10

# Download global (large!)
openzenith download --region world --zoom-levels 0-8
```

### Query Elevation

```python
from openzenith import get_elevation, get_elevation_batch

# Single point (uses local tiles, no network)
elev = get_elevation(40.7128, -74.0060)
print(f"NYC: {elev:.1f}m")

# Batch (no HTTPS overhead per tile)
results = get_elevation_batch([
    (40.7128, -74.0060),   # NYC
    (35.6762, 139.6503),   # Tokyo
    (-33.8688, 151.2093),  # Sydney
])
```

### Performance Comparison

| Operation | API (HTTP) | Local SDK |
|-----------|-----------|-----------|
| Single point query | 200-500ms | <1ms |
| Batch 100 points | 5-10s | <10ms |
| Load 256×256 grid | 200-500ms | <5ms |
| Flow accumulation | Not possible | <2s |
| Watershed delineation | Not possible | <5s |

The local SDK is **10-1000x faster** for compute-intensive operations because:
1. No HTTPS connection overhead per request
2. No chunk download from HuggingFace CDN
3. No tile assembly on every query
4. Direct NumPy array access for vectorized operations

### Storage Requirements

| Zoom Levels | Tile Count | Size (Terrarium PNG) | Coverage |
|-------------|-----------|---------------------|----------|
| 0-3 | 85 | ~2 MB | Global overview |
| 0-5 | 8,421 | ~80 MB | Regional |
| 0-7 | 400,000+ | ~3.5 GB | Detailed |
| 0-8 | 1,600,000+ | ~14 GB | Very detailed |
| 0-10 | 25,000,000+ | ~220 GB | Full resolution |

Recommended: **z0-z8** (~14 GB) for most applications. Use **z0-z5** (~80 MB) for quick testing.

### Offline Use

After downloading tiles once, the SDK works completely offline:

```python
from openzenith import load_tiles, get_elevation

# Download once
load_tiles(zoom_levels=[0,1,2,3,4,5,6,7,8])

# Use offline forever
elev = get_elevation(40.7128, -74.0060)
```

---

## Data Sources & Accuracy

### Land Elevation (±60° latitude)
- **SRTM 30m** (Shuttle Radar Topography Mission, Feb 2000)
- **Copernicus GLO-30** (Copernicus DEM, 2021)
- Absolute accuracy: ±16m (90% CE)
- Spatial resolution: ~30m at equator (1 arcsec)

### High-Resolution Patches
- **ArcticDEM 2m** (>60°N land)
- **REMA 2m** (<-60°S land)
- **EEA DTM 10m** (Europe: 34-72°N, -25-45°E)

### Ocean Bathymetry
- **GEBCO 2025** (15 arcsec ≈ 450m)
- Vertical accuracy: varies by depth (±100-500m)
- Coverage: Global ocean

### Known Limitations
- SRTM underestimates steep peaks by 10-200m (C-band InSAR artifact)
- SRTM has voids in areas of steep terrain (filled by GLO-30)
- GEBCO measures sea floor, not ice surface (North Pole shows ocean depth)
- Some HuggingFace tiles have corrupted data (see VALIDATION_REPORT.md)

---

## Recommendation Summary

**Use the API when:**
- Building web applications or dashboards
- Making occasional (< 10/min) queries
- Need real-time data (earthquakes, flights, vessels)
- Don't want to manage local storage
- Quick prototyping or demos

**Use the Local SDK when:**
- Processing > 100 points per session
- Running hydrology/flow analysis
- Generating contours or custom visualizations
- Need sub-millisecond query latency
- Operating in offline/restricted environments
- Building scientific tools or pipelines
