"""OpenZenith Vector-DEM Overlay — extract terrain values at vector locations.

Enables GIS workflows where vector features (points, lines, polygons from
shapefiles or GDBs) are enriched with DEM-derived values.

Usage:
    from openzenith.overlay import extract_at_points, zonal_stats

    # Extract elevation, slope, aspect at stream gauge locations
    results = extract_at_points(streams_geojson, dem)

    # Compute mean elevation within watershed polygons
    stats = zonal_stats(watersheds_geojson, dem, stats=["mean", "max", "min"])
"""

from __future__ import annotations

import numpy as np


def extract_at_points(
    geojson: dict,
    dem: np.ndarray,
    transform: tuple[float, float, float, float] | None = None,
    fields: list[str] | None = None,
) -> list[dict]:
    """Extract DEM values at point locations from a GeoJSON FeatureCollection.

    For each Point feature, computes row/col indices and samples the DEM.
    Also computes slope, aspect, and TPI at each point.

    Args:
        geojson: GeoJSON FeatureCollection with Point features
        dem: 2D elevation grid (meters)
        transform: (origin_lat, origin_lon, cell_size_lat, cell_size_lon)
                   If None, assumes 0.001° cells starting at (0, 0).
        fields: Only include these GeoJSON property fields (default: all)

    Returns:
        List of dicts with original properties + lat, lon, elevation,
        slope_deg, aspect_deg, tpi
    """
    from openzenith.terrain import aspect as _aspect
    from openzenith.terrain import slope as _slope
    from openzenith.terrain import tpi as _tpi

    rows, cols = dem.shape

    if transform is None:
        lat0, lon0, dy, dx = 0.0, 0.0, 0.001, 0.001
    else:
        lat0, lon0, dy, dx = transform

    # Precompute terrain derivatives
    slp = _slope(dem, (dy + dx) / 2)
    asp = _aspect(dem, (dy + dx) / 2)
    tpi_vals = _tpi(dem, (dy + dx) / 2)

    results = []
    for feature in geojson.get("features", []):
        geom = feature.get("geometry", {})
        if geom.get("type") != "Point":
            continue

        coords = geom.get("coordinates", [])
        if not coords:
            continue

        lon, lat = coords[0], coords[1]

        # Convert lat/lon to row/col
        r = round((lat - lat0) / dy)
        c = round((lon - lon0) / dx)

        if 0 <= r < rows and 0 <= c < cols:
            elev = float(dem[r, c])
            slope_val = float(slp[r, c]) if not np.isnan(slp[r, c]) else None
            aspect_val = float(asp[r, c]) if not np.isnan(asp[r, c]) else None
            tpi_val = float(tpi_vals[r, c]) if not np.isnan(tpi_vals[r, c]) else None
        else:
            elev, slope_val, aspect_val, tpi_val = None, None, None, None

        props = feature.get("properties", {})
        if fields:
            props = {k: v for k, v in props.items() if k in fields}

        results.append({
            **props,
            "lat": round(lat, 6),
            "lon": round(lon, 6),
            "elevation": elev,
            "slope_deg": slope_val,
            "aspect_deg": aspect_val,
            "tpi": tpi_val,
        })

    return results


def zonal_stats(
    geojson: dict,
    dem: np.ndarray,
    transform: tuple[float, float, float, float] | None = None,
    stats: list[str] | None = None,
    stat_name: str = "dem_value",
) -> list[dict]:
    """Compute zonal statistics for polygons overlaid on a DEM.

    For each Polygon feature, computes statistics (mean, max, min, sum,
    std, count) of DEM values within the polygon.

    Args:
        geojson: GeoJSON FeatureCollection with Polygon features
        dem: 2D elevation grid (meters)
        transform: (origin_lat, origin_lon, cell_size_lat, cell_size_lon)
        stats: List of stats to compute (default: ["mean", "max", "min", "sum"])
        stat_name: Property name prefix for DEM stats (default: "dem_value")

    Returns:
        List of dicts with original properties + zonal statistics
    """
    rows, cols = dem.shape

    if transform is None:
        lat0, lon0, dy, dx = 0.0, 0.0, 0.001, 0.001
    else:
        lat0, lon0, dy, dx = transform

    if stats is None:
        stats = ["mean", "max", "min", "sum"]

    results = []
    for feature in geojson.get("features", []):
        geom = feature.get("geometry", {})
        if geom.get("type") != "Polygon":
            continue

        rings = geom.get("coordinates", [])
        if not rings:
            continue

        # Use the outer ring for the polygon
        outer_ring = np.array(rings[0])
        poly_lats = outer_ring[:, 1]
        poly_lons = outer_ring[:, 0]

        # Compute bounding box of polygon
        r_min = max(0, round((poly_lats.min() - lat0) / dy))
        r_max = min(rows - 1, round((poly_lats.max() - lat0) / dy))
        c_min = max(0, round((poly_lons.min() - lon0) / dx))
        c_max = min(cols - 1, round((poly_lons.max() - lon0) / dx))

        if r_max < r_min or c_max < c_min:
            # Polygon outside grid
            props = feature.get("properties", {})
            for s in stats:
                props[f"{stat_name}_{s}"] = None
            results.append(props)
            continue

        # Extract sub-grid and mask with polygon
        sub = dem[r_min:r_max + 1, c_min:c_max + 1]

        # Create row/col grids for points in sub-grid
        r_idx = np.arange(r_min, r_max + 1)[:, None] * np.ones((1, c_max - c_min + 1), dtype=int)
        c_idx = np.ones((r_max - r_min + 1, 1), dtype=int) * np.arange(c_min, c_max + 1)
        sub_lats = lat0 + r_idx * dy
        sub_lons = lon0 + c_idx * dx

        # Point-in-polygon for each cell center (ray casting)
        mask = _points_in_polygon(sub_lats.ravel(), sub_lons.ravel(), outer_ring)
        mask = mask.reshape(sub.shape)

        valid = sub > -32768.0
        inside = mask & valid
        vals = sub[inside]

        props = feature.get("properties", {})
        if len(vals) == 0:
            for s in stats:
                props[f"{stat_name}_{s}"] = None
        else:
            if "mean" in stats:
                props[f"{stat_name}_mean"] = round(float(np.mean(vals)), 2)
            if "max" in stats:
                props[f"{stat_name}_max"] = round(float(np.max(vals)), 2)
            if "min" in stats:
                props[f"{stat_name}_min"] = round(float(np.min(vals)), 2)
            if "sum" in stats:
                props[f"{stat_name}_sum"] = round(float(np.sum(vals)), 2)
            if "std" in stats:
                props[f"{stat_name}_std"] = round(float(np.std(vals)), 2)
            if "count" in stats:
                props[f"{stat_name}_count"] = len(vals)

        results.append(props)

    return results


def _points_in_polygon(
    lats: np.ndarray,
    lons: np.ndarray,
    polygon: np.ndarray,
) -> np.ndarray:
    """Ray-casting point-in-polygon test for arrays of points.

    polygon is (n, 2) with [lon, lat] vertices.

    Returns boolean array.
    """
    n = len(lats)
    inside = np.zeros(n, dtype=bool)
    px = polygon[:, 0]
    py = polygon[:, 1]
    num_verts = len(px)

    for i in range(n):
        lat, lon = lats[i], lons[i]
        j = num_verts - 1
        c = False
        for k in range(num_verts):
            vi_lat, vi_lon = py[k], px[k]
            vj_lat, vj_lon = py[j], px[j]
            if ((vi_lat > lat) != (vj_lat > lat)) and \
               (lon < (vj_lon - vi_lon) * (lat - vi_lat) / (vj_lat - vi_lat) + vi_lon):
                c = not c
            j = k
        inside[i] = c

    return inside


def rasterize_lines(
    geojson: dict,
    dem: np.ndarray,
    transform: tuple[float, float, float, float] | None = None,
    value: float = 1.0,
    burn_value: float = 1.0,
) -> np.ndarray:
    """Rasterize LineString features onto a DEM-shaped grid.

    Useful for creating stream/channel masks from vector data.

    Args:
        geojson: GeoJSON FeatureCollection with LineString features
        dem: Reference grid for shape/size
        transform: (origin_lat, origin_lon, cell_size_lat, cell_size_lon)
        value: Value to use as the rasterized line value (default 1.0)
        burn_value: Which value to burn along lines (default 1.0)

    Returns:
        2D float32 array with lines rasterized (0 elsewhere)
    """
    rows, cols = dem.shape

    if transform is None:
        lat0, lon0, dy, dx = 0.0, 0.0, 0.001, 0.001
    else:
        lat0, lon0, dy, dx = transform

    raster = np.zeros((rows, cols), dtype=np.float32)

    for feature in geojson.get("features", []):
        geom = feature.get("geometry", {})
        if geom.get("type") not in ("LineString", "MultiLineString"):
            continue

        coords_list = geom.get("coordinates", [])
        if geom.get("type") == "LineString":
            coords_list = [coords_list]

        for coords in coords_list:
            for i in range(len(coords) - 1):
                x1, y1 = coords[i][0], coords[i][1]
                x2, y2 = coords[i + 1][0], coords[i + 1][1]

                # Bresenham-like line rasterization
                r1 = round((y1 - lat0) / dy)
                c1 = round((x1 - lon0) / dx)
                r2 = round((y2 - lat0) / dy)
                c2 = round((x2 - lon0) / dx)

                # Draw line using step-based interpolation
                dr = abs(r2 - r1)
                dc = abs(c2 - c1)
                steps = max(dr, dc, 1)

                for step in range(steps + 1):
                    t = step / max(steps, 1)
                    r = round(r1 + t * (r2 - r1))
                    c = round(c1 + t * (c2 - c1))
                    if 0 <= r < rows and 0 <= c < cols:
                        raster[r, c] = burn_value

    return raster
