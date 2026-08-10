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

    Uses threshold-based decision tree on TPI, slope, and curvature.

    Args:
        dem: 2D elevation grid (meters)
        cell_size_deg: Cell size in degrees
        nodata: NODATA value

    Returns:
        2D int8 array of landform classes
    """
    from openzenith.terrain import curvature, slope

    rows, cols = dem.shape
    result = np.full((rows, cols), -1, dtype=np.int8)
    valid = dem > nodata

    # Compute derivatives
    slp = slope(dem, cell_size_deg, nodata)
    curv = curvature(dem, cell_size_deg, nodata)
    p_curv = profile_curvature(dem, cell_size_deg, nodata)
    plan_curv = planform_curvature(dem, cell_size_deg, nodata)
    tpi_vals = tpi(dem, cell_size_deg, nodata)

    for r in range(rows):
        for c in range(cols):
            if not valid[r, c]:
                continue

            s = slp[r, c]
            cu = curv[r, c]
            pc = p_curv[r, c]
            pl = plan_curv[r, c]
            tpi_v = tpi_vals[r, c]

            if np.isnan(s) or np.isnan(cu):
                continue

            # Flat areas
            if s < 2:
                result[r, c] = 8  # flat
                continue

            # Depression (pit)
            if tpi_v < -5 and cu < -0.001:
                result[r, c] = 6  # pit
                continue

            # Peak
            if tpi_v > 5 and s > 10 and pc < -0.0005:
                result[r, c] = 0  # peak
                continue

            # Ridge
            if pc < -0.0005 and pl > 0.0005:
                result[r, c] = 1  # ridge
                continue

            # Valley (channel)
            if pc > 0.0005 and pl < -0.0005:
                result[r, c] = 5  # valley
                continue

            # Saddle
            if abs(pc) < 0.0002 and abs(pl) < 0.0002 and abs(tpi_v) < 2:
                result[r, c] = 7  # saddle
                continue

            # Slope position based on TPI
            if tpi_v > 2:
                result[r, c] = 2  # upper slope
            elif tpi_v < -2:
                result[r, c] = 4  # lower slope
            else:
                result[r, c] = 3  # middle slope

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
