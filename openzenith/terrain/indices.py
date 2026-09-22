"""Composite terrain indices and classifications.

Indices that combine several derivatives — multi-scale terrain position
(MSTP), landform classification, curvature classification, hypsometry,
relative elevation, elevation relief ratio, and the Heinardh index — plus
threshold masks (gentle slope, above height, above/below percentage,
deviation from the mean plane) and edge-contamination checking.

This module was split out of the former single-module ``openzenith.terrain``;
the package ``__init__`` re-exports the unchanged public surface.
"""

import numpy as np

from .filters import tpi
from .gradients import curvature, planform_curvature, profile_curvature, slope


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
        (np.abs(p_curv) < 0.0002) & (np.abs(plan_curv) < 0.0002) & (np.abs(tpi_vals) < 2) & valid
    ] = 7

    # Upper slope (TPI > 2, not classified yet)
    result[(tpi_vals > 2) & (result == -1) & valid] = 2

    # Lower slope (TPI < -2, not classified yet)
    result[(tpi_vals < -2) & (result == -1) & valid] = 4

    # Mark NaN cells
    result[any_nan] = -1
    result[~valid] = -1

    return result


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
            elif (pc > planar_thresh and pl > planar_thresh) or pl < -planar_thresh:
                result[r, c] = 2
            elif pl > planar_thresh:
                result[r, c] = 1
            else:
                result[r, c] = 0

    return result


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
    edge_mask[0, :] = True
    edge_mask[-1, :] = True
    edge_mask[:, 0] = True
    edge_mask[:, -1] = True
    edge_valid = dem[valid & edge_mask]
    outlet_elev = np.min(edge_valid) if edge_valid.size > 0 else e_min

    result = np.full(dem.shape, np.nan, dtype=np.float32)
    if e_range > 0:
        result[valid] = (dem[valid] - outlet_elev) / e_range
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
    valid = dem > nodata
    e_min = np.min(dem[valid])
    e_max = np.max(dem[valid])
    e_range = e_max - e_min
    slp = slope(dem, cell_size_deg, nodata)

    result = np.full(dem.shape, np.nan, dtype=np.float32)
    if e_range > 0:
        rel_elev = (dem - e_min) / e_range
        result[valid] = rel_elev[valid] * slp[valid]
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
    slp = slope(dem, nodata=nodata)
    result = ((slp <= 5.0) & (dem > nodata)).astype(np.uint8)
    result[dem <= nodata] = 0
    return result


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
