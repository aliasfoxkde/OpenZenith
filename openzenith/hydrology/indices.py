"""Wetness and erosion indices.

Stream power index, topographic wetness index, LS factor, and slope-area
ratio — the USLE-family terrain indices.

This module was split out of the former single-module ``openzenith.hydrology``;
the package ``__init__`` re-exports the unchanged public surface.
"""

import numpy as np

from .depressions import fill_depressions
from .flow import d8_flow_direction, flow_accumulation_fast


def stream_power_index(
    dem: np.ndarray,
    flow_accum: np.ndarray | None = None,
    cell_size_deg: float = 0.001,
    nodata: float = -32768.0,
) -> np.ndarray:
    """Compute Stream Power Index (SPI).

    SPI = ln(accum × cell_area × tan(slope))
    where accum is the upslope contributing area in cells.
    High SPI indicates areas with high erosion potential.

    Args:
        dem: 2D elevation grid
        flow_accum: Optional flow accumulation grid. If None, computed from dem.
        cell_size_deg: Cell size in degrees
        nodata: NODATA value

    Returns:
        2D float32 array of SPI values

    """
    from openzenith.terrain import slope as calc_slope

    # Fill depressions for proper flow routing
    filled = fill_depressions(dem, nodata)
    fd = d8_flow_direction(filled, nodata)

    if flow_accum is None:
        flow_accum = flow_accumulation_fast(fd)

    # Slope in radians
    slp = calc_slope(dem, cell_size_deg, nodata)
    slope_rad = np.deg2rad(slp)

    # Cell area in square meters
    cell_m = cell_size_deg * 111320.0
    cell_area = cell_m * cell_m

    # SPI = ln(accum * cell_area * tan(slope))
    accum_m2 = flow_accum.astype(np.float64) * cell_area
    tan_slope = np.tan(slope_rad)

    # Avoid log(0) and tan(0)
    tan_slope = np.maximum(tan_slope, 1e-10)
    accum_m2 = np.maximum(accum_m2, 1e-10)

    spi = np.log(accum_m2 * tan_slope)

    # Mask invalid cells
    valid = (dem != nodata) & (flow_accum > 0)
    result = np.where(valid, spi, np.nan).astype(np.float32)

    return result


def twi(
    dem: np.ndarray,
    cell_size_deg: float = 0.001,
    nodata: float = -32768.0,
) -> np.ndarray:
    """Topographic Wetness Index (TWI).

    TWI = ln(a / tan(β))
    where a = specific catchment area (flow_accumulation × cell_area)
    and β = slope in radians.

    High TWI indicates areas prone to saturation and water accumulation.
    Low TWI indicates well-drained ridges and slopes.

    Args:
        dem: 2D elevation grid
        cell_size_deg: Cell size in degrees
        nodata: NODATA value

    Returns:
        2D float32 array of TWI values. NODATA cells and cells with
        zero slope are set to NaN.

    """
    from openzenith.terrain import slope as calc_slope

    # Fill depressions for proper flow routing
    filled = fill_depressions(dem, nodata)

    # Flow direction and accumulation
    fd = d8_flow_direction(filled, nodata)
    accum = flow_accumulation_fast(fd)

    # Slope in degrees
    slp = calc_slope(dem, cell_size_deg, nodata)

    # Cell area in square meters
    cell_m = cell_size_deg * 111320.0
    cell_area = cell_m * cell_m

    # Specific catchment area
    sca = accum.astype(np.float64) * cell_area

    # TWI = ln(sca / tan(slope_rad))
    # Avoid division by zero: mask slope < 0.1 degrees
    slope_rad = np.deg2rad(slp)
    slope_rad[slope_rad < np.deg2rad(0.1)] = np.nan

    tan_slope = np.tan(slope_rad)
    result = np.log(sca / tan_slope)

    # Mask nodata cells
    valid = dem != nodata
    result[~valid] = np.nan

    # Clip to reasonable range
    result = np.clip(result, 0, 25)

    return result.astype(np.float32)


def ls_factor(
    dem: np.ndarray,
    cell_size_deg: float = 0.001,
    exp: float = 0.4,
    nodata: float = -32768.0,
) -> np.ndarray:
    """Compute LS-factor (length-slope factor) for USLE erosion modeling.

    Combines slope length and steepness into a single factor.
    LS = (m / 22.13)^m * (n / 22.13)^(m+1)
    where m = slope length exponent (function of slope),
          n = local slope (%)
    Uses the Moore et al. formulation.

    Equivalent to WhiteboxTools LSFactor.

    Args:
        dem: 2D elevation grid
        cell_size_deg: Cell size in degrees
        exp: M exponent (default 0.4, typical for SRTM-scale data)
        nodata: NODATA value

    Returns:
        2D float32 array of LS-factor values

    """
    from openzenith.terrain import slope as calc_slope

    valid = dem > nodata
    _rows, _cols = dem.shape

    slp = calc_slope(dem, cell_size_deg, nodata)  # slope in degrees
    slope_pct = np.tan(np.deg2rad(slp)) * 100.0  # slope in percent

    # Flow direction and accumulation
    filled = fill_depressions(dem, nodata)
    fd = d8_flow_direction(filled, nodata)
    accum = flow_accumulation_fast(fd)

    cell_m = cell_size_deg * 111320.0
    sca = accum * cell_m  # specific catchment area in meters

    # M exponent: increases with slope (Moore & Nieber 1989)
    m_arr = np.where(valid, exp * (slope_pct / (slope_pct + 1)), 0.0)

    # LS = (sca / 22.13)^m * (slope_pct / 22.13)^(m+1)
    sca_factor = np.power(np.maximum(sca / 22.13, 0.0), m_arr)
    slope_factor = np.power(np.maximum(slope_pct / 22.13, 0.0), m_arr + 1)
    ls = sca_factor * slope_factor

    ls[~valid] = np.nan
    return ls.astype(np.float32)


def slope_area_ratio(
    dem: np.ndarray,
    cell_size_deg: float = 0.001,
    exp_slope: float = 1.0,
    exp_area: float = 1.0,
    nodata: float = -32768.0,
) -> np.ndarray:
    """Slope-Area Ratio = (slope^exp_slope) / (area^exp_area).

    Higher values = ridges (steep, small catchments).
    Lower values = valleys (gentle, large catchments).

    Equivalent to WhiteboxTools SlopeAreaRatio.

    Args:
        dem: 2D elevation grid
        cell_size_deg: Cell size in degrees
        exp_slope: Slope exponent (default 1.0)
        exp_area: Area exponent (default 1.0)
        nodata: NODATA value

    Returns:
        2D float32 array of slope/area ratio

    """
    from openzenith.terrain import slope as _slope

    filled = fill_depressions(dem, nodata)
    fd = d8_flow_direction(filled, nodata)
    accum = flow_accumulation_fast(fd)
    slp = _slope(dem, cell_size_deg, nodata)

    valid = dem > nodata
    cell_m = cell_size_deg * 111320.0

    area_factor = np.power(np.maximum(accum * cell_m, 1.0), exp_area)
    slope_factor = np.power(np.maximum(slp, 0.001), exp_slope)

    ratio = slope_factor / area_factor

    result = np.full(dem.shape, np.nan, dtype=np.float32)
    result[valid] = ratio[valid]
    result[~valid] = nodata
    return result.astype(np.float32)
