# OZT Tile Formats

OpenZenith uses two custom binary tile formats optimized for terrain elevation data: **OZT1** (lossless) and **OZT2** (lossy with high compression).

## Comparison

| Format | Compression | Lossy | Size vs Raw | Size vs Terrarium | Encode Speed |
|--------|-------------|-------|-------------|-------------------|---------------|
| Raw 16-bit | None | No | 100% | — | — |
| Terrarium PNG | PNG | No | — | 100% (baseline) | — |
| OZT1 | Zstd | No | ~33% | ~67% smaller | 1x |
| OZT2 | Zstd + Quant | Yes | ~7% | ~93% smaller | 30x faster than Brotli |

## OZT1 Format

OZT1 is a lossless format using zstd compression on raw 16-bit elevation values.

### File Structure

```
[Header: 16 bytes]
[Compressed Data: variable]
```

**Header** (16 bytes):
- Bytes 0-3: Magic `OZT1` (4 bytes)
- Bytes 4-7: Compression type (1 = zstd, 2 = zstd+delta, 3 = zstd+prediction)
- Bytes 8-11: Original data size (uint32)
- Bytes 12-15: Reserved

### Compression Types

| Type | Constant | Description |
|------|----------|-------------|
| 1 | `COMP_ZSTD` | Raw zstd compression |
| 2 | `COMP_ZSTD_DELTA` | Horizontal differencing + zstd |
| 3 | `COMP_ZSTD_PREDICT` | Gradient prediction + zstd |

### Python API

```python
from openzenith import decode, encode, COMP_ZSTD, TileError

# Decode OZT1 tile
with open("tile.ozt1", "rb") as f:
    elevation = decode(f.read(), compression=COMP_ZSTD)

# Encode to OZT1
compressed = encode(elevation, compression=COMP_ZSTD)

# Validate roundtrip
is_valid = validate_roundtrip(elevation, compression=COMP_ZSTD)
```

---

## OZT2 Format

OZT2 is a lossy format using gradient prediction with adaptive quantization and zstd compression. Designed for efficient storage and delivery of elevation tiles at zoom levels 7-11.

### Compression Pipeline

```
Raw DEM (16-bit)
    │
    ▼
Gradient Prediction
    │  Predict each pixel from left and top neighbors
    │  error[i,j] = pixel[i,j] - (pixel[i,j-1] + pixel[i-1,j] - pixel[i-1,j-1])
    │
    ▼
Adaptive Quantization
    │  Quantize errors based on local slope
    │  Steep terrain: more bits (4-6)
    │  Flat terrain: fewer bits (2-3)
    │
    ▼
Zstd Compression (level 3)
    │
    ▼
OZT2 File
```

### Resolution Tiers

| Zoom Level | Approx Resolution | Use Case |
|------------|-------------------|----------|
| z7 | ~4.9 km/pixel | Continental |
| z8 | ~2.4 km/pixel | Regional |
| z9 | ~1.2 km/pixel | Sub-regional |
| z10 | ~611 m/pixel | Local (SRTM Nyquist-optimal) |
| z11 | ~305 m/pixel | Detailed (interpolated) |

**Note**: z11+ from SRTM 30m source is pure interpolation (no new data), so z10 is the highest lossless-valid resolution.

### Python API

```python
from openzenith import encode_v2, decode_v2, auto_encode, validate_roundtrip_v2

# Decode OZT2 tile
with open("tile.ozt2", "rb") as f:
    elevation = decode_v2(f.read())

# Auto-encode with optimal settings
compressed = auto_encode(elevation, max_rmse=1.0)

# Manual encode with specific settings
compressed = encode_v2(
    elevation,
    bits=4,                    # quantization bits
    predictor="gradient",      # or "none"
    compression="zstd_v2"      # zstd_v2, brotli, or zlib
)

# Validate roundtrip
is_valid = validate_roundtrip_v2(elevation, max_rmse=1.0)
```

### Encode Options

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `bits` | int | auto | Quantization bits (2-8) |
| `max_rmse` | float | 1.0 | Max RMSE in meters |
| `predictor` | string | "gradient" | Prediction mode |
| `compression` | string | "zstd_v2" | Compression algorithm |

### Accuracy

OZT2 accuracy depends on quantization:

| Bits | RMSE (typical) | Max Error (typical) |
|------|----------------|----------------------|
| 2 | ~5m | ~15m |
| 3 | ~2m | ~6m |
| 4 | ~1m | ~3m |
| 6 | ~0.25m | ~0.75m |

---

## Terrarium PNG Comparison

The **Terrarium PNG** format encodes elevation as 3 bytes per pixel (16-bit for each R, G, B channel):

```
R = floor(elevation / 256)
G = elevation % 256
B = 0
Actual: (R * 256 + G + B / 256) * 256 - 32768
```

**Disadvantages**:
- 3 bytes per pixel minimum (even for flat areas)
- No compression (reliance on PNG's DEFLATE)
- No prediction or modeling

**OZT2 Advantages**:
- ~93% smaller than Terrarium PNG
- 30x faster encoding than Brotli
- Adaptive precision based on terrain complexity

---

## HuggingFace Dataset

OZT2 tiles are hosted on HuggingFace:

| Dataset | URL |
|---------|-----|
| `aliasfox/srtm30m-ozt2-v2` | https://huggingface.co/datasets/aliasfox/srtm30m-ozt2-v2 |

**Dataset Statistics**:
- ~747,000 tiles across z7-z11
- ~2GB total compressed
- Global coverage (land only)

### Loading Tiles

```python
from openzenith import load_ozt2_tiles_from_hf, get_elevation_from_ozt2

# Download tiles to local cache
tile_dir = load_ozt2_tiles_from_hf(
    repo_id="aliasfox/srtm30m-ozt2-v2",
    zoom_levels=[10],
    cache_dir="/tmp/ozt2"
)

# Query elevation
elev = get_elevation_from_ozt2(36.0, -118.0, ozt2_dir=tile_dir)
```

---

## Backend Access

### Local Files

```python
from openzenith.backends import OZT2Backend

backend = OZT2Backend("/path/to/tiles")
grid = backend.fetch_tile(z=10, x=163, y=395)
```

### Cloudflare R2

```python
from openzenith.backends import OZT2R2Backend

backend = OZT2R2Backend(
    "my-bucket",
    prefix="ozt2/",
    r2_account_id="...",
    r2_access_key_id="...",
    r2_secret_access_key="..."
)
```

### HuggingFace

```python
from openzenith.backends import OZT2HFBackend

backend = OZT2HFBackend(
    repo_id="aliasfox/srtm30m-ozt2-v2",
    cache_dir="/tmp/ozt2"
)
grid = backend.fetch_tile(z=10, x=163, y=395)
```

---

## CLI Usage

```bash
# Encode GeoTIFF to OZT2
openzenith encode input.tif output.ozt2 --max-rmse 1.0

# Query elevation using OZT2 tiles
openzenith query --lat 36.0 --lon -118.0 --use-ozt2

# Download tiles
openzenith tiles --bbox -125 25 -65 50 --zoom 10 --cache-dir /tmp/tiles
```
