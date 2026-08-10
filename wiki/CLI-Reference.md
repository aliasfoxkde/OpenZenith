# CLI Reference

All commands are invoked as `openzenith <command>`. Run `openzenith --help` for general help or `openzenith <command> --help` for specific command help.

## Elevation Commands

### `query`

Query elevation at a point or batch of points.

```bash
openzenith query --lat 40.7128 --lon -74.0060
openzenith query --lat 40.7 --lon -74.0 --batch points.txt
```

| Argument | Description |
|----------|-------------|
| `--lat` | Latitude |
| `--lon` | Longitude |
| `--batch` | File with lat,lon pairs (one per line) |

---

### `download`

Download elevation tiles from HuggingFace.

```bash
openzenith download --bbox -125 25 -65 50 --zoom 7-10
openzenith download --region "United States" --zoom 8
```

| Argument | Description |
|----------|-------------|
| `--bbox` | Bounding box: min_lon min_lat max_lon max_lat |
| `--region` | Named region |
| `--lat` / `--lon` | Center point |
| `--radius` | Radius in degrees (default 0.5) |
| `--zoom` | Zoom levels (e.g., 7-10 or 7,8,9) |

---

### `tiles`

Download OZT2 tiles for a region.

```bash
openzenith tiles --lat 40.7 --lon -74.0 --radius 0.5 --zoom 10
openzenith tiles --bbox -125 25 -65 50 --zoom 7,8,9,10 --cache-dir /tmp/tiles
```

| Argument | Description |
|----------|-------------|
| `--bbox` | Bounding box |
| `--region` | Named region |
| `--lat` / `--lon` | Center point |
| `--radius` | Radius in degrees |
| `--zoom` | Zoom levels |
| `--cache-dir` | Cache directory |
| `--force` | Overwrite existing tiles |

---

## Analysis Commands

### `slope`

Compute terrain slope at a point.

```bash
openzenith slope --lat 36.0 --lon -118.0
openzenith slope --lat 36.0 --lon -118.0 --radius 200 --output slope.tif
```

| Argument | Description |
|----------|-------------|
| `--lat` / `--lon` | Center point |
| `--radius` | Radius in cells (default 100) |
| `--output` | Output file (GeoTIFF or PNG) |

---

### `aspect`

Compute terrain aspect at a point.

```bash
openzenith aspect --lat 36.0 --lon -118.0
openzenith aspect --lat 36.0 --lon -118.0 --radius 200 --output aspect.tif
```

---

### `hillshade`

Compute analytical hillshade.

```bash
openzenith hillshade --lat 36.0 --lon -118.0
openzenith hillshade --lat 36.0 --lon -118.0 --azimuth 315 --altitude 45 --z-factor 2.0
```

| Argument | Description |
|----------|-------------|
| `--azimuth` | Light azimuth in degrees (default 315) |
| `--altitude` | Light altitude in degrees (default 45) |
| `--z-factor` | Vertical exaggeration (default 1.0) |

---

### `viewshed`

Compute viewshed from an observer point.

```bash
openzenith viewshed --lat 36.0 --lon -118.0
openzenith viewshed --lat 36.0 --lon -118.0 --height 1.75 --max-dist 50 --output viewshed.tif
```

| Argument | Description |
|----------|-------------|
| `--height` | Observer height in meters (default 1.75) |
| `--max-dist` | Max distance in cells |

---

### `profile`

Generate elevation profile along a transect.

```bash
openzenith profile --lat1 36.5785 --lon1 -118.2923 --lat2 36.4199 --lon2 -117.1548
openzenith profile --lat1 36.5785 --lon1 -118.2923 --lat2 36.4199 --lon2 -117.1548 --samples 100 --output profile.json
```

| Argument | Description |
|----------|-------------|
| `--lat1` / `--lon1` | Start point |
| `--lat2` / `--lon2` | End point |
| `--samples` | Number of samples (default 50) |

---

### `tpi`

Compute Topographic Position Index.

```bash
openzenith tpi --lat 36.0 --lon -118.0 --radius 100 --output tpi.tif
```

---

### `roughness`

Compute terrain roughness.

```bash
openzenith roughness --lat 36.0 --lon -118.0 --radius 100 --output roughness.tif
```

---

### `curvature`

Compute mean curvature.

```bash
openzenith curvature --lat 36.0 --lon -118.0 --radius 100 --output curvature.tif
```

---

### `tri`

Compute Terrain Ruggedness Index.

```bash
openzenith tri --lat 36.0 --lon -118.0 --radius 100 --output tri.tif
```

---

### `twi`

Compute Topographic Wetness Index.

```bash
openzenith twi --lat 36.0 --lon -118.0 --radius 100 --output twi.tif
```

---

### `profile-curvature`

Compute profile curvature (along-slope).

```bash
openzenith profile-curvature --lat 36.0 --lon -118.0 --radius 100 --output pc.tif
```

---

### `planform-curvature`

Compute planform curvature (perpendicular to slope).

```bash
openzenith planform-curvature --lat 36.0 --lon -118.0 --radius 100 --output pfc.tif
```

---

### `drainage-density`

Compute drainage density.

```bash
openzenith drainage-density --lat 36.0 --lon -118.0 --radius 100 --output dd.tif
```

---

### `multi-hillshade`

Compute multi-directional hillshade.

```bash
openzenith multi-hillshade --lat 36.0 --lon -118.0 --z-factor 3.0 --output multi_hs.tif
```

---

### `color-relief`

Generate hypsometric color relief image.

```bash
openzenith color-relief --lat 36.0 --lon -118.0 --output color_relief.png
```

---

## Hydrology Commands

### `trace`

Trace downstream to ocean.

```bash
openzenith trace --lat 36.5785 --lon -118.2923
openzenith trace --lat 36.0 --lon -118.0 --max-steps 1000 --output trace.geojson
```

| Argument | Description |
|----------|-------------|
| `--lat` / `--lon` | Starting point |
| `--max-steps` | Max trace steps (default 10000) |
| `--output` | Output GeoJSON file |

---

### `watershed`

Delineate watershed from pour point.

```bash
openzenith watershed --lat 36.5785 --lon -118.2923
openzenith watershed --lat 36.5785 --lon -118.2923 --radius 200 --output watershed.geojson
```

| Argument | Description |
|----------|-------------|
| `--lat` / `--lon` | Pour point |
| `--radius` | Search radius in cells (default 200) |
| `--output` | Output GeoJSON file |

---

### `fill-depressions`

Fill depressions in DEM.

```bash
openzenith fill-depressions --lat 36.0 --lon -118.0 --radius 100 --output filled.tif
```

---

### `flow-accum`

Compute D8 flow accumulation.

```bash
openzenith flow-accum --lat 36.0 --lon -118.0 --radius 100 --output accum.tif
```

---

### `streams`

Extract stream network.

```bash
openzenith streams --lat 36.0 --lon -118.0 --threshold 100
openzenith streams --lat 36.0 --lon -118.0 --threshold 100 --output streams.geojson
```

| Argument | Description |
|----------|-------------|
| `--threshold` | Accumulation threshold (default 100) |

---

## Export Commands

### `encode`

Encode GeoTIFF or .merged files to OZT2 format.

```bash
openzenith encode input.merged output.ozt2
openzenith encode input.tif output.ozt2 --max-rmse 1.0 --bits 4
```

| Argument | Description |
|----------|-------------|
| `--max-rmse` | Max RMSE in meters (default 1.0) |
| `--bits` | Quantization bits (default auto) |
| `--predictor` | Predictor type (gradient, none) |
| `--validate` | Validate roundtrip after encoding |

---

### `export-geotiff`

Export terrain grid as GeoTIFF.

```bash
openzenith export-geotiff --lat 36.0 --lon -118.0 --output terrain.tif
openzenith export-geotiff --lat 36.0 --lon -118.0 --output terrain.tif --compress zstd
```

---

### `export-cog`

Export terrain grid as Cloud-Optimized GeoTIFF.

```bash
openzenith export-cog --lat 36.0 --lon -118.0 --output terrain_cog.tif
```

---

## Utility Commands

### `info`

Show system information and data availability.

```bash
openzenith info
```

---

### `validate`

Run elevation validation tests.

```bash
openzenith validate
```

---

### `ingest`

Prepare dataset bundle for submission.

```bash
openzenith ingest srtm30m-merged --name "SRTM 30m Merged" --description "SRTM data" --license CC-BY-4.0 --output bundle/
```

---

### `contour`

Export DEM contours as GeoJSON.

```bash
openzenith contour --lat 36.0 --lon -118.0 --interval 100
openzenith contour --lat 36.0 --lon -118.0 --interval 50 --output contours.geojson
```

| Argument | Description |
|----------|-------------|
| `--interval` | Contour interval in meters (default 50) |

---

### `geojson`

Export terrain grid as GeoJSON.

```bash
openzenith geojson --lat 36.0 --lon -118.0 --kind elevation
openzenith geojson --lat 36.0 --lon -118.0 --kind hillshade --output hillshade.geojson
```

| Argument | Description |
|----------|-------------|
| `--kind` | Grid type: elevation, hillshade, slope, aspect, twi, etc. |

---

## Global Options

| Option | Description |
|--------|-------------|
| `--help` | Show help |
| `--version` | Show version |
| `--verbose` | Verbose output |
| `--quiet` | Quiet output |
