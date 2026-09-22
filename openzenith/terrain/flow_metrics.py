"""Terrain metrics coupled to flow routing.

Drainage density, flow width, slope-area ratio, specific catchment area,
Hack integral, sediment transport index, average flow truncation, sink
depth, and DEM cleaning — metrics that consume the D8 flow products from
:mod:`openzenith.hydrology`.

This module was split out of the former single-module ``openzenith.terrain``;
the package ``__init__`` re-exports the unchanged public surface.
"""

import numpy as np

from .gradients import slope


def drainage_density(
    flow_accum: np.ndarray, cell_size_deg: float = 0.001, nodata: float = -32768.0
) -> np.ndarray:
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
    cell_area_km2 = cell_km**2
    threshold = np.sqrt(flow_accum.size)
    streams = (flow_accum >= threshold).astype(np.float64)
    streams[flow_accum <= 0] = 0
    streams[np.isnan(flow_accum)] = 0
    # Smooth with 11x11 uniform filter (numpy-only, shape-preserving)
    kernel_size = 11
    pad = kernel_size // 2
    padded = np.pad(streams, pad, mode="reflect")
    # Integral image approach
    cumsum = np.cumsum(np.cumsum(padded, axis=0), axis=1)
    cumsum = np.pad(cumsum, ((1, 0), (1, 0)), mode="constant")  # prepend zeros
    smoothed = (
        cumsum[kernel_size:, kernel_size:]
        - cumsum[:-kernel_size, kernel_size:]
        - cumsum[kernel_size:, :-kernel_size]
        + cumsum[:-kernel_size, :-kernel_size]
    ) / (kernel_size**2)
    # Trim padding to match input shape
    result = smoothed[: flow_accum.shape[0], : flow_accum.shape[1]] / cell_area_km2
    return np.maximum(result, 0).astype(np.float32)


def flow_width(
    dem: np.ndarray, flow_dir: np.ndarray | None = None, nodata: float = -32768.0
) -> np.ndarray:
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

    valid = dem > nodata
    filled = fill_depressions(dem, nodata)
    fd = d8_flow_direction(filled, nodata)
    accum = flow_accumulation_fast(fd)

    slp = slope(dem, cell_size_deg, nodata)
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
