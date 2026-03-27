"""High-level elevation query API for OpenZenith.

Query elevation at any lat/lon using Terrarium PNG tiles from the
HuggingFace dataset (aliasfox/openzenith-dem) or a local tile directory.

Usage:
    from openzenith import get_elevation, load_tiles

    # Download tiles from HuggingFace (optional, for local use)
    tiles = load_tiles(zoom_levels=[0, 1, 2, 3, 4, 5, 6, 7, 8])

    # Query single point
    elev = get_elevation(40.7128, -74.0060)
    print(f"NYC elevation: {elev:.1f}m")

    # Batch query
    elevations = get_elevation_batch([
        (40.7128, -74.0060),   # New York
        (35.6762, 139.6503),   # Tokyo
        (-33.8688, 151.2093),  # Sydney
    ])
"""

import math
import os
from pathlib import Path

import numpy as np

from .terrarium import decode_tile

# Default HuggingFace dataset
HF_REPO = "aliasfox/openzenith-dem"
DEFAULT_TILE_DIR = None  # Set via load_tiles()


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
) -> float | None:
    """Get elevation at a lat/lon by querying Terrarium PNG tiles.

    Tries each zoom level from highest to lowest resolution.
    Uses bilinear interpolation for sub-pixel accuracy.

    Args:
        lat: Latitude (-90 to 90)
        lon: Longitude (-180 to 180)
        tile_dir: Path to tile directory (default: loaded tiles dir)
        zoom_levels: Zoom levels to try (default: [8, 7, 6, 5])

    Returns:
        Elevation in meters, or None if no data found.
    """
    if zoom_levels is None:
        zoom_levels = [8, 7, 6, 5]

    base = Path(tile_dir) if tile_dir else Path(DEFAULT_TILE_DIR)
    if base is None:
        raise ValueError("No tile directory. Call load_tiles() or pass tile_dir.")

    for zoom in zoom_levels:
        x, y = latlon_to_tile(lat, lon, zoom)
        tile_path = base / str(zoom) / str(x) / f"{y}.png"

        if not tile_path.exists():
            continue

        try:
            with open(tile_path, "rb") as f:
                png_bytes = f.read()
            elev = _interpolate_from_tile(png_bytes, lat, lon, zoom, x, y)
            if elev is not None and not math.isnan(elev):
                return elev
        except Exception:
            continue

    return None


def get_elevation_batch(
    points: list[tuple[float, float]],
    tile_dir: str | Path | None = None,
    zoom_levels: list[int] | None = None,
) -> list[float | None]:
    """Get elevation for multiple lat/lon points.

    Args:
        points: List of (lat, lon) tuples
        tile_dir: Path to tile directory
        zoom_levels: Zoom levels to try

    Returns:
        List of elevation values (None if no data).
    """
    return [get_elevation(lat, lon, tile_dir, zoom_levels) for lat, lon in points]


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
    patterns = [f"tiles/{z}/*" for z in zoom_levels]
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


def get_tile_count(tile_dir: str | Path) -> dict[int, int]:
    """Count tiles per zoom level in a tile directory.

    Args:
        tile_dir: Path to tile directory

    Returns:
        Dict mapping zoom level to tile count.
    """
    base = Path(tile_dir)
    counts = {}
    for zdir in sorted(base.iterdir()):
        if zdir.is_dir() and zdir.name.isdigit():
            count = sum(1 for _ in zdir.rglob("*.png"))
            counts[int(zdir.name)] = count
    return counts
