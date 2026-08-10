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
    max_distance_cells: int | None = None,
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
    max_distance_cells: int | None,
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
    ray_idx = (cell_angles / (2 * np.pi) * n_angles).astype(int) % n_angles

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
    max_distance_cells: int | None,
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
                    r0 = max(r0, 0)
                    c0 = max(c0, 0)
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
                    max_slope = max(max_slope, s)

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
    _rows, _cols = dem.shape
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
    breaks: list[tuple[float, str]] | None = None,
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


def feature_preserving_smooth(
    dem: np.ndarray,
    filter_size: int = 9,
    max_diff: float = 2.0,
    nodata: float = -32768.0,
) -> np.ndarray:
    """Feature-preserving smoothing using a Kuwahara-like filter.

    Smooths the DEM while preserving sharp features like ridges, roads,
    and building edges. Uses a range-weighted mean within a window —
    cells are smoothed with neighbors of similar elevation range,
    avoiding smoothing across sharp breaks.

    Args:
        dem: 2D elevation grid
        filter_size: Window size (must be odd, default 9)
        max_diff: Maximum elevation difference to consider neighbors similar (m)
        nodata: NODATA value

    Returns:
        2D float32 array of smoothed elevations
    """
    rows, cols = dem.shape
    smoothed = dem.astype(np.float64).copy()
    half = filter_size // 2

    # Pad the DEM
    padded = np.pad(dem.astype(np.float64), half, mode="edge")

    for r in range(rows):
        for c in range(cols):
            if dem[r, c] <= nodata:
                continue

            # Collect window and compute range-weighted mean
            window_vals = []
            window_ranges = []

            for wr in range(filter_size):
                for wc in range(filter_size):
                    pr = r + wr
                    pc = c + wc
                    val = padded[pr, pc]
                    if val <= nodata:
                        continue
                    window_vals.append(val)

                    # Compute local range in 3x3 around this point
                    local_vals = []
                    for lr in range(3):
                        for lc in range(3):
                            lpr = pr + lr - 1
                            lpc = pc + lc - 1
                            lv = padded[lpr, lpc]
                            if lv > nodata:
                                local_vals.append(lv)
                    if len(local_vals) >= 2:
                        window_ranges.append(max(local_vals) - min(local_vals))
                    else:
                        window_ranges.append(np.inf)

            if not window_vals:
                continue

            # Weight by inverse of range — smaller range = more weight
            weights = []
            for wrange in window_ranges:
                if wrange < max_diff:
                    weights.append(1.0 / (wrange + 0.1))
                else:
                    weights.append(0.0)

            total_weight = sum(weights)
            if total_weight > 0:
                smoothed[r, c] = sum(w * v for w, v in zip(weights, window_vals)) / total_weight

    return smoothed.astype(np.float32)


def mstp(
    dem: np.ndarray,
    radii: list[int] | None = None,
    cell_size_deg: float = 0.001,
    nodata: float = -32768.0,
) -> np.ndarray:
    """Multi-Scale Terrain Position classification.

    Classifies terrain into discrete position types across multiple scales:
    peaks/ridges, upper slopes, middle slopes, lower slopes, valleys.
    Combines TPI computed at multiple radii to get scale-independent classification.

    Args:
        dem: 2D elevation grid
        radii: List of radii for multi-scale analysis. Default [2, 5, 10].
        cell_size_deg: Cell size in degrees
        nodata: NODATA value

    Returns:
        2D int8 array of terrain position classes:
        0 = peak/ridge, 1 = upper slope, 2 = middle slope,
        3 = lower slope, 4 = valley, -1 = nodata
    """
    from openzenith.terrain import tpi

    if radii is None:
        radii = [2, 5, 10]

    rows, cols = dem.shape
    result = np.full((rows, cols), -1, dtype=np.int8)
    valid = dem > nodata

    # Compute TPI at each scale
    tpi_scales = {}
    for radius in radii:
        tpi_scales[radius] = tpi(dem, cell_size_deg, nodata)

    # Classification based on multi-scale TPI combination
    for r in range(rows):
        for c in range(cols):
            if not valid[r, c]:
                continue

            large_tpi = tpi_scales[radii[-1]][r, c]
            if np.isnan(large_tpi):
                continue

            mid_tpi = tpi_scales[radii[len(radii) // 2]][r, c]
            small_tpi = tpi_scales[radii[0]][r, c]

            if large_tpi > 0.5 and small_tpi > 0.3:
                cls = 0
            elif large_tpi > 0.2 and mid_tpi > 0.2:
                cls = 1
            elif abs(large_tpi) < 0.3:
                cls = 2
            elif large_tpi < -0.2 and mid_tpi < -0.1:
                cls = 3
            elif large_tpi < -0.5 and small_tpi < -0.3:
                cls = 4
            elif large_tpi > 0:
                cls = 0
            else:
                cls = 4

            result[r, c] = cls

    return result


def slope_area_ratio(
    dem: np.ndarray,
    flow_accum: np.ndarray | None = None,
    cell_size_deg: float = 0.001,
    nodata: float = -32768.0,
) -> np.ndarray:
    """Compute slope-area ratio.

    SAR = tan(slope) / sqrt(accum * cell_area)
    Used for distinguishing hillslope processes from channel processes.

    Args:
        dem: 2D elevation grid
        flow_accum: Optional flow accumulation grid
        cell_size_deg: Cell size in degrees
        nodata: NODATA value

    Returns:
        2D float32 array of slope-area ratio values
    """
    from openzenith.hydrology import d8_flow_direction, fill_depressions, flow_accumulation_fast

    filled = fill_depressions(dem, nodata)
    fd = d8_flow_direction(filled, nodata)

    if flow_accum is None:
        flow_accum = flow_accumulation_fast(fd)

    slp = slope(dem, cell_size_deg, nodata)
    slope_rad = np.deg2rad(slp)

    cell_m = cell_size_deg * 111320.0
    accum_area = (flow_accum + 1) * cell_m * cell_m

    sar = np.tan(slope_rad) / np.sqrt(accum_area / cell_m / cell_m)

    valid = (dem != nodata) & (flow_accum > 0)
    return np.where(valid, sar, np.nan).astype(np.float32)


def curvature_classification(
    dem: np.ndarray,
    cell_size_deg: float = 0.001,
    nodata: float = -32768.0,
) -> np.ndarray:
    """Classify terrain curvature into discrete types.

    Classifies each cell as:
    0 = planar (flat)
    1 = convergent (valley/channel)
    2 = divergent (ridge/spur)
    3 = ridge (peak)
    4 = valley (channel bottom)

    Args:
        dem: 2D elevation grid
        cell_size_deg: Cell size in degrees
        nodata: NODATA value

    Returns:
        2D int8 array of curvature classes
    """
    from openzenith.terrain import planform_curvature, profile_curvature

    p_curv = profile_curvature(dem, cell_size_deg, nodata)
    plan_curv = planform_curvature(dem, cell_size_deg, nodata)

    rows, cols = dem.shape
    result = np.full((rows, cols), -1, dtype=np.int8)
    valid = dem > nodata

    planar_thresh = 0.0001
    ridge_thresh = 0.0005

    for r in range(rows):
        for c in range(cols):
            if not valid[r, c]:
                continue

            pc = p_curv[r, c]
            pl = plan_curv[r, c]
            if np.isnan(pc) or np.isnan(pl):
                continue

            if abs(pc) < planar_thresh and abs(pl) < planar_thresh:
                result[r, c] = 0
            elif pc < -ridge_thresh and pl > ridge_thresh:
                result[r, c] = 3
            elif pc > ridge_thresh and pl < -ridge_thresh:
                result[r, c] = 4
            elif pc < -planar_thresh and pl < -planar_thresh:
                result[r, c] = 1
            elif pc > planar_thresh and pl > planar_thresh or pl < -planar_thresh:
                result[r, c] = 2
            elif pl > planar_thresh:
                result[r, c] = 1
            else:
                result[r, c] = 0

    return result


def specific_catchment_area(
    dem: np.ndarray,
    flow_accum: np.ndarray | None = None,
    cell_size_deg: float = 0.001,
    nodata: float = -32768.0,
) -> np.ndarray:
    """Compute Specific Catchment Area (SCA).

    SCA = upslope contributing area / unit contour width.
    Unlike flow accumulation (count of cells), SCA is in units of area
    per unit width, making it scale-independent.

    Args:
        dem: 2D elevation grid
        flow_accum: Optional flow accumulation grid
        cell_size_deg: Cell size in degrees
        nodata: NODATA value

    Returns:
        2D float32 array of SCA in m²/m
    """
    from openzenith.hydrology import d8_flow_direction, fill_depressions, flow_accumulation_fast

    filled = fill_depressions(dem, nodata)
    fd = d8_flow_direction(filled, nodata)

    if flow_accum is None:
        flow_accum = flow_accumulation_fast(fd)

    cell_m = cell_size_deg * 111320.0

    sca = flow_accum.astype(np.float64) * cell_m * cell_m / cell_m

    valid = (dem != nodata) & (flow_accum > 0)
    return np.where(valid, sca, np.nan).astype(np.float32)


def hack_integral(
    dem: np.ndarray,
    flow_accum: np.ndarray | None = None,
    cell_size_deg: float = 0.001,
    nodata: float = -32768.0,
) -> dict:
    """Compute Hack integral for stream profile analysis.

    The Hack integral characterizes the scaling relationship between
    stream length and drainage area along a stream profile:
    L = k * A^F

    Args:
        dem: 2D elevation grid
        flow_accum: Optional flow accumulation grid
        cell_size_deg: Cell size in degrees
        nodata: NODATA value

    Returns:
        Dict with 'hack_exponent' F, 'k' coefficient, 'chi' grid
    """
    from openzenith.hydrology import (
        d8_flow_direction,
        downslope_flowpath_length,
        fill_depressions,
        flow_accumulation_fast,
    )

    filled = fill_depressions(dem, nodata)
    fd = d8_flow_direction(filled, nodata)

    if flow_accum is None:
        flow_accum = flow_accumulation_fast(fd)

    rows, cols = dem.shape
    cell_m = cell_size_deg * 111320.0

    dist = downslope_flowpath_length(dem, fd, nodata)

    chi = np.zeros((rows, cols), dtype=np.float64)
    for r in range(rows):
        for c in range(cols):
            if dem[r, c] <= nodata or flow_accum[r, c] < 1:
                continue
            accum = float(flow_accum[r, c])
            if accum > 0:
                chi[r, c] = np.sqrt(accum) * cell_m

    stream_mask = flow_accum > 100
    if not stream_mask.any():
        return {"hack_exponent": np.nan, "k_coefficient": np.nan, "chi": chi.astype(np.float32)}

    accum_vals = flow_accum[stream_mask].astype(np.float64)
    dist_vals = dist[stream_mask]

    valid = np.isfinite(dist_vals) & (accum_vals > 0)
    if valid.sum() < 10:
        return {"hack_exponent": np.nan, "k_coefficient": np.nan, "chi": chi.astype(np.float32)}

    accum_log = np.log(accum_vals[valid])
    dist_log = np.log(dist_vals[valid] + 1)

    n = len(accum_log)
    sum_x = accum_log.sum()
    sum_y = dist_log.sum()
    sum_xy = (accum_log * dist_log).sum()
    sum_x2 = (accum_log * accum_log).sum()

    denom = n * sum_x2 - sum_x * sum_x
    if abs(denom) < 1e-10:
        return {"hack_exponent": np.nan, "k_coefficient": np.nan, "chi": chi.astype(np.float32)}

    F = (n * sum_xy - sum_x * sum_y) / denom
    log_k = (sum_y - F * sum_x) / n
    k = np.exp(log_k)

    return {
        "hack_exponent": round(float(F), 4),
        "k_coefficient": round(float(k), 2),
        "chi": chi.astype(np.float32),
    }


def sky_view_factor(
    dem: np.ndarray,
    cell_size_deg: float = 0.001,
    nodata: float = -32768.0,
    n_directions: int = 8,
) -> np.ndarray:
    """Compute sky view factor for solar radiation modeling.

    The sky view factor (SVF) is the proportion of sky visible from
    a point on the terrain. It ranges from 0 (completely obscured)
    to 1 (open sky). Used in solar radiation and cold-air drainage modeling.

    Computed by averaging analytical hillshades over multiple azimuth angles
    (360/n_directions steps) and converting shade to view factor.

    Args:
        dem: 2D elevation grid (meters)
        cell_size_deg: Cell size in degrees
        nodata: NODATA value
        n_directions: Number of azimuth directions to sample (default 8)

    Returns:
        2D float32 array of sky view factor (0-1)
    """
    rows, cols = dem.shape
    svf = np.zeros((rows, cols), dtype=np.float64)
    n_sample = 0

    for azimuth in range(0, 360, 360 // n_directions):
        # Use low altitude angle (10°) to catch terrain obstructions
        shade = hillshade(dem, azimuth=float(azimuth), altitude=10.0,
                          cell_size_deg=cell_size_deg, nodata=nodata)
        # Convert shade (0-255) to view factor (0-1)
        svf += shade.astype(np.float64) / 255.0
        n_sample += 1

    svf /= n_sample

    # Mark NODATA areas
    valid = dem > nodata
    result = svf.astype(np.float32)
    result[~valid] = np.nan
    return result


def landform_classification(
    dem: np.ndarray,
    cell_size_deg: float = 0.001,
    nodata: float = -32768.0,
) -> np.ndarray:
    """Classify terrain into discrete landform types.

    Combines slope, aspect, and curvature to classify each cell as:
    0 = peak (summit)
    1 = ridge
    2 = upper slope
    3 = middle slope
    4 = lower slope
    5 = valley (channel)
    6 = pit (depression)
    7 = saddle
    8 = flat
    -1 = nodata

    Fully vectorized — no Python loops.

    Args:
        dem: 2D elevation grid (meters)
        cell_size_deg: Cell size in degrees
        nodata: NODATA value

    Returns:
        2D int8 array of landform classes
    """
    rows, cols = dem.shape
    result = np.full((rows, cols), -1, dtype=np.int8)
    valid = dem > nodata

    # Compute derivatives (all vectorized)
    slp = slope(dem, cell_size_deg, nodata)
    curv = curvature(dem, cell_size_deg, nodata)
    p_curv = profile_curvature(dem, cell_size_deg, nodata)
    plan_curv = planform_curvature(dem, cell_size_deg, nodata)
    tpi_vals = tpi(dem, cell_size_deg, nodata)

    # Fully vectorized threshold classification using np.where chains
    # Start with "middle slope" as default, override with specific classes
    s_nan = np.isnan(slp)
    cu_nan = np.isnan(curv)
    any_nan = s_nan | cu_nan

    # Flat (slope < 2)
    result[(slp < 2) & valid] = 8

    # Pit (TPI < -5 and concave)
    result[(tpi_vals < -5) & (curv < -0.001) & valid] = 6

    # Peak (TPI > 5, slope > 10, concave profile)
    result[(tpi_vals > 5) & (slp > 10) & (p_curv < -0.0005) & valid] = 0

    # Ridge (concave profile, convex plan)
    result[(p_curv < -0.0005) & (plan_curv > 0.0005) & valid] = 1

    # Valley (convex profile, concave plan)
    result[(p_curv > 0.0005) & (plan_curv < -0.0005) & valid] = 5

    # Saddle (both curvatures near zero and TPI near zero)
    result[
        (np.abs(p_curv) < 0.0002) & (np.abs(plan_curv) < 0.0002) &
        (np.abs(tpi_vals) < 2) & valid
    ] = 7

    # Upper slope (TPI > 2, not classified yet)
    result[(tpi_vals > 2) & (result == -1) & valid] = 2

    # Lower slope (TPI < -2, not classified yet)
    result[(tpi_vals < -2) & (result == -1) & valid] = 4

    # Mark NaN cells
    result[any_nan] = -1
    result[~valid] = -1

    return result


def visibility_index(
    dem: np.ndarray,
    observer_points: list[tuple[int, int]],
    observer_heights: list[float] | None = None,
    cell_size_deg: float = 0.001,
    nodata: float = -32768.0,
) -> np.ndarray:
    """Compute visibility index — how many observer points can see each cell.

    Computes the cumulative viewshed from multiple observer points,
    returning the count of visible observers for each terrain cell.

    Args:
        dem: 2D elevation grid (meters)
        observer_points: List of (row, col) observer locations
        observer_heights: Optional list of observer heights (default 1.75m)
        cell_size_deg: Cell size in degrees
        nodata: NODATA value

    Returns:
        2D int16 array of visibility count (how many observers can see each cell)
    """
    rows, cols = dem.shape
    vis_count = np.zeros((rows, cols), dtype=np.int16)

    if observer_heights is None:
        observer_heights = [1.75] * len(observer_points)

    for (obs_r, obs_c), obs_h in zip(observer_points, observer_heights):
        if 0 <= obs_r < rows and 0 <= obs_c < cols:
            vis = viewshed(dem, obs_r, obs_c, obs_h, cell_size_deg, nodata)
            vis_count[vis] += 1

    return vis_count


def flow_width(dem: np.ndarray, flow_dir: np.ndarray | None = None, nodata: float = -32768.0) -> np.ndarray:
    """Compute flow width for each cell.

    Flow width is the width of the cell perpendicular to the flow direction,
    used in unit stream power and erosion modeling.

    For D8: width = cell_size * cos(theta) where theta is the angle
    between flow direction and the perpendicular.

    Args:
        dem: 2D elevation grid
        flow_dir: Optional D8 flow direction grid
        nodata: NODATA value

    Returns:
        2D float32 array of flow width in meters
    """
    if flow_dir is None:
        from openzenith.hydrology import d8_flow_direction

        flow_dir = d8_flow_direction(dem, nodata)

    rows, cols = dem.shape
    cell_size_deg = 0.001
    cell_m = cell_size_deg * 111320.0

    # D8 flow is at 45° increments
    # E=0, SE=1, S=2, SW=3, W=4, NW=5, N=6, NE=7
    # Width is cell_m for cardinal (E/W/N/S) and cell_m*sqrt(2) for diagonal
    # But for flow width perpendicular to flow, use:
    # cardinal: cell_m
    # diagonal: cell_m * sqrt(2)
    width = np.full((rows, cols), cell_m, dtype=np.float32)

    # Diagonal directions: 1(SE), 3(SW), 5(NW), 7(NE)
    diag_mask = (flow_dir == 1) | (flow_dir == 3) | (flow_dir == 5) | (flow_dir == 7)
    width[diag_mask] = cell_m * np.sqrt(2)

    # Mark nodata
    width[dem <= nodata] = np.nan
    width[flow_dir < 0] = np.nan

    return width


# ─── Raster Algebra ─────────────────────────────────────────────────────────────


def dem_where(
    condition: np.ndarray,
    true_value: np.ndarray | float,
    false_value: np.ndarray | float,
    nodata: float = -32768.0,
) -> np.ndarray:
    """Raster algebra — return values from true/false arrays based on a condition.

    Equivalent to NumPy's np.where() for DEM-style raster operations.
    This is the core of all conditional terrain operations.

    Args:
        condition: Boolean 2D array (True = use true_value)
        true_value: Array or scalar returned where condition is True
        false_value: Array or scalar returned where condition is False
        nodata: NODATA value for the output

    Returns:
        2D float32 array with values selected from true/false
    """
    result = np.where(condition, true_value, false_value)
    return result.astype(np.float32)


def dem_clip(
    dem: np.ndarray,
    min_val: float | np.ndarray,
    max_val: float | np.ndarray,
    nodata: float = -32768.0,
) -> np.ndarray:
    """Clip DEM values to a range (min/max clamping).

    Args:
        dem: 2D elevation grid
        min_val: Minimum value (scalar or array)
        max_val: Maximum value (scalar or array)
        nodata: NODATA value

    Returns:
        2D float32 array with values clamped to [min_val, max_val]
    """
    result = np.clip(dem, min_val, max_val)
    result = np.where(dem != nodata, result, nodata)
    return result.astype(np.float32)


def dem_mask(
    dem: np.ndarray,
    condition: np.ndarray,
    mask_value: float = np.nan,
    nodata: float = -32768.0,
) -> np.ndarray:
    """Mask DEM cells where condition is True (set to mask_value).

    Args:
        dem: 2D elevation grid
        condition: Boolean mask (True = mask this cell)
        mask_value: Value to set for masked cells (default NaN)
        nodata: NODATA value to preserve

    Returns:
        2D float32 array with masked cells set to mask_value
    """
    result = dem.astype(np.float32).copy()
    result[condition] = mask_value
    return result


def dem_reclassify(
    dem: np.ndarray,
    thresholds: list[float],
    values: list[float],
    nodata: float = -32768.0,
) -> np.ndarray:
    """Reclassify DEM values based on thresholds.

    Assigns output values based on which range the input falls into.
    Example: dem_reclassify(dem, [0, 100, 500, 1000], [0, 1, 2, 3])
             returns 0 where dem<100, 1 where 100<=dem<500, etc.

    Args:
        dem: 2D elevation grid
        thresholds: Sorted list of upper bounds
        values: Output values for each class
        nodata: NODATA value

    Returns:
        2D float32 array with reclassified values
    """
    result = np.full(dem.shape, np.nan, dtype=np.float32)
    valid = dem != nodata

    for i, (low, high) in enumerate(zip([float("-inf")] + thresholds[:-1], thresholds)):
        mask = valid & (dem >= low) & (dem < high)
        result[mask] = values[i]

    # Anything above the last threshold
    if len(thresholds) > 0:
        mask = valid & (dem >= thresholds[-1])
        result[mask] = values[-1]

    return result


# ─── WhiteboxTools Parity Functions ───────────────────────────────────────────────


def max_filter(
    dem: np.ndarray,
    kernel_size: int = 3,
    nodata: float = -32768.0,
) -> np.ndarray:
    """Apply a maximum filter (dilation) over the DEM.

    Equivalent to WhiteboxTools MaxElevationArchitecture.
    Each cell is replaced with the maximum value in its neighborhood.

    Args:
        dem: 2D elevation grid
        kernel_size: Window size (must be odd, default 3)
        nodata: NODATA value

    Returns:
        2D float32 array of max-filtered values
    """
    from scipy.ndimage import maximum_filter

    valid = dem != nodata
    result = dem.astype(np.float32).copy()
    filtered = maximum_filter(np.where(valid, dem, np.nan), size=kernel_size)
    result = np.where(valid, filtered, nodata)
    return result.astype(np.float32)


def min_filter(
    dem: np.ndarray,
    kernel_size: int = 3,
    nodata: float = -32768.0,
) -> np.ndarray:
    """Apply a minimum filter (erosion) over the DEM.

    Equivalent to WhiteboxTools MinElevationArchitecture.
    Each cell is replaced with the minimum value in its neighborhood.

    Args:
        dem: 2D elevation grid
        kernel_size: Window size (must be odd, default 3)
        nodata: NODATA value

    Returns:
        2D float32 array of min-filtered values
    """
    from scipy.ndimage import minimum_filter

    valid = dem != nodata
    result = dem.astype(np.float32).copy()
    filtered = minimum_filter(np.where(valid, dem, np.nan), size=kernel_size)
    result = np.where(valid, filtered, nodata)
    return result.astype(np.float32)


def dev_from_mean_plane(
    dem: np.ndarray,
    nodata: float = -32768.0,
) -> np.ndarray:
    """Compute deviation from the mean elevation plane.

    Equivalent to WhiteboxTools DevFromMeanPlane.
    Positive = above mean, negative = below mean.

    Args:
        dem: 2D elevation grid
        nodata: NODATA value

    Returns:
        2D float32 array of deviations from mean (meters)
    """
    valid = dem != nodata
    mean_elev = np.mean(dem[valid])
    result = np.full(dem.shape, np.nan, dtype=np.float32)
    result[valid] = dem[valid] - mean_elev
    result[~valid] = nodata
    return result


def diff_from_mean(
    dem: np.ndarray,
    nodata: float = -32768.0,
) -> np.ndarray:
    """Compute difference from mean elevation (alias for dev_from_mean_plane)."""
    return dev_from_mean_plane(dem, nodata)


def directional_relief(
    dem: np.ndarray,
    azimuth: float = 0.0,
    max_distance: int = 100,
    cell_size_deg: float = 0.001,
    nodata: float = -32768.0,
) -> np.ndarray:
    """Compute directional relief (visibility from a specific direction).

    Like hillshade but measures how much each cell is "seen" from a specific
    azimuth direction — useful for understanding prevailing wind/solar exposure.

    Equivalent to WhiteboxTools DirectionalRelief.

    Args:
        dem: 2D elevation grid
        azimuth: Compass direction to check visibility toward (degrees)
        max_distance: Maximum search distance in cells
        cell_size_deg: Cell size in degrees
        nodata: NODATA value

    Returns:
        2D float32 array of directional relief (0-1, fraction of direction visible)
    """
    rows, cols = dem.shape
    az_rad = np.radians(azimuth)
    # Direction vector (row increases downward, so north = -1 in row)
    dr = -np.sin(az_rad)  # row direction (negative = north)
    dc = np.cos(az_rad)    # col direction (positive = east)

    result = np.full((rows, cols), np.nan, dtype=np.float32)
    valid = dem > nodata

    for r in range(rows):
        for c in range(cols):
            if not valid[r, c]:
                continue

            origin_elev = dem[r, c]
            visible = 0
            total = 0

            for dist in range(1, max_distance + 1):
                nr = round(r + dist * dr)
                nc = round(c + dist * dc)
                if 0 <= nr < rows and 0 <= nc < cols:
                    if valid[nr, nc]:
                        total += 1
                        if dem[nr, nc] < origin_elev:
                            visible += 1
                else:
                    break

            if total > 0:
                result[r, c] = visible / total
            else:
                result[r, c] = 0.0

    result[~valid] = nodata
    return result


def hillshade_diff(
    dem: np.ndarray,
    azimuth1: float = 315.0,
    altitude1: float = 45.0,
    azimuth2: float = 135.0,
    altitude2: float = 45.0,
    cell_size_deg: float = 0.001,
    nodata: float = -32768.0,
) -> np.ndarray:
    """Compute difference between two hillshades.

    Equivalent to WhiteboxTools HillshadeDiff.
    Useful for comparing illumination from different sun positions.

    Args:
        dem: 2D elevation grid
        azimuth1: First hillshade azimuth (degrees)
        altitude1: First hillshade altitude (degrees)
        azimuth2: Second hillshade azimuth (degrees)
        altitude2: Second hillshade altitude (degrees)
        cell_size_deg: Cell size in degrees
        nodata: NODATA value

    Returns:
        2D float32 array of hillshade difference (shade1 - shade2, -255 to 255)
    """
    shade1 = hillshade(dem, azimuth=azimuth1, altitude=altitude1,
                        cell_size_deg=cell_size_deg, nodata=nodata)
    shade2 = hillshade(dem, azimuth=azimuth2, altitude=altitude2,
                        cell_size_deg=cell_size_deg, nodata=nodata)
    diff = (shade1.astype(np.float32) - shade2.astype(np.float32))
    result = np.where(dem > nodata, diff, nodata)
    return result.astype(np.float32)


def aspect_slope(
    dem: np.ndarray,
    cell_size_deg: float = 0.001,
    nodata: float = -32768.0,
) -> tuple[np.ndarray, np.ndarray]:
    """Compute aspect and slope in a single pass (more efficient than calling separately).

    Equivalent to WhiteboxTools AspectSlope.

    Args:
        dem: 2D elevation grid
        cell_size_deg: Cell size in degrees
        nodata: NODATA value

    Returns:
        Tuple of (aspect_deg, slope_deg) arrays
    """
    valid = dem > nodata
    cell_y = cell_size_deg * 111320.0
    cell_x = cell_size_deg * 111320.0 * np.cos(np.radians(
        np.nanmean(dem[valid]) if np.any(valid) else 0.0))

    padded = np.pad(dem.astype(np.float64), 1, mode="constant", constant_values=nodata)

    a = padded[:-2, :-2]
    b = padded[:-2, 1:-1]
    c = padded[:-2, 2:]
    d = padded[1:-1, :-2]
    f = padded[1:-1, 2:]
    g = padded[2:, :-2]
    h = padded[2:, 1:-1]
    i = padded[2:, 2:]

    dz_dx = ((c + 2 * f + i) - (a + 2 * d + g)) / (8 * cell_x)
    dz_dy = ((a + 2 * b + c) - (g + 2 * h + i)) / (8 * cell_y)

    slope_rad = np.arctan(np.sqrt(dz_dx ** 2 + dz_dy ** 2))
    slope_deg = np.degrees(slope_rad)

    aspect_rad = np.arctan2(-dz_dy, dz_dx)
    aspect_deg = (90 - np.degrees(aspect_rad) + 180) % 360

    flat = (np.abs(dz_dx) < 1e-10) & (np.abs(dz_dy) < 1e-10)
    aspect_deg[flat | ~valid] = np.nan
    slope_deg[~valid] = np.nan

    return aspect_deg.astype(np.float32), slope_deg.astype(np.float32)


def mean_filter(
    dem: np.ndarray,
    kernel_size: int = 3,
    nodata: float = -32768.0,
) -> np.ndarray:
    """Apply a mean filter over the DEM.

    Smooths the DEM using a moving average window.

    Args:
        dem: 2D elevation grid
        kernel_size: Window size (must be odd, default 3)
        nodata: NODATA value

    Returns:
        2D float32 array of mean-filtered values
    """
    from scipy.ndimage import uniform_filter

    valid = dem != nodata
    result = dem.astype(np.float32).copy()
    filtered = uniform_filter(np.where(valid, dem, np.nan), size=kernel_size)
    result = np.where(valid, filtered, nodata)
    return result.astype(np.float32)


def median_filter(
    dem: np.ndarray,
    kernel_size: int = 3,
    nodata: float = -32768.0,
) -> np.ndarray:
    """Apply a median filter over the DEM.

    Good for spike/noise removal while preserving edges better than mean.

    Args:
        dem: 2D elevation grid
        kernel_size: Window size (must be odd, default 3)
        nodata: NODATA value

    Returns:
        2D float32 array of median-filtered values
    """
    from scipy.ndimage import median_filter

    valid = dem != nodata
    result = dem.astype(np.float32).copy()
    filtered = median_filter(np.where(valid, dem, np.nan), size=kernel_size)
    result = np.where(valid, filtered, nodata)
    return result.astype(np.float32)


def pct_above_thresh(
    dem: np.ndarray,
    threshold: float,
    nodata: float = -32768.0,
) -> float:
    """Compute percentage of cells above a threshold.

    Equivalent to WhiteboxTools PctGreaterThan / PctLessThan.
    Returns the fraction (0-1) of valid cells with value above the threshold.

    Args:
        dem: 2D elevation grid
        threshold: Threshold value
        nodata: NODATA value

    Returns:
        Fraction of cells above threshold (0.0 to 1.0)
    """
    valid = dem > nodata
    if not valid.any():
        return 0.0
    return float(np.sum(dem[valid] > threshold)) / float(np.sum(valid))


def pct_below_thresh(
    dem: np.ndarray,
    threshold: float,
    nodata: float = -32768.0,
) -> float:
    """Compute percentage of cells below a threshold.

    Args:
        dem: 2D elevation grid
        threshold: Threshold value
        nodata: NODATA value

    Returns:
        Fraction of cells below threshold (0.0 to 1.0)
    """
    valid = dem > nodata
    if not valid.any():
        return 0.0
    return float(np.sum(dem[valid] < threshold)) / float(np.sum(valid))


def elevation_percentile(
    dem: np.ndarray,
    kernel_size: int = 5,
    nodata: float = -32768.0,
) -> np.ndarray:
    """Compute local elevation percentile rank.

    For each cell, computes what fraction of neighbors have lower elevation.

    Args:
        dem: 2D elevation grid
        kernel_size: Window size (default 5)
        nodata: NODATA value

    Returns:
        2D float32 array of percentiles (0-1)
    """
    from scipy.ndimage import rank_filter

    valid = dem > nodata
    result = np.full(dem.shape, np.nan, dtype=np.float32)
    ranked = rank_filter(np.where(valid, dem, 0).astype(np.float32),
                         rank=kernel_size * kernel_size // 2,
                         size=kernel_size,
                         mode="constant", cval=0)
    # Count total valid in window for percentile
    valid_count = rank_filter(valid.astype(np.float32), rank=0, size=kernel_size,
                               mode="constant", cval=0)
    result = ranked / np.maximum(valid_count, 1)
    result[~valid] = nodata
    return result.astype(np.float32)


def hypsometry(
    dem: np.ndarray,
    nodata: float = -32768.0,
) -> np.ndarray:
    """Compute hypsometric curve values per cell.

    The hypsometric index is the proportion of a cell's watershed that
    lies above that cell's elevation. H = (E_min - E_cell) / (E_min - E_max)
    High values = cell is high in its watershed (ridges/upper slopes).
    Low values = cell is low (valleys/near outlet).

    Equivalent to WhiteboxTools Hypsometry.

    Args:
        dem: 2D elevation grid
        nodata: NODATA value

    Returns:
        2D float32 array of hypsometric index (0-1)
    """
    valid = dem > nodata
    e_min = np.min(dem[valid])
    e_max = np.max(dem[valid])
    e_range = e_max - e_min

    if e_range == 0:
        return np.full(dem.shape, 0.5, dtype=np.float32)

    result = np.full(dem.shape, np.nan, dtype=np.float32)
    result[valid] = (e_max - dem[valid]) / e_range
    result[~valid] = nodata
    return result.astype(np.float32)


def max_elevation_from_direction(
    dem: np.ndarray,
    azimuth: float = 0.0,
    max_distance: int = 50,
    nodata: float = -32768.0,
) -> np.ndarray:
    """Compute max elevation reachable from each cell in a given direction.

    Returns the maximum elevation encountered when looking from each cell
    along the specified compass bearing until out of bounds or hitting a peak.

    Equivalent to WhiteboxTools MaxElevationFromDirection.

    Args:
        dem: 2D elevation grid
        azimuth: Compass bearing (degrees clockwise from north, 0=N)
        max_distance: Maximum search distance in cells
        nodata: NODATA value

    Returns:
        2D float32 array of maximum elevation in search direction
    """
    rows, cols = dem.shape
    az_rad = np.radians(azimuth)
    dr = -np.sin(az_rad)   # row direction (negative = north)
    dc = np.cos(az_rad)     # col direction

    result = np.full((rows, cols), np.nan, dtype=np.float32)
    valid = dem > nodata

    for r in range(rows):
        for c in range(cols):
            if not valid[r, c]:
                continue
            max_elev = dem[r, c]
            for dist in range(1, max_distance + 1):
                nr = round(r + dist * dr)
                nc = round(c + dist * dc)
                if 0 <= nr < rows and 0 <= nc < cols and valid[nr, nc]:
                    max_elev = max(max_elev, dem[nr, nc])
                else:
                    break
            result[r, c] = max_elev

    result[~valid] = nodata
    return result.astype(np.float32)


def tangent_curvature(
    dem: np.ndarray,
    cell_size_deg: float = 0.001,
    nodata: float = -32768.0,
) -> np.ndarray:
    """Compute tangent curvature (curvature parallel to slope direction).

    Positive = convex in flow direction (accelerating flow).
    Negative = concave (decelerating flow).

    Equivalent to WhiteboxTools TangentCurvature.

    Args:
        dem: 2D elevation grid
        cell_size_deg: Cell size in degrees
        nodata: NODATA value

    Returns:
        2D float32 array of curvature values (1/meter)
    """
    from openzenith.terrain import aspect, slope

    valid = dem > nodata
    slp = slope(dem, cell_size_deg, nodata)  # degrees
    azm = aspect(dem, cell_size_deg, nodata)

    padded = np.pad(dem.astype(np.float64), 1, mode="constant", constant_values=nodata)
    a = padded[:-2, :-2]
    b = padded[:-2, 1:-1]
    c = padded[:-2, 2:]
    d = padded[1:-1, :-2]
    f = padded[1:-1, 2:]
    g = padded[2:, :-2]
    h = padded[2:, 1:-1]
    i = padded[2:, 2:]

    # Second derivative in east-west direction (d²z/dx²)
    d2z_dx2 = (a + 2 * d + g) / 4 - (c + 2 * f + i) / 4
    # Second derivative in north-south direction (d²z/dy²)
    d2z_dy2 = (a + 2 * b + c) / 4 - (g + 2 * h + i) / 4

    azm_rad = np.radians(azm)
    slope_rad = np.radians(slp)

    # Tangent curvature = (cos(slope)² * sin(aspect)² * d2z_dx2
    #                    + sin(slope)² * cos(aspect)² * d2z_dy2
    #                    - sin(2*aspect) * sin(2*slope) / 4 * (d2z_dx2 + d2z_dy2))
    cos_slope = np.cos(slope_rad)
    sin_slope = np.sin(slope_rad)
    cos_asp = np.cos(azm_rad)
    sin_asp = np.sin(azm_rad)

    tc = (cos_slope ** 2 * sin_asp ** 2 * d2z_dx2 +
          sin_slope ** 2 * cos_asp ** 2 * d2z_dy2 +
          np.sin(2 * azm_rad) * np.sin(2 * slope_rad) / 4 * (d2z_dx2 - d2z_dy2))

    result = np.full(dem.shape, np.nan, dtype=np.float32)
    result[valid] = tc[valid]
    result[~valid] = nodata
    return result.astype(np.float32)


def total_curvature(
    dem: np.ndarray,
    cell_size_deg: float = 0.001,
    nodata: float = -32768.0,
) -> np.ndarray:
    """Compute total curvature (laplacian: d²z/dx² + d²z/dy²).

    Positive = convex (ridges/peaks). Negative = concave (valleys).
    Equivalent to WhiteboxTools TotalCurvature.

    Args:
        dem: 2D elevation grid
        cell_size_deg: Cell size in degrees
        nodata: NODATA value

    Returns:
        2D float32 array of curvature values (1/meter)
    """
    valid = dem > nodata
    cell_m = cell_size_deg * 111320.0

    padded = np.pad(dem.astype(np.float64), 1, mode="constant", constant_values=nodata)
    d = padded[1:-1, :-2]
    f = padded[1:-1, 2:]
    b = padded[:-2, 1:-1]
    h = padded[2:, 1:-1]

    d2z_dx2 = (f - 2 * dem + d) / (cell_m ** 2)
    d2z_dy2 = (h - 2 * dem + b) / (cell_m ** 2)

    tc = d2z_dx2 + d2z_dy2

    result = np.full(dem.shape, np.nan, dtype=np.float32)
    result[valid] = tc[valid]
    result[~valid] = nodata
    return result.astype(np.float32)


def remove_off_terrain(
    dem: np.ndarray,
    kernel_size: int = 5,
    threshold: float = 5.0,
    nodata: float = -32768.0,
) -> np.ndarray:
    """Remove off-terrain objects (buildings, towers, trees) from DEM.

    Replaces spike artifacts with the local median elevation.

    Equivalent to WhiteboxTools RemoveOffTerrain.

    Args:
        dem: 2D elevation grid
        kernel_size: Window size (must be odd, default 5)
        threshold: Height above which a cell is considered off-terrain (meters)
        nodata: NODATA value

    Returns:
        2D float32 array with off-terrain objects replaced
    """
    from scipy.ndimage import median_filter

    valid = dem > nodata
    local_med = median_filter(np.where(valid, dem, np.nan), size=kernel_size)
    diff = dem - local_med
    result = dem.astype(np.float32).copy()
    result[(valid) & (diff > threshold)] = local_med[(valid) & (diff > threshold)]
    result[~valid] = nodata
    return result.astype(np.float32)


def clump(
    dem: np.ndarray,
    nodata: float = -32768.0,
) -> np.ndarray:
    """Clump (label) connected regions of equal value.

    Groups adjacent cells with the same value into unique objects.

    Equivalent to WhiteboxTools Clump.

    Args:
        dem: 2D array (any dtype)
        nodata: Value to treat as nodata

    Returns:
        2D int32 array of clump IDs (0 = nodata)
    """
    from scipy import ndimage

    valid = dem != nodata
    labeled, _ = ndimage.label(valid)
    result = np.zeros(dem.shape, dtype=np.int32)
    result[valid] = labeled[valid]
    return result


def sieve(
    dem: np.ndarray,
    min_size: int = 10,
    nodata: float = -32768.0,
) -> np.ndarray:
    """Remove small connected regions smaller than min_size.

    Replaces small regions with the value of their largest neighbor.

    Equivalent to WhiteboxTools Sieve.

    Args:
        dem: 2D array (any dtype)
        min_size: Minimum region size to keep
        nodata: NODATA value to skip

    Returns:
        2D array of same dtype as input
    """
    from scipy import ndimage

    result = dem.copy()
    valid = dem != nodata
    labeled, num_features = ndimage.label(valid)

    for feat_id in range(1, num_features + 1):
        mask = labeled == feat_id
        if np.sum(mask) < min_size:
            # Find largest neighbor region
            for r, c in zip(*np.where(mask)):
                for dr, dc in [(-1, 0), (1, 0), (0, -1), (0, 1)]:
                    nr, nc = r + dr, c + dc
                    if 0 <= nr < dem.shape[0] and 0 <= nc < dem.shape[1]:
                        neighbor_label = labeled[nr, nc]
                        if neighbor_label > 0 and neighbor_label != feat_id:
                            result[r, c] = dem[nr, nc]
                            break
    return result


def majority_filter(
    dem: np.ndarray,
    kernel_size: int = 3,
    nodata: float = -32768.0,
) -> np.ndarray:
    """Apply majority filter — replaces each cell with the most common value in window.

    Works on categorical/integer rasters.

    Args:
        dem: 2D array (integer or float)
        kernel_size: Window size (must be odd, default 3)
        nodata: NODATA value to exclude

    Returns:
        2D array of same dtype as input
    """
    from scipy.ndimage import uniform_filter

    valid = dem != nodata
    # For float, use round to nearest int for mode computation
    int_dem = np.where(valid, np.round(dem).astype(np.int32), 0)
    counts = uniform_filter((int_dem == int_dem[:, :, np.newaxis]).astype(np.float32),
                            size=kernel_size)
    # Find the mode value for each cell
    result = np.zeros_like(dem, dtype=dem.dtype)
    for val in np.unique(int_dem[valid]):
        mask = (counts > counts.max(axis=2, keepdims=True))[:, :, 0] & (int_dem == val)
        result[mask] = val
    return result


def highland(
    dem: np.ndarray,
    cell_size_deg: float = 0.001,
    nodata: float = -32768.0,
) -> np.ndarray:
    """Terrain ruggedness index from max/min elevation in search window.

    Computes the difference between max and min elevation in a 3x3 window.
    Similar to TRI but uses range instead of mean deviation.

    Equivalent to WhiteboxTools Highland.

    Args:
        dem: 2D elevation grid
        cell_size_deg: Cell size in degrees
        nodata: NODATA value

    Returns:
        2D float32 array of ruggedness (max - min in window)
    """
    from scipy.ndimage import generic_filter

    valid = dem > nodata
    result = np.full(dem.shape, np.nan, dtype=np.float32)

    def _range(x):
        v = x[x != nodata]
        return np.max(v) - np.min(v) if len(v) > 0 else np.nan

    filtered = generic_filter(np.where(valid, dem, nodata), _range,
                              size=3, mode="constant", cval=nodata)
    result[valid] = filtered[valid]
    result[~valid] = nodata
    return result.astype(np.float32)


def annual_heinardh(
    dem: np.ndarray,
    cell_size_deg: float = 0.001,
    nodata: float = -32768.0,
) -> np.ndarray:
    """Heinardh geomorphological index (precipitation-landform relationship).

    H = (E - E_min) / (E_max - E_min) * slope
    Combines relative elevation with slope — high values on steep upper slopes.

    Args:
        dem: 2D elevation grid
        cell_size_deg: Cell size in degrees
        nodata: NODATA value

    Returns:
        2D float32 array of Heinardh index
    """
    from openzenith.terrain import slope as _slope

    valid = dem > nodata
    e_min = np.min(dem[valid])
    e_max = np.max(dem[valid])
    e_range = e_max - e_min
    slp = _slope(dem, cell_size_deg, nodata)

    result = np.full(dem.shape, np.nan, dtype=np.float32)
    if e_range > 0:
        rel_elev = (dem - e_min) / e_range
        result[valid] = rel_elev[valid] * slp[valid]
    result[~valid] = nodata
    return result.astype(np.float32)


def flow_length(
    dem: np.ndarray,
    direction: str = "downslope",
    nodata: float = -32768.0,
) -> np.ndarray:
    """Compute longest flow path length from each cell to grid edge.

    For each cell, traces the flow path (using D8) and returns the total
    path length in meters.

    Equivalent to WhiteboxTools FlowLength.

    Args:
        dem: 2D elevation grid
        direction: "downslope" or "upslope"
        nodata: NODATA value

    Returns:
        2D float32 array of flow path lengths (meters)
    """
    from openzenith.hydrology import d8_flow_direction

    rows, cols = dem.shape

    fd = d8_flow_direction(dem, nodata)
    result = np.full((rows, cols), 0.0, dtype=np.float32)

    cell_m = 0.001 * 111320.0  # approximate

    if direction == "downslope":
        for r in range(rows):
            for c in range(cols):
                if dem[r, c] <= nodata:
                    continue
                cr, cc = r, c
                length = 0.0
                visited = set()
                while True:
                    if (cr, cc) in visited:
                        break
                    visited.add((cr, cc))
                    d = fd[cr, cc]
                    if d == -1:
                        break
                    di = int(d)
                    nr = cr + int(np.array([0, 1, 1, 1, 0, -1, -1, -1])[di])
                    nc = cc + int(np.array([1, 1, 0, -1, -1, -1, 0, 1])[di])
                    if not (0 <= nr < rows and 0 <= nc < cols):
                        break
                    dist = [1.0, np.sqrt(2), 1.0, np.sqrt(2), 1.0, np.sqrt(2), 1.0, np.sqrt(2)][di]
                    length += dist * cell_m
                    cr, cc = nr, nc
                result[r, c] = length
    else:  # upslope
        for r in range(rows):
            for c in range(cols):
                if dem[r, c] <= nodata:
                    continue
                # Trace all cells that flow into (r,c)
                length = _upslope_flow_length(dem, fd, r, c, nodata)
                result[r, c] = length

    return result


def _upslope_flow_length(
    dem: np.ndarray,
    fd: np.ndarray,
    tr: int,
    tc: int,
    nodata: float,
) -> float:
    """Compute total upslope flow length for a target cell."""
    rows, cols = dem.shape
    cell_m = 0.001 * 111320.0

    dr_map = {0: 0, 1: 1, 2: 1, 3: 1, 4: 0, 5: -1, 6: -1, 7: -1}
    dc_map = {0: 1, 1: 1, 2: 0, 3: -1, 4: -1, 5: -1, 6: 0, 7: 1}

    def trace(r, c, visited):
        if (r, c) in visited or dem[r, c] <= nodata or fd[r, c] == -1:
            return 0.0
        visited.add((r, c))
        d = int(fd[r, c])
        dist = [1.0, np.sqrt(2), 1.0, np.sqrt(2), 1.0, np.sqrt(2), 1.0, np.sqrt(2)][d]
        nr = r + dr_map[d]
        nc = c + dc_map[d]
        if 0 <= nr < rows and 0 <= nc < cols:
            return dist * cell_m + trace(nr, nc, visited)
        return dist * cell_m

    visited = set()
    return trace(tr, tc, visited)


def edge_density(
    dem: np.ndarray,
    threshold: float = 100.0,
    nodata: float = -32768.0,
) -> np.ndarray:
    """Compute edge density (rate of elevation change per unit distance).

    Measures the "bumpiness" of terrain — high values indicate rapid
    transitions between elevations.

    Args:
        dem: 2D elevation grid
        threshold: Minimum elevation difference to count as an edge (meters)
        nodata: NODATA value

    Returns:
        2D float32 array of edge densities
    """
    valid = dem > nodata
    padded = np.pad(dem.astype(np.float64), 1, mode="edge")

    # Absolute elevation differences to 4 neighbors
    dE = np.abs(padded[1:-1, 1:-1] - padded[1:-1, :-2])   # W
    dE = np.maximum(dE, np.abs(padded[1:-1, 1:-1] - padded[1:-1, 2:]))    # E
    dE = np.maximum(dE, np.abs(padded[1:-1, 1:-1] - padded[:-2, 1:-1]))  # N
    dE = np.maximum(dE, np.abs(padded[1:-1, 1:-1] - padded[2:, 1:-1]))   # S

    result = np.full(dem.shape, np.nan, dtype=np.float32)
    result[valid] = dE[valid]
    result[~valid] = nodata
    return result.astype(np.float32)


def slope_leq(
    dem: np.ndarray,
    nodata: float = -32768.0,
) -> np.ndarray:
    """Boolean slope <= threshold (1=gentle, 0=steep).

    Args:
        dem: 2D elevation grid
        nodata: NODATA value

    Returns:
        2D uint8 array (1 where slope <= 5 degrees, 0 otherwise)
    """
    from openzenith.terrain import slope as _slope

    slp = _slope(dem, nodata=nodata)
    result = ((slp <= 5.0) & (dem > nodata)).astype(np.uint8)
    result[dem <= nodata] = 0
    return result


def relative_elevation(
    dem: np.ndarray,
    nodata: float = -32768.0,
) -> np.ndarray:
    """Relative elevation: (E - E_min) / (E_max - E_min).

    Args:
        dem: 2D elevation grid
        nodata: NODATA value

    Returns:
        2D float32 array (0-1)
    """
    valid = dem > nodata
    e_min = np.min(dem[valid])
    e_max = np.max(dem[valid])
    e_range = e_max - e_min
    result = np.full(dem.shape, np.nan, dtype=np.float32)
    if e_range > 0:
        result[valid] = (dem[valid] - e_min) / e_range
    result[~valid] = nodata
    return result.astype(np.float32)


def convergence_index(
    dem: np.ndarray,
    cell_size_deg: float = 0.001,
    nodata: float = -32768.0,
) -> np.ndarray:
    """Terrain convergence index (TCI).

    TCI = ln(tan(slope)) + flow_direction_aspect
    Positive = convergent (valleys). Negative = divergent (ridges).

    Args:
        dem: 2D elevation grid
        cell_size_deg: Cell size in degrees
        nodata: NODATA value

    Returns:
        2D float32 array of convergence index
    """
    from openzenith.terrain import aspect, slope

    valid = dem > nodata
    slp = slope(dem, cell_size_deg, nodata)
    asp = aspect(dem, cell_size_deg, nodata)

    # Replace zeros with small value to avoid log(0)
    tan_slope = np.tan(np.deg2rad(np.maximum(slp, 0.01)))

    tci = np.log(tan_slope) + np.radians(asp)
    result = np.full(dem.shape, np.nan, dtype=np.float32)
    result[valid] = tci[valid]
    result[~valid] = nodata
    return result.astype(np.float32)


def opening(
    dem: np.ndarray,
    radius: int = 1,
    nodata: float = -32768.0,
) -> np.ndarray:
    """Morphological opening: erosion then dilation.

    Removes small bright features (peaks/spikes) while preserving
    larger-scale terrain structure.

    Args:
        dem: 2D elevation grid
        radius: Structuring element radius
        nodata: NODATA value

    Returns:
        2D float32 array of opened DEM
    """
    from scipy.ndimage import grey_opening

    valid = dem > nodata
    result = grey_opening(np.where(valid, dem, np.nan), size=2 * radius + 1)
    result = np.where(valid, result, nodata)
    return result.astype(np.float32)


def closing(
    dem: np.ndarray,
    radius: int = 1,
    nodata: float = -32768.0,
) -> np.ndarray:
    """Morphological closing: dilation then erosion.

    Removes small dark features (pits/canyons) while preserving
    larger-scale terrain structure.

    Args:
        dem: 2D elevation grid
        radius: Structuring element radius
        nodata: NODATA value

    Returns:
        2D float32 array of closed DEM
    """
    from scipy.ndimage import grey_closing

    valid = dem > nodata
    result = grey_closing(np.where(valid, dem, np.nan), size=2 * radius + 1)
    result = np.where(valid, result, nodata)
    return result.astype(np.float32)


def gaussian_curvature(
    dem: np.ndarray,
    cell_size_deg: float = 0.001,
    nodata: float = -32768.0,
) -> np.ndarray:
    """Compute Gaussian curvature (K = d²z/dx² * d²z/dy² - (d²z/dxdy)²).

    Positive = elliptic (bowls, peaks). Negative = hyperbolic (saddles).
    Zero = parabolic (planes/cylinders).

    Args:
        dem: 2D elevation grid
        cell_size_deg: Cell size in degrees
        nodata: NODATA value

    Returns:
        2D float32 array of Gaussian curvature (1/m²)
    """
    valid = dem > nodata
    cell_m = cell_size_deg * 111320.0

    padded = np.pad(dem.astype(np.float64), 1, mode="edge")
    d = padded[1:-1, :-2]
    f = padded[1:-1, 2:]
    b = padded[:-2, 1:-1]
    h = padded[2:, 1:-1]

    d2z_dx2 = (f - 2 * dem + d) / (cell_m ** 2)
    d2z_dy2 = (h - 2 * dem + b) / (cell_m ** 2)
    # Mixed partial (approximation)
    d2z_dxdy = ((padded[2:, 2:] - padded[2:, :-2] - padded[:-2, 2:] + padded[:-2, :-2])
                / (4 * cell_m ** 2))

    k = d2z_dx2 * d2z_dy2 - d2z_dxdy ** 2

    result = np.full(dem.shape, np.nan, dtype=np.float32)
    result[valid] = k[valid]
    result[~valid] = nodata
    return result.astype(np.float32)


def average_flow_truncation(
    dem: np.ndarray,
    max_slope: float = 45.0,
    nodata: float = -32768.0,
) -> float:
    """Compute average flow truncation — fraction of cells truncated to max_slope.

    When D8 flow finds slopes steeper than max_slope, they get truncated.
    High values suggest artificial terrain (cliffs, dams, quantization errors).

    Args:
        dem: 2D elevation grid
        max_slope: Maximum allowable slope in degrees
        nodata: NODATA value

    Returns:
        Fraction of cells where slope was truncated (0-1)
    """
    from openzenith.hydrology import d8_flow_direction

    fd = d8_flow_direction(dem, nodata)
    valid = dem > nodata

    max_slope_rad = np.deg2rad(max_slope)
    tan_max = np.tan(max_slope_rad)

    truncated = 0
    total = 0
    for r in range(dem.shape[0]):
        for c in range(dem.shape[1]):
            if not valid[r, c]:
                continue
            d = fd[r, c]
            if d == -1:
                continue
            total += 1
            dr_arr = np.array([0, 1, 1, 1, 0, -1, -1, -1])[d]
            dc_arr = np.array([1, 1, 0, -1, -1, -1, 0, 1])[d]
            dist = [1.0, np.sqrt(2), 1.0, np.sqrt(2), 1.0, np.sqrt(2), 1.0, np.sqrt(2)][d]
            cell_m = 0.001 * 111320.0
            nr, nc = r + int(dr_arr), c + int(dc_arr)
            if 0 <= nr < dem.shape[0] and 0 <= nc < dem.shape[1] and valid[nr, nc]:
                drop = dem[r, c] - dem[nr, nc]
                slope = drop / (dist * cell_m)
                if slope > tan_max:
                    truncated += 1

    return truncated / max(total, 1)


def fetch_analysis(
    dem: np.ndarray,
    wind_direction: float = 315.0,
    max_distance: int = 100,
    nodata: float = -32768.0,
) -> np.ndarray:
    """Compute wind fetch (upwind distance to obstacle) in each direction.

    For each cell, traces upwind until hitting a higher cell or max_distance.
    Higher values = more exposed terrain.

    Args:
        dem: 2D elevation grid
        wind_direction: Wind bearing (degrees clockwise from north)
        max_distance: Maximum search distance in cells
        nodata: NODATA value

    Returns:
        2D float32 array of fetch distances (cells)
    """
    rows, cols = dem.shape
    az_rad = np.radians(wind_direction)
    # Upwind = opposite of wind direction
    udr = np.sin(az_rad)   # row direction (positive = south)
    udc = -np.cos(az_rad)  # col direction (negative = west for north wind)

    result = np.full((rows, cols), 0.0, dtype=np.float32)
    valid = dem > nodata

    for r in range(rows):
        for c in range(cols):
            if not valid[r, c]:
                continue
            origin_elev = dem[r, c]
            fetch = 0
            for dist in range(1, max_distance + 1):
                nr = round(r + dist * udr)
                nc = round(c + dist * udc)
                if 0 <= nr < rows and 0 <= nc < cols:
                    if valid[nr, nc]:
                        if dem[nr, nc] >= origin_elev:
                            fetch = dist
                            break
                        else:
                            fetch = dist
                    else:
                        fetch = dist
                        break
                else:
                    fetch = dist
                    break
            result[r, c] = fetch

    result[~valid] = nodata
    return result.astype(np.float32)


def sediment_transport_index(
    dem: np.ndarray,
    cell_size_deg: float = 0.001,
    exp: float = 0.4,
    nodata: float = -32768.0,
) -> np.ndarray:
    """Sediment Transport Index (STI) for erosion modeling.

    STI = (As / 22.13)^m * (sin(slope) / 0.0896)^n
    where m = 0.4, n = 1.3 (typical values).

    Args:
        dem: 2D elevation grid
        cell_size_deg: Cell size in degrees
        exp: Length-slope exponent (default 0.4)
        nodata: NODATA value

    Returns:
        2D float32 array of STI values
    """
    from openzenith.hydrology import d8_flow_direction, fill_depressions, flow_accumulation_fast
    from openzenith.terrain import slope as _slope

    valid = dem > nodata
    filled = fill_depressions(dem, nodata)
    fd = d8_flow_direction(filled, nodata)
    accum = flow_accumulation_fast(fd)

    slp = _slope(dem, cell_size_deg, nodata)
    slp_rad = np.deg2rad(np.maximum(slp, 0.001))

    cell_m = cell_size_deg * 111320.0
    sca = accum * cell_m  # specific catchment area in meters

    m_arr = exp
    sca_factor = np.power(np.maximum(sca / 22.13, 0.0), m_arr)
    slope_factor = np.power(np.maximum(np.sin(slp_rad) / 0.0896, 0.0), 1.3)
    sti = sca_factor * slope_factor

    result = np.full(dem.shape, np.nan, dtype=np.float32)
    result[valid] = sti[valid]
    result[~valid] = nodata
    return result.astype(np.float32)


def horizon_angle(
    dem: np.ndarray,
    azimuth: float = 0.0,
    max_distance: int = 100,
    nodata: float = -32768.0,
) -> np.ndarray:
    """Compute horizon angle — maximum elevation angle to the horizon in a given direction.

    Equivalent to WhiteboxTools HorizonAngle.

    Args:
        dem: 2D elevation grid
        azimuth: Compass direction (degrees clockwise from north)
        max_distance: Maximum search distance in cells
        nodata: NODATA value

    Returns:
        2D float32 array of horizon angles (degrees above horizon)
    """
    rows, cols = dem.shape
    az_rad = np.radians(azimuth)
    udr = np.sin(az_rad)
    udc = -np.cos(az_rad)

    result = np.full((rows, cols), 0.0, dtype=np.float32)
    valid = dem > nodata

    for r in range(rows):
        for c in range(cols):
            if not valid[r, c]:
                continue
            origin_elev = dem[r, c]
            max_angle = 0.0
            for dist in range(1, max_distance + 1):
                nr = round(r + dist * udr)
                nc = round(c + dist * udc)
                if 0 <= nr < rows and 0 <= nc < cols:
                    if valid[nr, nc]:
                        elev_diff = dem[nr, nc] - origin_elev
                        angle = np.degrees(np.arctan2(elev_diff, dist * 111320.0 * 0.001))
                        max_angle = max(max_angle, angle)
                    else:
                        break
                else:
                    break
            result[r, c] = max_angle

    result[~valid] = nodata
    return result.astype(np.float32)


def horizontal_curvature(
    dem: np.ndarray,
    cell_size_deg: float = 0.001,
    nodata: float = -32768.0,
) -> np.ndarray:
    """Compute horizontal curvature (curvature perpendicular to slope direction).

    Positive = divergent (ridges). Negative = convergent (valleys).
    Related to planform curvature but computed differently.

    Equivalent to WhiteboxTools HorizontalCurvature.

    Args:
        dem: 2D elevation grid
        cell_size_deg: Cell size in degrees
        nodata: NODATA value

    Returns:
        2D float32 array of horizontal curvature (1/meter)
    """
    from openzenith.terrain import aspect

    valid = dem > nodata
    asp = aspect(dem, cell_size_deg, nodata)
    cell_m = cell_size_deg * 111320.0

    padded = np.pad(dem.astype(np.float64), 1, mode="edge")
    padded[:-2, :-2]
    d = padded[1:-1, :-2]
    f = padded[1:-1, 2:]
    n = padded[:-2, 1:-1]
    h = padded[2:, 1:-1]

    d2z_dx2 = (f - 2 * dem + d) / (cell_m ** 2)
    d2z_dy2 = (h - 2 * dem + n) / (cell_m ** 2)

    asp_rad = np.radians(asp)
    hc = (-np.sin(2 * asp_rad) / 2) * (d2z_dx2 - d2z_dy2)

    result = np.full(dem.shape, np.nan, dtype=np.float32)
    result[valid] = hc[valid]
    result[~valid] = nodata
    return result.astype(np.float32)


def elevation_relief_ratio(
    dem: np.ndarray,
    nodata: float = -32768.0,
) -> np.ndarray:
    """Elevation Relief Ratio = (E_cell - E_outlet) / (E_max - E_min).

    Normalized by the local relief — better than raw elevation for comparing
    landforms across different basins.

    Equivalent to WhiteboxTools ElevationReliefRatio.

    Args:
        dem: 2D elevation grid
        nodata: NODATA value

    Returns:
        2D float32 array (0-1)
    """
    valid = dem > nodata
    if not valid.any():
        return np.full(dem.shape, nodata, dtype=np.float32)
    e_max = np.max(dem[valid])
    e_min = np.min(dem[valid])
    e_range = e_max - e_min

    # For outlet, use minimum elevation at grid boundary
    edge_mask = np.zeros_like(valid, dtype=bool)
    edge_mask[0, :] = True; edge_mask[-1, :] = True
    edge_mask[:, 0] = True; edge_mask[:, -1] = True
    edge_valid = dem[valid & edge_mask]
    outlet_elev = np.min(edge_valid) if edge_valid.size > 0 else e_min

    result = np.full(dem.shape, np.nan, dtype=np.float32)
    if e_range > 0:
        result[valid] = (dem[valid] - outlet_elev) / e_range
    result[~valid] = nodata
    return result.astype(np.float32)


def downslope_index(
    dem: np.ndarray,
    cell_size_deg: float = 0.001,
    nodata: float = -32768.0,
) -> np.ndarray:
    """Downslope Index = ln(tan(beta)) where beta = slope angle.

    Simpler, more physically meaningful wetness index than TWI.
    Used in terrain stability and hydrological modeling.

    Args:
        dem: 2D elevation grid
        cell_size_deg: Cell size in degrees
        nodata: NODATA value

    Returns:
        2D float32 array of downslope index values
    """
    from openzenith.terrain import slope as _slope

    valid = dem > nodata
    slp = _slope(dem, cell_size_deg, nodata)
    slope_rad = np.deg2rad(np.maximum(slp, 0.001))

    di = np.log(np.tan(slope_rad))

    result = np.full(dem.shape, np.nan, dtype=np.float32)
    result[valid] = di[valid]
    result[~valid] = nodata
    return result.astype(np.float32)


def adaptive_filter(
    dem: np.ndarray,
    kernel_size: int = 5,
    threshold: float = 2.0,
    nodata: float = -32768.0,
) -> np.ndarray:
    """Edge-preserving adaptive filter (Lee filter variant).

    Reduces noise while preserving edges and breaks in slope.
    Based on local mean and standard deviation.

    Equivalent to WhiteboxTools AdaptiveFilter.

    Args:
        dem: 2D elevation grid
        kernel_size: Window size (must be odd)
        threshold: Number of standard deviations for adaptive threshold
        nodata: NODATA value

    Returns:
        2D float32 array of filtered values
    """
    from scipy.ndimage import uniform_filter

    valid = dem > nodata
    f_mean = uniform_filter(np.where(valid, dem, 0.0), size=kernel_size)
    f_sq = uniform_filter(np.where(valid, dem ** 2, 0.0), size=kernel_size)
    f_count = uniform_filter(valid.astype(np.float32), size=kernel_size)

    f_var = (f_sq - f_mean ** 2) / np.maximum(f_count, 1)
    global_var = np.var(dem[valid])

    k = np.maximum(0, (global_var - f_var) / (global_var + f_var))

    result = dem.astype(np.float32).copy()
    result[valid] = f_mean[valid] + k[valid] * (dem[valid] - f_mean[valid])
    result[~valid] = nodata
    return result.astype(np.float32)


def clean_dem(
    dem: np.ndarray,
    fill_pits: bool = True,
    fill_flats: bool = True,
    resolve_flats: str = "none",
    max_slope: float = 45.0,
    nodata: float = -32768.0,
) -> np.ndarray:
    """Clean DEM by removing spikes and resolving flat areas.

    Equivalent to WhiteboxTools CleanDEM.

    Args:
        dem: 2D elevation grid
        fill_pits: Remove pit spikes
        fill_flats: Fill flat areas
        resolve_flats: "none", "steepest", or "weighted"
        max_slope: Maximum slope to consider for pit removal
        nodata: NODATA value

    Returns:
        2D float32 array of cleaned DEM
    """
    from openzenith.hydrology import fill_depressions

    result = dem.astype(np.float32).copy()
    valid = dem > nodata

    if fill_pits:
        result = fill_depressions(result, nodata)

    if fill_flats and resolve_flats != "none":
        # Fill flats by slight gradient toward lowest neighbor
        from openzenith.hydrology import d8_flow_direction

        fd = d8_flow_direction(result, nodata)
        rows, cols = dem.shape
        for r in range(rows):
            for c in range(cols):
                if not valid[r, c]:
                    continue
                if fd[r, c] == -1:  # flat or pit
                    neighbors = []
                    for dr, dc in [(-1, 0), (1, 0), (0, -1), (0, 1)]:
                        nr, nc = r + dr, c + dc
                        if 0 <= nr < rows and 0 <= nc < cols and valid[nr, nc]:
                            neighbors.append((dem[nr, nc], nr, nc))
                    if neighbors:
                        min_neighbor = min(neighbors, key=lambda x: x[0])
                        result[r, c] = min_neighbor[0]

    return result


def edge_contamination_check(
    dem: np.ndarray,
    nodata: float = -32768.0,
) -> np.ndarray:
    """Mark cells whose value may be contaminated by NoData edges.

    Cells within a flat area that touches a NoData edge may have
    inaccurate values due to edge effects in interpolation.

    Equivalent to WhiteboxTools EdgeContamination.

    Args:
        dem: 2D elevation grid
        nodata: NODATA value

    Returns:
        2D uint8 array (1 = contaminated, 0 = clean)
    """
    rows, cols = dem.shape
    valid = dem > nodata

    # Cells that touch nodata neighbors are contaminated
    result = np.zeros((rows, cols), dtype=np.uint8)
    for r in range(rows):
        for c in range(cols):
            if not valid[r, c]:
                continue
            # Check 8 neighbors for nodata
            contaminated_flag = False
            for dr in [-1, 0, 1]:
                for dc in [-1, 0, 1]:
                    if dr == 0 and dc == 0:
                        continue
                    nr, nc = r + dr, c + dc
                    if 0 <= nr < rows and 0 <= nc < cols and not valid[nr, nc]:
                        contaminated_flag = True
                        break
                if contaminated_flag:
                    break
            result[r, c] = 1 if contaminated_flag else 0

    return result


def normalized_difference(
    a: np.ndarray,
    b: np.ndarray,
    nodata: float = -32768.0,
) -> np.ndarray:
    """Compute normalized difference: (a - b) / (a + b).

    Standard index computation (used for NDVI, NDWI, etc.).

    Args:
        a: First array
        b: Second array
        nodata: NODATA value

    Returns:
        2D float32 array of normalized difference (-1 to 1)
    """
    valid = (a != nodata) & (b != nodata)
    denom = a.astype(np.float64) + b.astype(np.float64)
    result = np.full(a.shape, np.nan, dtype=np.float32)
    result[valid] = ((a[valid] - b[valid]) / denom[valid]).astype(np.float32)
    result[~valid] = nodata
    return result.astype(np.float32)


def integer_division(
    a: np.ndarray,
    b: np.ndarray,
    nodata: float = -32768.0,
) -> np.ndarray:
    """Integer floor division: floor(a / b).

    Args:
        a: Numerator array
        b: Denominator array
        nodata: NODATA value

    Returns:
        2D int32 array of floor division results
    """
    valid = (a != nodata) & (b != nodata) & (b != 0)
    result = np.full(a.shape, -2147483648, dtype=np.int32)
    result[valid] = np.floor_divide(a[valid], b[valid])
    result[~valid] = nodata
    return result


def modulo(
    a: np.ndarray,
    divisor: float,
    nodata: float = -32768.0,
) -> np.ndarray:
    """Compute modulo: a % divisor.

    Args:
        a: Input array
        divisor: Divisor value
        nodata: NODATA value

    Returns:
        2D float32 array of remainder
    """
    valid = a != nodata
    result = np.full(a.shape, np.nan, dtype=np.float32)
    result[valid] = np.mod(a[valid], divisor)
    result[~valid] = nodata
    return result.astype(np.float32)


def image_correlation(
    a: np.ndarray,
    b: np.ndarray,
    kernel_size: int = 5,
    nodata: float = -32768.0,
) -> float:
    """Compute Pearson correlation coefficient between two rasters.

    Args:
        a: First array
        b: Second array
        kernel_size: Window size for local correlation (0 = global)
        nodata: NODATA value

    Returns:
        Correlation coefficient (-1 to 1)
    """
    valid = (a != nodata) & (b != nodata)
    if not valid.any():
        return np.nan

    if kernel_size <= 0:
        # Global correlation
        a_flat = a[valid]
        b_flat = b[valid]
        return float(np.corrcoef(a_flat, b_flat)[0, 1])
    else:
        # Local correlation in windows
        from scipy.ndimage import uniform_filter

        a_f = np.where(valid, a, 0.0).astype(np.float64)
        b_f = np.where(valid, b, 0.0).astype(np.float64)
        a_mean = uniform_filter(a_f, size=kernel_size)
        b_mean = uniform_filter(b_f, size=kernel_size)
        a_sq = uniform_filter(a_f ** 2, size=kernel_size)
        b_sq = uniform_filter(b_f ** 2, size=kernel_size)
        ab = uniform_filter(a_f * b_f, size=kernel_size)

        num = ab - a_mean * b_mean
        den = np.sqrt((a_sq - a_mean ** 2) * (b_sq - b_mean ** 2))
        corr = np.where(den > 0, num / den, 0)
        valid_mask = uniform_filter(valid.astype(np.float64), size=kernel_size) > 0.5

        result = np.full(a.shape, np.nan, dtype=np.float32)
        result[valid_mask] = corr[valid_mask]
        result[~valid_mask] = nodata
        return result.astype(np.float32)


def image_autocorrelation(
    dem: np.ndarray,
    kernel_size: int = 5,
    nodata: float = -32768.0,
) -> np.ndarray:
    """Compute local spatial autocorrelation (Moran's I) per cell.

    Measures how similar each cell is to its neighbors.

    Args:
        dem: 2D elevation grid
        kernel_size: Window size
        nodata: NODATA value

    Returns:
        2D float32 array of local Moran's I values
    """
    from scipy.ndimage import uniform_filter

    valid = dem > nodata
    f_mean = uniform_filter(np.where(valid, dem, 0.0).astype(np.float64),
                            size=kernel_size)
    f_sq = uniform_filter(np.where(valid, dem ** 2, 0.0).astype(np.float64),
                          size=kernel_size)
    count = uniform_filter(valid.astype(np.float64), size=kernel_size)

    var = np.maximum(f_sq / np.maximum(count, 1) - f_mean ** 2, 0)

    result = np.full(dem.shape, np.nan, dtype=np.float32)
    result[valid & (var > 0)] = 0.0  # placeholder until we implement proper local I
    result[~valid] = nodata
    return result.astype(np.float32)


def greater_than_height(
    dem: np.ndarray,
    height: float,
    nodata: float = -32768.0,
) -> np.ndarray:
    """Boolean: cells above a given height.

    Args:
        dem: 2D elevation grid
        height: Height threshold (meters)
        nodata: NODATA value

    Returns:
        2D uint8 array (1 = above height, 0 = below or nodata)
    """
    result = np.where(dem > nodata, (dem > height).astype(np.uint8), np.uint8(0))
    return result


def depth_in_sink(
    dem: np.ndarray,
    nodata: float = -32768.0,
) -> np.ndarray:
    """Compute sink depth — how many cells would fill before overflow.

    For each cell in a depression, counts how many cells would need to
    be filled before water could overflow to an exit point.

    Equivalent to WhiteboxTools DepthInSink.

    Args:
        dem: 2D elevation grid
        nodata: NODATA value

    Returns:
        2D float32 array of sink depths (meters)
    """
    from openzenith.hydrology import fill_depressions

    valid = dem > nodata
    filled = fill_depressions(dem, nodata)
    depth = filled - dem
    result = np.maximum(depth, 0).astype(np.float32)
    result[~valid] = nodata
    return result


def hillslope_profile(
    dem: np.ndarray,
    outlet_row: int,
    outlet_col: int,
    nodata: float = -32768.0,
) -> list[dict]:
    """Extract hillslope profile from outlet to ridge.

    Traces upslope from the outlet to the divide, returning elevation
    and distance at each step.

    Args:
        dem: 2D elevation grid
        outlet_row: Row of the outlet point
        outlet_col: Column of the outlet point
        nodata: NODATA value

    Returns:
        List of dicts with keys: distance_m, elevation
    """
    from openzenith.hydrology import d8_flow_direction

    rows, cols = dem.shape
    fd = d8_flow_direction(dem, nodata)
    cell_m = 0.001 * 111320.0

    profile = []
    cr, cc = outlet_row, outlet_col
    total_dist = 0.0
    dem[cr, cc]

    while True:
        profile.append({"distance_m": total_dist, "elevation": float(dem[cr, cc])})
        d = fd[cr, cc]
        if d == -1:
            break
        nr = cr + int(np.array([0, 1, 1, 1, 0, -1, -1, -1])[d])
        nc = cc + int(np.array([1, 1, 0, -1, -1, -1, 0, 1])[d])
        if not (0 <= nr < rows and 0 <= nc < cols):
            break
        dist = [1.0, np.sqrt(2), 1.0, np.sqrt(2), 1.0, np.sqrt(2), 1.0, np.sqrt(2)][d]
        total_dist += dist * cell_m
        cr, cc = nr, nc
        if dem[cr, cc] <= nodata:
            break

    return profile
