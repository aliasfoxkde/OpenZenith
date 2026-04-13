import { NextRequest, NextResponse } from "next/server";
import { CORS_HEADERS, corsPreflightResponse } from "@/lib/cors";

export const runtime = "edge";

export async function OPTIONS() {
  return corsPreflightResponse();
}

const openApiSpec = {
  openapi: "3.0.3",
  info: {
    title: "OpenZenith API",
    version: "0.5.0",
    description:
      "Free, fast, global elevation and geospatial API. Query any point on Earth for elevation data from NASA SRTM 30m, track flights, monitor weather, explore OpenStreetMap, and more. No API key required.",
    contact: {
      name: "OpenZenith",
      url: "https://github.com/aliasfoxkde/OpenZenith",
    },
    license: {
      name: "MIT",
    },
  },
  servers: [
    {
      url: "/",
      description: "Current deployment (derived from request)",
    },
  ],
  paths: {
    "/api/elevation": {
      get: {
        summary: "Get elevation at a point",
        description:
          "Returns the elevation in meters at the given latitude/longitude coordinates using NASA SRTM 30m data with bilinear interpolation.",
        parameters: [
          {
            name: "lat",
            in: "query",
            required: true,
            schema: { type: "number", minimum: -60, maximum: 60 },
            description: "Latitude (-60 to 60, SRTM coverage)",
            example: 28.0,
          },
          {
            name: "lon",
            in: "query",
            required: true,
            schema: { type: "number", minimum: -180, maximum: 180 },
            description: "Longitude (-180 to 180)",
            example: 86.9,
          },
        ],
        responses: {
          "200": {
            description: "Elevation data",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    elevation: {
                      type: ["number", "null"],
                      description: "Elevation in meters, or null if no data at this point",
                      example: 8848,
                    },
                    unit: { type: "string", example: "meters" },
                    location: {
                      type: "object",
                      properties: {
                        lat: { type: "number", example: 28.0 },
                        lon: { type: "number", example: 86.9 },
                      },
                    },
                    source: { type: "string", example: "srtm30m" },
                    srtmTile: {
                      type: "string",
                      example: "N28E086.tif",
                      description: "Source SRTM tile filename",
                    },
                    resolution: {
                      type: "number",
                      example: 30,
                      description: "Resolution in meters",
                    },
                  },
                },
                example: {
                  elevation: 8848,
                  unit: "meters",
                  location: { lat: 28.0, lon: 86.9 },
                  source: "srtm30m",
                  srtmTile: "N28E086.tif",
                  resolution: 30,
                },
              },
            },
          },
          "400": { description: "Invalid parameters" },
          "500": { description: "Server error" },
        },
        tags: ["Elevation"],
      },
    },
    "/api/tile/{z}/{x}/{y}": {
      get: {
        summary: "Get elevation tile",
        description:
          "Returns a 256x256 grid of elevation values as raw Int16 binary data for a slippy map tile. Each value is a 16-bit signed integer in little-endian byte order. NoData values are -32768. Used by MapLibre GL as a raster-dem source with terrarium encoding.",
        parameters: [
          {
            name: "z",
            in: "path",
            required: true,
            schema: { type: "integer", minimum: 0, maximum: 15 },
            description: "Zoom level (0-15)",
            example: 10,
          },
          {
            name: "x",
            in: "path",
            required: true,
            schema: { type: "integer", minimum: 0 },
            description: "Tile column",
            example: 836,
          },
          {
            name: "y",
            in: "path",
            required: true,
            schema: { type: "integer", minimum: 0 },
            description: "Tile row",
            example: 414,
          },
        ],
        responses: {
          "200": {
            description: "Binary elevation tile data (Int16, 256x256)",
            content: {
              "application/octet-stream": {
                schema: {
                  type: "string",
                  format: "binary",
                  description: "256x256 Int16Array (131,072 bytes). Row-major, top-left origin.",
                },
              },
            },
          },
          "400": { description: "Invalid tile coordinates" },
        },
        tags: ["Tiles"],
      },
    },
    "/api/health": {
      get: {
        summary: "Health check",
        description: "Returns service health status, storage configuration, and coverage metadata.",
        responses: {
          "200": {
            description: "Health status",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    status: { type: "string", example: "healthy" },
                    version: { type: "string", example: "0.3.0" },
                    storage: {
                      type: "object",
                      properties: {
                        backend: { type: "string", example: "huggingface" },
                        type: { type: "string", example: "chunks" },
                        repo: { type: "string", example: "aliasfox/srtm30m-chunks" },
                        chunkSize: { type: "string", example: "256x256" },
                      },
                    },
                    coverage: {
                      type: "object",
                      properties: {
                        source: { type: "string", example: "SRTM 30m Global" },
                        resolution: { type: "string", example: "30 meters" },
                        latRange: {
                          type: "array",
                          items: { type: "number" },
                          example: [-56, 60],
                        },
                        lonRange: {
                          type: "array",
                          items: { type: "number" },
                          example: [-180, 180],
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        tags: ["System"],
      },
    },
    "/api/proxy/{path}": {
      get: {
        summary: "Universal CORS proxy",
        description:
          "Forwards requests to allowed external geospatial APIs, adding CORS headers. Query parameters are forwarded to the target URL. 10-second timeout, 30-second cache.",
        parameters: [
          {
            name: "path",
            in: "path",
            required: true,
            schema: { type: "string" },
            description:
              "Full URL path to the target API (e.g., https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson)",
            example: "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson",
          },
        ],
        responses: {
          "200": {
            description: "Proxied response with CORS headers",
            content: {
              "application/json": {
                schema: { type: "object", description: "Varies by target API" },
                example: { type: "FeatureCollection", metadata: { generated: 1234567890, count: 10 } },
              },
            },
          },
          "403": { description: "Domain not in allowed list" },
          "502": { description: "Proxy error or timeout" },
        },
        tags: ["Proxy"],
      },
    },
    "/api/flights": {
      get: {
        summary: "Get flight data (ADS-B)",
        description:
          "Proxies OpenSky Network API for real-time ADS-B flight tracking data. Returns aircraft positions, callsigns, altitudes, speeds, and headings. 15-second cache.",
        parameters: [
          {
            name: "bbox",
            in: "query",
            required: false,
            schema: { type: "string" },
            description: "Bounding box as west,south,east,north",
            example: "-122.5,37.7,-122.3,37.8",
          },
          {
            name: "lamin",
            in: "query",
            required: false,
            schema: { type: "number" },
            description: "Minimum latitude (alternative to bbox)",
            example: 37.7,
          },
          {
            name: "lamax",
            in: "query",
            required: false,
            schema: { type: "number" },
            description: "Maximum latitude",
            example: 37.8,
          },
          {
            name: "lomin",
            in: "query",
            required: false,
            schema: { type: "number" },
            description: "Minimum longitude",
            example: -122.5,
          },
          {
            name: "lomax",
            in: "query",
            required: false,
            schema: { type: "number" },
            description: "Maximum longitude",
            example: -122.3,
          },
        ],
        responses: {
          "200": {
            description: "OpenSky flight states",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    time: { type: "integer", description: "Server timestamp (Unix)" },
                    states: {
                      type: "array",
                      description:
                        "Array of aircraft state vectors. Each vector: [icao24, callsign, origin_country, time_position, last_contact, longitude, latitude, baro_altitude, on_ground, velocity, true_track, vertical_rate, sensors, geo_altitude, squawk, spi, position_source]",
                      items: { type: "array", items: {} },
                    },
                  },
                },
              },
            },
          },
          "502": { description: "OpenSky Network unavailable" },
        },
        tags: ["Data"],
      },
    },
    "/api/weather/warnings": {
      get: {
        summary: "Get weather warnings (NWS)",
        description:
          "Returns NWS Watch/Warning/Advisory polygons from NOAA via ArcGIS. Optionally filter by bounding box geometry. Up to 500 features. 120-second cache.",
        parameters: [
          {
            name: "geometry",
            in: "query",
            required: false,
            schema: { type: "string" },
            description: "Bounding box as xmin,ymin,xmax,ymax (WGS84) for spatial filtering",
            example: "-125,25,-65,50",
          },
        ],
        responses: {
          "200": {
            description: "GeoJSON FeatureCollection of weather warnings",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  description: "GeoJSON FeatureCollection",
                  properties: {
                    type: { type: "string", example: "FeatureCollection" },
                    features: {
                      type: "array",
                      items: {
                        type: "object",
                        description: "GeoJSON Feature with warning properties",
                      },
                    },
                  },
                },
              },
            },
          },
          "502": { description: "Data fetch failed" },
        },
        tags: ["Data"],
      },
    },
    "/api/overpass": {
      post: {
        summary: "Query OpenStreetMap (Overpass)",
        description:
          "Proxies Overpass API queries against OpenStreetMap data. Supports full Overpass QL syntax. Max query length: 10,000 characters. 30-second timeout. 60-second cache.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["query"],
                properties: {
                  query: {
                    type: "string",
                    description: "Overpass QL query string",
                    maxLength: 10000,
                  },
                },
              },
              example: {
                query: "[out:json];node(48.85,2.35,48.86,2.36)[amenity=cafe];out 3;",
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Overpass API result (JSON)",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  description: "Overpass API response with elements array",
                  properties: {
                    version: { type: "number", example: 0.6 },
                    generator: { type: "string", example: "Overpass API" },
                    elements: {
                      type: "array",
                      items: { type: "object" },
                    },
                  },
                },
              },
            },
          },
          "400": { description: "Missing or invalid query" },
          "502": { description: "Overpass API error or timeout" },
        },
        tags: ["Data"],
      },
    },
    "/api/arcgis": {
      get: {
        summary: "Discover ArcGIS REST services",
        description:
          "Proxies ArcGIS REST API service discovery. Pass any ArcGIS service URL to retrieve its metadata, layers, and capabilities. Automatically requests JSON format. 15-second timeout, 300-second cache.",
        parameters: [
          {
            name: "url",
            in: "query",
            required: true,
            schema: { type: "string", format: "uri" },
            description: "ArcGIS REST service URL",
            example:
              "https://services9.arcgis.com/RHVPKKiFTONKtxq3/ArcGIS/rest/services/NWS_Watch_Warn_Advisory/FeatureServer",
          },
        ],
        responses: {
          "200": {
            description: "ArcGIS service metadata",
            content: {
              "application/json": {
                schema: { type: "object", description: "ArcGIS REST service JSON metadata" },
                example: {
                  currentVersion: "10.81",
                  serviceDescription: "NWS Watch Warning Advisory",
                  layers: [{ id: 0, name: "Watch Warning Advisory", type: "Feature Layer" }],
                },
              },
            },
          },
          "400": { description: "Missing url parameter" },
          "403": { description: "Domain not in allowed list" },
          "502": { description: "ArcGIS fetch failed" },
        },
        tags: ["Discovery"],
      },
    },
    "/api/geoip": {
      get: {
        summary: "Get GeoIP information for requester",
        description:
          "Returns geolocation data for the requesting IP using Cloudflare's request.cf object. Includes city, country, region, coordinates, timezone, ASN, and colocation facility. Cached for 1 hour.",
        responses: {
          "200": {
            description: "GeoIP data",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    ip: { type: "string", example: "203.0.113.1" },
                    city: { type: ["string", "null"], example: "San Francisco" },
                    country: { type: ["string", "null"], example: "US" },
                    countryName: { type: ["string", "null"], example: "United States" },
                    region: { type: ["string", "null"], example: "CA" },
                    regionName: { type: ["string", "null"], example: "California" },
                    postalCode: { type: ["string", "null"], example: "94105" },
                    latitude: { type: ["number", "null"], example: 37.7749 },
                    longitude: { type: ["number", "null"], example: -122.4194 },
                    timezone: { type: ["string", "null"], example: "America/Los_Angeles" },
                    continent: { type: ["string", "null"], example: "NA" },
                    asn: { type: ["number", "null"], example: 13335 },
                    asOrganization: { type: ["string", "null"], example: "Cloudflare" },
                    colo: { type: ["string", "null"], example: "SJC" },
                  },
                },
              },
            },
          },
        },
        tags: ["System"],
      },
    },
    "/api/airquality": {
      get: {
        summary: "Get current air quality data",
        description:
          "Returns current air quality measurements from the Open-Meteo Air Quality API. Includes PM2.5, PM10, CO, NO2, SO2, O3, and US AQI. Data is from nearby monitoring stations.",
        parameters: [
          {
            name: "lat",
            in: "query",
            schema: { type: "number", example: 40.7 },
            required: false,
            description: "Latitude",
          },
          {
            name: "lon",
            in: "query",
            schema: { type: "number", example: -74.0 },
            required: false,
            description: "Longitude",
          },
        ],
        responses: {
          "200": {
            description: "Air quality data",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    type: { type: "string", example: "FeatureCollection" },
                    features: { type: "array", description: "GeoJSON point features with AQI data" },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/api/nlnog": {
      get: {
        summary: "Get NLNOG Ring network nodes",
        description:
          "Returns all NLNOG Ring measurement nodes worldwide with geographic coordinates, ASN, hostname, and city/country data. Approximately 743 nodes across 58 countries. Used for network infrastructure visualization. Cached for 1 hour.",
        responses: {
          "200": {
            description: "NLNOG node list",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    nodes: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          id: { type: "integer", example: 945 },
                          hostname: { type: "string", example: "node.perth.ring.nlnog.net" },
                          asn: { type: "integer", example: 136557 },
                          ipv4: { type: "string", example: "203.0.113.1" },
                          city: { type: "string", example: "Perth" },
                          country: { type: "string", example: "AU" },
                          lat: { type: "number", example: -31.86 },
                          lon: { type: "number", example: 115.89 },
                        },
                      },
                    },
                    count: { type: "integer", example: 743 },
                  },
                },
              },
            },
          },
          "502": { description: "NLNOG API unavailable" },
        },
        tags: ["Data"],
      },
    },
    "/api/bgp": {
      get: {
        summary: "BGP prefix lookup (NLNOG Looking Glass)",
        description:
          "Queries the NLNOG Looking Glass API for BGP routing information about a given IP prefix. Returns AS paths, origin AS, and routing data. Cached for 5 minutes.",
        parameters: [
          {
            name: "prefix",
            in: "query",
            required: true,
            schema: { type: "string" },
            description: "IP prefix in CIDR notation",
            example: "8.8.8.0/24",
          },
        ],
        responses: {
          "200": {
            description: "BGP routing data",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    prefix: { type: "string", example: "8.8.8.0/24" },
                    data: { type: "object", description: "NLNOG Looking Glass response with AS path data" },
                  },
                },
              },
            },
          },
          "400": { description: "Missing prefix parameter" },
          "502": { description: "NLNOG Looking Glass unavailable" },
        },
        tags: ["Network"],
      },
    },
    "/api/geocode": {
      get: {
        summary: "Forward geocode (address to coordinates)",
        description:
          "Proxies Nominatim API for forward geocoding. Converts an address or place name to latitude/longitude coordinates. Returns up to 10 results with full address details. Cached for 1 hour.",
        parameters: [
          {
            name: "query",
            in: "query",
            required: true,
            schema: { type: "string" },
            description: "Address or place name to geocode",
            example: "1600 Pennsylvania Ave, Washington DC",
          },
          {
            name: "limit",
            in: "query",
            required: false,
            schema: { type: "integer", minimum: 1, maximum: 10 },
            description: "Maximum results (default: 5)",
            example: 5,
          },
        ],
        responses: {
          "200": {
            description: "Geocoding results",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    results: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          display_name: {
                            type: "string",
                            example:
                              "White House, 1600, Pennsylvania Avenue Northwest, Washington, DC, 20500, United States",
                          },
                          lat: { type: "number", example: 38.8977 },
                          lon: { type: "number", example: -77.0365 },
                          type: { type: "string", example: "way" },
                          importance: { type: "number" },
                          address: { type: "object" },
                        },
                      },
                    },
                    count: { type: "integer", example: 5 },
                  },
                },
              },
            },
          },
          "400": { description: "Missing query parameter" },
          "502": { description: "Nominatim unavailable" },
        },
        tags: ["Geocoding"],
      },
    },
    "/api/reverse-geocode": {
      get: {
        summary: "Reverse geocode (coordinates to address)",
        description:
          "Proxies Nominatim API for reverse geocoding. Converts latitude/longitude coordinates to a human-readable address. Includes full address hierarchy. Cached for 1 hour.",
        parameters: [
          {
            name: "lat",
            in: "query",
            required: true,
            schema: { type: "number", minimum: -90, maximum: 90 },
            description: "Latitude",
            example: 38.8977,
          },
          {
            name: "lon",
            in: "query",
            required: true,
            schema: { type: "number", minimum: -180, maximum: 180 },
            description: "Longitude",
            example: -77.0365,
          },
          {
            name: "zoom",
            in: "query",
            required: false,
            schema: { type: "integer", minimum: 0, maximum: 18 },
            description: "Detail level (0=country, 18=building). Default: 18",
            example: 18,
          },
        ],
        responses: {
          "200": {
            description: "Reverse geocoding result",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    place: {
                      type: ["object", "null"],
                      properties: {
                        display_name: {
                          type: "string",
                          example:
                            "White House, 1600, Pennsylvania Avenue Northwest, Washington, DC, 20500, United States",
                        },
                        name: { type: "string", example: "White House" },
                        type: { type: "string", example: "way" },
                        address: { type: "object" },
                        osm_id: { type: "integer" },
                        osm_type: { type: "string" },
                      },
                    },
                    location: {
                      type: "object",
                      properties: {
                        lat: { type: "number", example: 38.8977 },
                        lon: { type: "number", example: -77.0365 },
                      },
                    },
                  },
                },
              },
            },
          },
          "400": { description: "Missing or invalid coordinates" },
          "502": { description: "Nominatim unavailable" },
        },
        tags: ["Geocoding"],
      },
    },
    "/api/bathymetry": {
      get: {
        summary: "Get ocean depth or land elevation",
        description:
          "Returns elevation data for any point on Earth. For land points, returns the SRTM elevation. For ocean points, returns depth information. Full GEBCO 2024 bathymetry integration pending.",
        parameters: [
          {
            name: "lat",
            in: "query",
            required: true,
            schema: { type: "number", minimum: -90, maximum: 90 },
            description: "Latitude",
            example: 28.0,
          },
          {
            name: "lon",
            in: "query",
            required: true,
            schema: { type: "number", minimum: -180, maximum: 180 },
            description: "Longitude",
            example: -30.0,
          },
        ],
        responses: {
          "200": {
            description: "Bathymetry/elevation data",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    depth: { type: ["number", "null"], description: "Ocean depth in meters (negative), null for land" },
                    elevation: { type: ["number", "null"], description: "Land elevation in meters, null for ocean" },
                    unit: { type: "string", example: "meters" },
                    surface_type: { type: "string", enum: ["land", "ocean"] },
                    source: { type: ["string", "null"], description: "Data source" },
                    location: {
                      type: "object",
                      properties: {
                        lat: { type: "number" },
                        lon: { type: "number" },
                      },
                    },
                  },
                },
              },
            },
          },
          "400": { description: "Missing or invalid coordinates" },
        },
        tags: ["Hydrography"],
      },
    },
    "/api/waterways": {
      get: {
        summary: "Get water features in a bounding box",
        description:
          "Returns rivers, lakes, and other water features within a bounding box from OpenStreetMap via the Overpass API. Results are returned as a GeoJSON FeatureCollection. Cached for 7 days.",
        parameters: [
          {
            name: "bbox",
            in: "query",
            required: true,
            schema: { type: "string" },
            description: "Bounding box as minLon,minLat,maxLon,maxLat",
            example: "-74.1,40.6,-73.9,40.8",
          },
          {
            name: "type",
            in: "query",
            required: false,
            schema: { type: "string", enum: ["rivers", "lakes", "all"] },
            description: "Feature type to return (default: all)",
            example: "rivers",
          },
          {
            name: "limit",
            in: "query",
            required: false,
            schema: { type: "integer", minimum: 1, maximum: 500 },
            description: "Maximum features (default: 100)",
            example: 100,
          },
        ],
        responses: {
          "200": {
            description: "GeoJSON FeatureCollection of water features",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  description: "GeoJSON FeatureCollection",
                  properties: {
                    type: { type: "string", example: "FeatureCollection" },
                    features: { type: "array", items: { type: "object" } },
                    count: { type: "integer" },
                  },
                },
              },
            },
          },
          "400": { description: "Missing or invalid bbox" },
          "502": { description: "Overpass API unavailable" },
        },
        tags: ["Hydrography"],
      },
    },
    "/api/vessels": {
      get: {
        summary: "Get AIS vessel tracking configuration",
        description:
          "Returns AISstream.io WebSocket configuration for client-side vessel tracking. Requires AISSTREAM_KEY environment variable to be set. The client connects directly to AISstream.io via WebSocket for real-time AIS vessel positions.",
        responses: {
          "200": {
            description: "AISstream.io connection config",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    wsUrl: { type: "string", example: "wss://stream.aisstream.io/v0/stream" },
                    apiKey: { type: "string", description: "AISstream.io API key" },
                    messageTypes: {
                      type: "array",
                      items: { type: "string" },
                      example: ["PositionReport"],
                    },
                  },
                },
              },
            },
          },
          "503": {
            description: "AISSTREAM_KEY not configured",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    error: { type: "string", example: "AISSTREAM_KEY not configured" },
                    message: { type: "string", description: "Setup instructions" },
                    wsUrl: { type: "string" },
                    signupUrl: { type: "string", example: "https://www.aisstream.io/" },
                  },
                },
              },
            },
          },
        },
        tags: ["Maritime"],
      },
    },
    "/api/earthquakes": {
      get: {
        summary: "Earthquake data from USGS",
        description: "Returns recent earthquake GeoJSON from the USGS Earthquake Hazards Program.",
        parameters: [
          {
            name: "period",
            in: "query",
            schema: { type: "string", enum: ["hour", "day", "week", "month"], default: "day" },
          },
        ],
        tags: ["Data"],
      },
    },
    "/api/hurricanes": {
      get: {
        summary: "Hurricane track data from IBTrACS",
        description: "Returns tropical cyclone track data as GeoJSON from the IBTrACS dataset.",
        parameters: [{ name: "active", in: "query", schema: { type: "boolean", default: true } }],
        tags: ["Data"],
      },
    },
    "/api/satellites": {
      get: {
        summary: "Satellite orbital elements from Celestrak",
        description: "Returns Two-Line Element (TLE) sets for tracking satellite positions.",
        parameters: [{ name: "group", in: "query", schema: { type: "string", default: "stations" } }],
        tags: ["Data"],
      },
    },
    "/api/military": {
      get: {
        summary: "Military aircraft from ADSB Exchange",
        description: "Returns military aircraft positions within a radius of given coordinates.",
        parameters: [
          { name: "lat", in: "query", required: true, schema: { type: "number" } },
          { name: "lon", in: "query", required: true, schema: { type: "number" } },
          { name: "dist", in: "query", schema: { type: "number", default: 250, maximum: 1000 } },
        ],
        tags: ["Data"],
      },
    },
    "/api/wildfires": {
      get: {
        summary: "Wildfire events from NASA EONET",
        description: "Returns wildfire event data as GeoJSON from NASA's Earth Observatory Natural Event Tracker.",
        tags: ["Data"],
      },
    },
    "/api/elevation/batch": {
      post: {
        summary: "Batch elevation lookup",
        description: "Returns elevation for up to 2000 geographic points in a single request.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["points"],
                properties: {
                  points: {
                    type: "array",
                    items: {
                      type: "object",
                      required: ["lat", "lon"],
                      properties: { lat: { type: "number" }, lon: { type: "number" }, id: { type: "string" } },
                    },
                    maxItems: 2000,
                  },
                },
              },
            },
          },
        },
        tags: ["Elevation"],
      },
    },
    "/api/dem-tile": {
      get: {
        summary: "DEM tile provider metadata",
        description: "Returns TileJSON metadata for the global DEM terrain tile service.",
        tags: ["Tiles"],
      },
    },
    "/api/dem-tile/{z}/{x}/{y}": {
      get: {
        summary: "DEM terrain tile",
        description: "Returns a Terrarium-encoded PNG elevation tile at the given z/x/y coordinates.",
        parameters: [
          { name: "z", in: "path", required: true, schema: { type: "integer", minimum: 0, maximum: 14 } },
          { name: "x", in: "path", required: true, schema: { type: "integer" } },
          { name: "y", in: "path", required: true, schema: { type: "integer" } },
        ],
        tags: ["Tiles"],
      },
    },
    "/api/query": {
      get: {
        summary: "Combined elevation, weather, and tides query",
        description: "Returns elevation, weather conditions, and tide information for a single point.",
        parameters: [
          { name: "lat", in: "query", required: true, schema: { type: "number" } },
          { name: "lon", in: "query", required: true, schema: { type: "number" } },
        ],
        tags: ["Elevation"],
      },
    },
    "/api/docs-md": {
      get: {
        summary: "API documentation (Markdown)",
        description: "Returns API documentation in Markdown format.",
        tags: ["System"],
      },
    },
    "/api/proxy/tile": {
      get: {
        summary: "Generic tile proxy",
        description: "Proxies XYZ/TMS tile requests to external servers with CORS headers.",
        parameters: [
          { name: "url", in: "query", required: true, schema: { type: "string" } },
          { name: "z", in: "query", required: true, schema: { type: "integer" } },
          { name: "x", in: "query", required: true, schema: { type: "integer" } },
          { name: "y", in: "query", required: true, schema: { type: "integer" } },
        ],
        tags: ["Proxy"],
      },
    },
    "/api/proxy/wms": {
      get: {
        summary: "WMS proxy",
        description: "Proxies WMS GetMap requests to external WMS servers with CORS headers.",
        parameters: [{ name: "url", in: "query", required: true, schema: { type: "string" } }],
        tags: ["Proxy"],
      },
    },
    "/api/collections": {
      get: {
        summary: "OGC API Collections list",
        description: "Lists all available OGC API collections.",
        tags: ["Discovery"],
      },
    },
    "/api/collections/{id}": {
      get: {
        summary: "OGC API Collection by ID",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        tags: ["Discovery"],
      },
    },
    "/api/tiles": {
      get: {
        summary: "OGC API Tiles metadata",
        description: "Returns OGC API - Tiles tileset metadata.",
        tags: ["Tiles"],
      },
    },
    "/api/sentinel2/{z}/{x}/{y}": {
      get: {
        summary: "Sentinel-2 satellite imagery tile",
        parameters: [
          { name: "z", in: "path", required: true, schema: { type: "integer" } },
          { name: "x", in: "path", required: true, schema: { type: "integer" } },
          { name: "y", in: "path", required: true, schema: { type: "integer" } },
        ],
        tags: ["Tiles"],
      },
    },
    "/api/landcover/{z}/{x}/{y}": {
      get: {
        summary: "CORINE land cover tile",
        parameters: [
          { name: "z", in: "path", required: true, schema: { type: "integer" } },
          { name: "x", in: "path", required: true, schema: { type: "integer" } },
          { name: "y", in: "path", required: true, schema: { type: "integer" } },
        ],
        tags: ["Tiles"],
      },
    },
    "/api/population/{z}/{x}/{y}": {
      get: {
        summary: "Population density tile (GHSL)",
        parameters: [
          { name: "z", in: "path", required: true, schema: { type: "integer" } },
          { name: "x", in: "path", required: true, schema: { type: "integer" } },
          { name: "y", in: "path", required: true, schema: { type: "integer" } },
        ],
        tags: ["Tiles"],
      },
    },
    "/api/opensky/flights": {
      get: {
        summary: "OpenSky flight data with credit headers",
        description: "Returns flight state vectors from the OpenSky Network via server-side OAuth2.",
        tags: ["Data"],
      },
    },
    "/api/opensky/token": {
      get: {
        summary: "OpenSky OAuth2 token status",
        description: "Returns the current OpenSky API token status and rate limit info.",
        tags: ["Data"],
      },
    },
    "/api/gebco-tile/{name}": {
      get: {
        summary: "GEBCO bathymetry tile",
        description: "Serves GEBCO 2025 bathymetry/terrain tiles in Terrarium PNG encoding.",
        parameters: [
          {
            name: "name",
            in: "path",
            required: true,
            schema: { type: "string" },
            description: "GEBCO quad name (e.g. N35W120)",
          },
        ],
        responses: { "200": { description: "Terrarium PNG tile" }, "404": { description: "Tile not found" } },
        tags: ["Tiles"],
      },
    },
    "/api/tiles/{tileMatrixSetId}/{tileMatrix}/{tileRow}/{tileCol}": {
      get: {
        summary: "OGC API Tiles — terrain tile data",
        description:
          "Serves terrain elevation tiles in Terrarium PNG encoding. Assembles tiles on-the-fly from SRTM 30m chunk datasets. Supports WebMercatorQuad and WorldCRS84Quad tile matrix sets.",
        parameters: [
          {
            name: "tileMatrixSetId",
            in: "path",
            required: true,
            schema: { type: "string" },
            description: "Tile matrix set (WebMercatorQuad or WorldCRS84Quad)",
          },
          {
            name: "tileMatrix",
            in: "path",
            required: true,
            schema: { type: "integer" },
            description: "Zoom level (0-14)",
          },
          { name: "tileRow", in: "path", required: true, schema: { type: "integer" }, description: "Tile row (Y)" },
          { name: "tileCol", in: "path", required: true, schema: { type: "integer" }, description: "Tile column (X)" },
        ],
        responses: {
          "200": { description: "Terrarium PNG tile (elevation encoded as RGB)" },
          "400": { description: "Invalid tile matrix set or coordinates" },
          "404": { description: "Tile out of range" },
        },
        tags: ["Tiles"],
      },
    },
    "/api/pmtiles/{key}": {
      get: {
        summary: "PMTiles metadata redirect",
        description: "Returns 410 Gone — Overture Maps building footprints moved to direct PMTiles access.",
        parameters: [
          { name: "key", in: "path", required: true, schema: { type: "string" }, description: "PMTiles key" },
        ],
        responses: { "410": { description: "Gone — service migrated" } },
        tags: ["Discovery"],
      },
    },
    "/api/stac/{path}": {
      get: {
        summary: "STAC API proxy",
        description: "Proxies requests to the STAC API for Earth observation metadata.",
        parameters: [
          { name: "path", in: "path", required: true, schema: { type: "string" }, description: "STAC API path" },
        ],
        responses: { "200": { description: "STAC response" } },
        tags: ["Discovery"],
      },
    },
    "/api/collections/{id}/items": {
      get: {
        summary: "Collection items (OGC Features)",
        description: "Returns GeoJSON features for a specific collection with pagination and filtering.",
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" }, description: "Collection ID" },
          {
            name: "limit",
            in: "query",
            schema: { type: "integer", default: 100 },
            description: "Items per page (max 10000)",
          },
          { name: "offset", in: "query", schema: { type: "integer", default: 0 }, description: "Start index" },
          {
            name: "bbox",
            in: "query",
            schema: { type: "string" },
            description: "Bounding box (minLon,minLat,maxLon,maxLat)",
          },
        ],
        responses: {
          "200": { description: "GeoJSON FeatureCollection" },
          "404": { description: "Collection not found" },
        },
        tags: ["Discovery"],
      },
    },
    "/api/openapi.json": {
      get: {
        summary: "OpenAPI specification",
        description: "Returns this OpenAPI 3.0.3 specification document.",
        responses: { "200": { description: "OpenAPI JSON spec" } },
        tags: ["Discovery"],
      },
    },
  },
  tags: [
    { name: "Elevation", description: "Point elevation queries" },
    { name: "Tiles", description: "Slippy map elevation tiles" },
    { name: "System", description: "Health and status endpoints" },
    { name: "Proxy", description: "CORS proxy for external geospatial APIs" },
    { name: "Data", description: "Real-time geospatial data (flights, vessels, weather, OSM)" },
    { name: "Discovery", description: "Service discovery and metadata" },
    { name: "Network", description: "Network infrastructure and BGP data" },
    { name: "Geocoding", description: "Forward and reverse geocoding" },
    { name: "Hydrography", description: "Bathymetry and waterway data" },
    { name: "Maritime", description: "AIS vessel tracking data" },
    { name: "Aviation", description: "Flight and military aircraft tracking" },
    { name: "Hazards", description: "Earthquakes, hurricanes, wildfires" },
    { name: "Imagery", description: "Satellite and land cover tile layers" },
  ],
};

export async function GET(request: NextRequest) {
  const baseUrl = new URL(request.url).origin;
  return NextResponse.json(
    { ...openApiSpec, servers: [{ url: baseUrl, description: "Current deployment" }] },
    {
      headers: {
        ...CORS_HEADERS,
        "Cache-Control": "public, max-age=3600",
      },
    },
  );
}
