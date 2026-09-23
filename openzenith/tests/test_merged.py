"""Tests for OZCHNK01 .merged file reader (merged.py)."""

import json
import runpy
import struct
import sys
import tempfile
import zlib
from pathlib import Path

import numpy as np
import pytest

from openzenith import merged
from openzenith.merged import (
    INDEX_ENTRY_SIZE,
    MAGIC,
    MergedFile,
    discover_srtm_tiles,
    get_merged_file,
    lat_lon_to_srtm_name,
    read_elevation_from_merged,
    srtm_name_to_dir,
)


def make_merged_v1(chunks: list[np.ndarray]) -> tuple[bytes, list[int]]:
    """Build a synthetic V1 .merged file from a list of 256×256 Int16 arrays.

    Returns (file_bytes, chunk_original_values) so tests can verify decode.
    """
    rows = int(np.sqrt(len(chunks)))
    cols = len(chunks) // rows
    assert rows * cols == len(chunks), "chunks must form a rectangle"

    buf = bytearray()
    buf += MAGIC
    buf += struct.pack("<H", 1)
    buf += bytes([rows, cols])

    index_start = len(buf)
    buf += b"\x00" * (rows * cols * INDEX_ENTRY_SIZE)

    chunk_offsets = []
    for chunk in chunks:
        assert chunk.shape == (256, 256)
        # SRTM horizontal differencing predictor:
        # First element of each row = absolute value (stored as-is)
        # Subsequent elements = delta from left neighbor
        diff = np.empty_like(chunk)
        diff[0, 0] = chunk[0, 0]
        for c in range(1, 256):
            diff[0, c] = chunk[0, c] - chunk[0, c - 1]
        for r in range(1, 256):
            diff[r, 0] = chunk[r, 0]  # absolute
            for c in range(1, 256):
                diff[r, c] = chunk[r, c] - chunk[r, c - 1]
        raw = diff.astype(np.int16).tobytes()
        compressed = zlib.compress(raw, 6)
        chunk_offsets.append((len(buf), len(compressed)))
        buf += compressed

    for i, (off, sz) in enumerate(chunk_offsets):
        struct.pack_into("<I", buf, index_start + i * INDEX_ENTRY_SIZE, off)
        struct.pack_into("<I", buf, index_start + i * INDEX_ENTRY_SIZE + 4, sz)

    return bytes(buf), [int(c[0, 0]) for c in chunks]


def make_chunk(val: int = 1000) -> np.ndarray:
    """Create a constant-value 256×256 Int16 chunk."""
    return np.full((256, 256), val, dtype=np.int16)


def write_merged(chunks: list[np.ndarray]) -> str:
    """Write synthetic .merged to a temp file, return path."""
    data, _ = make_merged_v1(chunks)
    with tempfile.NamedTemporaryFile(suffix=".merged", delete=False) as f:
        f.write(data)
    return f.name


class TestMergedFile:
    def test_invalid_magic_raises(self):
        buf = b"NOTAMAGIC" + b"\x00" * 100
        with tempfile.NamedTemporaryFile(suffix=".merged", delete=False) as f:
            f.write(buf)
            f.flush()
            with pytest.raises(ValueError, match="Invalid magic"):
                MergedFile(f.name)

    def test_too_small_raises(self):
        with tempfile.NamedTemporaryFile(suffix=".merged", delete=False) as f:
            f.write(b"\x00" * 4)
            f.flush()
            with pytest.raises(ValueError, match="File too small"):
                MergedFile(f.name)

    def test_version_1_detected(self):
        path = write_merged([make_chunk(500) for _ in range(9)])  # 3×3
        mf = MergedFile(path)
        assert mf.version == 1
        assert mf.rows == 3
        assert mf.cols == 3
        assert len(mf.index) == 9

    def test_get_chunk_returns_int16_array(self):
        path = write_merged([make_chunk(1000)])
        mf = MergedFile(path)
        chunk = mf.get_chunk(0, 0)
        assert isinstance(chunk, np.ndarray)
        assert chunk.dtype == np.int16
        assert chunk.shape == (256, 256)

    def test_constant_value_chunk_preserved(self):
        val = 1234
        path = write_merged([make_chunk(val)])
        mf = MergedFile(path)
        chunk = mf.get_chunk(0, 0)
        assert chunk[0, 0] == val
        assert chunk[128, 128] == val
        assert chunk[255, 255] == val

    def test_gradient_chunk_roundtrip(self):
        chunk = np.zeros((256, 256), dtype=np.int16)
        for r in range(256):
            chunk[r, :] = r * 10
        path = write_merged([chunk])
        mf = MergedFile(path)
        decoded = mf.get_chunk(0, 0)
        assert decoded[0, 0] == 0
        assert decoded[100, 0] == 1000
        assert decoded[255, 255] == 2550

    def test_nodata_value_preserved(self):
        chunk = np.full((256, 256), -32768, dtype=np.int16)
        path = write_merged([chunk])
        mf = MergedFile(path)
        decoded = mf.get_chunk(0, 0)
        assert decoded[0, 0] == -32768

    def test_negative_elevation_preserved(self):
        chunk = np.full((256, 256), -400, dtype=np.int16)
        path = write_merged([chunk])
        mf = MergedFile(path)
        decoded = mf.get_chunk(0, 0)
        assert decoded[0, 0] == -400

    def test_chunk_out_of_range_raises(self):
        path = write_merged([make_chunk(500) for _ in range(4)])  # 2×2
        mf = MergedFile(path)
        with pytest.raises(ValueError, match="out of range"):
            mf.get_chunk(2, 0)
        with pytest.raises(ValueError, match="out of range"):
            mf.get_chunk(0, 2)
        with pytest.raises(ValueError, match="out of range"):
            mf.get_chunk(-1, 0)

    def test_3x3_grid_all_chunks_readable(self):
        chunks = [make_chunk(i * 111) for i in range(1, 10)]
        path = write_merged(chunks)
        mf = MergedFile(path)
        for r in range(3):
            for c in range(3):
                chunk = mf.get_chunk(r, c)
                assert chunk.shape == (256, 256)
                assert chunk.dtype == np.int16

    def test_different_values_per_chunk(self):
        chunks = [make_chunk(i * 777) for i in range(1, 5)]  # 2×2
        path = write_merged(chunks)
        mf = MergedFile(path)
        for i in range(4):
            chunk = mf.get_chunk(i // 2, i % 2)
            assert chunk[0, 0] == (i + 1) * 777

    def test_high_elevation_values(self):
        """Test values near Mt Everest elevation (8849m)."""
        chunk = np.full((256, 256), 8849, dtype=np.int16)
        path = write_merged([chunk])
        mf = MergedFile(path)
        decoded = mf.get_chunk(0, 0)
        assert decoded[128, 128] == 8849


class TestLatLonToSRTMName:
    """Tests for lat_lon_to_srtm_name."""

    def test_northern_positive_lon(self):
        assert lat_lon_to_srtm_name(40.7128, -74.0060) == "N40W074"

    def test_northern_negative_lon(self):
        assert lat_lon_to_srtm_name(45.0, -90.0) == "N45W090"

    def test_southern_positive_lon(self):
        assert lat_lon_to_srtm_name(-33.8688, 151.2093) == "S33E151"

    def test_southern_negative_lon(self):
        assert lat_lon_to_srtm_name(-34.6, -58.4) == "S34W058"

    def test_exact_zero_lat(self):
        assert lat_lon_to_srtm_name(0.0, 10.0) == "N00E010"

    def test_exact_zero_lon(self):
        assert lat_lon_to_srtm_name(10.0, 0.0) == "N10E000"

    def test_negative_zero_lat(self):
        assert lat_lon_to_srtm_name(-0.5, 10.0) == "S00E010"


class TestSRTMNameToDir:
    """Tests for srtm_name_to_dir."""

    def test_n_tile(self):
        lat_dir, name = srtm_name_to_dir("N40W074")
        assert lat_dir == "N40"
        assert name == "N40W074"

    def test_s_tile(self):
        lat_dir, name = srtm_name_to_dir("S33E151")
        assert lat_dir == "S33"
        assert name == "S33E151"


class TestGetMergedFile:
    """Tests for get_merged_file cache."""

    def test_get_merged_file_caches(self):
        path = write_merged([make_chunk(500)])
        mf1 = get_merged_file(path)
        mf2 = get_merged_file(path)
        assert mf1 is mf2  # Same object from cache


class TestReadElevationFromMerged:
    """Tests for read_elevation_from_merged."""

    def test_nonexistent_dir_returns_none(self):
        result = read_elevation_from_merged(40.0, -74.0, "/nonexistent/path")
        assert result is None

    def test_nonexistent_tile_returns_none(self, tmp_path: Path):
        # Create a directory but no .merged file
        n00 = tmp_path / "N00"
        n00.mkdir()
        result = read_elevation_from_merged(0.5, 0.5, tmp_path)
        assert result is None

    def test_corrupt_merged_returns_none(self, tmp_path: Path):
        """Invalid magic should be caught and return None."""
        n00 = tmp_path / "N00"
        n00.mkdir()
        corrupt = n00 / "N00E000.merged"
        corrupt.write_bytes(b"NOTAMAGIC" + b"\x00" * 100)
        result = read_elevation_from_merged(0.5, 0.5, tmp_path)
        assert result is None

    def test_read_elevation_with_valid_merged_file(self, tmp_path: Path):
        """read_elevation_from_merged with a valid merged file returns elevation."""
        # Create a 15x15 chunk merged file with constant elevation
        n00 = tmp_path / "N00"
        n00.mkdir()
        chunks = [make_chunk(1000) for _ in range(225)]  # 15x15
        data, _ = make_merged_v1(chunks)
        (n00 / "N00E000.merged").write_bytes(data)
        result = read_elevation_from_merged(0.5, 0.5, tmp_path)
        assert result is not None
        assert isinstance(result, float)


class TestDiscoverSRTMTiles:
    """Tests for discover_srtm_tiles."""

    def test_discover_empty_dir(self, tmp_path: Path):
        """Empty directory returns empty index."""
        result = discover_srtm_tiles(tmp_path)
        assert result == {}

    def test_discover_loads_cached_index(self, tmp_path: Path):
        """Cached index JSON is loaded instead of scanning."""
        n00 = tmp_path / "N00"
        n00.mkdir()
        cache = tmp_path / "srtm_index.json"
        cache.write_text(json.dumps({"40,-74": {"has_data": True, "rows": 15, "cols": 15}}))
        result = discover_srtm_tiles(tmp_path)
        assert (40, -74) in result

    def test_discover_validates_cache_json(self, tmp_path: Path):
        """Corrupt cache JSON falls back to scanning."""
        n00 = tmp_path / "N00"
        n00.mkdir()
        cache = tmp_path / "srtm_index.json"
        cache.write_text("not valid json{{{")
        result = discover_srtm_tiles(tmp_path)
        # Falls back to scanning, which finds nothing
        assert result == {}

    def test_discover_skips_invalid_tiles(self, tmp_path: Path):
        """Tiles that raise exceptions during reading are skipped."""
        n00 = tmp_path / "N00"
        n00.mkdir()
        # Write a corrupt .merged file
        corrupt = n00 / "N00E000.merged"
        corrupt.write_bytes(b"NOTAMAGIC" + b"\x00" * 100)
        result = discover_srtm_tiles(tmp_path)
        assert result == {}


# ─── Low-level fixtures for paths the happy-path builder cannot reach ────────


def chunk_payload(values: np.ndarray) -> bytes:
    """Serialize a 256x256 Int16 chunk with the SRTM horizontal predictor."""
    assert values.shape == (256, 256)
    delta = np.zeros_like(values)
    delta[:, 0] = values[:, 0]
    delta[:, 1:] = np.diff(values, axis=1)
    return delta.astype(np.int16).tobytes()


def build_merged_bytes(
    rows: int,
    cols: int,
    payloads: list[bytes],
    *,
    version: int = 1,
    empty_chunks: set[int] | None = None,
) -> bytes:
    """Assemble a raw OZCHNK01 file, with optional zero-size (ocean) chunks."""
    empty_chunks = empty_chunks or set()
    assert len(payloads) == rows * cols

    buf = bytearray(MAGIC)
    buf += struct.pack("<H", version)
    buf += bytes([rows, cols])
    index_start = len(buf)
    buf += b"\x00" * (rows * cols * INDEX_ENTRY_SIZE)

    entries = []
    for i, payload in enumerate(payloads):
        if i in empty_chunks:
            entries.append((0, 0))
            continue
        compressed = zlib.compress(payload, 1)
        entries.append((len(buf), len(compressed)))
        buf += compressed

    for i, (offset, size) in enumerate(entries):
        struct.pack_into("<I", buf, index_start + i * INDEX_ENTRY_SIZE, offset)
        struct.pack_into("<I", buf, index_start + i * INDEX_ENTRY_SIZE + 4, size)

    return bytes(buf)


def write_tile(directory: Path, name: str, data: bytes) -> Path:
    """Write a .merged payload into its ``N00/``-style subdirectory."""
    lat_dir = name[:3]
    tile_dir = directory / lat_dir
    tile_dir.mkdir(parents=True, exist_ok=True)
    path = tile_dir / f"{name}.merged"
    path.write_bytes(data)
    return path


class TestChunkCache:
    """The process-level chunk cache."""

    def test_second_read_is_served_from_cache(self, tmp_path: Path):
        path = write_merged([make_chunk(4242)])
        mf = MergedFile(path)
        first = mf.get_chunk(0, 0)
        second = mf.get_chunk(0, 0)
        assert second is first  # Same object, not a re-decompression
        assert second[10, 10] == 4242


class TestVersion2Float32:
    """Version 2 (Copernicus Float32) chunks carry no predictor."""

    def test_float32_chunk_decodes_verbatim(self, tmp_path: Path):
        grid = np.arange(65536, dtype=np.float32).reshape(256, 256)
        payload = grid.tobytes()
        path = tmp_path / "V2.merged"
        path.write_bytes(build_merged_bytes(1, 1, [payload], version=2))

        mf = MergedFile(path)
        assert mf.version == 2
        chunk = mf.get_chunk(0, 0)
        assert chunk.dtype == np.float32
        assert chunk.shape == (256, 256)
        # Raw values, no horizontal differencing to undo
        assert float(chunk[0, 0]) == 0.0
        assert float(chunk[0, 5]) == 5.0
        assert float(chunk[255, 255]) == 65535.0


class TestReadElevationNoDataPaths:
    """read_elevation_from_merged returning None for missing data."""

    @staticmethod
    def _write_grid(tmp_path: Path, value: int, *, empty_chunks: set[int] | None = None) -> Path:
        payloads = [chunk_payload(np.full((256, 256), value, dtype=np.int16)) for _ in range(225)]
        data = build_merged_bytes(15, 15, payloads, empty_chunks=empty_chunks)
        return write_tile(tmp_path, "N00E000", data)

    def test_zero_size_chunk_is_ocean(self, tmp_path: Path):
        """A chunk with a zero-size index entry is nodata for any point in it."""
        self._write_grid(tmp_path, 1000, empty_chunks={7 * 15 + 7})
        # (0.5, 0.5) falls in chunk (7, 7)
        assert read_elevation_from_merged(0.5, 0.5, tmp_path) is None

    def test_nodata_sentinel_pixel_returns_none(self, tmp_path: Path):
        self._write_grid(tmp_path, -32768)
        assert read_elevation_from_merged(0.5, 0.5, tmp_path) is None

    def test_valid_pixel_returns_elevation(self, tmp_path: Path):
        self._write_grid(tmp_path, 1234)
        assert read_elevation_from_merged(0.5, 0.5, tmp_path) == 1234.0


class TestDiscoverSRTMTilesCaching:
    """Index cache reuse, sign handling and unwritable cache files."""

    def test_index_is_cached_per_directory(self, tmp_path: Path):
        write_tile(tmp_path, "N10E000", build_merged_bytes(1, 1, [chunk_payload(make_chunk(500))]))
        first = discover_srtm_tiles(tmp_path)
        second = discover_srtm_tiles(tmp_path)
        assert first is second  # Served from the process-level cache
        assert first == {(10, 0): {"has_data": True, "rows": 1, "cols": 1}}

    def test_scans_southern_and_western_tiles(self, tmp_path: Path):
        """S and W prefixes produce negative indices; N/E stay positive."""
        payload = chunk_payload(make_chunk(500))
        for name in ("N00E000", "S33E151", "N40W074", "S34W058"):
            write_tile(tmp_path, name, build_merged_bytes(2, 3, [payload] * 6))

        # Pre-seed an unwritable cache file: scanning must still succeed.
        (tmp_path / "srtm_index.json").mkdir()

        result = discover_srtm_tiles(tmp_path)
        assert set(result) == {(0, 0), (-33, 151), (40, -74), (-34, -58)}
        assert all(entry == {"has_data": True, "rows": 2, "cols": 3} for entry in result.values())
        assert (tmp_path / "srtm_index.json").is_dir()  # Never overwritten

    def test_unwritable_index_file_is_ignored(self, tmp_path: Path):
        """A cache path that cannot be written must not break the scan."""
        write_tile(tmp_path, "N10E000", build_merged_bytes(1, 1, [chunk_payload(make_chunk(500))]))
        (tmp_path / "srtm_index.json").mkdir()  # exists() is True, read/write fail

        result = discover_srtm_tiles(tmp_path)
        assert result == {(10, 0): {"has_data": True, "rows": 1, "cols": 1}}
        assert (tmp_path / "srtm_index.json").is_dir()


class TestModuleSelfTest:
    """The ``python -m openzenith.merged`` smoke-test entry point."""

    def test_prints_grid_and_chunk_summary(self, tmp_path: Path, capsys, monkeypatch):
        payload = chunk_payload(make_chunk(1234))
        path = write_tile(tmp_path, "N01E001", build_merged_bytes(2, 2, [payload] * 4))
        monkeypatch.setattr(sys, "argv", ["merged.py", str(path)])

        runpy.run_path(str(merged.__file__), run_name="__main__")

        out = capsys.readouterr().out
        assert "Version: 1, Grid: 2x2" in out
        assert "Chunk shape: (256, 256)" in out
        assert "range: 1234 to 1234" in out

    def test_without_argument_does_nothing(self, tmp_path: Path, capsys, monkeypatch):
        monkeypatch.setattr(sys, "argv", ["merged.py"])
        runpy.run_path(str(merged.__file__), run_name="__main__")
        assert capsys.readouterr().out == ""
