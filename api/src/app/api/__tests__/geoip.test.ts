import { describe, it, expect } from "vitest";
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
    const req = mockRequest("/api/geoip", "GET", null, { cf: MOCK_CF });
     
    const resp = await GET(req);
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
    const req = mockRequest("/api/geoip", "GET", null, { cf: MOCK_CF });

    const resp = await GET(req);
    expect(resp.headers.get("access-control-allow-origin")).toBe("*");
    expect(resp.headers.get("cache-control")).toContain("public");
  });

  it("exposes CORS preflight OPTIONS", async () => {
    const { OPTIONS } = await import("@/app/api/geoip/route");
    const resp = await OPTIONS();
    expect(resp.status).toBe(204);
    expect(resp.headers.get("access-control-allow-origin")).toBe("*");
    expect(resp.headers.get("access-control-allow-methods")).toContain("GET");
  });

  it("falls back to an unknown ip and null fields when no cf object is present", async () => {
    const { GET } = await import("@/app/api/geoip/route");
    // No `cf` override — mirrors a non-Cloudflare/dev request.
    const resp = await GET(mockRequest("/api/geoip"));
    expect(resp.status).toBe(200);

    const data = await resp.json();
    expect(data.ip).toBe("unknown");
    for (const field of [
      "city",
      "country",
      "countryName",
      "region",
      "regionName",
      "postalCode",
      "latitude",
      "longitude",
      "timezone",
      "continent",
      "asn",
      "asOrganization",
      "colo",
    ]) {
      expect(data[field]).toBeNull();
    }
  });

  it("uses x-forwarded-for when the cf object carries no ip", async () => {
    const { GET } = await import("@/app/api/geoip/route");
    const req = mockRequest("/api/geoip", "GET", null, { cf: { city: "Rotterdam" } });
    req.headers.set("x-forwarded-for", "203.0.113.7");

    const data = await (await GET(req)).json();
    expect(data.ip).toBe("203.0.113.7");
    expect(data.city).toBe("Rotterdam");
  });

  it("collapses falsy string fields but preserves a legitimate 0 coordinate", async () => {
    const { GET } = await import("@/app/api/geoip/route");
    // Coordinates use ?? so a point on the equator/prime meridian (0, 0)
    // is reported as-is; string fields and asn still treat falsy as absent.
    const req = mockRequest("/api/geoip", "GET", null, {
      cf: { ip: "9.9.9.9", city: "", asn: 0, latitude: 0, longitude: 0 },
    });

    const data = await (await GET(req)).json();
    expect(data.ip).toBe("9.9.9.9");
    expect(data.city).toBeNull();
    expect(data.asn).toBeNull();
    expect(data.latitude).toBe(0);
    expect(data.longitude).toBe(0);
  });
});
