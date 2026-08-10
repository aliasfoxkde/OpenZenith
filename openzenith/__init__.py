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

__version__ = "0.7.0"


# ─── Exception hierarchy ───────────────────────────────────────────────────────


class OpenZenithError(Exception):
    """Base exception for OpenZenith SDK errors."""



class TileNotFoundError(OpenZenithError):
    """Raised when a tile file or resource is not found."""



class TileDecodeError(OpenZenithError):
    """Raised when tile data cannot be decoded."""



class NetworkError(OpenZenithError):
    """Raised when a network request fails."""



class DataError(OpenZenithError):
    """Raised when data validation fails."""


from openzenith.async_client import (
    ElevationBatchProcessor,
    ElevationClient,
    ElevationPoint,
    ElevationResult,
)
from openzenith.elevation import (
    download_tiles,
    get_elevation,
    get_elevation_batch,
    get_elevation_from_ozt2,
    get_tile_count,
    load_ozt2_tiles,
    load_ozt2_tiles_from_hf,
    load_tiles,
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
    COMP_BROTLI,
    COMP_ZLIB,
    PRED_GRADIENT,
    PRED_LEFT,
    PRED_NONE,
    auto_encode,
)
from openzenith.tile_format_v2 import (
    COMP_ZSTD as COMP_ZSTD_V2,
)
from openzenith.tile_format_v2 import (
    TileError as TileErrorV2,
)
from openzenith.tile_format_v2 import (
    decode as decode_v2,
)
from openzenith.tile_format_v2 import (
    encode as encode_v2,
)
from openzenith.tile_format_v2 import (
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
    # Hydrology new
    if name == "breach_depressions":
        from openzenith.hydrology import breach_depressions
        return breach_depressions
    if name == "cross_section":
        from openzenith.hydrology import cross_section
        return cross_section
    if name == "stream_link_identifier":
        from openzenith.hydrology import stream_link_identifier
        return stream_link_identifier
    if name == "stream_reach_identifier":
        from openzenith.hydrology import stream_reach_identifier
        return stream_reach_identifier
    if name == "downslope_flowpath_length":
        from openzenith.hydrology import downslope_flowpath_length
        return downslope_flowpath_length
    if name == "upslope_flowpath_length":
        from openzenith.hydrology import upslope_flowpath_length
        return upslope_flowpath_length
    if name == "stream_power_index":
        from openzenith.hydrology import stream_power_index
        return stream_power_index
    # Terrain new
    if name == "feature_preserving_smooth":
        from openzenith.terrain import feature_preserving_smooth
        return feature_preserving_smooth
    if name == "mstp":
        from openzenith.terrain import mstp
        return mstp
    if name == "slope_area_ratio":
        from openzenith.terrain import slope_area_ratio
        return slope_area_ratio
    if name == "curvature_classification":
        from openzenith.terrain import curvature_classification
        return curvature_classification
    if name == "specific_catchment_area":
        from openzenith.terrain import specific_catchment_area
        return specific_catchment_area
    if name == "hack_integral":
        from openzenith.terrain import hack_integral
        return hack_integral
    if name == "sky_view_factor":
        from openzenith.terrain import sky_view_factor
        return sky_view_factor
    if name == "landform_classification":
        from openzenith.terrain import landform_classification
        return landform_classification
    if name == "visibility_index":
        from openzenith.terrain import visibility_index
        return visibility_index
    if name == "flow_width":
        from openzenith.terrain import flow_width
        return flow_width
    if name == "flood_inundation":
        from openzenith.hydrology import flood_inundation
        return flood_inundation
    if name == "inundation_depth":
        from openzenith.hydrology import inundation_depth
        return inundation_depth
    if name == "depression_depth_stats":
        from openzenith.hydrology import depression_depth_stats
        return depression_depth_stats
    if name == "contour_to_kml":
        from openzenith.export import contour_to_kml
        return contour_to_kml
    if name == "grid_to_kml":
        from openzenith.export import grid_to_kml
        return grid_to_kml
    if name == "get_elevation_along_path":
        from openzenith.elevation import get_elevation_along_path
        return get_elevation_along_path
    # Overlay
    if name == "extract_at_points":
        from openzenith.overlay import extract_at_points
        return extract_at_points
    if name == "zonal_stats":
        from openzenith.overlay import zonal_stats
        return zonal_stats
    if name == "rasterize_lines":
        from openzenith.overlay import rasterize_lines
        return rasterize_lines
    # Vector
    if name == "shapefile_to_geojson":
        from openzenith.vector import shapefile_to_geojson
        return shapefile_to_geojson
    if name == "gdb_to_geojson":
        from openzenith.vector import gdb_to_geojson
        return gdb_to_geojson
    if name == "list_gdb_layers":
        from openzenith.vector import list_gdb_layers
        return list_gdb_layers
    if name == "export_to_gdb":
        from openzenith.vector import export_to_gdb
        return export_to_gdb
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")

__all__ = [
    "COMP_BROTLI",
    "COMP_NONE",
    "COMP_ZLIB",
    "COMP_ZSTD",
    "COMP_ZSTD_DELTA",
    "COMP_ZSTD_PREDICT",
    "COMP_ZSTD_V2",
    "PRED_GRADIENT",
    "PRED_LEFT",
    "PRED_NONE",
    "DataError",
    "ElevationBatchProcessor",
    "ElevationClient",
    "ElevationPoint",
    "ElevationResult",
    "FusedDEM",
    "NetworkError",
    "OZT2Backend",
    "OZT2HFBackend",
    "OZT2R2Backend",
    "OpenZenithError",
    "TileDecodeError",
    "TileError",
    "TileErrorV2",
    "TileNotFoundError",
    "aspect",
    "auto_encode",
    "breach_depressions",
    "color_relief",
    "contour_to_geojson",
    "contour_to_kml",
    "cross_section",
    "curvature",
    "curvature_classification",
    "d8_flow_direction",
    "decode",
    "decode_tile",
    "decode_v2",
    "delineate_watershed",
    "depression_depth_stats",
    "download_tiles",
    "downslope_flowpath_length",
    "drainage_density",
    "encode",
    "encode_tile",
    "encode_v2",
    "export_cog",
    "export_geotiff",
    "export_to_gdb",
    "extract_at_points",
    "extract_streams",
    "fill_depressions",
    "flood_inundation",
    "flow_accumulation",
    "flow_width",
    "get_elevation",
    "get_elevation_along_path",
    "get_elevation_batch",
    "get_elevation_from_ozt2",
    "get_tile_count",
    "grid_to_geojson",
    "grid_to_gtiff_metadata",
    "grid_to_kml",
    "hack_integral",
    "hillshade",
    "inundation_depth",
    "landform_classification",
    "load_fused_elevation_grid",
    "load_fused_tile",
    "load_ozt2_tiles",
    "load_ozt2_tiles_from_hf",
    "load_tiles",
    "mstp",
    "multi_hillshade",
    "planform_curvature",
    "plot_contours",
    "plot_hillshade",
    "plot_terrain",
    "profile_curvature",
    "rasterize_lines",
    "roughness",
    "sky_view_factor",
    "slope",
    "slope_area_ratio",
    "slope_fast",
    "specific_catchment_area",
    "stream_link_identifier",
    "stream_order",
    "stream_power_index",
    "stream_reach_identifier",
    "terrain_to_3d_mesh",
    "terrain_to_glb",
    "terrain_to_png",
    "tpi",
    "trace_downstream",
    "tri",
    "twi",
    "upslope_flowpath_length",
    "validate_roundtrip",
    "validate_roundtrip_v2",
    "viewshed",
    "visibility_index",
    "zonal_stats",
]
