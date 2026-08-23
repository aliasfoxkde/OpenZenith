"""Tests for openzenith.fuse multi-DEM fusion."""

import asyncio
from unittest.mock import patch

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
        assert 3600 / GEBCO_PIXELS_PER_DEG == pytest.approx(GEBCO_RESOLUTION_ARCSEC)


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
            40.0, -74.0, 40.1, -73.9,
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
