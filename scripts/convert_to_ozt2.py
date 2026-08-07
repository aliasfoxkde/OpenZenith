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
import json
import math
import os
import struct
import sys
import time
import zlib
from concurrent.futures import ProcessPoolExecutor, wait
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent.parent))

from openzenith.tile_format_v2 import auto_encode, decode, PRED_GRADIENT, COMP_BROTLI
from openzenith.merged import MergedFile, get_merged_file, lat_lon_to_srtm_name

NODATA = -32768
TILE_SIZE = 256

# SRTM latitude coverage
SRTM_LAT_MIN = -60
SRTM_LAT_MAX = 60


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


def mercator_lat_to_tile_y(lat: float, zoom: int) -> int:
    """Convert latitude to tile y coordinate (Web Mercator)."""
    n = 2 ** zoom
    lat_rad = math.radians(lat)
    y = int((1.0 - math.log(math.tan(lat_rad) + 1.0 / math.cos(lat_rad)) / math.pi) / 2.0 * n)
    return y


# ─── SRTM tile discovery ─────────────────────────────────────────────────────

# srtm_tiles maps (lat_deg, lon_deg) → info_dict
# info_dict: {exists, has_data, rows, cols}


def _tile_name_from_lat_lon(lat: int, lon: int) -> str:
    """Construct SRTM tile name from integer lat/lon degrees."""
    lat_dir = f"N{abs(lat):02d}" if lat >= 0 else f"S{abs(lat):02d}"
    lon_dir = f"E{abs(lon):03d}" if lon >= 0 else f"W{abs(lon):03d}"
    return f"{lat_dir}{lon_dir}"


def load_srtm_index(merged_dir: Path) -> dict[tuple[int, int], dict]:
    """Load SRTM tile index from cached JSON (fast path)."""
    index_path = merged_dir / "srtm_index.json"
    if index_path.exists():
        import json as _json
        try:
            raw = _json.loads(index_path.read_text())
            # JSON: {"35,-106": {has_data, rows, cols}} → {(lat, lon): info}
            result = {}
            for k, v in raw.items():
                parts = k.split(",")
                lat = int(parts[0])
                lon = int(parts[1])
                result[(lat, lon)] = v
            return result
        except Exception:
            pass
    return _scan_srtm_tiles(merged_dir)


def _scan_srtm_tiles(merged_dir: Path) -> dict[tuple[int, int], dict]:
    """Slow fallback: scan all .merged files to build index."""
    from scripts.scan_srtm_tiles import scan_merged_header
    tile_map = {}
    if not merged_dir.exists():
        return tile_map
    for lat_dir in sorted(merged_dir.iterdir()):
        if not lat_dir.is_dir():
            continue
        for merged_file in sorted(lat_dir.glob("*.merged")):
            name = merged_file.stem
            lat_str = name[:3]
            lon_str = name[3:]
            try:
                lat_deg = int(lat_str[1:])
                if lat_str[0] == "S":
                    lat_deg = -lat_deg
                lon_deg = int(lon_str[1:])
                if lon_str[0] == "W":
                    lon_deg = -lon_deg
            except ValueError:
                continue
            info = scan_merged_header(merged_file)
            if info:
                tile_map[(lat_deg, lon_deg)] = info
    return tile_map


def discover_srtm_tiles(merged_dir: Path) -> dict[tuple[int, int], dict]:
    """Load or build SRTM tile index (JSON cache → slow scan fallback)."""
    return load_srtm_index(merged_dir)


def tile_has_land(
    z: int, x: int, y: int,
    srtm_tiles: dict[tuple[int, int], dict],
    merged_dir: Path,
    sample_points: int = 16,
) -> bool:
    """Check if a Mercator tile has any land by sampling strategic points.

    Groups sample points by SRTM tile and opens each MergedFile once,
    avoiding redundant file opens. Returns False for ocean-only tiles.
    """
    lat_min, lat_max, lon_min, lon_max = xyz_tile_to_lat_lon_bounds(z, x, y)

    # Skip tiles entirely outside SRTM latitude coverage
    if lat_max < SRTM_LAT_MIN or lat_min > SRTM_LAT_MAX:
        return False

    # Clamp sampling bounds to SRTM coverage
    sample_lat_min = max(lat_min, SRTM_LAT_MIN)
    sample_lat_max = min(lat_max, SRTM_LAT_MAX)
    if sample_lat_max <= sample_lat_min:
        return False

    lat_step = (sample_lat_max - sample_lat_min) / sample_points
    lon_step = (lon_max - lon_min) / sample_points

    # Group sample points by SRTM tile to open each file once
    # { (srtm_lat, srtm_lon): [(lat, lon), ...] }
    samples_by_tile: dict[tuple[int, int], list[tuple[float, float]]] = {}
    for row in range(sample_points):
        for col in range(sample_points):
            lat = sample_lat_min + (row + 0.5) * lat_step
            lon = lon_min + (col + 0.5) * lon_step

            srtm_lat = math.floor(lat)
            srtm_lon = math.floor(lon)

            if srtm_lat < -60 or srtm_lat >= 60 or srtm_lon < -180 or srtm_lon >= 180:
                continue
            if (srtm_lat, srtm_lon) not in srtm_tiles:
                continue
            if not srtm_tiles[(srtm_lat, srtm_lon)].get("has_data", False):
                continue

            samples_by_tile.setdefault((srtm_lat, srtm_lon), []).append((lat, lon))

    # Check each SRTM tile once, scanning all its sample points
    for (srtm_lat, srtm_lon), sample_locs in samples_by_tile.items():
        tile_name = _tile_name_from_lat_lon(srtm_lat, srtm_lon)
        lat_dir = tile_name[:3]
        merged_path = merged_dir / lat_dir / f"{tile_name}.merged"
        if not merged_path.exists():
            continue

        try:
            mf = get_merged_file(merged_path)
        except Exception:
            continue

        for lat, lon in sample_locs:
            lat_frac = lat - math.floor(lat)
            lon_frac = lon - math.floor(lon)
            lat_pixel = min(3600, max(0, round((1.0 - lat_frac) * 3600)))
            lon_pixel = min(3600, max(0, round(lon_frac * 3600)))

            chunk_row = min(14, lat_pixel // 256)
            chunk_col = min(14, lon_pixel // 256)

            idx = chunk_row * mf.cols + chunk_col
            if idx >= len(mf.index) or mf.index[idx]["size"] == 0:
                continue

            try:
                chunk = mf.get_chunk(chunk_row, chunk_col)
                local_row = min(lat_pixel - chunk_row * 256, chunk.shape[0] - 1)
                local_col = min(lon_pixel - chunk_col * 256, chunk.shape[1] - 1)
                val = chunk[local_row, local_col]
                if val != NODATA:
                    return True
            except Exception:
                continue

    return False


def generate_tile_grid(
    z: int, x: int, y: int,
    merged_dir: Path,
    srtm_tiles: dict[tuple[int, int], dict],
) -> np.ndarray:
    """Generate a 256×256 elevation grid for a tile.

    Groups all pixel lookups by (SRTM tile, chunk) and reads each chunk once,
    then assigns values to all pixels that reference it.
    Ocean pixels remain NODATA.
    """
    lat_min, lat_max, lon_min, lon_max = xyz_tile_to_lat_lon_bounds(z, x, y)
    deg_per_pixel_lat = (lat_max - lat_min) / TILE_SIZE
    deg_per_pixel_lon = (lon_max - lon_min) / TILE_SIZE

    grid = np.full((TILE_SIZE, TILE_SIZE), NODATA, dtype=np.int16)

    # Group pixel coordinates by (SRTM tile, chunk_row, chunk_col)
    # {(srtm_lat, srtm_lon, chunk_row, chunk_col): [(grid_row, grid_col, local_row, local_col), ...]}
    pixels_by_chunk: dict[
        tuple[int, int, int, int],
        list[tuple[int, int, int, int]]
    ] = {}

    for grid_row in range(TILE_SIZE):
        lat = lat_max - (grid_row + 0.5) * deg_per_pixel_lat
        lat_frac = lat - math.floor(lat)
        lat_pixel = min(3600, max(0, round((1.0 - lat_frac) * 3600)))
        chunk_row = min(14, lat_pixel // 256)
        local_row = min(lat_pixel - chunk_row * 256, 255)
        srtm_lat = math.floor(lat)

        for grid_col in range(TILE_SIZE):
            lon = lon_min + (grid_col + 0.5) * deg_per_pixel_lon
            lon_frac = lon - math.floor(lon)
            lon_pixel = min(3600, max(0, round(lon_frac * 3600)))
            chunk_col = min(14, lon_pixel // 256)
            local_col = min(lon_pixel - chunk_col * 256, 255)
            srtm_lon = math.floor(lon)

            if srtm_lat < -60 or srtm_lat >= 60 or srtm_lon < -180 or srtm_lon >= 180:
                continue
            if (srtm_lat, srtm_lon) not in srtm_tiles:
                continue
            if not srtm_tiles[(srtm_lat, srtm_lon)].get("has_data", False):
                continue

            pixels_by_chunk.setdefault(
                (srtm_lat, srtm_lon, chunk_row, chunk_col), []
            ).append((grid_row, grid_col, local_row, local_col))

    # Process each chunk once, assigning to all its pixels via numpy indexing
    for (srtm_lat, srtm_lon, chunk_row, chunk_col), pixel_locs in pixels_by_chunk.items():
        tile_name = _tile_name_from_lat_lon(srtm_lat, srtm_lon)
        lat_dir = tile_name[:3]
        merged_path = merged_dir / lat_dir / f"{tile_name}.merged"
        if not merged_path.exists():
            continue

        try:
            mf = get_merged_file(merged_path)
        except Exception:
            continue

        idx = chunk_row * mf.cols + chunk_col
        if idx >= len(mf.index) or mf.index[idx]["size"] == 0:
            continue

        try:
            chunk = mf.get_chunk(chunk_row, chunk_col)
        except Exception:
            continue

        # Batch-assign all pixels in this chunk using numpy
        grid_rows = np.array([p[0] for p in pixel_locs], dtype=np.intp)
        grid_cols = np.array([p[1] for p in pixel_locs], dtype=np.intp)
        local_rows = np.array([p[2] for p in pixel_locs], dtype=np.intp)
        local_cols = np.array([p[3] for p in pixel_locs], dtype=np.intp)

        values = chunk[local_rows, local_cols]
        mask = values != NODATA
        grid[grid_rows[mask], grid_cols[mask]] = values[mask]

    return grid


# ─── Worker globals (initialized once per process) ───────────────────────────
_worker_srtm_tiles: dict[tuple[int, int], dict] = {}
_worker_merged_dir: Path | None = None


def _init_worker(merged_dir_str: str) -> dict[tuple[int, int], dict]:
    """Initialize worker process: load SRTM index once per worker.

    Returns the index dict so the main process can verify it loaded.
    """
    global _worker_srtm_tiles, _worker_merged_dir
    _worker_merged_dir = Path(merged_dir_str)
    _worker_srtm_tiles = discover_srtm_tiles(_worker_merged_dir)
    return _worker_srtm_tiles


def convert_tile(args) -> dict:
    """Convert a single tile: check land → generate grid → OZT2 encode → write."""
    z, x, y, merged_dir, output_dir, max_rmse, compress_level, incremental = args

    out_path = Path(output_dir) / f"z{z}" / str(x) / f"{y}.ozt2"

    # Incremental: skip if already exists
    if incremental and out_path.exists():
        return {"status": "skipped", "z": z, "x": x, "y": y, "size": out_path.stat().st_size}

    # Land check: sample 16 points across the tile (uses worker globals)
    if not tile_has_land(z, x, y, _worker_srtm_tiles, _worker_merged_dir, sample_points=16):
        return {"status": "no-data", "z": z, "x": x, "y": y, "reason": "ocean tile"}

    try:
        grid = generate_tile_grid(z, x, y, _worker_merged_dir, _worker_srtm_tiles)

        # Skip tiles that are entirely NODATA after generation
        if np.all(grid == NODATA):
            return {"status": "no-data", "z": z, "x": x, "y": y, "reason": "all-nodata"}

        encoded, meta = auto_encode(grid, nodata_value=NODATA, max_rmse=max_rmse, compress_level=compress_level)

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


def convert_tile_batch(args_list: list) -> list[dict]:
    """Convert a batch of tiles in one worker call.

    Processing multiple tiles per submission reduces Python threading overhead.
    Each tile is processed sequentially, but we amortize GIL contention.
    """
    results = []
    for args in args_list:
        results.append(convert_tile(args))
    return results


def iter_task_tuples(
    zoom_range: tuple[int, int],
    merged_dir: Path,
    max_rmse: float = 1.0,
    compress_level: int = 9,
):
    """Generator that yields task tuples one at a time (memory-efficient)."""
    land_tiles = 0
    ocean_skipped = 0

    for z in range(zoom_range[0], zoom_range[1] + 1):
        n = 2 ** z

        # Compute y range that overlaps SRTM latitude coverage (-60 to +60)
        y_min = mercator_lat_to_tile_y(SRTM_LAT_MAX, z)
        y_max = mercator_lat_to_tile_y(SRTM_LAT_MIN, z)
        y_min = max(0, min(y_min, n - 1))
        y_max = max(0, min(y_max, n - 1))

        for x in range(n):
            for y in range(y_min, y_max + 1):
                yield (z, x, y, str(merged_dir), "", max_rmse, compress_level, False)
                land_tiles += 1

        if z <= 6:
            ocean_skipped += n * n - (y_max - y_min + 1) * n

    print(f"  Land tiles (SRTM overlap): {land_tiles:,}")
    if ocean_skipped > 0:
        print(f"  Ocean tiles (skipped):     {ocean_skipped:,}")


def build_task_list(
    zoom_range: tuple[int, int],
    output_dir: Path,
    merged_dir: Path,
    max_rmse: float = 1.0,
    compress_level: int = 9,
) -> tuple[list, dict[tuple[int, int], dict]]:
    """Build list of land-bearing tiles to convert.

    Returns (tasks, srtm_tiles) where tasks is a list of convert_tile args
    and srtm_tiles is the SRTM tile index.
    """
    srtm_tiles = discover_srtm_tiles(Path(merged_dir))
    print(f"  Found {len(srtm_tiles)} SRTM tiles on disk")
    return list(iter_task_tuples(zoom_range, merged_dir, max_rmse, compress_level))


def count_estimated_tiles(zoom_range: tuple[int, int]) -> int:
    """Estimate tile count for zoom range (upper bound)."""
    total = 0
    for z in range(zoom_range[0], zoom_range[1] + 1):
        n = 2 ** z
        y_min = mercator_lat_to_tile_y(SRTM_LAT_MAX, z)
        y_max = mercator_lat_to_tile_y(SRTM_LAT_MIN, z)
        y_min = max(0, min(y_min, n - 1))
        y_max = max(0, min(y_max, n - 1))
        tiles_in_zoom = n * (y_max - y_min + 1)
        total += tiles_in_zoom
    return total


def generate_manifest(output_dir: Path, zoom_range: tuple[int, int], elapsed: float, compress_level: int = 9) -> dict:
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
            "quality": compress_level,
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
        type=int, default=2,
        help="Number of parallel workers (default 2, 4+ may cause OOM)",
    )
    parser.add_argument(
        "--max-rmse",
        type=float, default=1.0,
        help="Maximum RMSE for adaptive bit-depth selection (meters)",
    )
    parser.add_argument(
        "--brotli-quality", "-q",
        type=int, default=9,
        dest="brotli_quality",
        help="Brotli compression quality 0-11 (default 9, faster than 11, <1%% quality loss)",
    )
    parser.add_argument(
        "--incremental",
        action="store_true",
        help="Skip tiles that already exist in output",
    )
    parser.add_argument(
        "--nas-backup",
        default="",
        help="NAS path to backup tiles after each zoom level (e.g. /nas/Temp/repos/OpenZenith/data/ozt2_tiles)",
    )
    parser.add_argument(
        "--manifest",
        default="manifest.json",
        help="Manifest filename (relative to output dir)",
    )
    args = parser.parse_args()

    merged_dir = Path(args.input)
    output_dir = Path(args.output)
    nas_backup = Path(args.nas_backup) if args.nas_backup else None

    if not merged_dir.exists():
        print(f"❌ Input directory not found: {merged_dir}")
        sys.exit(1)

    try:
        if "-" in args.zoom:
            z_start, z_end = map(int, args.zoom.split("-"))
        else:
            z_start = z_end = int(args.zoom)
        zoom_range = (z_start, z_end)
    except ValueError:
        print(f"❌ Invalid zoom range: {args.zoom}")
        sys.exit(1)

    print(f"OpenZenith OZT2 Tile Generator")
    print(f"{'=' * 60}")
    print(f"  Input:   {merged_dir}")
    print(f"  Output:  {output_dir}")
    print(f"  Zoom:    z{z_start}–z{z_end}")
    print(f"  Workers: {args.workers}")
    print(f"  Max RMSE: {args.max_rmse}m")
    print(f"  Brotli:  quality={args.brotli_quality}")
    print(f"  NAS backup: {nas_backup if nas_backup else 'none'}")
    print(f"  Mode:    {'incremental' if args.incremental else 'full convert'}")
    print(f"{'=' * 60}")
    print()

    # Count total tiles for progress reporting
    total_tiles_estimate = count_estimated_tiles(zoom_range)
    print(f"Estimated tiles: {total_tiles_estimate:,}")
    print(f"Starting conversion...")
    print()

    # Initialize worker globals in main thread (shared to all threads via memory)
    print("Initializing worker...")
    _init_worker(str(merged_dir))
    print(f"Worker ready: {len(_worker_srtm_tiles)} SRTM tiles indexed")

    # Pre-count tiles per zoom (fast — just math, no I/O)
    zoom_tile_counts: dict[int, int] = {}
    for z in range(z_start, z_end + 1):
        n = 2 ** z
        y_min = mercator_lat_to_tile_y(SRTM_LAT_MAX, z)
        y_max = mercator_lat_to_tile_y(SRTM_LAT_MIN, z)
        y_min = max(0, min(y_min, n - 1))
        y_max = max(0, min(y_max, n - 1))
        zoom_tile_counts[z] = n * (y_max - y_min + 1)

    t0 = time.time()
    all_errors = []
    total_ok = 0
    total_skipped = 0
    total_no_data = 0
    total_errors = 0
    completed_zooms = []

    for z in range(z_start, z_end + 1):
        zoom_t0 = time.time()
        z_done = 0
        z_bytes = 0
        z_results = {"ok": 0, "skipped": 0, "error": 0, "no-data": 0}
        z_errors = []
        z_tile_count = zoom_tile_counts[z]

        print(f"\n── z{z} ── ~{z_tile_count:,} tiles")
        print(f"  Started: {time.strftime('%H:%M:%S')}")

        # Build full task list for this zoom
        zoom_tasks: list = []
        n = 2 ** z
        y_min = mercator_lat_to_tile_y(SRTM_LAT_MAX, z)
        y_max = mercator_lat_to_tile_y(SRTM_LAT_MIN, z)
        y_min = max(0, min(y_min, n - 1))
        y_max = max(0, min(y_max, n - 1))
        for x in range(n):
            for y in range(y_min, y_max + 1):
                zoom_tasks.append((z, x, y, str(merged_dir), str(output_dir), args.max_rmse, args.brotli_quality, args.incremental))

        # ProcessPoolExecutor with wait() polling.
        # as_completed() hangs with ProcessPoolExecutor in this environment (Python 3.13 multiprocessing).
        # wait() returns when all submitted futures complete (no notification needed).
        # Process-level LRU caches in merged.py prevent memory growth.
        import time as _time
        with ProcessPoolExecutor(max_workers=args.workers) as executor:
            futures: list = []
            for t in zoom_tasks:
                futures.append(executor.submit(convert_tile, t))

            # Poll with wait() in short intervals to get results incrementally
            while futures:
                done, futures = wait(futures, timeout=5.0)
                for f in done:
                    r = f.result()
                    status = r.get("status", "error")
                    z_results[status] = z_results.get(status, 0) + 1
                    z_done += 1

                    if status == "error":
                        z_errors.append(r)
                    elif status in ("ok", "skipped"):
                        z_bytes += r.get("size", 0)

                    # Progress every 5k tiles
                    if z_done % 5000 == 0 or z_done == z_tile_count:
                        elapsed = time.time() - t0
                        z_elapsed = time.time() - zoom_t0
                        rate = z_done / z_elapsed if z_elapsed > 0.1 else 0
                        pct = 100 * z_done / z_tile_count if z_tile_count > 0 else 0
                        eta = (z_tile_count - z_done) / rate if rate > 0 else 0
                        print(
                            f"  [{z_done:>6,}/{z_tile_count:>6,} ({pct:>5.1f}%%)] "
                            f"✅ {z_results['ok']:>6,} "
                            f"🌊 {z_results['no-data']:>6,} "
                            f"❌ {z_results['error']:>4,} "
                            f"· {rate:>6,.0f}/s · ETA {eta:.0f}s"
                        )
                # Short sleep if no completed in this iteration
                if not done:
                    _time.sleep(0.5)

        z_elapsed = time.time() - zoom_t0
        z_ok = z_results.get("ok", 0)
        z_size_gb = z_bytes / 1e9

        print(
            f"  ✅ z{z}: {z_ok:,} tiles in {z_elapsed:.0f}s "
            f"({z_ok/z_elapsed:.0f} tiles/s, ~{z_size_gb:.1f} GB)"
        )

        total_ok += z_ok
        total_skipped += z_results.get("skipped", 0)
        total_no_data += z_results.get("no-data", 0)
        total_errors += z_results.get("error", 0)
        all_errors.extend(z_errors)
        completed_zooms.append(z)

        # Per-zoom NAS backup
        if nas_backup and z_ok > 0:
            z_out = output_dir / f"z{z}"
            if z_out.exists():
                nas_z_dir = nas_backup / f"z{z}"
                print(f"  📦 Backing up z{z} to NAS...")
                import shutil
                nas_z_dir.parent.mkdir(parents=True, exist_ok=True)
                if nas_z_dir.exists():
                    shutil.rmtree(nas_z_dir)
                shutil.copytree(z_out, nas_z_dir)
                nas_size = sum(f.stat().st_size for f in nas_z_dir.rglob("*.ozt2"))
                print(f"  ✅ NAS backup: {nas_z_dir} ({nas_size/1e9:.1f} GB)")

    elapsed = time.time() - t0

    print(f"\n{'=' * 60}")
    print(f"CONVERSION COMPLETE — {elapsed:.1f}s total ({elapsed/3600:.1f}h)")
    print(f"{'=' * 60}")
    print(f"  ✅ Converted:  {total_ok:>10,} tiles")
    print(f"  ⏭  Skipped:   {total_skipped:>10,}")
    print(f"  🌊 No data:    {total_no_data:>10,}")
    print(f"  ❌ Errors:     {total_errors:>10,}")
    print(f"  Speed:        {total_ok / elapsed:>10,.0f} tiles/sec")
    print(f"  Zooms:        {', '.join(f'z{z}' for z in completed_zooms)}")

    if total_errors > 0:
        print(f"\nErrors (first 10):")
        for r in all_errors[:10]:
            print(f"  z{r['z']}/{r['x']}/{r['y']}: {r.get('error', 'unknown')}")

    # Generate manifest
    manifest = generate_manifest(output_dir, zoom_range, elapsed, args.brotli_quality)
    manifest_path = output_dir / args.manifest
    manifest_path.write_text(json.dumps(manifest, indent=2))
    print(f"\n  Manifest: {manifest_path}")
    print(f"  Total tiles in manifest: {manifest['total_tiles']:,}")
    if manifest["total_bytes"] > 0:
        print(f"  Total size: {manifest['total_gb']:.2f} GB")

    results_data = {
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "elapsed_seconds": round(elapsed, 1),
        "tiles_converted": total_ok,
        "tiles_skipped": total_skipped,
        "tiles_no_data": total_no_data,
        "tiles_errored": total_errors,
        "errors": all_errors[:100],
    }
    results_path = output_dir / "conversion_results.json"
    results_path.write_text(json.dumps(results_data, indent=2))

    if total_errors > 0:
        print(f"\n⚠️  {total_errors} tiles failed — see {results_path}")
        sys.exit(1)
    else:
        print(f"\n✅ All tiles converted successfully")
        sys.exit(0)


if __name__ == "__main__":
    main()
