"""Focal statistics, morphological operations, and DEM filters.

Neighborhood (focal) statistics — TPI, roughness, TRI and the highland
max/min range — rank and statistical filters (min/max/mean/median/majority/
percentile/adaptive), morphological opening and closing, connected-component
clump/sieve, and edge-preserving DEM smoothing (Kuwahara-style smoothing,
off-terrain object removal).

This module was split out of the former single-module ``openzenith.terrain``;
the package ``__init__`` re-exports the unchanged public surface.
"""

import numpy as np


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
    counts = uniform_filter(
        (int_dem == int_dem[:, :, np.newaxis]).astype(np.float32), size=kernel_size
    )
    # Find the mode value for each cell
    result = np.zeros_like(dem, dtype=dem.dtype)
    for val in np.unique(int_dem[valid]):
        mask = (counts > counts.max(axis=2, keepdims=True))[:, :, 0] & (int_dem == val)
        result[mask] = val
    return result


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
    f_sq = uniform_filter(np.where(valid, dem**2, 0.0), size=kernel_size)
    f_count = uniform_filter(valid.astype(np.float32), size=kernel_size)

    f_var = (f_sq - f_mean**2) / np.maximum(f_count, 1)
    global_var = np.var(dem[valid])

    # Zero-variance terrain would make this 0/0; a constant neighbourhood is
    # perfectly preserved by k=0, so fall back to that instead of NaN.
    denom = global_var + f_var
    with np.errstate(invalid="ignore", divide="ignore"):
        k = np.where(denom > 0, np.maximum(0, (global_var - f_var) / denom), 0.0)

    result = dem.astype(np.float32).copy()
    result[valid] = f_mean[valid] + k[valid] * (dem[valid] - f_mean[valid])
    result[~valid] = nodata
    return result.astype(np.float32)


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
    ranked = rank_filter(
        np.where(valid, dem, 0).astype(np.float32),
        rank=kernel_size * kernel_size // 2,
        size=kernel_size,
        mode="constant",
        cval=0,
    )
    # Count total valid in window for percentile
    valid_count = rank_filter(
        valid.astype(np.float32), rank=0, size=kernel_size, mode="constant", cval=0
    )
    result = ranked / np.maximum(valid_count, 1)
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
            # Find an adjacent region — scan all 8 neighbours, since the
            # 4-connected labelling above means a different valid feature can
            # only ever touch this one diagonally.
            for r, c in zip(*np.where(mask), strict=False):
                neighbours = [
                    (-1, -1),
                    (-1, 0),
                    (-1, 1),
                    (0, -1),
                    (0, 1),
                    (1, -1),
                    (1, 0),
                    (1, 1),
                ]
                for dr, dc in neighbours:
                    nr, nc = r + dr, c + dc
                    if 0 <= nr < dem.shape[0] and 0 <= nc < dem.shape[1]:
                        neighbor_label = labeled[nr, nc]
                        if neighbor_label > 0 and neighbor_label != feat_id:
                            result[r, c] = dem[nr, nc]
                            break
    return result


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

    # Pad one cell beyond the window half so the local 3×3 range around the
    # outermost window points still has valid neighbours to read.
    padded = np.pad(dem.astype(np.float64), half + 1, mode="edge")

    for r in range(rows):
        for c in range(cols):
            if dem[r, c] <= nodata:
                continue

            # Collect window and compute range-weighted mean
            window_vals = []
            window_ranges = []

            for wr in range(filter_size):
                for wc in range(filter_size):
                    pr = r + wr + 1
                    pc = c + wc + 1
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
                smoothed[r, c] = (
                    sum(w * v for w, v in zip(weights, window_vals, strict=False)) / total_weight
                )

    return smoothed.astype(np.float32)


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
    padded = np.pad(dem, 1, mode="constant", constant_values=np.nan)

    # Vectorized: stack all 8 neighbors into (8, rows, cols) in one shot
    # Row-major iteration over (-1,0,1) x (-1,0,1), skipping (0,0)
    patches = np.stack(
        [
            padded[0:rows, 0:cols],  # NW
            padded[0:rows, 1 : cols + 1],  # N
            padded[0:rows, 2 : cols + 2],  # NE
            padded[1 : rows + 1, 0:cols],  # W
            padded[1 : rows + 1, 2 : cols + 2],  # E
            padded[2 : rows + 2, 0:cols],  # SW
            padded[2 : rows + 2, 1 : cols + 1],  # S
            padded[2 : rows + 2, 2 : cols + 2],  # SE
        ],
        axis=0,
    )
    neighbor_mean = np.mean(patches, axis=0)
    result = dem.astype(np.float64) - neighbor_mean

    valid = padded[1:-1, 1:-1] != nodata
    result[~valid] = np.nan

    return result.astype(np.float32)


def roughness(
    dem: np.ndarray, cell_size_deg: float = 0.001, nodata: float = -32768.0
) -> np.ndarray:
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
    padded = np.pad(dem, 1, mode="constant", constant_values=nodata)

    # Stack all 9 cells of the 3×3 window into (9, rows, cols) — center included
    patches = np.stack(
        [
            padded[0:rows, 0:cols],  # NW
            padded[0:rows, 1 : cols + 1],  # N
            padded[0:rows, 2 : cols + 2],  # NE
            padded[1 : rows + 1, 0:cols],  # W
            padded[1 : rows + 1, 1 : cols + 1],  # center
            padded[1 : rows + 1, 2 : cols + 2],  # E
            padded[2 : rows + 2, 0:cols],  # SW
            padded[2 : rows + 2, 1 : cols + 1],  # S
            padded[2 : rows + 2, 2 : cols + 2],  # SE
        ],
        axis=0,
    )
    result = np.max(patches, axis=0) - np.min(patches, axis=0)

    valid = padded[1:-1, 1:-1] != nodata
    result[~valid] = np.nan

    return result.astype(np.float32)


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
    padded = np.pad(dem, 1, mode="constant", constant_values=np.nan)
    center = padded[1:-1, 1:-1].astype(np.float64)

    # Stack 8 neighbors (skipping center) into (8, rows, cols) — vectorized
    patches = np.stack(
        [
            padded[0:rows, 0:cols],  # NW
            padded[0:rows, 1 : cols + 1],  # N
            padded[0:rows, 2 : cols + 2],  # NE
            padded[1 : rows + 1, 0:cols],  # W
            padded[1 : rows + 1, 2 : cols + 2],  # E
            padded[2 : rows + 2, 0:cols],  # SW
            padded[2 : rows + 2, 1 : cols + 1],  # S
            padded[2 : rows + 2, 2 : cols + 2],  # SE
        ],
        axis=0,
    )
    result = np.mean(np.abs(center - patches), axis=0)

    valid = padded[1:-1, 1:-1] != nodata
    result[~valid] = np.nan

    return result.astype(np.float32)


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

    filtered = generic_filter(
        np.where(valid, dem, nodata), _range, size=3, mode="constant", cval=nodata
    )
    result[valid] = filtered[valid]
    result[~valid] = nodata
    return result.astype(np.float32)
