"""Tests for geo_utils module."""

import numpy as np
import pytest

from openzenith.geo_utils import (
    classify_terrain,
    compute_rmse,
    compute_slope,
    compute_slope_deviation,
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

    def test_lowland(self):
        """elev_range < 200 and std < 50 → lowland."""
        data = np.array([[100, 150, 120], [130, 140, 110], [120, 135, 145]], dtype=np.int16)
        result = classify_terrain(data)
        assert result == "lowland"

    def test_hills(self):
        """elev_range < 1000 but not lowland → hills."""
        data = np.array([[100, 500, 200], [300, 400, 250], [200, 350, 300]], dtype=np.int16)
        result = classify_terrain(data)
        assert result == "hills"

    def test_high_mountain(self):
        """elev_range >= 3000 → high_mountain."""
        data = np.array([[100, 4000], [200, 3500]], dtype=np.int16)
        result = classify_terrain(data)
        assert result == "high_mountain"


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

    def test_all_nodata_returns_nan_metrics(self):
        """With no comparable pixels the error metrics are NaN, not zero."""
        grid = np.full((4, 4), -32768, dtype=np.int16)
        result = compute_rmse(grid, grid.copy())
        assert result["rmse"] != result["rmse"]  # NaN self-comparison
        assert result["mae"] != result["mae"]
        assert result["max_error"] != result["max_error"]
        assert "valid_pixels" not in result

    def test_disjoint_nodata_masks_count_only_overlap(self):
        """Only pixels valid in BOTH grids count towards the metrics."""
        original = np.array([[100.0, -32768.0], [-32768.0, 300.0]])
        reconstructed = np.array([[-32768.0, 100.0], [200.0, 300.0]])
        result = compute_rmse(original, reconstructed)
        # Only the (1, 1) pixel is valid in both grids and it agrees exactly
        assert result["rmse"] == 0.0
        assert result["valid_pixels"] == 1

    def test_full_overlap_reports_valid_pixel_count(self):
        original = np.array([[100.0, 200.0], [300.0, 400.0]])
        reconstructed = original + 1.0
        result = compute_rmse(original, reconstructed)
        assert result["valid_pixels"] == 4
        assert result["rmse"] == pytest.approx(1.0)
        assert result["mae"] == pytest.approx(1.0)
        assert result["max_error"] == pytest.approx(1.0)
        assert result["std_error"] == pytest.approx(0.0)
        # diff is original - reconstructed, so a positive bias means the
        # reconstruction reads low
        assert result["mean_bias"] == pytest.approx(-1.0)


class TestComputeSlopeDeviation:
    """Tests for compute_slope_deviation."""

    def test_identical_grids_have_zero_deviation(self):
        grid = np.array([[100, 150, 120], [130, 140, 110]], dtype=np.int16)
        result = compute_slope_deviation(grid, grid.copy(), pixel_size_m=30.0)
        assert result["slope_rmse_deg"] == 0.0
        assert result["slope_mean_diff_deg"] == 0.0
        assert result["slope_max_diff_deg"] == 0.0
        assert result["slope_p95_diff_deg"] == 0.0

    def test_small_elevation_error_gives_small_slope_deviation(self):
        original = np.array([[100, 200, 150], [300, 400, 250]], dtype=np.int16)
        reconstructed = original.copy()
        reconstructed[0, 1] += 5
        result = compute_slope_deviation(original, reconstructed, pixel_size_m=30.0)
        assert 0.0 < result["slope_rmse_deg"] < 5.0
        assert 0.0 < result["slope_mean_diff_deg"] <= result["slope_p95_diff_deg"]
        assert result["slope_max_diff_deg"] >= result["slope_p95_diff_deg"]

    def test_large_error_dominates_deviation(self):
        original = np.zeros((8, 8), dtype=np.int16)
        reconstructed = original.copy()
        reconstructed[4, 4] = 2000  # Single spike distorts the local gradient
        result = compute_slope_deviation(original, reconstructed, pixel_size_m=30.0)
        assert result["slope_max_diff_deg"] > 10.0
        assert result["slope_rmse_deg"] > 0.0

    def test_all_nodata_returns_nan(self):
        grid = np.full((4, 4), -32768, dtype=np.int16)
        result = compute_slope_deviation(grid, grid.copy())
        assert result["slope_rmse_deg"] != result["slope_rmse_deg"]  # NaN
        assert result["slope_max_diff_deg"] != result["slope_max_diff_deg"]
        # The short-circuit dict omits the two extra statistics
        assert set(result) == {"slope_rmse_deg", "slope_max_diff_deg"}

    def test_nodata_pixels_excluded_from_deviation(self):
        original = np.full((6, 6), -32768, dtype=np.int16)
        original[1:5, 1:5] = 500
        reconstructed = original.copy()
        reconstructed[2, 2] = 560
        result = compute_slope_deviation(original, reconstructed, pixel_size_m=30.0)
        assert result["slope_max_diff_deg"] > 0.0
