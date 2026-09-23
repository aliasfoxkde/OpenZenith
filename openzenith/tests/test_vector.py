"""Tests for openzenith.vector — shapefile and GDB read/write."""

import pytest

# shapefile is pyshp
import shapefile

from openzenith.vector import _shape_points_to_coords, shapefile_to_geojson


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


class TestMultipartGeometry:
    def test_multipart_polygon_rings(self, tmp_path):
        """Each polygon part becomes its own ring in the output coordinates."""
        shp_path = tmp_path / "multipart.shp"
        with shapefile.Writer(str(shp_path), shapefile.POLYGON) as w:
            w.field("id", "N")
            w.poly(
                [
                    [[0, 0], [1, 0], [1, 1], [0, 0]],
                    [[10, 10], [11, 10], [11, 11], [10, 10]],
                ]
            )
            w.record(7)
        w.close()

        result = shapefile_to_geojson(str(shp_path))
        rings = result["features"][0]["geometry"]["coordinates"]
        assert len(rings) == 2
        assert rings[0][0] == [0.0, 0.0]
        assert rings[1][0] == [10.0, 10.0]

    def test_multiline_parts(self, tmp_path):
        """A multi-part polyline maps to nested line coordinates."""
        shp_path = tmp_path / "multiline.shp"
        with shapefile.Writer(str(shp_path), shapefile.POLYLINE) as w:
            w.field("name", "C")
            w.line(
                [
                    [[0, 0], [1, 1]],
                    [[5, 5], [6, 6]],
                ]
            )
            w.record("fork")
        w.close()

        result = shapefile_to_geojson(str(shp_path))
        geom = result["features"][0]["geometry"]
        assert geom["type"] == "LineString"
        assert len(geom["coordinates"]) == 4  # all parts' points, flattened

    def test_multipoint_features(self, tmp_path):
        """MultiPoint shapes pass their point list through as coordinates."""
        shp_path = tmp_path / "multipoint.shp"
        with shapefile.Writer(str(shp_path), shapefile.MULTIPOINT) as w:
            w.field("id", "N")
            w.multipoint([[1, 2], [3, 4]])
            w.record(9)
        w.close()

        result = shapefile_to_geojson(str(shp_path))
        coords = result["features"][0]["geometry"]["coordinates"]
        assert [list(c) for c in coords] == [[1.0, 2.0], [3.0, 4.0]]

    def test_polygon_z_shape_becomes_multipolygon(self, tmp_path):
        """A Z-type polygon shapefile wraps its rings one polygon deep."""
        shp_path = tmp_path / "polygon_z.shp"
        with shapefile.Writer(str(shp_path), shapeType=shapefile.POLYGONZ) as w:
            w.field("id", "N")
            w.shape(
                shapefile.Shape(
                    shapefile.POLYGONZ,
                    points=[[0, 0], [1, 0], [1, 1], [0, 0]],
                    parts=[0],
                )
            )
            w.record(1)

        geom = shapefile_to_geojson(str(shp_path))["features"][0]["geometry"]
        assert geom["type"] == "MultiPolygon"
        # One polygon holding one ring: GeoJSON MultiPolygon shape.
        assert geom["coordinates"] == [[[[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 0.0]]]]

    def test_z_polyline_parts_nest_one_coordinate_list_per_part(self, tmp_path):
        """The MultiLineString branch splits points at the part offsets."""
        shp_path = tmp_path / "polyline_z.shp"
        with shapefile.Writer(str(shp_path), shapeType=shapefile.POLYLINEZ) as w:
            w.field("name", "C")
            w.shape(
                shapefile.Shape(
                    shapefile.POLYLINEZ,
                    points=[[0, 0], [1, 1], [5, 5], [6, 6]],
                    parts=[0, 2],
                )
            )
            w.record("fork")

        reader = shapefile.Reader(str(shp_path))
        try:
            coords = _shape_points_to_coords(reader.shape(0), "MultiLineString")
        finally:
            reader.close()

        assert coords == [
            [[0.0, 0.0], [1.0, 1.0]],
            [[5.0, 5.0], [6.0, 6.0]],
        ]

    def test_z_polyline_shapefile_is_a_multipoint_of_its_parts(self, tmp_path):
        """A POLYLINEZ shapefile maps to "MultiLineString" via the Z alias.

        Regression: vector.py looked the alias up as ``POLYLINZ`` (a typo for
        POLYLINEZ), so no shape type ever registered as "MultiLineString" and
        Z polylines dropped into the default branch with flattened
        coordinates.
        """
        shp_path = tmp_path / "polyline_z_fallback.shp"
        with shapefile.Writer(str(shp_path), shapeType=shapefile.POLYLINEZ) as w:
            w.field("name", "C")
            w.shape(
                shapefile.Shape(
                    shapefile.POLYLINEZ,
                    points=[[0, 0], [1, 1], [5, 5], [6, 6]],
                    parts=[0, 2],
                )
            )
            w.record("fork")

        geom = shapefile_to_geojson(str(shp_path))["features"][0]["geometry"]
        assert geom["type"] == "MultiLineString"
        assert geom["coordinates"] == [
            [[0.0, 0.0], [1.0, 1.0]],
            [[5.0, 5.0], [6.0, 6.0]],
        ]


class _FakeFionaOpen:
    """Records fiona.open() calls; yields recorded writes via the context."""

    def __init__(self):
        self.calls = []
        self.written = []

    def __call__(self, path, layer=None, mode="r", **kwargs):
        self.calls.append({"path": path, "layer": layer, "mode": mode, **kwargs})
        return self

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def __iter__(self):
        return iter([{"fixture": True}])

    def write(self, feature):
        self.written.append(feature)


def _install_fake_fiona(monkeypatch):
    """Install a module-shaped fake: fiona.open(...) plus fiona.listlayers()."""
    import sys
    import types

    opener = _FakeFionaOpen()
    module = types.SimpleNamespace(
        open=opener,
        listlayers=lambda path: ["Rivers", "Lakes"],
    )
    monkeypatch.setitem(sys.modules, "fiona", module)
    return opener


class TestGdbWithFakeFiona:
    def test_gdb_to_geojson_named_layer(self, monkeypatch):
        from openzenith.vector import gdb_to_geojson

        fake = _install_fake_fiona(monkeypatch)
        result = gdb_to_geojson("data.gdb", layer="Rivers")
        assert fake.calls[0]["layer"] == "Rivers"
        assert result == {"type": "FeatureCollection", "features": [{"fixture": True}]}

    def test_gdb_to_geojson_defaults_to_first_layer(self, monkeypatch):
        from openzenith.vector import gdb_to_geojson

        fake = _install_fake_fiona(monkeypatch)
        gdb_to_geojson("data.gdb")
        assert fake.calls[0]["layer"] == "Rivers"

    def test_gdb_to_geojson_no_layers_raises(self, monkeypatch):
        import sys

        from openzenith.vector import gdb_to_geojson

        _install_fake_fiona(monkeypatch)
        sys.modules["fiona"].listlayers = lambda path: []
        with pytest.raises(ValueError, match="No layers found"):
            gdb_to_geojson("data.gdb")

    def test_list_gdb_layers(self, monkeypatch):
        from openzenith.vector import list_gdb_layers

        _install_fake_fiona(monkeypatch)
        assert list_gdb_layers("data.gdb") == ["Rivers", "Lakes"]

    def test_export_autodetects_geometry_and_cleans_props(self, monkeypatch, tmp_path):
        from openzenith.vector import export_to_gdb

        fake = _install_fake_fiona(monkeypatch)
        geojson = {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "geometry": {"type": "Point", "coordinates": [1.0, 2.0]},
                    "properties": {"name": "A", "rank": 3, "score": 1.5, "ok": True},
                },
                {
                    "type": "Feature",
                    "geometry": {"type": "Point", "coordinates": [3.0, 4.0]},
                    "properties": {"name": None, "rank": None, "score": None, "ok": None},
                },
            ],
        }
        out = tmp_path / "out.gdb"
        export_to_gdb(geojson, str(out), layer_name="Points")

        call = fake.calls[0]
        assert call["mode"] == "w"
        assert call["driver"] == "FileGDB"
        assert call["schema"]["geometry"] == "Point"
        # Schema inferred from the first feature's value types.
        assert call["schema"]["properties"] == {
            "name": "str",
            "rank": "int",
            "score": "float",
            "ok": "bool",
        }
        # None properties are blanked so fiona never receives None.
        assert fake.written[1]["properties"]["name"] == ""
        assert len(fake.written) == 2

    def test_export_empty_features_raises(self, monkeypatch):
        from openzenith.vector import export_to_gdb

        _install_fake_fiona(monkeypatch)
        with pytest.raises(ValueError, match="no features"):
            export_to_gdb({"type": "FeatureCollection", "features": []}, "out.gdb")

    def test_export_unknown_geometry_falls_back(self, monkeypatch, tmp_path):
        from openzenith.vector import export_to_gdb

        fake = _install_fake_fiona(monkeypatch)
        geojson = {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "geometry": {"type": "Tetrahedron", "coordinates": []},
                    "properties": {},
                }
            ],
        }
        export_to_gdb(geojson, str(tmp_path / "o.gdb"))
        assert fake.calls[0]["schema"]["geometry"] == "Unknown"

    def test_export_schema_maps_none_property_to_str(self, monkeypatch, tmp_path):
        """A None-valued property on the first feature becomes a str field."""
        from openzenith.vector import export_to_gdb

        fake = _install_fake_fiona(monkeypatch)
        geojson = {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "geometry": {"type": "Point", "coordinates": [0.0, 0.0]},
                    "properties": {"note": None, "rank": 2},
                }
            ],
        }
        export_to_gdb(geojson, str(tmp_path / "out.gdb"))
        assert fake.calls[0]["schema"]["properties"] == {"note": "str", "rank": "int"}
