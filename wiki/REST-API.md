# REST API Reference

Base URL: `https://openzenith.cyopsys.com`

All routes run on Cloudflare Edge Workers (`export const runtime = 'edge'`). All responses return HTTP 200 under all conditions (errors are encoded in the response body).

---

## Elevation Endpoints

### `GET /api/elevation`

Query elevation at a single point.

**Parameters**:

| Param | Type | Description |
|-------|------|-------------|
| `lat` | float | Latitude (-90 to 90) |
| `lon` | float | Longitude (-180 to 180) |
| `tile_dir` | string | Local tile directory (optional) |
| `zoom_levels` | string | Comma-separated zoom levels (optional) |

**Response**:
```json
{
  "lat": 40.7128,
  "lon": -74.006,
  "elevation": 10.0,
  "units": "meters"
}
```

---

### `POST /api/elevation/batch`

Batch elevation queries.

**Request Body**:
```json
{
  "points": [
    [40.7128, -74.006],
    [34.0522, -118.2437],
    [51.5074, -0.1278]
  ],
  "zoom_levels": [10]
}
```

**Response**:
```json
{
  "results": [
    { "lat": 40.7128, "lon": -74.006, "elevation": 10.0 },
    { "lat": 34.0522, "lon": -118.2437, "elevation": 120.0 },
    { "lat": 51.5074, "lon": -0.1278, "elevation": 25.0 }
  ]
}
```

---

### `GET /api/dem-tile/[z]/[x]/[y]`

Get DEM terrain tile in OZT2 or PNG format.

**Parameters**:

| Param | Type | Description |
|-------|------|-------------|
| `z` | int | Zoom level (0-14) |
| `x` | int | Tile X |
| `y` | int | Tile Y |
| `format` | string | `ozt2` or `png` (default: ozt2) |

**Response**: Raw tile bytes (application/octet-stream or image/png)

---

## Terrain Analysis Endpoints

### `GET /api/slope`

Compute terrain slope grid.

**Parameters**:

| Param | Type | Description |
|-------|------|-------------|
| `lat` | float | Center latitude |
| `lon` | float | Center longitude |
| `radius` | int | Radius in cells (default 100, max 500) |
| `zoom` | int | Zoom level (default 10) |

**Response**:
```json
{
  "slope": [[...]],  // 2D array of slope values in degrees
  "stats": {
    "min": 0.0,
    "max": 45.0,
    "mean": 12.5,
    "std": 8.3
  },
  "transform": [origin_lat, origin_lon, cell_size]
}
```

---

### `GET /api/aspect`

Compute terrain aspect grid.

**Parameters**: Same as `/api/slope`

**Response**:
```json
{
  "aspect": [[...]],  // 2D array, 0-360 degrees (clockwise from N), -1 for flat
  "transform": [origin_lat, origin_lon, cell_size]
}
```

---

### `GET /api/hillshade`

Compute analytical hillshade.

**Parameters**:

| Param | Type | Description |
|-------|------|-------------|
| `lat` | float | Center latitude |
| `lon` | float | Center longitude |
| `radius` | int | Radius in cells (default 100) |
| `zoom` | int | Zoom level (default 10) |
| `azimuth` | float | Light azimuth (default 315) |
| `altitude` | float | Light altitude degrees (default 45) |
| `z_factor` | float | Vertical exaggeration (default 1.0) |

**Response**: PNG image bytes

---

### `GET /api/viewshed`

Compute viewshed from observer point.

**Parameters**:

| Param | Type | Description |
|-------|------|-------------|
| `lat` | float | Observer latitude |
| `lon` | float | Observer longitude |
| `zoom` | int | Zoom level (default 10) |
| `radius` | int | Search radius in cells (default 200) |
| `height` | float | Observer height in meters (default 1.75) |

**Response**: GeoJSON FeatureCollection with visible/invisible polygons

---

### `GET /api/twi`

Compute Topographic Wetness Index.

**Parameters**: Same as `/api/slope`

**Response**:
```json
{
  "twi": [[...]],  // 2D array of TWI values
  "transform": [origin_lat, origin_lon, cell_size]
}
```

---

### `POST /api/profile`

Generate elevation profile along a transect.

**Request Body**:
```json
{
  "lat1": 36.5785,
  "lon1": -118.2923,
  "lat2": 36.4199,
  "lon2": -117.1548,
  "num_points": 100,
  "zoom": 10
}
```

**Response**:
```json
{
  "profile": [
    {"distance_m": 0, "elevation": 4420, "lat": 36.5785, "lon": -118.2923},
    {"distance_m": 100, "elevation": 4410, "lat": 36.5778, "lon": -118.2915}
  ],
  "total_distance_m": 15000
}
```

---

## Hydrology Endpoints

### `POST /api/watershed`

Delineate watershed from pour point.

**Request Body**:
```json
{
  "lat": 36.5785,
  "lon": -118.2923,
  "zoom": 10,
  "radius_cells": 200
}
```

**Response**:
```json
{
  "boundary": [[lat, lon], ...],  // Polygon coordinates
  "area_km2": 1500.5,
  "min_elev": 120,
  "max_elev": 4420,
  "pour_point": {"lat": 36.5785, "lon": -118.2923}
}
```

---

### `POST /api/streams`

Extract stream network.

**Request Body**:
```json
{
  "lat": 36.0,
  "lon": -118.0,
  "zoom": 10,
  "radius_cells": 200,
  "threshold": 100
}
```

**Response**: GeoJSON FeatureCollection of stream lines

---

### `POST /api/trace`

Trace downstream to ocean.

**Request Body**:
```json
{
  "lat": 36.0,
  "lon": -118.0,
  "zoom": 10,
  "max_steps": 10000
}
```

**Response**:
```json
{
  "trace": [[lat, lon], ...],
  "distance_km": 450.2,
  "elevations": [4420, 4400, ...],
  "terminated": "ocean" | "exceeded_max_steps" | "pit"
}
```

---

## Data Endpoints

### `GET /api/tile/[z]/[x]/[y]`

Get 256x256 elevation tile.

**Parameters**: `z`, `x`, `y` (zoom, tile coords)

**Response**: PNG or OZT2 bytes

---

### `GET /api/tiles`

OGC API - Tiles landing page.

**Response**: JSON describing available tile matrix sets

---

### `GET /api/contours/[z]/[x]/[y]`

Get contour tile at zoom level.

**Response**: GeoJSON FeatureCollection

---

### `GET /api/geocode`

Geocode a location string.

**Parameters**:

| Param | Type | Description |
|-------|------|-------------|
| `q` | string | Location query |

**Response**:
```json
{
  "results": [
    {"lat": 40.7128, "lon": -74.006, "name": "New York, NY", "type": "city"}
  ]
}
```

---

## Static Endpoints

### `GET /api/health`

Health check.

**Response**:
```json
{
  "status": "ok",
  "version": "0.7.0",
  "storage": "r2",
  "timestamp": "2026-04-19T12:00:00Z"
}
```

---

### `GET /api/coverage`

Data coverage information.

**Response**:
```json
{
  "srtm30m": {
    "coverage": "global",
    "resolution": "30m",
    "source": "HuggingFace aliasfox/srtm30m-merged"
  },
  "gebco": {
    "coverage": "ocean",
    "resolution": "15arcsec",
    "source": "GEBCO 2025"
  }
}
```

---

### `GET /api/openapi.json`

OpenAPI 3.0 specification.

**Response**: OpenAPI JSON document

---

## Real-time Data Endpoints

The following endpoints provide real-time data layers:

| Endpoint | Description | Cache TTL |
|----------|-------------|-----------|
| `GET /api/earthquakes` | USGS earthquake data | 5 min |
| `GET /api/flights` | OpenSky Network flights | 2 min |
| `GET /api/vessels` | AIS vessel positions | 1 min |
| `GET /api/hurricanes` | IBTrACS hurricane tracks | 30 min |
| `GET /api/wildfires` | MODIS active fires | 10 min |
| `GET /api/weather/warnings` | NWS alerts | 2 min |
| `GET /api/waterways` | OSM waterways | 24h |
| `GET /api/sst/[z]/[x]/[y]` | Sea surface temperature | 24h |
| `GET /api/ndvi/[z]/[x]/[y]` | NDVI vegetation index | 7d |
| `GET /api/snow-cover/[z]/[x]/[y]` | Snow cover extent | 7d |
| `GET /api/bathymetry` | GEBCO bathymetry | 24h |

## Error Responses

All endpoints return HTTP 200. Errors are returned in the response body:

```json
{
  "error": "TILE_NOT_FOUND",
  "message": "No tile available for requested coordinates",
  "lat": 40.7128,
  "lon": -74.006
}
```

Common error codes:
- `TILE_NOT_FOUND` — No elevation data for location
- `INVALID_COORDINATES` — lat/lon out of range
- `RADIUS_TOO_LARGE` — Requested radius exceeds maximum
- `NETWORK_ERROR` — Failed to fetch from upstream
- `UPSTREAM_ERROR` — Upstream data source returned error
