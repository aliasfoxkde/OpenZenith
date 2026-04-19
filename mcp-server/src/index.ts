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

function getCached<T>(key: string): T | null {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.ts < CACHE_TTL) {
    return entry.data as T;
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
  return res.json();
}

const server = new McpServer({
  name: "openzenith",
  version: "1.0.0",
  description: "Free geospatial API — elevation, weather, tides, address, waterways for any point on Earth. No API key required.",
});

// ─── Tool: unified query ───

server.tool(
  "query",
  "Query multiple geospatial data types for a location in a single request. Returns elevation, address, weather, tides, and/or waterways based on the 'include' parameter. Default: elevation only.",
  {
    lat: z.number().min(-90).max(90).describe("Latitude"),
    lon: z.number().min(-180).max(180).describe("Longitude"),
    include: z.string()
      .default("elevation")
      .describe("Comma-separated data to include: elevation, address, weather, tides, waterways"),
    dataset: z.enum(["auto", "srtm30m", "copernicus-glo30", "gebco2025"])
      .default("auto")
      .describe("Elevation dataset to use"),
    units: z.enum(["metric", "imperial"])
      .default("metric")
      .describe("Temperature/measurement units"),
    forecast_days: z.number().min(1).max(7).default(3)
      .describe("Weather forecast days (1-7)"),
  },
  async ({ lat, lon, include, dataset, units, forecast_days }) => {
    const params = new URLSearchParams({
      lat: lat.toString(),
      lon: lon.toString(),
      include,
      dataset,
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

server.tool(
  "elevation",
  "Get elevation (positive) or ocean depth (negative) for a point on Earth. Uses SRTM 30m, Copernicus GLO-30, and GEBCO 2025 with automatic cascade.",
  {
    lat: z.number().min(-90).max(90).describe("Latitude"),
    lon: z.number().min(-180).max(180).describe("Longitude"),
    dataset: z.enum(["auto", "srtm30m", "copernicus-glo30", "gebco2025"])
      .default("auto")
      .describe("Elevation dataset"),
  },
  async ({ lat, lon, dataset }) => {
    const params = new URLSearchParams({ lat: lat.toString(), lon: lon.toString(), dataset });
    const cacheKey = `elev:${params.toString()}`;
    const cached = getCached(cacheKey);
    if (cached) return { content: [{ type: "text" as const, text: JSON.stringify(cached, null, 2) }] };

    const data = await apiFetch(`/elevation?${params}`);
    setCache(cacheKey, data);
    return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
  },
);

// ─── Tool: weather ───

server.tool(
  "weather",
  "Get current weather conditions and daily forecast for a location. Powered by Open-Meteo (free, no API key).",
  {
    lat: z.number().min(-90).max(90).describe("Latitude"),
    lon: z.number().min(-180).max(180).describe("Longitude"),
    forecast_days: z.number().min(1).max(7).default(3)
      .describe("Forecast days (1-7)"),
    units: z.enum(["metric", "imperial"]).default("metric")
      .describe("Temperature units"),
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
    return { content: [{ type: "text" as const, text: JSON.stringify((data as Record<string, unknown>).weather, null, 2) }] };
  },
);

// ─── Tool: tides ───

server.tool(
  "tides",
  "Get tide predictions for a coastal location. Uses NOAA Tides and Currents (US coastal areas only, within ~50 nautical miles of a station).",
  {
    lat: z.number().min(-90).max(90).describe("Latitude"),
    lon: z.number().min(-180).max(180).describe("Longitude"),
  },
  async ({ lat, lon }) => {
    const cacheKey = `tides:${lat.toFixed(2)},${lon.toFixed(2)}`;
    const cached = getCached(cacheKey);
    if (cached) return { content: [{ type: "text" as const, text: JSON.stringify(cached, null, 2) }] };

    const data = await apiFetch(`/query?lat=${lat}&lon=${lon}&include=tides`);
    setCache(cacheKey, data);
    return { content: [{ type: "text" as const, text: JSON.stringify((data as Record<string, unknown>).tides, null, 2) }] };
  },
);

// ─── Tool: geocode ───

server.tool(
  "geocode",
  "Convert a place name or address to coordinates. Uses OpenStreetMap Nominatim.",
  {
    query: z.string().describe("Place name or address to search for"),
    limit: z.number().min(1).max(10).default(5).describe("Max results"),
  },
  async ({ query, limit }) => {
    const params = new URLSearchParams({ query, limit: limit.toString() });
    const data = await apiFetch(`/geocode?${params}`);
    return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
  },
);

// ─── Tool: reverse_geocode ───

server.tool(
  "reverse_geocode",
  "Convert coordinates to a human-readable address. Uses OpenStreetMap Nominatim.",
  {
    lat: z.number().min(-90).max(90).describe("Latitude"),
    lon: z.number().min(-180).max(180).describe("Longitude"),
    zoom: z.number().min(0).max(18).default(18)
      .describe("Detail level (0=country, 18=building)"),
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

server.tool(
  "bathymetry",
  "Get ocean depth at a location. Returns depth (positive meters below sea level), elevation, and surface type. Uses GEBCO 2025 global bathymetry.",
  {
    lat: z.number().min(-90).max(90).describe("Latitude"),
    lon: z.number().min(-180).max(180).describe("Longitude"),
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

server.tool(
  "api_docs",
  "Get the full OpenZenith API documentation as markdown. Always read this first to understand available endpoints, parameters, and response formats.",
  {},
  async () => {
    const data = await apiFetch("/docs-md");
    return { content: [{ type: "text" as const, text: data as string }] };
  },
);

// ─── Resource: API docs ───

server.resource(
  "docs",
  "OpenZenith API documentation (markdown)",
  async () => {
    const docs = await apiFetch("/docs-md");
    return {
      contents: [{ uri: "openzenith://docs", mimeType: "text/markdown", text: docs as string }],
    };
  },
);

// ─── Start server ───

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("OpenZenith MCP Server failed:", err);
  process.exit(1);
});
