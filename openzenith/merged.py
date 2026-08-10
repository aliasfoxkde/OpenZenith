"""Reader for OZCHNK01 merged chunk files.

These are the source .merged files from HuggingFace (aliasfox/srtm30m-merged).
Each 1°×1° tile contains 225 chunks (15×15) of 256×256 pixels each.

Binary layout:
    [8 bytes]  Magic: b"OZCHNK01"
    [2 bytes]  Version: 1 (SRTM Int16) or 2 (Copernicus Float32)
    [1 byte]   Rows (chunks per tile row)
    [1 byte]   Cols (chunks per tile col)
    [N * 8 bytes] Index: [4-byte offset LE, 4-byte size LE] per chunk
    [variable]  Concatenated zlib-compressed chunk data

Each chunk is a 256x256 (or edge-adjusted) array of:
    Version 1: Int16 elevation values with horizontal differencing predictor
    Version 2: Float32 elevation values

Usage:
    from openzenith.merged import MergedFile

    # Read from local .merged files (e.g. after downloading from HuggingFace)
    mf = MergedFile("/path/to/N00/N00E006.merged")
    chunk = mf.get_chunk(row=0, col=0)  # Returns decompressed Int16 array

    # Or use the convenience function for single-point queries
    from openzenith.merged import read_elevation_from_merged
    elev = read_elevation_from_merged(40.7128, -74.0060, "/path/to/srtm30m-merged/")

    # Download from HuggingFace first:
    #   pip install huggingface_hub
    #   huggingface-cli download aliasfox/srtm30m-merged --repo-type dataset --local-dir ./srtm30m-merged
"""

import math
import struct
import zlib
from pathlib import Path
from typing import cast

import numpy as np
from cachetools import LRUCache

MAGIC = b"OZCHNK01"
HEADER_SIZE = 12
INDEX_ENTRY_SIZE = 8

# Process-level cache: path → MergedFile (avoids re-reading .merged files)
# Bounded to ~300MB: 64 files × ~5MB each + 512 chunks × 128KB ≈ 384MB per worker
_merged_cache: LRUCache = LRUCache(maxsize=64)

# Process-level cache: (path, row, col) → decompressed chunk array
_chunk_cache: LRUCache = LRUCache(maxsize=512)


def get_merged_file(path: str | Path) -> "MergedFile":
    """Get a MergedFile, using a cache to avoid re-reading files."""
    key = str(path)
    if key in _merged_cache:
        return _merged_cache[key]
    mf = MergedFile(path)
    _merged_cache[key] = mf
    return mf


class MergedFile:
    """Reader for a single .merged file. Immutable after construction."""

    __slots__ = ("cols", "data", "index", "path", "rows", "version")

    def __init__(self, path: str | Path):
        self.path = Path(path)
        with open(self.path, "rb") as f:
            self.data = f.read()

        if len(self.data) < HEADER_SIZE:
            raise ValueError(f"File too small: {self.path}")

        if self.data[:8] != MAGIC:
            raise ValueError(f"Invalid magic in {self.path}: {self.data[:8]!r}")

        self.version = struct.unpack_from("<H", self.data, 8)[0]
        self.rows = self.data[10]
        self.cols = self.data[11]

        # Parse index
        self.index = []
        for i in range(self.rows * self.cols):
            off = HEADER_SIZE + i * INDEX_ENTRY_SIZE
            offset = struct.unpack_from("<I", self.data, off)[0]
            size = struct.unpack_from("<I", self.data, off + 4)[0]
            self.index.append({"offset": offset, "size": size})

    def get_chunk(self, row: int, col: int) -> np.ndarray:
        """Decompress and decode a single chunk (cached globally by path+row+col).

        Args:
            row: Chunk row (0-based)
            col: Chunk column (0-based)

        Returns:
            2D numpy array of the chunk.
            - Version 1: Int16 (elevation in meters, -32768 = nodata)
            - Version 2: Float32
        """
        if row < 0 or row >= self.rows or col < 0 or col >= self.cols:
            raise ValueError(f"Chunk ({row}, {col}) out of range ({self.rows}x{self.cols})")

        # Check global chunk cache first
        cache_key = (str(self.path), row, col)
        if cache_key in _chunk_cache:
            return _chunk_cache[cache_key]

        idx = row * self.cols + col
        entry = self.index[idx]
        compressed = self.data[entry["offset"] : entry["offset"] + entry["size"]]

        # Decompress zlib
        decompressed = zlib.decompress(compressed)

        if self.version == 1:
            # Int16 with horizontal differencing predictor
            # Chunks are always 256x256 in storage (edge chunks have padding pixels)
            raw = np.frombuffer(decompressed, dtype=np.int16).reshape(256, 256)
            # Undo horizontal predictor: cumulative sum along each row
            # raw[row, col] stores: delta from left neighbor
            # out[row, col] = sum of deltas in [0..col] for this row
            out: np.ndarray = np.cumsum(raw, axis=1, dtype=np.int16)
        else:
            # Float32 (no prediction)
            out = np.frombuffer(decompressed, dtype=np.float32).reshape(256, 256)

        _chunk_cache[cache_key] = out
        return cast(np.ndarray, out)


def lat_lon_to_srtm_name(lat: float, lon: float) -> str:
    """Get SRTM tile name for a lat/lon."""
    lat_val = abs(int(lat))
    lon_val = abs(int(lon))
    lat_dir = f"N{lat_val:02d}" if lat >= 0 else f"S{lat_val:02d}"
    lon_dir = f"E{lon_val:03d}" if lon >= 0 else f"W{lon_val:03d}"
    return f"{lat_dir}{lon_dir}"


def srtm_name_to_dir(name: str) -> tuple[str, str]:
    """Get subdirectory and filename for an SRTM tile name."""
    lat_dir = name[:3]  # e.g. "N00"
    return lat_dir, name


def read_elevation_from_merged(
    lat: float,
    lon: float,
    merged_dir: str | Path,
) -> float | None:
    """Read elevation at a single lat/lon point from .merged files.

    Args:
        lat: Latitude
        lon: Longitude
        merged_dir: Root directory containing N00/, S00/, etc. subdirs

    Returns:
        Elevation in meters, or None if no data (ocean/nodata).
    """
    tile_name = lat_lon_to_srtm_name(lat, lon)
    lat_dir, _base = srtm_name_to_dir(tile_name)
    merged_path = Path(merged_dir) / lat_dir / f"{tile_name}.merged"

    if not merged_path.exists():
        return None

    try:
        mf = MergedFile(merged_path)
    except Exception:  # noqa: BLE001
        return None

    # Find which chunk contains this point
    # Each tile is 1°x1°, SRTM data is 3601x3601 pixels (15x15 chunks of 256x256)
    # Pixel (0,0) = north-west corner (top-left), pixel (3600, 3600) = south-east (bottom-right)
    lat_frac = lat - math.floor(lat)
    lon_frac = lon - math.floor(lon)
    lat_pixel = min(3600, max(0, round((1.0 - lat_frac) * 3600)))
    lon_pixel = min(3600, max(0, round(lon_frac * 3600)))

    chunk_row = min(14, lat_pixel // 256)
    chunk_col = min(14, lon_pixel // 256)

    entry = mf.index[chunk_row * mf.cols + chunk_col]
    if entry["size"] == 0:
        return None  # Ocean/no-data chunk

    chunk = mf.get_chunk(chunk_row, chunk_col)

    # Position within chunk (256x256 storage)
    local_row = lat_pixel - chunk_row * 256
    local_col = lon_pixel - chunk_col * 256

    # Clamp to valid data area (edge chunks may have padding beyond tile bounds)
    local_row = min(local_row, chunk.shape[0] - 1)
    local_col = min(local_col, chunk.shape[1] - 1)

    elev = int(chunk[local_row, local_col])
    if elev == -32768:
        return None
    return float(elev)


# ─── SRTM tile index ─────────────────────────────────────────────────────────

_INDEX_CACHE: dict[str, dict[tuple[int, int], dict]] = {}


def discover_srtm_tiles(srtm_dir: Path) -> dict[tuple[int, int], dict]:
    """Build or load the SRTM tile index for a merged SRTM directory.

    Scans the directory for ``.merged`` files and returns a dict mapping
    ``(lat, lon)`` → ``{has_data, rows, cols}``.  Results are cached per
    ``srtm_dir`` path within the process.

    The index is also cached to ``srtm_dir / "srtm_index.json"`` when built,
    so subsequent calls load instantly.
    """
    cache_key = str(srtm_dir)
    if cache_key in _INDEX_CACHE:
        return _INDEX_CACHE[cache_key]

    index_path = srtm_dir / "srtm_index.json"
    if index_path.exists():
        import json as _json
        try:
            raw = _json.loads(index_path.read_text())
            result: dict[tuple[int, int], dict] = {}
            for k, v in raw.items():
                parts = k.split(",")
                result[(int(parts[0]), int(parts[1]))] = v
            _INDEX_CACHE[cache_key] = result
            return result
        except Exception:  # noqa: BLE001, S110
            pass

    # Scan .merged files
    result = {}
    if srtm_dir.exists():
        for lat_dir in sorted(srtm_dir.iterdir()):
            if not lat_dir.is_dir():
                continue
            for merged_file in sorted(lat_dir.glob("*.merged")):
                name = merged_file.stem  # e.g. "N36W085"
                lat_str = name[:3]
                lon_str = name[3:]
                try:
                    lat_deg = int(lat_str[1:])
                    if lat_str[0] == "S":
                        lat_deg = -lat_deg
                    lon_deg = int(lon_str[1:])
                    if lon_str[0] == "W":
                        lon_deg = -lon_deg
                    # Read header only — fast (no chunk decompression)
                    mf = MergedFile(merged_file)
                    result[(lat_deg, lon_deg)] = {
                        "has_data": True,
                        "rows": mf.rows,
                        "cols": mf.cols,
                    }
                except Exception:  # noqa: BLE001, S112
                    continue

    # Persist for next time
    try:
        import json as _json
        raw = {f"{k[0]},{k[1]}": v for k, v in result.items()}
        index_path.write_text(_json.dumps(raw))
    except Exception:  # noqa: BLE001, S110
        pass

    _INDEX_CACHE[cache_key] = result
    return result


if __name__ == "__main__":
    import sys

    # Quick test
    path = Path(sys.argv[1]) if len(sys.argv) > 1 else None
    if path:
        mf = MergedFile(path)
        print(f"Version: {mf.version}, Grid: {mf.rows}x{mf.cols}")
        chunk = mf.get_chunk(0, 0)
        print(f"Chunk shape: {chunk.shape}, range: {chunk.min()} to {chunk.max()}")
