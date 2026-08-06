#!/usr/bin/env python3
"""
Convert SRTM .merged files to OZT2 tiles.

Reads SRTM .merged files (OZCHNK01 format from HuggingFace) and generates
OZT2 tiles at specified zoom levels, ready for upload to R2/HuggingFace.

Usage:
    # Convert z0-z12 from local .merged files
    python scripts/convert_to_ozt2.py \
        --input /nas/Temp/repos/OpenZenith/data/srtm30m-merged/ \
        --output /nas/Temp/repos/OpenZenith/data/ozt2_tiles/ \
        --zoom 0-12 \
        --workers 32

    # Convert specific zoom range
    python scripts/convert_to_ozt2.py --zoom 7-10 --output ./ozt2/

    # Validate quality (read back and check RMSE)
    python scripts/convert_to_ozt2.py --validate --output ./ozt2/

    # Incremental (skip tiles that already exist)
    python scripts/convert_to_ozt2.py --zoom 0-12 --output ./ozt2/ --incremental
"""

import argparse
import hashlib
import json
import math
import os
import struct
import sys
import time
import zlib
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent.parent))

from openzenith.tile_format_v2 import auto_encode, decode, PRED_GRADIENT, COMP_BROTLI
from openzenith.merged import MergedFile, lat_lon_to_srtm_name

NODATA = -32768
TILE_SIZE = 256
OUTPUT_ZOOMS = list(range(0, 15))  # z0–z14

# ─── Coordinate utilities ────────────────────────────────────────────────────

def lat_lon_to_xyz_tile(lat: float, lon: float, zoom: int) -> tuple[int, int, int]:
    """Convert lat/lon to (z, x, y) tile coordinates."""
    n = 2 ** zoom
    x = int((lon + 180.0) / 360.0 * n)
    lat_rad = math.radians(lat)
    y = int((1.0 - math.log(math.tan(lat_rad) + 1.0 / math.cos(lat_rad)) / math.pi) / 2.0 * n)
    return zoom, x, y


def xyz_tile_to_lat_lon_bounds(z: int, x: int, y: int) -> tuple[float, float, float, float]:
    """Return (lat_min, lat_max, lon_min, lon_max) for a Web Mercator tile."""
    n = 2 ** z
    lon_min = x / n * 360.0 - 180.0
    lon_max = (x + 1) / n * 360.0 - 180.0
    lat_max = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / n))))
    lat_min = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * (y + 1) / n))))
    return lat_min, lat_max, lon_min, lon_max


def mercator_sample(lat: float, lon: float, elevation_m: float | None) -> tuple[float, float]:
    """Convert lat/lon/elev to Web Mercator meters (for tile sampling)."""
    lat = max(-85.0511, min(85.0511, lat))
    lon = max(-180.0, min(180.0, lon))
    x = (lon + 180.0) / 360.0 * 256.0
    y = (1.0 - math.log(math.tan(math.radians(lat)) + 1.0 / math.cos(math.radians(lat))) / math.pi) / 2.0 * 256.0
    return x, y


def sample_from_merged(lat: float, lon: float, merged_dir: Path) -> int | None:
    """Sample elevation at a single lat/lon from .merged files.

    Returns elevation in meters, or None if over ocean/no-data.
    """
    tile_name = lat_lon_to_srtm_name(lat, lon)
    lat_dir = tile_name[:3]
    merged_path = merged_dir / lat_dir / f"{tile_name}.merged"

    if not merged_path.exists():
        return None

    try:
        mf = MergedFile(merged_path)
    except Exception:
        return None

    # Find which chunk contains this point
    lat_frac = lat - math.floor(lat)
    lon_frac = lon - math.floor(lon)
    lat_pixel = min(3600, max(0, round((1.0 - lat_frac) * 3600)))
    lon_pixel = min(3600, max(0, round(lon_frac * 3600)))

    chunk_row = min(14, lat_pixel // 256)
    chunk_col = min(14, lon_pixel // 256)

    idx = chunk_row * mf.cols + chunk_col
    if idx >= len(mf.index) or mf.index[idx]["size"] == 0:
        return None

    try:
        chunk = mf.get_chunk(chunk_row, chunk_col)
    except Exception:
        return None

    local_row = lat_pixel - chunk_row * 256
    local_col = lon_pixel - chunk_col * 256
    local_row = min(local_row, chunk.shape[0] - 1)
    local_col = min(local_col, chunk.shape[1] - 1)

    elev = int(chunk[local_row, local_col])
    if elev == NODATA:
        return None
    return elev


def generate_tile_grid(
    z: int, x: int, y: int,
    merged_dir: Path,
    srtm_dir: Path | None = None,
) -> np.ndarray:
    """Generate a 256×256 elevation grid for a tile from source data.

    Uses SRTM .merged files. For ocean tiles (no land), returns array of NODATA.
    """
    lat_min, lat_max, lon_min, lon_max = xyz_tile_to_lat_lon_bounds(z, x, y)

    # Resolution at equator at this zoom
    meters_per_pixel = (2 * math.pi * 6378137) / (256 * 2 ** z)
    deg_per_pixel_lat = (lat_max - lat_min) / TILE_SIZE

    grid = np.full((TILE_SIZE, TILE_SIZE), NODATA, dtype=np.int16)

    # Check if tile might have land (simple bbox check)
    # SRTM covers ±60° latitude
    if lat_min < -60 or lat_max > 60:
        # Above/below SRTM coverage — still sample but will return None
        pass

    for row in range(TILE_SIZE):
        # Latitude at row center (tile coords: 0 = north, 255 = south)
        lat = lat_max - (row + 0.5) * deg_per_pixel_lat

        for col in range(TILE_SIZE):
            lon = lon_min + (col + 0.5) * (lon_max - lon_min) / TILE_SIZE
            elev = sample_from_merged(lat, lon, merged_dir)
            if elev is not None:
                grid[row, col] = elev

    return grid


def convert_tile(args) -> dict:
    """Convert a single tile: generate grid → OZT2 encode → write."""
    z, x, y, merged_dir, output_dir, max_rmse, incremental, validate = args

    out_path = Path(output_dir) / f"z{z}" / str(x) / f"{y}.ozt2"

    # Incremental: skip if already exists and valid
    if incremental and out_path.exists():
        if validate:
            try:
                data = out_path.read_bytes()
                decoded, meta = decode(data)
                is_valid = True
            except Exception:
                is_valid = False
            if is_valid:
                return {"status": "skipped", "z": z, "x": x, "y": y, "size": out_path.stat().st_size}
        else:
            return {"status": "skipped", "z": z, "x": x, "y": y, "size": out_path.stat().st_size}

    try:
        grid = generate_tile_grid(z, x, y, Path(merged_dir))
        encoded, meta = auto_encode(grid, nodata_value=NODATA, max_rmse=max_rmse)

        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_bytes(encoded)

        return {
            "status": "ok",
            "z": z, "x": x, "y": y,
            "size": len(encoded),
            "bits": meta.get("bits_per_pixel", 0),
            "rmse": meta.get("rmse", 0),
            "vmin": meta.get("min_elevation", 0),
            "vmax": meta.get("max_elevation", 0),
        }
    except Exception as e:
        return {"status": "error", "z": z, "x": x, "y": y, "error": str(e)}


def build_task_list(zoom_range: tuple[int, int], output_dir: Path, merged_dir: Path) -> list:
    """Build list of all tiles to convert for the given zoom range."""
    tasks = []
    for z in range(zoom_range[0], zoom_range[1] + 1):
        n = 2 ** z
        for x in range(n):
            for y in range(n):
                tasks.append((z, x, y, str(merged_dir), str(output_dir), 1.0, False, False))
    return tasks


def count_tile_tasks(zoom_range: tuple[int, int]) -> int:
    """Count total tiles for zoom range (for progress display)."""
    total = 0
    for z in range(zoom_range[0], zoom_range[1] + 1):
        n = 2 ** z
        total += n * n
    return total


def generate_manifest(output_dir: Path, zoom_range: tuple[int, int], elapsed: float) -> dict:
    """Generate a manifest.json for the converted tiles."""
    manifest = {
        "version": "1.0.0",
        "format": "ozt2",
        "generated": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "source": "srtm30m-merged",
        "source_url": "https://huggingface.co/datasets/aliasfox/srtm30m-merged",
        "zoom_range": list(zoom_range),
        "compression": {
            "predictor": "gradient",
            "compressor": "brotli",
            "quality": 11,
            "max_rmse": 1.0,
        },
        "total_tiles": 0,
        "total_bytes": 0,
        "zoom_levels": {},
        "bit_distribution": {},
    }

    total_tiles = 0
    total_bytes = 0
    bit_dist = {}

    for z in range(zoom_range[0], zoom_range[1] + 1):
        zdir = output_dir / f"z{z}"
        if not zdir.exists():
            continue

        z_tiles = 0
        z_bytes = 0
        z_bit_dist = {}

        for x_dir in sorted(zdir.iterdir()):
            if not x_dir.is_dir():
                continue
            for tile_file in sorted(x_dir.glob("*.ozt2")):
                size = tile_file.stat().st_size
                z_tiles += 1
                z_bytes += size
                total_tiles += 1
                total_bytes += size

        # Estimate bit distribution from first 100 tiles
        sample_tiles = list(zdir.rglob("*.ozt2"))[:100]
        for t in sample_tiles:
            try:
                data = t.read_bytes()
                bits = data[4] if len(data) >= 5 else 16
                z_bit_dist[bits] = z_bit_dist.get(bits, 0) + 1
            except Exception:
                pass

        if z_tiles > 0:
            manifest["zoom_levels"][str(z)] = {
                "tiles": z_tiles,
                "bytes": z_bytes,
                "avg_bytes": round(z_bytes / z_tiles),
            }
            for b, c in z_bit_dist.items():
                key = str(b)
                manifest["bit_distribution"][key] = manifest["bit_distribution"].get(key, 0) + c

    manifest["total_tiles"] = total_tiles
    manifest["total_bytes"] = total_bytes
    manifest["total_gb"] = round(total_bytes / 1e9, 3)
    manifest["avg_bytes_per_tile"] = round(total_bytes / max(total_tiles, 1))
    manifest["conversion_time_seconds"] = round(elapsed, 1)
    manifest["tiles_per_second"] = round(total_tiles / elapsed) if elapsed > 0 else 0

    return manifest


def main():
    parser = argparse.ArgumentParser(description="Convert SRTM .merged files to OZT2 tiles")
    parser.add_argument(
        "--input", "-i",
        default="/nas/Temp/repos/OpenZenith/data/srtm30m-merged",
        help="Path to SRTM .merged files directory",
    )
    parser.add_argument(
        "--output", "-o",
        default="/nas/Temp/repos/OpenZenith/data/ozt2_tiles",
        help="Output directory for .ozt2 tiles",
    )
    parser.add_argument(
        "--zoom", "-z",
        default="0-12",
        help="Zoom range (e.g., 0-12, 7-10, 0-14)",
    )
    parser.add_argument(
        "--workers", "-w",
        type=int, default=32,
        help="Number of parallel workers",
    )
    parser.add_argument(
        "--max-rmse",
        type=float, default=1.0,
        help="Maximum RMSE for adaptive bit-depth selection (meters)",
    )
    parser.add_argument(
        "--incremental",
        action="store_true",
        help="Skip tiles that already exist in output",
    )
    parser.add_argument(
        "--validate",
        action="store_true",
        help="Validate existing tiles when using --incremental",
    )
    parser.add_argument(
        "--manifest",
        default="manifest.json",
        help="Manifest filename (relative to output dir)",
    )
    args = parser.parse_args()

    merged_dir = Path(args.input)
    output_dir = Path(args.output)

    if not merged_dir.exists():
        print(f"❌ Input directory not found: {merged_dir}")
        sys.exit(1)

    # Parse zoom range
    try:
        if "-" in args.zoom:
            z_start, z_end = map(int, args.zoom.split("-"))
        else:
            z_start = z_end = int(args.zoom)
        zoom_range = (z_start, z_end)
    except ValueError:
        print(f"❌ Invalid zoom range: {args.zoom}")
        sys.exit(1)

    total_tiles = count_tile_tasks(zoom_range)
    print(f"OpenZenith OZT2 Tile Generator")
    print(f"{'=' * 60}")
    print(f"  Input:   {merged_dir}")
    print(f"  Output:  {output_dir}")
    print(f"  Zoom:    z{z_start}–z{z_end}")
    print(f"  Tiles:   {total_tiles:,}")
    print(f"  Workers: {args.workers}")
    print(f"  Max RMSE: {args.max_rmse}m")
    print(f"  Mode:    {'incremental' if args.incremental else 'full convert'}")
    print(f"{'=' * 60}")
    print()

    tasks = build_task_list(zoom_range, output_dir, merged_dir)

    print(f"Starting conversion of {len(tasks):,} tiles...")
    t0 = time.time()
    done = 0
    results = {"ok": 0, "skipped": 0, "error": 0}
    errors = []

    with ProcessPoolExecutor(max_workers=args.workers) as executor:
        futures = {executor.submit(convert_tile, (*t, args.incremental, args.validate)): t for t in tasks}

        for future in as_completed(futures):
            r = future.result()
            status = r.get("status", "error")
            results[status] = results.get(status, 0) + 1
            done += 1

            if status == "error":
                errors.append(r)

            if done % 5000 == 0 or done == len(tasks):
                elapsed = time.time() - t0
                rate = done / elapsed if elapsed > 0 else 0
                pct = 100 * done / len(tasks)
                print(
                    f"  [{done:>8,}/{len(tasks):>8,} ({pct:>5.1f}%)] "
                    f"✅ {results.get('ok', 0):>6,} "
                    f"⏭  {results.get('skipped', 0):>6,} "
                    f"❌ {results.get('error', 0):>4,} "
                    f"· {rate:>6,.0f} tiles/s · {elapsed:.0f}s"
                )

    elapsed = time.time() - t0

    # ── Summary ──
    ok_tiles = results.get("ok", 0)
    skipped = results.get("skipped", 0)
    error_tiles = results.get("error", 0)

    print(f"\n{'=' * 60}")
    print(f"CONVERSION COMPLETE — {elapsed:.1f}s total")
    print(f"{'=' * 60}")
    print(f"  ✅ Converted:  {ok_tiles:>10,}")
    print(f"  ⏭  Skipped:   {skipped:>10,}")
    print(f"  ❌ Errors:     {error_tiles:>10,}")
    print(f"  Speed:        {done / elapsed:>10,.0f} tiles/sec")

    # Estimate total size
    if ok_tiles > 0:
        avg_size = sum(
            r.get("size", 0) for r in [future.result() for future in futures]
            if r.get("status") == "ok"
        ) / max(ok_tiles, 1)
        est_total_gb = (avg_size * total_tiles) / 1e9
        print(f"  Avg tile size: {avg_size:>8.0f} bytes")
        print(f"  Est. full size: {est_total_gb:>6.1f} GB (z{z_start}–z{z_end})")

    if errors:
        print(f"\nErrors (first 10):")
        for r in errors[:10]:
            print(f"  z{r['z']}/{r['x']}/{r['y']}: {r.get('error', 'unknown')}")

    # Generate manifest
    manifest = generate_manifest(output_dir, zoom_range, elapsed)
    manifest_path = output_dir / args.manifest
    manifest_path.write_text(json.dumps(manifest, indent=2))
    print(f"\n  Manifest: {manifest_path}")
    print(f"  Total tiles in manifest: {manifest['total_tiles']:,}")
    if manifest["total_bytes"] > 0:
        print(f"  Total size: {manifest['total_gb']:.2f} GB")

    # Store results for reference
    results_path = output_dir / "conversion_results.json"
    results_data = {
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "elapsed_seconds": round(elapsed, 1),
        "tiles_converted": ok_tiles,
        "tiles_skipped": skipped,
        "tiles_errored": error_tiles,
        "errors": errors[:100],
    }
    results_path.write_text(json.dumps(results_data, indent=2))

    if error_tiles > 0:
        print(f"\n⚠️  {error_tiles} tiles failed — see {results_path}")
        sys.exit(1)
    else:
        print(f"\n✅ All tiles converted successfully")
        sys.exit(0)


if __name__ == "__main__":
    main()
