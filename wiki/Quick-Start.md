# Quick Start

This guide provides a 5-minute introduction to the OpenZenith Python SDK. By the end, you'll be able to query elevation, compute slope, trace downstream flow, and delineate a watershed.

## Prerequisites

```bash
pip install openzenith
```

## 1. Query Elevation

Get the elevation at any point on Earth:

```python
import openzenith as oz

# Single point query
elevation = oz.get_elevation(40.7128, -74.0060)  # New York
print(f"Elevation: {elevation} m")

# Batch query multiple points
points = [
    (40.7128, -74.0060),  # New York
    (34.0522, -118.2437), # Los Angeles
    (51.5074, -0.1278),   # London
]
elevations = oz.get_elevation_batch(points)
print(f"Elevations: {elevations}")
```

## 2. Load an Elevation Grid

Load a DEM grid around a point for terrain analysis:

```python
import openzenith as oz

# Load 100-cell radius grid at zoom 10 (~19m resolution)
grid = oz.load_elevation_grid(
    lat=36.0,
    lon=-118.0,
    zoom=10,
    radius_cells=100
)

dem = grid['elevation']
print(f"Grid shape: {dem.shape}")
print(f"Elevation range: {dem.min():.1f} to {dem.max():.1f} m")
```

## 3. Compute Terrain Slope

Calculate terrain slope (in degrees) using Horn's method:

```python
import openzenith as oz

# Load grid
grid = oz.load_elevation_grid(lat=36.0, lon=-118.0, zoom=10, radius_cells=100)
dem = grid['elevation']

# Compute slope (vectorized NumPy)
slope_grid = oz.slope(dem)

# slope_fast is ~100x faster for large grids
slope_fast = oz.slope_fast(dem)
```

Or via CLI:

```bash
openzenith slope --lat 36.0 --lon -118.0 --radius 100
```

## 4. Compute Aspect

Aspect defines the direction of the steepest slope (0-360 degrees, clockwise from North):

```python
import openzenith as oz

grid = oz.load_elevation_grid(lat=36.0, lon=-118.0, zoom=10, radius_cells=100)
aspect_grid = oz.aspect(dem)

# Flat areas return -1
flat_mask = aspect_grid == -1
```

Or via CLI:

```bash
openzenith aspect --lat 36.0 --lon -118.0 --radius 100
```

## 5. Compute Hillshade

Generate an analytical hillshade for visualization:

```python
import openzenith as oz

grid = oz.load_elevation_grid(lat=36.0, lon=-118.0, zoom=10, radius_cells=100)
dem = grid['elevation']

# Standard hillshade (azimuth=315, altitude=45)
hillshade = oz.hillshade(dem)

# Multi-directional hillshade (better for complex terrain)
multi = oz.multi_hillshade(dem)

# Custom lighting
custom = oz.hillshade(dem, azimuth=270, altitude=30, z_factor=2.0)
```

Or via CLI:

```bash
openzenith hillshade --lat 36.0 --lon -118.0 --azimuth 315 --altitude 45
```

## 6. Trace Downstream

Trace water flow from a point to the ocean:

```python
import openzenith as oz

# Trace from Mount Whitney to the Pacific Ocean
result = oz.delineate_watershed(
    lat=36.5785,
    lon=-118.2923,
    zoom=10,
    radius_cells=200
)

print(f"Watershed area: {result['area_km2']:.2f} km²")
print(f"Elevation range: {result['min_elev']:.0f} to {result['max_elev']:.0f} m")
```

Or trace the flow path:

```bash
openzenith trace --lat 36.5785 --lon -118.2923 --max-steps 1000
```

## 7. Extract Stream Network

Extract streams from flow accumulation:

```python
import openzenith as oz

# Compute D8 flow direction
grid = oz.load_elevation_grid(lat=36.0, lon=-118.0, zoom=10, radius_cells=200)
dem = grid['elevation']

flow_dir = oz.d8_flow_direction(dem)
accum = oz.flow_accumulation(flow_dir)

# Extract streams using a threshold (cells)
streams = oz.extract_streams(accum, threshold=100)

# Get Strahler stream order
stream_order = oz.stream_order(streams, flow_dir)
```

Or via CLI:

```bash
openzenith streams --lat 36.0 --lon -118.0 --threshold 100
```

## 8. Compute Viewshed

Find visible areas from an observer point:

```python
import openzenith as oz

grid = oz.load_elevation_grid(lat=36.0, lon=-118.0, zoom=10, radius_cells=100)
dem = grid['elevation']

# Viewshed from center of grid
viewshed = oz.viewshed(
    dem,
    observer_row=50,
    observer_col=50,
    observer_height=1.75,  # person height in meters
    max_distance_cells=50
)

# Numba JIT version is faster for large grids
```

Or via CLI:

```bash
openzenith viewshed --lat 36.0 --lon -118.0 --height 1.75 --max-dist 50
```

## 9. Generate Elevation Profile

Create an elevation profile along a transect:

```python
import openzenith as oz

# Profile from Mount Whitney to Badwater Basin (lowest point in USA)
profile = oz.profile(
    dem,
    points=[(36.5785, -118.2923), (36.4199, -117.1548)],
    cell_size_deg=0.001
)

for point in profile:
    print(f"Distance: {point['distance_m']:.0f} m, Elevation: {point['elevation']:.1f} m")
```

Or via CLI:

```bash
openzenith profile --lat1 36.5785 --lon1 -118.2923 --lat2 36.4199 --lon2 -117.1548 --samples 100
```

## 10. Export to GeoTIFF

Export elevation data for use in GIS software:

```python
import openzenith as oz

grid = oz.load_elevation_grid(lat=36.0, lon=-118.0, zoom=10, radius_cells=100)
dem = grid['elevation']

# Export as GeoTIFF
oz.export_geotiff(dem, "terrain.tif", transform=grid['transform'])

# Export as Cloud-Optimized GeoTIFF (COG)
oz.export_cog(dem, "terrain_cog.tif", transform=grid['transform'])
```

## Next Steps

- [Python-SDK](Python-SDK.md) — Full SDK reference with all functions
- [CLI-Reference](CLI-Reference.md) — All CLI commands
- [OZT-Tile-Formats](OZT-Tile-Formats.md) — Custom tile format details
- [Data-Sources](Data-Sources.md) — SRTM and GEBCO data sources
