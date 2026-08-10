"""High-level elevation query API for OpenZenith.

Query elevation at any lat/lon using:
- OZT2 tiles (preferred, v2 dataset)
- Terrarium PNG tiles from HuggingFace (legacy v1)

Usage:
    from openzenith import get_elevation, get_elevation_from_ozt2

    # Query single point (auto-selects best backend)
    elev = get_elevation(40.7128, -74.0060)
    print(f"NYC elevation: {elev:.1f}m")

    # Query from OZT2 tiles directly
    elev = get_elevation_from_ozt2(40.7128, -74.0060, ozt2_dir="/data/ozt2_tiles")

    # Batch query
    elevations = get_elevation_batch([
        (40.7128, -74.0060),   # New York
        (35.6762, 139.6503),   # Tokyo
        (-33.8688, 151.2093),  # Sydney
    ])
"""

import logging
import math
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import cast

import numpy as np

from .terrarium import decode_tile
from .tile_format_v2 import decode as decode_ozt2

_logger = logging.getLogger(__name__)


def _log_tile_error(path: Path, operation: str, err: Exception) -> None:
    """Log tile read/decode errors at debug level (these are frequent and expected)."""
    _logger.debug("tile %s failed (%s): %s: %s", path, operation, type(err).__name__, err)


# Default HuggingFace dataset
HF_REPO = "aliasfox/openzenith-dem"
DEFAULT_TILE_DIR = None  # Set via load_tiles()
DEFAULT_OZT2_DIR = None  # Set via load_ozt2_tiles()


def latlon_to_tile(lat: float, lon: float, zoom: int) -> tuple[int, int]:
    """Convert lat/lon to tile coordinates at a given zoom level."""
    n = 2**zoom
    x = int(((lon + 180) / 360) * n)
    lat_rad = (lat * math.pi) / 180
    y = int(((1 - math.log(math.tan(lat_rad) + 1 / math.cos(lat_rad)) / math.pi) / 2) * n)
    return x, y


def get_elevation(
    lat: float,
    lon: float,
    tile_dir: str | Path | None = None,
    zoom_levels: list[int] | None = None,
    cache_dir: str | Path | None = None,
    use_ozt2: bool = False,
) -> float | None:
    """Get elevation at a lat/lon.

    Tries OZT2 tiles first if use_ozt2=True and OZT2 tiles are configured,
    otherwise falls back to Terrarium PNG tiles.

    Args:
        lat: Latitude (-90 to 90)
        lon: Longitude (-180 to 180)
        tile_dir: Path to tile directory (default: loaded tiles dir)
        zoom_levels: Zoom levels to try (default: [8, 7, 6, 5])
        cache_dir: Alias for tile_dir
        use_ozt2: If True, try OZT2 tiles first (default: False)

    Returns:
        Elevation in meters, or None if no data found.
    """
    # Try OZT2 backend if available
    if use_ozt2 and DEFAULT_OZT2_DIR is not None:
        elev = _get_elevation_from_ozt2(lat, lon, DEFAULT_OZT2_DIR, zoom_levels)
        if elev is not None:
            return elev

    # Fall back to PNG tiles
    if zoom_levels is None:
        zoom_levels = [8, 7, 6, 5]

    _tile_dir = tile_dir if tile_dir is not None else (cache_dir or DEFAULT_TILE_DIR)
    if _tile_dir is None:
        raise ValueError("No tile directory. Call load_tiles() or pass tile_dir.")
    _dir = Path(_tile_dir)

    for zoom in zoom_levels:
        x, y = latlon_to_tile(lat, lon, zoom)
        tile_path = _dir / str(zoom) / str(x) / f"{y}.png"

        if not tile_path.exists():
            continue

        try:
            with open(tile_path, "rb") as f:
                png_bytes = f.read()
            elev = _interpolate_from_tile(png_bytes, lat, lon, zoom, x, y)
            if elev is not None and not math.isnan(elev):
                return elev
        except OSError as err:
            _log_tile_error(tile_path, "read", err)
            continue
        except Exception as err:  # noqa: BLE001
            _log_tile_error(tile_path, "decode", err)
            continue

    return None


def get_elevation_batch(
    points: list[tuple[float, float]],
    tile_dir: str | Path | None = None,
    zoom_levels: list[int] | None = None,
    max_workers: int = 8,
) -> list[float | None]:
    """Get elevation for multiple lat/lon points.

    Args:
        points: List of (lat, lon) tuples
        tile_dir: Path to tile directory
        zoom_levels: Zoom levels to try
        max_workers: Maximum number of parallel workers (default: 8)

    Returns:
        List of elevation values (None if no data).
    """
    if not points:
        return []

    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {
            executor.submit(get_elevation, lat, lon, tile_dir, zoom_levels): i
            for i, (lat, lon) in enumerate(points)
        }
        results = [None] * len(points)
        for future in as_completed(futures):
            idx = futures[future]
            try:
                results[idx] = future.result()
            except Exception:  # noqa: BLE001
                results[idx] = None
    return results


def _interpolate_from_tile(
    png_bytes: bytes,
    lat: float,
    lon: float,
    zoom: int,
    tile_x: int,
    tile_y: int,
) -> float | None:
    """Decode a tile and bilinearly interpolate elevation at lat/lon."""
    elevation = decode_tile(png_bytes)
    h, w = elevation.shape

    # Convert lat/lon to fractional tile coordinates
    n = 2**zoom
    x_frac = ((lon + 180) / 360) * n - tile_x
    lat_rad = (lat * math.pi) / 180
    y_frac = ((1 - math.log(math.tan(lat_rad) + 1 / math.cos(lat_rad)) / math.pi) / 2) * n - tile_y

    # Pixel coordinates within tile
    px = x_frac * (w - 1)
    py = y_frac * (h - 1)

    x0 = int(px)
    y0 = int(py)
    x1 = min(x0 + 1, w - 1)
    y1 = min(y0 + 1, h - 1)

    fx = px - x0
    fy = py - y0

    # Bilinear interpolation
    h00 = elevation[y0, x0]
    h10 = elevation[y0, x1]
    h01 = elevation[y1, x0]
    h11 = elevation[y1, x1]

    # Skip if any corner is NaN
    if any(math.isnan(v) for v in [h00, h10, h01, h11]):
        # Return nearest valid pixel
        for val in [h00, h10, h01, h11]:
            if not math.isnan(val):
                return float(val)
        return None

    result = h00 * (1 - fx) * (1 - fy) + h10 * fx * (1 - fy) + h01 * (1 - fx) * fy + h11 * fx * fy
    return round(float(result), 1)


def load_tiles(
    zoom_levels: list[int] | None = None,
    repo_id: str = HF_REPO,
    cache_dir: str | Path | None = None,
) -> Path:
    """Download tiles from HuggingFace to a local cache directory.

    Args:
        zoom_levels: Zoom levels to download (default: [0, 1, 2, 3, 4, 5, 6, 7, 8])
        repo_id: HuggingFace dataset repository ID
        cache_dir: Local cache directory (default: ~/.cache/openzenith-dem)

    Returns:
        Path to the tile directory.
    """
    global DEFAULT_TILE_DIR

    if zoom_levels is None:
        zoom_levels = [0, 1, 2, 3, 4, 5, 6, 7, 8]

    if cache_dir is None:
        cache_dir = Path.home() / ".cache" / "openzenith-dem"
    else:
        cache_dir = Path(cache_dir)

    try:
        from huggingface_hub import snapshot_download
    except ImportError:
        raise ImportError(
            "huggingface_hub required for downloading tiles. "
            "Install with: pip install huggingface_hub"
        )

    # Download specific zoom directories
    [f"tiles/{z}/*" for z in zoom_levels]
    allow_patterns = []
    for z in zoom_levels:
        allow_patterns.append(f"tiles/{z}/**")

    print(f"Downloading tiles from {repo_id} (zoom {min(zoom_levels)}-{max(zoom_levels)})...")
    local_dir = snapshot_download(
        repo_id=repo_id,
        repo_type="dataset",
        cache_dir=str(cache_dir),
        allow_patterns=allow_patterns,
    )

    DEFAULT_TILE_DIR = Path(local_dir)
    print(f"Tiles cached at: {DEFAULT_TILE_DIR}")
    return DEFAULT_TILE_DIR


def load_elevation_grid(
    lat: float,
    lon: float,
    zoom: int,
    radius_cells: int = 100,
    cache_dir: str | Path | None = None,
) -> dict:
    """Load a rectangular elevation grid centered on a point.

    Loads all tiles needed to cover the requested area and assembles
    them into a single numpy array.

    Args:
        lat: Center latitude
        lon: Center longitude
        zoom: Tile zoom level
        radius_cells: Grid radius in cells (total grid = 2*radius_cells + 1)
        cache_dir: Tile cache directory (default: loaded tiles dir)

    Returns:
        Dict with 'grid', 'center_row', 'center_col', 'lat_min', 'lon_min',
        'cell_size_deg', 'center_lat', 'center_lon'
    """
    base = Path(cache_dir) if cache_dir else (Path(DEFAULT_TILE_DIR) if DEFAULT_TILE_DIR else None)
    if base is None:
        raise ValueError("No tile directory. Call load_tiles() or pass cache_dir.")

    # Cell size in degrees at this zoom level
    n = 2**zoom
    180.0 / (n * 256)

    # Convert radius to tile coordinates
    cx, cy = latlon_to_tile(lat, lon, zoom)

    # Fractional position within center tile
    x_frac = ((lon + 180) / 360) * n - cx
    lat_rad = (lat * math.pi) / 180
    y_frac = ((1 - math.log(math.tan(lat_rad) + 1 / math.cos(lat_rad)) / math.pi) / 2) * n - cy

    # Grid dimensions
    grid_rows = 2 * radius_cells + 1
    grid_cols = 2 * radius_cells + 1

    grid = np.full((grid_rows, grid_cols), np.nan, dtype=np.float32)

    # Determine which tiles we need
    min_pixel_x = cx * 256 - radius_cells + int(x_frac * 256)
    max_pixel_x = cx * 256 + radius_cells + int(x_frac * 256)
    min_pixel_y = cy * 256 - radius_cells + int(y_frac * 256)
    max_pixel_y = cy * 256 + radius_cells + int(y_frac * 256)

    tile_x_min = min_pixel_x // 256
    tile_x_max = max_pixel_x // 256
    tile_y_min = min_pixel_y // 256
    tile_y_max = max_pixel_y // 256

    # Collect tile paths first
    tile_tasks = []
    for tx in range(tile_x_min, tile_x_max + 1):
        for ty in range(tile_y_min, tile_y_max + 1):
            tile_path = base / str(zoom) / str(tx) / f"{ty}.png"
            if tile_path.exists():
                tile_tasks.append((tx, ty, tile_path))

    # Load tiles in parallel
    def load_tile(args):
        tx, ty, tile_path = args
        try:
            with open(tile_path, "rb") as f:
                png_bytes = f.read()
            return (tx, ty, decode_tile(png_bytes))
        except OSError as err:
            _log_tile_error(tile_path, "read", err)
            return (tx, ty, None)
        except Exception as err:  # noqa: BLE001
            _log_tile_error(tile_path, "decode", err)
            return (tx, ty, None)

    with ThreadPoolExecutor(max_workers=8) as executor:
        loaded_tiles = list(executor.map(load_tile, tile_tasks))

    # Place tiles into grid (sequential - must be ordered)
    for tx, ty, tile_data in loaded_tiles:
        if tile_data is None:
            continue

        th, tw = tile_data.shape

        # Pixel range in global coordinates
        global_x_start = tx * 256
        global_y_start = ty * 256

        # Compute local grid offsets (where this tile maps into the output grid)
        local_x_start = global_x_start - min_pixel_x
        local_y_start = global_y_start - min_pixel_y

        # Determine overlap between tile pixels and output grid
        src_x0 = max(0, -local_x_start)
        src_y0 = max(0, -local_y_start)
        src_x1 = min(tw, grid_cols - local_x_start)
        src_y1 = min(th, grid_rows - local_y_start)

        if src_x1 > src_x0 and src_y1 > src_y0:
            dst_x0 = local_x_start + src_x0
            dst_y0 = local_y_start + src_y0
            tile_slice = tile_data[src_y0:src_y1, src_x0:src_x1]
            # Only write non-NaN values; NaN pixels in the source are ocean/NODATA
            valid = ~np.isnan(tile_slice)
            grid[dst_y0:dst_y0 + (src_y1 - src_y0), dst_x0:dst_x0 + (src_x1 - src_x0)][valid] = (
                tile_slice[valid]
            )

    # Compute geographic bounds
    center_row = radius_cells
    center_col = radius_cells

    # Convert pixel coordinates to lat/lon using Web Mercator inverse
    def pixel_to_lat(py: int, z: int) -> float:
        n = 2**z * 256
        y_norm = py / n
        lat_rad = math.atan(math.sinh(math.pi * (1 - 2 * y_norm)))
        return math.degrees(lat_rad)

    def pixel_to_lon(px: int, z: int) -> float:
        n = 2**z * 256
        return (px / n) * 360.0 - 180.0

    lat_min = pixel_to_lat(min_pixel_y + grid_rows, zoom)
    lat_max = pixel_to_lat(min_pixel_y, zoom)
    lon_min = pixel_to_lon(min_pixel_x, zoom)
    lon_max = pixel_to_lon(min_pixel_x + grid_cols, zoom)

    # Cell size varies with latitude in Mercator; use average for reference
    cell_size_deg_lat = (lat_max - lat_min) / grid_rows
    _cell_size_deg_lon = (lon_max - lon_min) / grid_cols  # unused but kept for clarity

    return {
        "grid": grid,
        "center_row": center_row,
        "center_col": center_col,
        "lat_min": lat_min,
        "lon_min": lon_min,
        "cell_size_deg": cell_size_deg_lat,  # approximate (varies in Mercator)
        "center_lat": lat,
        "center_lon": lon,
    }


def _get_elevation_from_ozt2(
    lat: float,
    lon: float,
    ozt2_dir: Path,
    zoom_levels: list[int] | None = None,
) -> float | None:
    """Get elevation from OZT2 tiles (internal).

    Args:
        lat: Latitude
        lon: Longitude
        ozt2_dir: Path to OZT2 tiles directory
        zoom_levels: Zoom levels to try (default: [12, 11, 10, 9, 8, 7])

    Returns:
        Elevation in meters, or None if not found.
    """
    if zoom_levels is None:
        zoom_levels = [12, 11, 10, 9, 8, 7]

    for zoom in zoom_levels:
        x, y = latlon_to_tile(lat, lon, zoom)
        tile_path = ozt2_dir / f"z{zoom}" / str(x) / f"{y}.ozt2"

        if not tile_path.exists():
            continue

        try:
            data = tile_path.read_bytes()
            elevation, _meta = decode_ozt2(data)
            h, w = elevation.shape

            # Bilinear interpolation within tile
            n = 2 ** zoom
            lon_min = x / n * 360.0 - 180.0
            lon_max = (x + 1) / n * 360.0 - 180.0
            lat_max = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / n))))
            lat_min = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * (y + 1) / n))))

            fx = (lon - lon_min) / (lon_max - lon_min) if lon_max != lon_min else 0.5
            fy = (lat_max - lat) / (lat_max - lat_min) if lat_max != lat_min else 0.5

            px = fx * (w - 1)
            py = fy * (h - 1)

            x0 = int(px)
            y0 = int(py)
            x1 = min(x0 + 1, w - 1)
            y1 = min(y0 + 1, h - 1)

            fx_frac = px - x0
            fy_frac = py - y0

            v00 = elevation[y0, x0]
            v10 = elevation[y0, x1]
            v01 = elevation[y1, x0]
            v11 = elevation[y1, x1]

            if v00 == -32768 and v10 == -32768 and v01 == -32768 and v11 == -32768:
                continue

            elev = (
                v00 * (1 - fx_frac) * (1 - fy_frac) +
                v10 * fx_frac * (1 - fy_frac) +
                v01 * (1 - fx_frac) * fy_frac +
                v11 * fx_frac * fy_frac
            )
            return round(float(elev), 1)
        except Exception as err:  # noqa: BLE001
            _logger.debug("ozt2 interpolation failed: %s: %s", type(err).__name__, err)
            continue

    return None


def get_elevation_from_ozt2(
    lat: float,
    lon: float,
    ozt2_dir: str | Path | None = None,
    zoom_levels: list[int] | None = None,
) -> float | None:
    """Get elevation at a lat/lon from OZT2 tiles.

    Args:
        lat: Latitude (-90 to 90)
        lon: Longitude (-180 to 180)
        ozt2_dir: Path to OZT2 tiles directory
        zoom_levels: Zoom levels to try (default: [12, 11, 10, 9, 8, 7])

    Returns:
        Elevation in meters, or None if no data found.
    """
    _ozt2_dir = ozt2_dir if ozt2_dir is not None else DEFAULT_OZT2_DIR
    if _ozt2_dir is None:
        raise ValueError("No OZT2 directory. Call load_ozt2_tiles() or pass ozt2_dir.")
    return _get_elevation_from_ozt2(lat, lon, cast(Path, _ozt2_dir), zoom_levels)


def load_ozt2_tiles(tile_dir: str | Path) -> Path:
    """Set the default OZT2 tile directory for elevation queries.

    Args:
        tile_dir: Path to OZT2 tiles directory (z{z}/{x}/{y}.ozt2 structure)

    Returns:
        The configured directory path.
    """
    global DEFAULT_OZT2_DIR
    DEFAULT_OZT2_DIR = Path(tile_dir)
    return DEFAULT_OZT2_DIR


def load_ozt2_tiles_from_hf(
    repo_id: str = "aliasfox/srtm30m-ozt2-v2",
    zoom_levels: list[int] | None = None,
    cache_dir: str | Path | None = None,
    bbox: tuple[float, float, float, float] | None = None,
) -> Path:
    """Download OZT2 tiles from HuggingFace dataset to a local cache.

    Args:
        repo_id: HuggingFace dataset repository ID (default: aliasfox/srtm30m-ozt2-v2)
        zoom_levels: Zoom levels to download (default: [7, 8, 9, 10, 11, 12])
        cache_dir: Local cache directory (default: ~/.cache/openzenith-ozt2)
        bbox: Optional bounding box (lat_min, lon_min, lat_max, lon_max) to
              download only tiles within a region

    Returns:
        Path to the downloaded tile directory.

    Example:
        from openzenith import load_ozt2_tiles_from_hf, get_elevation_from_ozt2

        # Download all tiles
        tile_dir = load_ozt2_tiles_from_hf()

        # Download only European region at zoom 10
        tile_dir = load_ozt2_tiles_from_hf(
            zoom_levels=[10],
            bbox=(34, -10, 72, 40),
        )
    """
    try:
        from huggingface_hub import snapshot_download
    except ImportError:
        raise ImportError(
            "huggingface_hub required for downloading OZT2 tiles. "
            "Install with: pip install huggingface_hub"
        )

    if zoom_levels is None:
        zoom_levels = [7, 8, 9, 10, 11, 12]

    if cache_dir is None:
        cache_dir = Path.home() / ".cache" / "openzenith-ozt2"
    else:
        cache_dir = Path(cache_dir)

    # Build allow patterns
    allow_patterns = [f"tiles/z{z}/**/*.ozt2" for z in zoom_levels]

    print(f"Downloading OZT2 tiles from {repo_id} (zoom {min(zoom_levels)}-{max(zoom_levels)})...")
    print(f"Cache directory: {cache_dir}")

    local_dir = snapshot_download(
        repo_id=repo_id,
        repo_type="dataset",
        cache_dir=str(cache_dir),
        allow_patterns=allow_patterns,
    )

    # Set as default for elevation queries
    # snapshot_download returns {cache}/datasets--{repo}/snapshots/{hash}/
    # and tiles are stored at tiles/z{z}/{x}/{y}.ozt2 inside that directory
    global DEFAULT_OZT2_DIR
    DEFAULT_OZT2_DIR = Path(local_dir) / "tiles"
    print(f"OZT2 tiles cached at: {DEFAULT_OZT2_DIR}")
    return DEFAULT_OZT2_DIR


def get_tile_count(tile_dir: str | Path) -> dict[int, int]:
    """Count tiles per zoom level in a tile directory.

    Counts both PNG (Terrarium) and OZT2 tiles.

    Args:
        tile_dir: Path to tile directory

    Returns:
        Dict mapping zoom level to tile count.
    """
    base = Path(tile_dir)
    counts = {}
    for zdir in sorted(base.iterdir()):
        if zdir.is_dir() and zdir.name.startswith("z") and zdir.name[1:].isdigit():
            z = int(zdir.name[1:])
            count = sum(1 for _ in zdir.rglob("*.ozt2")) + sum(1 for _ in zdir.rglob("*.png"))
            counts[z] = count
    return counts


def download_tiles(
    bbox: tuple[float, float, float, float] | None = None,
    region: str | None = None,
    lat: float | None = None,
    lon: float | None = None,
    radius: float = 0.5,
    zoom_levels: list[int] | None = None,
    cache_dir: str | Path | None = None,
) -> dict:
    """Download elevation tiles for a specific region.

    Provides a Python API equivalent to the CLI ``openzenith tiles`` command.
    Downloads Terrarium PNG tiles from HuggingFace for the specified region.

    Args:
        bbox: Bounding box as (lat_min, lon_min, lat_max, lon_max).
        region: Named region (europe, usa, asia, africa, world, etc.).
        lat: Center latitude (use with lon and radius).
        lon: Center longitude (use with lat and radius).
        radius: Radius in degrees around lat/lon center (default: 0.5).
        zoom_levels: Zoom levels to download (default: [0, 1, ..., 8]).
        cache_dir: Local cache directory (default: ~/.cache/openzenith-dem).

    Returns:
        Dict with 'tile_dir', 'total_tiles', 'size_mb', 'zoom_breakdown'.

    Raises:
        ValueError: If no region specified or unknown region name.

    Examples:
        # By named region
        result = download_tiles(region="europe", zoom_levels=[5, 6, 7, 8])

        # By bounding box
        result = download_tiles(
            bbox=(34, -25, 72, 45),
            zoom_levels=[5, 6, 7],
        )

        # By center point + radius
        result = download_tiles(lat=40.7, lon=-74.0, radius=1.0, zoom_levels=[8, 9, 10])

        print(f"Downloaded {result['total_tiles']:,} tiles to {result['tile_dir']}")
    """
    REGION_BBOXES = {
        "world": (-90, -180, 90, 180),
        "europe": (34, -25, 72, 45),
        "usa": (24, -125, 50, -66),
        "conus": (24, -125, 50, -66),
        "asia": (0, 60, 55, 150),
        "africa": (-35, -20, 37, 55),
        "south-america": (-56, -82, 13, -34),
        "australia": (-44, 112, -10, 155),
        "arctic": (60, -180, 90, 180),
        "antarctica": (-90, -180, -60, 180),
    }

    # Resolve bbox
    if bbox is not None:
        lat_min, lon_min, lat_max, lon_max = bbox
    elif region is not None:
        if region.lower() not in REGION_BBOXES:
            raise ValueError(
                f"Unknown region '{region}'. "
                f"Available: {', '.join(sorted(REGION_BBOXES.keys()))}"
            )
        lat_min, lon_min, lat_max, lon_max = REGION_BBOXES[region.lower()]
    elif lat is not None and lon is not None:
        lat_min, lon_min = lat - radius, lon - radius
        lat_max, lon_max = lat + radius, lon + radius
    else:
        raise ValueError("Provide bbox, region, or lat/lon parameters.")

    if zoom_levels is None:
        zoom_levels = list(range(9))

    # Count tiles
    zoom_breakdown = {}
    total_tiles = 0
    for z in zoom_levels:
        x1, y1 = latlon_to_tile(lat_max, lon_min, z)
        x2, y2 = latlon_to_tile(lat_min, lon_max, z)
        count = (x2 - x1 + 1) * (y2 - y1 + 1)
        zoom_breakdown[z] = count
        total_tiles += count

    tile_dir = load_tiles(zoom_levels=zoom_levels, cache_dir=cache_dir)
    size_bytes = sum(p.stat().st_size for p in Path(tile_dir).rglob("*.png"))

    return {
        "tile_dir": str(tile_dir),
        "total_tiles": total_tiles,
        "size_mb": size_bytes / 1e6,
        "zoom_breakdown": zoom_breakdown,
        "bbox": (lat_min, lon_min, lat_max, lon_max),
    }


def get_elevation_along_path(
    points: list[tuple[float, float]],
    zoom_levels: list[int] | None = None,
    cache_dir: str | Path | None = None,
) -> list[dict]:
    """Get elevation profile along a geographic path.

    Queries elevation at multiple points along a path (great-circle or rhumb-line
    interpolation between the provided waypoints). Returns elevation, slope,
    and distance at each point.

    Args:
        points: List of (lat, lon) waypoints defining the path
        zoom_levels: Zoom levels for elevation query (default: [10, 11, 12])
        cache_dir: Optional local tile cache directory

    Returns:
        List of dicts with 'lat', 'lon', 'elevation', 'distance_m', 'slope_deg'
        for each interpolated point along the path.
    """
    if len(points) < 2:
        return []

    if zoom_levels is None:
        zoom_levels = [10, 11, 12]

    # Interpolate points at ~90m intervals (zoom 10 cell size)
    interpolated = []
    for i in range(len(points) - 1):
        lat1, lon1 = points[i]
        lat2, lon2 = points[i + 1]

        # Great-circle distance
        R = 6371000  # Earth radius in meters
        dlat = math.radians(lat2 - lat1)
        dlon = math.radians(lon2 - lon1)
        a = (math.sin(dlat / 2) ** 2 +
             math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) *
             math.sin(dlon / 2) ** 2)
        seg_dist = 2 * R * math.atan2(math.sqrt(a), math.sqrt(1 - a))

        # Number of points to interpolate (every ~90m)
        n_points = max(2, int(seg_dist / 90))

        for j in range(n_points):
            t = j / n_points if n_points > 1 else 1.0
            lat = lat1 + t * (lat2 - lat1)
            lon = lon1 + t * (lon2 - lon1)
            interpolated.append((lat, lon))

    # Always include the last point
    interpolated.append(points[-1])

    # Query elevation for all points
    elevations = get_elevation_batch(interpolated, zoom_levels=zoom_levels, cache_dir=cache_dir)

    # Compute cumulative distance and slope
    result = []
    cumulative_dist = 0.0
    prev_elev = None

    for i, (lat, lon) in enumerate(interpolated):
        elev_data = elevations[i] if i < len(elevations) else {}
        elev = elev_data.get("elevation")

        if i > 0 and elev is not None and prev_elev is not None:
            dlat = lat - interpolated[i - 1][0]
            dlon = lon - interpolated[i - 1][1]
            a = (math.sin(math.radians(dlat) / 2) ** 2 +
                 math.cos(math.radians(interpolated[i - 1][0])) *
                 math.cos(math.radians(lat)) * math.sin(math.radians(dlon) / 2) ** 2)
            seg_dist = 2 * R * math.atan2(math.sqrt(a), math.sqrt(1 - a))
            cumulative_dist += seg_dist

        slope_deg = None
        if prev_elev is not None and elev is not None and cumulative_dist > 0:
            elev_diff = elev - prev_elev
            slope_deg = math.degrees(math.atan2(elev_diff, 90.0))

        result.append({
            "lat": round(lat, 6),
            "lon": round(lon, 6),
            "elevation": elev,
            "distance_m": round(cumulative_dist, 1),
            "slope_deg": round(slope_deg, 2) if slope_deg is not None else None,
        })

        prev_elev = elev

    return result
