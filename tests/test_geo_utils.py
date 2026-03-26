"""Tests for openzenith.geo_utils module."""

import numpy as np
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
    def test_north_east(self):
        lat_min, lon_min, lat_max, lon_max = srtm_filename_to_bounds("N28E086.tif")
        assert lat_min == 28
        assert lat_max == 29
        assert lon_min == 86
        assert lon_max == 87

    def test_south_west(self):
        lat_min, lon_min, lat_max, lon_max = srtm_filename_to_bounds("S23W043.tif")
        assert lat_min == -24
        assert lat_max == -23
        assert lon_min == -44
        assert lon_max == -43

    def test_tiff_extension(self):
        result = srtm_filename_to_bounds("N00E000.tiff")
        assert result == (0, 0, 1, 1)

    def test_equator_prime_meridian(self):
        result = srtm_filename_to_bounds("N00E000.tif")
        assert result == (0, 0, 1, 1)


class TestElevationToLatlon:
    def test_top_left_corner(self):
        lat, lon = elevation_to_latlon(0, 0, 28.0, 86.0)
        assert lat == 29.0  # top row = max lat
        assert lon == 86.0

    def test_bottom_right_corner(self):
        lat, lon = elevation_to_latlon(3600, 3600, 28.0, 86.0)
        assert lat == 28.0
        assert lon == 87.0

    def test_center(self):
        lat, lon = elevation_to_latlon(1800, 1800, 28.0, 86.0, 3601, 3601)
        assert abs(lat - 28.5) < 0.001
        assert abs(lon - 86.5) < 0.001

    def test_custom_size(self):
        lat, lon = elevation_to_latlon(0, 0, 28.0, 86.0, 256, 256)
        assert lat == 28.0 + 1.0  # top row
        assert lon == 86.0


class TestLatlonToElevationIndex:
    def test_known_point(self):
        row, col = latlon_to_elevation_index(28.5, 86.5, 28.0, 86.0)
        assert row == 1800
        assert col == 1800

    def test_bounds_clamping(self):
        row, col = latlon_to_elevation_index(30.0, 88.0, 28.0, 86.0)
        assert row == 0
        assert col == 3600


class TestCoordinateRoundtrip:
    def test_index_to_coords_to_index(self):
        for row, col in [(0, 0), (1800, 1800), (3600, 3600), (123, 456)]:
            lat, lon = elevation_to_latlon(row, col, 28.0, 86.0)
            row2, col2 = latlon_to_elevation_index(lat, lon, 28.0, 86.0)
            assert row2 == row
            assert col2 == col


class TestComputeSlope:
    def test_flat_surface_zero_slope(self):
        flat = np.full((64, 64), 1000, dtype=np.float64)
        slope = compute_slope(flat, 30.0)
        assert np.allclose(slope, 0, atol=0.01)

    def test_inclined_plane_positive_slope(self):
        # Slope going up from left to right: 100m rise over 100m horizontal
        inclined = np.linspace(0, 100, 64).reshape(1, -1).astype(np.float64)
        inclined = np.repeat(inclined, 64, axis=0)
        slope = compute_slope(inclined, 30.0)
        # Each pixel step is 30m, rise per step is 100/63 ~ 1.587m
        # slope = atan(1.587/30) ~ 3.03 degrees
        assert np.all(slope > 0)
        assert np.all(slope < 10)

    def test_steep_slope(self):
        # 1000m rise over 30m run (gradient needs >= 3 elements in both dims)
        steep = np.array([[0, 500, 1000], [0, 500, 1000], [0, 500, 1000]], dtype=np.float64)
        slope = compute_slope(steep, 30.0)
        assert np.max(slope) > 80

    def test_output_shape(self):
        tile = np.random.rand(128, 128) * 1000
        slope = compute_slope(tile)
        assert slope.shape == (128, 128)


class TestComputeRmse:
    def test_identical_arrays(self):
        arr = np.random.randint(0, 5000, (64, 64)).astype(np.int16)
        result = compute_rmse(arr, arr)
        assert result["rmse"] == 0.0
        assert result["mae"] == 0.0
        assert result["max_error"] == 0.0

    def test_known_error(self):
        original = np.full((10, 10), 1000, dtype=np.int16)
        reconstructed = np.full((10, 10), 1010, dtype=np.int16)
        result = compute_rmse(original, reconstructed)
        assert result["rmse"] == 10.0
        assert result["mae"] == 10.0

    def test_nodata_handling(self):
        original = np.full((10, 10), -32768, dtype=np.int16)
        reconstructed = np.full((10, 10), 0, dtype=np.int16)
        result = compute_rmse(original, reconstructed)
        assert result["rmse"] != result["rmse"]  # should be NaN


class TestComputeSlopeDeviation:
    def test_identical_arrays(self):
        arr = np.random.rand(64, 64).astype(np.int16)
        result = compute_slope_deviation(arr, arr)
        assert result["slope_rmse_deg"] == 0.0

    def test_nodata(self):
        arr = np.full((10, 10), -32768, dtype=np.int16)
        result = compute_slope_deviation(arr, arr)
        assert np.isnan(result["slope_rmse_deg"])


class TestClassifyTerrain:
    def test_ocean(self):
        ocean = np.full((64, 64), -50, dtype=np.int16)
        assert classify_terrain(ocean) == "ocean"

    def test_flat_lowland(self):
        flat = np.random.randint(50, 100, (64, 64)).astype(np.int16)
        assert classify_terrain(flat) == "flat_lowland"

    def test_high_mountain(self):
        mt = np.random.randint(0, 5000, (64, 64)).astype(np.int16)
        assert classify_terrain(mt) == "high_mountain"

    def test_nodata(self):
        nodata = np.full((64, 64), -32768, dtype=np.int16)
        assert classify_terrain(nodata) == "nodata"
