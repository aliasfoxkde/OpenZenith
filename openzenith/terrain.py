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
    finite differences. Fully vectorized — no Python loops.

    Args:
        dem: 2D elevation grid (meters)
        cell_size_deg: Cell size in degrees (for distance calc at equator)
        nodata: NODATA value

    Returns:
        2D float32 array of slope in degrees (0-90)
    """
    # Approximate cell size in meters (WGS84 ellipsoid approximation)
    valid_mask = dem > nodata
    cell_y = cell_size_deg * 111320.0  # meters per degree latitude
    cell_x = cell_size_deg * 111320.0 * np.cos(np.radians(
        np.nanmean(dem[valid_mask]) if np.any(valid_mask) else 0.0))

    # Pad with NODATA for edge handling
    padded = np.pad(dem.astype(np.float64), 1, mode="constant", constant_values=nodata)

    # Extract all 9 cells of the 3×3 window simultaneously
    # Layout:  a b c
    #         d e f
    #         g h i
    a = padded[:-2, :-2]
    b = padded[:-2, 1:-1]
    c = padded[:-2, 2:]
    d = padded[1:-1, :-2]
    # e = padded[1:-1, 1:-1]  # center — not needed for Horn's method
    f = padded[1:-1, 2:]
    g = padded[2:, :-2]
    h = padded[2:, 1:-1]
    i = padded[2:, 2:]

    # Cells with any NODATA neighbor → NaN output
    nodata_mask = (a <= nodata) | (b <= nodata) | (c <= nodata) | \
                  (d <= nodata) | (f <= nodata) | \
                  (g <= nodata) | (h <= nodata) | (i <= nodata)

    # Horn's method: weighted average of 4 3×3 neighborhoods
    # x-direction (EW): (c + 2f + i) - (a + 2d + g) / 8*cell_x
    # y-direction (NS): (a + 2b + c) - (g + 2h + i) / 8*cell_y
    dz_dx = ((c + 2 * f + i) - (a + 2 * d + g)) / (8 * cell_x)
    dz_dy = ((a + 2 * b + c) - (g + 2 * h + i)) / (8 * cell_y)

    result = np.degrees(np.arctan(np.sqrt(dz_dx ** 2 + dz_dy ** 2)))
    result[nodata_mask | ~valid_mask] = np.nan

    return result.astype(np.float32)


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

    Uses vectorized Bresenham line-of-sight with terrain interpolation.
    Optionally accelerated with Numba JIT (falls back to NumPy).

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
    # Try Numba-accelerated version first
    try:
        return _viewshed_numba(
            dem, observer_row, observer_col, observer_height,
            cell_size_deg, nodata, max_distance_cells
        )
    except ImportError:
        pass

    # Vectorized NumPy fallback
    return _viewshed_numpy(
        dem, observer_row, observer_col, observer_height,
        cell_size_deg, nodata, max_distance_cells
    )


def _viewshed_numpy(
    dem: np.ndarray,
    observer_row: int,
    observer_col: int,
    observer_height: float,
    cell_size_deg: float,
    nodata: float,
    max_distance_cells: Optional[int],
) -> np.ndarray:
    """Viewshed using angular ray casting with vectorized sampling.

    Casts rays in angular sectors from the observer. Each ray is sampled
    at fixed intervals, and the max slope along the ray determines
    visibility. Cells between rays are interpolated.

    This is much faster than per-cell iteration because the number of
    rays is O(max_distance) rather than O(rows*cols).
    """
    rows, cols = dem.shape
    visible = np.zeros((rows, cols), dtype=bool)
    visible[observer_row, observer_col] = True

    if dem[observer_row, observer_col] <= nodata:
        return visible

    observer_elev = float(dem[observer_row, observer_col]) + observer_height
    cell_m = cell_size_deg * 111320.0

    if max_distance_cells is None:
        max_distance_cells = max(rows, cols)

    # Cast rays at angular intervals (360 rays = 1 per degree)
    n_angles = 720
    angles = np.linspace(0, 2 * np.pi, n_angles, endpoint=False)
    cos_a = np.cos(angles)
    sin_a = np.sin(angles)

    # Sample each ray at fixed cell-distance intervals
    max_r = min(max_distance_cells, max(rows, cols))
    n_samples = max_r * 2  # 2 samples per cell
    t_values = np.arange(1, n_samples + 1) / 2.0  # distance in cells

    # Precompute ray endpoints for all angles
    ray_dr = (t_values[np.newaxis, :] * sin_a[:, np.newaxis])  # (n_angles, n_samples)
    ray_dc = (t_values[np.newaxis, :] * cos_a[:, np.newaxis])

    # Absolute positions
    ray_r = observer_row + ray_dr
    ray_c = observer_col + ray_dc

    # Mask out-of-bounds samples
    oob = (ray_r < 0) | (ray_r >= rows - 1) | (ray_c < 0) | (ray_c >= cols - 1)
    ray_r = np.clip(ray_r, 0, rows - 2).astype(int)
    ray_c = np.clip(ray_c, 0, cols - 2).astype(int)

    # Bilinear interpolation (vectorized across all rays and samples)
    r0 = ray_r
    c0 = ray_c
    fr = (observer_row + ray_dr) - r0
    fc = (observer_col + ray_dc) - c0
    fr = np.clip(fr, 0, 1)
    fc = np.clip(fc, 0, 1)

    obs_e = dem[observer_row, observer_col]
    e00 = np.where(dem[r0, c0] > nodata, dem[r0, c0], obs_e)
    e01 = np.where(dem[r0, c0 + 1] > nodata, dem[r0, c0 + 1], e00)
    e10 = np.where(dem[r0 + 1, c0] > nodata, dem[r0 + 1, c0], e00)
    e11 = np.where(dem[r0 + 1, c0 + 1] > nodata, dem[r0 + 1, c0 + 1], e00)
    elev = e00 * (1 - fr) * (1 - fc) + e01 * (1 - fr) * fc + e10 * fr * (1 - fc) + e11 * fr * fc

    # Distance in meters for each sample
    horiz_dist = np.maximum(t_values[np.newaxis, :] * cell_m, 1e-6)

    # Slope from observer to each sample
    slope_map = (elev - observer_elev) / horiz_dist
    slope_map[oob] = -np.inf

    # Cumulative max slope along each ray
    max_slope_map = np.maximum.accumulate(slope_map, axis=1)

    # Now determine visibility for each cell by finding the nearest ray
    # For each cell, check if its slope >= max slope of the nearest ray at that distance
    rr, cc = np.mgrid[0:rows, 0:cols]
    cell_dr = rr - observer_row
    cell_dc = cc - observer_col
    cell_dist = np.sqrt(cell_dr ** 2 + cell_dc ** 2)

    valid = (cell_dist > 0) & (cell_dist <= max_distance_cells) & (dem > nodata)

    # For valid cells, compute angle and check visibility
    valid_rs = rr[valid]
    valid_cs = cc[valid]
    valid_dr = cell_dr[valid].astype(np.float64)
    valid_dc = cell_dc[valid].astype(np.float64)
    valid_dist = cell_dist[valid]

    if len(valid_rs) == 0:
        return visible

    # Angle from observer to each cell
    cell_angles = np.arctan2(valid_dr, valid_dc) % (2 * np.pi)

    # Find nearest ray index for each cell
    ray_idx = ((cell_angles / (2 * np.pi) * n_angles)).astype(int) % n_angles

    # Find sample index for each cell's distance
    sample_idx = np.clip((valid_dist * 2).astype(int) - 1, 0, n_samples - 1)

    # Get max slope at each cell's position along its nearest ray
    cell_max_slope = max_slope_map[ray_idx, sample_idx]

    # Compute cell's own slope
    cell_horiz = np.maximum(valid_dist * cell_m, 1e-6)
    cell_slope = (dem[valid_rs, valid_cs] - observer_elev) / cell_horiz

    # Visible if cell slope >= max slope along ray
    vis_mask = cell_slope >= cell_max_slope - 1e-10
    visible[valid_rs[vis_mask], valid_cs[vis_mask]] = True

    return visible


def _viewshed_numba(
    dem: np.ndarray,
    observer_row: int,
    observer_col: int,
    observer_height: float,
    cell_size_deg: float,
    nodata: float,
    max_distance_cells: Optional[int],
) -> np.ndarray:
    """Numba JIT-accelerated viewshed.

    Falls back to _viewshed_numpy if Numba is not installed.
    First call incurs ~1s compilation overhead.
    """
    try:
        from numba import jit, prange
    except ImportError:
        raise ImportError("numba")

    @jit(nopython=True, parallel=True)
    def _viewshed_core(
        dem: np.ndarray,
        obs_r: int, obs_c: int,
        obs_elev: float,
        cell_m: float,
        nodata_val: float,
        max_dist: int,
    ) -> np.ndarray:
        rows, cols = dem.shape
        visible = np.zeros((rows, cols), dtype=np.bool_)
        visible[obs_r, obs_c] = True

        for r in prange(rows):
            for c in range(cols):
                if r == obs_r and c == obs_c:
                    continue
                if dem[r, c] <= nodata_val:
                    continue

                dr = r - obs_r
                dc = c - obs_c
                dist = (dr * dr + dc * dc) ** 0.5
                if dist > max_dist:
                    continue

                n_steps = max(int(dist * 2), 2)
                max_slope = -1e30

                for i in range(1, n_steps + 1):
                    t = i / n_steps
                    ir = obs_r + dr * t
                    ic = obs_c + dc * t

                    r0 = int(ir)
                    c0 = int(ic)
                    r1 = min(r0 + 1, rows - 1)
                    c1 = min(c0 + 1, cols - 1)
                    if r0 < 0: r0 = 0
                    if c0 < 0: c0 = 0
                    fr = ir - r0
                    fc = ic - c0

                    e00 = dem[r0, c0] if dem[r0, c0] > nodata_val else dem[obs_r, obs_c]
                    e01 = dem[r0, c1] if dem[r0, c1] > nodata_val else e00
                    e10 = dem[r1, c0] if dem[r1, c0] > nodata_val else e00
                    e11 = dem[r1, c1] if dem[r1, c1] > nodata_val else e00
                    elev = e00 * (1 - fr) * (1 - fc) + e01 * (1 - fr) * fc + e10 * fr * (1 - fc) + e11 * fr * fc

                    h_dist = t * dist * cell_m
                    if h_dist < 1e-6:
                        continue
                    s = (elev - obs_elev) / h_dist
                    if s > max_slope:
                        max_slope = s

                t_dist = dist * cell_m
                t_slope = (dem[r, c] - obs_elev) / t_dist
                if t_slope >= max_slope - 1e-10:
                    visible[r, c] = True

        return visible

    if max_distance_cells is None:
        max_distance_cells = max(dem.shape)

    if dem[observer_row, observer_col] <= nodata:
        return np.zeros(dem.shape, dtype=bool)

    obs_elev = float(dem[observer_row, observer_col]) + observer_height
    cell_m = cell_size_deg * 111320.0

    return _viewshed_core(dem, observer_row, observer_col, obs_elev, cell_m, nodata, max_distance_cells)


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


def tpi(dem: np.ndarray, cell_size_deg: float = 0.001, nodata: float = -32768.0) -> np.ndarray:
    """Topographic Position Index (TPI).

    Measures the difference between a cell's elevation and the mean elevation
    of its surrounding cells. Positive values indicate ridges/peaks, negative
    values indicate valleys/depressions, near-zero values indicate flat areas
    or mid-slopes.

    Args:
        dem: 2D elevation grid
        cell_size_deg: Cell size in degrees (unused, kept for API consistency)
        nodata: NODATA value

    Returns:
        2D float32 array of TPI values
    """
    rows, cols = dem.shape
    padded = np.pad(dem, 1, mode='constant', constant_values=np.nan)

    # Vectorized: stack all 8 neighbors into (8, rows, cols) in one shot
    # Row-major iteration over (-1,0,1) x (-1,0,1), skipping (0,0)
    patches = np.stack([
        padded[0:rows, 0:cols],   # NW
        padded[0:rows, 1:cols+1],  # N
        padded[0:rows, 2:cols+2],  # NE
        padded[1:rows+1, 0:cols],  # W
        padded[1:rows+1, 2:cols+2], # E
        padded[2:rows+2, 0:cols],  # SW
        padded[2:rows+2, 1:cols+1], # S
        padded[2:rows+2, 2:cols+2], # SE
    ], axis=0)
    neighbor_mean = np.mean(patches, axis=0)
    result = dem.astype(np.float64) - neighbor_mean

    valid = padded[1:-1, 1:-1] != nodata
    result[~valid] = np.nan

    return result.astype(np.float32)


def roughness(dem: np.ndarray, cell_size_deg: float = 0.001, nodata: float = -32768.0) -> np.ndarray:
    """Terrain Roughness Index.

    The difference between the maximum and minimum elevation value in a
    3×3 cell neighborhood. Higher values indicate rougher terrain.

    Args:
        dem: 2D elevation grid
        cell_size_deg: Cell size in degrees
        nodata: NODATA value

    Returns:
        2D float32 array of roughness values
    """
    rows, cols = dem.shape
    padded = np.pad(dem, 1, mode='constant', constant_values=nodata)

    # Stack all 9 cells of the 3×3 window into (9, rows, cols) — center included
    patches = np.stack([
        padded[0:rows, 0:cols],    # NW
        padded[0:rows, 1:cols+1],  # N
        padded[0:rows, 2:cols+2],  # NE
        padded[1:rows+1, 0:cols],  # W
        padded[1:rows+1, 1:cols+1], # center
        padded[1:rows+1, 2:cols+2], # E
        padded[2:rows+2, 0:cols],  # SW
        padded[2:rows+2, 1:cols+1], # S
        padded[2:rows+2, 2:cols+2], # SE
    ], axis=0)
    result = np.max(patches, axis=0) - np.min(patches, axis=0)

    valid = padded[1:-1, 1:-1] != nodata
    result[~valid] = np.nan

    return result.astype(np.float32)


def curvature(dem: np.ndarray, cell_size_deg: float = 0.001, nodata: float = -32768.0) -> np.ndarray:
    """Mean curvature (average of second derivatives).

    Positive values indicate convex surfaces (accelerating flow),
    negative values indicate concave surfaces (decelerating flow).
    Uses central differences for the second derivative.

    Args:
        dem: 2D elevation grid
        cell_size_deg: Cell size in degrees
        nodata: NODATA value

    Returns:
        2D float32 array of curvature values (1/m)
    """
    rows, cols = dem.shape
    cell_m = cell_size_deg * 111320.0
    padded = np.pad(dem, 1, mode='constant', constant_values=np.nan)

    z = padded[1:-1, 1:-1].astype(np.float64)
    d2z_dx2 = (padded[1:-1, 2:] - 2 * z + padded[1:-1, :-2]) / (cell_m ** 2)
    d2z_dy2 = (padded[2:, 1:-1] - 2 * z + padded[:-2, 1:-1]) / (cell_m ** 2)

    result = (d2z_dx2 + d2z_dy2) / 2.0

    valid = padded[1:-1, 1:-1] != nodata
    result[~valid] = np.nan

    return result.astype(np.float32)


def profile_curvature(dem: np.ndarray, cell_size_deg: float = 0.001, nodata: float = -32768.0) -> np.ndarray:
    """Profile curvature (curvature along slope direction).

    Positive = concave (decelerating flow, deposition zones)
    Negative = convex (accelerating flow, erosion zones)
    Zero = planar.

    Uses the second derivative in the direction of maximum slope.

    Args:
        dem: 2D elevation grid
        cell_size_deg: Cell size in degrees
        nodata: NODATA value

    Returns:
        2D float32 array of profile curvature values (1/m)
    """
    cell_m = cell_size_deg * 111320.0
    padded = np.pad(dem.astype(np.float64), 1, mode='constant', constant_values=np.nan)
    z = padded[1:-1, 1:-1]

    # First derivatives (Horn's 3x3 weighted)
    dz_dx = (padded[2:, 2:] + 2*padded[1:-1, 2:] + padded[:-2, 2:]
           - padded[2:, :-2] - 2*padded[1:-1, :-2] - padded[:-2, :-2]) / (8 * cell_m)
    dz_dy = (padded[:-2, 2:] + 2*padded[:-2, 1:-1] + padded[:-2, :-2]
           - padded[2:, 2:] - 2*padded[2:, 1:-1] - padded[2:, :-2]) / (8 * cell_m)

    # Second derivatives
    d2z_dx2 = (padded[1:-1, 2:] - 2*z + padded[1:-1, :-2]) / (cell_m**2)
    d2z_dy2 = (padded[2:, 1:-1] - 2*z + padded[:-2, 1:-1]) / (cell_m**2)
    d2z_dxdy = (padded[2:, 2:] - padded[2:, :-2] - padded[:-2, 2:] + padded[:-2, :-2]) / (4 * cell_m**2)

    p = dz_dx**2 + dz_dy**2
    p = np.where(p < 1e-10, 1e-10, p)  # avoid division by zero
    q = p + 1.0

    result = -(d2z_dx2 * dz_dx**2 + 2 * d2z_dxdy * dz_dx * dz_dy + d2z_dy2 * dz_dy**2) / (p * np.sqrt(q))
    valid = padded[1:-1, 1:-1] != nodata
    result[~valid] = np.nan
    return result.astype(np.float32)


def planform_curvature(dem: np.ndarray, cell_size_deg: float = 0.001, nodata: float = -32768.0) -> np.ndarray:
    """Planform curvature (curvature perpendicular to slope direction).

    Positive = convex across slope (converging flow, ridges)
    Negative = concave across slope (diverging flow, valleys)
    Zero = planar.

    Args:
        dem: 2D elevation grid
        cell_size_deg: Cell size in degrees
        nodata: NODATA value

    Returns:
        2D float32 array of planform curvature values (1/m)
    """
    cell_m = cell_size_deg * 111320.0
    padded = np.pad(dem.astype(np.float64), 1, mode='constant', constant_values=np.nan)
    z = padded[1:-1, 1:-1]

    dz_dx = (padded[2:, 2:] + 2*padded[1:-1, 2:] + padded[:-2, 2:]
           - padded[2:, :-2] - 2*padded[1:-1, :-2] - padded[:-2, :-2]) / (8 * cell_m)
    dz_dy = (padded[:-2, 2:] + 2*padded[:-2, 1:-1] + padded[:-2, :-2]
           - padded[2:, 2:] - 2*padded[2:, 1:-1] - padded[2:, :-2]) / (8 * cell_m)

    d2z_dx2 = (padded[1:-1, 2:] - 2*z + padded[1:-1, :-2]) / (cell_m**2)
    d2z_dy2 = (padded[2:, 1:-1] - 2*z + padded[:-2, 1:-1]) / (cell_m**2)
    d2z_dxdy = (padded[2:, 2:] - padded[2:, :-2] - padded[:-2, 2:] + padded[:-2, :-2]) / (4 * cell_m**2)

    p = dz_dx**2 + dz_dy**2
    p = np.where(p < 1e-10, 1e-10, p)
    q = p + 1.0

    result = (d2z_dx2 * dz_dy**2 - 2 * d2z_dxdy * dz_dx * dz_dy + d2z_dy2 * dz_dx**2) / (p * np.sqrt(q))
    valid = padded[1:-1, 1:-1] != nodata
    result[~valid] = np.nan
    return result.astype(np.float32)


def drainage_density(flow_accum: np.ndarray, cell_size_deg: float = 0.001, nodata: float = -32768.0) -> np.ndarray:
    """Drainage density from flow accumulation grid.

    Total stream length per unit area. Higher values indicate more
    dissected terrain with more channels.

    Args:
        flow_accum: 2D flow accumulation grid (from flow_accumulation())
        cell_size_deg: Cell size in degrees
        nodata: NODATA value

    Returns:
        2D float32 array of drainage density (km/km²)
    """
    cell_km = cell_size_deg * 111.32
    cell_area_km2 = cell_km ** 2
    threshold = np.sqrt(flow_accum.size)
    streams = (flow_accum >= threshold).astype(np.float64)
    streams[flow_accum <= 0] = 0
    streams[np.isnan(flow_accum)] = 0
    # Smooth with 11x11 uniform filter (numpy-only, shape-preserving)
    kernel_size = 11
    pad = kernel_size // 2
    padded = np.pad(streams, pad, mode='reflect')
    # Integral image approach
    cumsum = np.cumsum(np.cumsum(padded, axis=0), axis=1)
    cumsum = np.pad(cumsum, ((1, 0), (1, 0)), mode='constant')  # prepend zeros
    smoothed = (cumsum[kernel_size:, kernel_size:] - cumsum[:-kernel_size, kernel_size:]
               - cumsum[kernel_size:, :-kernel_size] + cumsum[:-kernel_size, :-kernel_size]) / (kernel_size ** 2)
    # Trim padding to match input shape
    result = smoothed[:flow_accum.shape[0], :flow_accum.shape[1]] / cell_area_km2
    return np.maximum(result, 0).astype(np.float32)


def tri(dem: np.ndarray, cell_size_deg: float = 0.001, nodata: float = -32768.0) -> np.ndarray:
    """Terrain Ruggedness Index (TRI).

    The mean absolute elevation difference between a cell and its 8 neighbors.
    Higher values indicate more rugged terrain.

    Args:
        dem: 2D elevation grid
        cell_size_deg: Cell size in degrees
        nodata: NODATA value

    Returns:
        2D float32 array of TRI values (meters)
    """
    rows, cols = dem.shape
    padded = np.pad(dem, 1, mode='constant', constant_values=np.nan)
    center = padded[1:-1, 1:-1].astype(np.float64)

    # Stack 8 neighbors (skipping center) into (8, rows, cols) — vectorized
    patches = np.stack([
        padded[0:rows, 0:cols],    # NW
        padded[0:rows, 1:cols+1],  # N
        padded[0:rows, 2:cols+2],  # NE
        padded[1:rows+1, 0:cols],  # W
        padded[1:rows+1, 2:cols+2], # E
        padded[2:rows+2, 0:cols],  # SW
        padded[2:rows+2, 1:cols+1], # S
        padded[2:rows+2, 2:cols+2], # SE
    ], axis=0)
    result = np.mean(np.abs(center - patches), axis=0)

    valid = padded[1:-1, 1:-1] != nodata
    result[~valid] = np.nan

    return result.astype(np.float32)


def multi_hillshade(
    dem: np.ndarray,
    cell_size_deg: float = 0.001,
    nodata: float = -32768.0,
    z_factor: float = 3.0,
) -> np.ndarray:
    """Multi-directional hillshade composite.

    Combines hillshades from multiple light directions (NW, N, NE, W, E)
    to reduce directional bias and enhance terrain texture visibility.
    Particularly useful for cartographic hillshade basemaps.

    Returns a uint8 grayscale image with enhanced terrain texture.

    Args:
        dem: 2D elevation grid (meters)
        cell_size_deg: Cell size in degrees
        nodata: NODATA value
        z_factor: Vertical exaggeration (default 3x for visual clarity)

    Returns:
        2D uint8 array (0-255)
    """
    # Standard multi-directional light positions
    lights = [
        (315, 45),  # NW (primary)
        (0, 45),   # N
        (45, 45),   # NE
        (270, 35),  # W
        (90, 35),   # E
    ]

    composite = np.zeros_like(dem, dtype=np.float64)
    count = 0

    for azimuth, altitude in lights:
        hs = hillshade(dem, azimuth, altitude, cell_size_deg, nodata, z_factor)
        composite += hs.astype(np.float64)
        count += 1

    composite /= count

    # Mark NODATA areas
    composite[dem <= nodata] = 0

    return composite.astype(np.uint8)


def color_relief(
    dem: np.ndarray,
    breaks: Optional[list[tuple[float, str]]] = None,
    nodata: float = -32768.0,
) -> np.ndarray:
    """Color relief — classify elevation into colored RGBA bands.

    Maps elevation values to colors using configurable break points.
    Default breaks use a standard hypsometric color scheme.

    Args:
        dem: 2D elevation grid (meters)
        breaks: List of (elevation, hex_color) tuples defining color transitions.
                Elevation must be in ascending order.
                Default: ocean → coastal → lowland → highland → mountain → snow
        nodata: NODATA value

    Returns:
        2D uint8 array of shape (rows, cols, 4) with RGBA values.
    """
    if breaks is None:
        breaks = [
            (-11000, "#08306b"),
            (-5000, "#08519c"),
            (-1000, "#3182bd"),
            (0, "#e0f3f8"),
            (100, "#a1d99b"),
            (300, "#74c476"),
            (800, "#31a354"),
            (1500, "#addd8e"),
            (2500, "#d9f0a3"),
            (3500, "#fee08b"),
            (4500, "#fdae61"),
            (5500, "#f46d43"),
            (7000, "#d73027"),
            (8849, "#ffffff"),
        ]

    # Parse hex colors to RGB
    colors_rgb = []
    for _, hex_color in breaks:
        h = hex_color.lstrip("#")
        colors_rgb.append((int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)))

    elevations = [b[0] for b in breaks]
    rows, cols = dem.shape
    result = np.zeros((rows, cols, 4), dtype=np.uint8)

    # Vectorized elevation classification
    valid = dem != nodata
    vals = dem.astype(np.float64)
    r_ch = np.zeros((rows, cols), dtype=np.float64)
    g_ch = np.zeros((rows, cols), dtype=np.float64)
    b_ch = np.zeros((rows, cols), dtype=np.float64)

    for i in range(len(elevations) - 1):
        lo, hi = float(elevations[i]), float(elevations[i + 1])
        if hi == lo:
            t = np.ones_like(vals)
        else:
            t = np.clip((vals - lo) / (hi - lo), 0.0, 1.0)

        mask = valid & (vals >= lo) & (vals <= hi) if i < len(elevations) - 2 else valid & (vals >= lo)
        c0, c1 = colors_rgb[i], colors_rgb[i + 1]
        r_ch[mask] = c0[0] + (c1[0] - c0[0]) * t[mask]
        g_ch[mask] = c0[1] + (c1[1] - c0[1]) * t[mask]
        b_ch[mask] = c0[2] + (c1[2] - c0[2]) * t[mask]

    result[:, :, 0] = np.clip(r_ch, 0, 255).astype(np.uint8)
    result[:, :, 1] = np.clip(g_ch, 0, 255).astype(np.uint8)
    result[:, :, 2] = np.clip(b_ch, 0, 255).astype(np.uint8)
    result[:, :, 3] = np.where(valid, 255, 0).astype(np.uint8)

    return result
