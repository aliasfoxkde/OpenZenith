"""Geospatial utilities for working with SRTM and other DEM data."""

import numpy as np
from PIL import Image


def load_geotiff(path: str) -> np.ndarray:
    """Load a GeoTIFF elevation file as int16 array.

    Uses Pillow (no GDAL dependency needed).
    Handles SRTM 1x1 degree tiles (3601x3601 at 30m resolution).
    """
    img = Image.open(path)
    arr = np.array(img, dtype=np.int16)
    return arr


def srtm_filename_to_bounds(filename: str) -> tuple[float, float, float, float]:
    """Parse SRTM filename to geographic bounds.

    SRTM naming: N/S{lat}E/W{lon}.tif
    Each tile covers 1x1 degree at 3601x3601 pixels.

    Returns: (lat_min, lon_min, lat_max, lon_max)
    """
    name = filename.replace('.tif', '').replace('.tiff', '')
    lat_dir = name[0]  # N or S
    lat_deg = int(name[1:3])
    lon_dir = name[3]  # E or W
    lon_deg = int(name[4:7])

    if lat_dir == 'N':
        lat_min, lat_max = lat_deg, lat_deg + 1
    else:
        lat_min, lat_max = -lat_deg - 1, -lat_deg

    if lon_dir == 'E':
        lon_min, lon_max = lon_deg, lon_deg + 1
    else:
        lon_min, lon_max = -lon_deg - 1, -lon_deg

    return lat_min, lon_min, lat_max, lon_max


def elevation_to_latlon(row: int, col: int, lat_min: float, lon_min: float,
                         nrows: int = 3601, ncols: int = 3601) -> tuple[float, float]:
    """Convert pixel coordinates to lat/lon."""
    lat = lat_min + (nrows - 1 - row) / (nrows - 1)  # Top row = max lat
    lon = lon_min + col / (ncols - 1)
    return lat, lon


def latlon_to_elevation_index(lat: float, lon: float, lat_min: float, lon_min: float,
                               nrows: int = 3601, ncols: int = 3601) -> tuple[int, int]:
    """Convert lat/lon to pixel coordinates."""
    row = int(round((lat_min + 1 - lat) * (nrows - 1)))
    col = int(round((lon - lon_min) * (ncols - 1)))
    row = max(0, min(row, nrows - 1))
    col = max(0, min(col, ncols - 1))
    return row, col


def compute_slope(elevation: np.ndarray, pixel_size_m: float = 30.0) -> np.ndarray:
    """Compute slope in degrees from elevation array.

    Uses Horn's method (3x3 kernel).
    """
    dy, dx = np.gradient(elevation.astype(np.float64), pixel_size_m)
    slope_rad = np.arctan(np.sqrt(dx**2 + dy**2))
    return np.degrees(slope_rad)


def compute_rmse(original: np.ndarray, reconstructed: np.ndarray,
                 nodata: int = -32768) -> dict:
    """Compute error metrics between original and reconstructed elevation."""
    valid = (original != nodata) & (reconstructed != nodata)
    if not valid.any():
        return {"rmse": float('nan'), "mae": float('nan'), "max_error": float('nan')}

    diff = original[valid].astype(np.float64) - reconstructed[valid].astype(np.float64)
    rmse = float(np.sqrt(np.mean(diff**2)))
    mae = float(np.mean(np.abs(diff)))
    max_err = float(np.max(np.abs(diff)))
    std_err = float(np.std(diff))

    return {
        "rmse": rmse,
        "mae": mae,
        "max_error": max_err,
        "std_error": std_err,
        "mean_bias": float(np.mean(diff)),
        "valid_pixels": int(valid.sum()),
    }


def compute_slope_deviation(original: np.ndarray, reconstructed: np.ndarray,
                            pixel_size_m: float = 30.0,
                            nodata: int = -32768) -> dict:
    """Compute slope deviation between original and reconstructed."""
    valid = (original != nodata) & (reconstructed != nodata)
    if not valid.any():
        return {"slope_rmse_deg": float('nan'), "slope_max_diff_deg": float('nan')}

    slope_orig = compute_slope(original, pixel_size_m)
    slope_recon = compute_slope(reconstructed, pixel_size_m)

    diff = np.abs(slope_orig[valid] - slope_recon[valid])
    return {
        "slope_rmse_deg": float(np.sqrt(np.mean(diff**2))),
        "slope_mean_diff_deg": float(np.mean(diff)),
        "slope_max_diff_deg": float(np.max(diff)),
        "slope_p95_diff_deg": float(np.percentile(diff, 95)),
    }


def classify_terrain(elevation: np.ndarray, nodata: int = -32768) -> str:
    """Classify terrain type based on elevation statistics."""
    valid = elevation[elevation != nodata]
    if len(valid) == 0:
        return "nodata"

    elev_range = valid.max() - valid.min()
    std = valid.std()

    if valid.max() < 0:
        return "ocean"
    if elev_range < 50 and std < 15:
        return "flat_lowland"
    if elev_range < 200 and std < 50:
        return "lowland"
    if elev_range < 1000:
        return "hills"
    if elev_range < 3000:
        return "mountain"
    return "high_mountain"
