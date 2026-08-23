"""Tests for OZT2 tile format (v2)."""

import numpy as np
import pytest

from openzenith.tile_format_v2 import (
    COMP_BROTLI,
    COMP_ZLIB,
    COMP_ZSTD,
    PRED_GRADIENT,
    PRED_LEFT,
    PRED_NONE,
    auto_encode,
    decode,
    encode,
    validate_roundtrip,
)

ATOL = 1  # OZT2 has ~1 unit quantization precision


class TestEncodeDecode:
    """Roundtrip tests for encode/decode."""

    def test_basic_roundtrip(self):
        data = np.array([[100, 200, 300], [150, 250, 350], [200, 300, 400]], dtype=np.int16)
        encoded = encode(data, compressor=COMP_ZLIB)
        decoded, _meta = decode(encoded)
        assert decoded.shape == data.shape
        np.testing.assert_allclose(data, decoded, atol=ATOL)

    def test_brotli_roundtrip(self):
        data = np.random.randint(0, 2000, size=(50, 50)).astype(np.int16)
        encoded = encode(data, compressor=COMP_BROTLI)
        decoded, _meta = decode(encoded)
        np.testing.assert_allclose(data, decoded, atol=ATOL)

    def test_preserves_shape(self):
        data = np.random.randint(0, 5000, size=(30, 30)).astype(np.int16)
        encoded = encode(data)
        decoded, _ = decode(encoded)
        assert decoded.shape == data.shape

    def test_preserves_dtype(self):
        data = np.random.randint(0, 3000, size=(10, 10)).astype(np.int16)
        encoded = encode(data)
        decoded, _ = decode(encoded)
        assert decoded.dtype == np.int16

    def test_metadata_keys(self):
        data = np.ones((5, 5), dtype=np.int16) * 100
        encoded = encode(data)
        _, meta = decode(encoded)
        assert "version" in meta
        assert "compressor" in meta
        assert "predictor" in meta

    def test_large_random_roundtrip(self):
        data = np.random.randint(-500, 5000, size=(200, 200)).astype(np.int16)
        encoded = encode(data, compressor=COMP_ZSTD)
        decoded, _ = decode(encoded)
        np.testing.assert_allclose(data, decoded, atol=ATOL)

    def test_negative_elevations(self):
        data = np.array([[-100, -50], [10, 20]], dtype=np.int16)
        encoded = encode(data)
        decoded, _ = decode(encoded)
        np.testing.assert_allclose(data, decoded, atol=ATOL)


class TestPredictors:
    """Test different prediction modes."""

    def test_no_predictor(self):
        data = np.random.randint(0, 3000, size=(20, 20)).astype(np.int16)
        encoded = encode(data, predictor=PRED_NONE)
        decoded, _ = decode(encoded)
        np.testing.assert_allclose(data, decoded, atol=ATOL)

    def test_left_predictor(self):
        data = np.random.randint(0, 3000, size=(20, 20)).astype(np.int16)
        encoded = encode(data, predictor=PRED_LEFT)
        decoded, _ = decode(encoded)
        np.testing.assert_allclose(data, decoded, atol=ATOL)

    def test_gradient_predictor(self):
        data = np.random.randint(0, 3000, size=(20, 20)).astype(np.int16)
        encoded = encode(data, predictor=PRED_GRADIENT)
        decoded, _ = decode(encoded)
        np.testing.assert_allclose(data, decoded, atol=ATOL)


class TestAutoEncode:
    """Test auto_encode convenience function."""

    def test_returns_tuple(self):
        data = np.random.randint(0, 2000, size=(30, 30)).astype(np.int16)
        result = auto_encode(data)
        assert isinstance(result, tuple)
        assert len(result) == 2
        assert isinstance(result[0], bytes)
        assert len(result[0]) > 0

    def test_roundtrip(self):
        data = np.random.randint(0, 2000, size=(30, 30)).astype(np.int16)
        encoded, _meta = auto_encode(data)
        decoded, _ = decode(encoded)
        np.testing.assert_allclose(data, decoded, atol=ATOL)


class TestValidateRoundtrip:
    """Test validate_roundtrip utility."""

    def test_valid_roundtrip(self):
        data = np.random.randint(0, 2000, size=(30, 30)).astype(np.int16)
        _is_lossless, rmse, meta = validate_roundtrip(data)
        # Quantized tile won't be lossless but RMSE should be < 1m
        assert rmse < 1.0
        assert meta["bits_per_pixel"] > 0


class TestAutoSelectBits:
    """Test _auto_select_bits edge cases via encode."""

    def test_explicit_bits_per_pixel_16(self):
        """Explicit 16-bit should use lossless mode."""
        data = np.array([[100, 200], [300, 400]], dtype=np.int16)
        encoded = encode(data, bits_per_pixel=16)
        decoded, meta = decode(encoded)
        assert meta["bits_per_pixel"] == 16
        # Lossless should have zero error
        np.testing.assert_allclose(data, decoded, atol=0)

    def test_explicit_bits_per_pixel_8(self):
        """Explicit 8-bit should quantize even small ranges."""
        data = np.array([[100, 200], [300, 400]], dtype=np.int16)
        encoded = encode(data, bits_per_pixel=8)
        decoded, meta = decode(encoded)
        assert meta["bits_per_pixel"] == 8

    def test_all_nodata_tile(self):
        """All-NODATA tile should not crash."""
        data = np.full((8, 8), -32768, dtype=np.int16)
        encoded = encode(data)
        decoded, meta = decode(encoded)
        assert decoded.shape == data.shape


class TestEdgeCases:
    """Edge case tests."""

    def test_single_cell(self):
        data = np.array([[42]], dtype=np.int16)
        encoded = encode(data)
        decoded, _ = decode(encoded)
        np.testing.assert_allclose(data, decoded, atol=ATOL)

    def test_invalid_bytes_raises(self):
        with pytest.raises(Exception):  # noqa: B017
            decode(b"not valid tile data")

    def test_zstd_compressor(self):
        """Test zstd compressor roundtrip."""
        data = np.random.randint(0, 3000, size=(30, 30)).astype(np.int16)
        encoded = encode(data, compressor=COMP_ZSTD)
        decoded, _ = decode(encoded)
        np.testing.assert_allclose(data, decoded, atol=ATOL)

    def test_zlib_compressor(self):
        """Test zlib compressor roundtrip."""
        data = np.random.randint(-200, 3000, size=(25, 25)).astype(np.int16)
        encoded = encode(data, compressor=COMP_ZLIB)
        decoded, _ = decode(encoded)
        np.testing.assert_allclose(data, decoded, atol=ATOL)

    def test_mixed_nodata_and_valid(self):
        """Tile with some nodata cells should handle correctly."""
        data = np.full((10, 10), -32768, dtype=np.int16)
        data[3:7, 3:7] = 500  # valid patch in center
        encoded = encode(data)
        decoded, _ = decode(encoded)
        # Center values should be preserved
        assert decoded[5, 5] == 500

    def test_large_range_16bit(self):
        """Large elevation range uses 16-bit."""
        data = np.array([[-5000, 8000], [0, 0]], dtype=np.int16)
        encoded = encode(data, bits_per_pixel=16)
        decoded, meta = decode(encoded)
        assert meta["bits_per_pixel"] == 16
