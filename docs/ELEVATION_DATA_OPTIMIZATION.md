You’re at the point where this stops being “an idea” and becomes a **data pipeline + codec + distribution system**. I’ll give you a **handoff-ready plan** you can feed into your AI agents (or implement yourself) that is:

* technically correct (based on your experiments)
* optimized for your constraints (edge delivery, low cost)
* structured for iteration (you *will* refine this)

---

# 🧠 0. Ground truth (based on your report)

From your experiment :

* AVIF / HEIF ❌ (catastrophic precision loss)
* GeoTIFF ❌ (bloated / legacy)
* Raw compression ❌ (already compressed)
* **Signal compression (predict + quantize + Zstd) ✅**

👉 So the system you build should be:

> **Signal-first compression + custom container + tiled streaming**

---

# 🧱 1. System architecture (OpenZenith v1 → v2)

## Core components

```text
[Source DEMs]
   ↓
[Ingestion Pipeline]
   ↓
[Normalization (datum, units)]
   ↓
[Tiling System]
   ↓
[OZT Encoder (v1 → v2)]
   ↓
[Tile Store (HuggingFace / CDN)]
   ↓
[Edge API (Cloudflare Pages)]
   ↓
[Client (progressive decode)]
```

---

# 🧪 2. Phase 1 — Controlled Test Dataset

## Goal:

Validate compression strategies on a **clean baseline**

---

## Dataset selection

Start with:

* SRTM 30m (you already have it)
* Pick **20 tiles**:

| Type        | Count |
| ----------- | ----- |
| Ocean       | 2     |
| Flat        | 4     |
| Hills       | 4     |
| Mountains   | 6     |
| Mixed/urban | 4     |

---

## Convert to RAW baseline

```python
# REQUIRED STEP
GeoTIFF → numpy int16 → raw binary
```

Store:

```text
tile.raw (int16, no compression)
```

👉 This is your **true baseline** (not GeoTIFF)

---

# 🔬 3. Phase 2 — Compression Experiments

You will implement **3 pipelines**

---

## Pipeline A — OZT1 (baseline)

```text
DEM → predictor → residual → Zstd
```

---

## Pipeline B — OZT2 (multi-scale)

```text
DEM → pyramid → residuals → quantize → Zstd
```

---

## Pipeline C — Hybrid (NEW, recommended)

```text
DEM
→ predictor
→ residual
→ clip to int8 where possible
→ fallback to int16 where needed
→ Zstd
```

👉 This is your “mixed precision” idea done correctly.

---

## Metrics to collect

For each tile:

```json
{
  "size_bytes": ...,
  "compression_ratio_vs_raw": ...,
  "rmse": ...,
  "max_error": ...,
  "encode_time": ...,
  "decode_time": ...
}
```

---

## Decision criteria

| Metric      | Target      |
| ----------- | ----------- |
| RMSE        | ≤ 2m        |
| Max error   | ≤ 5m        |
| Compression | ≥ 5× vs raw |
| Decode      | < 50ms/tile |

---

# 🧩 4. OZT2 Format Spec (Production Draft)

This is what your AI should implement.

---

## File structure

```text
[HEADER]
[LEVEL TABLE]
[COMPRESSED DATA BLOBS]
```

---

## Header (fixed)

```c
struct {
  char magic[4];     // "OZT2"
  uint8 version;
  uint8 levels;
  uint16 tile_size;
  uint8 compression; // 1=zstd
}
```

---

## Level entry

```c
struct {
  uint8 type;        // base=0, residual=1
  uint8 bits;
  float min;
  float scale;
  uint32 offset;
  uint32 size;
}
```

---

## Data

* Each level compressed independently
* Enables **partial decoding**

---

# 🧠 5. Core encoding algorithms

Your AI must implement:

---

## Predictor (baseline)

```python
pred = (left + top + top_left) // 3
residual = actual - pred
```

---

## Multi-scale

```python
coarse = downsample(tile)
upsampled = upsample(coarse)
residual = fine - upsampled
```

---

## Mixed precision (important)

```python
if abs(residual) <= 127:
    store int8
else:
    store int16
```

Store mask:

```python
bitmask = residual > 127 OR residual < -128
```

---

# 📦 6. Global Dataset Build

## Input sources

* SRTM (baseline)
* Copernicus Programme DEM
* Japan Aerospace Exploration Agency ALOS

---

## Steps

### 1. Normalize

* Convert to:

  * meters
  * same vertical datum (EGM96)

---

### 2. Mosaic

* Merge overlapping datasets
* Prefer highest resolution

---

### 3. Tile

```text
1° tiles → 256×256 subtiles
```

---

### 4. Encode

* Use best pipeline from Phase 2

---

### 5. Store

Structure:

```text
/dataset/
  /z/x/y.ozt2
```

---

# ☁️ 7. Storage + Distribution (low cost)

## Storage: Hugging Face

* Store tiles as dataset repo
* Use:

  * Git LFS
  * chunked files

---

## CDN: Cloudflare

* Cache tiles
* Serve via Pages or Workers

---

# ⚡ 8. Edge API (Cloudflare Pages / Workers)

## Endpoint design

---

### Get tile (full)

```http
GET /tile/{z}/{x}/{y}
```

---

### Get level

```http
GET /tile/{z}/{x}/{y}?level=2
```

---

### Progressive

```http
GET /tile/{z}/{x}/{y}/stream
```

---

## Response

Binary:

```text
[level header][data]
[level header][data]
...
```

---

# 🖥️ 9. Client (browser)

## Decode pipeline

```javascript
tile = decodeBase(level0)

for (level of stream) {
  tile = applyResidual(tile, level)
  render(tile)
}
```

---

## Rendering options

* Canvas (simple)
* WebGL (fast)
* Three.js (terrain)

---

# 🔄 10. Incremental updates (your killer feature)

## Workflow

```bash
oz ingest lidar.tif
oz compare lidar.tif N40W074
oz update N40W074 lidar.tif
```

---

## Validation

* RMSE threshold
* slope consistency
* outlier detection

---

# 🧪 11. Validation suite

Your AI should build:

---

## Tests

* round-trip lossless
* RMSE thresholds
* edge stitching
* slope preservation

---

## Benchmarks

* per terrain type
* per resolution
* per compression mode

---

# 🎯 12. Final targets

| Tier       | Size       |
| ---------- | ---------- |
| Raw        | ~500GB     |
| OZT1       | ~100GB     |
| OZT2       | ~20–50GB   |
| Aggressive | ~2–10GB    |
| Web        | ~500MB–2GB |

---

# 💬 Final guidance

What you’re building is:

> **A new standard for elevation data distribution**

Your instincts were right:

* mixed precision ✔
* layering ✔
* tile streaming ✔

You just needed:

* correct mathematical structure
* correct encoding pipeline

---

# 🚀 If you want next step

I’d recommend:

👉 Build **Phase 2 benchmark harness first**
Then lock in:

* best pipeline
* bit depth strategy

After that:
👉 build full dataset once (expensive step)

---

If you want, I can next:

* turn this into a **single executable AI prompt spec**
* or help you design the **CLI (`oz`) toolchain**

That would let you spin this up very quickly.


Goals:
- Merge/Blend all uncompressed datasets and optimize with outlined strategy
- Cleanup HuggingFace and maintain exactly one chunked dataset
  - Optimize the chunk size for fast loading and edge compute (Cloudflare Pages)
- Update OpenZenith setup scripts to sync the final/optimized dataset
  - The data set can be used for dedicated tools, python, etc. for local processing
    to speed up compute operations, analysis, simulation, etc.
- See Dataset Storage working directory: /nas/Temp/DEMs
