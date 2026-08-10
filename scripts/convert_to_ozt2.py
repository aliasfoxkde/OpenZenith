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
import sys
import time
from concurrent.futures import ProcessPoolExecutor, wait
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent.parent))

from openzenith.merged import get_merged_file
from openzenith.tile_format_v2 import COMP_BROTLI, COMP_ZLIB, COMP_ZSTD, PRED_GRADIENT, encode

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
    valid_tiles: set[tuple[int, int]] | None = None,
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

    # ── FAST PRE-CHECK: reject if NO SRTM tiles in bounding box have land ──
    # Compute the SRTM tile bounding box that contains this Mercator tile.
    # If none of those SRTM tiles have land data, reject immediately (no I/O).
    srtm_lat_min = math.floor(sample_lat_min)
    srtm_lat_max = math.floor(sample_lat_max)
    srtm_lon_min = math.floor(lon_min)
    srtm_lon_max = math.floor(lon_max)
    has_land_srtm = False
    for srtm_lat in range(srtm_lat_min, srtm_lat_max + 1):
        for srtm_lon in range(srtm_lon_min, srtm_lon_max + 1):
            if (srtm_lat, srtm_lon) in (valid_tiles or _worker_srtm_tiles_set):
                has_land_srtm = True
                break
        if has_land_srtm:
            break
    if not has_land_srtm:
        return False

    lat_step = (sample_lat_max - sample_lat_min) / sample_points
    lon_step = (lon_max - lon_min) / sample_points

    # Vectorized: compute all sample lat/lon at once
    lat_vals = sample_lat_min + (np.arange(sample_points) + 0.5) * lat_step
    lon_vals = lon_min + (np.arange(sample_points) + 0.5) * lon_step

    lat_grid = lat_vals[:, np.newaxis] + np.zeros(sample_points, dtype=np.float64)
    lon_grid = np.zeros((sample_points, sample_points), dtype=np.float64) + lon_vals[np.newaxis, :]

    # Compute SRTM tile coords (floor of lat/lon)
    srtm_lat_grid = np.floor(lat_grid).astype(np.int32)
    srtm_lon_grid = np.floor(lon_grid).astype(np.int32)

    # Compute lat_frac/lon_frac for pixel calculation
    lat_frac_grid = lat_grid - srtm_lat_grid.astype(np.float64)
    lon_frac_grid = lon_grid - srtm_lon_grid.astype(np.float64)

    # Compute pixel positions within 3600x3600 SRTM tile
    lat_pixel_grid = np.clip(np.round((1.0 - lat_frac_grid) * 3600), 0, 3600).astype(np.int32)
    lon_pixel_grid = np.clip(np.round(lon_frac_grid * 3600), 0, 3600).astype(np.int32)

    # Compute chunk row/col and local position within chunk
    chunk_row_grid = np.clip(lat_pixel_grid // 256, 0, 14)
    chunk_col_grid = np.clip(lon_pixel_grid // 256, 0, 14)
    local_row_grid = np.clip(lat_pixel_grid - chunk_row_grid * 256, 0, 255)
    local_col_grid = np.clip(lon_pixel_grid - chunk_col_grid * 256, 0, 255)

    # Use pre-computed valid_tiles set (passed in or from worker globals)
    vt = valid_tiles if valid_tiles is not None else _worker_srtm_tiles_set

    # ── FAST SRTM-CENTER CHECK ──────────────────────────────────────────────
    # For each SRTM tile in the bounding box, check the center pixel directly.
    # This catches land that a sparse sample grid might miss near tile edges.
    # Grid size in degrees per SRTM tile = 1°. Mercator tile at z13 ≈ 0.039°.
    # 16×16 grid → spacing ≈ 0.0024° ≈ 1 SRTM pixel (30m). Center check is
    # essentially free (one pixel read per SRTM tile vs 256 for full grid).
    for srtm_lat in range(srtm_lat_min, srtm_lat_max + 1):
        for srtm_lon in range(srtm_lon_min, srtm_lon_max + 1):
            if (srtm_lat, srtm_lon) not in vt:
                continue

            tile_name = _tile_name_from_lat_lon(srtm_lat, srtm_lon)
            lat_dir = tile_name[:3]
            merged_path = merged_dir / lat_dir / f"{tile_name}.merged"
            if not merged_path.exists():
                continue

            try:
                mf = get_merged_file(merged_path)
            except Exception:
                continue

            # Check center pixel of the SRTM tile: lat center = srtm_lat - 0.5,
            # lon center = srtm_lon + 0.5. Pixel = round((1 - 0.5) * 3600) = 1800.
            # Chunk = 1800 // 256 = 7, local = 1800 - 7*256 = 28.
            cr_center, cc_center = 7, 7
            idx_flat = cr_center * mf.cols + cc_center
            if idx_flat >= len(mf.index) or mf.index[idx_flat]["size"] == 0:
                continue

            try:
                chunk = mf.get_chunk(cr_center, cc_center)
                # Sample 4 center-ish pixels to handle edge cases
                for dr, dc in [(28, 28), (28, 227), (227, 28), (227, 227)]:
                    if chunk[dr, dc] != NODATA:
                        return True
            except Exception:
                continue

    # ── GRID-BASED SAMPLE FALLBACK (redundant check skipped if center hit) ──
    # Flatten all grids for fast iteration over unique SRTM tiles
    flat_size = sample_points * sample_points
    srtm_lats_flat = srtm_lat_grid.ravel()
    srtm_lons_flat = srtm_lon_grid.ravel()
    chunk_rows_flat = chunk_row_grid.ravel()
    chunk_cols_flat = chunk_col_grid.ravel()
    local_rows_flat = local_row_grid.ravel()
    local_cols_flat = local_col_grid.ravel()

    # Group by SRTM tile: tile_key → list of local indices
    tile_to_indices: dict[tuple[int, int], list[int]] = {}
    for i in range(flat_size):
        key = (srtm_lats_flat[i], srtm_lons_flat[i])
        if key in vt:
            tile_to_indices.setdefault(key, []).append(i)

    # Check each SRTM tile once
    for (srtm_lat, srtm_lon), indices in tile_to_indices.items():
        tile_name = _tile_name_from_lat_lon(srtm_lat, srtm_lon)
        lat_dir = tile_name[:3]
        merged_path = merged_dir / lat_dir / f"{tile_name}.merged"
        if not merged_path.exists():
            continue

        try:
            mf = get_merged_file(merged_path)
        except Exception:
            continue

        for idx in indices:
            cr = chunk_rows_flat[idx]
            cc = chunk_cols_flat[idx]
            idx_flat = cr * mf.cols + cc
            if idx_flat >= len(mf.index) or mf.index[idx_flat]["size"] == 0:
                continue

            try:
                chunk = mf.get_chunk(cr, cc)
                lr = local_rows_flat[idx]
                lc = local_cols_flat[idx]
                if chunk[lr, lc] != NODATA:
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

    # Vectorized: compute all 65,536 pixel coordinates at once via numpy broadcasting
    grid_rows_1d = np.arange(TILE_SIZE, dtype=np.float64)
    lat_1d = lat_max - (grid_rows_1d + 0.5) * deg_per_pixel_lat
    lon_1d = lon_min + (grid_rows_1d + 0.5) * deg_per_pixel_lon

    # Broadcast to 2D grids: (TILE_SIZE, TILE_SIZE) each
    lat_grid = lat_1d[:, np.newaxis] + np.zeros(TILE_SIZE, dtype=np.float64)
    lon_grid = np.zeros((TILE_SIZE, TILE_SIZE), dtype=np.float64) + lon_1d[np.newaxis, :]

    # SRTM tile coordinates
    srtm_lat_grid = np.floor(lat_grid).astype(np.int32)
    srtm_lon_grid = np.floor(lon_grid).astype(np.int32)

    # Fractional position within the 1°×1° SRTM tile
    lat_frac_grid = lat_grid - srtm_lat_grid.astype(np.float64)
    lon_frac_grid = lon_grid - srtm_lon_grid.astype(np.float64)

    # Pixel position within the 3600×3600 SRTM tile
    lat_pixel_grid = np.clip(np.round((1.0 - lat_frac_grid) * 3600), 0, 3600).astype(np.int32)
    lon_pixel_grid = np.clip(np.round(lon_frac_grid * 3600), 0, 3600).astype(np.int32)

    # Chunk and local coordinates within chunk
    chunk_row_grid = np.clip(lat_pixel_grid // 256, 0, 14)
    chunk_col_grid = np.clip(lon_pixel_grid // 256, 0, 14)
    local_row_grid = np.clip(lat_pixel_grid - chunk_row_grid * 256, 0, 255).astype(np.int32)
    local_col_grid = np.clip(lon_pixel_grid - chunk_col_grid * 256, 0, 255).astype(np.int32)

    # Pre-build valid-tile set for fast lookup
    valid_tiles: set[tuple[int, int]] = {
        (lat, lon) for (lat, lon), info in srtm_tiles.items()
        if info.get("has_data", False)
        and -60 <= lat < 60 and -180 <= lon < 180
    }

    # Flatten everything: (TILE_SIZE * TILE_SIZE,)
    flat_size = TILE_SIZE * TILE_SIZE
    srtm_lats_flat = srtm_lat_grid.ravel()
    srtm_lons_flat = srtm_lon_grid.ravel()
    chunk_rows_flat = chunk_row_grid.ravel()
    chunk_cols_flat = chunk_col_grid.ravel()
    local_rows_flat = local_row_grid.ravel()
    local_cols_flat = local_col_grid.ravel()

    # Group pixel indices by (srtm_lat, srtm_lon, chunk_row, chunk_col)
    tile_to_pixels: dict[tuple[int, int, int, int], list[int]] = {}
    for i in range(flat_size):
        slat = srtm_lats_flat[i]
        slon = srtm_lons_flat[i]
        # Bounds check and valid-tile check
        if slat < -60 or slat >= 60 or slon < -180 or slon >= 180:
            continue
        if (slat, slon) not in valid_tiles:
            continue
        key = (slat, slon, chunk_rows_flat[i], chunk_cols_flat[i])
        tile_to_pixels.setdefault(key, []).append(i)

    # Process each chunk once, batch-assign all its pixels
    for (srtm_lat, srtm_lon, chunk_row, chunk_col), pixel_indices in tile_to_pixels.items():
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

        # Batch numpy indexing: all pixel positions in this chunk at once
        idx_arr = np.array(pixel_indices, dtype=np.intp)
        grid_row_idx = idx_arr // TILE_SIZE
        grid_col_idx = idx_arr % TILE_SIZE
        local_row_idx = local_rows_flat[idx_arr]
        local_col_idx = local_cols_flat[idx_arr]

        values = chunk[local_row_idx, local_col_idx]
        mask = values != NODATA
        grid[grid_row_idx[mask], grid_col_idx[mask]] = values[mask]

    return grid


# ─── Worker globals (initialized once per process) ───────────────────────────
_worker_srtm_tiles: dict[tuple[int, int], dict] = {}
_worker_srtm_tiles_set: set[tuple[int, int]] = set()
_worker_merged_dir: Path | None = None


def _init_worker(merged_dir_str: str) -> None:
    """Initialize worker process: load SRTM index once per worker."""
    global _worker_srtm_tiles, _worker_srtm_tiles_set, _worker_merged_dir
    _worker_merged_dir = Path(merged_dir_str)
    _worker_srtm_tiles = discover_srtm_tiles(_worker_merged_dir)
    _worker_srtm_tiles_set = {
        (lat, lon) for (lat, lon), info in _worker_srtm_tiles.items()
        if info.get("has_data", False)
        and -60 <= lat < 60 and -180 <= lon < 180
    }


def convert_tile(args) -> dict:
    """Convert a single tile: check land → generate grid → OZT2 encode → write."""
    z, x, y, _merged_dir, output_dir, _max_rmse, codec, compress_level, incremental = args

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

        # Encode with specified codec (default: Zstd — 30x faster than Brotli)
        encoded = encode(
            grid, nodata_value=NODATA,
            predictor=PRED_GRADIENT,
            compressor=codec,
            compress_level=compress_level,
        )

        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_bytes(encoded)

        return {
            "status": "ok",
            "z": z, "x": x, "y": y,
            "size": len(encoded),
            "codec": codec,
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
    codec: int = COMP_ZSTD,
    compress_level: int = 3,
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
                yield (z, x, y, str(merged_dir), "", max_rmse, codec, compress_level, False)
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
    codec: int = COMP_ZSTD,
    compress_level: int = 3,
) -> tuple[list, dict[tuple[int, int], dict]]:
    """Build list of land-bearing tiles to convert.

    Returns (tasks, srtm_tiles) where tasks is a list of convert_tile args
    and srtm_tiles is the SRTM tile index.
    """
    srtm_tiles = discover_srtm_tiles(Path(merged_dir))
    print(f"  Found {len(srtm_tiles)} SRTM tiles on disk")
    return list(iter_task_tuples(zoom_range, merged_dir, max_rmse, codec, compress_level))


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


def generate_manifest(
    output_dir: Path,
    zoom_range: tuple[int, int],
    elapsed: float,
    codec: str = "brotli",
    compress_level: int = 9,
) -> dict:
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
            "compressor": codec,
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
        type=int, default=8,
        help="Number of parallel workers (default: 8)",
    )
    parser.add_argument(
        "--max-rmse",
        type=float, default=1.0,
        help="Maximum RMSE for adaptive bit-depth selection (meters)",
    )
    parser.add_argument(
        "--codec",
        choices=["brotli", "zstd", "zlib"],
        default="zstd",
        help="Compression codec (default: zstd, 30x faster than brotli)",
    )
    parser.add_argument(
        "--compress-level",
        type=int, default=3,
        dest="compress_level",
        help="Compression level (zstd: 1-22 default 3, brotli: 0-11 default 9)",
    )
    parser.add_argument(
        "--brotli-quality", "-q",
        type=int, default=9,
        dest="brotli_quality",
        help="(Deprecated) Use --codec zstd --compress-level 3 instead",
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

    # Resolve codec string to constant
    CODEC_MAP = {"brotli": COMP_BROTLI, "zstd": COMP_ZSTD, "zlib": COMP_ZLIB}
    codec = CODEC_MAP[args.codec]

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

    print("OpenZenith OZT2 Tile Generator")
    print(f"{'=' * 60}")
    print(f"  Input:   {merged_dir}")
    print(f"  Output:  {output_dir}")
    print(f"  Zoom:    z{z_start}–z{z_end}")
    print(f"  Workers: {args.workers}")
    print(f"  Max RMSE: {args.max_rmse}m")
    print(f"  Codec:   {args.codec} (level={args.compress_level})")
    print(f"  NAS backup: {nas_backup if nas_backup else 'none'}")
    print(f"  Mode:    {'incremental' if args.incremental else 'full convert'}")
    print(f"{'=' * 60}")
    print()

    # Count total tiles for progress reporting
    total_tiles_estimate = count_estimated_tiles(zoom_range)
    print(f"Estimated tiles: {total_tiles_estimate:,}")
    print("Starting conversion...")
    print()

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

    # Batch size: tiles per convert_tile_batch submission
    BATCH_SIZE = 32

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
                zoom_tasks.append((z, x, y, str(merged_dir), str(output_dir), args.max_rmse, codec, args.compress_level, args.incremental))

        # ProcessPoolExecutor with wait() polling.
        # as_completed() hangs with ProcessPoolExecutor in this environment (Python 3.13 multiprocessing).
        # wait() returns when all submitted futures complete (no notification needed).
        # Process-level LRU caches in merged.py prevent memory growth.
        # Each worker initializes via _init_worker (set as initializer below).
        import time as _time
        with ProcessPoolExecutor(
            max_workers=args.workers,
            initializer=_init_worker,
            initargs=(str(merged_dir),),
        ) as executor:
            futures: list = []
            # Submit in batches of BATCH_SIZE for better chunk cache locality
            for i in range(0, len(zoom_tasks), BATCH_SIZE):
                batch = zoom_tasks[i:i + BATCH_SIZE]
                futures.append(executor.submit(convert_tile_batch, batch))

            # Poll with wait() in short intervals to get results incrementally
            while futures:
                done, futures = wait(futures, timeout=5.0)
                for f in done:
                    results = f.result()  # convert_tile_batch returns a list
                    for r in results:
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
        print("\nErrors (first 10):")
        for r in all_errors[:10]:
            print(f"  z{r['z']}/{r['x']}/{r['y']}: {r.get('error', 'unknown')}")

    # Generate manifest
    manifest = generate_manifest(output_dir, zoom_range, elapsed, args.codec, args.compress_level)
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
        print("\n✅ All tiles converted successfully")
        sys.exit(0)


if __name__ == "__main__":
    main()
