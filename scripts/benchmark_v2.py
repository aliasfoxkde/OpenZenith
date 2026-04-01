#!/usr/bin/env python3
"""
DEM Compression Optimization Benchmark v2

Tests four optimization axes for OpenZenith terrain tile delivery:
  1. WebP lossless vs PNG for tile encoding
  2. Paeth/gradient/avg prediction filters vs left-prediction
  3. Terrain-adaptive quantization vs uniform per-tile
  4. Brotli vs Zstd for residual compression

Usage:
    python scripts/benchmark_v2.py              # Full 12-tile benchmark
    python scripts/benchmark_v2.py --max 4      # Quick 4-tile test
    python scripts/benchmark_v2.py --output DIR # Custom output dir
"""

import argparse
import io
import json
import os
import sys
import time

import brotli
import numpy as np
import zstandard as zstd
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from openzenith.geo_utils import (
    classify_terrain,
    compute_rmse,
    compute_slope_deviation,
    load_geotiff,
    srtm_filename_to_bounds,
)
from openzenith.terrarium import decode_tile, encode_tile

# ---------------------------------------------------------------------------
# Source data
# ---------------------------------------------------------------------------
SRTM_DIR = "/nas/Temp/DEMs/data/srtm30m"

REPRESENTATIVE_TILES = {
    "ocean_pacific": "N00E172.tif",
    "coast_flat": "N00W050.tif",
    "lowland_amazon": "S05W060.tif",
    "lowland_us": "N35W090.tif",
    "desert_sahara": "N25E010.tif",
    "desert_australia": "S25E135.tif",
    "hills_us": "N38W085.tif",
    "mountain_alps": "N46E010.tif",
    "mountain_andes": "S15W070.tif",
    "mountain_himalaya": "N28E084.tif",
    "mixed_urban_nyc": "N40W074.tif",
    "user_test_china": "N28E096.tif",
}

NODATA = -32768

# ---------------------------------------------------------------------------
# Prediction filters
# ---------------------------------------------------------------------------


def predict_left(arr: np.ndarray) -> np.ndarray:
    """Left-predictor: predicted[i,j] = actual[i,j-1]."""
    residuals = arr.astype(np.int32).copy()
    residuals[:, 1:] = arr[:, 1:].astype(np.int32) - arr[:, :-1].astype(np.int32)
    return residuals.astype(np.int16), arr[:, 0].copy(), None


def reconstruct_left(residuals: np.ndarray, first_col: np.ndarray, _unused=None) -> np.ndarray:
    """Reconstruct from left-prediction residuals."""
    arr = np.empty_like(residuals, dtype=np.int32)
    arr[:, 0] = first_col
    arr[:, 1:] = first_col[:, None].astype(np.int32) + np.cumsum(residuals[:, 1:].astype(np.int32), axis=1)
    return arr.astype(np.int16)


def predict_paeth(arr: np.ndarray) -> np.ndarray:
    """PNG Paeth predictor (vectorized with numpy).

    For pixel (i,j): a=left, b=above, c=upper-left
    p = a + b - c; pa=|p-a|, pb=|p-b|, pc=|p-c|
    predictor = a if pa<=pb and pa<=pc, else b if pb<=pc, else c
    """
    a32 = arr.astype(np.int32)
    h, w = a32.shape

    # Pad with zeros on top and left edges
    # padded[i+1, j+1] = arr[i, j]
    padded = np.zeros((h + 1, w + 1), dtype=np.int32)
    padded[1:, 1:] = a32

    # For pixel (i, j) in original → padded (i+1, j+1):
    a = padded[1:, :w]     # left: padded[i+1, j], shape (h, w)
    b = padded[:h, 1:]     # above: padded[i, j+1], shape (h, w)
    c = padded[:h, :w]     # upper-left: padded[i, j], shape (h, w)

    p = a + b - c
    pa = np.abs(p - a)
    pb = np.abs(p - b)
    pc = np.abs(p - c)

    # Paeth selection (vectorized)
    pred = np.where(
        (pa <= pb) & (pa <= pc), a,
        np.where(pb <= pc, b, c),
    )

    residuals_full = (a32 - pred).astype(np.int16)
    # Store only interior residuals (skip first row and first column)
    interior = residuals_full[1:, 1:]
    return interior, arr[0, :].copy(), arr[1:, 0].copy()


def reconstruct_paeth(residuals: np.ndarray, first_row: np.ndarray, first_col: np.ndarray) -> np.ndarray:
    """Reconstruct from Paeth residuals (pixel-by-pixel).

    residuals has shape (h-1, w-1) — interior only.
    first_row has shape (w,) — first row values.
    first_col has shape (h-1,) — first column (excluding first row).
    """
    h_inner, w_inner = residuals.shape
    h, w = h_inner + 1, w_inner + 1
    arr = np.zeros((h, w), dtype=np.int32)
    arr[0, :] = first_row
    arr[1:, 0] = first_col

    for i in range(1, h):
        for j in range(1, w):
            a = int(arr[i, j - 1])
            b = int(arr[i - 1, j])
            c = int(arr[i - 1, j - 1])
            p = a + b - c
            pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
            if pa <= pb and pa <= pc:
                pred = a
            elif pb <= pc:
                pred = b
            else:
                pred = c
            arr[i, j] = pred + int(residuals[i - 1, j - 1])

    return arr.astype(np.int16)


def predict_avg(arr: np.ndarray) -> np.ndarray:
    """Average predictor: predicted[i,j] = (left + above) // 2."""
    a32 = arr.astype(np.int32)
    h, w = a32.shape

    padded = np.zeros((h + 1, w + 1), dtype=np.int32)
    padded[1:, 1:] = a32

    a = padded[1:, :w]     # left
    b = padded[:h, 1:]     # above

    pred = (a + b) // 2
    residuals_full = (a32 - pred).astype(np.int16)
    interior = residuals_full[1:, 1:]
    return interior, arr[0, :].copy(), arr[1:, 0].copy()


def reconstruct_avg(residuals: np.ndarray, first_row: np.ndarray, first_col: np.ndarray) -> np.ndarray:
    """Reconstruct from average-prediction residuals (pixel-by-pixel)."""
    h_inner, w_inner = residuals.shape
    h, w = h_inner + 1, w_inner + 1
    arr = np.zeros((h, w), dtype=np.int32)
    arr[0, :] = first_row
    arr[1:, 0] = first_col

    for i in range(1, h):
        for j in range(1, w):
            pred = (int(arr[i, j - 1]) + int(arr[i - 1, j])) // 2
            arr[i, j] = pred + int(residuals[i - 1, j - 1])

    return arr.astype(np.int16)


def predict_gradient(arr: np.ndarray) -> np.ndarray:
    """Gradient predictor: predicted = left + above - upper-left."""
    a32 = arr.astype(np.int32)
    h, w = a32.shape

    padded = np.zeros((h + 1, w + 1), dtype=np.int32)
    padded[1:, 1:] = a32

    a = padded[1:, :w]     # left
    b = padded[:h, 1:]     # above
    c = padded[:h, :w]     # upper-left

    pred = a + b - c
    residuals_full = (a32 - pred).astype(np.int16)
    interior = residuals_full[1:, 1:]
    return interior, arr[0, :].copy(), arr[1:, 0].copy()


def reconstruct_gradient(residuals: np.ndarray, first_row: np.ndarray, first_col: np.ndarray) -> np.ndarray:
    """Reconstruct from gradient-prediction residuals (pixel-by-pixel)."""
    h_inner, w_inner = residuals.shape
    h, w = h_inner + 1, w_inner + 1
    arr = np.zeros((h, w), dtype=np.int32)
    arr[0, :] = first_row
    arr[1:, 0] = first_col

    for i in range(1, h):
        for j in range(1, w):
            pred = int(arr[i, j - 1]) + int(arr[i - 1, j]) - int(arr[i - 1, j - 1])
            arr[i, j] = pred + int(residuals[i - 1, j - 1])

    return arr.astype(np.int16)


# Predictor registry
PREDICTORS = {
    "left": (predict_left, reconstruct_left),
    "paeth": (predict_paeth, reconstruct_paeth),
    "avg": (predict_avg, reconstruct_avg),
    "gradient": (predict_gradient, reconstruct_gradient),
}

# ---------------------------------------------------------------------------
# Compressors
# ---------------------------------------------------------------------------


def compress_zstd(data: bytes, level: int) -> bytes:
    return zstd.ZstdCompressor(level=level).compress(data)


def decompress_zstd(data: bytes) -> bytes:
    return zstd.ZstdDecompressor().decompress(data, max_output_size=100_000_000)


def compress_brotli(data: bytes, quality: int) -> bytes:
    return brotli.compress(data, quality=quality)


def decompress_brotli(data: bytes) -> bytes:
    return brotli.decompress(data)


COMPRESSORS = {
    "zstd-9": (compress_zstd, decompress_zstd, 9),
    "zstd-19": (compress_zstd, decompress_zstd, 19),
    "brotli-4": (compress_brotli, decompress_brotli, 4),
    "brotli-9": (compress_brotli, decompress_brotli, 9),
    "brotli-11": (compress_brotli, decompress_brotli, 11),
}

# ---------------------------------------------------------------------------
# Quantization
# ---------------------------------------------------------------------------


def adaptive_quant_bits(elevation: np.ndarray, nodata: int = NODATA) -> int:
    """Select quantization bits based on terrain characteristics."""
    valid = elevation[elevation != nodata]
    if len(valid) == 0:
        return 8
    elev_range = int(valid.max()) - int(valid.min())
    std = float(valid.std())
    if elev_range < 100 or std < 10:
        return 8   # Flat: ~0.4m precision
    elif elev_range < 1000 and std < 100:
        return 10  # Hills: ~1.6m RMSE
    else:
        return 12  # Mountains: ~0.7m RMSE


def quantize(elevation: np.ndarray, bits: int, nodata: int = NODATA) -> np.ndarray:
    """Quantize elevation to given bit depth."""
    valid = elevation != nodata
    if not valid.any():
        return elevation.copy()
    min_e = int(elevation[valid].min())
    max_e = int(elevation[valid].max())
    scale = (2**bits - 1) / max(max_e - min_e, 1)
    result = elevation.copy().astype(np.float64)
    result[valid] = np.clip(np.round((elevation[valid].astype(np.float64) - min_e) * scale), 0, 2**bits - 1)
    return result.astype(np.int16)


def dequantize(arr: np.ndarray, bits: int, min_e: int, max_e: int, nodata: int = NODATA) -> np.ndarray:
    """Dequantize back to int16 elevation."""
    valid = arr != 0  # approximate valid mask
    scale = (2**bits - 1) / max(max_e - min_e, 1)
    result = np.zeros_like(arr, dtype=np.int16)
    result[valid] = (arr[valid].astype(np.float64) / scale + min_e).astype(np.int16)
    return result

# ---------------------------------------------------------------------------
# Image format tests (PNG, WebP)
# ---------------------------------------------------------------------------


def test_terrapng(arr: np.ndarray) -> dict:
    """Test Terrarium PNG encoding."""
    t0 = time.perf_counter()
    elevation = arr.astype(np.float32).copy()
    elevation[elevation == NODATA] = np.nan
    png_bytes = encode_tile(elevation)
    enc_ms = (time.perf_counter() - t0) * 1000

    t1 = time.perf_counter()
    decoded = decode_tile(png_bytes)
    dec_ms = (time.perf_counter() - t1) * 1000

    valid = arr != NODATA
    original_f = arr[valid].astype(np.float32)
    decoded_f = decoded[~np.isnan(decoded)]
    rmse = float(np.sqrt(np.mean((original_f[:len(decoded_f)] - decoded_f[:len(original_f)])**2))) if len(original_f) > 0 else 0

    return {
        "compressed_bytes": len(png_bytes),
        "encode_ms": round(enc_ms, 1),
        "decode_ms": round(dec_ms, 1),
        "rmse": round(rmse, 4),
        "lossless": rmse < 0.01,
    }


def test_webp_lossless(arr: np.ndarray) -> dict:
    """Test WebP lossless encoding of Terrarium RGB data."""
    elevation = arr.astype(np.float32).copy()
    elevation[elevation == NODATA] = np.nan

    # Build Terrarium RGB
    h, w = arr.shape
    flat = elevation.flatten().astype(np.float64)
    valid = ~np.isnan(flat)
    shifted = np.zeros_like(flat)
    shifted[valid] = np.clip(flat[valid] + 32768.0, 0, 65535)

    r = np.zeros(len(flat), dtype=np.uint8)
    g = np.zeros(len(flat), dtype=np.uint8)
    b = np.zeros(len(flat), dtype=np.uint8)
    r[valid] = np.floor(shifted[valid] / 256.0).astype(np.uint8)
    g[valid] = (shifted[valid] % 256).astype(np.uint8)
    b[valid] = np.floor((shifted[valid] - np.floor(shifted[valid])) * 256).astype(np.uint8)
    rgb = np.stack([r, g, b], axis=-1).reshape(h, w, 3)

    img = Image.fromarray(rgb, mode="RGB")

    t0 = time.perf_counter()
    buf = io.BytesIO()
    img.save(buf, format="WEBP", lossless=True, method=6)
    webp_bytes = buf.getvalue()
    enc_ms = (time.perf_counter() - t0) * 1000

    t1 = time.perf_counter()
    decoded_img = Image.open(io.BytesIO(webp_bytes)).convert("RGB")
    dec_ms = (time.perf_counter() - t1) * 1000

    decoded_arr = np.array(decoded_img)
    dr = decoded_arr[:, :, 0].astype(np.float64)
    dg = decoded_arr[:, :, 1].astype(np.float64)
    db = decoded_arr[:, :, 2].astype(np.float64)
    decoded_elev = (dr * 256 + dg + db / 256 - 32768).astype(np.float32)

    orig_valid = arr != NODATA
    original_f = arr[orig_valid].astype(np.float32)
    decoded_f = decoded_elev[orig_valid]
    n = min(len(original_f), len(decoded_f))
    rmse = float(np.sqrt(np.mean((original_f[:n] - decoded_f[:n])**2))) if n > 0 else 0

    return {
        "compressed_bytes": len(webp_bytes),
        "encode_ms": round(enc_ms, 1),
        "decode_ms": round(dec_ms, 1),
        "rmse": round(rmse, 4),
        "lossless": rmse < 0.01,
    }

# ---------------------------------------------------------------------------
# Strategy runner
# ---------------------------------------------------------------------------


# 2D predictors require pixel-by-pixel reconstruction — use 256x256 sub-tiles
TILE_SIZE_2D = 256
SLOW_PREDICTORS = {"paeth", "avg", "gradient"}


def run_strategy(arr: np.ndarray, strategy_name: str) -> dict | None:
    """Run a single compression strategy and return metrics."""
    raw_size = arr.nbytes  # int16 bytes
    valid = arr != NODATA

    # Subsample to 256x256 for slow 2D predictors
    parts_q = strategy_name.split("_q")
    base = parts_q[0]
    comp_parts = base.rsplit("_", 1)
    pred_name = comp_parts[0]
    is_slow = pred_name in SLOW_PREDICTORS

    sub_tiled = False
    if is_slow and arr.shape[0] > TILE_SIZE_2D:
        # Extract center 256x256 sub-tile
        cy, cx = arr.shape[0] // 2, arr.shape[1] // 2
        half = TILE_SIZE_2D // 2
        arr = arr[cy - half : cy + half, cx - half : cx + half]
        raw_size = arr.nbytes
        valid = arr != NODATA
        sub_tiled = True

    # --- Image formats ---
    if strategy_name == "terrapng":
        r = test_terrapng(arr)
        return {**r, "raw_bytes": raw_size, "strategy": strategy_name}

    if strategy_name == "webp_lossless":
        r = test_webp_lossless(arr)
        return {**r, "raw_bytes": raw_size, "strategy": strategy_name}

    # --- Prediction + compressor combinations ---
    quant_bits = int(parts_q[1]) if len(parts_q) > 1 else None
    comp_name = comp_parts[1] if len(comp_parts) > 1 else "zstd-9"

    if pred_name not in PREDICTORS or comp_name not in COMPRESSORS:
        return None

    predict_fn, _reconstruct_fn = PREDICTORS[pred_name]
    comp_fn, decomp_fn, comp_level = COMPRESSORS[comp_name]

    # Adaptive quantization
    if quant_bits == 0:
        quant_bits = adaptive_quant_bits(arr, NODATA)

    # Work on copy
    work = arr.copy()
    orig_min_e = 0
    if quant_bits and quant_bits < 16 and valid.any():
        orig_min_e = int(arr[valid].min())
        orig_max_e = int(arr[valid].max())
        work = quantize(work, quant_bits)

    # Predict
    t0 = time.perf_counter()
    residuals, boundary_a, boundary_b = predict_fn(work)
    pred_ms = (time.perf_counter() - t0) * 1000

    # Pack residuals + boundary
    if boundary_b is not None:
        packed = boundary_a.tobytes() + boundary_b.tobytes() + residuals.tobytes()
    else:
        packed = boundary_a.tobytes() + residuals.tobytes()

    # Compress
    t1 = time.perf_counter()
    compressed = comp_fn(packed, comp_level)
    comp_ms = (time.perf_counter() - t1) * 1000
    enc_ms = pred_ms + comp_ms

    # Decompress
    t2 = time.perf_counter()
    decompressed = decomp_fn(compressed)
    dec_ms_raw = (time.perf_counter() - t2) * 1000

    # Unpack
    has_two_boundaries = boundary_b is not None
    if has_two_boundaries:
        # first_row + first_col + interior residuals (shape: h-1 x w-1)
        n_first_row = arr.shape[1] * 2  # int16
        n_first_col = (arr.shape[0] - 1) * 2
        ba = np.frombuffer(decompressed[:n_first_row], dtype=np.int16)
        bb = np.frombuffer(decompressed[n_first_row:n_first_row + n_first_col], dtype=np.int16)
        residuals_dec = np.frombuffer(decompressed[n_first_row + n_first_col:], dtype=np.int16).reshape(arr.shape[0] - 1, arr.shape[1] - 1)
    else:
        # first_col only (left predictor)
        ba = np.frombuffer(decompressed[:boundary_a.nbytes], dtype=np.int16)
        residuals_dec = np.frombuffer(decompressed[boundary_a.nbytes:], dtype=np.int16).reshape(arr.shape)

    # Reconstruct
    _reconstruct = PREDICTORS[pred_name][1]
    if has_two_boundaries:
        reconstructed = _reconstruct(residuals_dec, ba, bb)
    else:
        reconstructed = _reconstruct(residuals_dec, ba, None)

    dec_ms = dec_ms_raw + (time.perf_counter() - t2) * 1000 - dec_ms_raw

    # Compute accuracy
    is_lossy = quant_bits is not None and quant_bits < 16
    if is_lossy:
        # Dequantize before computing error
        scale = (2**quant_bits - 1) / max(orig_max_e - orig_min_e, 1)
        dequant = np.zeros_like(reconstructed, dtype=np.int16)
        qvalid = reconstructed != 0
        dequant[qvalid] = (reconstructed[qvalid].astype(np.float64) / scale + orig_min_e).astype(np.int16)
        err = compute_rmse(arr, dequant, NODATA)
        slope = compute_slope_deviation(arr, dequant, 30.0, NODATA)
    else:
        err = {"rmse": 0.0, "mae": 0.0, "max_error": 0.0}
        slope = {"slope_rmse_deg": 0.0}

    return {
        "strategy": strategy_name,
        "raw_bytes": raw_size,
        "compressed_bytes": len(compressed),
        "ratio": round(raw_size / max(len(compressed), 1), 2),
        "encode_ms": round(enc_ms, 1),
        "decode_ms": round(dec_ms, 1),
        "rmse": round(err["rmse"], 4),
        "mae": round(err.get("mae", 0), 4),
        "max_error": round(err.get("max_error", 0), 4),
        "slope_rmse_deg": round(slope.get("slope_rmse_deg", 0), 4),
        "lossless": not is_lossy,
        "quant_bits": quant_bits,
    }


# ---------------------------------------------------------------------------
# Strategy list
# ---------------------------------------------------------------------------

def build_strategies() -> list[str]:
    """Build the full list of strategies to test."""
    strategies = [
        # Baseline formats
        "terrapng",
        "webp_lossless",
    ]

    # Predictor x compressor matrix
    predictors = ["left", "paeth", "avg", "gradient"]
    compressors = ["zstd-9", "zstd-19", "brotli-4", "brotli-9", "brotli-11"]

    for pred in predictors:
        for comp in compressors:
            strategies.append(f"{pred}_{comp}")

    # Quantized variants (fixed bits)
    for pred in ["left", "paeth"]:
        for comp in ["zstd-9", "zstd-19", "brotli-11"]:
            for q in [8, 10, 12]:
                strategies.append(f"{pred}_{comp}_q{q}")

    # Adaptive quantization
    for pred in ["left", "paeth"]:
        for comp in ["zstd-9", "zstd-19", "brotli-11"]:
            strategies.append(f"{pred}_{comp}_q0")  # q0 = adaptive

    return strategies

# ---------------------------------------------------------------------------
# Main benchmark
# ---------------------------------------------------------------------------


def run_benchmark(output_dir: str, tiles: dict | None = None, max_tiles: int | None = None):
    os.makedirs(output_dir, exist_ok=True)

    tile_list = tiles or REPRESENTATIVE_TILES
    if max_tiles:
        tile_list = dict(list(tile_list.items())[:max_tiles])

    strategies = build_strategies()
    print(f"Benchmarking {len(strategies)} strategies across {len(tile_list)} terrain types\n")

    all_results = []

    for terrain_label, fname in tile_list.items():
        src_path = os.path.join(SRTM_DIR, fname)
        if not os.path.exists(src_path):
            print(f"  SKIP {fname} (not found)")
            continue

        arr = load_geotiff(src_path)
        src_size = os.path.getsize(src_path)
        valid = arr != NODATA
        if not valid.any():
            continue

        terrain = classify_terrain(arr)
        bounds = srtm_filename_to_bounds(fname)
        elev_range = int(arr[valid].max()) - int(arr[valid].min())
        std = float(arr[valid].std())

        print(f"\n{'=' * 80}")
        print(f"  {fname} ({terrain_label}) — {terrain}")
        print(f"  Shape: {arr.shape}, Range: {elev_range}m, Std: {std:.1f}m")
        print(f"  {'Strategy':<28} {'Size':>8} {'Ratio':>6} {'Enc':>7} {'Dec':>7} {'RMSE':>8} {'Slope°':>7} {'Type':>12}")
        print(f"  {'-' * 80}")

        tile_results = []
        for sname in strategies:
            try:
                r = run_strategy(arr, sname)
                if r is None:
                    continue

                r["source_bytes"] = src_size
                r["reduction_pct"] = round((1 - r["compressed_bytes"] / r["raw_bytes"]) * 100, 2)

                # Format display
                sz = f"{r['compressed_bytes'] / 1024:.1f}K"
                ratio = f"{r['ratio']:.1f}x" if "ratio" in r else "N/A"
                enc = f"{r['encode_ms']:.0f}ms"
                dec = f"{r['decode_ms']:.0f}ms"
                rmse = f"{r['rmse']:.3f}m" if r["rmse"] > 0 else "0"
                slope = f"{r.get('slope_rmse_deg', 0):.2f}°" if r.get("slope_rmse_deg", 0) > 0 else "0"
                typ = "LOSSLESS" if r["lossless"] else f"Q{r.get('quant_bits', '?')}"

                print(f"  {sname:<28} {sz:>8} {ratio:>6} {enc:>7} {dec:>7} {rmse:>8} {slope:>7} {typ:>12}")
                tile_results.append(r)
            except Exception as e:
                tile_results.append({"strategy": sname, "error": str(e)})

        tile_results.sort(key=lambda x: x.get("compressed_bytes", float("inf")))
        all_results.append({
            "tile": fname,
            "terrain_label": terrain_label,
            "terrain_type": terrain,
            "bounds": bounds,
            "source_bytes": src_size,
            "elevation_range": elev_range,
            "elevation_std": round(std, 2),
            "strategies": tile_results,
        })

    # Save full results
    results_path = os.path.join(output_dir, "benchmark_v2_results.json")
    with open(results_path, "w") as f:
        json.dump(all_results, f, indent=2)
    print(f"\n\nFull results: {results_path}")

    # Summary
    _print_summary(all_results, output_dir)
    return all_results


def _print_summary(all_results: list, output_dir: str):
    """Print cross-terrain summary and recommendations."""
    print("\n" + "=" * 100)
    print("CROSS-TERRAIN SUMMARY")
    print("=" * 100)

    stats = {}
    for tile in all_results:
        for r in tile["strategies"]:
            if "error" in r:
                continue
            name = r["strategy"]
            if name not in stats:
                stats[name] = {
                    "count": 0, "total_raw": 0, "total_comp": 0,
                    "rmse_sum": 0, "max_rmse": 0, "slope_sum": 0,
                    "enc_sum": 0, "dec_sum": 0, "lossless_count": 0,
                }
            s = stats[name]
            s["count"] += 1
            s["total_raw"] += r.get("raw_bytes", 0)
            s["total_comp"] += r["compressed_bytes"]
            s["rmse_sum"] += r.get("rmse", 0)
            s["max_rmse"] = max(s["max_rmse"], r.get("rmse", 0))
            s["slope_sum"] += r.get("slope_rmse_deg", 0)
            s["enc_sum"] += r.get("encode_ms", 0)
            s["dec_sum"] += r.get("decode_ms", 0)
            if r.get("lossless"):
                s["lossless_count"] += 1

    summary = []
    for name, s in stats.items():
        avg_ratio = s["total_raw"] / s["total_comp"] if s["total_comp"] > 0 else 0
        avg_enc = s["enc_sum"] / s["count"] if s["count"] > 0 else 0
        avg_dec = s["dec_sum"] / s["count"] if s["count"] > 0 else 0
        summary.append({
            "strategy": name,
            "tiles": s["count"],
            "avg_ratio": round(avg_ratio, 2),
            "avg_compressed_kb": round(s["total_comp"] / s["count"] / 1024, 1),
            "avg_rmse": round(s["rmse_sum"] / s["count"], 4),
            "max_rmse": round(s["max_rmse"], 4),
            "avg_slope_deg": round(s["slope_sum"] / s["count"], 4),
            "avg_enc_ms": round(avg_enc, 1),
            "avg_dec_ms": round(avg_dec, 1),
            "lossless": s["lossless_count"] == s["count"],
        })

    # Sort: lossless first (by ratio desc), then lossy (by RMSE asc)
    summary.sort(key=lambda x: (not x["lossless"], x["avg_rmse"] if not x["lossless"] else -x["avg_ratio"]))

    print(f"\n{'Strategy':<28} {'Avg KB':>8} {'Ratio':>6} {'RMSE':>8} {'MaxRMSE':>8} {'Slope°':>7} {'Enc':>7} {'Dec':>7} {'LL':>3}")
    print("-" * 95)
    for s in summary:
        ll = "Y" if s["lossless"] else "N"
        rmse = f"{s['avg_rmse']:.3f}m" if s["avg_rmse"] > 0 else "0"
        max_rmse = f"{s['max_rmse']:.3f}m" if s["max_rmse"] > 0 else "0"
        slope = f"{s['avg_slope_deg']:.2f}°" if s["avg_slope_deg"] > 0 else "0"
        print(
            f"{s['strategy']:<28} {s['avg_compressed_kb']:>7.1f}K {s['avg_ratio']:>5.1f}x "
            f"{rmse:>8} {max_rmse:>8} {slope:>7} {s['avg_enc_ms']:>6.0f}ms {s['avg_dec_ms']:>6.0f}ms {ll:>3}"
        )

    # Save summary
    summary_path = os.path.join(output_dir, "benchmark_v2_summary.json")
    with open(summary_path, "w") as f:
        json.dump(summary, f, indent=2)

    # Recommendations
    print("\n" + "=" * 100)
    print("RECOMMENDATIONS")
    print("=" * 100)

    # Best lossless by size
    lossless = [s for s in summary if s["lossless"]]
    if lossless:
        best_ll = min(lossless, key=lambda x: x["avg_compressed_kb"])
        print(f"\n  BEST LOSSLESS:          {best_ll['strategy']}")
        print(f"    Average size: {best_ll['avg_compressed_kb']:.1f}KB ({best_ll['avg_ratio']:.1f}x ratio)")
        print(f"    Encode: {best_ll['avg_enc_ms']:.0f}ms, Decode: {best_ll['avg_dec_ms']:.0f}ms")

    # Best near-lossless (<1m RMSE)
    nl = [s for s in summary if not s["lossless"] and s["avg_rmse"] < 1.0]
    if nl:
        best_nl = min(nl, key=lambda x: x["avg_compressed_kb"])
        print(f"\n  BEST NEAR-LOSSLESS (<1m): {best_nl['strategy']}")
        print(f"    Average size: {best_nl['avg_compressed_kb']:.1f}KB, RMSE: {best_nl['avg_rmse']:.3f}m")

    # Best balanced (1-6m)
    bal = [s for s in summary if not s["lossless"] and 1.0 <= s["avg_rmse"] < 6.0]
    if bal:
        best_bal = min(bal, key=lambda x: x["avg_compressed_kb"])
        print(f"\n  BEST BALANCED (1-6m):    {best_bal['strategy']}")
        print(f"    Average size: {best_bal['avg_compressed_kb']:.1f}KB, RMSE: {best_bal['avg_rmse']:.3f}m")

    # Predictor comparison (lossless, zstd-19)
    print("\n  PREDICTOR COMPARISON (lossless, zstd-19):")
    pred_strats = [s for s in summary if s["lossless"] and "_zstd-19" in s["strategy"]]
    for s in pred_strats:
        pred = s["strategy"].rsplit("_zstd", 1)[0]
        print(f"    {pred:<15} {s['avg_compressed_kb']:.1f}KB ({s['avg_ratio']:.1f}x)")

    # Compressor comparison (lossless, left-predict)
    print("\n  COMPRESSOR COMPARISON (lossless, left-predict):")
    comp_strats = [s for s in summary if s["lossless"] and s["strategy"].startswith("left_")]
    for s in comp_strats:
        comp = s["strategy"][5:]
        print(f"    {comp:<15} {s['avg_compressed_kb']:.1f}KB ({s['avg_ratio']:.1f}x)")

    # WebP vs PNG
    print("\n  IMAGE FORMAT COMPARISON:")
    for s in summary:
        if s["strategy"] in ("terrapng", "webp_lossless"):
            print(f"    {s['strategy']:<15} {s['avg_compressed_kb']:.1f}KB ({s['avg_ratio']:.1f}x)")

    # Adaptive vs fixed quantization
    print("\n  ADAPTIVE vs FIXED QUANTIZATION (paeth + brotli-11):")
    for s in summary:
        if "paeth_brotli-11" in s["strategy"]:
            q = s["strategy"].split("_q")[-1] if "_q" in s["strategy"] else "16"
            label = "adaptive" if q == "0" else f"Q{q}"
            print(f"    {label:<15} {s['avg_compressed_kb']:.1f}KB, RMSE: {s['avg_rmse']:.3f}m")


def main():
    parser = argparse.ArgumentParser(description="DEM Compression Benchmark v2")
    parser.add_argument("--output", default=None)
    parser.add_argument("--max", type=int, default=None)
    args = parser.parse_args()

    output_dir = args.output or os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        "tests", "results",
    )

    tiles = REPRESENTATIVE_TILES
    if args.max:
        tiles = dict(list(tiles.items())[: args.max])

    run_benchmark(output_dir=output_dir, tiles=tiles)


if __name__ == "__main__":
    main()
