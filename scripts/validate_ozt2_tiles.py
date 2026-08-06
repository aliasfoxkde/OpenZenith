#!/usr/bin/env python3
"""
Validate OZT2 tiles for integrity and quality.

Checks:
1. File exists and is readable
2. Header is valid (magic bytes, reasonable values)
3. Decode roundtrip: encode → decode produces same values (lossless) or within RMSE tolerance (lossy)
4. Physical elevation range (-500m to +9000m for land)
5. NODATA value (-32768) is handled correctly
6. No corrupt tiles

Usage:
    # Validate all tiles in a directory
    python scripts/validate_ozt2_tiles.py --dir /data/ozt2_tiles/

    # Validate specific tiles
    python scripts/validate_ozt2_tiles.py --tiles z10/163/395.ozt2 z10/164/395.ozt2

    # Spot check: decode only, no roundtrip
    python scripts/validate_ozt2_tiles.py --dir /data/ozt2_tiles/ --mode decode

    # Full roundtrip validation with RMSE
    python scripts/validate_ozt2_tiles.py --dir /data/ozt2_tiles/ --mode full --max-rmse 1.0

    # Quick (skip checksums, just decode)
    python scripts/validate_ozt2_tiles.py --dir /data/ozt2_tiles/ --quick
"""

import argparse
import json
import sys
import time
import zlib
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent.parent))

from openzenith.tile_format_v2 import (
    decode,
    encode,
    auto_encode,
    PRED_GRADIENT,
    COMP_BROTLI,
)

NODATA = -32768
PHYSICAL_MIN = -500  # Dead Sea shore
PHYSICAL_MAX = 9000  # Mt. Everest
TILE_SIZE = 256


def validate_tile(path: Path, mode: str = "full", max_rmse: float = 1.0) -> dict:
    """Validate a single OZT2 tile file."""
    try:
        data = path.read_bytes()
    except Exception as e:
        return {"path": str(path), "status": "error", "error": f"read failed: {e}"}

    # Check minimum size (6 byte header + 1 byte compressed data minimum)
    if len(data) < 7:
        return {"path": str(path), "status": "error", "error": "file too small"}

    # Parse header
    vmin = int.from_bytes(data[0:2], "little", signed=True)
    vrange = int.from_bytes(data[2:4], "little", signed=False)
    bits = data[4]
    flags = data[5]

    predictor = flags & 0x03
    compressor = (flags >> 2) & 0x03

    # Check header sanity
    if bits < 8 or bits > 16:
        return {"path": str(path), "status": "warn", "error": f"invalid bits: {bits}"}
    if vmin < -1000 or vmin > 10000:
        return {"path": str(path), "status": "warn", "error": f"suspicious vmin: {vmin}"}
    if vrange > 10000:
        return {"path": str(path), "status": "warn", "error": f"suspicious vrange: {vrange}"}
    if predictor > 2 or compressor > 2:
        return {"path": str(path), "status": "warn", "error": f"invalid flags: {flags}"}

    # Decode tile
    try:
        elevation, meta = decode(data)
    except Exception as e:
        return {"path": str(path), "status": "error", "error": f"decode failed: {e}"}

    # Check shape
    if elevation.shape != (TILE_SIZE, TILE_SIZE):
        return {
            "path": str(path),
            "status": "warn",
            "error": f"unexpected shape: {elevation.shape}",
        }

    # Check physical range
    valid = elevation[elevation != NODATA]
    if len(valid) > 0:
        tile_min = int(valid.min())
        tile_max = int(valid.max())
        if tile_min < PHYSICAL_MIN or tile_max > PHYSICAL_MAX:
            return {
                "path": str(path),
                "status": "warn",
                "error": f"elevation out of range: {tile_min}m to {tile_max}m",
                "vmin": tile_min,
                "vmax": tile_max,
            }

    # Mode-specific checks
    if mode == "decode":
        return {
            "path": str(path),
            "status": "ok",
            "size": len(data),
            "bits": bits,
            "predictor": predictor,
            "compressor": compressor,
            "vmin": vmin,
            "vrange": vrange,
        }

    # Full roundtrip: encode the decoded tile and compare
    try:
        encoded2, meta2 = auto_encode(elevation, nodata_value=NODATA, max_rmse=max_rmse)
        elevation2, _ = decode(encoded2)

        # Compute RMSE (excluding NODATA)
        mask = elevation != NODATA
        if mask.sum() > 0:
            diff = elevation[mask].astype(np.float64) - elevation2[mask].astype(np.float64)
            rmse = float(np.sqrt(np.mean(diff ** 2)))
            max_err = float(np.abs(diff).max())
        else:
            rmse = 0.0
            max_err = 0.0

        status = "ok" if rmse <= max_rmse else "warn"
        return {
            "path": str(path),
            "status": status,
            "size": len(data),
            "bits": bits,
            "predictor": predictor,
            "compressor": compressor,
            "vmin": vmin,
            "vrange": vrange,
            "rmse": round(rmse, 4),
            "max_error": round(max_err, 2),
            "valid_pixels": int(mask.sum()),
            "nodata_pixels": int((~mask).sum()),
        }
    except Exception as e:
        return {"path": str(path), "status": "error", "error": f"roundtrip failed: {e}"}


def find_tiles(root: Path) -> list[Path]:
    """Find all .ozt2 files under root."""
    return sorted(root.rglob("*.ozt2"))


def main():
    parser = argparse.ArgumentParser(description="Validate OZT2 tile integrity")
    parser.add_argument("--dir", "-d", type=Path, help="Root directory to scan")
    parser.add_argument(
        "--tiles", nargs="+", type=Path, help="Specific tile files to validate"
    )
    parser.add_argument(
        "--mode",
        choices=["decode", "full"],
        default="full",
        help="decode=just decode, full=roundtrip RMSE check",
    )
    parser.add_argument(
        "--max-rmse", type=float, default=1.0, help="Max acceptable RMSE for full mode"
    )
    parser.add_argument(
        "--workers", "-w", type=int, default=16, help="Parallel workers"
    )
    parser.add_argument(
        "--quick", action="store_true", help="Skip roundtrip, just decode"
    )
    parser.add_argument(
        "--output", "-o", type=Path, help="Write results to JSON file"
    )
    args = parser.parse_args()

    mode = "decode" if args.quick else args.mode

    if args.tiles:
        tiles = [Path(t) for t in args.tiles]
    elif args.dir:
        tiles = find_tiles(args.dir)
        if not tiles:
            print(f"❌ No .ozt2 tiles found in {args.dir}")
            sys.exit(1)
    else:
        print("❌ Provide --dir or --tiles")
        sys.exit(1)

    print(f"OpenZenith OZT2 Tile Validator")
    print(f"{'=' * 60}")
    print(f"  Mode:     {mode}")
    print(f"  Tiles:    {len(tiles):,}")
    print(f"  Workers:  {args.workers}")
    if mode == "full":
        print(f"  Max RMSE: {args.max_rmse}m")
    print(f"{'=' * 60}\n")

    t0 = time.time()
    results = []
    errors = []
    warnings = []

    with ProcessPoolExecutor(max_workers=args.workers) as executor:
        futures = {executor.submit(validate_tile, t, mode, args.max_rmse): t for t in tiles}

        for i, future in enumerate(as_completed(futures)):
            r = future.result()
            results.append(r)
            if r["status"] == "error":
                errors.append(r)
            elif r["status"] == "warn":
                warnings.append(r)

            if (i + 1) % 500 == 0 or (i + 1) == len(tiles):
                elapsed = time.time() - t0
                rate = (i + 1) / elapsed
                ok = sum(1 for x in results if x["status"] == "ok")
                print(
                    f"  [{i + 1:>8,}/{len(tiles):>8,}] ✅ {ok}  ⚠️ {len(warnings)}  💥 {len(errors)}"
                )

    elapsed = time.time() - t0
    ok_count = sum(1 for r in results if r["status"] == "ok")
    warn_count = len(warnings)
    error_count = len(errors)

    print(f"\n{'=' * 60}")
    print(f"VALIDATION COMPLETE — {elapsed:.1f}s")
    print(f"{'=' * 60}")
    print(f"  ✅ Valid:      {ok_count:,} ({100 * ok_count / max(len(results), 1):.1f}%)")
    print(f"  ⚠️  Warnings:  {warn_count:,}")
    print(f"  💥 Errors:     {error_count:,}")
    print(f"  Speed:        {len(tiles) / elapsed:,.0f} tiles/sec")

    if args.output:
        output_data = {
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "mode": mode,
            "total": len(results),
            "ok": ok_count,
            "warnings": warn_count,
            "errors": error_count,
            "elapsed_seconds": round(elapsed, 1),
            "results": results,
        }
        args.output.write_text(json.dumps(output_data, indent=2))
        print(f"\n  Results: {args.output}")

    if warnings:
        print(f"\nWarnings (first 5):")
        for r in warnings[:5]:
            print(f"  ⚠️  {r['path']}: {r['error']}")

    if errors:
        print(f"\nErrors (first 5):")
        for r in errors[:5]:
            print(f"  💥 {r['path']}: {r['error']}")
        sys.exit(1)
    else:
        print(f"\n✅ All tiles passed validation")
        sys.exit(0)


if __name__ == "__main__":
    main()
