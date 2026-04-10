import { describe, it, expect, vi } from "vitest";
import { mockRequest } from "./helpers";

const MOCK_CF = {
  ip: "1.2.3.4",
  city: "Amsterdam",
  country: "NL",
  countryName: "Netherlands",
  region: "NH",
  subdivision1Code: "NH",
  subdivision1Name: "North Holland",
  postalCode: "1012",
  latitude: 52.37,
  longitude: 4.9,
  timezone: "Europe/Amsterdam",
  continent: "EU",
  asn: 12345,
  asOrganization: "Test ISP",
  colo: "AMS",
};

describe("GeoIP endpoint", () => {
  it("returns location data from cf object", async () => {
    const { GET } = await import("@/app/api/geoip/route");
    const req = mockRequest("/api/geoip", "GET", { cf: MOCK_CF });
    const resp = await GET(req as any);
    expect(resp.status).toBe(200);

    const data = await resp.json();
    expect(data.ip).toBe("1.2.3.4");
    expect(data.city).toBe("Amsterdam");
    expect(data.country).toBe("NL");
    expect(data.latitude).toBe(52.37);
    expect(data.longitude).toBe(4.9);
    expect(data.timezone).toBe("Europe/Amsterdam");
  });

  it("includes CORS and cache headers", async () => {
    const { GET } = await import("@/app/api/geoip/route");
    const req = mockRequest("/api/geoip", "GET", { cf: MOCK_CF });
    const resp = await GET(req as any);
    expect(resp.headers.get("access-control-allow-origin")).toBe("*");
    expect(resp.headers.get("cache-control")).toContain("public");
  });
});
