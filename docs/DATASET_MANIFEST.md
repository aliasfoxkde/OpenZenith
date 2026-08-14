# OpenZenith Elevation Dataset Manifest

**Generated:** 2026-08-14
**Schema version:** 1.0.0

---

## Overview

This document describes the elevation datasets used by the OpenZenith platform, their current status, and the path to v2 datasets.

---

## Active Datasets

### 1. SRTM 30m (aliasfox/srtm30m-merged)

| Property | Value |
|----------|-------|
| Dataset ID | `aliasfox/srtm30m-merged` |
| Format | OZCHNK01 (zlib + horizontal differencing) |
| Source | NASA SRTM C-Band, void-filled |
| Resolution | 30 meters |
| Coverage | ±60° latitude |
| Tile size | 1° × 1° |
| File count | 14,296 `.merged` files |
| Chunk size | 256 × 256 samples |
| Storage backend | HuggingFace (primary), Local NAS (backup) |
| NODATA value | -32768 |
| Vertical datum | EGM96 |
| License | SRTM Data Policy (free for non-commercial) |
| Status | **Active** (legacy — v2 migration pending) |

**API backend:** `HuggingFaceChunkBackend("aliasfox/srtm30m-merged")`

### 2. GEBCO 2025 Bathymetry

| Property | Value |
|----------|-------|
| Format | COG (Cloud Optimized GeoTIFF) |
| Source | GEBCO 2025 (Copernicus) |
| Resolution | ~450 meters |
| Coverage | Global ocean |
| Strip size | 21,600 × 1 pixels (row strips) |
| Storage backend | CEDA (primary), R2 (cache) |
| NODATA detection | Range-based (-11000 to 8850m valid) |
| Surface classification | `seafloor` (negative) / `land` (non-negative) |
| License | GEBCO license |
| Status | **Active** |

**API backend:** `getGebcoElevation()` via CEDA HTTP range requests

---

## Planned V2 Datasets

### 3. OZT2 Elevation Tiles (openzenith/elevation-v2-ozt2) — Planned

| Property | Value |
|----------|-------|
| Dataset ID | `openzenith/elevation-v2-ozt2` |
| Format | OZT2 (gradient prediction + adaptive quantization + Zstd/Brotli) |
| Source | SRTM 30m + Copernicus GLO-30 |
| Resolution | 30 meters |
| Coverage | Global land (replacing SRTM) |
| Zoom levels | z0–z14 |
| Tile size | 256 × 256 pixels |
| Compression | ~93% smaller than Terrarium PNG |
| Status | **Not yet created** — requires local build + HuggingFace upload |

**Build pipeline:** `scripts/convert_to_ozt2.py`
**Target:** HuggingFace `openzenith/elevation-v2-ozt2`

### 4. OZT2 Bathymetry (openzenith/bathymetry-v2-ozt2) — Planned

| Property | Value |
|----------|-------|
| Dataset ID | `openzenith/bathymetry-v2-ozt2` |
| Format | OZT2 |
| Source | GEBCO 2025 |
| Resolution | ~450 meters |
| Coverage | Global ocean |
| Status | **Not yet created** |

**Build pipeline:** `scripts/convert_gebco_to_ozt2.py`

---

## Surface Type Classification

OpenZenith uses a unified surface type taxonomy across all elevation sources:

| Value | Meaning | Examples |
|-------|---------|----------|
| `"land"` | Land surface above or at sea level | Mountains, valleys, plateaus |
| `"inland_water"` | Inland bodies of water | Lakes, rivers, reservoirs |
| `"ocean"` | Open ocean surface | Seas, open ocean areas |
| `"seafloor"` | Ocean floor / bathymetry | Below sea level ocean areas |
| `"unknown"` | Source returned no data or classification failed | NODATA regions, corrupt tiles |

**Classification rules:**
- **SRTM/OZT2** (land): `surface_type = "land"` — negative land elevations (Dead Sea: -430m) are valid land, not ocean
- **GEBCO**: `surface_type = "seafloor"` if elevation < 0, `"land"` if >= 0
- **AWS Terrain Tiles**: `surface_type = "land"`

---

## Tile Format Reference

### OZT1 (Legacy)
- **Header:** 6 bytes [min:int16, range:uint16, bits:uint8, flags:uint8]
- **Compressor:** Zstd
- **Use:** SRTM merged chunk storage on HuggingFace

### OZT2 (Current)
- **Header:** 6 bytes [vmin:int16, range:uint16, bits:uint8, flags:uint8]
- **Predictor:** Gradient (`p[i,j] = left + above − upper_left`)
- **Compressor:** Zstd or Brotli (native `DecompressionStream`)
- **Quantization:** Adaptive 8–16 bit based on local elevation range
- **Decode time:** ~2ms per 256×256 tile
- **Status:** Implemented in `api/src/lib/ozt2_decode.ts` and `openzenith/tile_format_v2.py`

### Terrarium PNG (Legacy API)
- **Encoding:** RGB8, value = elevation + 32768
- **Decode:** PNG IDAT + zlib
- **Use:** API `/api/dem-tile/` fallback format

---

## Status Checklist

- [x] OZT2 encoder/decoder implemented (Python + TypeScript)
- [x] CesiumJS OZT2 terrain provider (`terrain-ozt2.ts`)
- [x] DEM tile API route with OZT2 support (`/api/dem-tile/`)
- [x] Surface type taxonomy with `seafloor` distinction
- [x] Typed elevation result contract across all API routes
- [x] NODATA policy: preserve -32768 via `noDataValue` in Cesium HeightmapTerrainData
- [ ] OZT2 tiles generated for z0–z12 on local machine
- [ ] OZT2 tiles uploaded to HuggingFace `openzenith/elevation-v2-ozt2`
- [ ] OZT2 bathymetry tiles generated via `convert_gebco_to_ozt2.py`
- [ ] OZT2 bathymetry uploaded to HuggingFace `openzenith/bathymetry-v2-ozt2`
- [ ] API switched to v2 dataset as primary, v1 as fallback
- [ ] SDK updated to cascade: V2 → SRTM → GEBCO
- [ ] Storage reduction measured (target: >80% vs Terrarium PNG baseline)

---

## API Route Reference

| Route | Format | Backend | Status |
|-------|--------|---------|--------|
| `GET /api/elevation?lat=&lon=` | JSON | HuggingFace SRTM → GEBCO | ✅ Active |
| `GET /api/dem-tile/{z}/{x}/{y}` | PNG (Terrarium) | HuggingFace chunks → R2 cache | ✅ Active |
| `GET /api/dem-tile/{z}/{x}/{y}?format=ozt2` | OZT2 binary | R2 (pre-generated) | ✅ Supported |
| `GET /api/elevation-color/{z}/{x}/{y}` | PNG (RGB) | HuggingFace chunks | ✅ Active |
| `GET /api/health` | JSON | — | ✅ Active |

---

## Surface Type Validation Points

| Location | Expected Elevation | Expected Surface | Source |
|----------|-------------------|----------------|--------|
| Mount Everest | ~8849m | `land` | SRTM |
| Dead Sea shore | ~-430m | `land` | SRTM |
| Mid-Atlantic Ocean | ~-3000m | `seafloor` | GEBCO |
| Lake Baikal | ~-1180m | `inland_water` (via lake mask) | GEBCO |
| Mariana Trench | ~-10900m | `seafloor` | GEBCO |
| New York City | ~10m | `land` | SRTM |
| Sahara Desert | ~100m | `land` | SRTM |
