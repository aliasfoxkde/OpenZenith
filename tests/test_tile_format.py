"""Tests for openzenith.tile_format module."""

import numpy as np
import pytest
from openzenith.tile_format import (
    COMP_NONE,
    COMP_ZSTD,
    COMP_ZSTD_DELTA,
    COMP_ZSTD_PREDICT,
    HEADER_SIZE,
    TileError,
    decode,
    encode,
    validate_roundtrip,
)


def _make_tile(size: int = 256, min_val: int = 0, max_val: int = 5000) -> np.ndarray:
    """Create a synthetic elevation tile with a gradient pattern."""
    rows = np.linspace(min_val, max_val, size).reshape(-1, 1)
    cols = np.linspace(0, max_val * 0.3, size).reshape(1, -1)
    tile = (rows + cols).astype(np.int16)
    return tile


class TestEncode:
    def test_basic_encode_returns_bytes(self):
        tile = _make_tile(64)
        result = encode(tile)
        assert isinstance(result, bytes)
        assert len(result) > HEADER_SIZE

    def test_encode_header_magic(self):
        tile = _make_tile(64)
        result = encode(tile)
        assert result[:4] == b"OZT1"

    def test_encode_header_size(self):
        tile = _make_tile(64)
        result = encode(tile)
        assert len(result) >= HEADER_SIZE

    def test_encode_non_2d_raises(self):
        with pytest.raises(TileError, match="2D array"):
            encode(np.array([1, 2, 3]))


class TestDecode:
    def test_basic_roundtrip(self):
        tile = _make_tile(64)
        encoded = encode(tile)
        decoded, meta = decode(encoded)
        assert np.array_equal(tile, decoded)
        assert meta["width"] == 64
        assert meta["height"] == 64
        assert meta["bits_per_sample"] == 16

    def test_decode_metadata(self):
        tile = np.full((64, 64), 1234, dtype=np.int16)
        encoded = encode(tile)
        _, meta = decode(encoded)
        assert meta["width"] == 64
        assert meta["height"] == 64
        assert meta["bits_per_sample"] == 16
        assert meta["compression_name"] == "zstd+predict"
        assert meta["min_elevation"] == 1234
        assert meta["max_elevation"] == 1234
        assert meta["tile_size_bytes"] == 64 * 64 * 2

    def test_decode_invalid_magic_raises(self):
        with pytest.raises(TileError, match="magic"):
            decode(b"XXXX" + b"\x00" * 14)

    def test_decode_too_short_raises(self):
        with pytest.raises(TileError, match="too small"):
            decode(b"\x00" * 10)

    def test_decode_invalid_version_raises(self):
        tile = _make_tile(32)
        encoded = bytearray(encode(tile))
        encoded[4] = 99  # corrupt version
        with pytest.raises(TileError, match="version"):
            decode(bytes(encoded))


class TestCompressionModes:
    @pytest.mark.parametrize("mode", [COMP_NONE, COMP_ZSTD, COMP_ZSTD_DELTA, COMP_ZSTD_PREDICT])
    def test_lossless_roundtrip(self, mode):
        tile = _make_tile(128)
        encoded = encode(tile, compression=mode)
        decoded, meta = decode(encoded)
        assert np.array_equal(tile, decoded)
        assert meta["compression"] == mode

    def test_predict_is_smaller_than_raw(self):
        tile = _make_tile(256)
        raw = encode(tile, compression=COMP_NONE)
        predicted = encode(tile, compression=COMP_ZSTD_PREDICT)
        assert len(predicted) < len(raw)


class TestQuantization:
    @pytest.mark.parametrize("bits", [8, 10, 12, 14])
    def test_quantized_roundtrip_is_lossy(self, bits):
        tile = _make_tile(128, 0, 5000)
        encoded = encode(tile, quantize_bits=bits)
        decoded, meta = decode(encoded)
        assert meta["bits_per_sample"] == bits
        assert not np.array_equal(tile, decoded)

    def test_q12_has_low_rmse(self):
        tile = _make_tile(256, 0, 5000)
        encoded = encode(tile, quantize_bits=12)
        decoded, _ = decode(encoded)
        valid = tile != -32768
        rmse = float(np.sqrt(np.mean((tile[valid] - decoded[valid]) ** 2)))
        assert rmse < 5.0

    def test_q8_visual_compression(self):
        tile = _make_tile(256, 0, 5000)
        encoded = encode(tile, quantize_bits=8)
        _decoded, meta = decode(encoded)
        assert meta["bits_per_sample"] == 8
        assert encoded != encode(tile, quantize_bits=16)


class TestNodata:
    def test_all_nodata(self):
        tile = np.full((64, 64), -32768, dtype=np.int16)
        encoded = encode(tile)
        decoded, _meta = decode(encoded)
        assert np.array_equal(tile, decoded)

    def test_partial_nodata(self):
        tile = _make_tile(64)
        tile[:10, :] = -32768
        encoded = encode(tile)
        decoded, _ = decode(encoded)
        valid = tile != -32768
        assert np.array_equal(tile[valid], decoded[valid])

    def test_custom_nodata(self):
        tile = np.full((64, 64), -9999, dtype=np.int16)
        encoded = encode(tile, nodata_value=-9999)
        decoded, _ = decode(encoded)
        assert np.array_equal(tile, decoded)


class TestValidateRoundtrip:
    def test_lossless_returns_true(self):
        tile = _make_tile(128)
        ok, err, _meta = validate_roundtrip(tile)
        assert ok is True
        assert err == 0.0

    def test_lossy_returns_false_with_rmse(self):
        tile = _make_tile(128)
        ok, rmse, _meta = validate_roundtrip(tile, quantize_bits=10)
        assert ok is False
        assert rmse > 0.0

    def test_compression_modes_all_pass(self):
        tile = _make_tile(64)
        for mode in [COMP_NONE, COMP_ZSTD, COMP_ZSTD_DELTA, COMP_ZSTD_PREDICT]:
            ok, err, _meta = validate_roundtrip(tile, compression=mode)
            assert ok is True, f"Failed for mode {mode}: err={err}"


class TestEdgeCases:
    def test_single_pixel(self):
        tile = np.array([[1234]], dtype=np.int16)
        encoded = encode(tile)
        decoded, _ = decode(encoded)
        assert np.array_equal(tile, decoded)

    def test_tiny_tile(self):
        tile = np.array([[100, 200], [300, 400]], dtype=np.int16)
        encoded = encode(tile)
        decoded, _ = decode(encoded)
        assert np.array_equal(tile, decoded)

    def test_large_values(self):
        tile = np.full((64, 64), 32000, dtype=np.int16)
        encoded = encode(tile)
        decoded, _ = decode(encoded)
        assert np.array_equal(tile, decoded)

    def test_negative_elevation(self):
        tile = np.array([[-100, -200], [-50, -150]], dtype=np.int16)
        encoded = encode(tile, nodata_value=-32768)
        decoded, _ = decode(encoded)
        assert np.array_equal(tile, decoded)
