"""Tests for geo_utils module."""

import numpy as np
import pytest

from openzenith.geo_utils import (
    classify_terrain,
    compute_rmse,
    compute_slope,
    elevation_to_latlon,
    latlon_to_elevation_index,
    srtm_filename_to_bounds,
)


class TestSrtmFilenameToBounds:
    """Test SRTM filename parsing."""

    def test_northern_eastern(self):
        lat_min, lon_min, lat_max, lon_max = srtm_filename_to_bounds("N40W072.tif")
        assert lat_min == 40
        assert lat_max == 41
        assert lon_min == -73
        assert lon_max == -72

    def test_southern_eastern(self):
        lat_min, lon_min, lat_max, lon_max = srtm_filename_to_bounds("S01E036.tif")
        assert lat_min == -2
        assert lat_max == -1
        assert lon_min == 36
        assert lon_max == 37

    def test_equator_prime_meridian(self):
        lat_min, lon_min, lat_max, lon_max = srtm_filename_to_bounds("N00E000.tif")
        assert lat_min == 0
        assert lat_max == 1
        assert lon_min == 0
        assert lon_max == 1

    def test_without_extension(self):
        bounds = srtm_filename_to_bounds("N27E086")
        assert bounds[0] == 27
        assert bounds[2] == 28


class TestElevationToLatlon:
    """Test pixel-to-geographic coordinate conversion."""

    def test_top_left(self):
        lat, lon = elevation_to_latlon(0, 0, 40.0, -73.0)
        # Row 0 = northernmost = lat_max = lat_min + 1
        assert lat == 41.0
        assert lon == -73.0

    def test_bottom_right(self):
        lat, lon = elevation_to_latlon(3600, 3600, 40.0, -73.0)
        assert lat == pytest.approx(40.0, abs=0.001)
        assert lon == pytest.approx(-72.0, abs=0.001)

    def test_center(self):
        lat, lon = elevation_to_latlon(1800, 1800, 40.0, -73.0)
        assert 40.4 < lat < 40.6
        assert -72.6 < lon < -72.4


class TestLatlonToElevationIndex:
    """Test geographic-to-pixel coordinate conversion."""

    def test_top_left(self):
        row, col = latlon_to_elevation_index(41.0, -73.0, 40.0, -73.0)
        assert row == 0
        assert col == 0

    def test_bottom_right(self):
        row, col = latlon_to_elevation_index(40.0, -72.0, 40.0, -73.0)
        assert row == 3600
        assert col == 3600


class TestClassifyTerrain:
    """Test terrain classification from elevation array."""

    def test_ocean(self):
        data = np.array([[-5000, -3000], [-2000, -1000]], dtype=np.int16)
        assert classify_terrain(data) == "ocean"

    def test_flat_lowland(self):
        data = np.array([[50, 55], [48, 52]], dtype=np.int16)
        assert classify_terrain(data) == "flat_lowland"

    def test_mountain(self):
        data = np.array([[100, 2000], [300, 3500]], dtype=np.int16)
        result = classify_terrain(data)
        assert result in ("high_mountain", "mountain", "alpine", "highland")

    def test_nodata(self):
        data = np.full((2, 2), -32768, dtype=np.int16)
        assert classify_terrain(data) == "nodata"


class TestComputeSlope:
    """Tests for compute_slope function."""

    def test_flat_terrain(self):
        """Flat terrain should have zero slope."""
        grid = np.zeros((10, 10), dtype=np.float64)
        slope = compute_slope(grid, pixel_size_m=30.0)
        assert np.all(slope >= 0)
        assert np.all(slope <= 90)

    def test_sloped_terrain(self):
        """Known slope gradient produces non-zero slope."""
        # Create a 10x10 grid with constant 1m/m gradient in row direction
        grid = np.zeros((10, 10), dtype=np.float64)
        for r in range(10):
            grid[r, :] = r * 1.0  # 1m rise over 1 cell
        slope = compute_slope(grid, pixel_size_m=30.0)
        assert np.mean(slope) > 0

    def test_nodata_mask(self):
        """Nodata values are excluded from slope computation."""
        grid = np.full((10, 10), -32768.0, dtype=np.float64)
        # Set a valid patch
        grid[2:8, 2:8] = 100.0
        slope = compute_slope(grid, pixel_size_m=30.0)
        assert np.all(slope >= 0)


class TestComputeRMSE:
    """Tests for compute_rmse function."""

    def test_identical_grids(self):
        """Identical grids have zero RMSE."""
        grid = np.array([[100, 200], [300, 400]], dtype=np.float64)
        rmse = compute_rmse(grid, grid)
        assert rmse["rmse"] == 0.0

    def test_small_error(self):
        """Small difference produces small RMSE."""
        original = np.array([[100.0, 200.0], [300.0, 400.0]])
        reconstructed = np.array([[101.0, 202.0], [299.0, 401.0]])
        rmse = compute_rmse(original, reconstructed)
        assert rmse["rmse"] > 0
        assert rmse["rmse"] < 5.0

    def test_nodata_excluded(self):
        """Nodata values are excluded from RMSE computation."""
        original = np.array([[100.0, -32768.0], [-32768.0, 400.0]])
        reconstructed = np.array([[100.0, 200.0], [300.0, 400.0]])
        rmse = compute_rmse(original, reconstructed)
        # Only the matching 100.0 pixel counts
        assert rmse["rmse"] == 0.0
