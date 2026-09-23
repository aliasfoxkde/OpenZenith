"""Slope, aspect, and curvature derivatives.

First- and second-order terrain derivatives computed from a DEM grid: slope
(Horn's method and a fast finite-difference variant), aspect, combined
aspect/slope, mean/profile/planform/tangent/total/Gaussian/horizontal
curvature, plus convergence index, edge density, and downslope index.

This module was split out of the former single-module ``openzenith.terrain``;
the package ``__init__`` re-exports the unchanged public surface.
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
    cell_x = (
        cell_size_deg
        * 111320.0
        * np.cos(np.radians(np.nanmean(dem[valid_mask]) if np.any(valid_mask) else 0.0))
    )

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
    nodata_mask = (
        (a <= nodata)
        | (b <= nodata)
        | (c <= nodata)
        | (d <= nodata)
        | (f <= nodata)
        | (g <= nodata)
        | (h <= nodata)
        | (i <= nodata)
    )

    # Horn's method: weighted average of 4 3×3 neighborhoods
    # x-direction (EW): (c + 2f + i) - (a + 2d + g) / 8*cell_x
    # y-direction (NS): (a + 2b + c) - (g + 2h + i) / 8*cell_y
    dz_dx = ((c + 2 * f + i) - (a + 2 * d + g)) / (8 * cell_x)
    dz_dy = ((a + 2 * b + c) - (g + 2 * h + i)) / (8 * cell_y)

    result = np.degrees(np.arctan(np.sqrt(dz_dx**2 + dz_dy**2)))
    result[nodata_mask | ~valid_mask] = np.nan

    return result.astype(np.float32)


def slope_fast(
    dem: np.ndarray, cell_size_deg: float = 0.001, nodata: float = -32768.0
) -> np.ndarray:
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
    cell_x = (
        cell_size_deg
        * 111320.0
        * np.cos(np.radians(np.nanmean(dem[dem > nodata]) if np.any(dem > nodata) else 0.0))
    )

    valid = dem > nodata
    padded = np.pad(dem.astype(np.float64), 1, mode="edge")

    dz_dx = (padded[1:-1, 2:] - padded[1:-1, :-2]) / (2 * cell_x)
    dz_dy = (padded[2:, 1:-1] - padded[:-2, 1:-1]) / (2 * cell_y)

    result = np.degrees(np.arctan(np.sqrt(dz_dx**2 + dz_dy**2)))
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
    cell_x = (
        cell_size_deg
        * 111320.0
        * np.cos(np.radians(np.nanmean(dem[dem > nodata]) if np.any(dem > nodata) else 0.0))
    )

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
    cell_x = (
        cell_size_deg
        * 111320.0
        * np.cos(np.radians(np.nanmean(dem[valid]) if np.any(valid) else 0.0))
    )

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

    slope_rad = np.arctan(np.sqrt(dz_dx**2 + dz_dy**2))
    slope_deg = np.degrees(slope_rad)

    # NOTE: this function's dz_dy is north-positive (a..c rows are north),
    # unlike aspect() whose dz_dy is south-positive — so no negation here.
    # atan2 over (dz_dy, dz_dx) + the compass conversion yields the downslope
    # direction: a north-rising slope faces south (180).
    aspect_rad = np.arctan2(dz_dy, dz_dx)
    aspect_deg = (90 - np.degrees(aspect_rad) + 180) % 360

    flat = (np.abs(dz_dx) < 1e-10) & (np.abs(dz_dy) < 1e-10)
    aspect_deg[flat | ~valid] = np.nan
    slope_deg[~valid] = np.nan

    return aspect_deg.astype(np.float32), slope_deg.astype(np.float32)


def curvature(
    dem: np.ndarray, cell_size_deg: float = 0.001, nodata: float = -32768.0
) -> np.ndarray:
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
    padded = np.pad(dem, 1, mode="constant", constant_values=np.nan)

    z = padded[1:-1, 1:-1].astype(np.float64)
    d2z_dx2 = (padded[1:-1, 2:] - 2 * z + padded[1:-1, :-2]) / (cell_m**2)
    d2z_dy2 = (padded[2:, 1:-1] - 2 * z + padded[:-2, 1:-1]) / (cell_m**2)

    result = (d2z_dx2 + d2z_dy2) / 2.0

    valid = padded[1:-1, 1:-1] != nodata
    result[~valid] = np.nan

    return result.astype(np.float32)


def profile_curvature(
    dem: np.ndarray, cell_size_deg: float = 0.001, nodata: float = -32768.0
) -> np.ndarray:
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
    padded = np.pad(dem.astype(np.float64), 1, mode="constant", constant_values=np.nan)
    z = padded[1:-1, 1:-1]

    # First derivatives (Horn's 3x3 weighted)
    dz_dx = (
        padded[2:, 2:]
        + 2 * padded[1:-1, 2:]
        + padded[:-2, 2:]
        - padded[2:, :-2]
        - 2 * padded[1:-1, :-2]
        - padded[:-2, :-2]
    ) / (8 * cell_m)
    dz_dy = (
        padded[:-2, 2:]
        + 2 * padded[:-2, 1:-1]
        + padded[:-2, :-2]
        - padded[2:, 2:]
        - 2 * padded[2:, 1:-1]
        - padded[2:, :-2]
    ) / (8 * cell_m)

    # Second derivatives
    d2z_dx2 = (padded[1:-1, 2:] - 2 * z + padded[1:-1, :-2]) / (cell_m**2)
    d2z_dy2 = (padded[2:, 1:-1] - 2 * z + padded[:-2, 1:-1]) / (cell_m**2)
    d2z_dxdy = (padded[2:, 2:] - padded[2:, :-2] - padded[:-2, 2:] + padded[:-2, :-2]) / (
        4 * cell_m**2
    )

    p = dz_dx**2 + dz_dy**2
    p = np.where(p < 1e-10, 1e-10, p)  # avoid division by zero
    q = p + 1.0

    result = -(d2z_dx2 * dz_dx**2 + 2 * d2z_dxdy * dz_dx * dz_dy + d2z_dy2 * dz_dy**2) / (
        p * np.sqrt(q)
    )
    valid = padded[1:-1, 1:-1] != nodata
    result[~valid] = np.nan
    return result.astype(np.float32)


def planform_curvature(
    dem: np.ndarray, cell_size_deg: float = 0.001, nodata: float = -32768.0
) -> np.ndarray:
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
    padded = np.pad(dem.astype(np.float64), 1, mode="constant", constant_values=np.nan)
    z = padded[1:-1, 1:-1]

    dz_dx = (
        padded[2:, 2:]
        + 2 * padded[1:-1, 2:]
        + padded[:-2, 2:]
        - padded[2:, :-2]
        - 2 * padded[1:-1, :-2]
        - padded[:-2, :-2]
    ) / (8 * cell_m)
    dz_dy = (
        padded[:-2, 2:]
        + 2 * padded[:-2, 1:-1]
        + padded[:-2, :-2]
        - padded[2:, 2:]
        - 2 * padded[2:, 1:-1]
        - padded[2:, :-2]
    ) / (8 * cell_m)

    d2z_dx2 = (padded[1:-1, 2:] - 2 * z + padded[1:-1, :-2]) / (cell_m**2)
    d2z_dy2 = (padded[2:, 1:-1] - 2 * z + padded[:-2, 1:-1]) / (cell_m**2)
    d2z_dxdy = (padded[2:, 2:] - padded[2:, :-2] - padded[:-2, 2:] + padded[:-2, :-2]) / (
        4 * cell_m**2
    )

    p = dz_dx**2 + dz_dy**2
    p = np.where(p < 1e-10, 1e-10, p)
    q = p + 1.0

    result = (d2z_dx2 * dz_dy**2 - 2 * d2z_dxdy * dz_dx * dz_dy + d2z_dy2 * dz_dx**2) / (
        p * np.sqrt(q)
    )
    valid = padded[1:-1, 1:-1] != nodata
    result[~valid] = np.nan
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

    tc = (
        cos_slope**2 * sin_asp**2 * d2z_dx2
        + sin_slope**2 * cos_asp**2 * d2z_dy2
        + np.sin(2 * azm_rad) * np.sin(2 * slope_rad) / 4 * (d2z_dx2 - d2z_dy2)
    )

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

    d2z_dx2 = (f - 2 * dem + d) / (cell_m**2)
    d2z_dy2 = (h - 2 * dem + b) / (cell_m**2)

    tc = d2z_dx2 + d2z_dy2

    result = np.full(dem.shape, np.nan, dtype=np.float32)
    result[valid] = tc[valid]
    result[~valid] = nodata
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

    d2z_dx2 = (f - 2 * dem + d) / (cell_m**2)
    d2z_dy2 = (h - 2 * dem + b) / (cell_m**2)
    # Mixed partial (approximation)
    d2z_dxdy = (padded[2:, 2:] - padded[2:, :-2] - padded[:-2, 2:] + padded[:-2, :-2]) / (
        4 * cell_m**2
    )

    k = d2z_dx2 * d2z_dy2 - d2z_dxdy**2

    result = np.full(dem.shape, np.nan, dtype=np.float32)
    result[valid] = k[valid]
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
    valid = dem > nodata
    asp = aspect(dem, cell_size_deg, nodata)
    cell_m = cell_size_deg * 111320.0

    padded = np.pad(dem.astype(np.float64), 1, mode="edge")
    padded[:-2, :-2]
    d = padded[1:-1, :-2]
    f = padded[1:-1, 2:]
    n = padded[:-2, 1:-1]
    h = padded[2:, 1:-1]

    d2z_dx2 = (f - 2 * dem + d) / (cell_m**2)
    d2z_dy2 = (h - 2 * dem + n) / (cell_m**2)

    asp_rad = np.radians(asp)
    hc = (-np.sin(2 * asp_rad) / 2) * (d2z_dx2 - d2z_dy2)

    result = np.full(dem.shape, np.nan, dtype=np.float32)
    result[valid] = hc[valid]
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
    dE = np.abs(padded[1:-1, 1:-1] - padded[1:-1, :-2])  # W
    dE = np.maximum(dE, np.abs(padded[1:-1, 1:-1] - padded[1:-1, 2:]))  # E
    dE = np.maximum(dE, np.abs(padded[1:-1, 1:-1] - padded[:-2, 1:-1]))  # N
    dE = np.maximum(dE, np.abs(padded[1:-1, 1:-1] - padded[2:, 1:-1]))  # S

    result = np.full(dem.shape, np.nan, dtype=np.float32)
    result[valid] = dE[valid]
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
    valid = dem > nodata
    slp = slope(dem, cell_size_deg, nodata)
    slope_rad = np.deg2rad(np.maximum(slp, 0.001))

    di = np.log(np.tan(slope_rad))

    result = np.full(dem.shape, np.nan, dtype=np.float32)
    result[valid] = di[valid]
    result[~valid] = nodata
    return result.astype(np.float32)
