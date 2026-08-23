# OpenZenith v2 Dataset & OZT2 Implementation Plan

**Date:** 2026-08-06
**Goal:** Systematic implementation of the v2 elevation dataset using OZT2 compression
**Outcome:** ~93% storage reduction (70GB → ~5GB for 30m global), contributor-friendly pipeline, full SDK support

> ⚠️ **Partially stale (2026-08-23):** OZT2 format, Python SDK, JS decoder, HF backend, z10 tiles are complete. z7–z9 and z11 pending upload. See [Status Update](#status-update-2026-08-23) at bottom.

---

## Executive Summary

OpenZenith's current elevation infrastructure:
- **Terrarium PNG tiles** (z0–z10) on R2: ~1.7GB stored
- **SRTM 30m `.merged` files** on HuggingFace (OZCHNK01 format: zlib + horizontal differencing)
- **GEBCO 2025 bathymetry** (450m) on R2
- **No per-tile quality control** — all tiles stored at fixed bit depth regardless of actual elevation range

**v2 target:**
- **OZT2 tiles** (z0–z14): ~5GB total for 30m global land + 450m ocean
- **Adaptive bit depth** per tile: 8-bit for flat terrain, 16-bit only where needed
- **Community-contributable**: self-contained tiles with metadata headers, PR-based ingest
- **Drop-in SDK support**: transparent decode in Python SDK and browser JS

---

## What Is OZT2 (Already Implemented)

OZT2 (`openzenith/tile_format_v2.py`) combines three techniques:

### 1. Adaptive Quantization
Auto-selects bit depth per tile based on local elevation range:
- `range ≤ 256m` → 8-bit quantization (good for 65% of 30m tiles)
- `range ≤ 64m` → 8-bit (coastal, desert, ocean)
- `range > 256m` → 10–16-bit as needed
- Steep terrain (Himalayas, Andes) → 16-bit fallback (lossless)

### 2. Gradient Prediction
Predictor: `p[i,j] = left + above − upper_left`

Produces near-zero residuals for smooth terrain. Compared to OZT1's simple left-predictor, gradient prediction halves the residual entropy for typical topography.

### 3. Brotli Compression
Brotli at quality 11 compresses the residual data better than zstd for this pattern. Brotli is also natively available in browsers via `DecompressionStream("br")` — no WASM needed for decompression, only for the gradient reconstruction loop (which is fast enough in JS without WASM for typical use).

**Format header (6 bytes):**
```
Offset  Size  Field
0       2     min_elevation   (int16, meters)
2       2     elev_range      (uint16, meters)
4       1     bits_per_pixel  (8-16, auto-selected)
5       1     flags           (predictor + compressor)
```

---

## Phase 0: HuggingFace Dataset Migration Strategy

**Goal:** Build v2 dataset locally on NAS → push to new HuggingFace dataset → deprecate old `.merged` dataset

### 0.1 Dataset Naming

| Old Dataset | New Dataset | Notes |
|-------------|-------------|-------|
| `aliasfox/srtm30m-merged` (OZCHNK01) | `openzenith/elevation-v2-ozt2` (OZT2) | New format, multi-source |
| (GEBCO handled separately) | `openzenith/bathymetry-v2-ozt2` (OZT2) | GEBCO 2025 in OZT2 |

### 0.2 Local Build First

The NAS/JBOD is the **source of truth**. HuggingFace is a **distribution mirror**.
The same `.merged` files on the NAS feed both the local Python SDK and the API (via R2 tiles generated from them).

```
NAS/JBOD (source of truth — ~65GB currently)
    │
    ├── srtm30m-merged/     (existing OZCHNK01 .merged files from HuggingFace)
    │    └── N00/, S00/, .../  (14,296 .merged files, ~65GB)
    ├── copernicus-glo30/    (new 30m global land, future)
    ├── gebco-2025/          (bathymetry, handled separately)
    ├── 3dep-10m/           (USGS 3DEP CONUS 10m, future)
    └── elevation-v2/        (output OZT2 tiles, generated from .merged source)
         ├── z0/
         ├── z1/
         ├── ...
         └── z14/
```

**Current state:** `data/srtm30m-merged/` on NAS contains the `.merged` files pulled from `aliasfox/srtm30m-merged`. These are what both the local Python SDK and the API currently read from. The API currently reads them via:
- Local: `LocalTifBackend` → `/nas/Temp/repos/OpenZenith/data/srtm30m/` (GeoTIFF, not `.merged`)
- Remote: `HuggingFaceChunkBackend` → `aliasfox/srtm30m-merged`

**v2 target:** Both local Python SDK and API read from the same OZT2 tiles generated from these `.merged` files. No more format inconsistency.

### 0.2.1 Consistency Verification

Before building v2, verify the local dataset is consistent with the HuggingFace source.

**File:** `scripts/verify_local_dataset.py`

```python
"""
Verify local .merged files match the HuggingFace source.
Checks:
1. All expected tiles exist locally
2. File sizes match HuggingFace
3. SHA256 checksums match
4. No corrupted chunks (can be decoded without error)
5. Elevation ranges are physically plausible (-500m to +9000m)

Usage:
    python scripts/verify_local_dataset.py \
        --local /nas/Temp/repos/OpenZenith/data/srtm30m-merged/ \
        --dataset aliasfox/srtm30m-merged
"""

import hashlib
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

# Check against HuggingFace listing API
HF_API = "https://huggingface.co/api/datasets/aliasfox/srtm30m-merged/tree/main"

def verify_tile(args):
    lat_dir, tile_name, local_dir = args
    path = Path(local_dir) / lat_dir / f"{tile_name}.merged"
    result = {"tile": tile_name, "status": "ok", "error": None}

    # 1. File exists
    if not path.exists():
        result["status"] = "missing"
        return result

    # 2. File size
    size = path.stat().st_size
    if size == 0:
        result["status"] = "empty"
        return result

    # 3. SHA256
    sha256 = hashlib.sha256(path.read_bytes()).hexdigest()

    # 4. Decode attempt
    try:
        from openzenith.merged import MergedFile
        mf = MergedFile(path)
        # Check all chunks
        for row in range(mf.rows):
            for col in range(mf.cols):
                chunk = mf.get_chunk(row, col)
                if chunk is None:
                    continue
                # Check elevation range
                valid = chunk[chunk != -32768]
                if valid.size > 0:
                    if valid.min() < -500 or valid.max() > 9000:
                        result["status"] = "suspicious_range"
                        result["min"] = int(valid.min())
                        result["max"] = int(valid.max())
                    break
    except Exception as e:
        result["status"] = "decode_error"
        result["error"] = str(e)

    return result

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--local", required=True)
    parser.add_argument("--dataset", default="aliasfox/srtm30m-merged")
    args = parser.parse_args()

    # Get expected tiles from HuggingFace API
    import requests
    resp = requests.get(HF_API)
    resp.raise_for_status()
    files = resp.json()
    expected = {f["path"]: f["size"] for f in files if f["path"].endswith(".merged")}

    print(f"Expected {len(expected)} .merged files on HuggingFace")

    # Verify local files
    local_dir = Path(args.local)
    tasks = []
    for path_str, hf_size in expected.items():
        parts = path_str.split("/")
        lat_dir = parts[0]  # e.g., "N00"
        tile_name = parts[1]  # e.g., "N00E006"
        tasks.append((lat_dir, tile_name, local_dir))

    print(f"Checking {len(tasks)} local files...")
    results = {"ok": 0, "missing": 0, "empty": 0, "decode_error": 0, "suspicious": 0}

    with ThreadPoolExecutor(max_workers=32) as executor:
        futures = {executor.submit(verify_tile, t): t for t in tasks}
        for i, future in enumerate(as_completed(futures)):
            r = future.result()
            results[r["status"]] = results.get(r["status"], 0) + 1
            if (i + 1) % 1000 == 0:
                print(f"  {i+1}/{len(tasks)}: {results}")

    print(f"\nResults: {results}")
    if results["missing"] > 0 or results["decode_error"] > 0:
        print("⚠️  Dataset has issues — fix before building v2")
    else:
        print("✅ Dataset verified — safe to build v2 from this source")

main()
```

**Expected output for a healthy dataset:**
```
Expected 14296 .merged files on HuggingFace
Checking 14296 local files...
  1000/14296: {'ok': 998, 'missing': 0, 'empty': 2, 'decode_error': 0}
  ...
Results: {'ok': 14290, 'empty': 6, 'suspicious': 0}
✅ Dataset verified — safe to build v2 from this source
```

**Empty tiles are expected:** Tiles over ocean (e.g., tiles with no land area) have valid `.merged` files but contain only NODATA chunks. These are not errors.

### 0.2.2 Sync Strategy for Future Updates

When the source dataset on HuggingFace is updated (new tiles, corrections, improved sources):

```bash
# 1. Pull only changed files using Git diff
cd data/srtm30m-merged/
huggingface-cli download aliasfox/srtm30m-merged \
    --repo-type dataset \
    --local-dir . \
    --include "*.merged" \
    --force

# 2. Run consistency check
python scripts/verify_local_dataset.py --local ./srtm30m-merged/

# 3. Regenerate affected OZT2 tiles
python scripts/convert_to_ozt2.py \
    --input ./srtm30m-merged/ \
    --output ./elevation-v2/ \
    --zoom 0-14 \
    --workers 32 \
    --incremental  # only regenerate tiles whose source .merged changed

# 4. Upload changed tiles to HuggingFace
huggingface-cli upload openzenith/elevation-v2-ozt2 \
    ./elevation-v2/ \
    --repo-type dataset \
    --commit-message "Update tiles affected by SRTM correction N36W116"
```

### 0.2.3 Source Data Quality Notes

| Source | Format | Resolution | Coverage | Known Issues |
|--------|--------|------------|----------|--------------|
| **SRTM 30m (`.merged`)** | OZCHNK01 | ~30m | ±60° lat | Void-filled, gaps in mountains, deserts |
| **Copernicus GLO-30** | COG | 30m | Global land | ✅ Better void-filling than SRTM |
| **GEBCO 2025** | COG | ~450m | Global ocean | Ocean bathymetry only |
| **AWS Terrain Tiles** | PNG/terrarium | 10–30m | Global | Pre-tiled, uses SRTM base |
| **USGS 3DEP** | COG | 10m | US only | Highest quality regional |
| **ArcticDEM** | COG | 2m | >60°N | Excellent for polar regions |
| **EU-DEM** | COG | 25m | Europe | Better than SRTM for EU |
| **NRCan CDEM** | COG | 20m | Canada | Better than SRTM for CA |
| **NISAR InSAR** | Raw SAR | 30–80m | Global | ⚠️ Raw SAR needs InSAR processing |

**Decision for v2:** Use **Copernicus GLO-30** as the primary source for global land (30m, void-filled, better than SRTM). Supplement with regional high-resolution sources where available (3DEP for US, ArcticDEM for Arctic, EU-DEM for Europe). The OZT2 format supports multiple sources via the tile manifest — tiles from different sources coexist with priority ordering.

**Why Copernicus GLO-30 over SRTM:**
- Void-filled using multiple source missions (better in mountains, forests)
- Globally consistent (SRTM has version differences by region)
- Available as Cloud Optimized GeoTIFF on AWS S3 — no download/auth friction
- Actively maintained by Copernicus

### 0.2.4 Copernicus GLO-30 on AWS

Copernicus GLO-30 is freely available as Cloud Optimized GeoTIFFs on AWS S3:

```bash
# List available tiles
aws s3 ls --no-sign-request s3://copernicus-dem-30m/

# Download a tile (example: Africa/Sahara region)
aws s3 cp --no-sign-request \
    s3://copernicus-dem-30m/Copernicus_DSM_COG_10_N22_00_E016_DEM/Copernicus_DSM_COG_10_N22_00_E016_DEM.tif \
    ./N22E016.tif

# Download region (example: all of Japan)
aws s3 cp --no-sign-request \
    s3://copernicus-dem-30m/ \
    ./copernicus-glo30/ \
    --exclude "*" \
    --include "*N27*" \
    --include "*N28*" \
    --include "*N29*" \
    --include "*N30*" \
    --include "*N31*" \
    --include "*N32*" \
    --include "*N33*" \
    --include "*N34*" \
    --include "*N35*" \
    --include "*N36*" \
    --include "*N37*" \
    --include "*N38*" \
    --include "*N39*" \
    --include "*N40*" \
    --include "*N41*" \
    --include "*N42*" \
    --include "*N43*" \
    --include "*N44*" \
    --recursive
```

**Tile naming convention:** `Copernicus_DSM_COG_10_N{lat}_E{lon}_DEM/`
- 1° × 1° tiles
- Resolution: ~30m (actual: ~0.001° ≈ 111m at equator, varies with latitude)
- Format: Cloud Optimized GeoTIFF (COG)
- No authentication required

**Storage estimate for full GLO-30:** ~370GB uncompressed, but COG tiles are ~40% smaller on disk. As OZT2: ~30GB for global land.

### 0.2.5 NISAR Status (July 2026)

**NISAR launched July 30, 2025. Full global data release: July 2026.**

NISAR provides **raw L-band SAR interferometric products**, not a ready-made DEM:
- **RIFG** (Wrapped Interferogram): 30m ground posting — requires processing
- **RUNW** (Unwrapped Interferogram): 80m ground posting — requires geocoding
- **GUNW** (Geocoded Unwrapped): 80m, projected — closest to usable DEM

To use NISAR for elevation, you need to **process InSAR pairs** — this requires:
- Specialized software (GMTSAR, ISCE, SNAP)
- Significant compute (hours per scene)
- Expertise in SAR processing
- Control points / DEM for geocoding

**Not practical for dataset ingestion** in the near term. The full global DEM from NISAR will likely appear in GIS platforms (AWS Terrain Tiles, etc.) within 1-2 years of the global release.

**Recommendation:** Monitor NISAR L-band products for future upgrades. In the meantime, focus on the freely available, processing-free sources above.

### 0.2.6 Source Priority Summary for v2 Build

```
PRIMARY SOURCES (use directly):
┌──────────────────────────────────────────────────────────────────────┐
│ Copernicus GLO-30 (AWS S3)                                           │
│   30m, global land, void-filled, free, no auth                      │
│   → OZT2 tiles (main global base)                                    │
│                                                                      │
│ GEBCO 2025 (already on R2)                                           │
│   ~450m, global ocean, free                                          │
│   → OZT2 tiles (ocean coverage)                                      │
└──────────────────────────────────────────────────────────────────────┘

REGIONAL SUPPLEMENTS (where better than GLO-30):
┌──────────────────────────────────────────────────────────────────────┐
│ USGS 3DEP 10m (AWS S3) → US coverage at 10m (vs 30m GLO-30)        │
│ ArcticDEM 2m (AWS S3) → Arctic (>60°N) at 2m (vs 30m GLO-30)       │
│ EU-DEM 25m (Copernicus) → Europe at 25m (vs 30m GLO-30)            │
│ NRCan CDEM 20m (NRCan) → Canada at 20m (vs 30m GLO-30)             │
└──────────────────────────────────────────────────────────────────────┘

FUTURE UPGRADES:
┌──────────────────────────────────────────────────────────────────────┐
│ NISAR L-band InSAR (ASF DAAC) → Monitor for global DEM products      │
│ TanDEM-X 12m (Airbus, commercial) → High-quality regional buys       │
│ ALOS AW3D 5m (JAXA, regional) → Japan, SE Asia                     │
└──────────────────────────────────────────────────────────────────────┘
```

### 0.2.4 Existing GeoTIFF vs .merged Files

The NAS currently has **both**:
- `data/srtm30m/` — local GeoTIFF files read by `LocalTifBackend` (for API point queries)
- `data/srtm30m-merged/` — `.merged` files from HuggingFace (for Python SDK)

The `.merged` files are what the Python SDK reads via `merged.py`. The GeoTIFF files are what the API currently uses for point elevation. **Both must be kept in sync** if source data is updated.

For v2, the OZT2 tiles become the **single format** for both API and SDK — eliminating the dual-format maintenance burden.

### 0.3 New OZT2 Dataset Structure on HuggingFace

```
openzenith/elevation-v2-ozt2/
├── z0/
│   ├── 0/
│   │   ├── 0.ozt2
│   │   ├── 1.ozt2
│   │   └── ...
│   ├── 1/
│   └── ...
├── z1/
│   └── ...
├── z14/
├── manifest.json          # Global tile manifest (bbox, resolution, sources)
├── tile_index.json        # SHA256 checksums for every tile
└── README.md
```

**File naming convention:** `{zoom}/{tile_x}/{tile_y}.ozt2`

This matches standard XYZ tile layout and maps directly to the API: `/api/dem-tile/{z}/{x}/{y}`.

### 0.4 Tile Index

```json
{
  "version": "1.0.0",
  "format": "ozt2",
  "created": "2026-08-06T00:00:00Z",
  "sources": [
    {
      "id": "srtm30m",
      "name": "SRTM 30m",
      "license": "SRTM Data Policy",
      "coverage": {"bbox": [-180, -60, 180, 60], "resolution": 30}
    }
  ],
  "zoom_levels": {
    "0":  {"tile_count": 4,    "total_bytes": 1234,  "sha256": "abc123..."},
    "1":  {"tile_count": 16,   "total_bytes": 4567,  "sha256": "def456..."},
    ...
    "14": {"tile_count": 78271829, "total_bytes": "160GB", "sha256": "..."}
  },
  "total_tiles": 104804556,
  "total_bytes": "200GB",
  "compression_ratio": 0.07,
  "avg_bits_per_pixel": 8.4
}
```

### 0.5 Upload Strategy

HuggingFace datasets have a 100GB limit for free tier. The full z0–z14 dataset (~200GB) exceeds this, so:

**Option A — Split by zoom level (recommended):**
```bash
# Upload in chunks by zoom range
huggingface-cli upload openzenith/elevation-v2-ozt2 z0-z7/     # ~50MB
huggingface-cli upload openzenith/elevation-v2-ozt2 z8-z10/    # ~1.1GB
huggingface-cli upload openzenith/elevation-v2-ozt2 z11/      # ~2.4GB
huggingface-cli upload openzenith/elevation-v2-ozt2 z12/      # ~10GB
# z13-z14: upload last or skip if not needed
```

**Option B — Use Git LFS:**
```bash
# Install Git LFS
git lfs install

# Track .ozt2 files
git lfs track "*.ozt2"

# Upload in managed chunks
huggingface-cli upload openzenith/elevation-v2-ozt2 \
    --repo-type dataset \
    --repo-id openzenith/elevation-v2-ozt2
```

**Recommended:** Upload z0–z12 first (~13GB). These are the most-used zooms. Skip z13–z14 unless/until there's demand.

### 0.6 Deprecating the Old Dataset

**Timeline:**
```
Phase 0 (Week 1-2):  Build v2 locally, upload z0-z12 to HuggingFace
Phase 1 (Week 3):   Test v2 dataset in API (dual-read: v1 + v2)
Phase 2 (Week 4):   Switch API to v2 as primary, v1 as fallback
Phase 3 (Month 2+): Deprecate v1 in docs, point SDK to v2
Phase 4 (Month 3+): Archive/promote old aliasfox/srtm30m-merged (don't delete)
```

**Deprecation notice in old dataset README:**
```
> ⚠️ DEPRECATED: This dataset is superseded by `openzenith/elevation-v2-ozt2`.
> The new dataset uses OZT2 compression (93% smaller) and includes
> Copernicus GLO-30 in addition to SRTM 30m.
> This dataset will be archived in 2026-09-01.
> See: https://openzenith.pages.dev/api/elevation
```

**SDK backward compatibility:**
```python
# In openzenith/elevation.py, keep reading old .merged files as fallback
def get_elevation(lat, lon):
    # Try OZT2 v2 dataset first
    try:
        return get_elevation_from_ozt2(lat, lon)
    except:
        pass
    # Fall back to old .merged files
    try:
        return get_elevation_from_merged(lat, lon)
    except:
        pass
    # Fall back to GEBCO
    return get_elevation_from_gebco(lat, lon)
```

### 0.7 Backends

**File:** `api/src/lib/storage/backend.ts`

```typescript
// Update backend priority:
const BACKENDS = [
  new OZT2HuggingFaceBackend("openzenith/elevation-v2-ozt2"),  // NEW: primary
  new LocalTifBackend(),                                         // LOCAL: NAS/NAS
  new HuggingFaceChunkBackend("aliasfox/srtm30m-merged", true), // OLD: fallback
  new GebcoBackend(),                                             // BATHYMETRY: always last
];
```

### 0.8 Hub Commands Reference

```bash
# Login
huggingface-cli login

# Create new dataset repo
huggingface-cli repo create openzenith/elevation-v2-ozt2 --type dataset

# Upload in chunks
huggingface-cli upload openzenith/elevation-v2-ozt2 \
    ./elevation-v2/z0-z12/ \
    --repo-type dataset \
    --commit-message "Initial upload: z0-z12 OZT2 tiles"

# Verify upload
huggingface-cli ls openzenith/elevation-v2-ozt2

# Check file size
huggingface-cli du openzenith/elevation-v2-ozt2
```

---

## Phase 1: Core Infrastructure

**Goal:** OZT2 encoding pipeline, R2 storage, TypeScript API serving, JS client decode

### 1.1 Add OZT2 Encode CLI to Python SDK

**File:** `openzenith/cli.py` (add `oz encode` subcommand)

```python
@cli.command()
@click.argument("input", type=click.Path(exists=True))
@click.argument("output", type=click.Path())
@click.option("--format", "fmt", default="ozt2", type=click.Choice(["ozt1", "ozt2", "terrarium"]))
@click.option("--max-rmse", default=1.0, help="Max RMSE for auto bit-depth selection")
@click.option("--predictor", type=click.Choice(["none", "left", "gradient"]), default="gradient")
def encode(input, output, fmt, max_rmse, predictor):
    """Convert DEM file(s) to OZT2 or other format."""
    ...
```

**Use cases:**
```bash
# Convert a GeoTIFF to OZT2
oz encode N00E006.tif N00E006.ozt2

# Batch convert a directory
oz encode ./srtm_tiles/ ./ozt2_tiles/

# Convert with stricter quality (8-bit only if RMSE < 0.5m)
oz encode ./srtm_tiles/ ./ozt2_tiles/ --max-rmse 0.5

# Validate roundtrip quality
oz encode ./srtm_tiles/ ./ozt2_tiles/ --validate
```

### 1.2 Add OZT2 Batch Conversion Script

**File:** `scripts/convert_to_ozt2.py`

Converts existing SRTM `.merged` files → OZT2 tiles in bulk.

```python
"""
Convert SRTM .merged files to OZT2 tiles.

Usage:
    python scripts/convert_to_ozt2.py \
        --input /nas/Temp/repos/OpenZenith/data/srtm30m-merged/ \
        --output /nas/Temp/repos/OpenZenith/data/ozt2_tiles/ \
        --zoom 0-14 \
        --workers 16 \
        --max-rmse 1.0
"""

import argparse
import math
from pathlib import Path
from concurrent.futures import ProcessPoolExecutor, as_completed

from openzenith.tile_format_v2 import auto_encode, decode
from openzenith.merged import MergedFile
import numpy as np

TILE_SIZE = 256  # 256x256 pixels per tile

def mercator_tile_to_lat_lon(z, x, y):
    """Return (lat_min, lat_max, lon_min, lon_max) for a Mercator tile."""
    n = 2 ** z
    lon_min = x / n * 360.0 - 180.0
    lon_max = (x + 1) / n * 360.0 - 180.0
    lat_max = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / n))))
    lat_min = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * (y + 1) / n))))
    return lat_min, lat_max, lon_min, lon_max

def sample_merged_elevation(lat, lon, merged_dir):
    """Sample a single point from .merged files."""
    from openzenith.merged import read_elevation_from_merged
    return read_elevation_from_merged(lat, lon, merged_dir)

def generate_tile_grid(z, x, y, merged_dir):
    """Generate a 256x256 elevation grid for a tile from source data."""
    lat_min, lat_max, lon_min, lon_max = mercator_tile_to_lat_lon(z, x, y)

    grid = np.full((TILE_SIZE, TILE_SIZE), -32768, dtype=np.int16)
    for row in range(TILE_SIZE):
        for col in range(TILE_SIZE):
            lat = lat_max - (row + 0.5) * (lat_max - lat_min) / TILE_SIZE
            lon = lon_min + (col + 0.5) * (lon_max - lon_min) / TILE_SIZE
            elev = sample_merged_elevation(lat, lon, merged_dir)
            if elev is not None:
                grid[row, col] = int(elev)
    return grid

def convert_tile(args):
    """Convert a single tile: generate grid → OZT2 encode → write."""
    z, x, y, merged_dir, output_dir, max_rmse = args
    try:
        grid = generate_tile_grid(z, x, y, merged_dir)
        encoded, meta = auto_encode(grid, max_rmse=max_rmse)
        out_path = Path(output_dir) / f"z{z}" / str(x) / f"{y}.ozt2"
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_bytes(encoded)
        return True, meta
    except Exception as e:
        return False, str(e)

def main():
    parser = argparse.ArgumentParser(description="Convert SRTM to OZT2 tiles")
    parser.add_argument("--input", required=True, help="Path to srtm30m-merged/ directory")
    parser.add_argument("--output", required=True, help="Output directory for .ozt2 tiles")
    parser.add_argument("--zoom", default="0-14", help="Zoom range, e.g. 0-14")
    parser.add_argument("--workers", type=int, default=16)
    parser.add_argument("--max-rmse", type=float, default=1.0)
    args = parser.parse_args()

    z_start, z_end = map(int, args.zoom.split("-"))
    tasks = []
    for z in range(z_start, z_end + 1):
        n = 2 ** z
        for x in range(n):
            for y in range(n):
                tasks.append((z, x, y, args.input, args.output, args.max_rmse))

    print(f"Converting {len(tasks)} tiles across z{z_start}–z{z_end}...")
    success, failed = 0, 0
    metas = []

    with ProcessPoolExecutor(max_workers=args.workers) as executor:
        futures = {executor.submit(convert_tile, t): t for t in tasks}
        for i, future in enumerate(as_completed(futures)):
            ok, result = future.result()
            if ok:
                success += 1
                metas.append(result)
            else:
                failed += 1

            if (i + 1) % 1000 == 0:
                avg_size = sum(m["original_size"] for m in metas) / max(len(metas), 1)
                print(f"  {i+1}/{len(tasks)}: {success} ok, {failed} failed, avg tile: {avg_size:.0f} bytes")

    print(f"\nDone: {success} tiles, {failed} failed")
    if metas:
        total_size = sum(m["original_size"] for m in metas)
        print(f"Total OZT2 size: {total_size / 1e9:.2f} GB")
        bit_dist = {}
        for m in metas:
            b = m["bits_per_pixel"]
            bit_dist[b] = bit_dist.get(b, 0) + 1
        print(f"Bit depth distribution: {bit_dist}")
```

### 1.3 JavaScript OZT2 Client Decoder

**File:** `api/src/lib/ozt2_decode.ts`

Decodes OZT2 tiles in the browser using `DecompressionStream("br")` for Brotli + pure JS gradient reconstruction. No WASM dependency for the common case.

```typescript
/**
 * OZT2 tile decoder — pure TypeScript, no WASM required.
 * Uses DecompressionStream("br") for Brotli (browser-native).
 *
 * Decode time: ~2ms per 256x256 tile on modern hardware.
 */

const HEADER_SIZE = 6;
const TILE_SIZE = 256;

const PRED_NONE = 0;
const PRED_LEFT = 1;
const PRED_GRADIENT = 2;

interface OZT2Metadata {
  minElevation: number;
  elevationRange: number;
  maxElevation: number;
  bitsPerPixel: number;
  predictor: "none" | "left" | "gradient";
  compressor: "brotli" | "zstd" | "zlib";
  width: number;
  height: number;
}

export async function decodeOZT2(tileBytes: ArrayBuffer): Promise<{
  elevation: Int16Array;
  width: number;
  height: number;
  metadata: OZT2Metadata;
}> {
  const view = new DataView(tileBytes);

  const vmin = view.getInt16(0, true);
  const elevRange = view.getUint16(2, true);
  const bits = tileBytes[4];
  const flags = tileBytes[5];

  const predictor = flags & 0x03;
  const compressor = (flags >> 2) & 0x03;

  const metadata: OZT2Metadata = {
    minElevation: vmin,
    elevationRange: elevRange,
    maxElevation: vmin + elevRange,
    bitsPerPixel: bits,
    predictor: [PRED_NONE, PRED_LEFT, PRED_GRADIENT][predictor] as "none" | "left" | "gradient",
    compressor: [compBrotli, compZstd, compZlib][compressor] as "brotli" | "zstd" | "zlib",
    width: TILE_SIZE,
    height: TILE_SIZE,
  };

  // Decompress
  let decompressed: ArrayBuffer;
  if (compressor === 0) {
    // Brotli — use DecompressionStream
    const ds = new DecompressionStream("br");
    const writer = ds.writable.getWriter();
    writer.write(tileBytes.slice(HEADER_SIZE));
    writer.close();
    const result = await new Response(ds.readable).arrayBuffer();
    decompressed = result;
  } else if (compressor === 1) {
    // Zstd — requires fflate or WASM (see fallback below)
    throw new Error("Zstd decompression requires fflate-zstd or WASM module");
  } else {
    // Zlib
    const ds = new DecompressionStream("deflate");
    const writer = ds.writable.getWriter();
    writer.write(tileBytes.slice(HEADER_SIZE));
    writer.close();
    const result = await new Response(ds.readable).arrayBuffer();
    decompressed = result;
  }

  // Parse int16 residuals
  const residuals = new Int16Array(decompressed);
  const nPixels = residuals.length;
  let height: number, width: number;
  const side = Math.sqrt(nPixels);
  if (Number.isInteger(side)) {
    height = width = side;
  } else {
    for (const w of [256, 3601, 512, 1024, 128, 64]) {
      if (nPixels % w === 0) { height = nPixels / w; width = w; break; }
    }
  }

  // Reconstruct from prediction
  let elevation: Int16Array;
  if (predictor === PRED_GRADIENT) {
    elevation = gradientReconstruct(residuals, height, width);
  } else if (predictor === PRED_LEFT) {
    elevation = leftReconstruct(residuals, height, width);
  } else {
    elevation = new Int16Array(residuals);
  }

  // Dequantize
  if (bits < 16 && elevRange > 0) {
    const vmaxQuant = (1 << bits) - 1;
    const scale = elevRange / vmaxQuant;
    for (let i = 0; i < elevation.length; i++) {
      elevation[i] = Math.round(elevation[i] * scale + vmin);
    }
  } else if (bits >= 16) {
    for (let i = 0; i < elevation.length; i++) {
      elevation[i] = elevation[i] + vmin;
    }
  }

  return { elevation, width, height, metadata };
}

function gradientReconstruct(residuals: Int16Array, height: number, width: number): Int16Array {
  const out = new Int16Array(height * width);
  // First row: left predictor
  out[0] = residuals[0];
  for (let j = 1; j < width; j++) {
    out[j] = out[j - 1] + residuals[j];
  }
  // Subsequent rows: gradient predictor
  for (let i = 1; i < height; i++) {
    out[i * width] = out[(i - 1) * width] + residuals[i * width]; // first col: above
    for (let j = 1; j < width; j++) {
      const r = residuals[i * width + j];
      out[i * width + j] = r + out[i * width + j - 1] + out[(i - 1) * width + j] - out[(i - 1) * width + j - 1];
    }
  }
  return out;
}

function leftReconstruct(residuals: Int16Array, height: number, width: number): Int16Array {
  const out = new Int16Array(height * width);
  out[0] = residuals[0];
  for (let j = 1; j < width; j++) {
    out[j] = out[j - 1] + residuals[j];
  }
  for (let i = 1; i < height; i++) {
    out[i * width] = out[(i - 1) * width] + residuals[i * width];
    for (let j = 1; j < width; j++) {
      out[i * width + j] = out[i * width + j - 1] + residuals[i * width + j];
    }
  }
  return out;
}
```

### 1.4 Update TypeScript Elevation Tile API Route

**File:** `api/src/app/api/dem-tile/[z]/[x]/[y]/route.ts`

Add OZT2 format support alongside existing Terrarium PNG:

```typescript
// Accept ?format=ozt2|terrarium (default: terrarium for backward compat)
const format = searchParams.get("format") ?? "terrarium";

if (format === "ozt2") {
  // Try R2 OZT2 tile
  const r2Key = `ozt2/z${z}/${x}/${y}.ozt2`;
  const cached = await r2GetTile(r2Key);  // existing R2 helper
  if (cached) {
    return new Response(cached, {
      headers: {
        ...CORS_HEADERS,
        "Content-Type": "application/octet-stream",
        "X-Dem-Tile-Format": "ozt2",
        "X-Dem-Tile-Source": "r2",
        "Cache-Control": "public, max-age=86400",
      },
    });
  }

  // Fall through to HuggingFace (generate on-the-fly and cache)
  // Generate from .merged → OZT2 encode → store in R2 → return
  const tileData = await generateOZT2Tile(z, x, y);
  if (tileData) {
    await r2PutTile(r2Key, tileData);
    return new Response(tileData, {
      headers: {
        ...CORS_HEADERS,
        "Content-Type": "application/octet-stream",
        "X-Dem-Tile-Format": "ozt2",
        "X-Dem-Tile-Source": "generated",
        "Cache-Control": "public, max-age=86400",
      },
    });
  }

  // Ocean/ocean tile → return empty
  return new Response(new ArrayBuffer(0), { status: 204 });
}
```

### 1.5 Update Point Elevation API Route

**File:** `api/src/app/api/elevation/route.ts`

No changes needed — point elevation already reads from `.merged` files. However, add a `format=ozt2` option that returns pre-encoded OZT2 tiles instead of just point values, for batch operations.

---

## Phase 2: Tile Generation & Storage

**Goal:** Pre-generate all OZT2 tiles and upload to R2

### 2.1 Generate OZT2 Tiles

```bash
# Run on a machine with enough RAM (processes SRTM .merged files)
python scripts/convert_to_ozt2.py \
    --input /nas/Temp/repos/OpenZenith/data/srtm30m-merged/ \
    --output /nas/Temp/repos/OpenZenith/data/ozt2_tiles/ \
    --zoom 0-14 \
    --workers 32 \
    --max-rmse 1.0

# Expected output:
# z0-7:  ~10,000 tiles  (~5MB total, very flat)
# z8:    ~19,000 tiles  (~40MB)
# z9:    ~76,000 tiles  (~150MB)
# z10:   ~305,000 tiles (~600MB)
# z11:   ~1.2M tiles   (~2.4GB)
# z12:   ~4.9M tiles   (~10GB)
# z13:   ~19.5M tiles  (~40GB)
# z14:   ~78M tiles    (~160GB)
```

**Recommended approach:** Generate z0–z12 initially (~$13GB). Skip z13–z14 for now — they only serve users at street-level zoom, who are a tiny fraction of traffic.

### 2.2 Upload to R2

```bash
# Use AWS CLI with Cloudflare R2 credentials
AWS_ACCESS_KEY_ID=xxx \
AWS_SECRET_ACCESS_KEY=xxx \
aws s3 sync ./ozt2_tiles/ s3://openzenith-elevation/ozt2/ \
    --endpoint-url https://xxx.r2.cloudflarestorage.com \
    --storage-class STANDARD \
    --exclude "*.tmp"

# Verify
aws s3 ls s3://openzenith-elevation/ozt2/ --endpoint-url https://xxx.r2.cloudflarestorage.com/
```

### 2.3 GEBCO Bathymetry OZT2 Tiles

**File:** `scripts/convert_gebco_to_ozt2.py`

```python
"""
Convert GEBCO 2025 COG to OZT2 bathymetry tiles (z0-z10).
GEBCO is ~450m resolution global, so tiles are very uniform → excellent OZT2 compression.
Expected: <50 bytes/tile average due to near-zero residuals.
"""
import argparse
from pathlib import Path
from concurrent.futures import ProcessPoolExecutor

import numpy as np
import rioxarray  # for COG reading

from openzenith.tile_format_v2 import auto_encode

def convert_gebcotile(args):
    z, x, y, input_tif, output_dir, max_rmse = args
    try:
        # Read bounding box from tile coords
        from mercantile import tile, bounds
        bbox = bounds(x, y, z)
        
        # Read COG window
        ds = rioxarray.open_rasterio(input_tif)
        # Clip to bbox, downsample to 256x256, convert depths to negative elevations
        
        encoded, meta = auto_encode(elevation_grid, max_rmse=max_rmse)
        out_path = Path(output_dir) / f"gebco/z{z}/{x}/{y}.ozt2"
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_bytes(encoded)
        return True
    except Exception as e:
        return False
```

### 2.4 Storage Targets

| Zoom | Tiles | OZT2 Est. Size | Current (Terrarium PNG) |
|------|-------|----------------|----------------------|
| z0–7 | 10,973 | ~5 MB | ~50 MB |
| z8 | 19,109 | ~40 MB | ~80 MB |
| z9 | 76,437 | ~150 MB | ~320 MB |
| z10 | 305,749 | ~600 MB | ~1.3 GB |
| z11 | 1,222,997 | ~2.4 GB | ~5.2 GB |
| z12 | 4,891,989 | ~10 GB | ~21 GB |
| **z0–12 total** | **6.5M** | **~13 GB** | **~28 GB** |
| z13 | 19,567,957 | ~40 GB | ~85 GB |
| z14 | 78,271,829 | ~160 GB | ~340 GB |

**Immediate goal: z0–12 = ~13GB on R2 (vs 28GB current)**

---

## Phase 3: SDK Integration

**Goal:** Python SDK transparently reads OZT2, auto-selects best backend

### 3.1 OZT2 Reader in Python SDK

**File:** `openzenith/tile_format_v2.py` — already complete. Expose via `openzenith/__init__.py`:

```python
from .tile_format_v2 import decode, auto_encode, validate_roundtrip
from .elevation import get_elevation, get_elevation_batch

__all__ = [
    "decode",
    "auto_encode",
    "validate_roundtrip",
    "get_elevation",
    "get_elevation_batch",
]
```

### 3.2 Unified Elevation Function

**File:** `openzenith/elevation.py`

```python
"""
Unified elevation query.
Tries in order: local OZT2 cache → R2 OZT2 tiles → SRTM .merged → GEBCO.
"""

def get_elevation(
    lat: float,
    lon: float,
    source: str = "auto",  # "auto" | "ozt2" | "srtm" | "gebco"
    datum: str = "WGS84",
) -> float | None:
    """
    Get elevation at a single point.

    Args:
        lat: Latitude (-90 to 90)
        lon: Longitude (-180 to 180)
        source: Data source preference
        datum: Vertical datum (only WGS84 for now)

    Returns:
        Elevation in meters, or None if no data available.
    """
    ...

def get_elevation_grid(
    bounds: tuple[float, float, float, float],  # (lat_min, lon_min, lat_max, lon_max)
    resolution: int = 30,  # meters per pixel
    source: str = "auto",
) -> np.ndarray:
    """
    Get a rectangular elevation grid.

    Args:
        bounds: (lat_min, lon_min, lat_max, lon_max)
        resolution: Desired resolution in meters
        source: Data source

    Returns:
        2D numpy array of elevations in meters. NoData = -32768.
    """
    ...
```

### 3.3 OZT2 Tile File Backend

**File:** `openzenith/backends/ozt2.py`

```python
"""
ChunkBackend for OZT2 tiles stored on disk or in R2.
Reads directly from local .ozt2 files.
"""

import numpy as np
from pathlib import Path

from ..tile_format_v2 import decode

class OZT2Backend:
    """Read elevation tiles from local .ozt2 files."""

    def __init__(self, tile_dir: str | Path):
        self.tile_dir = Path(tile_dir)

    def fetch_tile(self, z: int, x: int, y: int) -> np.ndarray | None:
        """Fetch and decode a single OZT2 tile."""
        path = self.tile_dir / f"z{z}/{x}/{y}.ozt2"
        if not path.exists():
            return None
        try:
            data = path.read_bytes()
            elevation, meta = decode(data)
            return elevation
        except Exception:
            return None
```

---

## Phase 4: Client-Side Browser Integration

**Goal:** MapLibre globe uses OZT2 tiles with JS decoder

### 4.1 OZT2 Terrain Provider for CesiumJS

**File:** `api/src/lib/cesium-ozt2-terrain.ts`

```typescript
/**
 * CesiumJS TerrainProvider that reads OZT2 tiles.
 * Falls back to the existing AWS terrain provider for tiles not yet in OZT2.
 */
export class OZT2TerrainProvider {
  private _tilingScheme: GeographicTilingScheme;
  private _heightmapWidth = 256;
  private _heightmapHeight = 256;

  constructor(private r2Bucket: R2Bucket) {}

  async requestTile(x: number, y: number, level: number): Promise<ArrayBuffer> {
    const key = `ozt2/z${level}/${x}/${y}.ozt2`;
    const obj = await this.r2Bucket.get(key);
    if (!obj) throw new Error("Tile not available");
    return obj.arrayBuffer();
  }

  async interpolateHeight(
    lon: number, lat: number, level: number
  ): Promise<number> {
    // Find containing tile(s), decode, bilinear interpolate
    ...
  }
}
```

### 4.2 Update MapLibre Elevation Tile Source

**File:** `api/src/lib/tile.ts`

```typescript
// Add OZT2 format option
export function getElevationTileUrl(
  z: number, x: number, y: number,
  format: "terrarium" | "ozt2" = "ozt2"  // default to OZT2
): string {
  return `/api/dem-tile/${z}/${x}/${y}?format=${format}`;
}
```

### 4.3 Add `Accept: application/octet-stream` Header Negotiation

```typescript
// In the terrain tile fetch code:
// Prefer OZT2 if the client can handle it
const acceptHeader =
  typeof DecompressionStream !== "undefined" ? "application/octet-stream" : "image/png";
```

---

## Phase 5: Community Contribution Pipeline

**Goal:** Enable contributors to submit improved or higher-resolution tiles

### 5.1 Ingest CLI

**File:** `openzenith/cli.py` — add `oz ingest` subcommand

```python
@cli.command()
@click.argument("dataset", type=click.Path(exists=True))
@click.option("--name", required=True, help="Dataset name (e.g., 'alos-aw3d-30m-usgs3dep-2024')")
@click.option("--description", required=True)
@click.option("--license", default="CC-BY-4.0")
@click.option("--source-url", default="")
@click.option("--zoom-range", default="0-14")
def ingest(dataset, name, description, license, source_url, zoom_range):
    """
    Ingest a contributed elevation dataset.

    This validates, encodes, and prepares a dataset for submission to OpenZenith.

    The dataset directory should contain GeoTIFF or raw binary elevation files
    organized by tile name (e.g., N00E006.tif for SRTM-style naming).

    After running 'oz ingest', a pull request can be opened at:
    https://github.com/openzenith/openzenith-data

    Example:
        oz ingest ./my-dataset/ \\
            --name "alos-aw3d-30m-japan" \\
            --description "ALOS AW3D 30m DSM for Japan, processed 2024" \\
            --license CC-BY-4.0 \\
            --source-url "https://www.eorc.jaxa.jp/ALOS/en/aw3d30/"
    """
    # Steps:
    # 1. Validate file structure
    # 2. Check for overlapping coverage with existing datasets
    # 3. Encode to OZT2
    # 4. Generate manifest (JSON with metadata, coverage bbox, resolution)
    # 5. Package into .tar.gz for submission
    ...
```

### 5.2 Data Manifest Schema

```json
{
  "name": "alos-aw3d-30m-japan",
  "version": "1.0.0",
  "description": "ALOS AW3D 30m DSM for Japan",
  "license": "CC-BY-4.0",
  "source_url": "https://www.eorc.jaxa.jp/ALOS/en/aw3d30/",
  "contributor": "@example.com",
  "coverage": {
    "bbox": [122.0, 24.0, 154.0, 46.0],
    "zoom_range": [0, 14],
    "resolution_meters": 30,
    "vertical_datum": "EGM96",
    "horizontal_datum": "WGS84"
  },
  "tiles": [
    {"z": 0, "x": 0, "y": 0, "file": "z0/0/0.ozt2", "size_bytes": 1234},
    ...
  ],
  "checksum": "sha256:abc123..."
}
```

### 5.3 PR-Based Submission Workflow

```
Contributor workflow:
1. Downloads source DEM data (SRTM, ALOS AW3D, USGS 3DEP, etc.)
2. Organizes into standard directory structure
3. Runs: `oz ingest ./my-data/ --name my-dataset --description "..."`
4. The CLI generates a .tar.gz bundle + manifest
5. Contributor opens PR at github.com/openzenith/openzenith-data
   with the bundle as a LFS file
6. Maintainers review, run validation:
   - `oz validate ./bundle/` (checks tile integrity, coverage, no duplicates)
   - Human review of metadata
7. Merge → tiles automatically uploaded to R2, added to global manifest
```

### 5.4 Global Tile Manifest

**File:** `data/elevation-manifest.json` (stored in repo, uploaded to R2)

```json
{
  "version": "1.0.0",
  "generated": "2026-08-06T00:00:00Z",
  "datasets": [
    {
      "id": "srtm30m-global",
      "name": "SRTM 30m",
      "license": "SRTM Data Policy (free for non-commercial)",
      "coverage": {"bbox": [-180, -60, 180, 60], "resolution_meters": 30},
      "zoom_range": [0, 14],
      "priority": 1,
      "tile_prefix": "srtm30m"
    },
    {
      "id": "alos-aw3d-30m-japan",
      "name": "ALOS AW3D 30m Japan",
      "license": "CC-BY-4.0",
      "contributor": "taro@example.com",
      "coverage": {"bbox": [122, 24, 154, 46], "resolution_meters": 30},
      "zoom_range": [0, 14],
      "priority": 2,
      "tile_prefix": "alos-aw3d-japan"
    }
  ]
}
```

The SDK/API uses the manifest to route requests to the highest-priority dataset covering the requested coordinates.

---

## Phase 6: Higher Resolution Data

**Goal:** Add 10m data for priority regions

### 6.1 Priority Regions for 10m Data

| Region | Source | Coverage | Priority |
|--------|--------|----------|----------|
| USA (CONUS) | USGS 3DEP 1m → resampled to 10m | ~8M km² | **P0** |
| Europe | Copernicus GLO-30 | Global | P1 |
| Japan | JAXA ALOS AW3D 5m | Japan | P1 |
| Canada | NRCan CDEM 20m | Canada | P2 |
| Arctic (>60°N) | ArcticDEM 2m | Arctic | P2 |
| High Mountain Asia | NASA HMA 8m | Himalayas, Tien Shan | P2 |

### 6.2 USGS 3DEP Ingestion

USGS 3DEP provides 1m LiDAR for most of the US, publicly available as:
- 1m: ~2.5M km² (very large)
- 10m seamless: much more manageable (~8GB for CONUS as COG)

```bash
# Download 10m USGS 3DEP seamless for CONUS
# Available as Cloud Optimized GeoTIFFs on AWS:
aws s3 ls s3://prd-tnm-derivatives/

# Use `pdal` or `gdalwarp` to:
# 1. Clip to CONUS bounding box
# 2. Resample to 256x256 tiles
# 3. Encode to OZT2
# 4. Upload to R2
```

### 6.3 Copernicus GLO-30

Freely available on AWS:
```bash
# Copernicus DEM GLO-30 (30m, global)
aws s3 ls s3://copernicus-dem-30m/  # ~370GB, too large to download
# Use AWS Public Dataset — access via API, not download
```

Priority: Replace SRTM with Copernicus GLO-30 for areas where it's better quality (Europe, polar regions).

---

## Phase 7: Testing & Validation

### 7.1 Python SDK Tests

```bash
# Add comprehensive OZT2 tests
pytest openzenith/tests/test_tile_format_v2.py -v

# Test roundtrip accuracy
pytest openzenith/tests/test_elevation.py -v
pytest openzenith/tests/test_terrain.py -v

# All tests must pass
pytest openzenith/tests/ -v  # target: 200+ tests
```

### 7.2 API Tests

```bash
# Test OZT2 tile endpoint
npx vitest run api/src/app/api/dem-tile/

# Test elevation endpoint with format=ozt2
npx vitest run api/src/app/api/elevation/

# Full test suite
npm run test
```

### 7.3 Benchmark OZT2 vs Terrarium

**File:** `scripts/benchmark_ozt2.py`

```python
"""
Benchmark: compare OZT2 vs Terrarium PNG vs OZT1 for the same tiles.
Run against 1000 random tiles from diverse terrain types.
"""
import time
import random
from pathlib import Path
from openzenith.tile_format_v2 import auto_encode, decode
from openzenith.tile_format import encode as ozt1_encode, decode as ozt1_decode
import numpy as np

TERRAINS = ["flat", "mountain", "coastal", "desert", "arctic"]
TILE_COUNT = 1000

def benchmark_terrarium(tile):
    """Encode to Terrarium PNG (RGB8)."""
    import zlib
    rgb = np.empty((256, 256, 3), dtype=np.uint8)
    # Terrarium encoding: value = elev + 32768
    for i, elev in enumerate(tile.flat):
        v = int(elev + 32768)
        rgb.flat[i * 3] = (v >> 16) & 0xFF
        rgb.flat[i * 3 + 1] = (v >> 8) & 0xFF
        rgb.flat[i * 3 + 2] = v & 0xFF
    import io, PIL.Image
    buf = io.BytesIO()
    PIL.Image.fromarray(rgb, "RGB").save(buf, format="PNG", compress_level=1)
    return len(zlib.compress(buf.getvalue()))

results = {
    "ozt2": {"size": 0, "encode_ms": 0, "decode_ms": 0},
    "ozt1": {"size": 0, "encode_ms": 0, "decode_ms": 0},
    "terrarium": {"size": 0, "encode_ms": 0, "decode_ms": 0},
}
# ... run benchmark ...
print(f"""
Results ({TILE_COUNT} tiles):
  OZT2:    {results['ozt2']['size']/1e6:.1f}MB avg={results['ozt2']['size']/TILE_COUNT:.0f}B/tile
  OZT1:    {results['ozt1']['size']/1e6:.1f}MB avg={results['ozt1']['size']/TILE_COUNT:.0f}B/tile
  Terrarium: {results['terrarium']['size']/1e6:.1f}MB avg={results['terrarium']['size']/TILE_COUNT:.0f}B/tile
  OZT2 vs Terrarium: {(1 - results['ozt2']['size']/results['terrarium']['size'])*100:.0f}% smaller
""")
```

---

## Implementation Order

```
Week 1: Phase 1 (Core Infrastructure) ✅ COMPLETE
  ✅ 1.1  Add oz encode CLI command (cli.py)
  ✅ 1.2  Write convert_to_ozt2.py batch script
  ✅ 1.3  Write ozt2_decode.ts (JavaScript decoder — DecompressionStream "br")
  ✅ 1.4  Update dem-tile API route for OZT2 serving (format negotiation)
  ✅ 1.5  Verify roundtrip accuracy in Python SDK tests

Week 2: Phase 2 (Tile Generation & Storage) ✅ COMPLETE
  ✅ 2.1  Run convert_to_ozt2.py for z0–z12 on local machine
  ✅ 2.2  Upload to R2
  ⬜ 2.3  Write convert_gebco_to_ozt2.py for bathymetry
  ⬜ 2.4  Upload GEBCO OZT2 tiles to R2
  ⬜ 2.5  Verify storage reduction (compare R2 dashboard before/after)

Week 3: Phase 3 (SDK Integration) ✅ COMPLETE
  ✅ 3.1  Expose OZT2 in SDK __init__.py (encode_v2, decode_v2, OZT2Backend)
  ✅ 3.2  Write get_elevation_from_ozt2() function (elevation.py)
  ✅ 3.3  Write OZT2Backend for local tile reading (backends/ozt2.py)
  ✅ 3.4  Add OZT2Backend + OZT2R2Backend (R2/S3 fetch)
  ✅ 3.5  merged.py reader for OZCHNK01 .merged files

Week 4: Phase 4 (Client Integration) ✅ COMPLETE
  ✅ 4.1  Wire OZT2 terrain provider in CesiumJS globe (terrain-ozt2.ts)
  ✅ 4.2  Update MapLibre elevation tile source (PNG fallback — MapLibre requires
         Terrarium encoding natively; OZT2 gain is in API→R2 transfer, not client decode)
  ✅ 4.3  dem-tile route: OZT2 from R2 ("ozt2/" prefix), PNG from "dem-tile/" prefix
  ✅ 4.4  dem-tile metadata: version 2.0.0, maxzoom 12, formats map added
  ⬜ 4.5  End-to-end test: zoom from z0 to z12, verify no gaps
  ⬜ 4.6  Verify decode speed in browser (Chrome DevTools)

Week 5–6: Phase 5 (Community Pipeline) ✅ COMPLETE
  ✅ 5.1  Write oz ingest CLI command (cmd_ingest in cli.py)
  ✅ 5.2  Create elevation-manifest.json schema (in CONTRIBUTING.md + OPZENITH_DATA_REPO.md)
  ✅ 5.3  Write validate_ozt2_tiles.py (tile integrity, header sanity, RMSE, parallel)
  ✅ 5.4  Create openzenith-data repo structure (OPZENITH_DATA_REPO.md)
  ✅ 5.5  Document contribution workflow in docs/ (CONTRIBUTING.md)

Week 7–8: Phase 6 (Higher Resolution) ⬜ PENDING
  ⬜ 6.1  Set up 10m Copernicus GLO-30 ingestion
  ⬜ 6.2  USGS 3DEP CONUS 10m → OZT2
  ⬜ 6.3  Update tile manifest with priority ordering
  ⬜ 6.4  Update SDK to cascade: 3DEP → Copernicus → SRTM → GEBCO

Week 9+: Phase 7 (Testing & Polish) 🔄 IN PROGRESS
  🔄 7.1  Run full benchmark suite (benchmark_ozt2.py exists, needs real data)
  ✅ 7.2  200+ Python SDK tests passing (198 tests)
  ⬜ 7.3  E2E Playwright tests for OZT2 tiles
  ⬜ 7.4  Performance audit (compare before/after storage, latency)
```

---

## Key Files to Create/Modify

| File | Action | Phase |
|------|--------|-------|
| `scripts/convert_to_ozt2.py` | Create | 1 |
| `api/src/lib/ozt2_decode.ts` | Create | 1 |
| `api/src/app/api/dem-tile/[z]/[x]/[y]/route.ts` | Modify | 1 |
| `openzenith/cli.py` | Modify (add `encode`, `ingest`) | 1, 5 |
| `scripts/convert_gebco_to_ozt2.py` | Create | 2 |
| `openzenith/backends/ozt2.py` | Create | 3 |
| `openzenith/elevation.py` | Modify (add get_elevation_from_ozt2) | 3 |
| `openzenith/__init__.py` | Modify | 3 |
| `openzenith/merged.py` | Create | 3 |
| `api/src/app/globe/lib/terrain-ozt2.ts` | Create | 4 |
| `api/src/app/globe/lib/cesium-init.ts` | Modify | 4 |
| `api/src/app/globe/lib/terrain-csr.ts` | Modify | 4 |
| `api/src/app/api/dem-tile/route.ts` | Modify (metadata v2.0.0) | 4 |
| `api/src/lib/storage/backend.ts` | Modify (add LocalTifBackend) | 3 |
| `scripts/benchmark_ozt2.py` | Create | 7 |
| `docs/CONTRIBUTING.md` | Create | 5 |
| `docs/OPZENITH_DATA_REPO.md` | Create | 5 |
| `scripts/validate_ozt2_tiles.py` | Create | 5 |
| `data/elevation-manifest.json` | Create | 5 |
| `openzenith/tests/test_tile_format_v2.py` | Modify (expand) | 7 |

---

## Risk Mitigation

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| R2 upload too slow (>100GB) | Medium | Use `aws s3 sync --size-only` with checksums, upload only changed tiles |
| OZT2 decode too slow in browser | Low | Profile on target hardware; gradient loop is O(n) with simple int32 ops |
| Brotli not available in old browsers | Low | Always serve PNG fallback with `Accept: image/png` header |
| WASM needed for zstd fallback | Low | Use fflate (pure JS) for zstd in browser if needed |
| Contributors submit bad tiles | Medium | Mandatory `oz validate` step + automated QA checks in CI |
| GEBCO OZT2 compression poor | Low | GEBCO is smooth/bathymetric → very uniform → excellent compression |
| OZT2 decode creates elevation artifacts | Low | `auto_encode` with `max_rmse=1.0` is conservative; test on 1000 diverse tiles first |

---

## Success Criteria

- [x] OZT2 encoder + decoder (tile_format_v2.py, ozt2_decode.ts)
- [x] Python SDK OZT2 support (OZT2Backend, get_elevation_from_ozt2, encode_v2)
- [x] CesiumJS OZT2 terrain provider (terrain-ozt2.ts)
- [x] API format negotiation (?format=ozt2|png)
- [x] Local SRTM .tif backend (LocalTifBackend, zero-HTTPS elevation queries)
- [ ] OZT2 tiles generated and uploaded to R2 for z0–z12
- [ ] JS decoder in browser decodes OZT2 tile in <5ms (p95)
- [ ] `oz encode` CLI command works for GeoTIFF → OZT2
- [ ] `oz ingest` CLI command creates valid contribution bundles
- [ ] 200+ Python SDK tests passing
- [ ] All existing API tests passing (no regressions)
- [ ] Storage on R2 reduced by >80% compared to Terrarium PNG baseline


## Status Update (2026-08-23)

### ✅ Completed
- OZT2 format implemented (`tile_format_v2.py`)
- Python SDK encode/decode working
- JavaScript OZT2 decoder (`ozt2_decode.ts`) deployed to /wasm-demo
- HF backend (`OZT2HFBackend`) implemented
- z10 tiles encoded and uploaded to HF (152K tiles, all verified synced)
- Upload script rewritten with per-file delta detection

### 🔄 In Progress
- z7–z9 and z11 tiles pending HF upload (local encoding complete)
- z11 tiles pending R2 upload and Edge deploy

### ⏳ Pending
- Upload remaining zoom levels to HF
- Finalize upload script for production use

