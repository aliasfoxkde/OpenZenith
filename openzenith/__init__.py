"""OpenZenith - Global elevation data tools.

Provides:
- Terrarium PNG tile encoding/decoding
- Elevation queries at any lat/lon
- OZT1/OZT2 custom binary formats
- GeoTIFF conversion tools
- D8 flow direction and hydrology analysis
- Downstream tracing (point → river mouth/ocean)
- Watershed delineation from pour points
- Terrain analysis: slope, aspect, hillshade, viewshed
- CLI: openzenith download/query/trace/watershed/slope/hillshade/viewshed/info

For compute-intensive applications, the local SDK is recommended over the web API
to avoid HTTPS chunk download overhead on each tile request.
"""

__version__ = "0.6.4"

from openzenith.elevation import (
    get_elevation,
    get_elevation_batch,
    get_elevation_from_ozt2,
    get_tile_count,
    load_tiles,
    load_ozt2_tiles,
    load_ozt2_tiles_from_hf,
    download_tiles,
)
from openzenith.async_client import (
    ElevationClient,
    ElevationBatchProcessor,
    ElevationResult,
    ElevationPoint,
)
from openzenith.terrarium import decode_tile, encode_tile
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
from openzenith.tile_format_v2 import (
    PRED_NONE,
    PRED_LEFT,
    PRED_GRADIENT,
    COMP_BROTLI,
    COMP_ZSTD,
    COMP_ZLIB,
    TileError as TileErrorV2,
    encode as encode_v2,
    decode as decode_v2,
    auto_encode,
    validate_roundtrip as validate_roundtrip_v2,
)

# Lazy imports for optional heavy dependencies
def __getattr__(name):
    # OZT2 backends
    if name == "OZT2Backend":
        from openzenith.backends.ozt2 import OZT2Backend
        return OZT2Backend
    if name == "OZT2R2Backend":
        from openzenith.backends.ozt2 import OZT2R2Backend
        return OZT2R2Backend
    if name == "OZT2HFBackend":
        from openzenith.backends.ozt2 import OZT2HFBackend
        return OZT2HFBackend
    # Hydrology
    if name == "d8_flow_direction":
        from openzenith.hydrology import d8_flow_direction
        return d8_flow_direction
    if name == "flow_accumulation":
        from openzenith.hydrology import flow_accumulation
        return flow_accumulation
    if name == "extract_streams":
        from openzenith.hydrology import extract_streams
        return extract_streams
    if name == "stream_order":
        from openzenith.hydrology import stream_order
        return stream_order
    if name == "delineate_watershed":
        from openzenith.hydrology import delineate_watershed
        return delineate_watershed
    if name == "trace_downstream":
        from openzenith.tracing import trace_downstream
        return trace_downstream
    # Terrain
    if name == "slope":
        from openzenith.terrain import slope
        return slope
    if name == "slope_fast":
        from openzenith.terrain import slope_fast
        return slope_fast
    if name == "aspect":
        from openzenith.terrain import aspect
        return aspect
    if name == "hillshade":
        from openzenith.terrain import hillshade
        return hillshade
    if name == "viewshed":
        from openzenith.terrain import viewshed
        return viewshed
    if name == "tpi":
        from openzenith.terrain import tpi
        return tpi
    if name == "roughness":
        from openzenith.terrain import roughness
        return roughness
    if name == "curvature":
        from openzenith.terrain import curvature
        return curvature
    if name == "tri":
        from openzenith.terrain import tri
        return tri
    if name == "multi_hillshade":
        from openzenith.terrain import multi_hillshade
        return multi_hillshade
    if name == "color_relief":
        from openzenith.terrain import color_relief
        return color_relief
    # Export
    if name == "grid_to_geojson":
        from openzenith.export import grid_to_geojson
        return grid_to_geojson
    if name == "contour_to_geojson":
        from openzenith.export import contour_to_geojson
        return contour_to_geojson
    # Visualization
    if name == "plot_terrain":
        from openzenith.viz import plot_terrain
        return plot_terrain
    if name == "plot_hillshade":
        from openzenith.viz import plot_hillshade
        return plot_hillshade
    if name == "plot_contours":
        from openzenith.viz import plot_contours
        return plot_contours
    if name == "terrain_to_3d_mesh":
        from openzenith.viz import terrain_to_3d_mesh
        return terrain_to_3d_mesh
    if name == "terrain_to_glb":
        from openzenith.viz import terrain_to_glb
        return terrain_to_glb
    if name == "terrain_to_png":
        from openzenith.viz import terrain_to_png
        return terrain_to_png
    # Hydrology extra
    if name == "fill_depressions":
        from openzenith.hydrology import fill_depressions
        return fill_depressions
    if name == "twi":
        from openzenith.hydrology import twi
        return twi
    # Terrain extra
    if name == "profile_curvature":
        from openzenith.terrain import profile_curvature
        return profile_curvature
    if name == "planform_curvature":
        from openzenith.terrain import planform_curvature
        return planform_curvature
    if name == "drainage_density":
        from openzenith.terrain import drainage_density
        return drainage_density
    # Multi-DEM fusion
    if name == "FusedDEM":
        from openzenith.fuse import FusedDEM
        return FusedDEM
    if name == "load_fused_tile":
        from openzenith.fuse import load_fused_tile
        return load_fused_tile
    if name == "load_fused_elevation_grid":
        from openzenith.fuse import load_fused_elevation_grid
        return load_fused_elevation_grid
    # GeoTIFF / COG export
    if name == "export_geotiff":
        from openzenith.geotiff import export_geotiff
        return export_geotiff
    if name == "export_cog":
        from openzenith.geotiff import export_cog
        return export_cog
    if name == "grid_to_gtiff_metadata":
        from openzenith.geotiff import grid_to_gtiff_metadata
        return grid_to_gtiff_metadata
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")

__all__ = [
    # OZT1
    "COMP_NONE",
    "COMP_ZSTD",
    "COMP_ZSTD_DELTA",
    "COMP_ZSTD_PREDICT",
    "TileError",
    "decode",
    "encode",
    "validate_roundtrip",
    # OZT2
    "PRED_NONE",
    "PRED_LEFT",
    "PRED_GRADIENT",
    "COMP_BROTLI",
    "COMP_ZSTD",
    "COMP_ZLIB",
    "TileErrorV2",
    "encode_v2",
    "decode_v2",
    "auto_encode",
    "validate_roundtrip_v2",
    # Backends
    "OZT2Backend",
    "OZT2R2Backend",
    "OZT2HFBackend",
    # Terrarium
    "decode_tile",
    "encode_tile",
    # Elevation
    "get_elevation",
    "get_elevation_batch",
    "get_elevation_from_ozt2",
    "get_tile_count",
    "load_tiles",
    "load_ozt2_tiles",
    "load_ozt2_tiles_from_hf",
    "download_tiles",
    # Hydrology (lazy)
    "d8_flow_direction",
    "flow_accumulation",
    "extract_streams",
    "stream_order",
    "delineate_watershed",
    # Tracing (lazy)
    "trace_downstream",
    # Terrain (lazy)
    "slope",
    "slope_fast",
    "aspect",
    "hillshade",
    "viewshed",
    "tpi",
    "roughness",
    "curvature",
    "tri",
    "multi_hillshade",
    "color_relief",
    # Export
    "grid_to_geojson",
    "contour_to_geojson",
    # Async client
    "ElevationClient",
    "ElevationBatchProcessor",
    "ElevationResult",
    "ElevationPoint",
    # Hydrology extra (lazy)
    "fill_depressions",
    "twi",
    # Terrain extra (lazy)
    "profile_curvature",
    "planform_curvature",
    "drainage_density",
    # Visualization
    "plot_terrain",
    "plot_hillshade",
    "plot_contours",
    "terrain_to_3d_mesh",
    "terrain_to_glb",
    "terrain_to_png",
    # GeoTIFF / COG
    "export_geotiff",
    "export_cog",
    "grid_to_gtiff_metadata",
    # Multi-DEM fusion
    "FusedDEM",
    "load_fused_tile",
    "load_fused_elevation_grid",
]
