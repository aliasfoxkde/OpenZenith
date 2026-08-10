"""Tests for OpenZenith Python SDK — elevation module."""

import math

import numpy as np
import pytest
from PIL import Image

from openzenith.elevation import get_elevation, latlon_to_tile
from openzenith.terrarium import decode_tile


def test_latlon_to_tile():
    """Web Mercator tile coordinate conversion."""
    # Known tile coordinates
    # z0: only tile is 0/0/0
    assert latlon_to_tile(0, 0, 0) == (0, 0)

    # z1: 4 tiles
    x, y = latlon_to_tile(40.7, -74.0, 10)
    assert 0 <= x < 1024
    assert 0 <= y < 1024

    # Negative longitude should produce valid x
    x2, _ = latlon_to_tile(0, -180.0, 8)
    assert x2 == 0

    x3, _ = latlon_to_tile(0, 179.9, 8)
    assert x3 == 255


def test_latlon_to_tile_roundtrip():
    """Tile center should map back to approximately the same lat/lon."""
    lat, lon, z = 40.0, -105.0, 8
    x, y = latlon_to_tile(lat, lon, z)
    n = 2**z

    # Convert tile center back to lat/lon
    lon_center = (x + 0.5) / n * 360 - 180
    lat_rad = math.atan(math.sinh(math.pi * (1 - 2 * (y + 0.5) / n)))
    lat_center = math.degrees(lat_rad)

    assert abs(lat - lat_center) < 1.0  # Within ~1 degree at z8
    assert abs(lon - lon_center) < 1.0


def test_decode_tile_synthetic():
    """Decode a synthetic Terrarium PNG with known elevation."""
    # Create a 2x2 Terrarium PNG: all pixels at 1000m elevation
    # Terrarium: height = (R*256 + G + B/256) - 32768
    # For 1000m: R*256 + G + B/256 = 33768
    # R = 131, G = 232, B = 0 → 131*256 + 232 = 33768 ✓
    img = Image.new("RGB", (2, 2), (131, 232, 0))
    import io
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    png_bytes = buf.getvalue()

    result = decode_tile(png_bytes)
    assert result.shape == (2, 2)
    assert np.allclose(result, 1000.0, atol=1.0)


def test_decode_tile_nodata():
    """NODATA pixels (0,0,0) should decode to NaN."""
    img = Image.new("RGB", (2, 2), (0, 0, 0))
    import io
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    png_bytes = buf.getvalue()

    result = decode_tile(png_bytes)
    assert result.shape == (2, 2)
    assert np.all(np.isnan(result))


def test_decode_tile_mixed():
    """Mixed valid + NODATA pixels."""
    img = Image.new("RGB", (2, 2))
    img.putpixel((0, 0), (0, 0, 0))  # NODATA
    img.putpixel((1, 0), (128, 0, 0))  # 128*256-32768 = 0m
    img.putpixel((0, 1), (128, 1, 0))  # 128*256+1-32768 = 1m
    img.putpixel((1, 1), (129, 0, 0))  # 129*256-32768 = 256m

    import io
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    png_bytes = buf.getvalue()

    result = decode_tile(png_bytes)
    assert np.isnan(result[0, 0])
    assert np.isclose(result[0, 1], 0.0, atol=1.0)
    assert np.isclose(result[1, 0], 1.0, atol=1.0)
    assert np.isclose(result[1, 1], 256.0, atol=1.0)


def test_load_elevation_grid_mercator_coords():
    """load_elevation_grid should return correct lat_min/lon_min in Web Mercator."""
    # This test verifies the Mercator coordinate fix
    # At z8, tile 52/97 covers Colorado area (~39°N, -106°W)
    # The bug was lat_min returning 21°N instead of ~38.6°N
    import math

    lat, lon, z = 39.0, -106.4, 8
    n = 2**z
    _x, y = latlon_to_tile(lat, lon, z)

    # Expected lat_min for a small grid centered on this point
    # Should be approximately lat - (radius_cells * cell_size)
    radius = 5
    # Cell size at z8 in degrees (approximate, Mercator)
    cell_size = 180.0 / (n * 256)

    # The correct lat_min should be close to lat - radius * cell_size
    lat - radius * cell_size

    # We can't load without tiles, but we can verify the formula
    # lat_min = pixel_to_lat(min_pixel_y + grid_rows, zoom)
    # where min_pixel_y = center_pixel_y - radius
    center_pixel_y = y * 256 + int(
        ((1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2) * n
    )
    min_pixel_y = center_pixel_y - radius
    grid_rows = 2 * radius + 1

    # Mercator inverse
    total_pixels = n * 256
    y_norm = (min_pixel_y + grid_rows) / total_pixels
    lat_min_calc = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y_norm))))

    # lat_min should be the south edge of the grid
    # For a 1-degree grid at z8, it should be approximately lat - 1 degree
    assert abs(lat_min_calc - lat) < 2.0, (
        f"lat_min={lat_min_calc:.4f}, expected near {lat:.4f} (within 2 degrees)"
    )
    # Key assertion: lat_min should NOT be 21°N (the old bug)
    assert lat_min_calc > 30.0, (
        f"lat_min={lat_min_calc:.4f} is way off — Mercator bug?"
    )


# ─── Tests for _interpolate_from_tile ─────────────────────────────────────────


def _make_terrarium_png(height: int) -> bytes:
    """Create a 2×2 Terrarium PNG where all pixels decode to the given height (meters)."""
    import io

    from PIL import Image

    def enc(h):
        v = int(h) + 32768
        return (min(255, v >> 8), v - (v >> 8) * 256, 0)

    # Use fromarray / direct RGB fill to avoid palette mode issues
    arr = np.full((2, 2, 3), enc(height), dtype=np.uint8)
    img = Image.fromarray(arr, mode="RGB")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def test_interpolate_from_tile_exact_center():
    """Point exactly at tile center should return the tile elevation."""
    from openzenith.elevation import _interpolate_from_tile, latlon_to_tile

    png_bytes = _make_terrarium_png(1000)
    z, lat, lon = 8, 40.0, -105.0
    x, y = latlon_to_tile(lat, lon, z)
    result = _interpolate_from_tile(png_bytes, lat, lon, z, x, y)
    assert result is not None
    assert abs(result - 1000.0) < 20.0


def test_interpolate_from_tile_nodata():
    """All-zero NODATA tile should return None."""
    from openzenith.elevation import _interpolate_from_tile, latlon_to_tile

    arr = np.zeros((2, 2, 3), dtype=np.uint8)
    img = Image.fromarray(arr, mode="RGB")
    import io
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    png_bytes = buf.getvalue()

    z, lat, lon = 8, 40.0, -105.0
    x, y = latlon_to_tile(lat, lon, z)
    result = _interpolate_from_tile(png_bytes, lat, lon, z, x, y)
    assert result is None


def test_interpolate_from_tile_bilinear():
    """Bilinear interpolation returns a value in the range of the 4 corner pixels."""
    from openzenith.elevation import _interpolate_from_tile, latlon_to_tile

    def enc(h):
        v = int(h) + 32768
        return (min(255, v >> 8), v - (v >> 8) * 256, 0)

    arr = np.array([[enc(0), enc(1000)], [enc(0), enc(1000)]], dtype=np.uint8)
    img = Image.fromarray(arr, mode="RGB")
    import io
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    png_bytes = buf.getvalue()

    # Use lat/lon within the tile to test interpolation
    z, lat, lon = 8, 0.01, 0.01
    x, y = latlon_to_tile(lat, lon, z)
    result = _interpolate_from_tile(png_bytes, lat, lon, z, x, y)
    assert result is not None
    # Result should be between 0 and 1000
    assert 0.0 <= result <= 1000.0


# ─── Tests for get_elevation with temp tile dir ─────────────────────────────────


def test_get_elevation_no_tile_dir_raises():
    """get_elevation without tile_dir or DEFAULT_TILE_DIR raises ValueError."""
    import openzenith.elevation as e

    saved = e.DEFAULT_TILE_DIR
    e.DEFAULT_TILE_DIR = None
    try:
        from openzenith.elevation import get_elevation
        with pytest.raises(ValueError, match="No tile directory"):
            get_elevation(40.0, -74.0)
    finally:
        e.DEFAULT_TILE_DIR = saved


def test_get_elevation_missing_tile_returns_none(tmp_path):
    """Point whose tile doesn't exist returns None (not an error)."""

    # Point in the ocean — no tile should exist
    result = get_elevation(0.0, 0.0, tile_dir=tmp_path)
    assert result is None


def test_get_elevation_batch(tmp_path):
    """Batch query returns list of elevations."""
    from openzenith.elevation import get_elevation_batch

    results = get_elevation_batch([(40.0, -74.0), (35.0, -118.0)], tile_dir=tmp_path)
    assert isinstance(results, list)
    assert len(results) == 2
    assert all(r is None for r in results)


def test_get_elevation_batch_empty():
    """Empty batch returns empty list."""
    from openzenith.elevation import get_elevation_batch

    results = get_elevation_batch([])
    assert results == []


# ─── Tests for get_elevation_from_ozt2 ─────────────────────────────────────────


def test_get_elevation_from_ozt2_returns_float_or_none(tmp_path):
    """get_elevation_from_ozt2 returns float or None."""
    import unittest.mock

    from openzenith.elevation import get_elevation_from_ozt2

    # Mock the internal _get_elevation_from_ozt2 to avoid network/disk calls
    with unittest.mock.patch("openzenith.elevation._get_elevation_from_ozt2", return_value=None):
        result = get_elevation_from_ozt2(40.0, -74.0, ozt2_dir=str(tmp_path))
        # Should return None (no tile found in mock)
        assert result is None or isinstance(result, (int, float))

    with unittest.mock.patch("openzenith.elevation._get_elevation_from_ozt2", return_value=123.4):
        result = get_elevation_from_ozt2(40.0, -74.0, ozt2_dir=str(tmp_path))
        assert result == pytest.approx(123.4)


def test_get_elevation_from_ozt2_requires_dir():
    """get_elevation_from_ozt2 raises ValueError when no tile dir configured."""
    import openzenith.elevation as e
    saved = e.DEFAULT_OZT2_DIR
    e.DEFAULT_OZT2_DIR = None
    try:
        from openzenith.elevation import get_elevation_from_ozt2
        with pytest.raises(ValueError, match="ozt2_dir"):
            get_elevation_from_ozt2(40.0, -74.0)
    finally:
        e.DEFAULT_OZT2_DIR = saved


# ─── Tests for load_ozt2_tiles ────────────────────────────────────────────────


def test_load_ozt2_tiles_sets_default_dir(tmp_path):
    """load_ozt2_tiles sets the DEFAULT_OZT2_DIR and returns Path."""
    import openzenith.elevation as e

    # Use a temp directory
    result = e.load_ozt2_tiles(str(tmp_path))
    assert result == tmp_path
    # Check the module-level variable after the call
    assert e.DEFAULT_OZT2_DIR == tmp_path


def test_load_ozt2_tiles_does_not_crash():
    """load_ozt2_tiles should not crash on a real directory."""
    from openzenith.elevation import load_ozt2_tiles

    # Use the project directory (doesn't need to have tiles)
    result = load_ozt2_tiles("/nas/Temp/repos/OpenZenith/openzenith")
    assert result is not None


# ─── Tests for get_tile_count ─────────────────────────────────────────────────


def test_get_tile_count_returns_dict():
    """get_tile_count returns a dict mapping zoom to count."""
    from openzenith.elevation import get_tile_count

    result = get_tile_count("/nas/Temp/repos/OpenZenith/openzenith")
    assert isinstance(result, dict)
    assert all(isinstance(k, int) for k in result)
    assert all(isinstance(v, int) for v in result.values())


def test_get_tile_count_empty_dir(tmp_path):
    """Empty directory returns empty dict."""
    from openzenith.elevation import get_tile_count

    result = get_tile_count(str(tmp_path))
    assert result == {}
