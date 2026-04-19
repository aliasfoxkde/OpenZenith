# OpenZenith Examples

Quick tutorials for the Python SDK.

## Installation

```bash
pip install -e .                  # Core (terrarium, elevation, codecs)
pip install -e ".[download]"      # + HuggingFace tile download
pip install -e ".[compression]"   # + Zstd + Brotli compression
pip install -e ".[all]"           # Everything
```

## Quick Start

```python
import openzenith

# Decode a Terrarium PNG tile
elevation_grid = openzenith.decode_tile(open("tile.png", "rb").read())
print(f"Tile shape: {elevation_grid.shape}, range: {elevation_grid.min():.0f} - {elevation_grid.max():.0f}m")

# Encode back to Terrarium PNG
png_bytes = openzenith.encode_tile(elevation_grid)

# Query elevation at a point (requires local tiles)
# openzenith.load_tiles(zoom_levels=[0,1,2,3,4,5,6,7,8])
# elev = openzenith.get_elevation(40.7128, -74.0060)
# print(f"NYC elevation: {elev:.1f}m")
```

## Flow Simulation (Hydrology)

```python
from openzenith import load_elevation_grid, d8_flow_direction, flow_accumulation, extract_streams
import numpy as np

# Load elevation grid around a point
grid_info = load_elevation_grid(40.0, -74.0, zoom=10, radius_cells=200)
dem = grid_info["grid"]

# Replace NaN with 0 for hydrology
dem = np.where(np.isnan(dem), 0, dem)

# Compute D8 flow directions
flow_dir = d8_flow_direction(dem)

# Compute flow accumulation
accum = flow_accumulation(flow_dir)

# Extract streams (areas > 500 upstream pixels)
streams = extract_streams(accum, threshold=500)
print(f"Stream pixels: {streams.sum()} ({streams.sum() / streams.size * 100:.1f}% of area)")

# Save as GeoJSON-like coordinates
stream_coords = []
rows, cols = np.where(streams)
for r, c in zip(rows, cols):
    lat = grid_info["lat_min"] + r * grid_info["cell_size_deg"]
    lon = grid_info["lon_min"] + c * grid_info["cell_size_deg"]
    stream_coords.append([lon, lat])

print(f"Stream coordinate points: {len(stream_coords)}")
```

## Downstream Tracing

```python
from openzenith import trace_downstream

# Trace from a mountain point to the ocean
result = trace_downstream(40.7, -74.5, zoom=10, max_steps=5000)

if result:
    print(f"Path: {result['steps']} steps, {result['total_distance']:.1f} km")
    print(f"Start: {result['start_elev']:.0f}m → End: {result['end_elev']:.0f}m")
    print(f"First point: {result['path'][0]}")
    print(f"Last point:  {result['path'][-1]}")
```

## Contour Generation

```python
from openzenith import load_elevation_grid
from openzenith.geo_utils import marching_squares
import numpy as np

# Load grid
grid_info = load_elevation_grid(46.0, 8.0, zoom=11, radius_cells=128)  # Swiss Alps
dem = grid_info["grid"]

# Generate contours at 100m intervals
contours = marching_squares(dem, interval=100)
print(f"Contours: {len(contours)} lines")

# Major contours every 500m
major = marching_squares(dem, interval=500)
print(f"Major contours: {len(major)} lines")
```

## Batch Processing

```python
from openzenith import get_elevation_batch

# Query elevation for many points
points = [
    (40.7128, -74.0060),   # New York
    (35.6762, 139.6503),   # Tokyo
    (-33.8688, 151.2093),  # Sydney
    (48.8566, 2.3522),     # Paris
    (-22.9068, -43.1729),  # Rio
    (55.7558, 37.6173),    # Moscow
    (28.6139, 77.2090),    # Delhi
    (39.9042, 116.4074),   # Beijing
]

results = get_elevation_batch(points)
for (lat, lon), elev in zip(points, results):
    status = f"{elev:.1f}m" if elev is not None else "ocean/unknown"
    print(f"  ({lat:.4f}, {lon:.4f}) → {status}")
```

## OZT2 Compression

```python
from openzenith import auto_encode, decode_v2
import numpy as np

# Generate test data
dem = np.random.randint(-500, 5000, (256, 256), dtype=np.int16)

# Compress with OZT2 (auto-selects best prediction + compression)
compressed = auto_encode(dem)
print(f"Original: {dem.nbytes} bytes → OZT2: {len(compressed)} bytes ({len(compressed)/dem.nbytes*100:.0f}%)")

# Decompress
recovered = decode_v2(compressed)
assert np.array_equal(dem, recovered), "Lossless roundtrip failed!"
print("✅ Lossless roundtrip verified")
```

## CLI Usage

```bash
# Show system info
openzenith info

# Download tiles for a region
openzenith download --region europe --zoom-levels 0-8

# Query elevation
openzenith query --lat 40.7128 --lon -74.0060

# Batch query
openzenith query --batch "40.7,-74.0 35.7,139.7 -33.9,151.2"

# Trace downstream
openzenith trace --lat 40.7 --lon -74.5 --output trace.geojson

# Delineate watershed
openzenith watershed --lat 40.7 --lon -74.0 --output watershed.geojson

# Run validation
openzenith validate --mode spot
```

## Local SDK vs API

For **compute-intensive** applications (flow simulation, watershed delineation,
batch processing, contour generation), the **local Python SDK** is recommended:

- No HTTPS overhead per tile request
- Direct file I/O from local cache
- Full NumPy array access for custom algorithms
- Supports offline use after initial download

For **simple queries** and **web services**, the **HTTP API** is sufficient:

```bash
curl "https://openzenith.cyopsys.com/api/elevation?lat=40.7128&lon=-74.0060"
```

The server handles tile assembly, bilinear interpolation, and GEBCO fallback
automatically. Latency: 200-500ms per query (warm cache), 3-8s (cold).
