#!/usr/bin/env python3
"""
Re-encode OZT2 tiles from ZSTD to Brotli compression.

Run after convert_to_ozt2.py. Reads existing .ozt2 files, decodes elevation,
and re-encodes with Brotli compression (Edge-compatible).

Usage:
    # Re-encode all tiles (dry run first)
    python scripts/reencode_ozt2_brotli.py --dir /nas/Temp/repos/OpenZenith/data/ozt2_tiles --dry-run

    # Re-encode with progress
    python scripts/reencode_ozt2_brotli.py --dir /nas/Temp/repos/OpenZenith/data/ozt2_tiles --workers 16

    # Specific zoom levels
    python scripts/reencode_ozt2_brotli.py --dir /nas/Temp/repos/OpenZenith/data/ozt2_tiles --zoom 10-11

    # Resume: skip tiles that are already Brotli
    python scripts/reencode_ozt2_brotli.py --dir /nas/Temp/repos/OpenZenith/data/ozt2_tiles --skip-existing
"""

import argparse
import struct
import sys
import time
from concurrent.futures import ProcessPoolExecutor, as_completed, wait, FIRST_COMPLETED
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent.parent))

from openzenith.tile_format_v2 import (
    decode,
    encode,
    PRED_GRADIENT,
    PRED_LEFT,
    PRED_NONE,
    COMP_BROTLI,
    COMP_ZSTD,
    COMP_ZLIB,
)

NODATA = -32768
TILE_SIZE = 256


def get_tile_info(path: Path) -> dict | None:
    """Read tile header from first 6 bytes — minimal I/O."""
    try:
        with open(path, "rb") as f:
            header = f.read(6)
        if len(header) < 6:
            return None
        vmin = int.from_bytes(header[0:2], "little", signed=True)
        vrange = int.from_bytes(header[2:4], "little", signed=False)
        bits = header[4]
        flags = header[5]
        pred = flags & 0x03
        comp = (flags >> 2) & 0x03
        return {
            "vmin": vmin,
            "vrange": vrange,
            "bits": bits,
            "predictor": pred,
            "compressor": comp,
            "size": path.stat().st_size,
        }
    except Exception:
        return None


def reencode_tile(path: Path, workers: int = 1) -> dict:
    """Re-encode a single ZSTD tile as Brotli."""
    try:
        info = get_tile_info(path)
        if info is None:
            return {"path": str(path), "status": "error", "error": "can't read header"}

        # Skip if already Brotli
        if info["compressor"] == COMP_BROTLI:
            return {"path": str(path), "status": "skip", "reason": "already_brotli"}

        # Skip non-ZSTD (shouldn't happen but be safe)
        if info["compressor"] != COMP_ZSTD:
            return {"path": str(path), "status": "skip", "reason": f"not_zstd(comp={info['compressor']})"}

        # Decode
        data = path.read_bytes()
        elevation, meta = decode(data)

        # Re-encode as Brotli, preserving predictor and bits
        pred = info["predictor"]
        bits = info["bits"]
        compressed = encode(
            elevation,
            predictor=pred,
            bits_per_pixel=bits,
            compressor=COMP_BROTLI,
            compress_level=4,
            nodata_value=NODATA,
        )

        # Write back
        path.write_bytes(compressed)
        return {
            "path": str(path),
            "status": "ok",
            "size_before": info["size"],
            "size_after": len(compressed),
            "vmin": info["vmin"],
            "vrange": info["vrange"],
            "bits": bits,
            "predictor": ["none", "left", "gradient"][pred],
        }
    except Exception as e:
        return {"path": str(path), "status": "error", "error": str(e)}


def main():
    parser = argparse.ArgumentParser(description="Re-encode OZT2 tiles ZSTD → Brotli")
    parser.add_argument("--dir", "-d", type=Path, required=True, help="Root tile directory")
    parser.add_argument("--zoom", "-z", help="Zoom range, e.g. 10-11 (default: all)")
    parser.add_argument("--workers", "-w", type=int, default=16, help="Parallel workers")
    parser.add_argument("--dry-run", action="store_true", help="Count only, don't re-encode")
    parser.add_argument("--skip-existing", action="store_true", help="Skip tiles already processed")
    parser.add_argument("--output-log", "-o", type=Path, help="Write results to JSON")
    args = parser.parse_args()

    # Find tiles — use find(1) for fast btrfs enumeration, then cache paths.
    # rglob() blocks on btrfs opendir for large directory trees.
    import hashlib, subprocess, time as _time
    dir_hash = hashlib.md5(str(args.dir).encode()).hexdigest()[:8]
    cache_file = Path(tempfile.gettempdir()) / f"ozt2_tiles_{dir_hash}.txt"
    cache_age = _time.time() - cache_file.stat().st_mtime if cache_file.exists() else 99999

    zoom_min, zoom_max = 0, 99
    if args.zoom:
        parts = args.zoom.split("-")
        zoom_min = int(parts[0])
        zoom_max = int(parts[-1])

    if cache_age < 86400:
        lines = cache_file.read_text().splitlines()
        # Filter by zoom range if cached globally
        tiles = [Path(line) for line in lines if line.strip()]
        # Apply zoom filter on paths
        tiles = [t for t in tiles if zoom_min <= int(t.parent.parent.name[1:]) <= zoom_max]
        print(f"Loaded {len(tiles):,} tiles from cache ({cache_file.name}, age={cache_age/3600:.1f}h)")
    else:
        print("Enumerating tiles (find(1) fast path, caching result)...")
        proc = subprocess.run(
            ["find", str(args.dir), "-type", "f", "-name", "*.ozt2"],
            capture_output=True, text=True, timeout=300,
        )
        if proc.returncode != 0:
            print(f"find failed: {proc.stderr}")
            sys.exit(1)
        tiles = [Path(line.strip()) for line in proc.stdout.splitlines() if line.strip()]
        # Cache all tiles (not filtered) for future runs
        all_cache = Path(tempfile.gettempdir()) / f"ozt2_tiles_all_{dir_hash}.txt"
        all_cache.write_text("\n".join(str(t) for t in tiles))
        cache_file.write_text("\n".join(str(t) for t in tiles))
        print(f"Cached {len(tiles):,} tiles to {cache_file.name}")

    print(f"Found {len(tiles):,} tiles")
    if args.dry_run:
        # Count by compressor — sequential, no parallelism
        import sys
        comp_counts = {0: 0, 1: 0, 2: 0}
        for i, t in enumerate(tiles):
            info = get_tile_info(t)
            if info:
                comp_counts[info["compressor"]] += 1
            if (i + 1) % 10000 == 0:
                print(f"  Checked {i+1:,} tiles...", flush=True)
        COMP_NAMES = {0: "brotli", 1: "zstd", 2: "zlib"}
        for c, n in COMP_NAMES.items():
            print(f"  {n}: {comp_counts[c]:,}")
        return

    print(f"Workers: {args.workers}")
    print()

    t0 = time.time()
    results = []
    errors = []
    skipped = 0
    submitted = 0
    BATCH = args.workers * 4  # keep BATCH pending futures

    with ProcessPoolExecutor(max_workers=args.workers) as executor:
        # Submit in batches to avoid memory explosion
        tile_iter = iter(tiles)
        futures = {}

        # Initial batch
        while submitted < BATCH:
            try:
                t = next(tile_iter)
                futures[executor.submit(reencode_tile, t, args.workers)] = t
                submitted += 1
            except StopIteration:
                break

        # Process as futures complete, refill the queue
        # Pattern: as_completed over a shared mutable dict of futures.
        # as_completed iterates over the live futures dict, so newly submitted
        # futures are automatically picked up. One future is processed at a time,
        # refill happens after each processing to keep the queue topped up.
        from concurrent.futures import as_completed
        next_print = 500

        # Initial batch
        futures = {}
        for _ in range(BATCH):
            try:
                t = next(tile_iter)
                futures[executor.submit(reencode_tile, t, args.workers)] = t
            except StopIteration:
                break

        # Main loop: as_completed yields completed futures; dict changes mid-iteration
        for future in as_completed(futures):
            r = future.result()
            results.append(r)
            if r["status"] == "error":
                errors.append(r)
            elif r["status"] == "skip":
                skipped += 1
            del futures[future]

            # Refill slot immediately after processing
            try:
                t = next(tile_iter)
                futures[executor.submit(reencode_tile, t, args.workers)] = t
            except StopIteration:
                pass  # No more tiles — let queue drain

            completed = len(results)
            if completed >= next_print:
                next_print += 500
                elapsed = time.time() - t0
                rate = completed / elapsed
                ok = sum(1 for x in results if x["status"] == "ok")
                print(
                    f"  [{completed:>7,}/{len(tiles):>7,}] ✅ {ok}  ⏭ {skipped}  💥 {len(errors)}  {rate:,.0f} tiles/s"
                )

        elapsed = time.time() - t0
        ok_count = sum(1 for r in results if r["status"] == "ok")

    print(f"\n{'='*60}")
    print(f"REENCODE COMPLETE — {elapsed:.1f}s")
    print(f"  Re-encoded: {ok_count:,}")
    print(f"  Skipped:    {skipped:,}")
    print(f"  Errors:     {len(errors):,}")
    print(f"  Speed:      {len(tiles)/elapsed:,.0f} tiles/sec")

    if args.output_log and errors:
        import json
        args.output_log.write_text(json.dumps(errors[:100], indent=2))

    if errors:
        print(f"\nErrors (first 5):")
        for r in errors[:5]:
            print(f"  💥 {r['path']}: {r['error']}")


if __name__ == "__main__":
    main()
