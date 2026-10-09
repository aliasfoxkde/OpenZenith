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
  return readUpstream(await fetch(`${BASE_URL}${path}`));
}

/**
 * POST a JSON body to the API and read the payload back. The terrain-analysis
 * routes (`/profile`, `/watershed`, `/trace`, `/elevation/batch`) are POST-only
 * — their inputs are coordinate lists that would blow past URL length limits.
 */
async function apiPost(path: string, body: unknown): Promise<unknown> {
  return readUpstream(
    await fetch(`${BASE_URL}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

/** Consume a Response into its payload, or throw the one-line upstream error. */
async function readUpstream(res: Response): Promise<unknown> {
  if (!res.ok) {
    throw new Error(await upstreamError(res));
  }
  // /docs-md answers Content-Type: text/markdown — JSON.parsing it throws
  // before the caller ever sees the payload, so branch on the content type.
  if (!(res.headers.get("content-type") ?? "").includes("application/json")) {
    return res.text();
  }
  const body: unknown = await res.json();
  return body;
}

/**
 * One-line reason for a non-OK upstream response — no URL, no traceback, no
 * body dump. A 5xx is infrastructure and says nothing more; a 4xx usually
 * carries a decision-relevant reason from the route itself (e.g. "No elevation
 * data at starting point"), which is worth the extra clause.
 */
async function upstreamError(res: Response): Promise<string> {
  const raw = await res.text().catch(() => "");
  if (res.status >= 500 || raw === "") return `upstream returned ${res.status}`;
  try {
    const parsed: unknown = JSON.parse(raw);
    const message = isRecord(parsed) ? parsed.error : undefined;
    if (typeof message === "string" && message.trim() !== "") {
      return `upstream returned ${res.status}: ${message.replace(/\s+/g, " ").slice(0, 120)}`;
    }
  } catch {
    // HTML or plain-text body — the status alone is the honest summary.
  }
  return `upstream returned ${res.status}`;
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

// ─── Terrain-analysis helpers ───
//
// These tools return model-shaped text rather than raw JSON: the answer first
// (distance, elevation range, dominant direction), then a capped table or
// GeoJSON. Every cap is a hard constant; when a route answers with more rows
// than the cap, the tool downsamples or truncates and the summary line says so,
// so a partial answer is never readable as the whole one.

/** Samples returned by terrain_profile and elevation_along_path. */
const MAX_PROFILE_POINTS = 100;
/** Waypoints accepted by elevation_along_path — each one is another upstream call. */
const MAX_PATH_WAYPOINTS = 10;
/** Tiles fetched for a single contours bbox. */
const MAX_CONTOUR_TILES = 4;
/** Contour GeoJSON caps: lines, total vertices, vertices per line. */
const MAX_CONTOUR_LINES = 50;
const MAX_CONTOUR_VERTICES = 4000;
const MAX_CONTOUR_LINE_VERTICES = 500;
/** Watershed boundary vertices returned. */
const MAX_WATERSHED_VERTICES = 600;
/** Flow-trace points returned. */
const MAX_TRACE_POINTS = 100;
/** NODATA sentinel shared by the DEM routes under api/src/app/api. */
const NODATA = -32768;

/** Narrow an API payload to the array this server iterates. */
function asArray(payload: unknown, label: string): unknown[] {
  if (!Array.isArray(payload)) {
    throw new TypeError(`API returned ${typeof payload}, expected an array for ${label}`);
  }
  return payload;
}

/** Narrow an API payload to the array of objects this server reads fields from. */
function asRecords(payload: unknown, label: string): Record<string, unknown>[] {
  return asArray(payload, label).map((item, index) => {
    if (!isRecord(item)) {
      throw new TypeError(`API returned a non-object ${label}[${index}]`);
    }
    return item;
  });
}

/** Read a numeric field, or null when it is absent/non-numeric (API nulls are legitimate). */
function numField(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Read a numeric field the route always sends; a missing one is a hard error. */
function requiredNum(record: Record<string, unknown>, key: string): number {
  const value = numField(record, key);
  if (value === null) {
    throw new TypeError(`API omitted the numeric field ${key}`);
  }
  return value;
}

/** Narrow a two-number coordinate pair ([lat, lon] or GeoJSON [lon, lat]). */
function coord2(value: unknown, label: string): [number, number] {
  const pair = asArray(value, label);
  const first = pair[0];
  const second = pair[1];
  if (typeof first !== "number" || typeof second !== "number") {
    throw new TypeError(`API returned a non-numeric ${label}`);
  }
  return [first, second];
}

/** Narrow a list of coordinate pairs (a GeoJSON LineString's coordinates). */
function coordList(value: unknown, label: string): [number, number][] {
  return asArray(value, label).map((point) => coord2(point, label));
}

/** The optional stats object the terrain routes attach (null when no valid data). */
function statsOf(payload: Record<string, unknown>): Record<string, unknown> | null {
  return isRecord(payload.stats) ? payload.stats : null;
}

/** The [lon, lat] vertices of a contour LineString feature, or null if it is not one. */
function lineCoords(feature: unknown): [number, number][] | null {
  if (!isRecord(feature)) return null;
  const geometry = feature.geometry;
  if (!isRecord(geometry) || geometry.type !== "LineString") return null;
  return coordList(geometry.coordinates, "LineString coordinates");
}

/** The contour level and major/minor class of a contour feature, or null. */
function contourProps(feature: unknown): { elevation: number; major: boolean } | null {
  if (!isRecord(feature)) return null;
  const properties = feature.properties;
  if (!isRecord(properties)) return null;
  const elevation = numField(properties, "elevation");
  if (elevation === null) return null;
  return { elevation, major: properties.type === "major" };
}

/**
 * The watershed route's single boundary ring, truncated to the vertex cap and
 * re-closed. Null when the route degenerated to a Point rather than a Polygon.
 */
function cappedPolygonRing(
  feature: Record<string, unknown>,
): { ring: [number, number][]; total: number; truncated: boolean } | null {
  const geometry = isRecord(feature.geometry) ? feature.geometry : null;
  if (!geometry || geometry.type !== "Polygon") return null;
  const rings = asArray(geometry.coordinates, "polygon coordinates");
  const first = rings[0];
  if (first === undefined) return null;
  const full = coordList(first, "polygon ring");
  if (full.length <= MAX_WATERSHED_VERTICES) {
    return { ring: full, total: full.length, truncated: false };
  }
  const ring = full.slice(0, MAX_WATERSHED_VERTICES);
  const head = ring[0];
  if (head) ring.push(head); // keep the ring closed after truncation
  return { ring, total: full.length, truncated: true };
}

/** Cached upstream payload for an analysis call, or the freshly fetched one. */
async function cachedJson(key: string, load: () => Promise<unknown>): Promise<unknown> {
  const hit = getCached(key);
  if (hit !== null) return hit;
  const data = await load();
  setCache(key, data);
  return data;
}

/** Wrap bounded text in the single text-content block the SDK expects. */
function textResult(text: string): { content: [{ type: "text"; text: string }] } {
  return { content: [{ type: "text" as const, text }] };
}

/** Round to `digits` decimals (default 1). */
function round(value: number, digits = 1): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/** Thousands separators, so vertex counts read as 14,413 rather than 14413. */
function comma(value: number): string {
  return value.toLocaleString("en-US");
}

/** min/max/mean over numbers that are already valid; null when there are none. */
function minMaxMean(values: number[]): { min: number; max: number; mean: number } | null {
  if (values.length === 0) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  return { min, max, mean };
}

/** Elevation range text — "elev 210-1841 m (mean 655 m)", or "no valid elevations". */
function elevRange(values: number[]): string {
  const stats = minMaxMean(values);
  if (!stats) return "no valid elevations";
  // A negative min collides with the range dash (-155.7-128.9 reads as one number).
  const span = stats.min < 0 ? `${round(stats.min)} to ${round(stats.max)}` : `${round(stats.min)}-${round(stats.max)}`;
  return `elev ${span} m (mean ${round(stats.mean)} m)`;
}

/** One elevation value with its unit; the NODATA sentinel reads as "nodata". */
function meters(value: number): string {
  return value > NODATA ? `${round(value)} m` : "nodata";
}

/**
 * Evenly spaced indices over `0..n-1`, at most `count` of them, always keeping
 * both ends — the downsample used when a route returns more rows than the cap.
 */
function downsampleIndices(n: number, count: number): number[] {
  if (n <= 0) return [];
  if (n <= count) return Array.from({ length: n }, (_, i) => i);
  const picked = new Set<number>();
  const keep = Math.max(2, count);
  for (let i = 0; i < keep; i++) {
    picked.add(Math.round((i * (n - 1)) / (keep - 1)));
  }
  return [...picked].sort((a, b) => a - b);
}

/** Pick at most `count` items from `items`, evenly spaced, ends included. */
function downsample<T>(items: T[], count: number): T[] {
  return downsampleIndices(items.length, count).map((index) => {
    const item = items[index];
    if (item === undefined) {
      throw new TypeError(`downsample produced index ${index} outside 0..${items.length - 1}`);
    }
    return item;
  });
}

/** One sampled point along a distance-referenced line. */
interface ProfileRow {
  dist: number;
  lat: number;
  lon: number;
  elev: number;
}

/** Cap a row list to the sample cap, downsampled evenly and labelled when it happened. */
function cappedRows(rows: ProfileRow[], cap: number): { rows: ProfileRow[]; note: string } {
  if (rows.length <= cap) {
    return { rows, note: `${rows.length} samples` };
  }
  return {
    rows: downsample(rows, cap),
    note: `${cap} samples (downsampled from ${rows.length})`,
  };
}

/** Fixed-column table of sampled points; NODATA renders as "nodata", not -32768. */
function profileTable(rows: ProfileRow[]): string {
  const lines = ["i  dist_m  lat  lon  elev_m"];
  rows.forEach((row, index) => {
    const elev = row.elev > NODATA ? round(row.elev, 1) : "nodata";
    lines.push(`${index}  ${row.dist}  ${row.lat.toFixed(5)}  ${row.lon.toFixed(5)}  ${elev}`);
  });
  return lines.join("\n");
}

/** Web-Mercator tile range covering a [minLon, minLat, maxLon, maxLat] bbox. */
function tileRangeForBbox(
  zoom: number,
  bbox: readonly [number, number, number, number],
): { x0: number; x1: number; y0: number; y1: number } {
  const n = 2 ** zoom;
  const [minLon, minLat, maxLon, maxLat] = bbox;
  const clampLat = (lat: number) => Math.max(-85.05112878, Math.min(85.05112878, lat));
  const lonToX = (lon: number) => Math.floor(((lon + 180) / 360) * n);
  const latToY = (lat: number) => {
    const rad = (clampLat(lat) * Math.PI) / 180;
    return Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n);
  };
  return {
    x0: Math.max(0, lonToX(minLon)),
    x1: Math.min(n - 1, lonToX(maxLon)),
    y0: Math.max(0, latToY(maxLat)),
    y1: Math.min(n - 1, latToY(minLat)),
  };
}

/**
 * The contours route answers `application/geojson`, which readUpstream returns
 * as text — parse it back into the object the tool reads fields from.
 */
function asGeoJson(payload: unknown): Record<string, unknown> {
  if (typeof payload !== "string") return asRecord(payload);
  try {
    const parsed: unknown = JSON.parse(payload);
    return asRecord(parsed);
  } catch {
    throw new TypeError("upstream returned malformed GeoJSON");
  }
}

const server = new McpServer({
  name: "openzenith",
  // Tracked alongside the api/ package — the MCP server is a thin client over
  // the same REST surface, so its releases ride the platform version.
  version: "0.9.3",
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

// ─── Tool: terrain_profile ───

server.registerTool(
  "terrain_profile",
  {
    description:
      "Compute an elevation profile along the straight line between two points: distance from the start, elevation, and lat/lon per sample, plus total distance and total climb. Returns at most 100 samples, evenly downsampled from the requested count when that is larger.",
    inputSchema: {
      lat1: z.number().min(-90).max(90).describe("Start latitude"),
      lon1: z.number().min(-180).max(180).describe("Start longitude"),
      lat2: z.number().min(-90).max(90).describe("End latitude"),
      lon2: z.number().min(-180).max(180).describe("End longitude"),
      samples: z.number().int().min(2).max(1000).default(400)
        .describe("Samples to compute along the line (2-1000). At most 100 come back."),
      zoom: z.number().int().min(5).max(14).default(10)
        .describe("DEM tile zoom: 10 is ~76 m per cell, 11 ~38 m (full SRTM 30 m detail)"),
    },
  },
  async ({ lat1, lon1, lat2, lon2, samples, zoom }) => {
    const data = asRecord(
      await cachedJson(`profile:${lat1},${lon1},${lat2},${lon2},${samples},${zoom}`, () =>
        apiPost("/profile", { lat1, lon1, lat2, lon2, num_points: samples, zoom }),
      ),
    );
    const rows = asRecords(data.profile, "profile").map((point) => ({
      dist: requiredNum(point, "distance_m"),
      lat: requiredNum(point, "lat"),
      lon: requiredNum(point, "lon"),
      elev: requiredNum(point, "elevation"),
    }));
    if (rows.length === 0) {
      return textResult(`Profile: no samples returned for ${lat1},${lon1} to ${lat2},${lon2}`);
    }

    const valid = rows.map((row) => row.elev).filter((elev) => elev > NODATA);
    const capped = cappedRows(rows, MAX_PROFILE_POINTS);
    const stats = statsOf(data);
    const last = rows[rows.length - 1];
    const totalKm = ((stats ? numField(stats, "total_dist") : null) ?? (last ? last.dist : 0)) / 1000;
    const gain = stats ? numField(stats, "total_gain") : null;

    const summary = [`Profile: ${round(totalKm, 2)} km`, elevRange(valid)];
    if (gain !== null) summary.push(`climb ${round(gain, 0)} m`);
    summary.push(`${capped.note}, zoom ${zoom}`);
    const nodata = rows.length - valid.length;
    if (nodata > 0) summary.push(`${nodata} sample(s) nodata`);

    return textResult(`${summary.join(", ")}\n\n${profileTable(capped.rows)}`);
  },
);

// ─── Tool: elevation_along_path ───

server.registerTool(
  "elevation_along_path",
  {
    description:
      "Compute elevation along an ordered polyline of 2-10 waypoints. The profile route accepts only two endpoints, so each consecutive pair is sampled as its own segment and the segments are stitched into one distance-referenced line. Returns min/max/mean elevation, total distance, and at most 100 evenly downsampled samples.",
    inputSchema: {
      waypoints: z
        .array(
          z.object({
            lat: z.number().min(-90).max(90).describe("Latitude"),
            lon: z.number().min(-180).max(180).describe("Longitude"),
          }),
        )
        .min(2)
        .max(MAX_PATH_WAYPOINTS)
        .describe("Ordered path vertices; consecutive pairs become profile segments"),
      zoom: z.number().int().min(5).max(14).default(10)
        .describe("DEM tile zoom: 10 is ~76 m per cell, 11 ~38 m (full SRTM 30 m detail)"),
    },
  },
  async ({ waypoints, zoom }) => {
    const segments = waypoints.slice(0, -1).map((from, index) => {
      const to = waypoints[index + 1];
      if (!to) {
        throw new TypeError(`waypoint ${index + 1} disappeared while segmenting the path`);
      }
      return { from, to };
    });
    // Per-segment sample count keeps the combined raw set near 200 regardless of
    // how many segments the caller asked for.
    const perSegment = Math.max(2, Math.min(100, Math.ceil(200 / segments.length)));

    const payload = await cachedJson(`path:${JSON.stringify(waypoints)},${zoom}`, async () =>
      Promise.all(
        segments.map((segment, index) =>
          apiPost("/profile", {
            lat1: segment.from.lat,
            lon1: segment.from.lon,
            lat2: segment.to.lat,
            lon2: segment.to.lon,
            num_points: perSegment,
            zoom,
          }).catch((err: unknown) => {
            const reason = err instanceof Error ? err.message : "upstream error";
            throw new Error(`${reason} (segment ${index + 1} of ${segments.length})`);
          }),
        ),
      ),
    );

    // Stitch: each segment's distances restart at 0, so shift by the running
    // total, and drop the first sample of every segment after the first — it is
    // the waypoint the previous segment already recorded.
    const rows: ProfileRow[] = [];
    const valid: number[] = [];
    let offset = 0;
    asArray(payload, "segment results").forEach((entry, segmentIndex) => {
      const points = asRecords(asRecord(entry).profile, "profile");
      points.forEach((point, index) => {
        if (segmentIndex > 0 && index === 0) return;
        const elev = requiredNum(point, "elevation");
        if (elev > NODATA) valid.push(elev);
        rows.push({
          dist: round(offset + requiredNum(point, "distance_m"), 1),
          lat: requiredNum(point, "lat"),
          lon: requiredNum(point, "lon"),
          elev,
        });
      });
      const last = points[points.length - 1];
      if (last) offset += requiredNum(last, "distance_m");
    });

    const capped = cappedRows(rows, MAX_PROFILE_POINTS);
    const summary = [
      `Path: ${waypoints.length} waypoints / ${segments.length} segments`,
      `${round(offset / 1000, 2)} km`,
      elevRange(valid),
      `${capped.note}, zoom ${zoom}`,
    ];
    const nodata = rows.length - valid.length;
    if (nodata > 0) summary.push(`${nodata} sample(s) nodata`);

    return textResult(`${summary.join(", ")}\n\n${profileTable(capped.rows)}`);
  },
);

// ─── Tool: slope_aspect ───

server.registerTool(
  "slope_aspect",
  {
    description:
      "Summarize terrain slope (Horn's method, degrees) and aspect (compass direction of steepest descent) for the grid around a point. Both routes return full grids, so this returns the statistics and the dominant downhill directions instead of the grids — use terrain_profile for sampled values.",
    inputSchema: {
      lat: z.number().min(-90).max(90).describe("Latitude"),
      lon: z.number().min(-180).max(180).describe("Longitude"),
      radius: z.number().int().min(1).max(200).default(50)
        .describe("Grid radius in cells (1-200); the grid is 2*radius+1 per side"),
      zoom: z.number().int().min(5).max(14).default(10)
        .describe("DEM tile zoom: 10 is ~76 m per cell, 11 ~38 m (full SRTM 30 m detail)"),
    },
  },
  async ({ lat, lon, radius, zoom }) => {
    const params = new URLSearchParams({
      lat: lat.toString(),
      lon: lon.toString(),
      radius: radius.toString(),
      zoom: zoom.toString(),
    });
    const data = asRecord(
      await cachedJson(`slope_aspect:${params.toString()}`, async () => {
        const [slope, aspect] = await Promise.all([apiFetch(`/slope?${params}`), apiFetch(`/aspect?${params}`)]);
        return { slope, aspect };
      }),
    );

    const slope = asRecord(data.slope);
    const slopeStats = statsOf(slope);
    const slopeLine = slopeStats
      ? `Slope: mean ${requiredNum(slopeStats, "mean")}°, median ${requiredNum(slopeStats, "median")}°, ` +
        `min ${requiredNum(slopeStats, "min")}° / max ${requiredNum(slopeStats, "max")}°, ` +
        `std ${requiredNum(slopeStats, "std")}°, ${comma(requiredNum(slopeStats, "count"))} valid cells`
      : "Slope: no valid cells (all nodata)";

    const aspect = asRecord(data.aspect);
    // The aspect route reports direction_bins (percentages), not a stats object.
    const aspectStats = isRecord(aspect.direction_bins) ? aspect.direction_bins : null;
    let aspectLine = "Aspect: no valid cells (all nodata)";
    if (aspectStats) {
      const ranked = Object.entries(aspectStats)
        .filter((entry): entry is [string, number] => entry[0] !== "flat" && typeof entry[1] === "number")
        .sort((a, b) => b[1] - a[1]);
      const flat = aspectStats.flat;
      const parts = [`Aspect: dominant ${ranked[0]?.[0] ?? "n/a"} ${ranked[0]?.[1] ?? 0}%`];
      const second = ranked[1];
      if (second) parts.push(`then ${second[0]} ${second[1]}%`);
      if (typeof flat === "number" && flat > 0) parts.push(`flat ${flat}%`);
      parts.push(`${comma(numField(aspect, "valid_cells") ?? 0)} valid cells`);
      aspectLine = parts.join(", ");
    }

    const cellDeg = numField(slope, "cell_size_deg");
    const cellM = cellDeg !== null ? round(cellDeg * 111320, 1) : null;
    const gridLine =
      `Grid: ${2 * radius + 1}x${2 * radius + 1} cells, zoom ${zoom}` +
      `${cellM !== null ? `, ${cellM} m/cell` : ""}, centered ${lat},${lon} (grids omitted)`;

    return textResult([slopeLine, aspectLine, gridLine].join("\n"));
  },
);

// ─── Tool: watershed ───

server.registerTool(
  "watershed",
  {
    description:
      "Delineate the upstream watershed draining to a pour point: area, cell count, elevation range, and the boundary as GeoJSON. Boundary rings are capped at 600 vertices (re-closed after truncation, and noted in the summary).",
    inputSchema: {
      lat: z.number().min(-90).max(90).describe("Pour point latitude"),
      lon: z.number().min(-180).max(180).describe("Pour point longitude"),
      zoom: z.number().int().min(5).max(14).default(10)
        .describe("DEM tile zoom: 10 is ~76 m per cell, 11 ~38 m (full SRTM 30 m detail)"),
      radius_cells: z.number().int().min(10).max(200).default(100)
        .describe("Search radius in cells (10-200) — bounds how far upstream is traced"),
    },
  },
  async ({ lat, lon, zoom, radius_cells }) => {
    const data = asRecord(
      await cachedJson(`watershed:${lat},${lon},${zoom},${radius_cells}`, () =>
        apiPost("/watershed", { lat, lon, zoom, radius_cells }),
      ),
    );

    const geojson = isRecord(data.geojson) ? data.geojson : null;
    const routeFeature = geojson && asArray(geojson.features, "features")[0];
    const ring = isRecord(routeFeature) ? cappedPolygonRing(routeFeature) : null;

    const areaKm2 = numField(data, "area_km2");
    const pixels = numField(data, "pixels");
    const minElev = numField(data, "min_elev");
    const maxElev = numField(data, "max_elev");
    const meanElev = numField(data, "mean_elev");

    const summary = [`Watershed: ${areaKm2 !== null ? `${round(areaKm2, 2)} km²` : "unknown area"}`];
    if (pixels !== null) summary.push(`${comma(pixels)} ${pixels === 1 ? "cell" : "cells"}`);
    // The route hands over min/max/mean directly — report them as given rather
    // than re-deriving a mean over three numbers.
    summary.push(
      minElev !== null && maxElev !== null
        ? `elev ${round(minElev)}-${round(maxElev)} m${meanElev !== null ? ` (mean ${round(meanElev)} m)` : ""}`
        : "no valid elevations",
    );
    summary.push(`zoom ${zoom}, radius ${radius_cells} cells`);
    if (pixels === 0) summary.push("no upstream cells — the pour point is a local sink");

    let boundaryLine = "Boundary: collapsed to a point (no enclosing ring at this zoom/radius)";
    if (ring) {
      boundaryLine = ring.truncated
        ? `Boundary: ${comma(ring.ring.length)} of ${comma(ring.total)} vertices (ring re-closed after truncation)`
        : `Boundary: ${comma(ring.total)} vertices`;
    }

    const properties = {
      area_km2: areaKm2,
      pixels,
      min_elev: typeof data.min_elev === "number" ? data.min_elev : null,
      max_elev: typeof data.max_elev === "number" ? data.max_elev : null,
      pour_point: [lat, lon],
      zoom,
      radius_cells,
    };
    const geometry = ring
      ? { type: "Polygon", coordinates: [ring.ring] }
      : { type: "Point", coordinates: [lon, lat] };
    const out = { type: "FeatureCollection", features: [{ type: "Feature", properties, geometry }] };

    return textResult(`${summary.join(", ")}\n${boundaryLine}\n\n${JSON.stringify(out)}`);
  },
);

// ─── Tool: flow_trace ───

server.registerTool(
  "flow_trace",
  {
    description:
      "Trace the downstream D8 flow path from a point toward the ocean: total distance, elevation drop, and a capped table of the path (lat, lon, elevation, distance). At most 100 of the path's points are returned, evenly downsampled with both ends kept.",
    inputSchema: {
      lat: z.number().min(-90).max(90).describe("Start latitude"),
      lon: z.number().min(-180).max(180).describe("Start longitude"),
      zoom: z.number().int().min(5).max(14).default(10)
        .describe("DEM tile zoom: 10 is ~76 m per cell, 11 ~38 m (full SRTM 30 m detail)"),
      max_steps: z.number().int().min(1).max(10000).default(1000)
        .describe("Maximum downstream steps to walk (1-10000)"),
    },
  },
  async ({ lat, lon, zoom, max_steps }) => {
    const data = asRecord(
      await cachedJson(`trace:${lat},${lon},${zoom},${max_steps}`, () =>
        apiPost("/trace", { lat, lon, zoom, max_steps }),
      ),
    );

    // The trace route emits [lat, lon] pairs, unlike its GeoJSON ([lon, lat]).
    const path = asArray(data.path, "path").map((point) => coord2(point, "path point"));
    const elevations = asArray(data.elevations, "elevations").map((value) => (typeof value === "number" ? value : NODATA));
    const distances = asArray(data.distances, "distances").map((value) => (typeof value === "number" ? value : 0));
    const rows: ProfileRow[] = path.map((point, index) => ({
      dist: distances[index] ?? 0,
      lat: point[0],
      lon: point[1],
      elev: elevations[index] ?? NODATA,
    }));
    if (rows.length === 0) {
      return textResult(`Flow trace: no path returned for ${lat},${lon}`);
    }

    const capped = cappedRows(rows, MAX_TRACE_POINTS);
    const steps = numField(data, "steps") ?? Math.max(0, rows.length - 1);
    const startElev = numField(data, "start_elev") ?? (rows[0] ? rows[0].elev : NODATA);
    const endRow = rows[rows.length - 1];
    const endElev = numField(data, "end_elev") ?? (endRow ? endRow.elev : NODATA);

    const summary = [
      `Flow trace: ${round((numField(data, "total_distance") ?? 0) / 1000, 2)} km downstream over ${comma(steps)} steps`,
      `${meters(startElev)} to ${meters(endElev)} (drop ${round(startElev - endElev, 0)} m)`,
      capped.note,
    ];
    if (steps === 0) summary.push("no downhill step found — the point is a local pit or nodata-bounded");

    return textResult(`${summary.join(", ")}\n\n${profileTable(capped.rows)}`);
  },
);

// ─── Tool: contours ───

server.registerTool(
  "contours",
  {
    description:
      "Generate contour lines (marching squares over the DEM) for the tiles covering a bbox, as GeoJSON. Coverage is tile-aligned, not clipped to the bbox. Output is capped at 50 lines / 4000 vertices and the summary states exactly how much was dropped.",
    inputSchema: {
      bbox: z.array(z.number()).length(4)
        .describe("Bounding box as [minLon, minLat, maxLon, maxLat] in degrees"),
      zoom: z.number().int().min(4).max(14).default(10)
        .describe("Contour zoom (4-14): sets tile size and contour interval (50/200 m at z>=10, 100/500 m at z8-9)"),
    },
  },
  async ({ bbox, zoom }) => {
    const [minLon, minLat, maxLon, maxLat] = bbox;
    if (minLon === undefined || minLat === undefined || maxLon === undefined || maxLat === undefined) {
      throw new Error("bbox must be [minLon, minLat, maxLon, maxLat]");
    }
    if (minLon >= maxLon || minLat >= maxLat) {
      throw new Error("bbox must be [minLon, minLat, maxLon, maxLat] with min < max");
    }
    const box: [number, number, number, number] = [minLon, minLat, maxLon, maxLat];

    const range = tileRangeForBbox(zoom, box);
    const tiles: [number, number][] = [];
    for (let y = range.y0; y <= range.y1; y++) {
      for (let x = range.x0; x <= range.x1; x++) {
        tiles.push([x, y]);
      }
    }
    if (tiles.length > MAX_CONTOUR_TILES) {
      throw new Error(
        `bbox covers ${tiles.length} tiles at zoom ${zoom} (max ${MAX_CONTOUR_TILES}); narrow the bbox or lower zoom`,
      );
    }

    const collections = await Promise.all(
      tiles.map(([x, y]) => apiFetch(`/contours/${zoom}/${x}/${y}`).then(asGeoJson)),
    );
    const features = collections.flatMap((collection) => asArray(collection.features, "features"));
    const totalVertices = features.reduce<number>((sum, feature) => sum + (lineCoords(feature)?.length ?? 0), 0);

    const kept: Record<string, unknown>[] = [];
    const levels: number[] = [];
    let keptVertices = 0;
    let keptMajor = 0;
    for (const feature of features) {
      if (kept.length >= MAX_CONTOUR_LINES || keptVertices >= MAX_CONTOUR_VERTICES) break;
      const coords = lineCoords(feature);
      const props = contourProps(feature);
      if (!coords || !props) continue;
      const slice = coords.slice(0, MAX_CONTOUR_LINE_VERTICES);
      const room = MAX_CONTOUR_VERTICES - keptVertices;
      if (room < 2) break;
      if (slice.length > room) slice.length = room;
      if (slice.length < 2) break;
      keptVertices += slice.length;
      levels.push(props.elevation);
      if (props.major) keptMajor++;
      kept.push({
        type: "Feature",
        properties: { elevation: props.elevation, type: props.major ? "major" : "minor" },
        geometry: { type: "LineString", coordinates: slice },
      });
    }

    const summary = [
      `Contours: ${comma(kept.length)} lines (${comma(keptMajor)} major / ${comma(kept.length - keptMajor)} minor)`,
      `${comma(keptVertices)} vertices`,
      elevRange(levels),
      `zoom ${zoom}, ${comma(tiles.length)} tile(s)`,
    ];
    const droppedLines = features.length - kept.length;
    const droppedVertices = totalVertices - keptVertices;
    if (droppedLines > 0 || droppedVertices > 0) {
      summary.push(
        `kept ${comma(kept.length)} of ${comma(features.length)} lines — ` +
          `dropped ${comma(droppedLines)} lines / ${comma(droppedVertices)} vertices`,
      );
    }

    const out = { type: "FeatureCollection", features: kept };
    return textResult(`${summary.join(", ")}\n\n${JSON.stringify(out)}`);
  },
);

// ─── Tool: elevation_batch ───

server.registerTool(
  "elevation_batch",
  {
    description:
      "Compute elevation for up to 2000 points in one call. Returns min/max/mean over the whole set plus a per-point table capped at `rows` entries (default 100) — the summary always covers every point, the table may not.",
    inputSchema: {
      points: z
        .array(
          z.object({
            lat: z.number().min(-90).max(90).describe("Latitude"),
            lon: z.number().min(-180).max(180).describe("Longitude"),
            id: z.string().optional().describe("Optional label echoed back with the result"),
          }),
        )
        .min(1)
        .max(2000)
        .describe("1-2000 points to sample"),
      rows: z.number().int().min(1).max(200).default(100).describe("Table rows to return (1-200)"),
    },
  },
  async ({ points, rows }) => {
    const load = () => apiPost("/elevation/batch", { points });
    // A 2000-point list makes a multi-kilobyte cache key — cache only the sizes
    // an agent actually repeats, and fetch the big ones fresh.
    const cacheKey = points.length <= 200 ? `batch:${JSON.stringify(points)},${rows}` : null;
    const data = asRecord(cacheKey === null ? await load() : await cachedJson(cacheKey, load));
    const results = asRecords(data.results, "results").map((result) => ({
      lat: requiredNum(result, "lat"),
      lon: requiredNum(result, "lon"),
      elev: numField(result, "elevation"),
      id: typeof result.id === "string" ? result.id : "",
    }));

    const valid = results.map((result) => result.elev).filter((elev): elev is number => elev !== null);
    const shown = results.slice(0, rows);
    const summary = [
      `Batch elevation: ${comma(results.length)} points, ${comma(results.length - valid.length)} nodata`,
      elevRange(valid),
      `showing ${comma(shown.length)} of ${comma(results.length)}`,
    ];

    const lines = [summary.join(", "), "i  lat  lon  elev_m  id"];
    shown.forEach((result, index) => {
      const elev = result.elev === null ? "nodata" : round(result.elev, 1);
      lines.push(`${index}  ${result.lat.toFixed(5)}  ${result.lon.toFixed(5)}  ${elev}  ${result.id}`);
    });
    return textResult(lines.join("\n"));
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
