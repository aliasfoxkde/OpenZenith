"""OpenZenith Vector Data — read/write shapefiles and Esri File Geodatabases.

Usage:
    from openzenith.vector import (
        shapefile_to_geojson, gdb_to_geojson, list_gdb_layers, export_to_gdb
    )

    # Read a shapefile (pure Python, no GDAL needed)
    gj = shapefile_to_geojson("streams.shp")

    # Read a GDB feature class (requires fiona/gdal)
    gj = gdb_to_geojson("data.gdb", layer="Rivers")
    layers = list_gdb_layers("data.gdb")

    # Write a GeoJSON to GDB
    export_to_gdb(gj, "output.gdb", layer_name="Rivers")
"""

from __future__ import annotations

from typing import Any

import shapefile  # pyshp - pure Python, no GDAL

# ─── Shapefile (pure Python, no GDAL) ─────────────────────────────────────────


def shapefile_to_geojson(
    shp_path: str,
    bbox: tuple[float, float, float, float] | None = None,
    filter_fields: list[str] | None = None,
) -> dict:
    """Read a shapefile and return a GeoJSON FeatureCollection.

    Args:
        shp_path: Path to .shp file (or directory containing shapefile files)
        bbox: Optional (minx, miny, maxx, maxy) bounding box filter
        filter_fields: Only include these attribute fields

    Returns:
        GeoJSON FeatureCollection dict
    """
    sf = shapefile.Reader(shp_path)
    shape_type_map = {
        shapefile.NULL: "GeometryCollection",
        shapefile.POINT: "Point",
        shapefile.POINTZ: "Point",
        shapefile.MULTIPOINT: "MultiPoint",
        shapefile.MULTIPOINTZ: "MultiPoint",
        shapefile.POLYLINE: "LineString",
        shapefile.POLYGON: "Polygon",
    }
    # Handle Z-suffix types in older pyshp versions
    for _attr in ("POLYLINZ", "POLYGONZ"):
        _val = getattr(shapefile, _attr, None)
        if _val:
            shape_type_map[_val] = "MultiLineString" if "LINE" in _attr else "MultiPolygon"
    geom_type = shape_type_map.get(sf.shapeType, "GeometryCollection")

    fields = [f[0] for f in sf.fields[1:]]  # skip DeletionFlag

    features = []
    for shapeRec in sf:
        shape_bbox = getattr(shapeRec.shape, "bbox", None)
        # pyshp 3.x Point shapes have no .bbox — compute from coordinates
        if shape_bbox is None:
            pts = getattr(shapeRec.shape, "points", None)
            if pts and len(pts) > 0:
                xs = [p[0] for p in pts]
                ys = [p[1] for p in pts]
                shape_bbox = (min(xs), min(ys), max(xs), max(ys))
        if bbox and shape_bbox is not None and not _bbox_intersects(bbox, shape_bbox):
            continue

        coords = _shape_points_to_coords(shapeRec.shape, geom_type)
        props = dict(zip(fields, shapeRec.record))
        if filter_fields:
            props = {k: v for k, v in props.items() if k in filter_fields}

        features.append({
            "type": "Feature",
            "geometry": {"type": geom_type, "coordinates": coords},
            "properties": props,
        })

    return {"type": "FeatureCollection", "features": features}


def _shape_points_to_coords(shape: Any, geom_type: str) -> list:
    pts = shape.points
    if geom_type == "Point":
        return list(pts[0]) if pts else []
    if geom_type == "LineString":
        return [list(p) for p in pts]
    if geom_type in ("Polygon", "MultiPolygon"):
        parts = list(shape.parts) + [len(pts)]
        rings = []
        for i in range(len(parts) - 1):
            rings.append([list(p) for p in pts[parts[i]:parts[i + 1]]])
        if geom_type == "Polygon":
            return rings
        return [rings]
    if geom_type == "MultiLineString":
        parts = list(shape.parts) + [len(pts)]
        lines = []
        for i in range(len(parts) - 1):
            lines.append([list(p) for p in pts[parts[i]:parts[i + 1]]])
        return lines
    return [list(p) for p in pts]


def _bbox_intersects(a: tuple, b: tuple) -> bool:
    return not (a[2] < b[0] or b[2] < a[0] or a[3] < b[1] or b[3] < a[1])


# ─── GDB (requires fiona + GDAL) ──────────────────────────────────────────────


def gdb_to_geojson(gdb_path: str, layer: str | None = None) -> dict:
    """Read an Esri File Geodatabase feature class as GeoJSON.

    Requires: pip install fiona

    Args:
        gdb_path: Path to .gdb directory
        layer: Feature class name (or None to read the first layer)

    Returns:
        GeoJSON FeatureCollection dict
    """
    try:
        import fiona
    except ImportError as err:
        raise ImportError(
            "Reading GDB files requires fiona. "
            "Install with: pip install fiona"
        ) from err

    if layer:
        with fiona.open(gdb_path, layer=layer) as src:
            return {"type": "FeatureCollection", "features": list(src)}
    else:
        layers = fiona.listlayers(gdb_path)
        if not layers:
            raise ValueError(f"No layers found in GDB: {gdb_path}")
        with fiona.open(gdb_path, layer=layers[0]) as src:
            return {"type": "FeatureCollection", "features": list(src)}


def list_gdb_layers(gdb_path: str) -> list[str]:
    """List feature class names in a GDB.

    Requires: pip install fiona
    """
    try:
        import fiona
    except ImportError as err:
        raise ImportError(
            "Listing GDB layers requires fiona. "
            "Install with: pip install fiona"
        ) from err
    return fiona.listlayers(gdb_path)


def export_to_gdb(
    geojson: dict,
    output_path: str,
    layer_name: str = "features",
    geometry_type: str | None = None,
) -> None:
    """Write a GeoJSON FeatureCollection to an Esri File Geodatabase.

    Requires: pip install fiona

    Args:
        geojson: GeoJSON FeatureCollection dict
        output_path: Path to the output .gdb directory (will be created)
        layer_name: Name of the feature class within the GDB
        geometry_type: Override geometry type (auto-detected from first feature if None)
    """
    try:
        import fiona
    except ImportError as err:
        raise ImportError(
            "Writing GDB files requires fiona. "
            "Install with: pip install fiona"
        ) from err

    features = geojson.get("features", [])
    if not features:
        raise ValueError("GeoJSON has no features")

    # Auto-detect geometry type from first feature
    if geometry_type is None:
        first = features[0].get("geometry", {})
        gtype = first.get("type", "").lower()
        type_map = {
            "point": "Point",
            "linestring": "LineString",
            "polygon": "Polygon",
            "multipoint": "MultiPoint",
            "multilinestring": "MultiLineString",
            "multipolygon": "MultiPolygon",
        }
        geometry_type = type_map.get(gtype, "Unknown")

    # Build schema from properties of first feature
    sample_props = features[0].get("properties", {})
    schema_fields: dict[str, str] = {}
    for k, v in sample_props.items():
        if v is None:
            schema_fields[k] = "str"
        elif isinstance(v, bool):
            schema_fields[k] = "bool"
        elif isinstance(v, int):
            schema_fields[k] = "int"
        elif isinstance(v, float):
            schema_fields[k] = "float"
        else:
            schema_fields[k] = "str"

    schema = {
        "geometry": geometry_type,
        "properties": schema_fields,
    }

    # Write the GDB
    with fiona.open(
        output_path,
        layer=layer_name,
        mode="w",
        driver="FileGDB",
        schema=schema,
        crs="EPSG:4326",
    ) as dst:
        for feature in features:
            geom = feature.get("geometry", {})
            props = feature.get("properties", {})
            # Ensure all properties are strings/numbers (not None for fiona)
            clean_props = {}
            for k, v in props.items():
                if v is None:
                    clean_props[k] = ""
                else:
                    clean_props[k] = v
            dst.write({
                "geometry": geom,
                "properties": clean_props,
            })
