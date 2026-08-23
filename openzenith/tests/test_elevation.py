"""Tests for OpenZenith Python SDK — elevation module."""

import io
import math
from pathlib import Path
from unittest import mock

import numpy as np
import pytest
from PIL import Image

from openzenith.elevation import (
    DEFAULT_OZT2_DIR,
    DEFAULT_TILE_DIR,
    _get_elevation_from_ozt2,
    _interpolate_from_tile,
    _log_tile_error,
    download_tiles,
    get_elevation,
    get_elevation_along_path,
    get_elevation_batch,
    get_elevation_from_ozt2,
    get_tile_count,
    latlon_to_tile,
    load_ozt2_tiles,
    load_ozt2_tiles_from_hf,
    load_tiles,
    load_elevation_grid,
)
from openzenith.terrarium import decode_tile, encode_tile


# ─── Helper ───────────────────────────────────────────────────────────────────


def _make_terrarium_png(height: int, size: int = 2) -> bytes:
    """Create a size×size Terrarium PNG where all pixels decode to the given height (meters)."""

    def enc(h):
        v = int(h) + 32768
        return (min(255, v >> 8), v - (v >> 8) * 256, 0)

    arr = np.full((size, size, 3), enc(height), dtype=np.uint8)
    img = Image.fromarray(arr, mode="RGB")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def _make_tile_dir(tile_dir: Path, zoom: int, x: int, y: int, height: int = 1000) -> Path:
    """Create a tile file at the given zoom/x/y with the given elevation."""
    tile_path = tile_dir / str(zoom) / str(x)
    tile_path.mkdir(parents=True, exist_ok=True)
    png_path = tile_path / f"{y}.png"
    png_path.write_bytes(_make_terrarium_png(height))
    return png_path


# ─── latlon_to_tile ─────────────────────────────────────────────────────────────


@pytest.mark.parametrize("lat,lon,zoom", [
    (0.0, 0.0, 0),
    (0.0, -180.0, 8),
    (0.0, 179.9, 8),
    (85.0, 0.0, 8),
    (-85.0, 0.0, 8),
    (40.7128, -74.0060, 10),
    (35.6762, 139.6503, 10),
])
def test_latlon_to_tile(lat, lon, zoom):
    """Web Mercator tile coordinate conversion returns valid tile coordinates."""
    n = 2**zoom
    x, y = latlon_to_tile(lat, lon, zoom)
    assert 0 <= x < n, f"x={x} out of range [0, {n})"
    assert 0 <= y < n, f"y={y} out of range [0, {n})"


def test_latlon_to_tile_roundtrip():
    """Tile center should map back to approximately the same lat/lon."""
    lat, lon, z = 40.0, -105.0, 8
    x, y = latlon_to_tile(lat, lon, z)
    n = 2**z

    # Convert tile center back to lat/lon
    lon_center = (x + 0.5) / n * 360 - 180
    lat_rad = math.atan(math.sinh(math.pi * (1 - 2 * (y + 0.5) / n)))
    lat_center = math.degrees(lat_rad)

    assert abs(lat - lat_center) < 1.0
    assert abs(lon - lon_center) < 1.0


def test_latlon_to_tile_boundary():
    """Edge cases at lat/lon boundaries."""
    x, y = latlon_to_tile(0.0, -180.0, 1)
    assert x == 0

    x, y = latlon_to_tile(0.0, 180.0, 1)
    assert x in (0, 1, 2)


# ─── Terrarium decode ─────────────────────────────────────────────────────────---


def test_decode_tile_synthetic():
    """Decode a synthetic Terrarium PNG with known elevation."""
    img = Image.new("RGB", (2, 2), (131, 232, 0))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    png_bytes = buf.getvalue()

    result = decode_tile(png_bytes)
    assert result.shape == (2, 2)
    assert np.allclose(result, 1000.0, atol=1.0)


def test_decode_tile_nodata():
    """NODATA pixels (0,0,0) should decode to NaN."""
    img = Image.new("RGB", (2, 2), (0, 0, 0))
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

    buf = io.BytesIO()
    img.save(buf, format="PNG")
    png_bytes = buf.getvalue()

    result = decode_tile(png_bytes)
    assert np.isnan(result[0, 0])
    assert np.isclose(result[0, 1], 0.0, atol=1.0)
    assert np.isclose(result[1, 0], 1.0, atol=1.0)
    assert np.isclose(result[1, 1], 256.0, atol=1.0)


def test_decode_tile_encode_roundtrip():
    """Encode then decode should preserve elevation values."""
    original = np.array([[1000.0, 2000.0], [3000.0, -500.0]], dtype=np.float32)
    encoded = decode_tile(encode_tile(original))
    assert np.allclose(original, encoded, rtol=0.01)


def test_decode_tile_encode_nodata():
    """Encode with NaN, decode should return NaN at those positions."""
    original = np.array([[1000.0, np.nan], [np.nan, -500.0]], dtype=np.float32)
    encoded = decode_tile(encode_tile(original))
    assert np.isclose(encoded[0, 0], 1000.0, rtol=0.01)
    assert np.isnan(encoded[0, 1])
    assert np.isnan(encoded[1, 0])
    assert np.isclose(encoded[1, 1], -500.0, rtol=0.01)


# ─── _interpolate_from_tile ─────────────────────────────────────────────────---


def test_interpolate_from_tile_exact_center():
    """Point exactly at tile center should return the tile elevation."""
    png_bytes = _make_terrarium_png(1000)
    z, lat, lon = 8, 40.0, -105.0
    x, y = latlon_to_tile(lat, lon, z)
    result = _interpolate_from_tile(png_bytes, lat, lon, z, x, y)
    assert result is not None
    assert abs(result - 1000.0) < 20.0


def test_interpolate_from_tile_nodata():
    """All-zero NODATA tile should return None."""
    arr = np.zeros((2, 2, 3), dtype=np.uint8)
    img = Image.fromarray(arr, mode="RGB")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    png_bytes = buf.getvalue()

    z, lat, lon = 8, 40.0, -105.0
    x, y = latlon_to_tile(lat, lon, z)
    result = _interpolate_from_tile(png_bytes, lat, lon, z, x, y)
    assert result is None


def test_interpolate_from_tile_bilinear():
    """Bilinear interpolation returns a value in the range of the 4 corner pixels."""
    def enc(h):
        v = int(h) + 32768
        return (min(255, v >> 8), v - (v >> 8) * 256, 0)

    arr = np.array([[enc(0), enc(1000)], [enc(0), enc(1000)]], dtype=np.uint8)
    img = Image.fromarray(arr, mode="RGB")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    png_bytes = buf.getvalue()

    z, lat, lon = 8, 0.01, 0.01
    x, y = latlon_to_tile(lat, lon, z)
    result = _interpolate_from_tile(png_bytes, lat, lon, z, x, y)
    assert result is not None
    assert 0.0 <= result <= 1000.0


def test_interpolate_from_tile_partial_nodata():
    """If some corners are NODATA, return nearest valid pixel."""
    def enc(h):
        v = int(h) + 32768
        return (min(255, v >> 8), v - (v >> 8) * 256, 0)

    # One corner is nodata (0,0,0), others are valid
    arr = np.array([[[0, 0, 0], enc(500)], [enc(1000), enc(2000)]], dtype=np.uint8)
    img = Image.fromarray(arr, mode="RGB")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    png_bytes = buf.getvalue()

    z, lat, lon = 8, 0.01, 0.01
    x, y = latlon_to_tile(lat, lon, z)
    result = _interpolate_from_tile(png_bytes, lat, lon, z, x, y)
    assert result is not None
    # Should return the nearest valid value
    assert 500.0 <= result <= 2000.0


# ─── get_elevation ─────────────────────────────────────────────────────────────


def test_get_elevation_no_tile_dir_raises():
    """get_elevation without tile_dir or DEFAULT_TILE_DIR raises ValueError."""
    import openzenith.elevation as e

    saved = e.DEFAULT_TILE_DIR
    e.DEFAULT_TILE_DIR = None
    try:
        with pytest.raises(ValueError, match="No tile directory"):
            get_elevation(40.0, -74.0)
    finally:
        e.DEFAULT_TILE_DIR = saved


def test_get_elevation_missing_tile_returns_none(tmp_path):
    """Point whose tile doesn't exist returns None (not an error)."""
    result = get_elevation(0.0, 0.0, tile_dir=tmp_path)
    assert result is None


def test_get_elevation_with_tile(tmp_path):
    """get_elevation returns elevation when tile exists."""
    lat, lon = 40.0, -105.0
    z = 8
    x, y = latlon_to_tile(lat, lon, z)
    _make_tile_dir(tmp_path, z, x, y, height=1600)

    result = get_elevation(lat, lon, tile_dir=tmp_path, zoom_levels=[8])
    assert result is not None
    assert abs(result - 1600.0) < 50.0  # Within interpolation tolerance


@pytest.mark.parametrize("lat,lon,zoom_levels,expected_approx", [
    (40.0, -105.0, [8], 1600.0),  # Denver area
    (35.0, -118.0, [8], 700.0),   # LA area
    (0.0, 0.0, [8], 0.0),          # Ocean
])
def test_get_elevation_batch_coords(tmp_path, lat, lon, zoom_levels, expected_approx):
    """Test get_elevation_batch with specific coordinates."""
    z = zoom_levels[0]
    x, y = latlon_to_tile(lat, lon, z)
    _make_tile_dir(tmp_path, z, x, y, height=int(expected_approx))

    result = get_elevation_batch([(lat, lon)], tile_dir=tmp_path, zoom_levels=zoom_levels)
    assert len(result) == 1
    assert result[0] is None or abs(result[0] - expected_approx) < 100


def test_get_elevation_falls_back_to_lower_zoom(tmp_path):
    """If tile doesn't exist at zoom 8, falls back to zoom 7."""
    lat, lon = 40.0, -105.0
    z7_x, z7_y = latlon_to_tile(lat, lon, 7)
    _make_tile_dir(tmp_path, 7, z7_x, z7_y, height=1500)

    result = get_elevation(lat, lon, tile_dir=tmp_path, zoom_levels=[8, 7])
    assert result is not None


def test_get_elevation_all_tiles_missing(tmp_path):
    """All tiles missing returns None."""
    result = get_elevation(0.0, 0.0, tile_dir=tmp_path, zoom_levels=[8, 7])
    assert result is None


def test_get_elevation_ozt2_no_ozt2_dir(tmp_path):
    """get_elevation with use_ozt2=True but no DEFAULT_OZT2_DIR falls back to PNG tiles."""
    import openzenith.elevation as e

    saved_ozt2 = e.DEFAULT_OZT2_DIR
    saved_tile = e.DEFAULT_TILE_DIR
    e.DEFAULT_OZT2_DIR = None
    e.DEFAULT_TILE_DIR = str(tmp_path)
    try:
        # With use_ozt2=True but no OZT2_DIR, it should try PNG tiles
        # Since tmp_path has no tiles, it returns None (not an error)
        result = get_elevation(40.0, -74.0, use_ozt2=True)
        assert result is None
    finally:
        e.DEFAULT_OZT2_DIR = saved_ozt2
        e.DEFAULT_TILE_DIR = saved_tile


# ─── get_elevation_batch ─────────────────────────────────────────────────────--


def test_get_elevation_batch_empty():
    """Empty batch returns empty list."""
    results = get_elevation_batch([])
    assert results == []


def test_get_elevation_batch_multiple_points(tmp_path):
    """Batch query returns list of elevations for multiple points."""
    lat1, lon1 = 40.0, -105.0
    lat2, lon2 = 35.0, -118.0
    z = 8

    x1, y1 = latlon_to_tile(lat1, lon1, z)
    x2, y2 = latlon_to_tile(lat2, lon2, z)

    _make_tile_dir(tmp_path, z, x1, y1, height=1600)
    _make_tile_dir(tmp_path, z, x2, y2, height=900)

    results = get_elevation_batch(
        [(lat1, lon1), (lat2, lon2)],
        tile_dir=tmp_path,
        zoom_levels=[8],
    )
    assert len(results) == 2
    assert results[0] is not None
    assert results[1] is not None


def test_get_elevation_batch_with_workers(tmp_path):
    """Batch query with custom max_workers."""
    lat, lon = 40.0, -105.0
    z = 8
    x, y = latlon_to_tile(lat, lon, z)
    _make_tile_dir(tmp_path, z, x, y, height=1600)

    # Single point with 4 workers
    results = get_elevation_batch([(lat, lon)], tile_dir=tmp_path, max_workers=4)
    assert len(results) == 1


def test_get_elevation_batch_exception_handling(tmp_path):
    """Exceptions in get_elevation are caught and return None."""
    import openzenith.elevation as e

    saved_default = e.DEFAULT_TILE_DIR
    e.DEFAULT_TILE_DIR = str(tmp_path)
    try:
        # Create a corrupt tile that will cause decode to fail
        corrupt_png = (tmp_path / "8" / "0")
        corrupt_png.mkdir(parents=True, exist_ok=True)
        (corrupt_png / "0.png").write_bytes(b"not a png")

        # get_elevation_batch should return None for failed points
        results = get_elevation_batch([(0.0, 0.0)], tile_dir=tmp_path)
        assert len(results) == 1
        assert results[0] is None
    finally:
        e.DEFAULT_TILE_DIR = saved_default


# ─── load_tiles ─────────────────────────────────────────────────────────────---


def test_load_tiles_import_error():
    """load_tiles raises ImportError if huggingface_hub not installed."""
    import builtins
    original_import = builtins.__import__
    def mock_import(name, *args, **kwargs):
        if name == "huggingface_hub":
            raise ImportError("No module named 'huggingface_hub'")
        return original_import(name, *args, **kwargs)

    with mock.patch.object(builtins, "__import__", side_effect=mock_import):
        with pytest.raises(ImportError, match="huggingface_hub"):
            load_tiles()


def test_load_tiles_sets_default(tmp_path):
    """load_tiles sets DEFAULT_TILE_DIR globally."""
    import openzenith.elevation as e

    saved = e.DEFAULT_TILE_DIR
    e.DEFAULT_TILE_DIR = None
    try:
        with mock.patch("huggingface_hub.snapshot_download") as mock_download:
            mock_download.return_value = str(tmp_path / "dataset")
            load_tiles(cache_dir=tmp_path)
            assert e.DEFAULT_TILE_DIR == tmp_path / "dataset"
    finally:
        e.DEFAULT_TILE_DIR = saved


# ─── get_elevation_from_ozt2 ─────────────────────────────────────────────────---


def test_get_elevation_from_ozt2_returns_float_or_none(tmp_path):
    """get_elevation_from_ozt2 returns float or None."""
    with mock.patch("openzenith.elevation._get_elevation_from_ozt2", return_value=None):
        result = get_elevation_from_ozt2(40.0, -74.0, ozt2_dir=str(tmp_path))
        assert result is None

    with mock.patch("openzenith.elevation._get_elevation_from_ozt2", return_value=123.4):
        result = get_elevation_from_ozt2(40.0, -74.0, ozt2_dir=str(tmp_path))
        assert result == pytest.approx(123.4)


def test_get_elevation_from_ozt2_requires_dir():
    """get_elevation_from_ozt2 raises ValueError when no tile dir configured."""
    import openzenith.elevation as e

    saved = e.DEFAULT_OZT2_DIR
    e.DEFAULT_OZT2_DIR = None
    try:
        with pytest.raises(ValueError, match="ozt2_dir"):
            get_elevation_from_ozt2(40.0, -74.0)
    finally:
        e.DEFAULT_OZT2_DIR = saved


def test_get_elevation_from_ozt2_uses_default_dir(tmp_path):
    """get_elevation_from_ozt2 uses DEFAULT_OZT2_DIR when ozt2_dir not provided."""
    import openzenith.elevation as e

    saved = e.DEFAULT_OZT2_DIR
    e.DEFAULT_OZT2_DIR = tmp_path
    try:
        with mock.patch("openzenith.elevation._get_elevation_from_ozt2", return_value=42.0) as mock_get:
            result = get_elevation_from_ozt2(40.0, -74.0)
            assert result == 42.0
            mock_get.assert_called_once()
    finally:
        e.DEFAULT_OZT2_DIR = saved


# ─── _get_elevation_from_ozt2 ─────────────────────────────────────────────---


def test_get_elevation_from_ozt2_tile_not_found(tmp_path):
    """_get_elevation_from_ozt2 returns None when tile file doesn't exist."""
    # No tiles created in tmp_path
    result = _get_elevation_from_ozt2(40.0, -74.0, tmp_path, zoom_levels=[10])
    assert result is None


def test_get_elevation_from_ozt2_all_nodata(tmp_path):
    """_get_elevation_from_ozt2 skips tiles where all values are nodata (-32768)."""
    # Create a synthetic OZT2 tile with all nodata values
    z, x, y = 10, 163, 395
    tile_dir = tmp_path / f"z{z}" / str(x)
    tile_dir.mkdir(parents=True, exist_ok=True)

    # Create fake OZT2 data: header + all -32768 values
    import struct
    header = struct.pack("<III", 256, 256, 0)  # width, height, flags
    data = struct.pack("<h", -32768) * 256 * 256
    (tile_dir / f"{y}.ozt2").write_bytes(header + data)

    result = _get_elevation_from_ozt2(40.7, -74.0, tmp_path, zoom_levels=[10])
    assert result is None


# ─── load_ozt2_tiles ──────────────────────────────────────────────────────────


def test_load_ozt2_tiles_sets_default_dir(tmp_path):
    """load_ozt2_tiles sets the DEFAULT_OZT2_DIR and returns Path."""
    import openzenith.elevation as e

    saved = e.DEFAULT_OZT2_DIR
    e.DEFAULT_OZT2_DIR = None
    try:
        result = e.load_ozt2_tiles(str(tmp_path))
        assert result == tmp_path
        assert e.DEFAULT_OZT2_DIR == tmp_path
    finally:
        e.DEFAULT_OZT2_DIR = saved


# ─── load_ozt2_tiles_from_hf ─────────────────────────────────────────────────--


def test_load_ozt2_tiles_from_hf_import_error():
    """load_ozt2_tiles_from_hf raises ImportError if huggingface_hub not installed."""
    import builtins
    original_import = builtins.__import__
    def mock_import(name, *args, **kwargs):
        if name == "huggingface_hub":
            raise ImportError("No module named 'huggingface_hub'")
        return original_import(name, *args, **kwargs)

    with mock.patch.object(builtins, "__import__", side_effect=mock_import):
        with pytest.raises(ImportError, match="huggingface_hub"):
            load_ozt2_tiles_from_hf()


def test_load_ozt2_tiles_from_hf_sets_default(tmp_path):
    """load_ozt2_tiles_from_hf sets DEFAULT_OZT2_DIR."""
    import openzenith.elevation as e

    saved = e.DEFAULT_OZT2_DIR
    e.DEFAULT_OZT2_DIR = None
    try:
        with mock.patch("huggingface_hub.snapshot_download") as mock_download:
            mock_download.return_value = str(tmp_path / "dataset")
            result = load_ozt2_tiles_from_hf(repo_id="test/repo", zoom_levels=[10], cache_dir=tmp_path)
            assert result == tmp_path / "dataset" / "tiles"
    finally:
        e.DEFAULT_OZT2_DIR = saved


# ─── get_tile_count ────────────────────────────────────────────────────────────


def test_get_tile_count_returns_dict():
    """get_tile_count returns a dict mapping zoom to count."""
    result = get_tile_count("/nas/Temp/repos/OpenZenith/openzenith")
    assert isinstance(result, dict)
    assert all(isinstance(k, int) for k in result)
    assert all(isinstance(v, int) for v in result.values())


def test_get_tile_count_empty_dir(tmp_path):
    """Empty directory returns empty dict."""
    result = get_tile_count(str(tmp_path))
    assert result == {}


def test_get_tile_count_with_files(tmp_path):
    """get_tile_count counts both .png and .ozt2 files."""
    # Create some fake tiles
    (tmp_path / "z8" / "100" / "200.png").parent.mkdir(parents=True)
    (tmp_path / "z8" / "100" / "200.png").touch()
    (tmp_path / "z8" / "100" / "201.ozt2").touch()
    (tmp_path / "z9" / "200" / "400.png").parent.mkdir(parents=True)
    (tmp_path / "z9" / "200" / "400.png").touch()

    result = get_tile_count(str(tmp_path))
    assert result[8] == 2
    assert result[9] == 1


# ─── download_tiles ─────────────────────────────────────────────────────────────


def test_download_tiles_requires_region_or_bbox():
    """download_tiles raises ValueError if no region or bbox provided."""
    with pytest.raises(ValueError, match="bbox|region|lat"):
        download_tiles()


def test_download_tiles_unknown_region():
    """download_tiles raises ValueError for unknown region name."""
    with pytest.raises(ValueError, match="Unknown region"):
        download_tiles(region="nonexistent_region")


@pytest.mark.parametrize("region,expected_bbox", [
    ("europe", (34, -25, 72, 45)),
    ("usa", (24, -125, 50, -66)),
])
def test_download_tiles_region_bbox(region, expected_bbox, tmp_path):
    """download_tiles maps region names to correct bounding boxes."""
    import openzenith.elevation as e

    saved = e.DEFAULT_TILE_DIR
    e.DEFAULT_TILE_DIR = None
    try:
        with mock.patch.object(e, "load_tiles", return_value=tmp_path):
            result = download_tiles(region=region, zoom_levels=[5])

            assert result["bbox"] == expected_bbox
            assert result["total_tiles"] > 0
            assert "zoom_breakdown" in result
    finally:
        e.DEFAULT_TILE_DIR = saved


def test_download_tiles_with_bbox(tmp_path):
    """download_tiles accepts explicit bbox parameter."""
    import openzenith.elevation as e

    saved = e.DEFAULT_TILE_DIR
    e.DEFAULT_TILE_DIR = None
    try:
        with mock.patch.object(e, "load_tiles", return_value=tmp_path):
            result = download_tiles(
                bbox=(34, -10, 72, 40),
                zoom_levels=[5],
                cache_dir=tmp_path,
            )

            assert result["bbox"] == (34, -10, 72, 40)
    finally:
        e.DEFAULT_TILE_DIR = saved


def test_download_tiles_with_lat_lon(tmp_path):
    """download_tiles accepts lat/lon center with radius."""
    import openzenith.elevation as e

    saved = e.DEFAULT_TILE_DIR
    e.DEFAULT_TILE_DIR = None
    try:
        with mock.patch.object(e, "load_tiles", return_value=tmp_path):
            result = download_tiles(
                lat=40.7,
                lon=-74.0,
                radius=0.5,
                zoom_levels=[8],
                cache_dir=tmp_path,
            )

            # Should have expanded the bbox by radius
            lat_min, lon_min, lat_max, lon_max = result["bbox"]
            assert lat_min == 40.7 - 0.5
            assert lat_max == 40.7 + 0.5
            assert lon_min == -74.0 - 0.5
            assert lon_max == -74.0 + 0.5
    finally:
        e.DEFAULT_TILE_DIR = saved


# ─── get_elevation_along_path ─────────────────────────────────────────────────-


def test_get_elevation_along_path_too_few_points():
    """get_elevation_along_path with < 2 points returns empty list."""
    result = get_elevation_along_path([(40.0, -105.0)])
    assert result == []


# ─── load_elevation_grid ─────────────────────────────────────────────────────


def test_load_elevation_grid_no_tile_dir():
    """load_elevation_grid raises ValueError when no tile dir configured."""
    import openzenith.elevation as e

    saved = e.DEFAULT_TILE_DIR
    e.DEFAULT_TILE_DIR = None
    try:
        with pytest.raises(ValueError, match="No tile directory"):
            e.load_elevation_grid(40.0, -105.0, zoom=8)
    finally:
        e.DEFAULT_TILE_DIR = saved


def test_load_elevation_grid_returns_dict(tmp_path):
    """load_elevation_grid returns correct dict structure."""
    import openzenith.elevation as e

    saved = e.DEFAULT_TILE_DIR
    e.DEFAULT_TILE_DIR = str(tmp_path)
    try:
        result = e.load_elevation_grid(
            40.0, -105.0,
            zoom=8,
            radius_cells=5,
        )

        assert "grid" in result
        assert "center_row" in result
        assert "center_col" in result
        assert "lat_min" in result
        assert "lon_min" in result
        assert "cell_size_deg" in result
        assert "center_lat" in result
        assert "center_lon" in result

        # Grid dimensions should be 2*radius + 1
        grid = result["grid"]
        assert grid.shape[0] == 11  # 2*5 + 1
        assert grid.shape[1] == 11
    finally:
        e.DEFAULT_TILE_DIR = saved


# ─── _log_tile_error ─────────────────────────────────────────────────────────--


def test_log_tile_error_does_not_raise(tmp_path):
    """_log_tile_error should not raise any exceptions."""
    err = OSError("File not found")
    # Should not raise
    _log_tile_error(tmp_path / "fake.png", "read", err)


# ─── Error handling ─────────────────────────────────────────────────────────


def test_get_elevation_oserror_on_read(tmp_path):
    """OSError during tile read is caught and returns None."""
    import openzenith.elevation as e

    saved = e.DEFAULT_TILE_DIR
    e.DEFAULT_TILE_DIR = str(tmp_path)
    try:
        z = 8
        x, y = latlon_to_tile(40.0, -105.0, z)
        tile_path = tmp_path / str(z) / str(x)
        tile_path.mkdir(parents=True, exist_ok=True)
        # Create an empty file that's not a valid PNG
        (tile_path / f"{y}.png").write_bytes(b"not a png")

        result = get_elevation(40.0, -105.0, tile_dir=tmp_path, zoom_levels=[8])
        assert result is None
    finally:
        e.DEFAULT_TILE_DIR = saved


# ─── Coordinate tests ─────────────────────────────────────────────────────────


def test_latlon_to_tile_negative_lon():
    """Negative longitudes produce valid tile x values."""
    x, _ = latlon_to_tile(0.0, -90.0, 8)
    assert 0 <= x < 256

    x, _ = latlon_to_tile(0.0, -1.0, 8)
    assert 0 <= x < 256


def test_latlon_to_tile_positive_lon():
    """Positive longitudes produce valid tile x values."""
    x, _ = latlon_to_tile(0.0, 90.0, 8)
    assert 0 <= x < 256

    x, _ = latlon_to_tile(0.0, 1.0, 8)
    assert 0 <= x < 256
