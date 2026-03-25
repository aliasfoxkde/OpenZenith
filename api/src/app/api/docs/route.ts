import { NextResponse } from "next/server";

export const runtime = "edge";

const openApiSpec = {
  openapi: "3.0.3",
  info: {
    title: "OpenZenith Elevation API",
    version: "0.2.0",
    description:
      "Free, fast, global elevation data API. Query any point on Earth for elevation data from NASA SRTM 30m.",
    contact: {
      name: "OpenZenith",
    },
    license: {
      name: "MIT",
    },
  },
  servers: [
    {
      url: "https://openzenith.pages.dev",
      description: "Production (Cloudflare Pages)",
    },
  ],
  paths: {
    "/api/elevation": {
      get: {
        summary: "Get elevation at a point",
        description:
          "Returns the elevation in meters at the given latitude/longitude coordinates using NASA SRTM 30m data.",
        parameters: [
          {
            name: "lat",
            in: "query",
            required: true,
            schema: { type: "number", minimum: -56, maximum: 60 },
            description: "Latitude (-56 to 60, SRTM coverage)",
            example: 28.5,
          },
          {
            name: "lon",
            in: "query",
            required: true,
            schema: { type: "number", minimum: -180, maximum: 180 },
            description: "Longitude (-180 to 180)",
            example: 96.5,
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
                      description:
                        "Elevation in meters, or null if no data at this point",
                      example: 4231,
                    },
                    unit: { type: "string", example: "meters" },
                    location: {
                      type: "object",
                      properties: {
                        lat: { type: "number", example: 28.5 },
                        lon: { type: "number", example: 96.5 },
                      },
                    },
                    source: {
                      type: "string",
                      example: "srtm30m",
                    },
                    srtmTile: {
                      type: "string",
                      example: "N28E096.tif",
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
                  elevation: 4231,
                  unit: "meters",
                  location: { lat: 28.5, lon: 96.5 },
                  source: "srtm30m",
                  srtmTile: "N28E096.tif",
                  resolution: 30,
                },
              },
            },
          },
          "400": {
            description: "Invalid parameters",
          },
          "500": {
            description: "Server error",
          },
        },
        tags: ["Elevation"],
      },
    },
    "/api/tile/{z}/{x}/{y}": {
      get: {
        summary: "Get elevation tile",
        description:
          "Returns a 256x256 grid of elevation values as raw Int16 binary data for a slippy map tile. Each value is a 16-bit signed integer in little-endian byte order. NoData values are -32768.",
        parameters: [
          {
            name: "z",
            in: "path",
            required: true,
            schema: { type: "integer", minimum: 0, maximum: 15 },
            description: "Zoom level (0-15)",
          },
          {
            name: "x",
            in: "path",
            required: true,
            schema: { type: "integer", minimum: 0 },
            description: "Tile column",
          },
          {
            name: "y",
            in: "path",
            required: true,
            schema: { type: "integer", minimum: 0 },
            description: "Tile row",
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
                  description:
                    "256x256 Int16Array (131,072 bytes). Row-major, top-left origin.",
                },
              },
            },
            headers: {
              "X-Tile-Size": {
                schema: { type: "integer", example: 256 },
                description: "Tile width/height in pixels",
              },
              "X-Zoom": {
                schema: { type: "integer", example: 10 },
                description: "Zoom level",
              },
            },
          },
          "400": {
            description: "Invalid tile coordinates",
          },
        },
        tags: ["Tiles"],
      },
    },
    "/api/health": {
      get: {
        summary: "Health check",
        description: "Returns service health status and configuration.",
        responses: {
          "200": {
            description: "Health status",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    status: { type: "string", example: "healthy" },
                    version: { type: "string", example: "0.1.0" },
                    storage: {
                      type: "object",
                      properties: {
                        backend: { type: "string", example: "huggingface" },
                        type: { type: "string", example: "chunks" },
                        repo: { type: "string" },
                        chunkSize: { type: "string", example: "256x256" },
                      },
                    },
                    coverage: {
                      type: "object",
                      properties: {
                        source: { type: "string" },
                        resolution: { type: "string" },
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
  },
  tags: [
    { name: "Elevation", description: "Point elevation queries" },
    { name: "Tiles", description: "Slippy map elevation tiles" },
    { name: "System", description: "Health and status endpoints" },
  ],
};

export async function GET() {
  return NextResponse.json(openApiSpec, {
    headers: {
      "Cache-Control": "public, max-age=3600",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
