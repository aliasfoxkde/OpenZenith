"""OpenZenith Downstream Tracing — follow flow path from any point to ocean.

Traces a path downhill from a starting point following D8 flow directions
until reaching the ocean (elevation <= 0) or a flat area (no downhill neighbor).

For compute-intensive applications, the local SDK is recommended over the web API
to avoid HTTPS chunk download overhead on each tile request.

Usage:
    from openzenith.tracing import trace_downstream

    result = trace_downstream(40.7128, -74.0060)
    # Returns: path coordinates, distances, elevations, total distance
"""

import logging
import math
from typing import Optional

_logger = logging.getLogger(__name__)

# D8 direction encoding: 0=E, 1=SE, 2=S, 3=SW, 4=W, 5=NW, 6=N, 7=NE
D8_DR = [0, 1, 1, 1, 0, -1, -1, -1]
D8_DC = [1, 1, 0, -1, -1, -1, 0, 1]
D8_DIST = [1.0, math.sqrt(2), 1.0, math.sqrt(2), 1.0, math.sqrt(2), 1.0, math.sqrt(2)]


def trace_downstream(
    lat: float,
    lon: float,
    zoom: int = 10,
    max_steps: int = 10000,
    step_size_m: float = 90.0,  # ~3 arcsec at equator for zoom 10
    tile_cache_dir: Optional[str] = None,
) -> Optional[dict]:
    """Trace downstream path from a point to the ocean or flat area.

    Loads elevation tiles on-demand as the path progresses across tile boundaries.

    Args:
        lat: Starting latitude
        lon: Starting longitude
        zoom: Tile zoom level for elevation data
        max_steps: Maximum steps to trace
        step_size_m: Approximate step size in meters
        tile_cache_dir: Local tile cache path (or uses HuggingFace)

    Returns:
        Dict with path, elevations, distances, or None if starting in ocean
    """
    try:
        from openzenith.elevation import get_elevation, load_elevation_grid
    except ImportError:
        print("❌ Tracing requires elevation loading capability")
        return None

    # Check starting point
    start_elev = get_elevation(lat, lon, zoom_levels=[zoom], cache_dir=tile_cache_dir)
    if start_elev is None:
        return None
    if start_elev < -30000:
        return None
    if start_elev <= 0:
        # Already at/below sea level
        return {
            "start": [lat, lon],
            "end": [lat, lon],
            "start_elev": float(start_elev),
            "end_elev": float(start_elev),
            "path": [[lat, lon]],
            "elevations": [float(start_elev)],
            "distances": [0.0],
            "total_distance": 0.0,
            "steps": 0,
        }

    # Load initial grid
    grid_info = _load_grid_at(lat, lon, zoom, tile_cache_dir)
    if grid_info is None:
        return None

    path = [[lat, lon]]
    elevations = [float(start_elev)]
    distances = [0.0]
    total_distance = 0.0

    current_lat = lat
    current_lon = lon
    current_elev = start_elev

    # Step size in degrees (approximate)
    step_deg = step_size_m / 111320.0  # meters per degree at equator

    prev_dirs = []  # Track recent directions to detect loops

    for step in range(max_steps):
        # Load grid if needed
        if grid_info is None:
            grid_info = _load_grid_at(current_lat, current_lon, zoom, tile_cache_dir)
            if grid_info is None:
                break

        dem = grid_info["grid"]
        center_r = grid_info["center_row"]
        center_c = grid_info["center_col"]
        cell_size_deg = grid_info["cell_size_deg"]
        lat_min = grid_info["lat_min"]
        lon_min = grid_info["lon_min"]

        # Check if we need a new grid (center cell too far from grid center)
        dist_to_center = math.sqrt(
            (current_lat - grid_info["center_lat"]) ** 2 + (current_lon - grid_info["center_lon"]) ** 2
        )
        if dist_to_center > cell_size_deg * 20:
            grid_info = _load_grid_at(current_lat, current_lon, zoom, tile_cache_dir)
            if grid_info is None:
                break
            dem = grid_info["grid"]
            center_r = grid_info["center_row"]
            center_c = grid_info["center_col"]
            cell_size_deg = grid_info["cell_size_deg"]
            lat_min = grid_info["lat_min"]
            lon_min = grid_info["lon_min"]

        # Find steepest descent neighbor
        best_drop = 0
        best_dir = -1
        current_elev_val = dem[center_r, center_c]

        if current_elev_val <= -30000:
            break

        for d in range(8):
            nr = center_r + D8_DR[d]
            nc = center_c + D8_DC[d]
            if nr < 0 or nr >= dem.shape[0] or nc < 0 or nc >= dem.shape[1]:
                continue
            neighbor_elev = dem[nr, nc]
            if neighbor_elev <= -30000:
                continue
            drop = current_elev_val - neighbor_elev
            if drop > best_drop:
                best_drop = drop
                best_dir = d

        if best_dir == -1:
            # Pit/flat area — no downhill neighbor
            break

        # Detect loops (cycling between same cells)
        prev_dirs.append(best_dir)
        if len(prev_dirs) > 8:
            prev_dirs.pop(0)
            # Check for oscillation
            if len(prev_dirs) >= 4:
                is_oscillating = True
                for i in range(1, len(prev_dirs)):
                    if prev_dirs[i] != prev_dirs[i - 2 if i >= 2 else i]:
                        is_oscillating = False
                        break
                if is_oscillating:
                    break

        # Move to next cell
        step_lat = step_deg * D8_DR[best_dir] * D8_DIST[best_dir]
        step_lon = step_deg * D8_DC[best_dir] * D8_DIST[best_dir]
        current_lat += step_lat
        current_lon += step_lon

        # Get elevation at new position
        new_elev = get_elevation(current_lat, current_lon, zoom_levels=[zoom], cache_dir=tile_cache_dir)
        if new_elev is None or new_elev < -30000:
            # Reached ocean/nodata
            if new_elev is not None and new_elev <= 0:
                # Reached sea level
                step_dist = _haversine_distance(
                    path[-1][0], path[-1][1], current_lat, current_lon
                )
                total_distance += step_dist
                path.append([current_lat, current_lon])
                elevations.append(float(new_elev))
                distances.append(total_distance)
            break

        step_dist = _haversine_distance(path[-1][0], path[-1][1], current_lat, current_lon)
        total_distance += step_dist

        path.append([current_lat, current_lon])
        elevations.append(float(new_elev))
        distances.append(total_distance)

        # Check if reached ocean (elevation <= 0)
        if new_elev <= 0:
            break

        # Update center position in grid
        new_r = center_r + D8_DR[best_dir]
        new_c = center_c + D8_DC[best_dir]
        if 0 <= new_r < dem.shape[0] and 0 <= new_c < dem.shape[1]:
            grid_info["center_row"] = new_r
            grid_info["center_col"] = new_c

    return {
        "start": [lat, lon],
        "end": [current_lat, current_lon],
        "start_elev": float(start_elev),
        "end_elev": float(elevations[-1]),
        "path": path,
        "elevations": elevations,
        "distances": distances,
        "total_distance": total_distance,
        "steps": len(path) - 1,
    }


def _load_grid_at(
    lat: float, lon: float, zoom: int, cache_dir: Optional[str] = None, radius: int = 100
) -> Optional[dict]:
    """Load elevation grid centered on a point."""
    try:
        from openzenith.elevation import load_elevation_grid
    except ImportError:
        return None

    try:
        result = load_elevation_grid(lat, lon, zoom, radius_cells=radius, cache_dir=cache_dir)
        # Replace NaN with NODATA for hydrology
        import numpy as np
        result["grid"] = np.where(np.isnan(result["grid"]), -32768.0, result["grid"])
        # Snap center to nearest valid cell
        cr, cc = result["center_row"], result["center_col"]
        if result["grid"][cr, cc] <= -30000:
            best_dist = float('inf')
            for r in range(result["grid"].shape[0]):
                for c in range(result["grid"].shape[1]):
                    if result["grid"][r, c] > -30000:
                        d = abs(r - cr) + abs(c - cc)
                        if d < best_dist:
                            best_dist = d
                            result["center_row"], result["center_col"] = r, c
            if best_dist == float('inf'):
                return None
        return result
    except Exception as err:
        _logger.debug("trace_downstream failed (lat=%.4f, lon=%.4f): %s: %s", lat, lon, type(err).__name__, err)
        return None


def _haversine_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Haversine distance between two points in meters."""
    R = 6371000.0  # Earth radius in meters
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (math.sin(dlat / 2) ** 2 +
         math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2) ** 2)
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return R * c
