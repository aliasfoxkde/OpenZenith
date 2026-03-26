"""OpenZenith - Elevation data compression, terrain analysis, and geospatial tools."""

__version__ = "0.2.0"

from openzenith.geo_utils import (
    classify_terrain,
    compute_rmse,
    compute_slope,
    compute_slope_deviation,
    elevation_to_latlon,
    latlon_to_elevation_index,
    load_geotiff,
    srtm_filename_to_bounds,
)
from openzenith.tile_format import (
    COMP_NONE,
    COMP_ZSTD,
    COMP_ZSTD_DELTA,
    COMP_ZSTD_PREDICT,
    TileError,
    decode,
    encode,
    validate_roundtrip,
)

__all__ = [
    "COMP_NONE",
    "COMP_ZSTD",
    "COMP_ZSTD_DELTA",
    "COMP_ZSTD_PREDICT",
    "TileError",
    "classify_terrain",
    "compute_rmse",
    "compute_slope",
    "compute_slope_deviation",
    "decode",
    "elevation_to_latlon",
    "encode",
    "latlon_to_elevation_index",
    "load_geotiff",
    "srtm_filename_to_bounds",
    "validate_roundtrip",
]
