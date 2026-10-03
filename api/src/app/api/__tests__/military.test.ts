import { describe, it, expect, vi, afterEach } from "vitest";
import { mockRequest, bodyAs } from "./helpers";

/** ADSB aircraft record — these suites only ever inspect `hex`. */
type Aircraft = Record<string, unknown>;

/**
 * Military aircraft payload fields these suites assert on. The route forwards
 * the upstream `ac` verbatim, so a non-array upstream body lands as an object,
 * and `total` is null when neither totalCount nor total is present.
 */
interface MilitaryBody {
  ac?: Aircraft[] | Aircraft;
  count?: number;
  total?: number | null;
  error?: string;
}

// Route tests run without an R2 binding, where the real edgeGetJson resolves
// null. The mock mirrors that default but lets individual tests plant a
// cache entry to drive the HIT path.
const r2State = vi.hoisted<{ cached?: unknown }>(() => ({ cached: undefined }));

vi.mock("@/lib/storage/edge-cache", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/storage/edge-cache")>();
  return { ...actual, edgeGetJson: () => Promise.resolve(r2State.cached) };
});

describe("Military API", () => {
  afterEach(() => {
    r2State.cached = undefined;
  });

  it("returns aircraft data from ADSB Exchange", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ ac: [{ hex: "ABC123" }], total: 1 }), { status: 200 }),
    );

    const { GET } = await import("@/app/api/military/route");
    const resp = await GET(mockRequest("/api/military?lat=30&lon=-90&dist=100"));
    expect(resp.status).toBe(200);
    const data = await bodyAs<MilitaryBody>(resp);
    expect(data.ac).toHaveLength(1);
  });

  it("clamps dist to max 1000", async () => {
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ ac: [] }), { status: 200 }));

    const { GET } = await import("@/app/api/military/route");
    await GET(mockRequest("/api/military?dist=5000"));

    const calledUrl = spy.mock.calls[0][0] as string;
    expect(calledUrl).toContain("/dist/1000");
  });

  it("handles 402/403 gracefully", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("Payment Required", { status: 402 }));

    const { GET } = await import("@/app/api/military/route");
    const resp = await GET(mockRequest("/api/military"));
    expect(resp.status).toBe(200);
    const data = await bodyAs<MilitaryBody>(resp);
    expect(data.error).toContain("API key");
  });

  it("exposes CORS preflight OPTIONS", async () => {
    const { OPTIONS } = await import("@/app/api/military/route");
    const resp = await OPTIONS();
    expect(resp.status).toBe(204);
    expect(resp.headers.get("access-control-allow-origin")).toBe("*");
    expect(resp.headers.get("access-control-allow-methods")).toContain("GET");
  });

  it("serves an R2 cache hit with X-Cache HIT and skips upstream", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    r2State.cached = { ac: [{ hex: "CACHED1" }], count: 1, total: 1 };

    try {
      const { GET } = await import("@/app/api/military/route");
      const resp = await GET(mockRequest("/api/military?lat=30&lon=-90&dist=500"));
      expect(resp.status).toBe(200);
      expect(resp.headers.get("X-Cache")).toBe("HIT");
      expect(resp.headers.get("cache-control")).toBe("public, max-age=30");

      const data = await bodyAs<MilitaryBody>(resp);
      expect(data.ac).toEqual([{ hex: "CACHED1" }]);
      expect(data.count).toBe(1);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      r2State.cached = undefined;
    }
  });

  it("defaults missing coordinates to the central-US viewport", async () => {
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ ac: [] }), { status: 200 }));

    const { GET } = await import("@/app/api/military/route");
    const resp = await GET(mockRequest("/api/military"));
    expect(resp.status).toBe(200);
    expect(spy.mock.calls[0][0] as string).toBe("https://adsbexchange.com/api/aircraft/v2/lat/30/lon/-90/dist/500");
  });

  it("falls back to defaults for out-of-range, non-numeric and zero params", async () => {
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ ac: [] }), { status: 200 }));

    const { GET } = await import("@/app/api/military/route");

    // lat > max, lon < min, dist unparseable.
    await GET(mockRequest("/api/military?lat=200&lon=-999&dist=abc"));
    expect(spy.mock.calls[0][0] as string).toBe("https://adsbexchange.com/api/aircraft/v2/lat/30/lon/-90/dist/500");

    // lat < min, lon > max, dist=0 (0 is falsy, so it falls back to 500).
    await GET(mockRequest("/api/military?lat=-91&lon=181&dist=0"));
    expect(spy.mock.calls[1][0] as string).toBe("https://adsbexchange.com/api/aircraft/v2/lat/30/lon/-90/dist/500");

    // Non-numeric latitude, in-range longitude kept as-is.
    await GET(mockRequest("/api/military?lat=abc&lon=10&dist=250"));
    expect(spy.mock.calls[2][0] as string).toBe("https://adsbexchange.com/api/aircraft/v2/lat/30/lon/10/dist/250");

    // Negative radii fall back to the default too — they used to be
    // forwarded verbatim, producing a nonsensical negative search radius.
    await GET(mockRequest("/api/military?dist=-50"));
    expect(spy.mock.calls[3][0] as string).toBe("https://adsbexchange.com/api/aircraft/v2/lat/30/lon/-90/dist/500");
  });

  it("maps 403 and 429 to dedicated messages and other statuses to the generic one", async () => {
    const spy = vi.spyOn(globalThis, "fetch");

    const { GET } = await import("@/app/api/military/route");

    spy.mockResolvedValueOnce(new Response("forbidden", { status: 403 }));
    const forbidden = await bodyAs<MilitaryBody>(await GET(mockRequest("/api/military")));
    expect(forbidden.error).toContain("requires API key");
    expect(forbidden.ac).toEqual([]);
    expect(forbidden.count).toBe(0);

    spy.mockResolvedValueOnce(new Response("slow down", { status: 429 }));
    const limited = await bodyAs<MilitaryBody>(await GET(mockRequest("/api/military")));
    expect(limited.error).toContain("rate limit");

    spy.mockResolvedValueOnce(new Response("boom", { status: 500 }));
    const serverError = await bodyAs<MilitaryBody>(await GET(mockRequest("/api/military")));
    expect(serverError.error).toBe("ADSB Exchange returned 500");
    expect(serverError.count).toBe(0);
  });

  it("accepts aircraft, results and empty payloads alike", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    const { GET } = await import("@/app/api/military/route");

    spy.mockResolvedValueOnce(new Response(JSON.stringify({ aircraft: [{ hex: "B1" }] }), { status: 200 }));
    const viaAircraft = await bodyAs<MilitaryBody>(await GET(mockRequest("/api/military")));
    expect(viaAircraft.ac).toEqual([{ hex: "B1" }]);
    expect(viaAircraft.count).toBe(1);

    spy.mockResolvedValueOnce(new Response(JSON.stringify({ results: [{ hex: "R1" }, { hex: "R2" }] }), { status: 200 }));
    const viaResults = await bodyAs<MilitaryBody>(await GET(mockRequest("/api/military")));
    expect(viaResults.count).toBe(2);

    spy.mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 }));
    const empty = await bodyAs<MilitaryBody>(await GET(mockRequest("/api/military")));
    expect(empty.ac).toEqual([]);
    expect(empty.count).toBe(0);
    expect(empty.total).toBeNull();
  });

  it("counts 0 when the aircraft payload is not an array", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ ac: { hex: "NOT-AN-ARRAY" }, total: 3 }), { status: 200 }),
    );

    const { GET } = await import("@/app/api/military/route");
    const data = await bodyAs<MilitaryBody>(await GET(mockRequest("/api/military")));
    expect(data.ac).toEqual({ hex: "NOT-AN-ARRAY" });
    expect(data.count).toBe(0);
    expect(data.total).toBe(3);
  });

  it("prefers totalCount over total and reports null when neither is present", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    const { GET } = await import("@/app/api/military/route");

    spy.mockResolvedValueOnce(new Response(JSON.stringify({ ac: [], totalCount: 12, total: 9 }), { status: 200 }));
    const withTotalCount = await bodyAs<MilitaryBody>(await GET(mockRequest("/api/military")));
    expect(withTotalCount.total).toBe(12);

    spy.mockResolvedValueOnce(new Response(JSON.stringify({ ac: [] }), { status: 200 }));
    const withNeither = await bodyAs<MilitaryBody>(await GET(mockRequest("/api/military")));
    expect(withNeither.total).toBeNull();
  });

  it("returns 200 with the thrown message when the upstream request rejects", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("adsb unreachable"));

    const { GET } = await import("@/app/api/military/route");
    const resp = await GET(mockRequest("/api/military"));
    expect(resp.status).toBe(200);

    const data = await bodyAs<MilitaryBody>(resp);
    expect(data.error).toBe("adsb unreachable");
    expect(data.ac).toEqual([]);
    expect(data.count).toBe(0);
  });

  it("falls back to a generic message when the rejection is not an Error", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce("timed out");

    const { GET } = await import("@/app/api/military/route");
    const data = await bodyAs<MilitaryBody>(await GET(mockRequest("/api/military")));
    expect(data.error).toBe("Military flight fetch failed");
    expect(data.count).toBe(0);
  });

  it("reads a null upstream body as an empty aircraft list", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("null", { status: 200 }));

    const { GET } = await import("@/app/api/military/route");
    const data = await bodyAs<MilitaryBody>(await GET(mockRequest("/api/military")));
    expect(data.ac).toEqual([]);
    expect(data.count).toBe(0);
    expect(data.total).toBeNull();
  });
});
