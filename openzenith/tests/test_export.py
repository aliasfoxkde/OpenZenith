"""Tests for OpenZenith Python SDK — export module."""

import json
import numpy as np
import pytest

from openzenith.export import grid_to_geojson, contour_to_geojson


class TestGridToGeoJSON:
    """Tests for grid_to_geojson."""

    def test_basic_output(self):
        """Should produce valid GeoJSON FeatureCollection."""
        data = np.random.rand(10, 10).astype(np.float32) * 100
        result = grid_to_geojson(data)
        assert result["type"] == "FeatureCollection"
        assert isinstance(result["features"], list)
        assert len(result["features"]) > 0

    def test_feature_structure(self):
        """Each feature should have Point geometry with property."""
        data = np.ones((5, 5), dtype=np.float32) * 100
        result = grid_to_geojson(data)
        f = result["features"][0]
        assert f["type"] == "Feature"
        assert f["geometry"]["type"] == "Point"
        assert len(f["geometry"]["coordinates"]) == 2
        assert "terrain" in f["properties"]

    def test_custom_name(self):
        """Property name should be configurable."""
        data = np.ones((5, 5), dtype=np.float32)
        result = grid_to_geojson(data, name="slope")
        assert "slope" in result["features"][0]["properties"]

    def test_custom_transform(self):
        """Custom transform should produce correct coordinates."""
        data = np.ones((3, 3), dtype=np.float32) * 100
        transform = (40.0, -74.0, 0.01, 0.01)
        result = grid_to_geojson(data, transform=transform)
        coords = [f["geometry"]["coordinates"] for f in result["features"]]
        lons = [c[0] for c in coords]
        lats = [c[1] for c in coords]
        assert min(lons) >= -74.0
        assert max(lats) >= 40.0

    def test_max_points_subsampling(self):
        """Should subsample when grid exceeds max_points."""
        data = np.random.rand(100, 100).astype(np.float32)
        result = grid_to_geojson(data, max_points=500)
        assert len(result["features"]) <= 500

    def test_nan_handling(self):
        """NaN values should be excluded."""
        data = np.full((10, 10), np.nan)
        data[0, 0] = 42.0
        result = grid_to_geojson(data)
        assert len(result["features"]) == 1
        assert result["features"][0]["properties"]["terrain"] == 42.0

    def test_geojson_serializable(self):
        """Output should be JSON-serializable."""
        data = np.random.rand(5, 5).astype(np.float32) * 100
        result = grid_to_geojson(data)
        json_str = json.dumps(result)
        assert len(json_str) > 0


class TestContourToGeoJSON:
    """Tests for contour_to_geojson."""

    def test_basic_output(self):
        np.random.seed(42)
        dem = np.random.randint(100, 500, size=(50, 50)).astype(np.float32)
        result = contour_to_geojson(dem, interval=50)
        assert result["type"] == "FeatureCollection"
        assert len(result["features"]) > 0

    def test_line_geometry(self):
        """Features should have LineString geometry."""
        np.random.seed(42)
        dem = np.random.randint(100, 500, size=(30, 30)).astype(np.float32)
        result = contour_to_geojson(dem, interval=100)
        for f in result["features"]:
            assert f["geometry"]["type"] == "LineString"
            assert len(f["geometry"]["coordinates"]) >= 2

    def test_elevation_property(self):
        """Each contour should have elevation property."""
        np.random.seed(42)
        dem = np.random.randint(0, 1000, size=(40, 40)).astype(np.float32)
        result = contour_to_geojson(dem, interval=200)
        for f in result["features"]:
            assert "elevation" in f["properties"]
            assert isinstance(f["properties"]["elevation"], (int, float))

    def test_custom_interval(self):
        """Smaller interval should produce more contours."""
        np.random.seed(42)
        dem = np.random.randint(0, 1000, size=(30, 30)).astype(np.float32)
        r1 = contour_to_geojson(dem, interval=100)
        r2 = contour_to_geojson(dem, interval=50)
        assert len(r2["features"]) >= len(r1["features"])

    def test_flat_dem_no_contours(self):
        """Flat terrain should produce no contours."""
        dem = np.full((20, 20), 100.0, dtype=np.float32)
        result = contour_to_geojson(dem, interval=10, min_elev=0, max_elev=200)
        assert len(result["features"]) == 0
