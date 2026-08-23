"""Tests for openzenith.overlay — vector-DEM overlay operations."""

import numpy as np

from openzenith.overlay import extract_at_points, rasterize_lines, zonal_stats


class TestExtractAtPoints:
    def test_extract_single_point(self):
        """Extract elevation at a single known point."""
        dem = np.array([[100, 200], [300, 400]], dtype=np.float32)
        # coordinates are [lon, lat] = [0.5, 0.5]
        # transform = (lat0, lon0, dy, dx) = (0, 0, 1, 1)
        # r = round((lat - lat0)/dy) = round(0.5/1) = 0
        # c = round((lon - lon0)/dx) = round(0.5/1) = 0
        # so dem[0, 0] = 100
        geojson = {
            "type": "FeatureCollection",
            "features": [{
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [0.5, 0.5]},
                "properties": {"id": 1},
            }],
        }
        results = extract_at_points(geojson, dem, transform=(0.0, 0.0, 1.0, 1.0))
        assert len(results) == 1
        assert results[0]["id"] == 1
        assert results[0]["elevation"] == 100.0
        assert "slope_deg" in results[0]
        assert "aspect_deg" in results[0]
        assert "tpi" in results[0]

    def test_extract_multiple_points(self):
        """Extract at multiple points with mixed types."""
        dem = np.full((10, 10), 100.0, dtype=np.float32)
        dem[5, 5] = 1234.0
        geojson = {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "geometry": {"type": "Point", "coordinates": [0.5, 0.5]},
                    "properties": {"name": "center"},
                },
                {
                    "type": "Feature",
                    "geometry": {"type": "Point", "coordinates": [0.0, 0.0]},
                    "properties": {"name": "corner"},
                },
            ],
        }
        results = extract_at_points(geojson, dem, transform=(0.0, 0.0, 1.0, 1.0))
        assert len(results) == 2
        ids = {r["name"] for r in results}
        assert ids == {"center", "corner"}

    def test_outside_point_returns_none(self):
        """Point outside DEM bounds returns None for elevation."""
        dem = np.zeros((5, 5), dtype=np.float32)
        geojson = {
            "type": "FeatureCollection",
            "features": [{
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [99.0, 99.0]},
                "properties": {},
            }],
        }
        results = extract_at_points(geojson, dem, transform=(0.0, 0.0, 1.0, 1.0))
        assert results[0]["elevation"] is None

    def test_non_point_features_skipped(self):
        """Non-Point geometries are silently skipped."""
        dem = np.zeros((5, 5), dtype=np.float32)
        geojson = {
            "type": "FeatureCollection",
            "features": [{
                "type": "Feature",
                "geometry": {"type": "LineString", "coordinates": [[0, 0], [1, 1]]},
                "properties": {},
            }],
        }
        results = extract_at_points(geojson, dem)
        assert len(results) == 0

    def test_field_filter(self):
        """Only requested fields are included in output."""
        dem = np.zeros((3, 3), dtype=np.float32)
        geojson = {
            "type": "FeatureCollection",
            "features": [{
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [0.5, 0.5]},
                "properties": {"a": 1, "b": 2, "c": 3},
            }],
        }
        results = extract_at_points(geojson, dem, fields=["a", "c"])
        assert "a" in results[0]
        assert "c" in results[0]
        assert "b" not in results[0]


class TestZonalStats:
    def test_zonal_stats_basic(self):
        """Compute mean/max/min for a simple polygon."""
        dem = np.array([[10, 10, 10], [10, 50, 10], [10, 10, 10]], dtype=np.float32)
        # Small square polygon covering the center cell
        geojson = {
            "type": "FeatureCollection",
            "features": [{
                "type": "Feature",
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [[[0.4, 0.4], [1.6, 0.4], [1.6, 1.6], [0.4, 1.6], [0.4, 0.4]]],
                },
                "properties": {"zone": "A"},
            }],
        }
        results = zonal_stats(geojson, dem, transform=(0.0, 0.0, 1.0, 1.0))
        assert len(results) == 1
        assert results[0]["zone"] == "A"
        assert results[0]["dem_value_mean"] == 50.0
        assert results[0]["dem_value_max"] == 50.0
        assert results[0]["dem_value_min"] == 50.0
        assert results[0]["dem_value_sum"] == 50.0

    def test_polygon_outside_grid(self):
        """Polygon completely outside grid returns None stats."""
        dem = np.zeros((5, 5), dtype=np.float32)
        geojson = {
            "type": "FeatureCollection",
            "features": [{
                "type": "Feature",
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [[[100, 100], [200, 100], [200, 200], [100, 200], [100, 100]]],
                },
                "properties": {"id": 1},
            }],
        }
        results = zonal_stats(geojson, dem, transform=(0.0, 0.0, 1.0, 1.0))
        assert results[0]["dem_value_mean"] is None

    def test_zonal_stats_nodata_masked(self):
        """NoData values (-32768) are excluded from stats."""
        dem = np.array([[100, -32768], [-32768, 200]], dtype=np.float32)
        geojson = {
            "type": "FeatureCollection",
            "features": [{
                "type": "Feature",
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [[[-0.5, -0.5], [1.5, -0.5], [1.5, 1.5], [-0.5, 1.5], [-0.5, -0.5]]],
                },
                "properties": {},
            }],
        }
        results = zonal_stats(geojson, dem, transform=(0.0, 0.0, 1.0, 1.0), stats=["mean", "count"])
        assert results[0]["dem_value_mean"] == 150.0  # (100+200)/2
        assert results[0]["dem_value_count"] == 2

    def test_stats_parameter(self):
        """Only requested stats are computed."""
        dem = np.array([[10, 20], [30, 40]], dtype=np.float32)
        geojson = {
            "type": "FeatureCollection",
            "features": [{
                "type": "Feature",
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [[[-0.5, -0.5], [1.5, -0.5], [1.5, 1.5], [-0.5, 1.5], [-0.5, -0.5]]],
                },
                "properties": {},
            }],
        }
        results = zonal_stats(geojson, dem, transform=(0.0, 0.0, 1.0, 1.0), stats=["mean", "std"])
        assert "dem_value_mean" in results[0]
        assert "dem_value_std" in results[0]
        assert "dem_value_max" not in results[0]


class TestRasterizeLines:
    def test_rasterize_single_line(self):
        """Rasterize a horizontal line across the grid."""
        dem = np.zeros((5, 5), dtype=np.float32)
        geojson = {
            "type": "FeatureCollection",
            "features": [{
                "type": "Feature",
                "geometry": {
                    "type": "LineString",
                    "coordinates": [[0.0, 2.5], [4.0, 2.5]],
                },
                "properties": {},
            }],
        }
        raster = rasterize_lines(geojson, dem, transform=(0.0, 0.0, 1.0, 1.0))
        assert raster.shape == (5, 5)
        # Row 2 (lat 2.5) should be burned
        assert (raster[2, :] == 1.0).all()
        assert raster.sum() == 5.0

    def test_rasterize_diagonal_line(self):
        """Rasterize a diagonal line."""
        dem = np.zeros((5, 5), dtype=np.float32)
        geojson = {
            "type": "FeatureCollection",
            "features": [{
                "type": "Feature",
                "geometry": {
                    "type": "LineString",
                    "coordinates": [[0.0, 0.0], [4.0, 4.0]],
                },
                "properties": {},
            }],
        }
        raster = rasterize_lines(geojson, dem, transform=(0.0, 0.0, 1.0, 1.0))
        # Diagonal from top-left to bottom-right
        diag_sum = sum(raster[i, i] for i in range(5))
        assert diag_sum == 5.0

    def test_multilinestring(self):
        """MultiLineString features are rasterized."""
        dem = np.zeros((5, 5), dtype=np.float32)
        geojson = {
            "type": "FeatureCollection",
            "features": [{
                "type": "Feature",
                "geometry": {
                    "type": "MultiLineString",
                    "coordinates": [
                        [[0.0, 1.0], [4.0, 1.0]],
                        [[0.0, 3.0], [4.0, 3.0]],
                    ],
                },
                "properties": {},
            }],
        }
        raster = rasterize_lines(geojson, dem, transform=(0.0, 0.0, 1.0, 1.0))
        assert raster[1, :].sum() == 5.0
        assert raster[3, :].sum() == 5.0

    def test_no_features(self):
        """Empty FeatureCollection returns zero raster."""
        dem = np.zeros((5, 5), dtype=np.float32)
        geojson = {"type": "FeatureCollection", "features": []}
        raster = rasterize_lines(geojson, dem)
        assert raster.sum() == 0.0
