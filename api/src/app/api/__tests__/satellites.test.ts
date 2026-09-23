import { describe, it, expect, vi } from "vitest";
import { mockRequest } from "./helpers";

// Route tests run without an R2 binding, where the real r2GetJson resolves
// null. The mock mirrors that default but lets individual tests plant a
// cache entry to drive the HIT path.
const r2State = vi.hoisted<{ cached?: unknown }>(() => ({ cached: undefined }));

vi.mock("@/lib/storage/r2-json-cache", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/storage/r2-json-cache")>();
  return { ...actual, r2GetJson: () => Promise.resolve(r2State.cached) };
});

describe("Satellites API", () => {
  it("returns satellite data from Celestrak", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify([{ name: "ISS (ZARYA)", norad_cat_id: 25544 }]), { status: 200 }),
    );

    const { GET } = await import("@/app/api/satellites/route");
    const resp = await GET(mockRequest("/api/satellites?group=active"));
    expect(resp.status).toBe(200);
    const data = await resp.json();
    expect(data.satellites).toBeDefined();
    expect(data.satellites[0].name).toBe("ISS (ZARYA)");
  });

  it("rejects invalid group", async () => {
    const { GET } = await import("@/app/api/satellites/route");
    const resp = await GET(mockRequest("/api/satellites?group=invalid_group"));
    expect(resp.status).toBe(400);
    const data = await resp.json();
    expect(data.error).toContain("Invalid group");
  });

  it("defaults to stations group", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }));

    const { GET } = await import("@/app/api/satellites/route");
    await GET(mockRequest("/api/satellites"));

    const calledUrl = spy.mock.calls[0][0] as string;
    expect(calledUrl).toContain("GROUP=stations");
  });

  it("exposes CORS preflight", async () => {
    const { OPTIONS } = await import("@/app/api/satellites/route");
    const resp = OPTIONS();
    expect(resp.status).toBe(204);
    expect(resp.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("serves an R2 cache hit with X-Cache HIT and skips upstream", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    r2State.cached = { count: 1, truncated: false, satellites: [{ name: "ISS (ZARYA)" }] };

    try {
      const { GET } = await import("@/app/api/satellites/route");
      const resp = await GET(mockRequest("/api/satellites?group=stations"));
      expect(resp.status).toBe(200);
      expect(resp.headers.get("X-Cache")).toBe("HIT");
      expect(resp.headers.get("Cache-Control")).toBe("public, max-age=600");
      const data = await resp.json();
      expect(data.satellites).toHaveLength(1);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      r2State.cached = undefined;
    }
  });

  it("returns an empty payload naming the status when Celestrak fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("gone", { status: 503 }));

    const { GET } = await import("@/app/api/satellites/route");
    const resp = await GET(mockRequest("/api/satellites"));
    expect(resp.status).toBe(200);
    const data = await resp.json();
    expect(data).toEqual({ count: 0, truncated: false, satellites: [], error: "Celestrak returned 503" });
  });

  it("returns an empty payload when Celestrak returns a non-JSON body", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("<html>rate limited</html>", { status: 200 }));

    const { GET } = await import("@/app/api/satellites/route");
    const resp = await GET(mockRequest("/api/satellites"));
    const data = await resp.json();
    expect(data).toEqual({
      count: 0,
      truncated: false,
      satellites: [],
      error: "Celestrak returned invalid response",
    });
  });

  it("surfaces Celestrak's plain-text rejection wrapped in a JSON string", async () => {
    const message = "No group found: Invalid query";
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify(message), { status: 200 }));

    const { GET } = await import("@/app/api/satellites/route");
    // The group itself must be valid, or the route 400s before fetching.
    const resp = await GET(mockRequest("/api/satellites?group=stations"));
    const data = await resp.json();
    expect(data).toEqual({ count: 0, truncated: false, satellites: [], error: message });
  });

  it("truncates oversized groups to the requested limit", async () => {
    const sats = Array.from({ length: 3 }, (_, i) => ({ name: `SAT-${i}` }));
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify(sats), { status: 200 }));

    const { GET } = await import("@/app/api/satellites/route");
    const resp = await GET(mockRequest("/api/satellites?group=starlink&limit=2"));
    expect(resp.status).toBe(200);
    expect(resp.headers.get("X-Cache")).toBe("MISS");
    const data = await resp.json();
    expect(data.count).toBe(3);
    expect(data.truncated).toBe(true);
    expect(data.limit).toBe(2);
    expect(data.satellites).toEqual([{ name: "SAT-0" }, { name: "SAT-1" }]);
  });

  it("passes a non-array Celestrak payload through unchanged", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "no such catalogue" }), { status: 200 }),
    );

    const { GET } = await import("@/app/api/satellites/route");
    const resp = await GET(mockRequest("/api/satellites"));
    expect(resp.headers.get("X-Cache")).toBe("MISS");
    const data = await resp.json();
    expect(data).toEqual({ error: "no such catalogue" });
  });

  it("returns 200 with the thrown message when upstream fetch rejects", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("celestrak unreachable"));

    const { GET } = await import("@/app/api/satellites/route");
    const resp = await GET(mockRequest("/api/satellites"));
    expect(resp.status).toBe(200);
    const data = await resp.json();
    expect(data).toEqual({
      count: 0,
      truncated: false,
      satellites: [],
      error: "celestrak unreachable",
    });
  });

  it("falls back to a generic message when the rejection is not an Error", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(42);

    const { GET } = await import("@/app/api/satellites/route");
    const resp = await GET(mockRequest("/api/satellites"));
    const data = await resp.json();
    expect(data.error).toBe("Satellite data fetch failed");
  });
});
