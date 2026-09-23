"""Line of sight, visibility, and directional exposure.

Viewshed computation (vectorized ray casting, with an optional Numba JIT
kernel), cumulative visibility index, sky view factor, horizon angle,
directional relief, wind fetch, and maximum elevation along a bearing.

This module was split out of the former single-module ``openzenith.terrain``;
the package ``__init__`` re-exports the unchanged public surface.
"""

import numpy as np

from .shading import hillshade


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
            dem,
            observer_row,
            observer_col,
            observer_height,
            cell_size_deg,
            nodata,
            max_distance_cells,
        )
    except ImportError:
        pass

    # Vectorized NumPy fallback
    return _viewshed_numpy(
        dem, observer_row, observer_col, observer_height, cell_size_deg, nodata, max_distance_cells
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

    # An observer on NODATA has no usable elevation: nothing is visible.
    # (Matches the numba kernel below so both backends agree.)
    if dem[observer_row, observer_col] <= nodata:
        return visible

    visible[observer_row, observer_col] = True

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
    ray_dr = t_values[np.newaxis, :] * sin_a[:, np.newaxis]  # (n_angles, n_samples)
    ray_dc = t_values[np.newaxis, :] * cos_a[:, np.newaxis]

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
    cell_dist = np.sqrt(cell_dr**2 + cell_dc**2)

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
    except ImportError as err:
        raise ImportError("numba") from err

    @jit(nopython=True, parallel=True)
    def _viewshed_core(
        dem: np.ndarray,
        obs_r: int,
        obs_c: int,
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
                    elev = (
                        e00 * (1 - fr) * (1 - fc)
                        + e01 * (1 - fr) * fc
                        + e10 * fr * (1 - fc)
                        + e11 * fr * fc
                    )

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

    return _viewshed_core(
        dem, observer_row, observer_col, obs_elev, cell_m, nodata, max_distance_cells
    )


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

    for (obs_r, obs_c), obs_h in zip(observer_points, observer_heights, strict=False):
        if 0 <= obs_r < rows and 0 <= obs_c < cols:
            vis = viewshed(dem, obs_r, obs_c, obs_h, cell_size_deg, nodata)
            vis_count[vis] += 1

    return vis_count


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
        shade = hillshade(
            dem, azimuth=float(azimuth), altitude=10.0, cell_size_deg=cell_size_deg, nodata=nodata
        )
        # Convert shade (0-255) to view factor (0-1)
        svf += shade.astype(np.float64) / 255.0
        n_sample += 1

    svf /= n_sample

    # Mark NODATA areas
    valid = dem > nodata
    result = svf.astype(np.float32)
    result[~valid] = np.nan
    return result


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
    dc = np.cos(az_rad)  # col direction (positive = east)

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
    udr = np.sin(az_rad)  # row direction (positive = south)
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
    dr = -np.sin(az_rad)  # row direction (negative = north)
    dc = np.cos(az_rad)  # col direction

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
