# openzenith-data

Community-contributed elevation tiles for OpenZenith.

**Live dataset**: https://openzenith.cyopsys.com · **SDK**: `pip install openzenith`

---

## Overview

This repository hosts the v2 elevation dataset in [OZT2 format](#ozt2-format) — a custom binary format that achieves ~93% compression ratios compared to standard Terrarium PNG tiles.

OZT2 tiles are contributed by the community, validated, and merged into the global coverage map served by the OpenZenith API.

---

## Dataset Structure

```
openzenith-data/
├── README.md
├── manifest.json                 # Global dataset manifest
├── tiles/
│   ├── z0/
│   ├── z1/
│   ├── ...
│   └── z14/
├── contributions/                # Pending / reviewed submissions
│   └── [region_name]/
│       ├── manifest.json
│       └── tiles/
└── scripts/
    ├── validate_tiles.py
    └── merge_contributions.py
```

### Tile Storage

Tiles are stored as flat files with no archive extraction required:

```
tiles/z{z}/{x}/{y}.ozt2
```

Examples:
```
tiles/z10/163/395.ozt2   # Mt. Everest area
tiles/z7/20/49.ozt2      # CONUS (zoom 7)
```

### Manifest Format

Each contribution includes a `manifest.json`:

```json
{
  "name": "alps-30m-v1",
  "version": "1.0.0",
  "description": "Alps region 30m coverage from Copernicus GLO-30",
  "license": "CC-BY-NC-SA-4.0",
  "source_url": "https://registry.openentrance.io/imagery/view/2579-Copernicus_DSM_30m_GLOBE",
  "contributor": "Jane Doe <jane@example.org>",
  "created": "2026-08-01T00:00:00Z",
  "tile_format": "ozt2",
  "total_tiles": 142,
  "bbox": [5.0, 45.0, 17.0, 48.0],
  "tiles": [
    {
      "file": "N45E005.ozt2",
      "coverage": [45, 5, 46, 6],
      "bits": 12,
      "rmse": 0.3,
      "size_bytes": 847
    }
  ]
}
```

---

## OZT2 Format

The OpenZenith Tile Format v2 (OZT2) achieves ~93% storage reduction over Terrarium PNG.

```
[HEADER - 6 bytes][COMPRESSED DATA]

Header (6 bytes, little-endian):
  0  2  min_elevation   int16  Tile minimum elevation (meters)
  2  2  elev_range      uint16 Elevation range: max - min (meters)
  4  1  bits_per_pixel  uint8  Quantization bit depth (8–16)
  5  1  flags           uint8  Predictor (bits 0-1) + compressor (bits 2-3)

Body: Brotli-compressed gradient-predicted int16 residuals
  - Predictor: p[i,j] = left + above - upper_left
  - Residuals: actual - predicted
  - Compressor: Brotli quality 11

Decode in Python:
  from openzenith.tile_format_v2 import decode
  elevation, meta = decode(tile_bytes)

Decode in TypeScript (browser):
  import { decodeOZT2 } from './ozt2_decode';
  const { elevation } = await decodeOZT2(arrayBuffer);
```

---

## Data Priority

When multiple tiles cover the same area, the following priority applies:

| Priority | Source | Resolution | Notes |
|----------|--------|------------|-------|
| 1 | USGS 3DEP | 10m | USA only |
| 2 | ArcticDEM | 2m / 10m | >60°N latitude |
| 3 | Copernicus GLO-30 | 30m | Global land |
| 4 | SRTM 30m (v1) | 30m | Legacy fallback |
| 5 | GEBCO 2025 | 450m | Ocean bathymetry |

---

## Contributing

See [CONTRIBUTING.md](https://github.com/openzenith/openzenith-data/blob/main/docs/CONTRIBUTING.md) for the full workflow.

Quick start:

```bash
# 1. Install OpenZenith CLI
pip install openzenith

# 2. Encode your DEM files to OZT2
oz encode --input ./my_dem_tiles/ --output ./output/ --name my_region --validate

# 3. Prepare contribution bundle
oz ingest --dataset ./my_dem_tiles/ --name my_region \
    --description "My region coverage" \
    --license CC-BY-NC-SA-4.0 \
    --contributor "Your Name <you@example.org>" \
    --source-url "https://your.source.url" \
    --output ./contributions/

# 4. Submit PR to openzenith-data
```

---

## License

Individual contributions retain their source license. The aggregated dataset is available under [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/).

---

## API

Tiles are served via the OpenZenith API:

```
https://openzenith.cyopsys.com/api/dem-tile/{z}/{x}/{y}?format=ozt2
```

See the [API documentation](https://openzenith.cyopsys.com/docs) for details.
