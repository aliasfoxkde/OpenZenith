"""OpenZenith - Global elevation data tools.

Provides:
- Terrarium PNG tile encoding/decoding
- Elevation queries at any lat/lon
- OZT1 custom binary format for scientific use
- OZT2 adaptive compression format (gradient prediction + Brotli)
- GeoTIFF conversion tools
- D8 flow direction and hydrology analysis
- Downstream tracing (point → river mouth/ocean)
- Watershed delineation from pour points
- CLI: openzenith download/query/trace/watershed/info/validate

For compute-intensive applications, the local SDK is recommended over the web API
to avoid HTTPS chunk download overhead on each tile request.
"""

__version__ = "0.5.0"

from openzenith.elevation import (
    get_elevation,
    get_elevation_batch,
    get_tile_count,
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
    # Terrarium
    "decode_tile",
    "encode_tile",
    # Elevation
    "get_elevation",
    "get_elevation_batch",
    "get_tile_count",
    "load_tiles",
    # Hydrology (lazy)
    "d8_flow_direction",
    "flow_accumulation",
    "extract_streams",
    "stream_order",
    "delineate_watershed",
    # Tracing (lazy)
    "trace_downstream",
]
