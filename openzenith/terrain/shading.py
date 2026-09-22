"""Analytical hillshading and color relief.

Illumination-based rendering of a DEM: single-source hillshade,
multi-directional hillshade composite, hillshade differencing, and
hypsometric color relief.

This module was split out of the former single-module ``openzenith.terrain``;
the package ``__init__`` re-exports the unchanged public surface.
"""

import numpy as np

from .gradients import aspect, slope_fast


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
    shade = np.cos(alt_rad) * np.cos(sl_rad) + np.sin(alt_rad) * np.sin(sl_rad) * np.cos(
        az_rad - asp_rad
    )
    shade = np.clip(shade * z_factor, 0, 1)

    # Mark NODATA areas as 0
    shade[dem <= nodata] = 0

    return (shade * 255).astype(np.uint8)


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
        (0, 45),  # N
        (45, 45),  # NE
        (270, 35),  # W
        (90, 35),  # E
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
    shade1 = hillshade(
        dem, azimuth=azimuth1, altitude=altitude1, cell_size_deg=cell_size_deg, nodata=nodata
    )
    shade2 = hillshade(
        dem, azimuth=azimuth2, altitude=altitude2, cell_size_deg=cell_size_deg, nodata=nodata
    )
    diff = shade1.astype(np.float32) - shade2.astype(np.float32)
    result = np.where(dem > nodata, diff, nodata)
    return result.astype(np.float32)


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
        t = np.ones_like(vals) if hi == lo else np.clip((vals - lo) / (hi - lo), 0.0, 1.0)

        mask = (
            valid & (vals >= lo) & (vals <= hi) if i < len(elevations) - 2 else valid & (vals >= lo)
        )
        c0, c1 = colors_rgb[i], colors_rgb[i + 1]
        r_ch[mask] = c0[0] + (c1[0] - c0[0]) * t[mask]
        g_ch[mask] = c0[1] + (c1[1] - c0[1]) * t[mask]
        b_ch[mask] = c0[2] + (c1[2] - c0[2]) * t[mask]

    result[:, :, 0] = np.clip(r_ch, 0, 255).astype(np.uint8)
    result[:, :, 1] = np.clip(g_ch, 0, 255).astype(np.uint8)
    result[:, :, 2] = np.clip(b_ch, 0, 255).astype(np.uint8)
    result[:, :, 3] = np.where(valid, 255, 0).astype(np.uint8)

    return result
