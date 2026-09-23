"""Tests for OZT2 tile format (v2)."""

import contextlib
import importlib
import struct
import sys

import numpy as np
import pytest

from openzenith import tile_format_v2
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
        _decoded, meta = decode(encoded)
        assert meta["bits_per_pixel"] == 8

    def test_all_nodata_tile(self):
        """All-NODATA tile should not crash."""
        data = np.full((8, 8), -32768, dtype=np.int16)
        encoded = encode(data)
        decoded, _meta = decode(encoded)
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
        _decoded, meta = decode(encoded)
        assert meta["bits_per_pixel"] == 16


@contextlib.contextmanager
def _hide_modules(*names: str):
    """Re-import ``tile_format_v2`` as if ``names`` were not installed.

    The module resolves its optional compressors at import time (``HAS_BROTLI`` /
    ``HAS_ZSTD`` / ``HAS_ZLIB``), so the only way to exercise the ImportError
    branches is to make the imports fail for one reload. Binding ``None`` in
    ``sys.modules`` makes ``import name`` raise ImportError.

    ``numpy.random`` is pre-loaded because numpy imports ``zlib`` lazily.

    State is restored from a snapshot of the module ``__dict__`` (not a second
    reload) so every object identity — in particular ``TileError``, which other
    modules catch by name — survives the experiment untouched.
    """
    import numpy.random  # noqa: F401  (pre-load: numpy pulls zlib in lazily)

    snapshot = dict(tile_format_v2.__dict__)
    saved = {name: sys.modules.get(name) for name in names}
    try:
        for name in names:
            sys.modules[name] = None
        importlib.reload(tile_format_v2)
        yield
    finally:
        for name, module in saved.items():
            if module is None:
                sys.modules.pop(name, None)
            else:
                sys.modules[name] = module
        tile_format_v2.__dict__.clear()
        tile_format_v2.__dict__.update(snapshot)


class TestOptionalCompressorFallbacks:
    """Degraded-compressor paths selected at import time."""

    def test_brotli_missing_falls_back_to_zlib(self):
        """Without brotli the tile is zlib-compressed but still roundtrips."""
        data = np.arange(0, 1600, dtype=np.int16).reshape(40, 40)
        with _hide_modules("brotli"):
            assert tile_format_v2.HAS_BROTLI is False
            assert tile_format_v2.HAS_ZLIB is True
            encoded = tile_format_v2.encode(data, compressor=COMP_BROTLI)
            decoded, _meta = tile_format_v2.decode(encoded)
        np.testing.assert_allclose(data, decoded, atol=ATOL)

    def test_zstd_missing_falls_back_to_zlib(self):
        """Without zstandard a COMP_ZSTD tile falls back to zlib and roundtrips."""
        data = np.arange(-800, 800, dtype=np.int16).reshape(40, 40)
        with _hide_modules("zstandard"):
            assert tile_format_v2.HAS_ZSTD is False
            encoded = tile_format_v2.encode(data, compressor=COMP_ZSTD)
            decoded, _meta = tile_format_v2.decode(encoded)
        np.testing.assert_allclose(data, decoded, atol=ATOL)

    def test_zlib_missing_rejects_zlib_tiles(self):
        """Without zlib neither encoding nor decoding a COMP_ZLIB tile works."""
        residuals = np.arange(16, dtype=np.int16).tobytes()
        zlib_tile = (
            struct.pack("<h", 0)
            + struct.pack("<H", 0)
            + bytes([16, (COMP_ZLIB << 2)])
            + tile_format_v2.zlib.compress(residuals)
        )
        data = np.arange(256, dtype=np.int16).reshape(16, 16)
        with _hide_modules("zlib"):
            assert tile_format_v2.HAS_ZLIB is False
            with pytest.raises(Exception, match="No compressor available"):
                tile_format_v2.encode(data, compressor=COMP_ZLIB)
            with pytest.raises(Exception, match="No decompressor available"):
                tile_format_v2.decode(zlib_tile)

    def test_no_compressor_at_all_raises(self):
        """With every backend missing, compression is a hard error."""
        data = np.zeros((8, 8), dtype=np.int16)
        with _hide_modules("brotli", "zstandard", "zlib"):
            available = (
                tile_format_v2.HAS_BROTLI,
                tile_format_v2.HAS_ZSTD,
                tile_format_v2.HAS_ZLIB,
            )
            assert not any(available)
            with pytest.raises(Exception, match="No compressor available"):
                tile_format_v2.encode(data, compressor=COMP_BROTLI)
            with pytest.raises(Exception, match="No decompressor available"):
                tile_format_v2._decompress(b"", COMP_BROTLI)

    def test_fallback_records_itself_in_the_flags_byte(self):
        """A brotli-less host's zlib fallback is labelled zlib, not brotli.

        Regression: ``_compress`` used to substitute zlib silently while the
        header kept ``compressor=COMP_BROTLI``, so tiles produced on a
        brotli-less host were rejected by hosts that *do* have brotli.
        The flags byte (offset 5, compressor in bits 2-3) now records the
        compressor actually used, so any host can decode the tile.
        """
        data = np.zeros((8, 8), dtype=np.int16)
        with _hide_modules("brotli"):
            encoded = tile_format_v2.encode(data, compressor=COMP_BROTLI)
        assert tile_format_v2.HAS_BROTLI is True

        assert (encoded[5] & 0b00001100) >> 2 == COMP_ZLIB
        decoded, meta = decode(encoded)
        assert meta["compressor"] == "zlib"
        np.testing.assert_array_equal(decoded, data)


class TestQuantizationHelpers:
    """Direct tests for the quantization helpers (the lossy path's primitives)."""

    def test_quantize_zero_range_returns_all_zeros(self):
        """A constant grid has no range to preserve — everything maps to 0."""
        grid = np.full((4, 4), 100, dtype=np.int16)
        quantized = tile_format_v2._quantize(grid, vmin=100, bits=8)
        assert quantized.dtype == np.int32
        np.testing.assert_array_equal(quantized, np.zeros((4, 4), dtype=np.int32))

    def test_quantize_spans_full_bit_range(self):
        """Minimum maps to 0, maximum maps to 2^bits - 1."""
        grid = np.array([[1000, 1000], [3000, 3000]], dtype=np.int16)
        quantized = tile_format_v2._quantize(grid, vmin=1000, bits=8)
        assert int(quantized.min()) == 0
        assert int(quantized.max()) == 255

    def test_dequantize_roundtrip(self):
        """De-quantization is the inverse mapping back into metres."""
        quantized = np.array([0, 128, 255], dtype=np.int32)
        meters = tile_format_v2._dequantize(quantized, vmin=100, bits=8, original_range=200)
        np.testing.assert_allclose(meters, [100, 200, 300], atol=1)

    def test_dequantize_zero_range_returns_vmin(self):
        """Zero original range (flat tile) de-quantizes to vmin everywhere."""
        meters = tile_format_v2._dequantize(
            np.array([7, 123], dtype=np.int32), vmin=42, bits=8, original_range=0
        )
        np.testing.assert_array_equal(meters, [42, 42])
        assert meters.dtype == np.int16


class TestDecodeInputValidation:
    """Header validation and dimension inference on the decode side."""

    def test_encode_rejects_non_2d(self):
        with pytest.raises(tile_format_v2.TileError, match="Expected 2D array, got 1D"):
            encode(np.arange(5, dtype=np.int16))

    def test_decode_rejects_tile_shorter_than_header(self):
        with pytest.raises(tile_format_v2.TileError, match="Tile too small: 3 bytes"):
            decode(b"OZT")

    def test_decode_rejects_invalid_bit_depth(self):
        tile = struct.pack("<h", 0) + struct.pack("<H", 0) + bytes([4, 0])
        with pytest.raises(tile_format_v2.TileError, match="Invalid bits_per_pixel: 4"):
            decode(tile)

    def test_encode_rejects_non_square_arrays(self):
        """The wire format stores no dimensions, so encode refuses non-square.

        Regression: encode accepted any 2D shape, but with no width in the
        header decode guessed — 64x512 came back silently as 128x256 with the
        values mis-shaped by up to 256 m. Encoder-side rejection is the only
        safe guard (the 6-byte header cannot grow; ~152K deployed tiles).
        """
        with pytest.raises(
            tile_format_v2.TileError, match="OZT2 requires square arrays; got 64x512"
        ):
            encode(np.arange(32768, dtype=np.int16).reshape(64, 512))
        with pytest.raises(tile_format_v2.TileError, match="OZT2 requires square arrays; got 3x5"):
            encode(np.zeros((3, 5), dtype=np.int16))

    def test_decode_width_table_handles_non_square_tile(self):
        """Decoder-side: a hand-built 32x256 tile resolves via the width table.

        Third-party encoders may emit non-square tiles; 8192 pixels is not a
        perfect square, so decode falls through to the known-width table
        (256, 3601, 512, 1024, 128, 64) and recovers the exact grid.
        """
        data = np.arange(0, 8192, dtype=np.int16).reshape(32, 256)
        tile = (
            struct.pack("<h", 0)
            + struct.pack("<H", 0)
            + bytes([16, PRED_NONE | (COMP_ZLIB << 2)])
            + tile_format_v2.zlib.compress(data.tobytes())
        )
        decoded, meta = decode(tile)
        assert (meta["width"], meta["height"]) == (256, 32)
        assert decoded.shape == data.shape
        np.testing.assert_array_equal(data, decoded)

    def test_decode_unknown_dimensions_raises(self):
        """15 pixels fit no square side and no width in the inference table."""
        residuals = np.zeros(15, dtype=np.int16).tobytes()
        tile = (
            struct.pack("<h", 0)
            + struct.pack("<H", 0)
            + bytes([16, PRED_NONE | (COMP_ZLIB << 2)])
            + tile_format_v2.zlib.compress(residuals)
        )
        with pytest.raises(tile_format_v2.TileError, match="Cannot infer tile dimensions from 15"):
            decode(tile)

    def test_decode_zero_range_quantized_tile_fills_vmin(self):
        """A quantized tile that declares no elevation range decodes to vmin.

        Not produced by this module's encoder (a flat tile is stored losslessly
        at 16 bits) but the layout allows it, so the decoder must honour it.
        """
        residuals = np.zeros(16, dtype=np.int16).tobytes()
        tile = (
            struct.pack("<h", 500)
            + struct.pack("<H", 0)
            + bytes([8, PRED_NONE | (COMP_BROTLI << 2)])
            + tile_format_v2.brotli.compress(residuals, quality=5)
        )
        decoded, meta = tile_format_v2.decode(tile)
        assert meta["bits_per_pixel"] == 8
        assert meta["elevation_range"] == 0
        assert meta["predictor"] == "none"
        assert decoded.shape == (4, 4)
        np.testing.assert_array_equal(decoded, np.full((4, 4), 500, dtype=np.int16))


class TestValidateRoundtripMetadata:
    """RMSE bookkeeping inside validate_roundtrip."""

    def test_lossless_claim_is_falsified_by_int16_overflow(self):
        """Values above int16 range wrap during encode, so 16-bit is not lossless."""
        data = np.array([[40000.0, 100.0], [200.0, 300.0]], dtype=np.float64)
        is_lossless, rmse, meta = validate_roundtrip(data, bits_per_pixel=16)
        assert is_lossless is False
        assert rmse > 0.0
        assert meta["bits_per_pixel"] == 16

    def test_auto_encode_falls_back_to_lossless(self):
        """When no bit depth meets the threshold, the 16-bit fallback is used.

        The wrapped 40000 m pixel keeps RMSE above any threshold for every bit
        depth, so the loop exhausts and the explicit lossless fallback runs.
        """
        data = np.array([[40000.0, 100.0], [200.0, 300.0]], dtype=np.float64)
        encoded, meta = auto_encode(data, max_rmse=0.0)
        assert meta["auto_selected_bits"] == 16
        assert meta["rmse"] > 0.0
        assert isinstance(encoded, bytes)
        # Documented header layout: no magic/version field is written, the tile
        # starts straight with the int16 vmin of the wrapped data.
        assert len(encoded) >= tile_format_v2.HEADER_SIZE
        assert struct.unpack("<h", encoded[:2])[0] == -25536  # 40000 wrapped to int16

    def test_auto_encode_reports_selected_bits_for_flat_tile(self):
        """A flat tile is stored losslessly at 16 bits on the first iteration."""
        data = np.full((16, 16), 750, dtype=np.int16)
        encoded, meta = auto_encode(data, max_rmse=1.0)
        assert meta["bits_per_pixel"] == 16
        assert meta["rmse"] == 0.0
        decoded, _ = decode(encoded)
        np.testing.assert_array_equal(decoded, data)
