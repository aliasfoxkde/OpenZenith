/**
 * Contract tests for the OpenZenith MCP server.
 *
 * The real server is exercised end-to-end over an in-memory transport pair:
 * tools are listed and called exactly as a client would, with global fetch
 * mocked so the assertions pin the wire contract — endpoint paths and query
 * parameters must match what the OpenZenith API actually accepts (see
 * api/src/app/api/<route>/route.ts and the generated OpenAPI spec).
 */
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { server, clearCache } from "./index.js";

const BASE = "https://openzenith.pages.dev/api";

async function connectClient(): Promise<Client> {
  const client = new Client({ name: "contract-test", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return client;
}

/** Extract the URL the mocked fetch saw, failing loudly if it was not called. */
function calledUrl(fetchMock: Mock<typeof fetch>): string {
  expect(fetchMock).toHaveBeenCalled();
  const input = fetchMock.mock.calls[0]?.[0];
  if (typeof input !== "string") {
    throw new Error("expected fetch to have been called with a URL string");
  }
  return input;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * Answer every call with a fresh Response — a Response body is single-use, so a
 * tool that makes several upstream calls needs a new one per call.
 */
function jsonEachCall(fetchMock: Mock<typeof fetch>, build: () => unknown): void {
  fetchMock.mockImplementation(() => Promise.resolve(jsonResponse(build())));
}

/** Extract the JSON body the mocked fetch saw on a POST, failing loudly otherwise. */
function calledBody(fetchMock: Mock<typeof fetch>, index = 0): Record<string, unknown> {
  expect(fetchMock).toHaveBeenCalled();
  const init = fetchMock.mock.calls[index]?.[1];
  if (!init || typeof init.body !== "string") {
    throw new Error(`expected fetch call ${index} to carry a string body`);
  }
  const parsed: unknown = JSON.parse(init.body);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("expected the request body to parse to a JSON object");
  }
  return parsed as Record<string, unknown>;
}

/** The `index`-th line of a tool output, or a guaranteed failure. */
function line(text: string, index: number): string {
  const value = text.split("\n")[index];
  if (value === undefined) {
    throw new Error(`output has no line ${index}: ${JSON.stringify(text.slice(0, 300))}`);
  }
  return value;
}

/**
 * A /profile payload with `n` synthetic samples climbing 1 m per step across
 * 42 km — enough to exercise the downsample path and the summary arithmetic.
 */
function profilePayload(n: number, elevation: (index: number) => number = (index) => 100 + index): unknown {
  return {
    start: { lat: 40, lon: -74 },
    end: { lat: 41, lon: -73 },
    num_points: n,
    zoom: 10,
    stats: { min: 100, max: 100 + n - 1, total_gain: 1200, total_dist: 42000 },
    profile: Array.from({ length: n }, (_, i) => ({
      distance_m: Math.round(((42000 * i) / (n - 1)) * 10) / 10,
      elevation: elevation(i),
      lat: 40 + i / (n - 1),
      lon: -74 + i / (n - 1),
    })),
  };
}

describe("openzenith mcp server", () => {
  let client: Client;
  let fetchMock: Mock<typeof fetch>;

  /** Call a tool and return its first text block, validated against the SDK's own schema. */
  async function callText(name: string, args: Record<string, unknown>): Promise<string> {
    const result = CallToolResultSchema.parse(await client.callTool({ name, arguments: args }));
    const block = result.content[0];
    if (!block || block.type !== "text") {
      throw new Error(`expected a text content block from ${name}, saw ${JSON.stringify(result.content)}`);
    }
    return block.text;
  }

  beforeEach(async () => {
    clearCache();
    client = await connectClient();
    fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await client.close();
  });

  it("exposes the shipped tool set", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      [
        "api_docs",
        "bathymetry",
        "contours",
        "elevation",
        "elevation_along_path",
        "elevation_batch",
        "flow_trace",
        "geocode",
        "query",
        "reverse_geocode",
        "slope_aspect",
        "terrain_profile",
        "tides",
        "watershed",
        "weather",
      ].sort(),
    );
  });

  it("query calls /query with the declared include values", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ elevation: 10 }));
    await client.callTool({ name: "query", arguments: { lat: 40.7, lon: -74.0 } });

    const url = new URL(calledUrl(fetchMock));
    expect(url.origin + url.pathname).toBe(`${BASE}/query`);
    expect(url.searchParams.get("lat")).toBe("40.7");
    expect(url.searchParams.get("lon")).toBe("-74");
    expect(url.searchParams.get("include")).toBe("elevation");
  });

  it("elevation sends only lat/lon — no dead dataset parameter", async () => {
    // The API reads just lat and lon; the removed `dataset` parameter must
    // stay gone so the tool contract matches the server contract.
    fetchMock.mockResolvedValue(jsonResponse({ elevation: 8848 }));
    await client.callTool({ name: "elevation", arguments: { lat: 27.9, lon: 86.9 } });

    const url = new URL(calledUrl(fetchMock));
    expect(url.origin + url.pathname).toBe(`${BASE}/elevation`);
    expect([...url.searchParams.keys()].sort()).toEqual(["lat", "lon"]);
  });

  it("geocode sends query and limit", async () => {
    fetchMock.mockResolvedValue(jsonResponse([]));
    await client.callTool({
      name: "geocode",
      arguments: { query: "Lhotse", limit: 2 },
    });

    const url = new URL(calledUrl(fetchMock));
    expect(url.origin + url.pathname).toBe(`${BASE}/geocode`);
    expect(url.searchParams.get("query")).toBe("Lhotse");
    expect(url.searchParams.get("limit")).toBe("2");
  });

  it("reverse_geocode sends lat/lon/zoom", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ display_name: "x" }));
    await client.callTool({
      name: "reverse_geocode",
      arguments: { lat: 40.7, lon: -74.0, zoom: 14 },
    });

    const url = new URL(calledUrl(fetchMock));
    expect(url.origin + url.pathname).toBe(`${BASE}/reverse-geocode`);
    expect(url.searchParams.get("zoom")).toBe("14");
  });

  it("caches repeated identical queries within the TTL", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ elevation: 10 }));
    await client.callTool({ name: "elevation", arguments: { lat: 1, lon: 2 } });
    await client.callTool({ name: "elevation", arguments: { lat: 1, lon: 2 } });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // A different location is a different cache key.
    await client.callTool({ name: "elevation", arguments: { lat: 3, lon: 4 } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("surfaces API failures as tool errors", async () => {
    fetchMock.mockResolvedValue(new Response("boom", { status: 500 }));
    const result = await client.callTool({
      name: "elevation",
      arguments: { lat: 1, lon: 2 },
    });
    expect(result.isError).toBe(true);
  });

  it("api_docs passes the markdown through as text", async () => {
    // Exact-equality on a body with a tail marker: the pre-fix behavior
    // (JSON.parsing a text/markdown response) surfaced a SyntaxError whose
    // message embeds only a truncated body prefix, so a toContain() on the
    // head of the body passed even while the tool was broken in production.
    const body = "# OpenZenith API\n\nREGRESSION-TAIL-9f2e7c";
    fetchMock.mockResolvedValue(new Response(body, { status: 200 }));
    // Client#callTool's result type unions the backwards-compatibility variant,
    // which degrades `content` to `unknown`. Re-validate against the SDK's own
    // schema to recover the typed shape instead of asserting it.
    const result = CallToolResultSchema.parse(await client.callTool({ name: "api_docs", arguments: {} }));
    const block = result.content[0];
    if (!block || block.type !== "text") {
      throw new Error(`expected a text content block, saw ${JSON.stringify(block)}`);
    }
    expect(block.text).toBe(body);
  });

  // ─── Terrain analysis: bounded output ───

  it("terrain_profile downsamples a 400-sample transect to 100 and says so", async () => {
    fetchMock.mockResolvedValue(jsonResponse(profilePayload(400)));
    const text = await callText("terrain_profile", {
      lat1: 40,
      lon1: -74,
      lat2: 41,
      lon2: -73,
      samples: 400,
      zoom: 10,
    });

    const url = new URL(calledUrl(fetchMock));
    expect(url.origin + url.pathname).toBe(`${BASE}/profile`);
    const init = fetchMock.mock.calls[0]?.[1];
    expect(init?.method).toBe("POST");
    expect(calledBody(fetchMock)).toEqual({
      lat1: 40,
      lon1: -74,
      lat2: 41,
      lon2: -73,
      num_points: 400,
      zoom: 10,
    });

    const lines = text.split("\n");
    expect(lines).toHaveLength(103); // summary, blank, header, 100 rows
    expect(line(text, 0)).toBe(
      "Profile: 42 km, elev 100-499 m (mean 299.5 m), climb 1200 m, " +
        "100 samples (downsampled from 400), zoom 10",
    );
    expect(line(text, 2)).toBe("i  dist_m  lat  lon  elev_m");
    expect(line(text, 3)).toContain("0  0  40.00000  -74.00000  100");
    expect(line(text, 102)).toContain("42000");
    expect(line(text, 102)).toContain("499");
    expect(text).not.toContain("http"); // never a URL in bounded output
  });

  it("terrain_profile reports nodata samples instead of -32768", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(profilePayload(3, (index) => [-32768, -50, 80][index] ?? 0)),
    );
    const text = await callText("terrain_profile", { lat1: 40, lon1: -74, lat2: 41, lon2: -73 });

    expect(line(text, 0)).toContain("1 sample(s) nodata");
    expect(line(text, 0)).toContain("elev -50 to 80 m"); // negative min reads as a range, not a dash
    expect(line(text, 3)).toContain("nodata");
    expect(text).not.toContain("-32768");
  });

  it("elevation_along_path samples one segment per consecutive pair and stitches them", async () => {
    // Two upstream calls: a shared Response body is single-use, so mint a new one per call.
    jsonEachCall(fetchMock, () => profilePayload(100));
    const text = await callText("elevation_along_path", {
      waypoints: [
        { lat: 40, lon: -74 },
        { lat: 40.5, lon: -74.5 },
        { lat: 41, lon: -75 },
      ],
      zoom: 10,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(new URL(calledUrl(fetchMock)).pathname).toBe("/api/profile");
    expect(calledBody(fetchMock, 1)).toEqual({
      lat1: 40.5,
      lon1: -74.5,
      lat2: 41,
      lon2: -75,
      num_points: 100,
      zoom: 10,
    });

    const lines = text.split("\n");
    expect(lines).toHaveLength(103);
    // Each segment spans 42 km and the shared waypoint is not double-counted.
    expect(line(text, 0)).toBe(
      "Path: 3 waypoints / 2 segments, 84 km, elev 100-199 m (mean 149.7 m), " +
        "100 samples (downsampled from 199), zoom 10",
    );
  });

  it("slope_aspect summarizes both routes without dumping their grids", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          center: { lat: 40, lon: -74 },
          bounds: {},
          radius_cells: 50,
          zoom: 10,
          cell_size_deg: 0.000687,
          stats: { mean: 12.4, median: 9.1, min: 0, max: 46.2, std: 8.7, count: 2401 },
          grid: [[1, 2]],
          units: "degrees",
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          center: { lat: 40, lon: -74 },
          bounds: {},
          radius_cells: 50,
          zoom: 10,
          cell_size_deg: 0.000687,
          direction_bins: { N: 1, NE: 2, E: 3, SE: 4, S: 34.2, SW: 21, W: 5, NW: 2, flat: 3.1 },
          valid_cells: 2401,
          grid: [[1, 2]],
          units: "degrees compass",
        }),
      );

    const text = await callText("slope_aspect", { lat: 40, lon: -74 });

    const requestedPaths = fetchMock.mock.calls.map((call) => {
      const input = call[0];
      if (typeof input !== "string") throw new Error("expected fetch to be called with a URL string");
      return new URL(input).pathname;
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(requestedPaths).toEqual(["/api/slope", "/api/aspect"]);
    const slopeUrl = fetchMock.mock.calls[0]?.[0];
    if (typeof slopeUrl !== "string") throw new Error("expected the slope call to carry a URL string");
    expect(new URL(slopeUrl).searchParams.get("radius")).toBe("50");

    expect(line(text, 0)).toBe(
      "Slope: mean 12.4°, median 9.1°, min 0° / max 46.2°, std 8.7°, 2,401 valid cells",
    );
    expect(line(text, 1)).toBe("Aspect: dominant S 34.2%, then SW 21%, flat 3.1%, 2,401 valid cells");
    expect(line(text, 2)).toBe("Grid: 101x101 cells, zoom 10, 76.5 m/cell, centered 40,-74 (grids omitted)");
    expect(text).not.toContain("[[1,2]]"); // the grid payloads never reach the model
  });

  it("watershed delineates upstream area and truncates the boundary ring", async () => {
    const first: [number, number] = [-74, 40];
    const ring: [number, number][] = [
      ...Array.from({ length: 700 }, (_, i): [number, number] => [-74 + i * 0.001, 40 + i * 0.001]),
      first,
    ];
    fetchMock.mockResolvedValue(
      jsonResponse({
        center: [40, -74],
        area_km2: 12.34,
        pixels: 4412,
        min_elev: 210,
        max_elev: 1841,
        mean_elev: 655,
        zoom: 10,
        cell_size_deg: 0.000687,
        boundary: [],
        geojson: {
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              properties: { area_km2: 12.34 },
              geometry: { type: "Polygon", coordinates: [ring] },
            },
          ],
        },
      }),
    );

    const text = await callText("watershed", { lat: 40, lon: -74 });

    expect(new URL(calledUrl(fetchMock)).pathname).toBe("/api/watershed");
    expect(calledBody(fetchMock)).toEqual({ lat: 40, lon: -74, zoom: 10, radius_cells: 100 });
    expect(line(text, 0)).toBe(
      "Watershed: 12.34 km², 4,412 cells, elev 210-1841 m (mean 655 m), zoom 10, radius 100 cells",
    );
    expect(line(text, 1)).toBe("Boundary: 601 of 701 vertices (ring re-closed after truncation)");

    const out = JSON.parse(line(text, 3)) as {
      features: { properties: Record<string, unknown>; geometry: { coordinates: number[][][] } }[];
    };
    expect(out.features).toHaveLength(1);
    const outRing = out.features[0]?.geometry.coordinates[0] ?? [];
    expect(outRing).toHaveLength(601);
    expect(outRing[600]).toEqual(outRing[0]); // ring stays closed
    expect(out.features[0]?.properties).toMatchObject({ area_km2: 12.34, pour_point: [40, -74] });
  });

  it("flow_trace caps the downstream path and reports distance and drop", async () => {
    const n = 215;
    fetchMock.mockResolvedValue(
      jsonResponse({
        start: [40, -74],
        end: [39.9, -74.1],
        start_elev: 1200,
        end_elev: 12,
        total_distance: 8400,
        steps: 214,
        path: Array.from({ length: n }, (_, i): [number, number] => [40 - i * 0.0005, -74 - i * 0.0005]),
        elevations: Array.from({ length: n }, (_, i) => 1200 - i * 5.53),
        distances: Array.from({ length: n }, (_, i) => i * 39.07),
      }),
    );

    const text = await callText("flow_trace", { lat: 40, lon: -74 });

    expect(new URL(calledUrl(fetchMock)).pathname).toBe("/api/trace");
    expect(calledBody(fetchMock)).toEqual({ lat: 40, lon: -74, zoom: 10, max_steps: 1000 });
    const lines = text.split("\n");
    expect(lines).toHaveLength(103);
    expect(line(text, 0)).toBe(
      "Flow trace: 8.4 km downstream over 214 steps, 1200 m to 12 m (drop 1188 m), " +
        "100 samples (downsampled from 215)",
    );
    expect(line(text, 102)).toContain("8360.98"); // last kept point, not the first
    expect(line(text, 102)).toContain("16.6");
  });

  it("contours fetches the covering tile and caps at the vertex budget", async () => {
    const contour = (elevation: number, type: string, vertices: number) => ({
      type: "Feature",
      properties: { elevation, type },
      geometry: {
        type: "LineString",
        coordinates: Array.from({ length: vertices }, (_, i) => [-74 + i * 0.0001, 40]),
      },
    });
    fetchMock.mockResolvedValue(
      jsonResponse({
        type: "FeatureCollection",
        // 60 lines x 100 vertices = 6,000 vertices: the 4,000-vertex budget
        // truncates after 40 lines, so the summary must say so.
        features: Array.from({ length: 60 }, (_, i) => contour(100 + i * 50, i % 5 === 0 ? "major" : "minor", 100)),
      }),
    );

    const text = await callText("contours", { bbox: [-74.1, 39.95, -73.9, 40.05], zoom: 10 });

    expect(new URL(calledUrl(fetchMock)).pathname).toBe("/api/contours/10/301/387");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(line(text, 0)).toBe(
      "Contours: 40 lines (8 major / 32 minor), 4,000 vertices, elev 100-2050 m (mean 1075 m), " +
        "zoom 10, 1 tile(s), kept 40 of 60 lines — dropped 20 lines / 2,000 vertices",
    );
    const out = JSON.parse(line(text, 2)) as { features: { geometry: { coordinates: unknown[][] } }[] };
    expect(out.features).toHaveLength(40);
    expect(out.features[0]?.geometry.coordinates).toHaveLength(100);
  });

  it("contours caps the number of returned lines", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        type: "FeatureCollection",
        // 55 lines x 10 vertices = 550 vertices: under the vertex budget, so the
        // 50-line cap is what truncates here.
        features: Array.from({ length: 55 }, (_, i) => ({
          type: "Feature",
          properties: { elevation: 100 + i * 50, type: i % 5 === 0 ? "major" : "minor" },
          geometry: { type: "LineString", coordinates: Array.from({ length: 10 }, (_, j) => [-74 + j * 0.0001, 40]) },
        })),
      }),
    );

    // Same tile, different bbox — a different cache key, so both calls hit the wire.
    const text = await callText("contours", { bbox: [-74.09, 39.96, -73.91, 40.04], zoom: 10 });

    expect(new URL(calledUrl(fetchMock)).pathname).toBe("/api/contours/10/301/387");
    expect(line(text, 0)).toBe(
      "Contours: 50 lines (10 major / 40 minor), 500 vertices, elev 100-2550 m (mean 1325 m), " +
        "zoom 10, 1 tile(s), kept 50 of 55 lines — dropped 5 lines / 50 vertices",
    );
  });

  it("contours refuses a bbox that would need more than four tiles", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ type: "FeatureCollection", features: [] }));
    const result = CallToolResultSchema.parse(
      await client.callTool({ name: "contours", arguments: { bbox: [-74.5, 39.5, -73.5, 40.5], zoom: 10 } }),
    );

    expect(result.isError).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
    const block = result.content[0];
    if (!block || block.type !== "text") throw new Error("expected a text content block");
    expect(block.text).toBe("bbox covers 15 tiles at zoom 10 (max 4); narrow the bbox or lower zoom");
  });

  it("elevation_batch summarizes every point but caps the table", async () => {
    const points = Array.from({ length: 150 }, (_, i) => ({ lat: 40 + i * 0.001, lon: -74, id: `p${i}` }));
    fetchMock.mockResolvedValue(
      jsonResponse({
        results: points.map((point, i) => ({
          id: point.id,
          lat: point.lat,
          lon: point.lon,
          elevation: i % 50 === 0 ? null : 10 + i,
        })),
      }),
    );

    const text = await callText("elevation_batch", { points });

    expect(new URL(calledUrl(fetchMock)).pathname).toBe("/api/elevation/batch");
    expect(calledBody(fetchMock)).toEqual({ points });
    const lines = text.split("\n");
    expect(lines).toHaveLength(102); // summary, header, 100 rows
    expect(line(text, 0)).toBe("Batch elevation: 150 points, 3 nodata, elev 11-159 m (mean 85 m), showing 100 of 150");
    expect(line(text, 2)).toBe("0  40.00000  -74.00000  nodata  p0");
    expect(line(text, 3)).toBe("1  40.00100  -74.00000  11  p1");
  });

  it("rejects invalid terrain inputs before any upstream call", async () => {
    fetchMock.mockResolvedValue(jsonResponse({}));

    const badLat = await client.callTool({
      name: "terrain_profile",
      arguments: { lat1: 95, lon1: -74, lat2: 41, lon2: -73 },
    });
    expect(badLat.isError).toBe(true);

    const oneWaypoint = await client.callTool({
      name: "elevation_along_path",
      arguments: { waypoints: [{ lat: 40, lon: -74 }] },
    });
    expect(oneWaypoint.isError).toBe(true);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("surfaces a 5xx as a single-line error with no URL and no body", async () => {
    fetchMock.mockResolvedValue(new Response("upstream exploded badly", { status: 502 }));
    const result = CallToolResultSchema.parse(
      await client.callTool({
        name: "terrain_profile",
        arguments: { lat1: 40, lon1: -74, lat2: 41, lon2: -73 },
      }),
    );

    expect(result.isError).toBe(true);
    const block = result.content[0];
    if (!block || block.type !== "text") throw new Error("expected a text content block");
    expect(block.text).toBe("upstream returned 502");
  });

  it("keeps a 4xx route reason on one line", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: "No elevation data\nat starting point" }, 400));
    const text = await callText("watershed", { lat: 40, lon: -74 });

    expect(text).toBe("upstream returned 400: No elevation data at starting point");
  });
});
