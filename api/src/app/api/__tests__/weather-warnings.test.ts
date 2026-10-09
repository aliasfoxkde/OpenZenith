import { describe, it, expect, vi, afterEach } from "vitest";
import type { Mock } from "vitest";
import { mockRequest, bodyAs } from "./helpers";

/**
 * NWS alert FeatureCollection as the route trims and returns it — each feature
 * reduced to type/geometry/properties, properties reduced to the short-field
 * allowlist. Only the fields the suites assert on are declared; the
 * pass-through payloads (`{ status }`, `{ error }`) reuse the same type and
 * are compared as whole bodies.
 */
interface WarningsBody {
  features: Array<{
    type?: string;
    geometry?: { type?: string; coordinates?: number[][][] };
    properties: Record<string, unknown>;
  }>;
  status?: string;
  error?: string;
}

describe("Weather Warnings API", () => {
  it("returns alerts from NOAA", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ features: [{ properties: { event: "Tornado Warning" } }] }), { status: 200 }),
    );

    const { GET } = await import("@/app/api/weather/warnings/route");
    const resp = await GET(mockRequest("/api/weather/warnings"));
    expect(resp.status).toBe(200);
    const data = await bodyAs<WarningsBody>(resp);
    expect(data.features).toHaveLength(1);
  });

  it("returns 502 on upstream failure", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("error", { status: 500 }));

    const { GET } = await import("@/app/api/weather/warnings/route");
    const resp = await GET(mockRequest("/api/weather/warnings"));
    expect(resp.status).toBe(502);
  });
});

/**
 * Branch coverage: R2 cache hit/miss, field trimming, the no-features payload
 * shape and both throw shapes out of the try block. edgeGetJson/edgePutJson are
 * the file-level mocks from test-setup.ts, reset per test so a queued `Once`
 * reply cannot leak between tests.
 */
describe("Weather Warnings API — cache, trimming and error branches", () => {
  const r2Json = async () => await import("@/lib/storage/edge-cache");

  afterEach(async () => {
    vi.unstubAllGlobals();
    const { edgeGetJson, edgePutJson } = await r2Json();
    (edgeGetJson as Mock).mockReset().mockResolvedValue(null);
    (edgePutJson as Mock).mockReset().mockResolvedValue(undefined);
  });

  const getRoute = async () => (await import("@/app/api/weather/warnings/route")).GET;

  it("exposes CORS preflight", async () => {
    const { OPTIONS } = await import("@/app/api/weather/warnings/route");
    const resp = await OPTIONS();
    expect(resp.status).toBe(204);
    expect(resp.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(resp.headers.get("Access-Control-Allow-Methods")).toBe("GET, HEAD, OPTIONS, POST");
  });

  it("serves an R2 cache hit without calling the NWS", async () => {
    const cached = {
      type: "FeatureCollection",
      features: [{ type: "Feature", geometry: null, properties: { event: "Flood Warning" } }],
    };
    const { edgeGetJson } = await r2Json();
    (edgeGetJson as Mock).mockResolvedValueOnce(cached);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const resp = await (await getRoute())(mockRequest("/api/weather/warnings"));
    expect(resp.status).toBe(200);
    expect(resp.headers.get("X-Cache")).toBe("HIT");
    expect(resp.headers.get("Cache-Control")).toBe("public, max-age=60");
    expect(resp.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(await resp.json()).toEqual(cached);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("trims verbose alert fields and stores the trimmed payload in R2", async () => {
    const upstream = {
      title: "NWS Alerts Active for {c}",
      updated: "2026-09-23T00:00:00Z",
      features: [
        {
          type: "Feature",
          id: "urn:oid:2.49.0.1.840.0.alert-1",
          geometry: { type: "Polygon", coordinates: [[[-97.5, 35.2]]] },
          properties: {
            id: "urn:oid:2.49.0.1.840.0.alert-1",
            areaDesc: "Custer, Roger Mills",
            senderName: "NWS Norman OK",
            event: "Tornado Warning",
            severity: "Extreme",
            urgency: "Immediate",
            status: "Actual",
            category: "Met",
            headline: "Tornado Warning issued",
            effective: "2026-09-22T12:00:00Z",
            onset: "2026-09-22T12:05:00Z",
            expires: "2026-09-22T13:00:00Z",
            ends: "2026-09-22T13:00:00Z",
            // Verbose fields the route deliberately drops:
            description: "x".repeat(4000),
            instruction: "Take cover now",
            parameters: { NWSheadline: ["TORNADO WARNING"] },
          },
        },
      ],
    };
    const fetchMock = vi.fn(() => new Response(JSON.stringify(upstream), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { edgePutJson } = await r2Json();

    const resp = await (await getRoute())(mockRequest("/api/weather/warnings"));
    expect(resp.status).toBe(200);
    expect(resp.headers.get("X-Cache")).toBe("MISS");
    expect(resp.headers.get("Cache-Control")).toBe("public, max-age=60");
    expect(resp.headers.get("Access-Control-Allow-Origin")).toBe("*");

    const data = await bodyAs<WarningsBody>(resp);
    expect(data.features).toHaveLength(1);
    const feature = data.features[0]!; // bounds: length 1 asserted above
    expect(Object.keys(feature).sort()).toEqual(["geometry", "properties", "type"]);
    expect(feature.type).toBe("Feature");
    expect(feature.geometry).toEqual({ type: "Polygon", coordinates: [[[-97.5, 35.2]]] });

    const props = feature.properties;
    expect(Object.keys(props).sort()).toEqual(
      [
        "areaDesc",
        "category",
        "effective",
        "ends",
        "event",
        "expires",
        "headline",
        "id",
        "onset",
        "senderName",
        "severity",
        "status",
        "urgency",
      ].sort(),
    );
    expect(props.event).toBe("Tornado Warning");
    expect(props.severity).toBe("Extreme");
    expect(props).not.toHaveProperty("description");
    expect(props).not.toHaveProperty("instruction");
    expect(props).not.toHaveProperty("parameters");

    expect(edgePutJson).toHaveBeenCalledTimes(1);
    const [key, stored, ttl] = (edgePutJson as Mock).mock.calls[0] as [string, unknown, number];
    expect(key).toContain("weather-warnings");
    expect(stored).toEqual(data);
    expect(ttl).toBe(120);
  });

  it("passes a payload without a features array through untrimmed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Response(JSON.stringify({ status: "ok" }), { status: 200 })),
    );
    const { edgePutJson } = await r2Json();

    const resp = await (await getRoute())(mockRequest("/api/weather/warnings"));
    expect(resp.status).toBe(200);
    expect(resp.headers.get("X-Cache")).toBe("MISS");
    const data = await bodyAs<WarningsBody>(resp);
    expect(data).toEqual({ status: "ok" });
    expect(edgePutJson).toHaveBeenCalledTimes(1);
    const [, stored] = (edgePutJson as Mock).mock.calls[0] as [string, unknown];
    expect(stored).toEqual({ status: "ok" });
  });

  it("reports the upstream status as a 502 on non-OK responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Response("service unavailable", { status: 503 })),
    );

    const resp = await (await getRoute())(mockRequest("/api/weather/warnings"));
    expect(resp.status).toBe(502);
    expect(resp.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(await resp.json()).toEqual({ error: "Weather API returned 503" });
  });

  it("propagates the thrown message as a 502 when the upstream request rejects", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("nws timeout"))),
    );

    const resp = await (await getRoute())(mockRequest("/api/weather/warnings"));
    expect(resp.status).toBe(502);
    expect(await resp.json()).toEqual({ error: "nws timeout" });
  });

  it("falls back to a generic message as a 502 when the upstream call throws a non-Error", async () => {
    const fetchMock = vi.fn();
    fetchMock.mockRejectedValueOnce("boom");
    vi.stubGlobal("fetch", fetchMock);

    const resp = await (await getRoute())(mockRequest("/api/weather/warnings"));
    expect(resp.status).toBe(502);
    expect(resp.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(await resp.json()).toEqual({ error: "Unknown error" });
  });

  it("resolves a rejecting cache read to the 502 error payload", async () => {
    // Regression: the edgeGetJson await used to sit outside the try block, so
    // a rejecting cache layer escaped the handler as an unhandled 500
    // instead of reaching the route's error contract.
    const { edgeGetJson } = await r2Json();
    (edgeGetJson as Mock).mockRejectedValueOnce(new Error("cache offline"));
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const resp = await (await getRoute())(mockRequest("/api/weather/warnings"));
    expect(resp.status).toBe(502);
    expect(resp.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(await resp.json()).toEqual({ error: "cache offline" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps serving the fresh payload when the R2 write fails", async () => {
    const { edgePutJson } = await r2Json();
    (edgePutJson as Mock).mockRejectedValueOnce(new Error("r2 write failed"));
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Response(JSON.stringify({ features: [] }), { status: 200 })),
    );

    const resp = await (await getRoute())(mockRequest("/api/weather/warnings"));
    expect(resp.status).toBe(200);
    expect(resp.headers.get("X-Cache")).toBe("MISS");
    expect(await resp.json()).toEqual({ features: [] });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(edgePutJson).toHaveBeenCalledTimes(1);
  });
});
