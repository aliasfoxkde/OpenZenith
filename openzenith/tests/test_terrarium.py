"""Tests for terrarium PNG encoding/decoding."""

import numpy as np
from openzenith.terrarium import decode_tile, encode_tile


class TestTerrariumRoundtrip:
    """Tests for encode/decode roundtrip."""

    def test_flat_elevation(self):
        """Flat 100m elevation should roundtrip."""
        dem = np.full((10, 10), 100.0, dtype=np.float32)
        encoded = encode_tile(dem)
        decoded = decode_tile(encoded)
        assert decoded.shape == dem.shape
        np.testing.assert_allclose(decoded, dem, atol=0.5)

    def test_high_elevation(self):
        """High elevation (Everest) should roundtrip within precision."""
        dem = np.full((5, 5), 8848.0, dtype=np.float32)
        encoded = encode_tile(dem)
        decoded = decode_tile(encoded)
        np.testing.assert_allclose(decoded, dem, atol=1.0)

    def test_negative_elevation(self):
        """Below sea level should roundtrip within precision."""
        dem = np.full((5, 5), -500.0, dtype=np.float32)
        encoded = encode_tile(dem)
        decoded = decode_tile(encoded)
        np.testing.assert_allclose(decoded, dem, atol=1.0)

    def test_variable_terrain(self):
        """Variable terrain should roundtrip with ~1m precision."""
        np.random.seed(42)
        dem = np.random.uniform(-200, 2000, size=(50, 50)).astype(np.float32)
        encoded = encode_tile(dem)
        decoded = decode_tile(encoded)
        # Terrarium has ~1m precision
        np.testing.assert_allclose(decoded, dem, atol=1.5)

    def test_nodata_handling(self):
        """NaN values should be preserved as NaN after roundtrip."""
        dem = np.array([[100.0, np.nan], [200.0, 300.0]], dtype=np.float32)
        encoded = encode_tile(dem, nodata=np.nan)
        decoded = decode_tile(encoded)
        assert np.isnan(decoded[0, 1])
        np.testing.assert_allclose(decoded[0, 0], 100.0, atol=1.0)

    def test_encoded_is_bytes(self):
        """encode_tile should return bytes."""
        dem = np.full((8, 8), 500.0, dtype=np.float32)
        encoded = encode_tile(dem)
        assert isinstance(encoded, bytes)
        assert len(encoded) > 0


class TestTerrariumDecode:
    """Tests for decode_tile."""

    def test_decode_shape(self):
        """Decoded array should be 2D."""
        dem = np.full((8, 8), 100.0, dtype=np.float32)
        encoded = encode_tile(dem)
        decoded = decode_tile(encoded)
        assert decoded.ndim == 2

    def test_zero_elevation(self):
        """Sea level (0m) should roundtrip."""
        dem = np.full((5, 5), 0.0, dtype=np.float32)
        encoded = encode_tile(dem)
        decoded = decode_tile(encoded)
        np.testing.assert_allclose(decoded, dem, atol=0.5)
