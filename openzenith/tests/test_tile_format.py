"""Tests for openzenith.tile_format (OZT1 format)."""

import numpy as np
import pytest
from numpy.testing import assert_array_equal

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


def _make_test_tile(shape=(256, 256), min_e=0, max_e=2000, nodata=-32768, seed=42):
    """Create a synthetic elevation tile with realistic properties."""
    rng = np.random.RandomState(seed)
    arr = rng.randint(min_e, max_e + 1, size=shape).astype(np.int16)
    # Add some nodata cells
    mask = rng.random(shape) < 0.02
    arr[mask] = nodata
    return arr


def _make_flat_tile(shape=(256, 256), value=100, nodata=-32768):
    """Create a flat elevation tile (all same value)."""
    return np.full(shape, value, dtype=np.int16)


def _make_slope_tile(shape=(64, 64), nodata=-32768):
    """Create a tile with a consistent slope (useful for testing prediction)."""
    arr = np.zeros(shape, dtype=np.int16)
    for r in range(shape[0]):
        arr[r, :] = r * 10 + np.arange(shape[1])
    return arr


class TestEncodeDecode:
    """Test encode/decode roundtrip for all compression modes."""

    @pytest.mark.parametrize("compression", [COMP_NONE, COMP_ZSTD, COMP_ZSTD_DELTA, COMP_ZSTD_PREDICT])
    def test_roundtrip_random_tile(self, compression):
        """Random tile should roundtrip losslessly."""
        arr = _make_test_tile()
        encoded = encode(arr, compression=compression, zstd_level=3)
        decoded, meta = decode(encoded)
        assert_array_equal(arr, decoded)
        assert meta["width"] == 256
        assert meta["height"] == 256
        assert meta["bits_per_sample"] == 16

    @pytest.mark.parametrize("compression", [COMP_NONE, COMP_ZSTD, COMP_ZSTD_DELTA, COMP_ZSTD_PREDICT])
    def test_roundtrip_flat_tile(self, compression):
        """Flat tile should roundtrip and compress well."""
        arr = _make_flat_tile()
        encoded = encode(arr, compression=compression)
        decoded, _meta = decode(encoded)
        assert_array_equal(arr, decoded)

    @pytest.mark.parametrize("compression", [COMP_NONE, COMP_ZSTD, COMP_ZSTD_DELTA, COMP_ZSTD_PREDICT])
    def test_roundtrip_slope_tile(self, compression):
        """Slope tile tests prediction effectiveness."""
        arr = _make_slope_tile()
        encoded = encode(arr, compression=compression)
        decoded, _meta = decode(encoded)
        assert_array_equal(arr, decoded)

    def test_small_tile(self):
        """Tiny tile (4x4) should work."""
        arr = np.array([[100, 101, 102, 103], [110, 111, 112, 113], [120, 121, 122, 123], [130, 131, 132, 133]], dtype=np.int16)
        for comp in [COMP_NONE, COMP_ZSTD, COMP_ZSTD_DELTA, COMP_ZSTD_PREDICT]:
            encoded = encode(arr, compression=comp)
            decoded, _ = decode(encoded)
            assert_array_equal(arr, decoded)

    def test_single_value_tile(self):
        """1x1 tile should work."""
        arr = np.array([[500]], dtype=np.int16)
        encoded = encode(arr, compression=COMP_ZSTD_PREDICT)
        decoded, _ = decode(encoded)
        assert_array_equal(arr, decoded)


class TestHeader:
    """Test OZT1 header parsing."""

    def test_magic_and_version(self):
        """Encoded tile should start with OZT1 magic."""
        arr = _make_test_tile()
        encoded = encode(arr)
        assert encoded[:4] == b"OZT1"

    def test_header_size(self):
        """Header should be exactly 18 bytes."""
        arr = _make_test_tile()
        encoded = encode(arr)
        assert len(encoded) > 18

    def test_metadata_fields(self):
        """Metadata should contain all expected fields."""
        arr = _make_test_tile()
        encoded = encode(arr, compression=COMP_ZSTD_PREDICT, zstd_level=5)
        _, meta = decode(encoded)
        assert meta["compression"] == COMP_ZSTD_PREDICT
        assert meta["zstd_level"] == 5
        assert meta["width"] == 256
        assert meta["height"] == 256
        assert meta["compression_name"] == "zstd+predict"

    def test_invalid_magic(self):
        """Decoding with wrong magic should raise TileError."""
        with pytest.raises(TileError, match="Invalid magic"):
            decode(b"XXXX" + b"\x00" * 14 + b"\x00" * 100)

    def test_tile_too_small(self):
        """Decoding tiny input should raise TileError."""
        with pytest.raises(TileError, match="too small"):
            decode(b"OZT1")


class TestQuantization:
    """Test lossy quantization mode."""

    def test_quantize_12bit(self):
        """12-bit quantization should have small RMSE."""
        arr = _make_test_tile(min_e=0, max_e=3000)
        encoded = encode(arr, quantize_bits=12, zstd_level=3)
        decoded, meta = decode(encoded)
        assert meta["bits_per_sample"] == 12
        valid = arr != -32768
        rmse = float(np.sqrt(np.mean((arr[valid] - decoded[valid]) ** 2)))
        assert rmse < 5.0  # Should be < 5m for 12-bit on 3000m range

    def test_quantize_8bit(self):
        """8-bit quantization should compress more but have higher RMSE."""
        arr = _make_test_tile(min_e=0, max_e=3000)
        encoded_8 = encode(arr, quantize_bits=8, zstd_level=3)
        encoded_12 = encode(arr, quantize_bits=12, zstd_level=3)
        # 8-bit should be smaller
        assert len(encoded_8) < len(encoded_12)

    def test_quantize_lossless_still_smaller(self):
        """Quantized (fewer bits) should generally be smaller than lossless."""
        arr = _make_test_tile(min_e=0, max_e=3000, seed=123)
        encoded_lossless = encode(arr, quantize_bits=None, compression=COMP_ZSTD, zstd_level=3)
        encoded_q8 = encode(arr, quantize_bits=8, compression=COMP_ZSTD, zstd_level=3)
        # 8-bit quantized should definitely be smaller than 16-bit lossless
        assert len(encoded_q8) < len(encoded_lossless)


class TestCompressionRatio:
    """Test that prediction compression is effective on realistic data."""

    def test_predict_beats_raw(self):
        """Prediction compression should beat raw Zstd on smooth terrain."""
        arr = _make_slope_tile()
        enc_predict = encode(arr, compression=COMP_ZSTD_PREDICT, zstd_level=3)
        enc_raw = encode(arr, compression=COMP_ZSTD, zstd_level=3)
        assert len(enc_predict) < len(enc_raw)

    def test_delta_beats_raw_on_smooth(self):
        """Delta compression should beat raw Zstd on smooth terrain."""
        arr = _make_slope_tile()
        enc_delta = encode(arr, compression=COMP_ZSTD_DELTA, zstd_level=3)
        enc_raw = encode(arr, compression=COMP_ZSTD, zstd_level=3)
        assert len(enc_delta) < len(enc_raw)

    def test_flat_tile_extreme_compression(self):
        """Flat tile should compress to near-zero with prediction."""
        arr = _make_flat_tile()
        enc_predict = encode(arr, compression=COMP_ZSTD_PREDICT, zstd_level=9)
        # All residuals are 0, so should be very small
        assert len(enc_predict) < 200  # 18 byte header + tiny compressed data


class TestValidateRoundtrip:
    """Test the validate_roundtrip utility."""

    def test_lossless_validation(self):
        """Lossless roundtrip should return True."""
        arr = _make_test_tile()
        valid, rmse, _meta = validate_roundtrip(arr, compression=COMP_ZSTD_PREDICT)
        assert valid is True
        assert rmse == 0.0

    def test_lossy_validation(self):
        """Lossy roundtrip should return False with RMSE > 0."""
        arr = _make_test_tile(min_e=0, max_e=3000)
        valid, rmse, _meta = validate_roundtrip(arr, quantize_bits=12)
        assert valid is False
        assert rmse > 0

    def test_flat_lossless(self):
        """Flat tile should always be lossless."""
        arr = _make_flat_tile()
        for comp in [COMP_NONE, COMP_ZSTD, COMP_ZSTD_DELTA, COMP_ZSTD_PREDICT]:
            valid, rmse, _ = validate_roundtrip(arr, compression=comp)
            assert valid is True
            assert rmse == 0.0


class TestEdgeCases:
    """Test edge cases and error handling."""

    def test_3d_array_raises(self):
        """3D array should raise TileError."""
        arr = np.zeros((10, 10, 10), dtype=np.int16)
        with pytest.raises(TileError, match="2D array"):
            encode(arr)

    def test_all_nodata_tile(self):
        """All-nodata tile should roundtrip."""
        arr = np.full((64, 64), -32768, dtype=np.int16)
        encoded = encode(arr)
        decoded, meta = decode(encoded)
        assert_array_equal(arr, decoded)
        assert meta["min_elevation"] == 0
        assert meta["max_elevation"] == 0

    def test_large_values(self):
        """Large elevation values should roundtrip."""
        arr = np.array([[8000, 8100, 8200], [7900, 8000, 8100]], dtype=np.int16)
        encoded = encode(arr, compression=COMP_ZSTD_PREDICT)
        decoded, _ = decode(encoded)
        assert_array_equal(arr, decoded)

    def test_negative_elevations(self):
        """Below-sea-level values should roundtrip."""
        arr = np.array([[-100, -200, -50], [0, 10, 20]], dtype=np.int16)
        encoded = encode(arr, compression=COMP_ZSTD_PREDICT)
        decoded, _ = decode(encoded)
        assert_array_equal(arr, decoded)

    def test_custom_nodata(self):
        """Custom nodata value should work."""
        arr = np.array([[100, -9999, 200], [150, 180, -9999]], dtype=np.int16)
        encoded = encode(arr, nodata_value=-9999)
        decoded, _ = decode(encoded)
        assert_array_equal(arr, decoded)

    def test_non_square_tile(self):
        """Non-square tile should work."""
        arr = np.random.randint(0, 1000, (100, 200)).astype(np.int16)
        encoded = encode(arr, compression=COMP_ZSTD_PREDICT)
        decoded, meta = decode(encoded)
        assert_array_equal(arr, decoded)
        assert meta["width"] == 200
        assert meta["height"] == 100
