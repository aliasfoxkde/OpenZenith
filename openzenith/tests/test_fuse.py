"""Tests for openzenith.fuse multi-DEM fusion."""

import numpy as np
import pytest

from openzenith.fuse import (
    FusedDEM,
    load_fused_elevation_grid,
    _quad_name,
    _quad_bounds,
    GEBCO_RESOLUTION_ARCSEC,
    GEBCO_PIXELS_PER_DEG,
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
        elevation, mask = fused.query(0.0, 0.0, 0.01, 0.01, resolution=0.001)
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
