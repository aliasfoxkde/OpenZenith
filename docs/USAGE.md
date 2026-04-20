# OpenZenith API Usage Guide

## Base URL

**Production:** `https://openzenith.pages.dev`

## Authentication

None required. All endpoints are publicly accessible.

## Rate Limiting

No rate limits are currently enforced. Please use responsibly.

---

## Endpoints

### GET /api/elevation

Get the elevation at a specific latitude/longitude coordinate.

**Query Parameters:**

| Parameter | Type | Required | Range | Description |
|-----------|------|----------|-------|-------------|
| `lat` | number | Yes | -56 to 60 | Latitude in decimal degrees |
| `lon` | number | Yes | -180 to 180 | Longitude in decimal degrees |

**Response (200):**

```json
{
  "elevation": 8848,
  "unit": "meters",
  "location": { "lat": 28.0, "lon": 86.9 },
  "source": "srtm30m",
  "srtmTile": "N28E086.tif",
  "resolution": 30
}
```

| Field | Type | Description |
|-------|------|-------------|
| `elevation` | number/null | Elevation in meters above sea level, or `null` if no data |
| `unit` | string | Always `"meters"` |
| `location` | object | Queried coordinates |
| `source` | string | Data source identifier |
| `srtmTile` | string | Source SRTM tile filename |
| `resolution` | number | Resolution in meters |

**Error Responses:**

- `400` - Missing or invalid parameters
- `500` - Server error (e.g., data fetch failed)

**Examples:**

```bash
# Mount Everest
curl "https://openzenith.pages.dev/api/elevation?lat=28.0&lon=86.9"

# Paris
curl "https://openzenith.pages.dev/api/elevation?lat=48.8566&lon=2.3522"

# Grand Canyon
curl "https://openzenith.pages.dev/api/elevation?lat=36.1019&lon=-112.1121"
```

---

### GET /api/tile/{z}/{x}/{y}

Get a 256x256 elevation tile as raw Int16 binary data.

**Path Parameters:**

| Parameter | Type | Required | Range | Description |
|-----------|------|----------|-------|-------------|
| `z` | integer | Yes | 0-15 | Zoom level |
| `x` | integer | Yes | 0+ | Tile column |
| `y` | integer | Yes | 0+ | Tile row |

**Response (200):**

- Content-Type: `application/octet-stream`
- Body: Raw Int16 binary data (256x256 grid = 131,072 bytes)
- Byte order: Little-endian
- Nodata value: -32768
- Layout: Row-major, top-left origin

**Headers:**

| Header | Description |
|--------|-------------|
| `X-Tile-Size` | Tile width/height in pixels (256) |
| `X-Zoom` | Zoom level |

**Tile Grid:**

Each SRTM 1-degree tile (3601x3601 pixels) is split into a 15x15 grid of 256x256 chunks. The last row/column of chunks may be smaller (17 pixels) to handle the 3601 dimension.

**Example:**

```bash
# Fetch tile at zoom 8, coordinates (218, 135) - Everest region
curl -o tile.bin "https://openzenith.pages.dev/api/tile/8/218/135"

# Read in Python
import struct
with open("tile.bin", "rb") as f:
    data = f.read()
elevations = struct.unpack(f"<{len(data)//2}h", data)
# elevations is a flat array of 256*256 Int16 values
```

---

### GET /api/health

Service health check and status.

**Response (200):**

```json
{
  "status": "healthy",
  "version": "0.6.2",
  "storage": {
    "backend": "huggingface",
    "type": "chunks",
    "repo": "aliasfox/srtm30m-merged",
    "chunkSize": "256x256"
  },
  "coverage": {
    "source": "NASA SRTM GL1 v3",
    "resolution": "30m",
    "latRange": [-56, 60],
    "lonRange": [-180, 180]
  }
}
```

---

### GET /api/docs

Interactive API documentation with try-it-out functionality.

### GET /api/openapi.json

OpenAPI 3.0.3 specification for programmatic access.

---

## Interactive Map

Visit [/demo](https://openzenith.pages.dev/demo) for an interactive elevation map with:

- OpenStreetMap base layer
- Hillshade visualization from elevation data
- Click-to-query elevation at any point
- MapLibre GL controls (zoom, rotation)

---

## Data Coverage

The NASA SRTM GL1 v3 dataset covers:

- **Latitude:** 56S to 60N (~80% of Earth's land surface)
- **Longitude:** 180W to 180E (global)
- **Resolution:** 1 arc-second (~30 meters)
- **Vertical accuracy:** <16m absolute, <10m relative
- **Total tiles:** 14,296 (1-degree tiles)

Areas not covered by SRTM include:
- Open ocean (beyond coastal areas)
- Some high-latitude regions (>60N, <56S)
- Small islands may have partial or no data

## Terrarium Encoding

Elevation tiles can be decoded using the [Terrarium encoding](https://github.com/tilezen/mapbox-terrain-v1#terrarium) format:

```
height = (R * 256 + G + B / 256) - 32768
```

This is used by MapLibre GL and Mapbox for hillshade and 3D terrain rendering.
