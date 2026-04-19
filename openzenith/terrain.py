"""OpenZenith Terrain Analysis — slope, aspect, hillshade, viewshed.

Extends the elevation module with common terrain derivatives used in
GIS applications.

Usage:
    from openzenith.terrain import slope, aspect, hillshade

    grid = load_elevation_grid(39.0, -106.0, 10)
    slope_deg = slope(grid, cell_size_deg=grid["cell_size_deg"])
    aspect_deg = aspect(grid, cell_size_deg=grid["cell_size_deg"])
    shade = hillshade(grid, azimuth=315, altitude=45)
"""

import numpy as np
from typing import Optional


def slope(dem: np.ndarray, cell_size_deg: float = 0.001, nodata: float = -32768.0) -> np.ndarray:
    """Compute terrain slope in degrees using Horn's method (3×3 window).

    Uses the four 3×3 neighborhoods for smoother results than simple
    finite differences.

    Args:
        dem: 2D elevation grid (meters)
        cell_size_deg: Cell size in degrees (for distance calc at equator)
        nodata: NODATA value

    Returns:
        2D float32 array of slope in degrees (0-90)
    """
    # Approximate cell size in meters (WGS84 ellipsoid approximation)
    cell_y = cell_size_deg * 111320.0  # meters per degree latitude
    cell_x = cell_size_deg * 111320.0 * np.cos(np.radians(np.nanmean(
        dem[dem > nodata]) if np.any(dem > nodata) else 0.0))  # meters per degree longitude

    # Pad with NODATA for edge handling
    padded = np.pad(dem, 1, mode="constant", constant_values=nodata)
    rows, cols = dem.shape
    result = np.full_like(dem, np.nan, dtype=np.float32)

    # Horn's method: weighted average of 4 3×3 neighborhoods
    for r in range(rows):
        for c in range(cols):
            # 3×3 window from padded array
            a = padded[r:r + 3, c:c + 3].astype(np.float64)
            if np.any(a <= nodata):
                continue

            # x-direction (EW) slope
            dz_dx = ((a[2, 0] + 2 * a[2, 1] + a[2, 2]) -
                     (a[0, 0] + 2 * a[0, 1] + a[0, 2])) / (8 * cell_x)
            # y-direction (NS) slope
            dz_dy = ((a[0, 2] + 2 * a[1, 2] + a[2, 2]) -
                     (a[0, 0] + 2 * a[1, 0] + a[2, 0])) / (8 * cell_y)

            result[r, c] = np.degrees(np.arctan(np.sqrt(dz_dx ** 2 + dz_dy ** 2)))

    return result


def slope_fast(dem: np.ndarray, cell_size_deg: float = 0.001, nodata: float = -32768.0) -> np.ndarray:
    """Fast vectorized slope computation using simple finite differences.

    Less smooth than slope() (no Horn weighting) but ~100x faster for large grids.

    Args:
        dem: 2D elevation grid (meters)
        cell_size_deg: Cell size in degrees
        nodata: NODATA value

    Returns:
        2D float32 array of slope in degrees
    """
    cell_y = cell_size_deg * 111320.0
    cell_x = cell_size_deg * 111320.0 * np.cos(np.radians(
        np.nanmean(dem[dem > nodata]) if np.any(dem > nodata) else 0.0))

    valid = dem > nodata
    padded = np.pad(dem.astype(np.float64), 1, mode="edge")

    dz_dx = (padded[1:-1, 2:] - padded[1:-1, :-2]) / (2 * cell_x)
    dz_dy = (padded[2:, 1:-1] - padded[:-2, 1:-1]) / (2 * cell_y)

    result = np.degrees(np.arctan(np.sqrt(dz_dx ** 2 + dz_dy ** 2)))
    result[~valid] = np.nan

    return result.astype(np.float32)


def aspect(dem: np.ndarray, cell_size_deg: float = 0.001, nodata: float = -32768.0) -> np.ndarray:
    """Compute terrain aspect (compass direction of steepest descent) in degrees.

    Returns 0-360 where 0=N, 90=E, 180=S, 270=W.
    Flat areas return -1 (or NaN).

    Args:
        dem: 2D elevation grid (meters)
        cell_size_deg: Cell size in degrees
        nodata: NODATA value

    Returns:
        2D float32 array of aspect in degrees
    """
    cell_y = cell_size_deg * 111320.0
    cell_x = cell_size_deg * 111320.0 * np.cos(np.radians(
        np.nanmean(dem[dem > nodata]) if np.any(dem > nodata) else 0.0))

    valid = dem > nodata
    padded = np.pad(dem.astype(np.float64), 1, mode="edge")

    dz_dx = (padded[1:-1, 2:] - padded[1:-1, :-2]) / (2 * cell_x)
    dz_dy = (padded[2:, 1:-1] - padded[:-2, 1:-1]) / (2 * cell_y)

    # Grid y-axis is flipped (row 0 = north, positive = south)
    # Negate dz_dy so atan2 treats north as positive y
    # atan2(-dz_dy, dz_dx) gives ascent direction in standard math coords
    # Convert to compass: (90 - math_deg) % 360
    # Then add 180° for downhill (aspect = direction slope faces)
    aspect_rad = np.arctan2(-dz_dy, dz_dx)
    aspect_deg = (90 - np.degrees(aspect_rad) + 180) % 360

    # Flat areas: set to NaN
    flat = (np.abs(dz_dx) < 1e-10) & (np.abs(dz_dy) < 1e-10)
    aspect_deg[flat | ~valid] = np.nan

    return aspect_deg.astype(np.float32)


def hillshade(
    dem: np.ndarray,
    azimuth: float = 315.0,
    altitude: float = 45.0,
    cell_size_deg: float = 0.001,
    nodata: float = -32768.0,
    z_factor: float = 1.0,
) -> np.ndarray:
    """Compute analytical hillshade.

    Simulates illumination from a light source at given azimuth and altitude.
    Returns values 0-255 for use as grayscale imagery.

    Args:
        dem: 2D elevation grid (meters)
        azimuth: Light direction in degrees (0=N, 90=E, 180=S, 270=W)
        altitude: Light elevation above horizon in degrees (0-90)
        cell_size_deg: Cell size in degrees
        nodata: NODATA value
        z_factor: Vertical exaggeration factor

    Returns:
        2D uint8 array (0-255)
    """
    az_rad = np.radians(azimuth)
    alt_rad = np.radians(altitude)

    sl = slope_fast(dem, cell_size_deg, nodata)
    asp = aspect(dem, cell_size_deg, nodata)

    # Replace NaN with 0 for computation
    sl = np.nan_to_num(sl, nan=0.0)
    asp = np.nan_to_num(asp, nan=0.0)

    sl_rad = np.radians(sl)
    asp_rad = np.radians(asp)

    # Hillshade formula
    shade = (
        np.cos(alt_rad) * np.cos(sl_rad) +
        np.sin(alt_rad) * np.sin(sl_rad) * np.cos(az_rad - asp_rad)
    )
    shade = np.clip(shade * z_factor, 0, 1)

    # Mark NODATA areas as 0
    shade[dem <= nodata] = 0

    return (shade * 255).astype(np.uint8)


def viewshed(
    dem: np.ndarray,
    observer_row: int,
    observer_col: int,
    observer_height: float = 1.75,
    cell_size_deg: float = 0.001,
    nodata: float = -32768.0,
    max_distance_cells: Optional[int] = None,
) -> np.ndarray:
    """Compute viewshed — which cells are visible from the observer point.

    Uses the Bresenham line-of-sight algorithm with terrain interpolation.

    Args:
        dem: 2D elevation grid (meters)
        observer_row: Row index of observer
        observer_col: Column index of observer
        observer_height: Height of observer above ground (meters)
        cell_size_deg: Cell size in degrees
        nodata: NODATA value
        max_distance_cells: Maximum line-of-sight distance in cells (None=full grid)

    Returns:
        2D bool array (True = visible from observer)
    """
    rows, cols = dem.shape
    visible = np.zeros((rows, cols), dtype=bool)
    visible[observer_row, observer_col] = True

    # Observer's absolute elevation
    if dem[observer_row, observer_col] <= nodata:
        return visible
    observer_elev = dem[observer_row, observer_col] + observer_height

    # Cell size in meters
    cell_m = cell_size_deg * 111320.0

    if max_distance_cells is None:
        max_distance_cells = max(rows, cols)

    # Check line of sight to each cell
    for r in range(rows):
        for c in range(cols):
            if r == observer_row and c == observer_col:
                continue
            if dem[r, c] <= nodata:
                continue

            # Distance in cells
            dr = r - observer_row
            dc = c - observer_col
            dist_cells = np.sqrt(dr * dr + dc * dc)

            if dist_cells > max_distance_cells:
                continue

            # Check line of sight along the ray from observer to target
            n_steps = max(int(dist_cells * 2), 2)
            max_slope = -np.inf  # Maximum slope along the ray (observer to target)

            for i in range(1, n_steps + 1):
                # Interpolate position along ray
                t = i / n_steps
                ir = observer_row + dr * t
                ic = observer_col + dc * t

                # Bilinear interpolation of elevation
                r0, c0 = int(np.floor(ir)), int(np.floor(ic))
                r1, c1 = min(r0 + 1, rows - 1), min(c0 + 1, cols - 1)
                r0, c0 = max(r0, 0), max(c0, 0)
                fr, fc = ir - r0, ic - c0

                e00 = dem[r0, c0] if dem[r0, c0] > nodata else dem[observer_row, observer_col]
                e01 = dem[r0, c1] if dem[r0, c1] > nodata else e00
                e10 = dem[r1, c0] if dem[r1, c0] > nodata else e00
                e11 = dem[r1, c1] if dem[r1, c1] > nodata else e00
                elev = e00 * (1 - fr) * (1 - fc) + e01 * (1 - fr) * fc + e10 * fr * (1 - fc) + e11 * fr * fc

                # Slope from observer to this point
                horiz_dist = t * dist_cells * cell_m
                if horiz_dist < 1e-6:
                    continue
                slope_to_point = (elev - observer_elev) / horiz_dist

                if slope_to_point > max_slope:
                    max_slope = slope_to_point

            # Target is visible if its slope is >= maximum slope along the ray
            target_dist = dist_cells * cell_m
            target_slope = (dem[r, c] - observer_elev) / target_dist
            visible[r, c] = target_slope >= max_slope - 1e-10

    return visible


def profile(dem: np.ndarray, points: list[tuple[int, int]], cell_size_deg: float = 0.001) -> list[dict]:
    """Extract elevation profile along a line of cells.

    Args:
        dem: 2D elevation grid (meters)
        points: List of (row, col) pairs defining the profile path
        cell_size_deg: Cell size in degrees

    Returns:
        List of dicts with 'distance_m', 'elevation', 'row', 'col'
    """
    if len(points) < 2:
        return []

    cell_m = cell_size_deg * 111320.0
    result = [{"distance_m": 0.0, "elevation": float(dem[points[0]]), "row": points[0][0], "col": points[0][1]}]

    total_dist = 0.0
    for i in range(1, len(points)):
        r0, c0 = points[i - 1]
        r1, c1 = points[i]
        seg_dist = np.sqrt(((r1 - r0) * cell_m) ** 2 + ((c1 - c0) * cell_m) ** 2)
        total_dist += seg_dist
        result.append({
            "distance_m": round(total_dist, 1),
            "elevation": float(dem[r1, c1]),
            "row": r1,
            "col": c1,
        })

    return result
