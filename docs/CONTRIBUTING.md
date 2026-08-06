# Contributing to OpenZenith Elevation Data

OpenZenith's v2 elevation dataset is community-contributable. This guide covers how to contribute new or improved elevation tiles to the OpenZenith dataset.

---

## Overview

Contributing elevation data involves three steps:

```
1. Prepare your DEM source files
2. Convert to OZT2 format using the OpenZenith CLI
3. Submit a pull request to openzenith-data
```

---

## Data Sources

Eligible data sources must be:
- **Public domain or CC0 licensed** (or have permission to redistribute)
- **At least 30m resolution** (higher preferred)
- **Global or regional coverage** with a clear provenance

### Recommended Free Sources

| Source | Coverage | Resolution | License | URL |
|--------|----------|------------|---------|-----|
| **Copernicus GLO-30** | Global land | 30m | CC BY-NC-SA 4.0 | AWS S3 (no auth) |
| **USGS 3DEP** | CONUS + Alaska + Hawaii | 10m / 30m | Public Domain | https://earthexplorer.usgs.gov |
| **NRCan CDEM** | Canada | 20m / 250m | Open Government License | https://open.canada.ca |
| **EU-DEM v1.1** | Europe | 25m | CC BY-NC-SA 4.0 | https://land.copernicus.eu |
| **ArcticDEM** | Arctic (>60°N) | 2m / 10m | Public Domain | https://www.pgc.umn.edu/data/arcticdem |
| **GEBCO 2025** | Ocean floor | 450m | Public Domain | https://www.gebco.net |

### Quality Requirements

- Horizontal datum: **WGS84** (EPSG:4326)
- Vertical datum: **EGM96 geoid** (meters above sea level)
- Void-filled (no gaps or missing data)
- No obvious artifacts or interpolation errors

---

## Step 1: Prepare Your DEM Files

### File Formats Supported

The CLI accepts:
- **GeoTIFF** (`.tif`, `.tiff`) — recommended
- **SRTM .merged** (OZCHNK01 format)
- **Raw Int16** (`.raw`) — flat binary, 3601×3601 Int16, big-endian

### Naming Convention

Tiles should follow the SRTM naming convention for automatic bbox detection:

```
N35W106.tif        # lat 35°N–36°N, lon 106°W–107°W
S12E133.tiff      # lat 12°S–13°S, lon 133°E–134°E
N60W020_arc.tif   # ArcticDEM naming
```

Or use explicit bbox in the filename:
```
dem_34.0_-25.0_72.0_45.0.tif   # lat_min,lon_min,lat_max,lon_max
```

### Organize by Region

```
my_contribution/
├── N35W106.tif
├── N35W105.tif
├── N36W106.tif
└── N36W105.tif
```

---

## Step 2: Convert to OZT2

Install the OpenZenith CLI:

```bash
pip install openzenith
# or for dev:
pip install openzenith[all]
```

### Encode Tiles

```bash
# Encode a directory of GeoTIFFs
oz encode --input ./my_contribution/ --output ./output/ --name my_region_v1

# Encode with validation (roundtrip RMSE check)
oz encode --input ./my_contribution/ --output ./output/ --name my_region_v1 --validate

# Encode specific zoom levels (z7–z14)
oz encode --input ./my_contribution/ --output ./output/ --name my_region_v1 --zoom 7-14
```

### Validate Tiles

Before submitting, run the tile validator:

```bash
# Quick decode check
python scripts/validate_ozt2_tiles.py --dir ./output/ --quick

# Full roundtrip validation with RMSE
python scripts/validate_ozt2_tiles.py --dir ./output/ --mode full --max-rmse 1.0
```

### Prepare Contribution Bundle

```bash
oz ingest \
    --dataset ./my_contribution/ \
    --name my_region_v1 \
    --description "10m Copernicus GLO-30 coverage for the Alps region" \
    --license CC-BY-NC-SA-4.0 \
    --source-url "https://registry.openentrance.io/imagery/view/2579-Copernicus_DSM_30m_GLOBE" \
    --contributor "Your Name <your@email.org>" \
    --output ./contributions/
```

This creates:

```
contributions/
└── my_region_v1/
    ├── manifest.json          # Dataset metadata
    └── tiles/
        ├── N35W106.ozt2
        ├── N35W105.ozt2
        └── ...
```

---

## Step 3: Submit a Pull Request

### Fork and Clone

```bash
git clone https://github.com/YOUR_HANDLE/openzenith-data.git
cp -r ./contributions/my_region_v1 ./openzenith-data/
cd openzenith-data
```

### Commit and Push

```bash
git checkout -b contrib/my-region-v1
git add my_region_v1/
git commit -m "Add Alps region 30m coverage (Copernicus GLO-30)"
git push origin contrib/my-region-v1
```

### Open a Pull Request

Open a PR at https://github.com/openzenith/openzenith-data with:

- **Title**: `Add [region] [resolution] coverage from [source]`
- **Description**: Bounding box, tile count, source URL, license
- **Manifest**: Attach or link to your `manifest.json`

---

## OZT2 Format

The OpenZenith Tile Format v2 (OZT2) is a custom binary format optimized for elevation data:

```
[HEADER - 6 bytes][COMPRESSED DATA]

Header:
  Offset 0  2  min_elevation   Tile minimum (int16, meters)
  Offset 2  2  elev_range      Elevation range: max - min (uint16)
  Offset 4  1  bits_per_pixel  Quantization bits (8–16)
  Offset 5  1  flags           Predictor + compressor

Predictor (bits 0-1 of flags):
  0 = None (raw values)
  1 = Left (cumulative sum along rows)
  2 = Gradient (left + above - upper-left) — recommended

Compressor (bits 2-3 of flags):
  0 = Brotli (recommended, native browser support)
  1 = Zstd
  2 = Zlib
```

### Why OZT2?

- **~93% smaller** than Terrarium PNG tiles
- **Native browser decode**: Uses `DecompressionStream("br")` — no WASM
- **Adaptive bit depth**: 8-bit for flat terrain, 16-bit only where needed
- **Gradient prediction**: Produces near-zero residuals for smooth terrain

---

## Dataset Priority

When multiple datasets cover the same region, OpenZenith uses this priority order:

```
1. USGS 3DEP (10m CONUS)          — highest priority for USA
2. ArcticDEM (2m/10m Arctic)       — for >60°N
3. Copernicus GLO-30 (30m global)  — primary global source
4. SRTM 30m (merged, v1 legacy)   — fallback global
5. GEBCO 2025 (450m ocean)         — bathymetry only
```

Contributors should specify their source priority when submitting.

---

## Contact

For questions about contributing data:
- **GitHub Issues**: https://github.com/openzenith/openzenith-data/issues
- **Dataset Repository**: https://github.com/openzenith/openzenith-data
