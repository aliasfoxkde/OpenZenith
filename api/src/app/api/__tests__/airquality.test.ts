import { describe, it, expect, vi } from "vitest";

describe("Air Quality API", () => {
  it("returns GeoJSON with air quality data", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          current: {
            pm2_5: 35.2,
            pm10: 50.1,
            carbon_monoxide: 200,
            nitrogen_dioxide: 15,
            sulphur_dioxide: 5,
            ozone: 40,
            us_aqi: 75,
            time: "2026-04-10T12:00",
          },
        }),
        { status: 200 },
      ),
    );

    const { GET } = await import("@/app/api/airquality/route");
    const resp = await GET(new Request("http://localhost/api/airquality?lat=40.7&lon=-74.0"));
    const data = await resp.json();

    expect(resp.status).toBe(200);
    expect(data.type).toBe("FeatureCollection");
    expect(data.features).toHaveLength(1);
    expect(data.features[0].geometry.type).toBe("Point");
    expect(data.features[0].geometry.coordinates).toEqual([-74.0, 40.7]);
    expect(data.features[0].properties.pm2_5).toBe(35.2);
    expect(data.features[0].properties.us_aqi).toBe(75);
    expect(data.features[0].properties.aqi_level).toBe("Moderate");
  });

  it("returns empty features when no current data", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ current: null }), { status: 200 }),
    );

    const { GET } = await import("@/app/api/airquality/route");
    const resp = await GET(new Request("http://localhost/api/airquality"));
    const data = await resp.json();

    expect(data.type).toBe("FeatureCollection");
    expect(data.features).toHaveLength(0);
  });

  it("returns error when upstream fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("error", { status: 500 }));

    const { GET } = await import("@/app/api/airquality/route");
    const resp = await GET(new Request("http://localhost/api/airquality"));
    expect(resp.status).toBe(502);
  });

  it("uses default coordinates when none provided", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          current: { pm2_5: 10, pm10: 20, carbon_monoxide: 100, nitrogen_dioxide: 10, sulphur_dioxide: 3, ozone: 30, us_aqi: 42, time: "2026-04-10T12:00" },
        }),
        { status: 200 },
      ),
    );

    const { GET } = await import("@/app/api/airquality/route");
    const resp = await GET(new Request("http://localhost/api/airquality"));
    const data = await resp.json();

    expect(data.features[0].geometry.coordinates).toEqual([-74.0, 40.7]);
  });
});
