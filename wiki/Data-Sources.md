# Data Sources

OpenZenith integrates multiple elevation and bathymetry data sources to provide global terrain coverage.

## Primary Data Sources

### SRTM 30m

| Property | Value |
|----------|-------|
| **Name** | Shuttle Radar Topography Mission |
| **Resolution** | 30 meters (1 arc-second) |
| **Coverage** | Land areas between 56°S and 60°N |
| **Vertical Accuracy** | ~16m RMSE |
| **Source** | NASA/USGS via HuggingFace |
| **HuggingFace** | [aliasfox/srtm30m-merged](https://huggingface.co/datasets/aliasfox/srtm30m-merged) |
| **Storage** | Cloudflare R2, local `.merged` files |
| **Total Size** | ~65GB (14,296 tiles) |

The SRTM data is pre-processed and stored in the custom **OZCHNK01** (`.merged`) format:

```
.merged format (OZCHNK01):
- 15×15 chunks per 1°×1° tile
- Each chunk: 2400×2400 pixels (1/15 degree)
- Horizontal differencing applied before zlib compression
```

#### Loading Local .merged Files

```python
from openzenith.merged import read_elevation_from_merged

elev = read_elevation_from_merged(
    lat=28.0,
    lon=86.9,
    data_dir="/path/to/srtm30m-merged"
)
# Returns: {'elevation': np.ndarray, 'transform': tuple}
```

---

### GEBCO 2025 Bathymetry

| Property | Value |
|----------|-------|
| **Name** | General Bathymetric Chart of the Oceans |
| **Resolution** | 15 arc-seconds (~463m at equator) |
| **Coverage** | Global ocean floor |
| **Source** | Copernicus/GEBCO |
| **URL** | https://www.gebco.net/data_and_products/gebco_2025/ |
| **Storage** | Cloudflare R2 |
| **Format** | NetCDF / GeoTIFF |

GEBCO provides ocean depth measurements (negative elevation) for bathymetry visualization.

---

### CopernicusDEM

| Property | Value |
|----------|-------|
| **Name** | Copernicus Digital Elevation Model |
| **Resolution** | 30m (GLO-30) |
| **Coverage** | Land areas globally |
| **Source** | Copernicus Land Monitoring Service |

Used as a fallback for areas not covered by SRTM.

---

## OZT2 Tile Dataset

| Property | Value |
|----------|-------|
| **Name** | SRTM 30m OZT2 Tiles v2 |
| **HuggingFace** | [aliasfox/srtm30m-ozt2-v2](https://huggingface.co/datasets/aliasfox/srtm30m-ozt2-v2) |
| **Tiles** | ~747,000 tiles |
| **Zoom Levels** | z7, z8, z9, z10, z11 |
| **Size** | ~2GB compressed |
| **Format** | OZT2 (see [OZT-Tile-Formats](OZT-Tile-Formats.md)) |

---

## Coverage Maps

### SRTM Coverage

Global land coverage from 56°S to 60°N. Notable gaps:
- Arctic/Antarctic regions
- Some small islands (due to Sentinel-1 processing issues)

### GEBCO Coverage

Full ocean coverage including:
- Mid-ocean ridges
- Ocean trenches (e.g., Mariana Trench: -10,994m)
- Continental shelves
- Seamounts

### Combined Coverage (FusedDEM)

Using `FusedDEM`, land uses SRTM and ocean uses GEBCO for seamless global elevation:

```python
from openzenith import FusedDEM

fused = FusedDEM(srtm_dir="/data/srtm", gebco_dir="/data/gebco")

# Query includes both land and ocean
elev, surface = fused.query_point(40.7128, -74.0060)
# elev = 10, surface = "land"  (New York)

elev, surface = fused.query_point(36.0, -142.0)
# elev = -4500, surface = "ocean"  (Pacific Ocean)
```

---

## Local Data Setup

### Directory Structure

```
data/
├── srtm30m-merged/       # ~65GB, 14,296 .merged files
│   ├── N28E086.merged    # 1°×1° tile at lat 28-29, lon 86-87
│   ├── N36W118.merged    # lat 36-37, lon -118 to -117
│   └── ...
├── gebco/                # GEBCO NetCDF/GeoTIFF files
│   ├── gebco_2025.nc
│   └── ...
└── ozt2/                 # OZT2 tiles (optional)
    ├── z10/
    │   ├── x163/
    │   │   ├── y394.ozt2
    │   │   └── y395.ozt2
    │   └── ...
    └── ...
```

### Downloading Data

#### From HuggingFace

```python
from openzenith import load_tiles, load_ozt2_tiles_from_hf

# Load SRTM tiles
tile_dir = load_tiles(
    zoom_levels=[7, 8, 9, 10],
    cache_dir="/path/to/data"
)

# Load OZT2 tiles
ozt2_dir = load_ozt2_tiles_from_hf(
    repo_id="aliasfox/srtm30m-ozt2-v2",
    zoom_levels=[10, 11],
    cache_dir="/path/to/ozt2"
)
```

#### Using CLI

```bash
# Download SRTM tiles
openzenith tiles --bbox -125 25 -65 50 --zoom 7-10 --cache-dir /tmp/data

# Download specific region
openzenith tiles --region "Alps" --zoom 10 --cache-dir /tmp/data
```

---

## Real-time Data Sources

OpenZenith integrates these external real-time APIs:

| Layer | Source | Provider | URL |
|-------|--------|----------|-----|
| Earthquakes | USGS | USGS | earthquake.usgs.gov |
| Flights | OpenSky Network | OpenSky | opensky-network.org |
| Vessels | AIS | AISStream | aistream.noaa.gov |
| Hurricanes | IBTrACS | NOAA | nhc.noaa.gov |
| Wildfires | MODIS | NASA | firms.modaps.eosdis.nasa.gov |
| Weather | NWS | NOAA | weather.gov |
| Satellites | Celestrak | CelesTrak | celestrak.org |
| NLNOG | Ring | NLNOG | ring.nlnog.net |

These sources are accessed via the REST API and cached according to each source's update frequency.

---

## Data Quality

### Elevation Accuracy

| Source | Absolute Horizontal | Absolute Vertical |
|--------|--------------------|--------------------|
| SRTM 30m | ~20m | ~16m RMSE |
| GEBCO 2025 | ~100m | ~100m RMSE |
| CopernicusDEM | ~10m | ~10m RMSE |

### Known Issues

1. **SRTM voids**: Some areas have radar shadow voids filled with interpolated data
2. **Coastal areas**: SRTM/GEBCO boundary may show slight discontinuities
3. **Antarctica**: Limited SRTM coverage, relies on other sources
4. **Ocean floor**: GEBCO resolution (~463m) limits detail in deep ocean

---

## Citation

If using OpenZenith data in research:

**Elevation**: "SRTM 30m elevation data accessed via OpenZenith platform, derived from NASA/USGS SRTM data."

**Bathymetry**: "GEBCO 2025 bathymetry data accessed via OpenZenith platform, from the General Bathymetric Chart of the Oceans."
