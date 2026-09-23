"""Tests for openzenith.fuse multi-DEM fusion."""

import asyncio
import sys
import types
from pathlib import Path

import numpy as np
import pytest

from openzenith.fuse import (
    GEBCO_BASE_URL,
    GEBCO_NODATA,
    GEBCO_PIXELS_PER_DEG,
    GEBCO_RESOLUTION_ARCSEC,
    FusedDEM,
    _quad_bounds,
    _quad_name,
    load_fused_elevation_grid,
    load_fused_tile,
)


class TestGebcoTileMath:
    """Tests for GEBCO quadrant naming and bounds."""

    def test_quad_name_n_positive(self):
        """N hemisphere produces 'n' prefix in quadrant name."""
        name = _quad_name(45.0, 90.0)
        assert name.startswith("gebco_2025_n")

    def test_quad_name_s_negative(self):
        """S hemisphere produces 's' prefix."""
        name = _quad_name(-45.0, -90.0)
        assert name.startswith("gebco_2025_s")
        assert "w" in name

    def test_quad_bounds_positive(self):
        """Bounds for N hemisphere tile."""
        # GEBCO quadrants are 90x90 centered on 45/135/225 etc.
        # lat=45, lon=90 → quadrant centered at (45, 90) → lat:[0,90], lon:[90,180]
        bounds = _quad_bounds(45.0, 90.0)
        assert bounds == (0, 90, 90, 180)

    def test_quad_bounds_negative(self):
        """Bounds for S hemisphere tile."""
        # lat=-45, lon=-90 → centered at (-45, -90) → lat:[-90,0], lon:[-180,-90]
        bounds = _quad_bounds(-45.0, -90.0)
        assert bounds == (-90, -180, 0, -90)

    def test_gebco_resolution(self):
        """GEBCO resolution constants are correct."""
        assert GEBCO_PIXELS_PER_DEG == 240
        assert GEBCO_RESOLUTION_ARCSEC == 15
        # Check: 3600 arc-sec / 240 pixels = 15 arc-sec/pixel
        assert pytest.approx(GEBCO_RESOLUTION_ARCSEC) == 3600 / GEBCO_PIXELS_PER_DEG


class TestFusedDEMQuery:
    """Tests for FusedDEM.query()."""

    def test_query_returns_correct_shape(self):
        """Query returns arrays of correct dimensions."""
        fused = FusedDEM(srtm_dir=None, gebco_dir=None, use_http_fallback=False)
        elevation, mask = fused.query(40.0, -74.0, 41.0, -74.0, resolution=0.01)
        assert elevation.shape == mask.shape
        assert elevation.dtype == np.int16
        assert mask.dtype == np.uint8

    def test_query_empty_result(self):
        """Query with no DEM sources returns nodata arrays."""
        fused = FusedDEM(srtm_dir=None, gebco_dir=None, use_http_fallback=False)
        elevation, _mask = fused.query(0.0, 0.0, 0.01, 0.01, resolution=0.001)
        assert elevation.shape[0] > 0
        assert elevation.shape[1] > 0
        # Both should be nodata since no sources configured
        assert elevation.dtype == np.int16


class TestFusedDEMQueryPoint:
    """Tests for FusedDEM.query_point()."""

    def test_query_point_no_sources(self):
        """Query point with no sources returns None."""
        fused = FusedDEM(srtm_dir=None, gebco_dir=None, use_http_fallback=False)
        elev, surface = fused.query_point(40.0, -74.0)
        assert elev is None
        assert surface == "unknown"

    def test_query_point_returns_land_or_ocean(self):
        """query_point returns (int, str) where str is land/ocean/unknown."""
        fused = FusedDEM(srtm_dir=None, gebco_dir=None, use_http_fallback=False)
        _elev, surface = fused.query_point(40.0, -74.0)
        assert surface in ("land", "ocean", "unknown")

    def test_query_point_type(self):
        """query_point returns elevation as int or None."""
        fused = FusedDEM(srtm_dir=None, gebco_dir=None, use_http_fallback=False)
        elev, _surface = fused.query_point(40.0, -74.0)
        assert elev is None or isinstance(elev, (int, float))


class TestFusedDEMMaskValues:
    """Tests that query returns correct mask values (0=ocean, 1=land)."""

    def test_query_returns_mask_dtype(self):
        """Mask should be uint8."""
        fused = FusedDEM(srtm_dir=None, gebco_dir=None, use_http_fallback=False)
        _elevation, mask = fused.query(40.0, -74.0, 40.01, -73.99, resolution=0.001)
        assert mask.dtype == np.uint8

    def test_query_mask_values_are_0_or_1(self):
        """Mask values should be only 0 or 1 when no sources configured."""
        fused = FusedDEM(srtm_dir=None, gebco_dir=None, use_http_fallback=False)
        _elevation, mask = fused.query(0.0, 0.0, 0.01, 0.01, resolution=0.001)
        unique = np.unique(mask)
        assert set(unique.tolist()).issubset({0, 1})


class TestLoadFusedElevationGrid:
    """Tests for load_fused_elevation_grid()."""

    @pytest.mark.integration
    def test_returns_correct_types(self):
        """Returns (elevation, mask) tuple of correct types."""
        elev, mask = load_fused_elevation_grid(
            40.0,
            -74.0,
            40.1,
            -73.9,
            resolution=0.01,
            srtm_dir=None,
            gebco_dir=None,
        )
        assert isinstance(elev, np.ndarray)
        assert isinstance(mask, np.ndarray)
        assert elev.dtype == np.int16
        assert mask.dtype == np.uint8


class TestGebcoConstants:
    """Tests for GEBCO constants."""

    def test_nodata_value(self):
        assert GEBCO_NODATA == -32768

    def test_base_url(self):
        assert "gebco_2025" in GEBCO_BASE_URL


class TestQuadNameEdgeCases:
    """Edge case tests for _quad_name."""

    def test_lon_180(self):
        """Longitude at 180 degrees should produce E180 or W180 in name."""
        name = _quad_name(45.0, 180.0)
        assert "180" in name

    def test_lon_neg_180(self):
        """Longitude at -180 degrees should produce W180 or E180 in name."""
        name = _quad_name(45.0, -180.0)
        assert "180" in name

    def test_lat_0(self):
        """Equatorial region should produce n or s prefix."""
        name = _quad_name(0.0, 0.0)
        # Should have both n/s and e/w designators
        parts = name.split("_")
        assert len(parts) == 4

    def test_high_latitude(self):
        """High latitude should produce correct quadrant."""
        name = _quad_name(60.0, 45.0)
        assert "n" in name or "s" in name


class TestQuadBoundsEdgeCases:
    """Edge case tests for _quad_bounds."""

    def test_lon_180_bounds(self):
        """Bounds at lon=180 should not crash."""
        bounds = _quad_bounds(0.0, 180.0)
        assert len(bounds) == 4
        lat_min, lon_min, lat_max, lon_max = bounds
        assert lat_min < lat_max
        assert lon_min < lon_max

    def test_lon_neg_180_bounds(self):
        """Bounds at lon=-180 should not crash."""
        bounds = _quad_bounds(0.0, -180.0)
        assert len(bounds) == 4

    def test_high_latitude_bounds(self):
        """High latitude bounds should be valid."""
        bounds = _quad_bounds(80.0, 45.0)
        lat_min, lon_min, lat_max, lon_max = bounds
        assert lat_min <= lat_max
        assert lon_min <= lon_max


class TestFusedDEMTileName:
    """Tests for _tile_name static method."""

    def test_north_east(self):
        name = FusedDEM._tile_name(40, 74)
        assert name.startswith("N")
        assert "E" in name

    def test_south_west(self):
        name = FusedDEM._tile_name(-33, -151)
        assert name.startswith("S")
        assert "W" in name

    def test_exact_zero(self):
        name = FusedDEM._tile_name(0, 0)
        assert "N00" in name or "S00" in name
        assert "E000" in name or "W000" in name


class TestLoadFusedTile:
    """Tests for load_fused_tile().

    Note: load_fused_tile always uses use_http_fallback=True internally,
    so these tests are marked @pytest.mark.integration to skip in normal runs.
    """

    @pytest.mark.integration
    def test_load_fused_tile_returns_correct_types(self):
        """load_fused_tile returns (elevation, mask) tuple."""
        elev, mask = load_fused_tile(
            lat=40.0,
            lon=-74.0,
            zoom=10,
            srtm_dir=None,
            gebco_dir=None,
        )
        assert isinstance(elev, np.ndarray)
        assert isinstance(mask, np.ndarray)
        assert elev.dtype == np.int16
        assert mask.dtype == np.uint8


class TestFusedDEMQueryAsync:
    """Tests for async query methods."""

    def test_query_async_returns_correct_types(self):
        """query_async returns (elevation, mask) tuple."""
        fused = FusedDEM(srtm_dir=None, gebco_dir=None, use_http_fallback=False)
        result = asyncio.run(fused.query_async(40.0, -74.0, 40.01, -73.99, resolution=0.01))
        assert isinstance(result, tuple)
        elev, mask = result
        assert elev.dtype == np.int16
        assert mask.dtype == np.uint8

    def test_query_batch_async_empty(self):
        """Empty batch returns empty list."""
        fused = FusedDEM(srtm_dir=None, gebco_dir=None, use_http_fallback=False)
        result = asyncio.run(fused.query_batch_async([]))
        assert result == []

    def test_query_batch_async_returns_list(self):
        """query_batch_async returns list of elevations."""
        fused = FusedDEM(srtm_dir=None, gebco_dir=None, use_http_fallback=False)
        result = asyncio.run(fused.query_batch_async([(40.0, -74.0), (41.0, -73.0)]))
        assert isinstance(result, list)
        assert len(result) == 2


# ─── Fakes and helpers for the data-plane tests ────────────────────────────────

# lat=45.5, lon=-89.5 sits in quadrant n45/w045 with bounds (0, -90, 90, 0),
# sampling row = (90 - 45.5) * 240 = 10680 and col = (−89.5 − (−90)) * 240 = 120.
QUAD_POINT = (45.5, -89.5)
QUAD_NAME = "gebco_2025_n45_w045.tif"
QUAD_ROW, QUAD_COL = 10680, 120


class FakeMergedFile:
    """MergedFile stand-in: 2×2 chunk grid, per-chunk fill values.

    Chunk (0, 0) returns `fill`; chunk (0, 1) honours a size of 0 in its
    index entry (empty chunk); any chunk index >= len(index) is out of
    range, mirroring real 15×15-chunk .merged layouts.
    """

    def __init__(self, fill=100, cols=2, empty_chunk=None):
        self.cols = cols
        self.fill = fill
        self.empty_chunk = empty_chunk
        self.index = [{"offset": i, "size": 0 if i == empty_chunk else 1} for i in range(4)]

    def get_chunk(self, row, col):
        if not (0 <= row < 2 and 0 <= col < 2):
            raise ValueError(f"Chunk ({row}, {col}) out of range")
        return np.full((256, 256), self.fill, dtype=np.int16)


class _FakeAsyncResponse:
    """aiohttp response stand-in: async context manager with status/read."""

    def __init__(self, status, payload):
        self.status = status
        self._payload = payload

    async def read(self):
        if isinstance(self._payload, Exception):
            raise self._payload
        return self._payload

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc_info):
        return False


class _FakeAsyncSession:
    """aiohttp session stand-in that hands back a canned response."""

    closed = False

    def __init__(self, response):
        self._response = response
        self.urls = []

    def get(self, url, headers=None, timeout=None):
        self.urls.append(url)
        if isinstance(self._response, Exception):
            raise self._response
        return self._response


def _strip_payload(value):
    """21600 int16 values as raw bytes, the shape a GEBCO row strip returns."""
    return np.full(21600, value, dtype=np.int16).tobytes()


def _install_srtm(monkeypatch, tmp_path, tiles=None, merged=None, merge_error=None):
    """Patch the merged module so FusedDEM._srtm_elevation reads fakes."""
    import openzenith.merged as merged_mod

    tiles = {(40, -75): {"has_data": True}} if tiles is None else tiles

    def fake_discover(_srtm_dir):
        return tiles

    def fake_get_merged_file(_path):
        if merge_error is not None:
            raise merge_error
        return merged

    monkeypatch.setattr(merged_mod, "discover_srtm_tiles", fake_discover)
    monkeypatch.setattr(merged_mod, "get_merged_file", fake_get_merged_file)


class TestQuadNameBoundaries:
    """Exact quadrant names at the ±180 / ±90 longitude seams."""

    def test_lon_180_is_e180(self):
        assert _quad_name(45.0, 180.0) == "gebco_2025_n45_e180.tif"

    def test_lon_neg_180_is_w180(self):
        assert _quad_name(45.0, -180.0) == "gebco_2025_n45_w180.tif"

    def test_lon_neg_90_is_w135(self):
        assert _quad_name(45.0, -90.0) == "gebco_2025_n45_w135.tif"

    def test_lon_neg_45_is_w045(self):
        assert _quad_name(45.0, -45.0) == "gebco_2025_n45_w045.tif"

    def test_bounds_at_seams(self):
        assert _quad_bounds(45.0, 180.0) == (0, 180, 90, 270)
        assert _quad_bounds(45.0, -180.0) == (0, -180, 90, -90)
        assert _quad_bounds(45.0, -90.0) == (0, -180, 90, -90)
        assert _quad_bounds(45.0, -45.0) == (0, -90, 90, 0)
        assert _quad_bounds(100.0, 10.0) == (90, 0, 180, 90)
        assert _quad_bounds(-100.0, 10.0) == (-180, 0, -90, 90)


class TestSrtmElevation:
    """FusedDEM._srtm_elevation against faked .merged reads."""

    def test_point_outside_index_returns_none(self, tmp_path, monkeypatch):
        _install_srtm(monkeypatch, tmp_path, tiles={(50, 10): {"has_data": True}})
        fused = FusedDEM(srtm_dir=tmp_path)
        assert fused._srtm_elevation(40.5, -74.5) is None

    def test_tile_without_data_returns_none(self, tmp_path, monkeypatch):
        _install_srtm(monkeypatch, tmp_path, tiles={(40, -75): {"has_data": False}})
        fused = FusedDEM(srtm_dir=tmp_path)
        assert fused._srtm_elevation(40.5, -74.5) is None

    def test_missing_merged_file_returns_none(self, tmp_path, monkeypatch):
        _install_srtm(monkeypatch, tmp_path)
        fused = FusedDEM(srtm_dir=tmp_path)
        assert fused._srtm_elevation(40.999, -74.999) is None

    def test_chunk_index_out_of_range_returns_none(self, tmp_path, monkeypatch):
        # cols=2 with a 4-entry index: lat 40.5 maps to chunk row 7, so the
        # flat index 7*2+0=14 runs past the faked 2x2 layout.
        _install_srtm(monkeypatch, tmp_path, merged=FakeMergedFile(cols=2))
        (tmp_path / "N40").mkdir()
        (tmp_path / "N40" / "N40W075.merged").write_bytes(b"x")
        fused = FusedDEM(srtm_dir=tmp_path)
        assert fused._srtm_elevation(40.5, -74.999) is None

    def test_empty_chunk_returns_none(self, tmp_path, monkeypatch):
        _install_srtm(monkeypatch, tmp_path, merged=FakeMergedFile(empty_chunk=0))
        (tmp_path / "N40").mkdir()
        (tmp_path / "N40" / "N40W075.merged").write_bytes(b"x")
        fused = FusedDEM(srtm_dir=tmp_path)
        assert fused._srtm_elevation(40.999, -74.999) is None

    def test_nodata_chunk_returns_none(self, tmp_path, monkeypatch):
        _install_srtm(monkeypatch, tmp_path, merged=FakeMergedFile(fill=GEBCO_NODATA))
        (tmp_path / "N40").mkdir()
        (tmp_path / "N40" / "N40W075.merged").write_bytes(b"x")
        fused = FusedDEM(srtm_dir=tmp_path)
        assert fused._srtm_elevation(40.999, -74.999) is None

    def test_valid_land_point(self, tmp_path, monkeypatch):
        _install_srtm(monkeypatch, tmp_path, merged=FakeMergedFile(fill=123))
        (tmp_path / "N40").mkdir()
        (tmp_path / "N40" / "N40W075.merged").write_bytes(b"x")
        fused = FusedDEM(srtm_dir=tmp_path)
        assert fused._srtm_elevation(40.999, -74.999) == (123, True)

    def test_srtm_tiles_preloaded_skips_discover(self, tmp_path, monkeypatch):
        _install_srtm(monkeypatch, tmp_path, merged=FakeMergedFile(fill=7))
        (tmp_path / "N40").mkdir()
        (tmp_path / "N40" / "N40W075.merged").write_bytes(b"x")
        fused = FusedDEM(srtm_dir=tmp_path, srtm_tiles={(40, -75): {"has_data": True}})
        assert fused._srtm_elevation(40.999, -74.999) == (7, True)

    @pytest.mark.parametrize("error", [OSError("disk gone"), ValueError("bad chunk")])
    def test_read_failure_returns_none(self, tmp_path, monkeypatch, error):
        _install_srtm(monkeypatch, tmp_path, merge_error=error)
        (tmp_path / "N40").mkdir()
        (tmp_path / "N40" / "N40W075.merged").write_bytes(b"x")
        fused = FusedDEM(srtm_dir=tmp_path)
        assert fused._srtm_elevation(40.999, -74.999) is None


class TestGebcoFromLocal:
    """FusedDEM GEBCO reads backed by an in-memory quadrant array."""

    def _fused(self, tmp_path, values, monkeypatch):
        quad_path = tmp_path / QUAD_NAME
        quad_path.write_bytes(b"x")
        arr = np.full((11000, 200), values, dtype=np.int16)
        fused = FusedDEM(gebco_dir=tmp_path)
        fused._read_gebco_quad = lambda _path: arr
        return fused

    def test_samples_synthetic_quadrant(self, tmp_path, monkeypatch):
        fused = self._fused(tmp_path, -1500, monkeypatch)
        assert fused._gebco_from_local(*QUAD_POINT) == -1500

    @pytest.mark.parametrize("value", [-12000, 9500])
    def test_unrealistic_values_treated_as_nodata(self, tmp_path, monkeypatch, value):
        fused = self._fused(tmp_path, value, monkeypatch)
        assert fused._gebco_from_local(*QUAD_POINT) is None

    def test_quadrant_is_cached_after_first_read(self, tmp_path, monkeypatch):
        quad_path = tmp_path / QUAD_NAME
        quad_path.write_bytes(b"x")
        arr = np.full((11000, 200), -1500, dtype=np.int16)
        calls = []
        fused = FusedDEM(gebco_dir=tmp_path)

        def counting_read(_path):
            calls.append(_path)
            return arr

        fused._read_gebco_quad = counting_read
        assert fused._gebco_from_local(*QUAD_POINT) == -1500
        assert fused._gebco_from_local(*QUAD_POINT) == -1500
        assert len(calls) == 1

    def test_missing_quadrant_file_returns_none(self, tmp_path, monkeypatch):
        fused = FusedDEM(gebco_dir=tmp_path)
        assert fused._gebco_from_local(*QUAD_POINT) is None

    def test_gebco_elevation_dispatches_to_local(self, tmp_path, monkeypatch):
        fused = self._fused(tmp_path, -1500, monkeypatch)
        assert fused._gebco_elevation(*QUAD_POINT) == -1500

    def test_gebco_elevation_dispatches_to_http(self, monkeypatch):
        fused = FusedDEM(gebco_dir=None, use_http_fallback=True)
        fused._gebco_from_http = lambda lat, lon: -1234
        assert fused._gebco_elevation(*QUAD_POINT) == -1234

    def test_gebco_from_local_without_dir_returns_none(self):
        fused = FusedDEM(gebco_dir=None)
        assert fused._gebco_from_local(*QUAD_POINT) is None

    def test_none_quadrant_read_is_reported_as_missing(self, tmp_path, monkeypatch):
        # A reader that returns None caches that result; the sample must
        # then report nodata rather than crash on indexing None.
        quad_path = tmp_path / QUAD_NAME
        quad_path.write_bytes(b"x")
        fused = FusedDEM(gebco_dir=tmp_path)
        fused._read_gebco_quad = lambda _path: None
        assert fused._gebco_from_local(*QUAD_POINT) is None


class TestReadGebcoQuad:
    """_read_gebco_quad uses rasterio when present, PIL otherwise."""

    def test_rasterio_path_reads_int16_grid(self, tmp_path):
        rasterio = pytest.importorskip("rasterio")
        from rasterio.transform import from_origin

        path = tmp_path / "quad.tif"
        with rasterio.open(
            path,
            "w",
            driver="GTiff",
            height=4,
            width=4,
            count=1,
            dtype="int16",
            transform=from_origin(0, 4, 1, 1),
        ) as dst:
            dst.write(np.arange(16, dtype=np.int16).reshape(4, 4), 1)
        fused = FusedDEM()
        arr = fused._read_gebco_quad(path)
        assert arr[3, 3] == 15

    def test_pil_fallback_when_rasterio_missing(self, tmp_path, monkeypatch):
        PIL_Image = pytest.importorskip("PIL.Image")
        monkeypatch.setitem(sys.modules, "rasterio", None)
        path = tmp_path / "quad.tif"
        PIL_Image.fromarray(np.full((4, 4), 300, np.uint16), mode="I;16").save(path)
        fused = FusedDEM()
        arr = fused._read_gebco_quad(path)
        assert arr[0, 0] == 300


class TestGebcoFromHttp:
    """Synchronous GEBCO strip fetch with a faked requests.get."""

    def _patch_get(self, monkeypatch, response, status=206):
        import requests

        def fake_get(url, headers=None, timeout=None):
            if isinstance(response, Exception):
                raise response
            return types.SimpleNamespace(status_code=status, content=response)

        monkeypatch.setattr(requests, "get", fake_get)

    def test_successful_strip_fetch(self, monkeypatch):
        self._patch_get(monkeypatch, _strip_payload(-1234))
        fused = FusedDEM()
        assert fused._gebco_from_http(*QUAD_POINT) == -1234

    def test_non_200_status_returns_none(self, monkeypatch):
        self._patch_get(monkeypatch, _strip_payload(-1234), status=500)
        fused = FusedDEM()
        assert fused._gebco_from_http(*QUAD_POINT) is None

    @pytest.mark.parametrize("value", [-32768, 9500])
    def test_unrealistic_values_return_none(self, monkeypatch, value):
        self._patch_get(monkeypatch, _strip_payload(value))
        fused = FusedDEM()
        assert fused._gebco_from_http(*QUAD_POINT) is None

    def test_request_exception_returns_none(self, monkeypatch):
        import requests

        self._patch_get(monkeypatch, requests.ConnectionError("no route"))
        fused = FusedDEM()
        assert fused._gebco_from_http(*QUAD_POINT) is None

    def test_missing_requests_returns_none(self, monkeypatch):
        monkeypatch.setitem(sys.modules, "requests", None)
        fused = FusedDEM()
        assert fused._gebco_from_http(*QUAD_POINT) is None


class TestGebcoFromHttpAsync:
    """Async GEBCO strip fetch with a faked aiohttp session."""

    def _fused_with_session(self, response):
        fused = FusedDEM(use_http_fallback=True)
        fused._gebco_session = _FakeAsyncSession(response)
        return fused

    def test_successful_strip_fetch(self):
        resp = _FakeAsyncResponse(206, _strip_payload(-1234))
        fused = self._fused_with_session(resp)
        assert asyncio.run(fused._gebco_from_http_async(*QUAD_POINT)) == -1234

    def test_non_200_status_returns_none(self):
        resp = _FakeAsyncResponse(404, b"")
        fused = self._fused_with_session(resp)
        assert asyncio.run(fused._gebco_from_http_async(*QUAD_POINT)) is None

    @pytest.mark.parametrize("value", [-32768, 9500])
    def test_unrealistic_values_return_none(self, value):
        resp = _FakeAsyncResponse(206, _strip_payload(value))
        fused = self._fused_with_session(resp)
        assert asyncio.run(fused._gebco_from_http_async(*QUAD_POINT)) is None

    def test_client_error_returns_none(self):
        import aiohttp

        fused = self._fused_with_session(aiohttp.ClientError("boom"))
        assert asyncio.run(fused._gebco_from_http_async(*QUAD_POINT)) is None

    def test_missing_aiohttp_returns_none(self, monkeypatch):
        monkeypatch.setitem(sys.modules, "aiohttp", None)
        fused = FusedDEM(use_http_fallback=True)
        assert asyncio.run(fused._gebco_from_http_async(*QUAD_POINT)) is None


class TestGebcoSessionLifecycle:
    """The shared aiohttp session is created once and closable."""

    def test_session_reused_then_closed(self):
        fused = FusedDEM()

        async def main():
            first = await fused._get_gebco_session()
            second = await fused._get_gebco_session()
            assert first is second
            await fused.close_gebco_session()
            assert fused._gebco_session is None
            third = await fused._get_gebco_session()
            assert third is not first
            await fused.close_gebco_session()

        asyncio.run(main())

    def test_close_without_session_is_noop(self):
        fused = FusedDEM()
        asyncio.run(fused.close_gebco_session())
        assert getattr(fused, "_gebco_session", None) is None

    def test_closed_session_is_replaced(self):
        fused = FusedDEM()

        async def main():
            first = await fused._get_gebco_session()
            await first.close()
            second = await fused._get_gebco_session()
            assert second is not first
            await fused.close_gebco_session()

        asyncio.run(main())


class TestQueryWithData:
    """query() mask/elevation semantics when sources return values."""

    def test_land_pixels_masked_1(self):
        fused = FusedDEM(gebco_dir=None, use_http_fallback=False)
        fused._srtm_elevation = lambda lat, lon: (100, True)
        elevation, mask = fused.query(40.0, 0.0, 41.0, 1.0, resolution=0.5)
        assert elevation[0, 0] == 100
        assert mask[0, 0] == 1

    def test_srtm_false_marks_ocean(self):
        fused = FusedDEM(gebco_dir=None, use_http_fallback=False)
        fused._srtm_elevation = lambda lat, lon: (50, False)
        _elevation, mask = fused.query(40.0, 0.0, 41.0, 1.0, resolution=0.5)
        assert mask[0, 0] == 0

    def test_gebco_fallback_fills_ocean(self):
        fused = FusedDEM(gebco_dir=None, use_http_fallback=False)
        fused._srtm_elevation = lambda lat, lon: None
        fused._gebco_elevation = lambda lat, lon: -500
        elevation, mask = fused.query(40.0, 0.0, 41.0, 1.0, resolution=0.5)
        assert elevation[0, 0] == -500
        assert mask[0, 0] == 0

    def test_missing_everywhere_stays_nodata(self):
        fused = FusedDEM(gebco_dir=None, use_http_fallback=False)
        fused._srtm_elevation = lambda lat, lon: None
        fused._gebco_elevation = lambda lat, lon: None
        elevation, mask = fused.query(40.0, 0.0, 41.0, 1.0, resolution=0.5)
        assert elevation[0, 0] == GEBCO_NODATA
        assert mask[0, 0] == 0


class TestQueryPointWithData:
    """query_point() surface classification with data present."""

    def test_land(self):
        fused = FusedDEM(gebco_dir=None, use_http_fallback=False)
        fused._srtm_elevation = lambda lat, lon: (100, True)
        assert fused.query_point(40.5, 0.5) == (100, "land")

    def test_srtm_ocean(self):
        fused = FusedDEM(gebco_dir=None, use_http_fallback=False)
        fused._srtm_elevation = lambda lat, lon: (0, False)
        assert fused.query_point(40.5, 0.5) == (0, "ocean")

    def test_gebco_ocean(self):
        fused = FusedDEM(gebco_dir=None, use_http_fallback=False)
        fused._srtm_elevation = lambda lat, lon: None
        fused._gebco_elevation = lambda lat, lon: -800
        assert fused.query_point(40.5, 0.5) == (-800, "ocean")


class TestQueryPointAsyncBranches:
    """_query_point_async dispatches SRTM → local GEBCO → HTTP."""

    def test_srtm_hit(self):
        fused = FusedDEM(gebco_dir=None)
        fused._srtm_elevation = lambda lat, lon: (100, True)
        assert asyncio.run(fused._query_point_async(40.5, 0.5)) == (100, True)

    def test_local_gebco_fallback(self, tmp_path):
        fused = FusedDEM(gebco_dir=tmp_path)
        fused._srtm_elevation = lambda lat, lon: None
        fused._gebco_from_local = lambda lat, lon: -800
        assert asyncio.run(fused._query_point_async(40.5, 0.5)) == -800

    def test_http_fallback(self):
        async def fake_http(lat, lon):
            return -1200

        fused = FusedDEM(gebco_dir=None, use_http_fallback=True)
        fused._srtm_elevation = lambda lat, lon: None
        fused._gebco_from_http_async = fake_http
        assert asyncio.run(fused._query_point_async(40.5, 0.5)) == -1200

    def test_no_source_returns_none(self):
        fused = FusedDEM(gebco_dir=None, use_http_fallback=False)
        fused._srtm_elevation = lambda lat, lon: None
        assert asyncio.run(fused._query_point_async(40.5, 0.5)) is None


class TestQueryAsyncWithData:
    """query_async builds the tile index off-loop and gathers points."""

    def test_discovers_tiles_and_fills_grid(self, tmp_path, monkeypatch):
        _install_srtm(monkeypatch, tmp_path)
        fused = FusedDEM(srtm_dir=tmp_path)
        fused._srtm_elevation = lambda lat, lon: (100, True)
        elevation, mask = asyncio.run(fused.query_async(40.0, 0.0, 41.0, 1.0, resolution=0.5))
        assert fused._srtm_tiles == {(40, -75): {"has_data": True}}
        assert elevation[0, 0] == 100
        assert mask[0, 0] == 1

    def test_point_errors_leave_nodata(self, tmp_path, monkeypatch):
        _install_srtm(monkeypatch, tmp_path)

        def boom(lat, lon):
            raise RuntimeError("offline")

        fused = FusedDEM(srtm_dir=tmp_path)
        fused._srtm_elevation = boom
        elevation, _mask = asyncio.run(fused.query_async(40.0, 0.0, 41.0, 1.0, resolution=0.5))
        assert elevation[0, 0] == GEBCO_NODATA


class TestQueryBatchAsyncWithData:
    """query_batch_async returns elevations ordered, failures as None."""

    def test_mixed_success_and_failure(self, tmp_path, monkeypatch):
        _install_srtm(monkeypatch, tmp_path)

        def sometimes(lat, lon):
            if lat > 40.0:
                return (100, True)
            raise RuntimeError("no tile")

        fused = FusedDEM(srtm_dir=tmp_path)
        fused._srtm_elevation = sometimes
        result = asyncio.run(fused.query_batch_async([(40.5, 0.5), (39.5, 0.5)]))
        assert result == [100.0, None]

    def test_all_missing_returns_nones(self, tmp_path, monkeypatch):
        _install_srtm(monkeypatch, tmp_path)
        fused = FusedDEM(srtm_dir=tmp_path)
        fused._srtm_elevation = lambda lat, lon: None
        result = asyncio.run(fused.query_batch_async([(40.5, 0.5)]))
        assert result == [None]


class TestLoadFusedTileMath:
    """load_fused_tile translates Web Mercator tile bounds before querying."""

    def test_tile_bounds_passed_to_query(self, monkeypatch):
        captured = {}

        def fake_query(self, lat_min, lon_min, lat_max, lon_max, *, resolution):
            captured.update(
                lat_min=lat_min,
                lon_min=lon_min,
                lat_max=lat_max,
                lon_max=lon_max,
                resolution=resolution,
                srtm_dir=self.srtm_dir,
                gebco_dir=self.gebco_dir,
            )
            return np.zeros((1, 1), dtype=np.int16), np.zeros((1, 1), dtype=np.uint8)

        monkeypatch.setattr(FusedDEM, "query", fake_query)
        _elev, _mask = load_fused_tile(40.0, -74.0, zoom=10, srtm_dir="/s", gebco_dir="/g")
        assert captured["srtm_dir"] == Path("/s")
        assert captured["gebco_dir"] == Path("/g")
        assert captured["lat_min"] < 40.0 < captured["lat_max"]
        assert captured["lon_min"] < -74.0 < captured["lon_max"]
        # z10 tiles span 360/2^10 = 0.3516 degrees of longitude
        assert captured["lon_max"] - captured["lon_min"] == pytest.approx(360 / 1024)
        assert captured["resolution"] == pytest.approx(
            (captured["lat_max"] - captured["lat_min"]) / 256
        )

    def test_resolution_override_beats_zoom_default(self, monkeypatch):
        captured = {}

        def fake_query(self, lat_min, lon_min, lat_max, lon_max, *, resolution):
            captured["resolution"] = resolution
            return np.zeros((1, 1), dtype=np.int16), np.zeros((1, 1), dtype=np.uint8)

        monkeypatch.setattr(FusedDEM, "query", fake_query)
        load_fused_tile(40.0, -74.0, zoom=10, gebco_dir="/g", resolution=0.01)
        assert captured["resolution"] == 0.01

    def test_small_real_query_returns_nodata_without_sources(self, tmp_path):
        # gebco_dir points at an empty dir so every pixel resolves to nodata
        # without any network access.
        elevation, mask = load_fused_tile(40.0, -74.0, zoom=10, gebco_dir=tmp_path, resolution=0.5)
        assert elevation.shape == (1, 1)
        assert elevation[0, 0] == GEBCO_NODATA
        assert mask[0, 0] == 0


class TestLoadFusedElevationGridUnit:
    """load_fused_elevation_grid wrapper, offline via an empty gebco_dir."""

    def test_wrapper_returns_nodata_grid(self, tmp_path):
        elevation, mask = load_fused_elevation_grid(
            40.0, 0.0, 40.01, 0.01, resolution=0.01, gebco_dir=tmp_path
        )
        assert elevation.dtype == np.int16
        assert mask.dtype == np.uint8
        assert elevation[0, 0] == GEBCO_NODATA
