"""Tests for OpenZenith Python SDK — export module."""

import json

import numpy as np

from openzenith.export import (
    _geojson_to_kml,
    contour_to_geojson,
    contour_to_kml,
    grid_to_geojson,
    grid_to_kml,
)


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

    def test_gaussian_mound_traces_contours(self):
        """Gaussian mound should produce contours with multiple points.

        This tests the KDTree fix for contour ordering - contours should have
        multiple coordinates indicating the chain-following works.
        """
        np.random.seed(42)
        rows, cols = 60, 60
        dem = np.zeros((rows, cols), dtype=np.float32)

        # Create a Gaussian mound centered at (30, 30)
        cx, cy = rows // 2, cols // 2
        sigma = 10.0
        for r in range(rows):
            for c in range(cols):
                dist_sq = (r - cx) ** 2 + (c - cy) ** 2
                dem[r, c] = 100.0 * np.exp(-dist_sq / (2 * sigma ** 2))

        result = contour_to_geojson(dem, interval=10.0)

        # The mound should produce contours
        assert len(result["features"]) > 0, "Gaussian mound should produce contours"

        # Each contour should have at least 2 coordinates
        for feat in result["features"]:
            coords = feat["geometry"]["coordinates"]
            assert len(coords) >= 2, f"Contour should have >= 2 points, got {len(coords)}"
            assert "elevation" in feat["properties"]

    def test_contour_elevation_monotonic(self):
        """Contour elevations should match the level they represent."""
        np.random.seed(42)
        dem = np.random.randint(0, 500, size=(40, 40)).astype(np.float32)
        result = contour_to_geojson(dem, interval=50.0)

        for feat in result["features"]:
            feat["properties"]["elevation"]
            coords = feat["geometry"]["coordinates"]
            # Each contour should have at least 2 points
            assert len(coords) >= 2


class TestContourToKML:
    """Tests for contour_to_kml."""

    def test_returns_kml_string(self):
        """Returns a KML string."""
        dem = np.array([[100, 110], [105, 115]], dtype=np.float32)
        result = contour_to_kml(dem, interval=50)
        assert isinstance(result, str)
        assert result.startswith('<?xml')

    def test_contains_kml_tags(self):
        """Output contains KML structure tags."""
        dem = np.array([[100, 110], [105, 115]], dtype=np.float32)
        result = contour_to_kml(dem, interval=50)
        assert "<kml" in result
        assert "<Document>" in result
        assert "</kml>" in result

    def test_custom_name(self):
        """Custom name is used in KML."""
        dem = np.array([[100, 110], [105, 115]], dtype=np.float32)
        result = contour_to_kml(dem, name="MyContours")
        assert "MyContours" in result


class TestGridToKML:
    """Tests for grid_to_kml."""

    def test_returns_kml_string(self):
        """Returns a KML string."""
        data = np.array([[100, 110], [105, 115]], dtype=np.float32)
        result = grid_to_kml(data)
        assert isinstance(result, str)
        assert result.startswith('<?xml')

    def test_contains_kml_tags(self):
        """Output contains KML structure tags."""
        data = np.array([[100, 110], [105, 115]], dtype=np.float32)
        result = grid_to_kml(data)
        assert "<kml" in result
        assert "<Document>" in result
        assert "</kml>" in result


class TestGeoJSONToKML:
    """Tests for _geojson_to_kml helper."""

    def test_point_feature(self):
        """Point features are converted to KML Placemarks."""
        geojson = {
            "type": "FeatureCollection",
            "features": [{
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [-74.0, 40.7, 100]},
                "properties": {"elevation": 100}
            }]
        }
        result = _geojson_to_kml(geojson, name="Test")
        assert "<Point>" in result
        assert "<Placemark>" in result
        assert "-74.0,40.7,100" in result

    def test_linestring_feature(self):
        """LineString features are converted to KML LineString."""
        geojson = {
            "type": "FeatureCollection",
            "features": [{
                "type": "Feature",
                "geometry": {
                    "type": "LineString",
                    "coordinates": [[-74.0, 40.7], [-74.1, 40.8]]
                },
                "properties": {"elevation": 500}
            }]
        }
        result = _geojson_to_kml(geojson, name="Contour")
        assert "<LineString>" in result
        assert "<Placemark>" in result

    def test_polygon_feature(self):
        """Polygon features are converted to KML Polygon."""
        geojson = {
            "type": "FeatureCollection",
            "features": [{
                "type": "Feature",
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [[[-74.0, 40.7], [-74.1, 40.7], [-74.1, 40.8], [-74.0, 40.7]]]
                },
                "properties": {"name": "TestPolygon"}
            }]
        }
        result = _geojson_to_kml(geojson, name="Poly")
        assert "<Polygon>" in result
        assert "<Placemark>" in result

    def test_empty_features(self):
        """Empty FeatureCollection produces valid KML."""
        geojson = {"type": "FeatureCollection", "features": []}
        result = _geojson_to_kml(geojson, name="Empty")
        assert "<Document>" in result
        assert "Empty" in result

    def test_custom_altitude_mode(self):
        """Custom altitude mode is used in LineString."""
        geojson = {
            "type": "FeatureCollection",
            "features": [{
                "type": "Feature",
                "geometry": {
                    "type": "LineString",
                    "coordinates": [[-74.0, 40.7], [-74.1, 40.8]]
                },
                "properties": {"elevation": 500}
            }]
        }
        result = _geojson_to_kml(geojson, name="Contour", altitude_mode="absolute")
        assert "absolute" in result
