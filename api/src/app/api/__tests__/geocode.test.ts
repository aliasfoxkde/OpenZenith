import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockRequest } from "./helpers";

const mockNominatimResponse = [
  {
    display_name: "London, England, United Kingdom",
    lat: "51.5074",
    lon: "-0.1278",
    type: "city",
    importance: 0.9,
    address: { city: "London", country: "United Kingdom" },
  },
];

describe("Geocode endpoint", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns 400 when query is missing", async () => {
    const { GET } = await import("@/app/api/geocode/route");
    const req = mockRequest("/api/geocode");
    const resp = await GET(req);
    expect(resp.status).toBe(400);
    const data = await resp.json();
    expect(data.error).toContain("query");
  });

  it("returns results for a valid query", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(mockNominatimResponse), { status: 200 }),
    );

    const { GET } = await import("@/app/api/geocode/route");
    const req = mockRequest("/api/geocode?query=London&limit=3");
    const resp = await GET(req);
    expect(resp.status).toBe(200);

    const data = await resp.json();
    expect(data.results).toHaveLength(1);
    expect(data.count).toBe(1);
    expect(data.results[0].display_name).toContain("London");
    expect(data.results[0].lat).toBe(51.5074);
    expect(data.results[0].lon).toBe(-0.1278);
  });

  it("returns empty results for no matches", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify([]), { status: 200 }),
    );

    const { GET } = await import("@/app/api/geocode/route");
    const req = mockRequest("/api/geocode?query=xyznonexistent12345");
    const resp = await GET(req);
    expect(resp.status).toBe(200);

    const data = await resp.json();
    expect(data.results).toHaveLength(0);
    expect(data.count).toBe(0);
  });

  it("includes CORS headers", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(mockNominatimResponse), { status: 200 }),
    );

    const { GET } = await import("@/app/api/geocode/route");
    const req = mockRequest("/api/geocode?query=Paris");
    const resp = await GET(req);
    expect(resp.headers.get("access-control-allow-origin")).toBe("*");
  });
});
