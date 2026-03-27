import { NextResponse } from "next/server";

export const runtime = "edge";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

/**
 * Dynamically generated API documentation endpoint.
 * Returns markdown-formatted docs for easy AI and human consumption.
 *
 * Usage:
 *   GET /api/docs-md                - Full API documentation (markdown)
 */
export async function GET() {
  const now = new Date().toISOString();
  const docs = `# OpenZenith API Documentation

**Generated:** ${now}
**Version:** 2.0
**Base URL:** https://openzenith.pages.dev/api

---

## Overview

OpenZenith is a free, open-source geospatial API providing elevation, weather, tides, address data, and more for any point on Earth. No API key required.

---

## Unified Query Endpoint

### \`GET /api/query\`

The primary endpoint. Fetch multiple data types in a single request with filtering.

**Parameters:**

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| \`lat\` | Yes | — | Latitude (-90 to 90) |
| \`lon\` | Yes | — | Longitude (-180 to 180) |
| \`include\` | No | \`elevation\` | Comma-separated data types to include |
| \`dataset\` | No | \`auto\` | Elevation dataset (see below) |
| \`units\` | No | \`metric\` | Temperature units: \`metric\` or \`imperial\` |
| \`forecast_days\` | No | \`3\` | Weather forecast days (1-7) |

**Available include values:**

| Value | Description | Source |
|-------|-------------|--------|
| \`elevation\` | Elevation/bathymetry data | SRTM 30m, Copernicus GLO-30, GEBCO 2025 |
| \`address\` | Reverse geocoded address | OpenStreetMap Nominatim |
| \`weather\` | Current conditions + forecast | Open-Meteo |
| \`tides\` | Tide predictions | NOAA (US coastal only) |
| \`waterways\` | Nearby rivers/lakes | OpenStreetMap Overpass |

**Elevation datasets:**

| Dataset | Description | Coverage | Resolution |
|---------|-------------|----------|------------|
| \`auto\` | Cascading fallback | Global | Best available |
| \`srtm30m\` | NASA SRTM | ±60° latitude | 30m |
| \`copernicus-glo30\` | Copernicus DEM | Global land | 30m |
| \`gebco2025\` | GEBCO 2025 | Global | 450m (15 arc-sec) |

**Examples:**

\`\`\`bash
# Elevation only (default)
curl "https://openzenith.pages.dev/api/query?lat=28.0&lon=86.9"

# Elevation + address
curl "https://openzenith.pages.dev/api/query?lat=40.7&lon=-74.0&include=elevation,address"

# Full data: elevation, address, weather, tides
curl "https://openzenith.pages.dev/api/query?lat=28.0&lon=-80.6&include=elevation,address,weather,tides"

# Imperial units
curl "https://openzenith.pages.dev/api/query?lat=51.5&lon=-0.1&include=weather&units=imperial"
\`\`\`

**Response format:**

\`\`\`json
{
  "location": { "lat": 40.7, "lon": -74.0 },
  "query": {
    "includes": ["elevation", "address", "weather"],
    "dataset": "auto",
    "units": "metric",
    "timestamp": "2026-03-26T12:00:00.000Z"
  },
  "elevation": {
    "elevation": 10.5,
    "unit": "meters",
    "source": "srtm30m",
    "resolution": 30,
    "srtmTile": "N40W075",
    "location": { "lat": 40.7, "lon": -74.0 }
  },
  "address": {
    "display_name": "New York City, NY, USA",
    "name": "New York City",
    "type": "city",
    "address": { "city": "New York", "state": "New York", "country": "USA" }
  },
  "weather": {
    "current": {
      "temperature": 15.2,
      "apparentTemperature": 13.8,
      "humidity": 65,
      "weatherCode": 3,
      "weatherDescription": "Overcast",
      "windSpeed": 12.5,
      "windDirection": 180,
      "windGusts": 20.1,
      "pressure": 1013.2,
      "precipitation": 0,
      "cloudCover": 85,
      "visibility": 10000,
      "uvIndex": 3,
      "isDay": true
    },
    "daily": [
      {
        "date": "2026-03-26",
        "tempMax": 17.5,
        "tempMin": 10.2,
        "precipitationSum": 0,
        "weatherCode": 3,
        "weatherDescription": "Overcast",
        "sunrise": "2026-03-26T06:45",
        "sunset": "2026-03-26T19:15",
        "windSpeedMax": 22.3,
        "uvIndexMax": 5
      }
    ],
    "units": { "temperature": "°C", "windSpeed": "km/h", "pressure": "hPa" },
    "timezone": "America/New_York",
    "source": "open-meteo"
  },
  "tides": {
    "station": { "id": "8518750", "name": "The Battery", "lat": 40.7, "lon": -74.01, "distance": 1.2, "distanceUnit": "nm" },
    "predictions": [
      { "time": "2026-03-26 02:15", "type": "L", "height": -0.3, "typeLabel": "Low" },
      { "time": "2026-03-26 08:22", "type": "H", "height": 4.8, "typeLabel": "High" }
    ],
    "source": "noaa-tides"
  }
}
\`\`\`

---

## Individual Endpoints

All individual endpoints remain available for backward compatibility.

### \`GET /api/elevation\`

Elevation data with dataset selection.

| Parameter | Required | Description |
|-----------|----------|-------------|
| \`lat\` | Yes | Latitude |
| \`lon\` | Yes | Longitude |
| \`dataset\` | No | \`auto\`, \`srtm30m\`, \`copernicus-glo30\`, \`gebco2025\` |

### \`GET /api/bathymetry\`

Ocean depth data (GEBCO 2025).

| Parameter | Required | Description |
|-----------|----------|-------------|
| \`lat\` | Yes | Latitude |
| \`lon\` | Yes | Longitude |

### \`GET /api/geocode\`

Forward geocoding (address → coordinates).

| Parameter | Required | Description |
|-----------|----------|-------------|
| \`query\` | Yes | Place name or address |
| \`limit\` | No | Max results (default: 5, max: 10) |

### \`GET /api/reverse-geocode\`

Reverse geocoding (coordinates → address).

| Parameter | Required | Description |
|-----------|----------|-------------|
| \`lat\` | Yes | Latitude |
| \`lon\` | Yes | Longitude |
| \`zoom\` | No | Detail level (default: 18) |

### \`GET /api/weather/warnings\`

NOAA weather warnings (US only).

| Parameter | Required | Description |
|-----------|----------|-------------|
| \`geometry\` | No | Filter by bounding box |

### \`GET /api/waterways\`

Nearby water features via Overpass API.

| Parameter | Required | Description |
|-----------|----------|-------------|
| \`bbox\` | Yes | Bounding box: \`minLon,minLat,maxLon,maxLat\` |
| \`type\` | No | \`rivers\`, \`lakes\`, or \`all\` |
| \`limit\` | No | Max features (default: 100, max: 500) |

### \`GET /api/geoip\`

Client IP geolocation (uses Cloudflare headers).

No parameters required.

### \`GET /api/health\`

Service health check.

No parameters required.

---

## Tile Endpoints

### \`GET /api/tile/{z}/{x}/{y}\`

SRTM elevation tiles in Terrarium encoding (PNG).

### \`GET /api/gebco-tile/{name}\`

GEBCO bathymetry COG tiles (local dev only, returns 501 in production). Use \`/api/dem-tile/{z}/{x}/{y}\` for terrain tiles.

---

## Rate Limits

No API key required. Fair use policy applies. Please limit requests to reasonable rates. High-volume usage should cache responses locally.

## CORS

All endpoints include \`Access-Control-Allow-Origin: *\` headers.

## Cache

Response \`Cache-Control\` headers vary by endpoint:
- Elevation: 1 hour
- Weather: 5 minutes
- Tides: 30 minutes
- Address: 1 hour
- Tiles: 1 year (immutable)
`;

  return new NextResponse(docs, {
    status: 200,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "text/markdown; charset=utf-8",
      "Cache-Control": "public, max-age=300",
    },
  });
}
