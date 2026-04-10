import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the cache module
vi.mock("@/lib/cache", () => ({
  cachedFetch: vi.fn((url: string, _ttl: number, opts?: RequestInit) => fetch(url, opts)),
  CACHE_TTL: { FLIGHTS: 15, EARTHQUAKES: 60, NLNOG: 3600 },
}));

const mockNlnogNodes = [
  { id: 1, hostname: "ams01", asn: 123, ipv4: "1.2.3.4", city: "Amsterdam", countrycode: "NL", geo: "52.37,4.9" },
  { id: 2, hostname: "lon01", asn: 456, ipv4: "5.6.7.8", city: "London", countrycode: "GB", geo: "51.51,-0.13" },
];

describe("NLNOG endpoint", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns nodes array with count", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(mockNlnogNodes), { status: 200 }),
    );

    const { GET } = await import("@/app/api/nlnog/route");
    const resp = await GET();
    expect(resp.status).toBe(200);

    const data = await resp.json();
    expect(Array.isArray(data.nodes)).toBe(true);
    expect(typeof data.count).toBe("number");
    expect(data.count).toBe(data.nodes.length);
    expect(data.count).toBe(2);
  });

  it("nodes have required fields", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(mockNlnogNodes), { status: 200 }),
    );

    const { GET } = await import("@/app/api/nlnog/route");
    const resp = await GET();
    const data = await resp.json();

    if (data.nodes.length === 0) return;

    const node = data.nodes[0];
    expect(typeof node.id).toBe("number");
    expect(typeof node.hostname).toBe("string");
    expect(typeof node.lat).toBe("number");
    expect(typeof node.lon).toBe("number");
  });

  it("includes CORS and cache headers", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(mockNlnogNodes), { status: 200 }),
    );

    const { GET } = await import("@/app/api/nlnog/route");
    const resp = await GET();
    expect(resp.headers.get("access-control-allow-origin")).toBe("*");
    expect(resp.headers.get("cache-control")).toContain("public");
  });
});
