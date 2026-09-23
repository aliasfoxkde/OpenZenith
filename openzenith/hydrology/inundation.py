"""Flood inundation and depression water storage.

Inundation extent and depth at a given water level, plus depth, volume,
and spill-elevation statistics for each depression.

This module was split out of the former single-module ``openzenith.hydrology``;
the package ``__init__`` re-exports the unchanged public surface.
"""

import numpy as np

from .depressions import fill_depressions


def flood_inundation(
    dem: np.ndarray,
    water_level: float,
    fill_depressions_first: bool = True,
    nodata: float = -32768.0,
) -> np.ndarray:
    """Compute flood inundation extent at a given water level.

    Returns a boolean mask of cells that would be submerged at the
    specified water surface elevation. Optionally fills depressions
    first to model realistic water pooling.

    Args:
        dem: 2D elevation grid (meters)
        water_level: Water surface elevation in meters
        fill_depressions_first: If True, fill depressions before computing
                               inundation (realistic pooling). If False,
                               only cells below water_level are inundation.
        nodata: NODATA value

    Returns:
        2D bool array where True = inundated

    """
    filled = fill_depressions(dem, nodata) if fill_depressions_first else dem

    return (filled < water_level) & (filled > nodata)


def inundation_depth(
    dem: np.ndarray,
    water_level: float,
    fill_depressions_first: bool = True,
    nodata: float = -32768.0,
) -> np.ndarray:
    """Compute flood inundation depth at a given water level.

    Returns the depth of water above each cell (negative = above water).

    Args:
        dem: 2D elevation grid (meters)
        water_level: Water surface elevation in meters
        fill_depressions_first: If True, fill depressions first
        nodata: NODATA value

    Returns:
        2D float32 array of water depth in meters (negative above water)

    """
    filled = fill_depressions(dem, nodata) if fill_depressions_first else dem.astype(np.float32)

    depth = np.full(filled.shape, np.nan, dtype=np.float32)
    valid = filled > nodata
    depth[valid] = water_level - filled[valid]
    depth[depth <= 0] = 0
    return depth


def depression_depth_stats(
    dem: np.ndarray,
    nodata: float = -32768.0,
) -> list[dict]:
    """Compute statistics for each depression in the DEM.

    Uses the fill-depression difference to identify depressions and
    compute their depth, volume, and spill elevation.

    Uses scipy.ndimage.label for fast connected-component labeling.

    Args:
        dem: 2D elevation grid (meters)
        nodata: NODATA value

    Returns:
        List of dicts with keys: 'row', 'col', 'depth_m', 'volume_m3',
        'spill_elev_m', 'area_m2', 'cell_count'

    """
    try:
        from scipy import ndimage
    except ImportError as err:
        raise ImportError(
            "depression_depth_stats requires scipy. Install with: pip install scipy"
        ) from err

    filled = fill_depressions(dem, nodata)
    diff = (filled - dem.astype(np.float64)).astype(np.float32)

    valid = (diff > 0.1) & (dem > nodata)
    if not valid.any():
        return []

    cell_size_deg = 0.001
    cell_m = cell_size_deg * 111320.0
    cell_area_m2 = cell_m * cell_m

    # Label connected components (depressions)
    labeled, num_features = ndimage.label(valid)
    if num_features == 0:
        return []

    depressions = []
    for label_id in range(1, num_features + 1):
        mask = labeled == label_id
        cells_r, cells_c = np.where(mask)

        # Water depth after filling is (filled - dem) per cell; the
        # depression's depth is its maximum and its volume the sum. (Taking
        # max(original) - min(filled) compares different cells' elevations
        # and comes out negative — the pit floor minus the spill rim.)
        fill_vals = filled[mask].astype(np.float64)
        orig_vals = dem[mask].astype(np.float64)
        water_depths = fill_vals - orig_vals
        depth = float(np.max(water_depths))

        # Spill elevation is the minimum filled value (spill point)
        spill_elev = float(np.min(fill_vals))
        cell_count = int(np.sum(mask))
        area = cell_count * cell_area_m2
        volume = float(np.sum(water_depths)) * cell_area_m2

        # Row/col of the spill point (first cell with min filled elevation)
        spill_idx = int(np.argmin(fill_vals))
        spill_row = int(cells_r[spill_idx])
        spill_col = int(cells_c[spill_idx])

        depressions.append(
            {
                "row": spill_row,
                "col": spill_col,
                "depth_m": round(depth, 2),
                "volume_m3": round(volume, 2),
                "spill_elev_m": round(spill_elev, 2),
                "area_m2": round(area, 2),
                "cell_count": cell_count,
            }
        )

    # Sort by depth (deepest first)
    depressions.sort(key=lambda x: x["depth_m"], reverse=True)
    return depressions
