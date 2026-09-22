"""Raster algebra and image statistics.

Conditional selection, clipping, masking, and reclassification of rasters,
band math (normalized difference, integer division, modulo), and
correlation/autocorrelation statistics between rasters.

This module was split out of the former single-module ``openzenith.terrain``;
the package ``__init__`` re-exports the unchanged public surface.
"""

import numpy as np


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

    for i, (low, high) in enumerate(
        zip([float("-inf"), *thresholds[:-1]], thresholds, strict=False)
    ):
        mask = valid & (dem >= low) & (dem < high)
        result[mask] = values[i]

    # Anything above the last threshold
    if len(thresholds) > 0:
        mask = valid & (dem >= thresholds[-1])
        result[mask] = values[-1]

    return result


# ─── WhiteboxTools Parity Functions ───────────────────────────────────────────────


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
        a_sq = uniform_filter(a_f**2, size=kernel_size)
        b_sq = uniform_filter(b_f**2, size=kernel_size)
        ab = uniform_filter(a_f * b_f, size=kernel_size)

        num = ab - a_mean * b_mean
        den = np.sqrt((a_sq - a_mean**2) * (b_sq - b_mean**2))
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
    f_mean = uniform_filter(np.where(valid, dem, 0.0).astype(np.float64), size=kernel_size)
    f_sq = uniform_filter(np.where(valid, dem**2, 0.0).astype(np.float64), size=kernel_size)
    count = uniform_filter(valid.astype(np.float64), size=kernel_size)

    var = np.maximum(f_sq / np.maximum(count, 1) - f_mean**2, 0)

    result = np.full(dem.shape, np.nan, dtype=np.float32)
    result[valid & (var > 0)] = 0.0  # placeholder until we implement proper local I
    result[~valid] = nodata
    return result.astype(np.float32)
