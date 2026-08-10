# Python SDK Reference

Complete reference for the OpenZenith Python SDK (`openzenith`). All functions are available via `import openzenith as oz`.

## Module Overview

| Module | Purpose |
|--------|---------|
| `elevation.py` | Point and batch elevation queries, tile loading |
| `terrain.py` | Terrain analysis (slope, aspect, hillshade, viewshed) |
| `hydrology.py` | D8 flow direction, flow accumulation, watershed delineation |
| `fuse.py` | Multi-DEM fusion (SRTM land + GEBCO bathymetry) |
| `viz.py` | Visualization helpers (plots, 3D mesh, PNG export) |
| `geotiff.py` | GeoTIFF and Cloud-Optimized GeoTIFF export |
| `backends/` | Tile backend implementations (local, R2, HuggingFace) |

---

## elevation.py

### Point Queries

#### `get_elevation(lat, lon, tile_dir=None, zoom_levels=None, cache_dir=None, use_ozt2=False)`

Query elevation at a single point.

```python
import openzenith as oz

elev = oz.get_elevation(40.7128, -74.0060)  # New York
# 10.0
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `lat` | float | Latitude (-90 to 90) |
| `lon` | float | Longitude (-180 to 180) |
| `tile_dir` | str \| Path | Local tile directory |
| `zoom_levels` | list[int] | Zoom levels to search |
| `cache_dir` | str \| Path | Cache directory |
| `use_ozt2` | bool | Use OZT2 tiles (faster, lossy) |

**Returns**: `float | None` — elevation in meters, or None if not available

---

#### `get_elevation_batch(points, tile_dir=None, zoom_levels=None, max_workers=8)`

Query elevation for multiple points concurrently.

```python
points = [(40.7, -74.0), (34.0, -118.0), (51.5, -0.1)]
elevations = oz.get_elevation_batch(points)
# [10.0, 120.0, 25.0]
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `points` | list[tuple[float, float]] | List of (lat, lon) pairs |
| `tile_dir` | str \| Path | Local tile directory |
| `zoom_levels` | list[int] | Zoom levels to search |
| `max_workers` | int | Max concurrent requests (default 8) |

**Returns**: `list[float | None]`

---

### Grid Loading

#### `load_elevation_grid(lat, lon, zoom, radius_cells=100, cache_dir=None)`

Load an elevation grid centered on a point.

```python
grid = oz.load_elevation_grid(lat=36.0, lon=-118.0, zoom=10, radius_cells=100)
# Returns: {'elevation': np.ndarray, 'transform': tuple, 'nodata': float}
```

**Returns**: `dict` with keys:
- `elevation`: 2D numpy array of elevations
- `transform`: (origin_lat, origin_lon, cell_size)
- `nodata`: NoData value (-32768.0)

---

#### `load_tiles(zoom_levels=None, repo_id="aliasfox/srtm30m-merged", cache_dir=None)`

Load SRTM tiles from HuggingFace.

```python
tile_dir = oz.load_tiles(zoom_levels=[7, 8, 9], cache_dir="/tmp/srtm")
```

---

#### `load_ozt2_tiles(tile_dir)`

Load OZT2 tiles from a local directory.

```python
tile_dir = oz.load_ozt2_tiles("/path/to/ozt2/tiles")
```

---

#### `load_ozt2_tiles_from_hf(repo_id="aliasfox/srtm30m-ozt2-v2", zoom_levels=None, cache_dir=None, bbox=None)`

Load OZT2 tiles from HuggingFace dataset.

```python
tile_dir = oz.load_ozt2_tiles_from_hf(
    repo_id="aliasfox/srtm30m-ozt2-v2",
    zoom_levels=[10, 11],
    cache_dir="/tmp/ozt2"
)
```

---

### Tile Utilities

#### `get_elevation_from_ozt2(lat, lon, ozt2_dir=None, zoom_levels=None)`

Query elevation using OZT2 tiles.

```python
elev = oz.get_elevation_from_ozt2(36.0, -118.0, ozt2_dir="/tmp/ozt2")
```

---

#### `download_tiles(bbox=None, region=None, lat=None, lon=None, radius=0.5, zoom_levels=None, cache_dir=None)`

Download tiles for a geographic region.

```python
result = oz.download_tiles(
    lat=40.7, lon=-74.0,
    radius=0.5,
    zoom_levels=[7, 8, 9, 10]
)
```

---

## terrain.py

All terrain functions accept these common parameters:

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `dem` | np.ndarray | — | Input elevation grid (2D) |
| `cell_size_deg` | float | 0.001 | Cell size in degrees (~111m at equator) |
| `nodata` | float | -32768.0 | NoData value |

---

### Slope

#### `slope(dem, cell_size_deg=0.001, nodata=-32768.0)`

Compute terrain slope in degrees using Horn's method (3x3 window).

```python
slope_grid = oz.slope(dem)
```

---

#### `slope_fast(dem, cell_size_deg=0.001, nodata=-32768.0)`

Compute slope using finite differences (~100x faster than `slope`).

```python
slope_fast = oz.slope_fast(dem)
```

---

### Aspect

#### `aspect(dem, cell_size_deg=0.001, nodata=-32768.0)`

Compute terrain aspect (direction of steepest descent) in degrees (0-360, clockwise from North). Flat areas return -1.

```python
aspect_grid = oz.aspect(dem)
```

---

### Hillshade

#### `hillshade(dem, azimuth=315.0, altitude=45.0, cell_size_deg=0.001, nodata=-32768.0, z_factor=1.0)`

Compute analytical hillshade. Returns uint8 array (0-255).

```python
hs = oz.hillshade(dem, azimuth=315, altitude=45)
```

---

#### `multi_hillshade(dem, cell_size_deg=0.001, nodata=-32768.0, z_factor=3.0)`

Multi-directional hillshade composite from 8 light directions. Better for complex terrain.

```python
multi_hs = oz.multi_hillshade(dem)
```

---

### Viewshed

#### `viewshed(dem, observer_row, observer_col, observer_height=1.75, cell_size_deg=0.001, nodata=-32768.0, max_distance_cells=None)`

Compute viewshed (visible areas from observer point). Uses Numba JIT when available.

```python
visible = oz.viewshed(dem, observer_row=50, observer_col=50, observer_height=1.75)
# visible is boolean np.ndarray
```

---

### Terrain Indices

#### `tpi(dem, cell_size_deg=0.001, nodata=-32768.0)`

Topographic Position Index — deviation from local mean elevation.

```python
tpi_grid = oz.tpi(dem)
```

---

#### `roughness(dem, cell_size_deg=0.001, nodata=-32768.0)`

Terrain roughness — max minus min in 3x3 window.

```python
roughness_grid = oz.roughness(dem)
```

---

#### `tri(dem, cell_size_deg=0.001, nodata=-32768.0)`

Terrain Ruggedness Index — mean of absolute deviations from local mean.

```python
tri_grid = oz.tri(dem)
```

---

#### `curvature(dem, cell_size_deg=0.001, nodata=-32768.0)`

Mean curvature (second derivative of elevation, 1/meters).

```python
curvature_grid = oz.curvature(dem)
```

---

#### `profile_curvature(dem, cell_size_deg=0.001, nodata=-32768.0)`

Curvature along the slope direction (positive = convex, negative = concave).

```python
pc_grid = oz.profile_curvature(dem)
```

---

#### `planform_curvature(dem, cell_size_deg=0.001, nodata=-32768.0)`

Curvature perpendicular to slope direction (ridges = positive, valleys = negative).

```python
pfc_grid = oz.planform_curvature(dem)
```

---

#### `drainage_density(dem, cell_size_deg=0.001, nodata=-32768.0)`

Drainage density from flow accumulation (km/km²).

```python
dd_grid = oz.drainage_density(flow_accum)
```

---

### Profiling

#### `profile(dem, points, cell_size_deg=0.001)`

Generate elevation profile along a transect.

```python
profile = oz.profile(dem, points=[(row1, col1), (row2, col2)])
# Returns: [{'distance_m': float, 'elevation': float, 'row': int, 'col': int}, ...]
```

---

### Color Relief

#### `color_relief(dem, breaks=None, nodata=-32768.0)`

Generate hypsometric color relief. Returns RGBA uint8 array.

```python
color = oz.color_relief(dem)
```

---

## hydrology.py

### Depression Filling

#### `fill_depressions(dem, nodata=-32768.0)`

Fill depressions using priority-flood Wang & Liu 2006 algorithm.

```python
filled_dem = oz.fill_depressions(dem)
```

---

### Flow Direction

#### `d8_flow_direction(dem, nodata=-32768.0)`

Compute D8 flow direction. Returns int8 array (-1 for pits).

```python
flow_dir = oz.d8_flow_direction(dem)
# Values: 0-7 for E,SE,S,SW,W,NW,N,NE
```

---

### Flow Accumulation

#### `flow_accumulation(flow_dir, nodata_dir=-1)`

Compute D8 flow accumulation (iterative method).

```python
accum = oz.flow_accumulation(flow_dir)
```

---

#### `flow_accumulation_fast(flow_dir, nodata_dir=-1)`

Compute flow accumulation using topological sort (faster for large grids).

```python
accum = oz.flow_accumulation_fast(flow_dir)
```

---

### Stream Extraction

#### `extract_streams(accum, threshold=100)`

Extract stream network from flow accumulation.

```python
streams = oz.extract_streams(accum, threshold=100)
# Returns boolean array
```

---

#### `stream_order(streams, flow_dir, nodata_dir=-1)`

Compute Strahler stream order.

```python
order = oz.stream_order(streams, flow_dir)
```

---

### Watershed Delineation

#### `delineate_watershed(lat, lon, zoom=10, radius_cells=200, tile_cache_dir=None)`

Delineate watershed from a pour point.

```python
ws = oz.delineate_watershed(36.5785, -118.2923)
# Returns: {'boundary': list, 'area_km2': float, 'min_elev': float, 'max_elev': float}
```

---

### Topographic Wetness Index

#### `twi(dem, cell_size_deg=0.001, nodata=-32768.0)`

Topographic Wetness Index: `ln(a / tan(beta))` where a = accumulation, beta = slope.

```python
twi_grid = oz.twi(dem)
```

---

## fuse.py

### FusedDEM Class

#### `class FusedDEM(srtm_dir=None, gebco_dir=None, *, gebco_url=GEBCO_BASE_URL, srtm_tiles=None, use_http_fallback=True)`

Fuses SRTM land elevation with GEBCO bathymetry for complete ocean+land elevation.

```python
fused = oz.FusedDEM(srtm_dir="/data/srtm", gebco_dir="/data/gebco")

# Query a region
elevation, mask = fused.query(40.0, -74.0, 41.0, -73.0)

# Query a single point
elev, surface = fused.query_point(40.7128, -74.0060)
# elev = 10, surface = "land"
```

---

#### `load_fused_tile(lat, lon, zoom=10, srtm_dir=None, gebco_dir=None, resolution=None)`

Load a fused tile (land + ocean) at given coordinates.

```python
elev, mask = oz.load_fused_tile(40.7, -74.0, zoom=10)
```

---

#### `load_fused_elevation_grid(lat_min, lon_min, lat_max, lon_max, resolution=0.001, srtm_dir=None, gebco_dir=None)`

Load a fused elevation grid for a bounding box.

```python
elev, mask = oz.load_fused_elevation_grid(40.0, -74.5, 41.0, -73.5)
```

---

## viz.py

### Plotting

#### `plot_terrain(dem, transform=None, *, cmap="terrain", vmin=None, vmax=None, interval=None, show=False, figsize=(12, 8), title="Elevation (m)", ax=None)`

Plot DEM as a colored terrain map.

```python
oz.plot_terrain(dem, show=True)
```

---

#### `plot_hillshade(dem, transform=None, *, figsize=(12, 8), show=False, ax=None, **kwargs)`

Plot hillshade with shading.

```python
oz.plot_hillshade(dem, show=True)
```

---

#### `plot_contours(dem, transform=None, *, interval=50.0, min_elev=None, max_elev=None, decimals=1, figsize=(12, 8), show=False, ax=None)`

Plot contour lines.

```python
oz.plot_contours(dem, interval=100, show=True)
```

---

### 3D Export

#### `terrain_to_3d_mesh(dem, transform=None, *, scale=1.0, flat=False, max_vertices=100000)`

Convert DEM to GeoJSON 3D mesh for three.js/CesiumJS.

```python
mesh = oz.terrain_to_3d_mesh(dem, scale=1.5)
```

---

#### `terrain_to_glb(dem, transform=None, *, scale=1.0, max_vertices=100000, palette=None)`

Convert DEM to GLB binary format.

```python
glb_data = oz.terrain_to_glb(dem, scale=1.0)
with open("terrain.glb", "wb") as f:
    f.write(glb_data)
```

---

### Image Export

#### `terrain_to_png(dem, *, palette=None, nodata_alpha=True)`

Convert DEM to PNG with hypsometric coloring.

```python
png_bytes = oz.terrain_to_png(dem)
with open("terrain.png", "wb") as f:
    f.write(png_bytes)
```

---

## geotiff.py

### `export_geotiff(data, output_path, transform=None, *, nodata=-32768.0, compress=None, dtype=None, origin_lat=0.0, origin_lon=0.0, cell_size=0.001, crs="EPSG:4326")`

Export grid as GeoTIFF.

```python
oz.export_geotiff(dem, "output.tif", transform=(36.0, -118.0, 0.001))
```

---

### `export_cog(data, output_path, transform=None, *, nodata=-32768.0, compress="zstd", origin_lat=0.0, origin_lon=0.0, cell_size=0.001, crs="EPSG:4326", overview_levels=None, overview_compress="zstd")`

Export as Cloud-Optimized GeoTIFF (COG).

```python
oz.export_cog(dem, "output_cog.tif", transform=(36.0, -118.0, 0.001))
```

---

## backends/

### OZT2Backend

Local file-based OZT2 tile access.

```python
from openzenith.backends import OZT2Backend

backend = OZT2Backend("/path/to/ozt2/tiles")
grid = backend.fetch_tile(z=10, x=163, y=395)
```

---

### OZT2R2Backend

Cloudflare R2 / S3-compatible storage backend.

```python
from openzenith.backends import OZT2R2Backend

backend = OZT2R2Backend(
    "my-bucket",
    prefix="ozt2/",
    r2_account_id="...",
    r2_access_key_id="...",
    r2_secret_access_key="..."
)
grid = backend.fetch_tile(z=10, x=163, y=395)
```

---

### OZT2HFBackend

HuggingFace datasets backend for OZT2 tiles.

```python
from openzenith.backends import OZT2HFBackend

backend = OZT2HFBackend(
    repo_id="aliasfox/srtm30m-ozt2-v2",
    cache_dir="/tmp/ozt2"
)
grid = backend.fetch_tile(z=10, x=163, y=395)

# Async prefetch for batch operations
await backend.prefetch_tiles_async([(10, 163, 395), (10, 164, 395)])
```

---

## Async Client

### ElevationClient

Async elevation query client with connection pooling.

```python
import asyncio
from openzenith import ElevationClient

async def main():
    client = ElevationClient()
    elevations = await client.get_elevation_batch([(40.7, -74.0), (34.0, -118.0)])
    await client.close()

asyncio.run(main())
```

---

### ElevationBatchProcessor

High-throughput batch processing with rate limiting.

```python
from openzenith import ElevationBatchProcessor

processor = ElevationBatchProcessor(max_concurrent=10, rate_limit=100)
results = processor.process_batch(large_point_list)
```
