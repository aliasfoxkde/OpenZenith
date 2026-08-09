"""GeoTIFF / COG export for OpenZenith elevation data.

Exports DEM grids to GeoTIFF files with proper georeferencing (EPSG:4326 /
WGS84). Supports Cloud-Optimized GeoTIFF (COG) output with internal tiling
and compression.

Usage:
    from openzenith.geotiff import export_geotiff, export_cog

    # Simple GeoTIFF export
    export_geotiff(elevation_grid, "output.tif", transform=(lat_min, lon_min, cell_size))

    # Cloud-Optimized GeoTIFF with Zstd compression
    export_cog(elevation_grid, "output_cog.tif", compress="zstd", tiled=True)

    # From OZT2 tiles
    from openzenith import load_ozt2_tiles, get_elevation_from_ozt2
    from openzenith.geotiff import export_geotiff

    tile_dir = load_ozt2_tiles("/data/ozt2_tiles")
    export_geotiff(grid, "terrain.tif", crs="EPSG:4326")
"""

from __future__ import annotations

__all__ = [
    "export_geotiff",
    "export_cog",
    "grid_to_gtiff_metadata",
]

from pathlib import Path
from typing import Literal

import numpy as np


def grid_to_gtiff_metadata(
    rows: int,
    cols: int,
    transform: tuple[float, float, float, float] | None = None,
    *,
    origin_lat: float = 0.0,
    origin_lon: float = 0.0,
    cell_size: float = 0.001,
    nodata: float = -32768.0,
    crs: str = "EPSG:4326",
) -> dict:
    """Build GeoTIFF transform and metadata dict for a grid.

    Args:
        rows: Number of rows in the grid.
        cols: Number of columns in the grid.
        transform: Optional (origin_lat, origin_lon, cell_size_lat, cell_size_lon).
            Overrides origin_lat, origin_lon, cell_size if provided.
        origin_lat: Latitude of the top-left corner (max latitude).
        origin_lon: Longitude of the top-left corner (min longitude).
        cell_size: Cell size in degrees (approximate for Mercator projections).
        nodata: No-data value to embed in the TIFF.
        crs: Coordinate reference system (default: EPSG:4326/WGS84).

    Returns:
        Dict with 'geotransform' (GDAL-style 6-tuple), 'width', 'height', 'nodata'.
    """
    if transform is not None:
        origin_lat, origin_lon, dlat, dlon = transform
    else:
        dlat = cell_size
        dlon = cell_size

    # GDAL geotransform: (lon_min, pixel_width, 0, lat_max, 0, -pixel_height)
    geotransform = (origin_lon, dlon, 0.0, origin_lat, 0.0, -dlat)

    return {
        "geotransform": geotransform,
        "width": cols,
        "height": rows,
        "nodata": nodata,
        "crs": crs,
        "driver": "GTiff",
    }


def export_geotiff(
    data: np.ndarray,
    output_path: str | Path,
    transform: tuple[float, float, float, float] | None = None,
    *,
    nodata: float = -32768.0,
    compress: Literal["zstd", "lzw", "deflate", "none"] | None = None,
    dtype: str | None = None,
    origin_lat: float = 0.0,
    origin_lon: float = 0.0,
    cell_size: float = 0.001,
    crs: str = "EPSG:4326",
) -> Path:
    """Export a DEM grid to a GeoTIFF file with georeferencing.

    Writes a standard GeoTIFF (EPSG:4326) with optional compression.
    Requires rasterio (install: pip install rasterio). Falls back to a
    plain TIFF (no georeferencing) if rasterio is unavailable.

    Args:
        data: 2D elevation array (meters). Will be converted to int16.
        output_path: Output file path (.tif extension recommended).
        transform: (origin_lat, origin_lon, cell_size_lat, cell_size_lon).
            Overrides origin_* and cell_size if provided.
        nodata: No-data value (default: -32768).
        compress: Compression algorithm: "zstd" (default if rasterio available),
            "lzw", "deflate", or "none".
        dtype: Override output dtype. Default: int16 for elevation.
        origin_lat: Top-left latitude of the grid.
        origin_lon: Bottom-left longitude of the grid.
        cell_size: Cell size in degrees.
        crs: CRS for the output (default: EPSG:4326).

    Returns:
        Path to the output file.
    """
    output_path = Path(output_path)
    rows, cols = data.shape

    # Determine output dtype
    if dtype is None:
        if np.issubdtype(data.dtype, np.floating):
            # Convert float to int16, clip to reasonable range
            out_data = np.clip(np.round(data), -32768, 32767).astype(np.int16)
            out_data = np.where(data == -32768, nodata, out_data)
        else:
            out_data = data.astype(np.int16)
    else:
        out_data = data.astype(dtype)

    # Handle nodata in float arrays
    if np.issubdtype(data.dtype, np.floating):
        nan_mask = np.isnan(data)
        out_data = np.where(nan_mask, int(nodata), out_data)

    # Resolve compression
    if compress is None:
        compress = "zstd"

    metadata = grid_to_gtiff_metadata(
        rows, cols, transform,
        origin_lat=origin_lat, origin_lon=origin_lon,
        cell_size=cell_size, nodata=nodata, crs=crs,
    )

    try:
        import rasterio
        from rasterio.transform import from_origin
    except ImportError:
        # Fallback: write plain TIFF without georeferencing
        from PIL import Image
        img = Image.fromarray(out_data.astype(np.int16), mode="I;16")
        img.save(output_path)
        return output_path

    # Build rasterio transform from origin
    gt = metadata["geotransform"]
    # from_origin(lon_min, lat_max, pixel_width, pixel_height)
    transform_rio = from_origin(gt[0], gt[3], gt[1], abs(gt[5]))

    profile = {
        "driver": "GTiff",
        "height": rows,
        "width": cols,
        "count": 1,
        "dtype": "int16",
        "crs": crs,
        "transform": transform_rio,
        "nodata": nodata,
        "compress": compress if compress != "none" else None,
        "tiled": True,
        "blockxsize": 256,
        "blockysize": 256,
    }

    with rasterio.open(output_path, "w", **profile) as dst:
        dst.write(out_data, 1)

    return output_path


def export_cog(
    data: np.ndarray,
    output_path: str | Path,
    transform: tuple[float, float, float, float] | None = None,
    *,
    nodata: float = -32768.0,
    compress: Literal["zstd", "lzw", "deflate"] = "zstd",
    origin_lat: float = 0.0,
    origin_lon: float = 0.0,
    cell_size: float = 0.001,
    crs: str = "EPSG:4326",
    overview_levels: list[int] | None = None,
    overview_compress: str | None = "zstd",
) -> Path:
    """Export a DEM grid as a Cloud-Optimized GeoTIFF (COG).

    COGs are TIFF files with internal tiling and overviews, optimized for
    HTTP range-request access in web clients (MapLibre, OpenLayers, QGIS).

    Args:
        data: 2D elevation array.
        output_path: Output file path.
        transform: (origin_lat, origin_lon, cell_size_lat, cell_size_lon).
        nodata: No-data value (default: -32768).
        compress: Compression for the main TIFF (default: zstd).
        origin_lat: Top-left latitude.
        origin_lon: Top-left longitude.
        cell_size: Cell size in degrees.
        crs: CRS (default: EPSG:4326).
        overview_levels: List of overview reduction factors. Default: [2, 4, 8, 16].
        overview_compress: Compression for overviews (default: zstd).

    Returns:
        Path to the output COG file.
    """
    output_path = Path(output_path)

    if overview_levels is None:
        overview_levels = [2, 4, 8, 16]

    try:
        import rasterio
        from rasterio.transform import from_origin
    except ImportError:
        raise ImportError(
            "rasterio required for COG export. "
            "Install with: pip install rasterio"
        )

    rows, cols = data.shape

    # Ensure int16
    if np.issubdtype(data.dtype, np.floating):
        out_data = np.clip(np.round(data), -32768, 32767).astype(np.int16)
        out_data = np.where(np.isnan(data), int(nodata), out_data)
    else:
        out_data = data.astype(np.int16)

    metadata = grid_to_gtiff_metadata(
        rows, cols, transform,
        origin_lat=origin_lat, origin_lon=origin_lon,
        cell_size=cell_size, nodata=nodata, crs=crs,
    )
    gt = metadata["geotransform"]
    transform_rio = from_origin(gt[0], gt[3], gt[1], abs(gt[5]))

    profile = {
        "driver": "GTiff",
        "height": rows,
        "width": cols,
        "count": 1,
        "dtype": "int16",
        "crs": crs,
        "transform": transform_rio,
        "nodata": nodata,
        "compress": compress,
        "tiled": True,
        "blockxsize": 512,
        "blockysize": 512,
        "BIGTIFF": "IF_SAFER",
    }

    with rasterio.open(output_path, "w", **profile) as dst:
        dst.write(out_data, 1)

        # Build overviews (pyramid levels)
        overview_factors = overview_levels
        dst.build_overviews(overview_factors, rasterio.enums.Resampling.average)
        dst.update_tags(ns="rio_overview", compress=overview_compress or compress)

    # Re-open to verify COG structure
    with rasterio.open(output_path) as dst:
        # Check that overviews were built (band 1)
        overviews = dst.overviews(1)
        if not overviews:
            raise RuntimeError("No overviews built — COG requirement violated")

    return output_path
