import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockRequest } from "./helpers";

const mockReverseResult = {
  display_name:
    "White House, 1600, Pennsylvania Avenue Northwest, Washington, District of Columbia, 20500, United States",
  name: "White House",
  type: "tourism",
  address: { city: "Washington", state: "District of Columbia", country: "United States" },
  osm_id: 123456,
  osm_type: "way",
};

describe("Reverse Geocode endpoint", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns place data for known coordinates", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(mockReverseResult), { status: 200 }),
    );

    const { GET } = await import("@/app/api/reverse-geocode/route");
    const req = mockRequest("/api/reverse-geocode?lat=38.8977&lon=-77.0365");
    const resp = await GET(req);
    expect(resp.status).toBe(200);

    const data = await resp.json();
    expect(data.place).toBeDefined();
    expect(data.place.display_name).toContain("White House");
    expect(data.location.lat).toBe(38.8977);
    expect(data.location.lon).toBe(-77.0365);
  });

  it("includes CORS headers", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(mockReverseResult), { status: 200 }),
    );

    const { GET } = await import("@/app/api/reverse-geocode/route");
    const req = mockRequest("/api/reverse-geocode?lat=0&lon=0");
    const resp = await GET(req);
    expect(resp.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("returns place null for ocean coordinates (Nominatim error)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "Unable to geocode" }), { status: 200 }),
    );

    const { GET } = await import("@/app/api/reverse-geocode/route");
    const req = mockRequest("/api/reverse-geocode?lat=0&lon=0");
    const resp = await GET(req);
    expect(resp.status).toBe(200);

    const data = await resp.json();
    expect(data.place).toBeNull();
    expect(data.location).toBeDefined();
  });

  it("accepts zoom parameter", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(mockReverseResult), { status: 200 }),
    );

    const { GET } = await import("@/app/api/reverse-geocode/route");
    const req = mockRequest("/api/reverse-geocode?lat=48.8566&lon=2.3522&zoom=10");
    const resp = await GET(req);
    expect(resp.status).toBe(200);

    const data = await resp.json();
    expect(data.place).toBeDefined();
  });
});
