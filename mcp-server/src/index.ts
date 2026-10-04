/**
 * OpenZenith MCP Server
 *
 * Model Context Protocol server for the OpenZenith geospatial API.
 * Provides AI tools for querying elevation, weather, tides, addresses,
 * waterways, and more for any point on Earth.
 *
 * Usage with Claude Desktop (claude_desktop_config.json):
 *   {
 *     "mcpServers": {
 *       "openzenith": {
 *         "command": "node",
 *         "args": ["/path/to/mcp-server/dist/index.js"]
 *       }
 *     }
 *   }
 *
 * Usage with Claude Code (.claude/mcp.json):
 *   {
 *     "mcpServers": {
 *       "openzenith": {
 *         "command": "node",
 *         "args": ["/path/to/mcp-server/dist/index.js"]
 *       }
 *     }
 *   }
 *
 * Environment variables:
 *   OPENZENITH_BASE_URL - API base URL (default: https://openzenith.pages.dev/api)
 *   OPENZENITH_CACHE_TTL - Cache TTL in ms (default: 300000 = 5 min)
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const BASE_URL = process.env.OPENZENITH_BASE_URL || "https://openzenith.pages.dev/api";
const CACHE_TTL = parseInt(process.env.OPENZENITH_CACHE_TTL || "300000", 10);

// In-memory cache with TTL
const cache = new Map<string, { data: unknown; ts: number }>();

/**
 * Cached payload for `key`, or null on miss/expiry. Payloads are passed
 * straight to JSON.stringify, so `unknown` is the honest type — no caller
 * ever narrows them.
 */
function getCached(key: string): unknown {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.ts < CACHE_TTL) {
    return entry.data;
  }
  return null;
}

function setCache(key: string, data: unknown): void {
  cache.set(key, { data, ts: Date.now() });
  if (cache.size > 500) {
    const now = Date.now();
    for (const [k, v] of cache) {
      if (now - v.ts > CACHE_TTL) cache.delete(k);
    }
  }
}

async function apiFetch(path: string): Promise<unknown> {
  const url = `${BASE_URL}${path}`;
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`API error ${res.status}: ${text.slice(0, 200)}`);
  }
  // /docs-md answers Content-Type: text/markdown — JSON.parsing it throws
  // before the caller ever sees the payload, so branch on the content type.
  if (!(res.headers.get("content-type") ?? "").includes("application/json")) {
    return res.text();
  }
  const body: unknown = await res.json();
  return body;
}

/** Is this payload a JSON object (the shape every projected field lives on)? */
function isRecord(payload: unknown): payload is Record<string, unknown> {
  return typeof payload === "object" && payload !== null;
}

/**
 * Narrow an API payload to the object this server reads fields from. The REST
 * API is the trust boundary — nothing is assumed about its JSON beyond
 * "object or not", and a non-object is a hard error rather than an
 * untyped member read.
 */
function asRecord(payload: unknown): Record<string, unknown> {
  if (!isRecord(payload)) {
    throw new TypeError(`API returned ${typeof payload}, expected a JSON object`);
  }
  return payload;
}

/** Narrow an API payload to the text this server passes through verbatim. */
function asText(payload: unknown): string {
  if (typeof payload !== "string") {
    throw new TypeError(`API returned ${typeof payload}, expected text`);
  }
  return payload;
}

const server = new McpServer({
  name: "openzenith",
  version: "1.0.0",
  description: "Free geospatial API — elevation, weather, tides, address, waterways for any point on Earth. No API key required.",
});

// ─── Tool: unified query ───

server.registerTool(
  "query",
  {
    description: "Query multiple geospatial data types for a location in a single request. Returns elevation, address, weather, tides, and/or waterways based on the 'include' parameter. Default: elevation only.",
    inputSchema: {
      lat: z.number().min(-90).max(90).describe("Latitude"),
      lon: z.number().min(-180).max(180).describe("Longitude"),
      include: z.string()
        .default("elevation")
        .describe("Comma-separated data to include: elevation, address, weather, tides, waterways"),
      units: z.enum(["metric", "imperial"])
        .default("metric")
        .describe("Temperature/measurement units"),
      forecast_days: z.number().min(1).max(7).default(3)
        .describe("Weather forecast days (1-7)"),
    },
  },
  async ({ lat, lon, include, units, forecast_days }) => {
    const params = new URLSearchParams({
      lat: lat.toString(),
      lon: lon.toString(),
      include,
      units,
      forecast_days: forecast_days.toString(),
    });

    const cacheKey = `query:${params.toString()}`;
    const cached = getCached(cacheKey);
    if (cached) return { content: [{ type: "text" as const, text: JSON.stringify(cached, null, 2) }] };

    const data = await apiFetch(`/query?${params}`);
    setCache(cacheKey, data);
    return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
  },
);

// ─── Tool: elevation ───

server.registerTool(
  "elevation",
  {
    description: "Get elevation (positive) or ocean depth (negative) for a point on Earth. The server picks the best source automatically: OZT2 z10 tiles from SRTM 30m, falling back to merged SRTM chunks.",
    inputSchema: {
      lat: z.number().min(-90).max(90).describe("Latitude"),
      lon: z.number().min(-180).max(180).describe("Longitude"),
    },
  },
  async ({ lat, lon }) => {
    const params = new URLSearchParams({ lat: lat.toString(), lon: lon.toString() });
    const cacheKey = `elev:${params.toString()}`;
    const cached = getCached(cacheKey);
    if (cached) return { content: [{ type: "text" as const, text: JSON.stringify(cached, null, 2) }] };

    const data = await apiFetch(`/elevation?${params}`);
    setCache(cacheKey, data);
    return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
  },
);

// ─── Tool: weather ───

server.registerTool(
  "weather",
  {
    description: "Get current weather conditions and daily forecast for a location. Powered by Open-Meteo (free, no API key).",
    inputSchema: {
      lat: z.number().min(-90).max(90).describe("Latitude"),
      lon: z.number().min(-180).max(180).describe("Longitude"),
      forecast_days: z.number().min(1).max(7).default(3)
        .describe("Forecast days (1-7)"),
      units: z.enum(["metric", "imperial"]).default("metric")
        .describe("Temperature units"),
    },
  },
  async ({ lat, lon, forecast_days, units }) => {
    const params = new URLSearchParams({
      lat: lat.toString(),
      lon: lon.toString(),
      include: "weather",
      forecast_days: forecast_days.toString(),
      units,
    });
    const cacheKey = `weather:${lat},${lon},${units}`;
    const cached = getCached(cacheKey);
    if (cached) return { content: [{ type: "text" as const, text: JSON.stringify(cached, null, 2) }] };

    const data = await apiFetch(`/query?${params}`);
    setCache(cacheKey, data);
    return { content: [{ type: "text" as const, text: JSON.stringify(asRecord(data).weather, null, 2) }] };
  },
);

// ─── Tool: tides ───

server.registerTool(
  "tides",
  {
    description: "Get tide predictions for a coastal location. Uses NOAA Tides and Currents (US coastal areas only, within ~50 nautical miles of a station).",
    inputSchema: {
      lat: z.number().min(-90).max(90).describe("Latitude"),
      lon: z.number().min(-180).max(180).describe("Longitude"),
    },
  },
  async ({ lat, lon }) => {
    const cacheKey = `tides:${lat.toFixed(2)},${lon.toFixed(2)}`;
    const cached = getCached(cacheKey);
    if (cached) return { content: [{ type: "text" as const, text: JSON.stringify(cached, null, 2) }] };

    const data = await apiFetch(`/query?lat=${lat}&lon=${lon}&include=tides`);
    setCache(cacheKey, data);
    return { content: [{ type: "text" as const, text: JSON.stringify(asRecord(data).tides, null, 2) }] };
  },
);

// ─── Tool: geocode ───

server.registerTool(
  "geocode",
  {
    description: "Convert a place name or address to coordinates. Uses OpenStreetMap Nominatim.",
    inputSchema: {
      query: z.string().describe("Place name or address to search for"),
      limit: z.number().min(1).max(10).default(5).describe("Max results"),
    },
  },
  async ({ query, limit }) => {
    const params = new URLSearchParams({ query, limit: limit.toString() });
    const data = await apiFetch(`/geocode?${params}`);
    return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
  },
);

// ─── Tool: reverse_geocode ───

server.registerTool(
  "reverse_geocode",
  {
    description: "Convert coordinates to a human-readable address. Uses OpenStreetMap Nominatim.",
    inputSchema: {
      lat: z.number().min(-90).max(90).describe("Latitude"),
      lon: z.number().min(-180).max(180).describe("Longitude"),
      zoom: z.number().min(0).max(18).default(18)
        .describe("Detail level (0=country, 18=building)"),
    },
  },
  async ({ lat, lon, zoom }) => {
    const params = new URLSearchParams({
      lat: lat.toString(),
      lon: lon.toString(),
      zoom: zoom.toString(),
    });
    const data = await apiFetch(`/reverse-geocode?${params}`);
    return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
  },
);

// ─── Tool: bathymetry ───

server.registerTool(
  "bathymetry",
  {
    description: "Get ocean depth at a location. Returns depth (positive meters below sea level), elevation, and surface type. Uses GEBCO 2025 global bathymetry.",
    inputSchema: {
      lat: z.number().min(-90).max(90).describe("Latitude"),
      lon: z.number().min(-180).max(180).describe("Longitude"),
    },
  },
  async ({ lat, lon }) => {
    const cacheKey = `bathy:${lat.toFixed(2)},${lon.toFixed(2)}`;
    const cached = getCached(cacheKey);
    if (cached) return { content: [{ type: "text" as const, text: JSON.stringify(cached, null, 2) }] };

    const data = await apiFetch(`/bathymetry?lat=${lat}&lon=${lon}`);
    setCache(cacheKey, data);
    return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
  },
);

// ─── Tool: api_docs ───

server.registerTool(
  "api_docs",
  {
    description: "Get the full OpenZenith API documentation as markdown. Always read this first to understand available endpoints, parameters, and response formats.",
    inputSchema: {},
  },
  async () => {
    const data = asText(await apiFetch("/docs-md"));
    return { content: [{ type: "text" as const, text: data }] };
  },
);

// ─── Resource: API docs ───

server.registerResource(
  "docs",
  "OpenZenith API documentation (markdown)",
  {},
  async () => {
    const docs = asText(await apiFetch("/docs-md"));
    return {
      contents: [{ uri: "openzenith://docs", mimeType: "text/markdown", text: docs }],
    };
  },
);

// ─── Start server ───

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// Only auto-start under direct execution (`node dist/index.js`); imports from
// tests must get the server object without attaching a stdio transport.
if (
  process.argv[1] &&
  import.meta.url === (await import("node:url")).pathToFileURL(process.argv[1]).href
) {
  main().catch((err: unknown) => {
    console.error("OpenZenith MCP Server failed:", err);
    process.exit(1);
  });
}

export { server, apiFetch, getCached, setCache, clearCache };

function clearCache(): void {
  cache.clear();
}
