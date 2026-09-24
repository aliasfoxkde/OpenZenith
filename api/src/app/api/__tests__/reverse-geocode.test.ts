import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockRequest } from "./helpers";

interface GeocodeBody {
  place?: {
    display_name?: string;
    name?: string;
    osm_id?: number;
  } | null;
  location?: { lat: number; lon: number };
  error?: string;
}

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

    const data = (await resp.json()) as GeocodeBody;
    expect(data.place).toBeDefined();
    expect(data.place?.display_name).toContain("White House");
    expect(data.location?.lat).toBe(38.8977);
    expect(data.location?.lon).toBe(-77.0365);
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

    const data = (await resp.json()) as GeocodeBody;
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

    const data = (await resp.json()) as GeocodeBody;
    expect(data.place).toBeDefined();
  });

  it("rejects missing lat/lon with 400", async () => {
    const { GET } = await import("@/app/api/reverse-geocode/route");
    const resp = await GET(mockRequest("/api/reverse-geocode"));
    expect(resp.status).toBe(400);
    const data = (await resp.json()) as GeocodeBody;
    expect(data.error).toContain("Missing required parameters");
  });

  it("rejects out-of-range coordinates with 400", async () => {
    const { GET } = await import("@/app/api/reverse-geocode/route");
    const resp = await GET(mockRequest("/api/reverse-geocode?lat=95&lon=0"));
    expect(resp.status).toBe(400);
    const data = (await resp.json()) as GeocodeBody;
    expect(data.error).toContain("Invalid coordinates");
  });

  it("rejects non-numeric coordinates with 400", async () => {
    const { GET } = await import("@/app/api/reverse-geocode/route");
    const resp = await GET(mockRequest("/api/reverse-geocode?lat=abc&lon=0"));
    expect(resp.status).toBe(400);
  });

  it("derives the name from display_name when Nominatim omits it", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ display_name: "A Road, B Town, C Region" }), { status: 200 }),
    );

    const { GET } = await import("@/app/api/reverse-geocode/route");
    const resp = await GET(mockRequest("/api/reverse-geocode?lat=0&lon=0"));
    const data = (await resp.json()) as GeocodeBody;
    expect(data.place?.name).toBe("A Road");
  });

  it("returns a soft error when the upstream is unavailable", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("down", { status: 503 }),
    );

    const { GET } = await import("@/app/api/reverse-geocode/route");
    const resp = await GET(mockRequest("/api/reverse-geocode?lat=0&lon=0"));
    expect(resp.status).toBe(200);
    const data = (await resp.json()) as GeocodeBody;
    expect(data.error).toContain("Upstream geocoding service unavailable");
  });

  it("returns a soft error when the upstream fetch throws", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("network unreachable"));

    const { GET } = await import("@/app/api/reverse-geocode/route");
    const resp = await GET(mockRequest("/api/reverse-geocode?lat=0&lon=0"));
    expect(resp.status).toBe(200);
    const data = (await resp.json()) as GeocodeBody;
    expect(data.error).toContain("Reverse geocoding request failed");
  });

  it("exposes CORS preflight OPTIONS", async () => {
    const { OPTIONS } = await import("@/app/api/reverse-geocode/route");
    const resp = await OPTIONS();
    expect(resp.status).toBe(204);
    expect(resp.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(resp.headers.get("Access-Control-Allow-Methods")).toContain("OPTIONS");
  });
});
