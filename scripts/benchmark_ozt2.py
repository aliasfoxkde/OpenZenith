#!/usr/bin/env python3
"""Benchmark OZT2 format against real Terrarium PNG tiles.

Tests:
1. Roundtrip fidelity (RMSE, max error)
2. Compression ratio vs Terrarium PNG and WebP
3. Per-terrain-type analysis
4. Bit depth distribution
5. Decode time estimates

Usage:
    python scripts/benchmark_ozt2.py
    python scripts/benchmark_ozt2.py --tiles 200
    python scripts/benchmark_ozt2.py --verbose
"""

import argparse
import os
import sys
import time
import json
import random

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from openzenith.tile_format_v2 import (
    encode,
    decode,
    auto_encode,
    validate_roundtrip,
    PRED_GRADIENT,
    PRED_LEFT,
    COMP_BROTLI,
    COMP_ZSTD,
    COMP_ZLIB,
)


def find_tiles(base_dir: str, max_tiles: int = 100):
    """Find Terrarium PNG tiles across all zoom levels."""
    tiles = []
    for z in [7, 8, 9, 10]:
        zdir = os.path.join(base_dir, str(z))
        if not os.path.isdir(zdir):
            continue
        for subdir in sorted(os.listdir(zdir))[:15]:
            pdir = os.path.join(zdir, subdir)
            if not os.path.isdir(pdir):
                continue
            for f in sorted(os.listdir(pdir)):
                if f.endswith(".png"):
                    path = os.path.join(pdir, f)
                    if os.path.getsize(path) > 5000:
                        tiles.append((path, z))
    random.shuffle(tiles)
    return tiles[:max_tiles]


def decode_territorium(path: str) -> tuple[np.ndarray, np.ndarray]:
    """Decode Terrarium PNG to int16 elevation array."""
    img = Image.open(path)
    px = np.array(img)
    r = px[:, :, 0].astype(np.int32)
    g = px[:, :, 1].astype(np.int32)
    elev = np.clip(r * 256 + g - 32768, -32768, 32767).astype(np.int16)
    valid = ~((px[:, :, 0] == 0) & (px[:, :, 1] == 0) & (px[:, :, 2] == 0))
    return elev, valid


def classify_terrain(elev: np.ndarray, valid: np.ndarray, vrange: int) -> str:
    """Classify terrain based on elevation range."""
    if not valid.any():
        return "nodata"
    if elev[valid].max() < 0:
        return "ocean"
    if vrange < 50:
        return "flat"
    if vrange < 200:
        return "lowland"
    if vrange < 1000:
        return "hills"
    if vrange < 3000:
        return "mountain"
    return "high_mountain"


def run_benchmark(tiles: list, verbose: bool = False):
    """Run comprehensive benchmark."""
    print(f"OZT2 Benchmark — {len(tiles)} tiles")
    print("=" * 100)

    results = []
    bit_distribution = {b: 0 for b in range(8, 17)}
    terrain_stats = {}
    total_encode_time = 0
    total_decode_time = 0

    for i, (path, z) in enumerate(tiles):
        elev, valid = decode_territorium(path)
        h, w = elev.shape
        png_size = os.path.getsize(path)

        if valid.any():
            vmin = int(elev[valid].min())
            vmax = int(elev[valid].max())
            vrange = vmax - vmin
        else:
            vmin, vmax, vrange = 0, 0, 0

        terrain = classify_terrain(elev, valid, vrange)

        # Encode with OZT2 (adaptive)
        t0 = time.perf_counter()
        encoded = encode(elev, bits_per_pixel=None, predictor=PRED_GRADIENT)
        encode_time = time.perf_counter() - t0

        # Decode
        t0 = time.perf_counter()
        decoded, meta = decode(encoded)
        decode_time = time.perf_counter() - t0

        # Validate
        is_lossless, rmse, _ = validate_roundtrip(elev, bits_per_pixel=meta["bits_per_pixel"])

        # Auto-encode (threshold-based)
        auto_enc, auto_meta = auto_encode(elev, max_rmse=1.0)

        # WebP (if available)
        webp_size = None
        try:
            buf = __import__("io").BytesIO()
            Image.open(path).save(buf, format="WEBP", lossless=True)
            webp_size = buf.tell()
        except Exception:
            pass

        total_encode_time += encode_time
        total_decode_time += decode_time

        # Track bit distribution
        bits = meta["bits_per_pixel"]
        bit_distribution[bits] = bit_distribution.get(bits, 0) + 1

        result = {
            "tile": os.path.basename(path),
            "zoom": z,
            "terrain": terrain,
            "vrange": vrange,
            "bits": bits,
            "png_size": png_size,
            "ozt2_size": len(encoded),
            "auto_size": len(auto_enc),
            "auto_bits": auto_meta.get("auto_selected_bits", 16),
            "auto_rmse": auto_meta.get("rmse", 0),
            "webp_size": webp_size,
            "rmse": rmse,
            "lossless": is_lossless,
            "encode_ms": encode_time * 1000,
            "decode_ms": decode_time * 1000,
            "ratio_vs_png": png_size / len(encoded) if len(encoded) > 0 else 0,
        }
        results.append(result)

        if verbose and i % 20 == 0:
            print(
                f"  [{i + 1:3d}/{len(tiles)}] {os.path.basename(path):<15} "
                f"z{z} {terrain:<15} range={vrange:>5}m bits={bits:>2} "
                f"PNG={png_size:>7}B OZT2={len(encoded):>6}B ({result['ratio_vs_png']:>5.1f}x) "
                f"RMSE={rmse:.2f}m enc={encode_time * 1000:.1f}ms dec={decode_time * 1000:.1f}ms"
            )

    # ── Summary ──
    print("\n" + "=" * 100)
    print("RESULTS SUMMARY")
    print("=" * 100)

    # Overall compression
    avg_png = np.mean([r["png_size"] for r in results])
    avg_ozt2 = np.mean([r["ozt2_size"] for r in results])
    avg_auto = np.mean([r["auto_size"] for r in results])
    avg_webp = np.mean([r["webp_size"] for r in results if r["webp_size"]])

    print(f"\n  {'Metric':<30} {'Value':>15}")
    print(f"  {'─' * 50}")
    print(f"  {'Tiles tested':<30} {len(results):>15}")
    print(f"  {'Avg Terrarium PNG':<30} {avg_png:>12.0f} B")
    if avg_webp:
        print(f"  {'Avg Terrarium WebP':<30} {avg_webp:>12.0f} B ({(1 - avg_webp / avg_png) * 100:>+5.0f}%)")
    print(f"  {'Avg OZT2 (auto bits)':<30} {avg_ozt2:>12.0f} B ({(1 - avg_ozt2 / avg_png) * 100:>+5.0f}%)")
    print(f"  {'Avg OZT2 (max 1m RMSE)':<30} {avg_auto:>12.0f} B ({(1 - avg_auto / avg_png) * 100:>+5.0f}%)")
    print(f"  {'Avg encode time':<30} {total_encode_time / len(results) * 1000:>12.1f} ms")
    print(f"  {'Avg decode time':<30} {total_decode_time / len(results) * 1000:>12.1f} ms")

    # Bit depth distribution
    print(f"\n  Bit Depth Distribution:")
    for b in sorted(bit_distribution.keys()):
        count = bit_distribution[b]
        if count > 0:
            pct = 100 * count / len(results)
            bar = "█" * int(pct / 2)
            print(f"    {b:>2}-bit: {count:>4} ({pct:>5.1f}%) {bar}")

    # Per-terrain analysis
    print(f"\n  Per-Terrain Analysis:")
    print(f"  {'Terrain':<18} {'Count':>6} {'Avg Range':>10} {'Avg Bits':>9} {'Avg PNG':>9} {'Avg OZT2':>9} {'Ratio':>7} {'Avg RMSE':>9}")
    print(f"  {'─' * 85}")

    terrains = sorted(set(r["terrain"] for r in results))
    for terrain in terrains:
        tr = [r for r in results if r["terrain"] == terrain]
        if not tr:
            continue
        avg_range = np.mean([r["vrange"] for r in tr])
        avg_bits = np.mean([r["bits"] for r in tr])
        avg_png_t = np.mean([r["png_size"] for r in tr])
        avg_ozt2_t = np.mean([r["ozt2_size"] for r in tr])
        avg_ratio = np.mean([r["ratio_vs_png"] for r in tr])
        avg_rmse_t = np.mean([r["rmse"] for r in tr])

        print(
            f"  {terrain:<18} {len(tr):>6} {avg_range:>9.0f}m {avg_bits:>8.1f} "
            f"{avg_png_t:>8.0f}B {avg_ozt2_t:>8.0f}B {avg_ratio:>6.1f}x {avg_rmse_t:>8.2f}m"
        )

    # Per-zoom analysis
    print(f"\n  Per-Zoom Analysis:")
    print(f"  {'Zoom':>6} {'Count':>6} {'Avg Range':>10} {'Avg Bits':>9} {'Avg PNG':>9} {'Avg OZT2':>9} {'Ratio':>7}")
    print(f"  {'─' * 70}")

    for z in sorted(set(r["zoom"] for r in results)):
        zr = [r for r in results if r["zoom"] == z]
        avg_range = np.mean([r["vrange"] for r in zr])
        avg_bits = np.mean([r["bits"] for r in zr])
        avg_png_z = np.mean([r["png_size"] for r in zr])
        avg_ozt2_z = np.mean([r["ozt2_size"] for r in zr])
        avg_ratio = np.mean([r["ratio_vs_png"] for r in zr])

        print(
            f"  z{z:<5} {len(zr):>6} {avg_range:>9.0f}m {avg_bits:>8.1f} "
            f"{avg_png_z:>8.0f}B {avg_ozt2_z:>8.0f}B {avg_ratio:>6.1f}x"
        )

    # Storage estimates
    total_tiles_est = 1_100_000
    print(f"\n  Storage Estimates (z0-z10, ~{total_tiles_est:,} tiles):")
    print(f"  {'Method':<35} {'Per Tile':>10} {'Total':>12}")
    print(f"  {'─' * 60}")
    for name, avg in [
        ("Terrarium PNG (current)", avg_png),
        ("Terrarium WebP", avg_webp) if avg_webp else None,
        ("OZT2 adaptive (auto bits)", avg_ozt2),
        ("OZT2 adaptive (≤1m RMSE)", avg_auto),
    ]:
        if name is None:
            continue
        total_gb = (avg * total_tiles_est) / (1024 ** 3)
        if total_gb > 1:
            total_str = f"{total_gb:.1f} GB"
        else:
            total_str = f"{total_gb * 1024:.0f} MB"
        print(f"  {name:<35} {avg:>9.0f}B {total_str:>12}")

    # Save results
    output = {
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "tiles_tested": len(results),
        "compression": {
            "avg_terrarium_png": float(avg_png),
            "avg_terrarium_webp": float(avg_webp) if avg_webp else None,
            "avg_ozt2_auto_bits": float(avg_ozt2),
            "avg_ozt2_max1m_rmse": float(avg_auto),
            "savings_vs_png_pct": round((1 - avg_ozt2 / avg_png) * 100, 1),
        },
        "performance": {
            "avg_encode_ms": round(total_encode_time / len(results) * 1000, 2),
            "avg_decode_ms": round(total_decode_time / len(results) * 1000, 2),
        },
        "bit_distribution": {str(k): v for k, v in bit_distribution.items() if v > 0},
        "results": results,
    }

    out_path = os.path.join(os.path.dirname(__file__), "..", "tests", "results", "benchmark_ozt2_results.json")
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w") as f:
        json.dump(output, f, indent=2, default=str)
    print(f"\n  Results saved to: {out_path}")

    return results


def main():
    parser = argparse.ArgumentParser(description="OZT2 Format Benchmark")
    parser.add_argument("--tiles", type=int, default=100, help="Number of tiles to test")
    parser.add_argument("--verbose", "-v", action="store_true", help="Print per-tile details")
    parser.add_argument(
        "--tile-dir",
        default="/nas/Temp/DEMs/data/terrarium-tiles",
        help="Base directory for Terrarium PNG tiles",
    )
    args = parser.parse_args()

    tiles = find_tiles(args.tile_dir, args.tiles)
    if not tiles:
        print(f"No tiles found in {args.tile_dir}")
        sys.exit(1)

    run_benchmark(tiles, verbose=args.verbose)


if __name__ == "__main__":
    main()
