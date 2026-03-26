#!/usr/bin/env python3
"""
Phase 2 Benchmark: Comprehensive compression experiment for SRTM 30m data.

Usage:
    python scripts/benchmark.py [--output DIR] [--max N]
"""

import argparse
import bz2
import gzip
import json
import lzma
import os
import sys
import time

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import zstandard as zstd
from openzenith.geo_utils import (
    classify_terrain,
    compute_rmse,
    compute_slope_deviation,
    load_geotiff,
    srtm_filename_to_bounds,
)
from openzenith.tile_format import (
    COMP_ZSTD,
    COMP_ZSTD_PREDICT,
    decode,
    encode,
)

SRTM_DIR = "/nas/Temp/DEMs/data/srtm30m"

REPRESENTATIVE_TILES = {
    "ocean_pacific": "N00E165.tif",
    "coast_flat": "N30W081.tif",
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

# Compression strategies: (name, compression_mode, zstd_level, quantize_bits)
STRATEGIES = [
    # --- Standard compressors (on raw int16 bytes) ---
    ("gzip9", "gzip", 9, None),
    ("bz2_9", "bz2", 9, None),
    ("lzma9", "lzma", 9, None),
    ("zstd_6", "zstd", 6, None),
    ("zstd_9", "zstd", 9, None),
    ("zstd_19", "zstd", 19, None),
    # --- OZT1 signal compression ---
    ("ozt1_predict_9", COMP_ZSTD_PREDICT, 9, None),
    ("ozt1_predict_19", COMP_ZSTD_PREDICT, 19, None),
    # --- OZT1 quantized (near-lossless) ---
    ("ozt1_q14_9", COMP_ZSTD, 9, 14),
    ("ozt1_q12_9", COMP_ZSTD, 9, 12),
    ("ozt1_q10_9", COMP_ZSTD, 9, 10),
    ("ozt1_q8_9", COMP_ZSTD, 9, 8),
    ("ozt1_q14_19", COMP_ZSTD, 19, 14),
    ("ozt1_q12_19", COMP_ZSTD, 19, 12),
    ("ozt1_q10_19", COMP_ZSTD, 19, 10),
    ("ozt1_q8_19", COMP_ZSTD, 19, 8),
]


def compress_raw(arr, strategy):
    """Compress using raw byte-level compressors."""
    raw = arr.astype(np.int16).tobytes()
    _name, method, level, _ = strategy

    if method == "gzip":
        t0 = time.time()
        c = gzip.compress(raw, compresslevel=level)
        return c, time.time() - t0, None
    elif method == "bz2":
        t0 = time.time()
        c = bz2.compress(raw, compresslevel=level)
        return c, time.time() - t0, None
    elif method == "lzma":
        t0 = time.time()
        c = lzma.compress(raw, preset=level)
        return c, time.time() - t0, None
    elif method == "zstd":
        t0 = time.time()
        c = zstd.ZstdCompressor(level=level).compress(raw)
        return c, time.time() - t0, None
    return raw, 0.0, None


def run_benchmark(output_dir, tiles=None, max_tiles=None):
    os.makedirs(output_dir, exist_ok=True)
    tile_list = tiles or REPRESENTATIVE_TILES
    if max_tiles:
        tile_list = dict(list(tile_list.items())[:max_tiles])

    all_results = []

    for terrain_label, fname in tile_list.items():
        src_path = os.path.join(SRTM_DIR, fname)
        if not os.path.exists(src_path):
            continue

        arr = load_geotiff(src_path)
        src_size = os.path.getsize(src_path)
        nodata = -32768
        valid = arr != nodata
        if not valid.any():
            continue

        terrain = classify_terrain(arr)
        bounds = srtm_filename_to_bounds(fname)
        print(f"\n{'=' * 60}")
        print(f"Tile: {fname} ({terrain_label}) - {terrain}")
        print(f"  Shape: {arr.shape}, File: {src_size / 1e6:.1f}MB, Elev: [{arr[valid].min()}..{arr[valid].max()}]m")

        tile_results = []
        for strategy in STRATEGIES:
            name, method, level, qbits = strategy
            try:
                if method in ("gzip", "bz2", "lzma", "zstd"):
                    compressed, enc_time, _ = compress_raw(arr, strategy)
                    dec_time = 0.0
                    err = {"rmse": 0.0, "mae": 0.0, "max_error": 0.0}
                    slope_dev = {"slope_rmse_deg": 0.0}
                    lossless = True
                    compressed_size = len(compressed)
                else:
                    # OZT1 format
                    comp_mode = method
                    t0 = time.time()
                    encoded = encode(
                        arr, compression=comp_mode, zstd_level=level, quantize_bits=qbits, nodata_value=nodata
                    )
                    enc_time = time.time() - t0

                    t1 = time.time()
                    decoded, _meta = decode(encoded)
                    dec_time = time.time() - t1

                    compressed_size = len(encoded)
                    err = compute_rmse(arr, decoded, nodata)
                    slope_dev = compute_slope_deviation(arr, decoded, 30.0, nodata)
                    lossless = qbits is None and err["rmse"] == 0.0

                result = {
                    "strategy": name,
                    "compressed_bytes": compressed_size,
                    "ratio": round(src_size / compressed_size, 2),
                    "reduction_pct": round((1 - compressed_size / src_size) * 100, 2),
                    "encode_time_s": round(enc_time, 3),
                    "decode_time_s": round(dec_time, 3),
                    "lossless": lossless,
                    "rmse": round(err["rmse"], 4),
                    "mae": round(err["mae"], 4),
                    "max_error": round(err["max_error"], 4),
                    "slope_rmse_deg": round(slope_dev.get("slope_rmse_deg", 0), 4),
                }
                tile_results.append(result)

            except Exception as e:
                tile_results.append({"strategy": name, "error": str(e)})

        tile_results.sort(key=lambda x: x.get("compressed_bytes", 0))

        print(
            f"\n  {'Strategy':<22} {'Size':>9} {'Ratio':>6} {'Reduce':>7} "
            f"{'RMSE':>8} {'Enc':>6} {'Dec':>6} {'Type':>10}"
        )
        print(f"  {'-' * 72}")
        for r in tile_results:
            if "error" in r:
                print(f"  {r['strategy']:<22} ERROR: {r['error'][:50]}")
                continue
            typ = "LOSSLESS" if r["lossless"] else f"RMSE={r['rmse']:.2f}m"
            print(
                f"  {r['strategy']:<22} {r['compressed_bytes'] / 1024:>8.1f}K "
                f"{r['ratio']:>5.1f}x {r['reduction_pct']:>6.1f}% "
                f"{r['rmse']:>7.3f}m {r['encode_time_s']:>5.2f}s {r['decode_time_s']:>5.2f}s {typ:>10}"
            )

        all_results.append(
            {
                "tile": fname,
                "terrain_label": terrain_label,
                "terrain_type": terrain,
                "bounds": bounds,
                "source_bytes": src_size,
                "shape": list(arr.shape),
                "elevation_range": [int(arr[valid].min()), int(arr[valid].max())],
                "strategies": tile_results,
            }
        )

    # Save and summarize
    output_path = os.path.join(output_dir, "benchmark_results.json")
    with open(output_path, "w") as f:
        json.dump(all_results, f, indent=2)
    print(f"\n\nFull results saved to {output_path}")
    _print_summary(all_results, output_dir)
    return all_results


def _print_summary(all_results, output_dir):
    print("\n" + "=" * 90)
    print("PHASE 2 BENCHMARK - CROSS-TERRAIN SUMMARY")
    print("=" * 90)

    strategy_stats = {}
    for tile in all_results:
        for r in tile["strategies"]:
            if "error" in r:
                continue
            name = r["strategy"]
            if name not in strategy_stats:
                strategy_stats[name] = {
                    "count": 0,
                    "total_source": 0,
                    "total_compressed": 0,
                    "rmse_sum": 0,
                    "max_rmse": 0,
                    "slope_sum": 0,
                    "enc_sum": 0,
                    "dec_sum": 0,
                    "lossless_count": 0,
                }
            s = strategy_stats[name]
            s["count"] += 1
            s["total_source"] += r.get("source_bytes", 0)
            s["total_compressed"] += r["compressed_bytes"]
            s["rmse_sum"] += r["rmse"]
            s["max_rmse"] = max(s["max_rmse"], r["rmse"])
            s["slope_sum"] += r["slope_rmse_deg"]
            s["enc_sum"] += r["encode_time_s"]
            s["dec_sum"] += r["decode_time_s"]
            if r["lossless"]:
                s["lossless_count"] += 1

    summary = []
    for name, s in strategy_stats.items():
        avg_ratio = s["total_source"] / s["total_compressed"] if s["total_compressed"] > 0 else 0
        avg_reduction = (1 - s["total_compressed"] / s["total_source"]) * 100 if s["total_source"] > 0 else 0
        summary.append(
            {
                "strategy": name,
                "tiles": s["count"],
                "avg_ratio": round(avg_ratio, 2),
                "avg_reduction_pct": round(avg_reduction, 2),
                "avg_rmse": round(s["rmse_sum"] / s["count"], 4),
                "max_rmse": round(s["max_rmse"], 4),
                "avg_slope_deg": round(s["slope_sum"] / s["count"], 4),
                "avg_enc_s": round(s["enc_sum"] / s["count"], 3),
                "avg_dec_s": round(s["dec_sum"] / s["count"], 3),
                "lossless": s["lossless_count"] == s["count"],
            }
        )

    summary.sort(key=lambda x: x["avg_rmse"] if x["avg_rmse"] > 0 else -1)

    print(
        f"\n{'Strategy':<22} {'Tiles':>5} {'Ratio':>6} {'Reduce':>7} "
        f"{'RMSE':>8} {'MaxRMSE':>8} {'Slope°':>7} {'Enc':>5} {'Dec':>5} {'LL':>3}"
    )
    print("-" * 85)
    for s in summary:
        ll = "Y" if s["lossless"] else "N"
        print(
            f"{s['strategy']:<22} {s['tiles']:>5} {s['avg_ratio']:>5.1f}x "
            f"{s['avg_reduction_pct']:>6.1f}% {s['avg_rmse']:>7.4f}m "
            f"{s['max_rmse']:>7.4f}m {s['avg_slope_deg']:>6.2f}° "
            f"{s['avg_enc_s']:>4.1f}s {s['avg_dec_s']:>4.1f}s {ll:>3}"
        )

    # Save summary
    summary_path = os.path.join(output_dir, "benchmark_summary.json")
    with open(summary_path, "w") as f:
        json.dump(summary, f, indent=2)

    # Recommendations
    print("\n" + "=" * 90)
    print("RECOMMENDATIONS")
    print("=" * 90)

    lossless = [s for s in summary if s["lossless"]]
    if lossless:
        best_ll = min(lossless, key=lambda x: x["avg_reduction_pct"])
        print(
            f"\n  LOSSLESS:    {best_ll['strategy']} - {best_ll['avg_reduction_pct']}% reduction, "
            f"{best_ll['avg_enc_s']}s enc, {best_ll['avg_dec_s']}s dec"
        )

    nl = [s for s in summary if not s["lossless"] and s["avg_rmse"] < 1.0]
    if nl:
        best_nl = min(nl, key=lambda x: x["avg_reduction_pct"])
        print(
            f"  NEAR-LOSSLESS (<1m): {best_nl['strategy']} - {best_nl['avg_reduction_pct']}% reduction, "
            f"RMSE={best_nl['avg_rmse']}m"
        )

    ag = [s for s in summary if not s["lossless"] and 1.0 <= s["avg_rmse"] < 6.0]
    if ag:
        best_ag = min(ag, key=lambda x: x["avg_reduction_pct"])
        print(
            f"  BALANCED (1-6m): {best_ag['strategy']} - {best_ag['avg_reduction_pct']}% reduction, "
            f"RMSE={best_ag['avg_rmse']}m"
        )

    vis = [s for s in summary if not s["lossless"] and s["avg_rmse"] >= 6.0]
    if vis:
        best_vis = min(vis, key=lambda x: x["avg_reduction_pct"])
        print(
            f"  VISUAL (6m+): {best_vis['strategy']} - {best_vis['avg_reduction_pct']}% reduction, "
            f"RMSE={best_vis['avg_rmse']}m"
        )

    # Full dataset estimate
    total_tiles = 14296
    if lossless:
        best = best_ll
        avg_out = sum(
            r["compressed_bytes"]
            for t in all_results
            for r in t["strategies"]
            if r["strategy"] == best["strategy"] and "error" not in r
        ) / max(best["tiles"], 1)
        print(f"\n  FULL DATASET ESTIMATE ({best['strategy']}):")
        print(f"    {total_tiles} tiles x {avg_out / 1e6:.1f}MB = ~{total_tiles * avg_out / 1e9:.0f}GB")
        avg_src = sum(t["source_bytes"] for t in all_results) / len(all_results)
        print(f"    Source: {total_tiles} tiles x {avg_src / 1e6:.1f}MB = ~{total_tiles * avg_src / 1e9:.0f}GB")


def main():
    parser = argparse.ArgumentParser(description="Phase 2 Benchmark")
    parser.add_argument("--output", default=None)
    parser.add_argument("--max", type=int, default=None)
    args = parser.parse_args()

    if args.output is None:
        project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        args.output = os.path.join(project_root, "data", "benchmark")

    tiles = REPRESENTATIVE_TILES
    if args.max:
        tiles = dict(list(tiles.items())[: args.max])

    run_benchmark(output_dir=args.output, tiles=tiles)


if __name__ == "__main__":
    main()
