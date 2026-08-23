"""Tests for openzenith.vector — shapefile and GDB read/write."""


import pytest

# shapefile is pyshp
import shapefile

from openzenith.vector import shapefile_to_geojson


class TestShapefileToGeojson:
    def test_point_features(self, tmp_path):
        """Convert point shapefile to GeoJSON."""

        shp_path = tmp_path / "points.shp"
        with shapefile.Writer(str(shp_path), shapefile.POINT) as w:
            w.field("name", "C")
            w.field("value", "N", decimal=2)
            w.point(10.0, 20.0)
            w.record("Alpha", 1.5)
            w.point(30.0, 40.0)
            w.record("Beta", 2.5)
        w.close()

        result = shapefile_to_geojson(str(shp_path))
        assert result["type"] == "FeatureCollection"
        assert len(result["features"]) == 2

        names = {f["properties"]["name"] for f in result["features"]}
        assert names == {"Alpha", "Beta"}

        coords = {tuple(f["geometry"]["coordinates"]) for f in result["features"]}
        assert coords == {(10.0, 20.0), (30.0, 40.0)}

    def test_polygon_features(self, tmp_path):
        """Convert polygon shapefile to GeoJSON."""

        shp_path = tmp_path / "polys.shp"
        with shapefile.Writer(str(shp_path), shapefile.POLYGON) as w:
            w.field("id", "N")
            # Simple square polygon
            w.poly([[[0, 0], [1, 0], [1, 1], [0, 0]]])
            w.record(1)
        w.close()

        result = shapefile_to_geojson(str(shp_path))
        assert result["type"] == "FeatureCollection"
        assert len(result["features"]) == 1
        assert result["features"][0]["geometry"]["type"] == "Polygon"
        assert result["features"][0]["properties"]["id"] == 1

    def test_linestring_features(self, tmp_path):
        """Convert linestring shapefile to GeoJSON."""

        shp_path = tmp_path / "lines.shp"
        with shapefile.Writer(str(shp_path), shapefile.POLYLINE) as w:
            w.field("name", "C")
            w.line([[[0, 0], [1, 1], [2, 0]]])
            w.record("Diagonal")
        w.close()

        result = shapefile_to_geojson(str(shp_path))
        assert result["features"][0]["geometry"]["type"] == "LineString"
        assert result["features"][0]["properties"]["name"] == "Diagonal"

    def test_bbox_filter(self, tmp_path):
        """Bounding box filter excludes features outside bbox."""

        shp_path = tmp_path / "filtered.shp"
        with shapefile.Writer(str(shp_path), shapefile.POINT) as w:
            w.field("id", "N")
            w.point(0.5, 0.5)
            w.record(1)
            w.point(50.0, 50.0)  # outside bbox
            w.record(2)
        w.close()

        result = shapefile_to_geojson(str(shp_path), bbox=(0, 0, 1, 1))
        assert len(result["features"]) == 1
        assert result["features"][0]["properties"]["id"] == 1

    def test_field_filter(self, tmp_path):
        """Only requested fields are included in properties."""

        shp_path = tmp_path / "fields.shp"
        with shapefile.Writer(str(shp_path), shapefile.POINT) as w:
            w.field("a", "N")
            w.field("b", "N")
            w.field("c", "N")
            w.point(0, 0)
            w.record(1, 2, 3)
        w.close()

        result = shapefile_to_geojson(str(shp_path), filter_fields=["a", "c"])
        props = result["features"][0]["properties"]
        assert "a" in props
        assert "c" in props
        assert "b" not in props

    def test_empty_shapefile(self, tmp_path):
        """Empty shapefile returns empty FeatureCollection."""

        shp_path = tmp_path / "empty.shp"
        with shapefile.Writer(str(shp_path), shapefile.POINT) as w:
            w.field("id", "N")
        w.close()

        result = shapefile_to_geojson(str(shp_path))
        assert result["type"] == "FeatureCollection"
        assert len(result["features"]) == 0


class TestGdbToGeojson:
    def test_gdb_import_error_if_fiona_missing(self, monkeypatch):
        """GDB functions raise ImportError when fiona is not available."""
        import openzenith.vector as vector_module

        monkeypatch.setitem(__import__("sys").modules, "fiona", None)
        # Force reimport to trigger ImportError
        import importlib
        importlib.reload(vector_module)

        with pytest.raises(ImportError, match="requires fiona"):
            vector_module.gdb_to_geojson("/fake/path.gdb")

    def test_list_gdb_layers_import_error(self, monkeypatch):
        """list_gdb_layers raises ImportError without fiona."""
        import importlib

        import openzenith.vector as vector_module
        importlib.reload(vector_module)

        monkeypatch.setitem(__import__("sys").modules, "fiona", None)
        with pytest.raises(ImportError, match="requires fiona"):
            vector_module.list_gdb_layers("/fake/path.gdb")


class TestExportToGdb:
    def test_export_import_error_if_fiona_missing(self, monkeypatch):
        """export_to_gdb raises ImportError when fiona is not available."""
        import importlib

        import openzenith.vector as vector_module
        importlib.reload(vector_module)

        monkeypatch.setitem(__import__("sys").modules, "fiona", None)
        with pytest.raises(ImportError, match="requires fiona"):
            vector_module.export_to_gdb(
                {"type": "FeatureCollection", "features": []},
                "/fake/output.gdb",
            )
