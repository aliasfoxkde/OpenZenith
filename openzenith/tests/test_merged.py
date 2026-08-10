"""Tests for OZCHNK01 .merged file reader (merged.py)."""

import struct
import tempfile
import zlib

import numpy as np
import pytest

from openzenith.merged import INDEX_ENTRY_SIZE, MAGIC, MergedFile


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
