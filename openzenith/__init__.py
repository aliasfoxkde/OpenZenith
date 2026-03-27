"""OpenZenith - Global elevation data tools.

Provides:
- Terrarium PNG tile encoding/decoding
- Elevation queries at any lat/lon
- OZT1 custom binary format for scientific use
- GeoTIFF conversion tools
"""

__version__ = "0.3.0"

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

__all__ = [
    "COMP_NONE",
    "COMP_ZSTD",
    "COMP_ZSTD_DELTA",
    "COMP_ZSTD_PREDICT",
    "TileError",
    "decode",
    "encode",
    "validate_roundtrip",
    "decode_tile",
    "encode_tile",
    "get_elevation",
    "get_elevation_batch",
    "get_tile_count",
    "load_tiles",
]
