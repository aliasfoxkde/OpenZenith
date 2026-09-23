import { describe, it, expect, vi, afterEach } from "vitest";
import type { Mock } from "vitest";

// Each test stubs globalThis.fetch wholesale instead of queueing
// mockResolvedValueOnce responses: an orphaned route call from a timed-out
// test would otherwise consume the next test's queued response and force
// that test onto the live network (the hermeticity net in test-setup.ts
// turns that into a loud failure, but the corruption is best avoided).
function aqResponse(current: unknown): Response {
  return new Response(JSON.stringify({ current }), { status: 200 });
}

describe("Air Quality API", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns GeoJSON with air quality data", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        aqResponse({
          pm2_5: 35.2,
          pm10: 50.1,
          carbon_monoxide: 200,
          nitrogen_dioxide: 15,
          sulphur_dioxide: 5,
          ozone: 40,
          us_aqi: 75,
          time: "2026-04-10T12:00",
        }),
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
    vi.stubGlobal("fetch", vi.fn(() => aqResponse(null)));

    const { GET } = await import("@/app/api/airquality/route");
    const resp = await GET(new Request("http://localhost/api/airquality"));
    const data = await resp.json();

    expect(data.type).toBe("FeatureCollection");
    expect(data.features).toHaveLength(0);
  });

  it("returns error when upstream fails", async () => {
    vi.stubGlobal("fetch", vi.fn(() => new Response("error", { status: 500 })));

    const { GET } = await import("@/app/api/airquality/route");
    const resp = await GET(new Request("http://localhost/api/airquality"));
    expect(resp.status).toBe(200);
  });

  it("uses default coordinates when none provided", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        aqResponse({
          pm2_5: 10,
          pm10: 20,
          carbon_monoxide: 100,
          nitrogen_dioxide: 10,
          sulphur_dioxide: 3,
          ozone: 30,
          us_aqi: 42,
          time: "2026-04-10T12:00",
        }),
      ),
    );

    const { GET } = await import("@/app/api/airquality/route");
    const resp = await GET(new Request("http://localhost/api/airquality"));
    const data = await resp.json();

    expect(data.features[0].geometry.coordinates).toEqual([-74.0, 40.7]);
  });
});

/**
 * Branch coverage for the coordinate parser, the upstream failure paths and
 * every AQI severity band (getAqiLevel is module-private, so bands are driven
 * through the `us_aqi` property).
 */
describe("Air Quality API — validation, failure paths and AQI bands", () => {
  type FetchMock = Mock<(input: string) => Response>;

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const getRoute = async () => (await import("@/app/api/airquality/route")).GET;

  const withCurrent = (current: unknown): void => {
    vi.stubGlobal("fetch", vi.fn(() => aqResponse(current)));
  };

  /** Fresh fetch stub per test: answers every call with the same payload but
   * records its url argument, so tests can assert on the upstream query. */
  const aqFetch = (): FetchMock => vi.fn(() => aqResponse({ us_aqi: 42 }));

  it("exposes CORS preflight", async () => {
    const { OPTIONS } = await import("@/app/api/airquality/route");
    const resp = OPTIONS();
    expect(resp.status).toBe(204);
    expect(resp.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(resp.headers.get("Access-Control-Allow-Methods")).toBe("GET, HEAD, OPTIONS");
  });

  it("forwards non-default coordinates upstream and echoes them in the feature", async () => {
    const fetchMock = aqFetch();
    vi.stubGlobal("fetch", fetchMock);

    const resp = await (await getRoute())(new Request("http://localhost/api/airquality?lat=45.5&lon=10.25"));
    expect(resp.status).toBe(200);
    expect(resp.headers.get("Access-Control-Allow-Origin")).toBe("*");
    const url = fetchMock.mock.calls[0][0];
    expect(url.startsWith("https://air-quality-api.open-meteo.com/v1/air-quality?")).toBe(true);
    expect(url).toContain("latitude=45.5");
    expect(url).toContain("longitude=10.25");
    expect(url).toContain("timezone=auto");
    expect(url).toContain("current=pm10%2Cpm2_5");

    const data = await resp.json();
    expect(data.features[0].geometry.coordinates).toEqual([10.25, 45.5]);
  });

  it("substitutes defaults for non-numeric coordinates", async () => {
    const fetchMock = aqFetch();
    vi.stubGlobal("fetch", fetchMock);

    const resp = await (await getRoute())(new Request("http://localhost/api/airquality?lat=abc&lon=xyz"));
    const url = fetchMock.mock.calls[0][0];
    expect(url).toContain("latitude=40.7");
    expect(url).toContain("longitude=-74");
    const data = await resp.json();
    expect(data.features[0].geometry.coordinates).toEqual([-74, 40.7]);
  });

  it("substitutes defaults for out-of-range coordinates on both axes", async () => {
    const fetchMock = aqFetch();
    vi.stubGlobal("fetch", fetchMock);

    await (await getRoute())(new Request("http://localhost/api/airquality?lat=-95&lon=200"));
    expect(fetchMock.mock.calls[0][0]).toContain("latitude=40.7");
    expect(fetchMock.mock.calls[0][0]).toContain("longitude=-74");

    await (await getRoute())(new Request("http://localhost/api/airquality?lat=95&lon=-200"));
    expect(fetchMock.mock.calls[1][0]).toContain("latitude=40.7");
    expect(fetchMock.mock.calls[1][0]).toContain("longitude=-74");
  });

  it("keeps coordinates exactly on the lat/lon boundaries", async () => {
    const fetchMock = aqFetch();
    vi.stubGlobal("fetch", fetchMock);

    await (await getRoute())(new Request("http://localhost/api/airquality?lat=-90&lon=180"));
    expect(fetchMock.mock.calls[0][0]).toContain("latitude=-90");
    expect(fetchMock.mock.calls[0][0]).toContain("longitude=180");

    await (await getRoute())(new Request("http://localhost/api/airquality?lat=90&lon=-180"));
    expect(fetchMock.mock.calls[1][0]).toContain("latitude=90");
    expect(fetchMock.mock.calls[1][0]).toContain("longitude=-180");
  });

  it("returns an empty FeatureCollection when upstream sends no current block", async () => {
    withCurrent(null);

    const resp = await (await getRoute())(new Request("http://localhost/api/airquality?lat=1&lon=2"));
    expect(resp.status).toBe(200);
    expect(resp.headers.get("Access-Control-Allow-Origin")).toBe("*");
    const data = await resp.json();
    expect(data).toEqual({ type: "FeatureCollection", features: [] });
  });

  it("maps a missing us_aqi to level Good", async () => {
    withCurrent({ pm2_5: 3, pm10: 5, time: "2026-09-23T00:00" });

    const data = await (await (await getRoute())(new Request("http://localhost/api/airquality"))).json();
    expect(data.features[0].properties.us_aqi).toBeUndefined();
    expect(data.features[0].properties.aqi_level).toBe("Good");
  });

  it("maps every AQI value to its severity band, including band boundaries", async () => {
    const bands: Array<[number, string]> = [
      [0, "Good"],
      [50, "Good"],
      [51, "Moderate"],
      [100, "Moderate"],
      [101, "Unhealthy for Sensitive Groups"],
      [150, "Unhealthy for Sensitive Groups"],
      [151, "Unhealthy"],
      [200, "Unhealthy"],
      [201, "Very Unhealthy"],
      [300, "Very Unhealthy"],
      [301, "Hazardous"],
      [500, "Hazardous"],
    ];
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const GET = await getRoute();
    for (const [aqi, level] of bands) {
      fetchMock.mockImplementation(() => aqResponse({ us_aqi: aqi }));
      const data = await (await GET(new Request("http://localhost/api/airquality"))).json();
      expect(data.features[0].properties.aqi_level, `us_aqi=${aqi}`).toBe(level);
      expect(data.features[0].properties.us_aqi).toBe(aqi);
    }
    expect(fetchMock).toHaveBeenCalledTimes(bands.length);
  });

  it("returns a 200 error payload when upstream responds non-OK", async () => {
    vi.stubGlobal("fetch", vi.fn(() => new Response("rate limited", { status: 429 })));

    const resp = await (await getRoute())(new Request("http://localhost/api/airquality"));
    expect(resp.status).toBe(200);
    expect(resp.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(await resp.json()).toEqual({ error: "Failed to fetch air quality data" });
  });

  it("returns a 200 error payload when the upstream request throws", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("dns failure"))));

    const resp = await (await getRoute())(new Request("http://localhost/api/airquality"));
    expect(resp.status).toBe(200);
    expect(resp.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(await resp.json()).toEqual({ error: "Internal server error" });
  });

  it("returns a 200 error payload when the upstream body is not JSON", async () => {
    vi.stubGlobal("fetch", vi.fn(() => new Response("<html>gateway</html>", { status: 200 })));

    const resp = await (await getRoute())(new Request("http://localhost/api/airquality"));
    expect(resp.status).toBe(200);
    expect(await resp.json()).toEqual({ error: "Internal server error" });
  });
});
