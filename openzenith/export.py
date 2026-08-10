"""OpenZenith GeoJSON export utilities.

Converts terrain analysis results (slope, aspect, TPI, TRI, TWI, etc.)
to GeoJSON FeatureCollections for visualization in GIS applications,
MapLibre, QGIS, or any GeoJSON-compatible viewer.
"""


import numpy as np
from scipy.spatial import KDTree


def grid_to_geojson(
    data: np.ndarray,
    transform: tuple[float, float, float, float] | None = None,
    name: str = "terrain",
    decimals: int = 2,
    max_points: int = 50000,
) -> dict:
    """Convert a 2D grid to GeoJSON Point features.

    Each grid cell becomes a Point feature with the cell value as a property.
    For large grids, cells are subsampled to stay under max_points.

    Args:
        data: 2D numpy array of terrain values (slope, TPI, TWI, etc.)
        transform: (origin_lat, origin_lon, cell_size_lat, cell_size_lon)
                   If None, uses degree-based default (0.001 deg cells).
        name: Property name for the cell value
        decimals: Number of decimal places for coordinates and values
        max_points: Maximum number of points to include (subsampled if exceeded)

    Returns:
        GeoJSON FeatureCollection dict
    """
    _rows, _cols = data.shape
    valid = (~np.isnan(data) if np.issubdtype(data.dtype, np.floating)
             else np.ones_like(data, dtype=bool))

    # Get valid cell coordinates
    iy, ix = np.where(valid)
    values = data[iy, ix]

    # Subsample if too many points
    if len(values) > max_points:
        step = max(1, len(values) // max_points)
        iy = iy[::step]
        ix = ix[::step]
        values = values[::step]

    if transform is None:
        lat0, lon0, dy, dx = 0.0, 0.0, 0.001, 0.001
    else:
        lat0, lon0, dy, dx = transform

    # Vectorized coordinate computation
    lats = lat0 + iy * dy
    lons = lon0 + ix * dx
    vals = np.round(values, decimals).astype(float)

    # Build features list
    features = [
        {
            "type": "Feature",
            "geometry": {
                "type": "Point",
                "coordinates": [round(float(lon), decimals + 2), round(float(lat), decimals + 2)],
            },
            "properties": {name: float(val)},
        }
        for lat, lon, val in zip(lats, lons, vals)
    ]

    return {"type": "FeatureCollection", "features": features}


def contour_to_geojson(
    dem: np.ndarray,
    interval: float = 10.0,
    transform: tuple[float, float, float, float] | None = None,
    min_elev: float | None = None,
    max_elev: float | None = None,
    decimals: int = 1,
) -> dict:
    """Extract contour lines from a DEM as GeoJSON LineString features.

    Uses vectorized marching squares to trace elevation contour lines.
    No external dependencies required (pure NumPy).

    Args:
        dem: 2D elevation grid
        interval: Contour interval in meters (elevation units)
        transform: (origin_lat, origin_lon, cell_size_lat, cell_size_lon)
        min_elev: Minimum elevation for contours (default: 10th percentile)
        max_elev: Maximum elevation for contours (default: 90th percentile)
        decimals: Decimal places for coordinates

    Returns:
        GeoJSON FeatureCollection with LineString features
    """
    if transform is None:
        lat0, lon0, dy, dx = 0.0, 0.0, 0.001, 0.001
    else:
        lat0, lon0, dy, dx = transform

    valid = dem != -32768.0 if np.any(dem == -32768.0) else np.ones_like(dem, dtype=bool)
    valid_dem = np.where(valid, dem, np.nan)

    if min_elev is None:
        min_elev = float(np.nanpercentile(valid_dem, 10))
    if max_elev is None:
        max_elev = float(np.nanpercentile(valid_dem, 90))

    # Round to nearest interval
    start = int(min_elev / interval) * interval
    levels = np.arange(start, max_elev + interval, interval)

    features = []
    _rows, _cols = dem.shape

    for level in levels:
        # Binary classification: above/below contour level
        above = valid_dem >= level

        # Horizontal edge crossings (between row i and row i+1)
        h_cross = above[:-1, :] != above[1:, :]
        hy, hx = np.where(h_cross)
        # Crossing at midpoints between rows
        h_lats = lat0 + (hy + 0.5) * dy
        h_lons = lon0 + (hx + 0.5) * dx

        # Vertical edge crossings (between col j and col j+1)
        v_cross = above[:, :-1] != above[:, 1:]
        vy, vx = np.where(v_cross)
        # Crossing at midpoints between cols
        v_lats = lat0 + (vy + 0.5) * dy
        v_lons = lon0 + (vx + 0.5) * dx

        if len(h_lats) + len(v_lats) < 2:
            continue

        # Combine all crossing points
        all_lats = np.concatenate([h_lats, v_lats])
        all_lons = np.concatenate([h_lons, v_lons])
        n = len(all_lats)

        # Use KDTree for O(n log n) nearest-neighbor ordering
        if n == 0:
            continue

        visited = np.zeros(n, dtype=bool)
        coords = []

        # Build KDTree once
        points = np.column_stack([all_lats, all_lons])
        tree = KDTree(points)

        # Pre-query all k=2 neighbors (skip 1st = self at distance 0)
        dists, all_nearest = tree.query(points, k=2)
        all_nearest = all_nearest.ravel()
        dists = dists.ravel()

        idx = 0
        visited[idx] = True
        coords.append((float(all_lats[idx]), float(all_lons[idx])))

        for _ in range(n - 1):
            # Follow KDTree chain: each point's 2nd-nearest neighbor (1st is self)
            next_idx = int(all_nearest[idx * 2 + 1])
            next_dist = dists[idx * 2 + 1]
            if visited[next_idx] or next_dist > 0.01:
                break  # gap too large or stuck in visited cycle

            visited[next_idx] = True
            coords.append((float(all_lats[next_idx]), float(all_lons[next_idx])))
            idx = next_idx

        if len(coords) >= 2:
            features.append({
                "type": "Feature",
                "geometry": {
                    "type": "LineString",
                    "coordinates": [
                        [round(lon, decimals + 2), round(lat, decimals + 2)]
                        for lat, lon in coords
                    ],
                },
                "properties": {"elevation": round(float(level), decimals)},
            })

    return {"type": "FeatureCollection", "features": features}


def contour_to_kml(
    dem: np.ndarray,
    interval: float = 10.0,
    transform: tuple[float, float, float, float] | None = None,
    min_elev: float | None = None,
    max_elev: float | None = None,
    name: str = "Contours",
    altitude_mode: str = "clampToGround",
) -> str:
    """Extract contour lines from a DEM as KML for Google Earth.

    Args:
        dem: 2D elevation grid
        interval: Contour interval in meters
        transform: (origin_lat, origin_lon, cell_size_lat, cell_size_lon)
        min_elev: Minimum elevation for contours
        max_elev: Maximum elevation for contours
        name: Name for the KML folder
        altitude_mode: KML altitude mode (clampToGround, relativeToGround, absolute)

    Returns:
        KML string
    """
    geojson = contour_to_geojson(dem, interval, transform, min_elev, max_elev)
    return _geojson_to_kml(geojson, name, altitude_mode)


def grid_to_kml(
    data: np.ndarray,
    transform: tuple[float, float, float, float] | None = None,
    name: str = "Points",
    altitude_mode: str = "clampToGround",
    value_name: str = "value",
) -> str:
    """Convert a 2D grid to KML Point features.

    Args:
        data: 2D numpy array
        transform: (origin_lat, origin_lon, cell_size_lat, cell_size_lon)
        name: Name for the KML folder
        altitude_mode: KML altitude mode
        value_name: Property name for the cell value

    Returns:
        KML string
    """
    geojson = grid_to_geojson(data, transform, value_name)
    return _geojson_to_kml(geojson, name, altitude_mode)


def _geojson_to_kml(
    geojson: dict,
    name: str = "OpenZenith",
    altitude_mode: str = "clampToGround",
) -> str:
    """Convert a GeoJSON FeatureCollection to KML string.

    Args:
        geojson: GeoJSON FeatureCollection
        name: KML document name
        altitude_mode: KML altitude mode

    Returns:
        KML string
    """
    kml_parts = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        "<kml xmlns=\"http://www.opengis.net/kml/2.2\">",
        "<Document>",
        f"<name>{name}</name>",
        "<Folder>",
    ]

    for feature in geojson.get("features", []):
        geom = feature.get("geometry", {})
        geom_type = geom.get("type", "").lower()
        coords = geom.get("coordinates", [])
        props = feature.get("properties", {})

        if geom_type == "point":
            if isinstance(coords[0], list):
                lon, lat = coords[0][0], coords[0][1]
                alt = coords[0][2] if len(coords[0]) > 2 else 0
            else:
                lon, lat = coords[0], coords[1]
                alt = coords[2] if len(coords) > 2 else 0

            kml_parts.append("<Placemark>")
            if props:
                kml_parts.append(f"<name>{props.get('elevation', props.get('value', ''))}</name>")
            kml_parts.append(f"<Point><coordinates>{lon},{lat},{alt}</coordinates></Point>")
            kml_parts.append("</Placemark>")

        elif geom_type == "linestring":
            coord_strs = []
            for coord in coords:
                lon = coord[0]
                lat = coord[1]
                alt = coord[2] if len(coord) > 2 else 0
                coord_strs.append(f"{lon},{lat},{alt}")
            kml_parts.append("<Placemark>")
            if props:
                kml_parts.append(f"<name>{props.get('elevation', '')}</name>")
            kml_parts.append(
                f"<LineString><altitudeMode>{altitude_mode}</altitudeMode>"
                f"<coordinates>{' '.join(coord_strs)}</coordinates></LineString>"
            )
            kml_parts.append("</Placemark>")

        elif geom_type == "polygon":
            rings = coords
            if rings:
                outer = rings[0]
                coord_strs = []
                for coord in outer:
                    lon = coord[0]
                    lat = coord[1]
                    alt = coord[2] if len(coord) > 2 else 0
                    coord_strs.append(f"{lon},{lat},{alt}")
                kml_parts.append("<Placemark>")
                if props:
                    kml_parts.append(f"<name>{props.get('name', '')}</name>")
                kml_parts.append(
                    f"<Polygon><altitudeMode>{altitude_mode}</altitudeMode>"
                    f"<outerBoundaryIs><LinearRing><coordinates>"
                    f"{' '.join(coord_strs)}"
                    f"</coordinates></LinearRing></outerBoundaryIs></Polygon>"
                )
                kml_parts.append("</Placemark>")

    kml_parts.extend(["</Folder>", "</Document>", "</kml>"])
    return "\n".join(kml_parts)
