import { describe, it, expect, vi, afterEach } from "vitest";
import { mockRequest } from "./helpers";
import { getElevationFromR2 } from "@/lib/elevation/terrarium-reader";
import { getWeather } from "@/lib/weather/open-meteo";
import { getTides } from "@/lib/tides/noaa";

vi.mock("@/lib/elevation/terrarium-reader", () => ({
  getElevationFromR2: vi.fn().mockResolvedValue({
    elevation: 100,
    source: "huggingface",
    resolution: 30,
    unit: "meters",
    location: { lat: 40.7, lon: -74.0 },
  }),
}));
vi.mock("@/lib/weather/open-meteo", () => ({
  getWeather: vi.fn().mockResolvedValue({
    current: { temperature: 15, apparentTemperature: 13 },
    daily: [],
    units: { temperature: "°C" },
  }),
}));
vi.mock("@/lib/tides/noaa", () => ({
  getTides: vi.fn().mockResolvedValue(null),
}));

const metricWeather = () => ({
  current: {
    temperature: 15,
    apparentTemperature: 13,
    humidity: 60,
    weatherCode: 0,
    weatherDescription: "Clear sky",
    windSpeed: 10,
    windDirection: 180,
    windGusts: 20,
    pressure: 1013,
    precipitation: 1.5,
    cloudCover: 10,
    visibility: 24.14,
    uvIndex: 5,
    isDay: true,
  },
  daily: [
    {
      date: "2026-09-21",
      tempMax: 20,
      tempMin: 10,
      precipitationSum: 2,
      weatherCode: 0,
      weatherDescription: "Clear sky",
      sunrise: "06:00",
      sunset: "18:00",
      windSpeedMax: 15,
      uvIndexMax: 6,
    },
  ],
  units: { temperature: "°C", windSpeed: "km/h", pressure: "hPa", precipitation: "mm", visibility: "km" },
  timezone: "America/New_York",
  source: "open-meteo",
});

const tideData = () => ({
  station: { id: "8594900", name: "Washington", lat: 38.87, lon: -77.02, distance: 1.2, distanceUnit: "nm" },
  predictions: [{ time: "2026-09-21T12:00:00", type: "H" as const, height: 1.1, typeLabel: "High" as const }],
  source: "noaa",
});

type FetchRoute = { match: string; respond: () => Response };

/** Route stubbed fetch calls by URL substring so concurrent includes stay deterministic. */
function stubFetch(routes: FetchRoute[]) {
  const fetchMock = vi.fn((input: RequestInfo | URL) =>
    Promise.resolve().then(() => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const hit = routes.find((r) => url.includes(r.match));
      if (!hit) throw new Error(`unexpected fetch: ${url}`);
      return hit.respond();
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Query API", () => {
  it("requires lat and lon", async () => {
    const { GET } = await import("@/app/api/query/route");
    const resp = await GET(mockRequest("/api/query"));
    expect(resp.status).toBe(400);
    const data = await resp.json();
    expect(data.error).toContain("Missing");
  });

  it("rejects invalid coordinates", async () => {
    const { GET } = await import("@/app/api/query/route");
    const resp = await GET(mockRequest("/api/query?lat=999&lon=0"));
    expect(resp.status).toBe(400);
  });

  it("returns elevation by default", async () => {
    const { GET } = await import("@/app/api/query/route");
    const resp = await GET(mockRequest("/api/query?lat=40.7&lon=-74.0"));
    expect(resp.status).toBe(200);
    const data = await resp.json();
    expect(data.location).toEqual({ lat: 40.7, lon: -74.0 });
    expect(data.elevation).toBeTruthy();
    expect(data.elevation.elevation).toBe(100);
  });

  it("rejects invalid include values", async () => {
    const { GET } = await import("@/app/api/query/route");
    const resp = await GET(mockRequest("/api/query?lat=40.7&lon=-74.0&include=invalid_type"));
    expect(resp.status).toBe(400);
    const data = await resp.json();
    expect(data.error).toContain("Invalid include");
  });

  it("returns weather when include=weather", async () => {
    const { GET } = await import("@/app/api/query/route");
    const resp = await GET(mockRequest("/api/query?lat=40.7&lon=-74.0&include=weather"));
    expect(resp.status).toBe(200);
    const data = await resp.json();
    expect(data.weather).toBeTruthy();
  });

  it("returns multiple includes comma-separated", async () => {
    const { GET } = await import("@/app/api/query/route");
    const resp = await GET(mockRequest("/api/query?lat=40.7&lon=-74.0&include=elevation,weather"));
    expect(resp.status).toBe(200);
    const data = await resp.json();
    expect(data.elevation).toBeTruthy();
    expect(data.weather).toBeTruthy();
  });

  it("respects imperial units parameter", async () => {
    const { GET } = await import("@/app/api/query/route");
    const resp = await GET(mockRequest("/api/query?lat=40.7&lon=-74.0&include=elevation&units=imperial"));
    expect(resp.status).toBe(200);
    const data = await resp.json();
    expect(data.query.units).toBe("imperial");
  });

  it("respects forecast_days parameter", async () => {
    const { GET } = await import("@/app/api/query/route");
    const resp = await GET(mockRequest("/api/query?lat=40.7&lon=-74.0&forecast_days=5"));
    expect(resp.status).toBe(200);
    const data = await resp.json();
    expect(data.query.includes).toContain("elevation");
  });

  it("returns 400 for out-of-range latitude", async () => {
    const { GET } = await import("@/app/api/query/route");
    const resp = await GET(mockRequest("/api/query?lat=91&lon=0"));
    expect(resp.status).toBe(400);
  });

  it("returns 400 for out-of-range longitude", async () => {
    const { GET } = await import("@/app/api/query/route");
    const resp = await GET(mockRequest("/api/query?lat=0&lon=181"));
    expect(resp.status).toBe(400);
  });

  it("handles OPTIONS preflight", async () => {
    const { OPTIONS } = await import("@/app/api/query/route");
    const resp = await OPTIONS();
    expect(resp.status).toBe(204);
  });
});

describe("Query API — parameter validation edges", () => {
  const GET = async () => (await import("@/app/api/query/route")).GET;

  it("returns 400 when only lat is provided", async () => {
    const resp = await (await GET())(mockRequest("/api/query?lat=40.7"));
    expect(resp.status).toBe(400);
    expect((await resp.json()).error).toContain("Missing required parameters");
  });

  it("returns 400 when lat is not numeric", async () => {
    const resp = await (await GET())(mockRequest("/api/query?lat=abc&lon=0"));
    expect(resp.status).toBe(400);
    expect((await resp.json()).error).toContain("Invalid coordinates");
  });

  it("returns 400 when lon is below the minimum", async () => {
    const resp = await (await GET())(mockRequest("/api/query?lat=0&lon=-181"));
    expect(resp.status).toBe(400);
  });

  it("treats an empty include parameter as the elevation default", async () => {
    const resp = await (await GET())(mockRequest("/api/query?lat=40.7&lon=-74.0&include="));
    expect(resp.status).toBe(200);
    const data = await resp.json();
    expect(data.query.includes).toEqual(["elevation"]);
    expect(data.elevation.elevation).toBe(100);
  });

  it("drops unknown include entries and normalises case and whitespace", async () => {
    const resp = await (await GET())(
      mockRequest("/api/query?lat=40.7&lon=-74.0&include= Elevation , bogus , WEATHER "),
    );
    expect(resp.status).toBe(200);
    const data = await resp.json();
    expect(data.query.includes).toEqual(["elevation", "weather"]);
    expect(data.elevation).toBeTruthy();
    expect(data.weather).toBeTruthy();
  });

  it("clamps forecast_days into the 1..7 range", async () => {
    vi.mocked(getWeather).mockClear();
    // 0 is falsy so it falls through to the default rather than clamping to 1
    await (await GET())(mockRequest("/api/query?lat=40.7&lon=-74.0&include=weather&forecast_days=0"));
    await (await GET())(mockRequest("/api/query?lat=40.7&lon=-74.0&include=weather&forecast_days=-2"));
    await (await GET())(mockRequest("/api/query?lat=40.7&lon=-74.0&include=weather&forecast_days=99"));
    await (await GET())(mockRequest("/api/query?lat=40.7&lon=-74.0&include=weather&forecast_days=abc"));

    const days = vi.mocked(getWeather).mock.calls.map((call) => call[2]);
    expect(days).toEqual([3, 1, 7, 3]);
  });

  it("returns a 200 error payload when the elevation provider rejects", async () => {
    vi.mocked(getElevationFromR2).mockRejectedValueOnce(new Error("tile unavailable"));
    const resp = await (await GET())(mockRequest("/api/query?lat=40.7&lon=-74.0"));
    expect(resp.status).toBe(200);
    const data = await resp.json();
    expect(data.error).toBe("tile unavailable");
    expect(data.elevation).toBeUndefined();
  });

  it("falls back to a generic message when a non-Error is thrown", async () => {
    vi.mocked(getElevationFromR2).mockRejectedValueOnce("boom");
    const resp = await (await GET())(mockRequest("/api/query?lat=40.7&lon=-74.0"));
    expect(resp.status).toBe(200);
    expect((await resp.json()).error).toBe("Query failed");
  });
});

describe("Query API — reverse geocode (address) include", () => {
  const GET = async () => (await import("@/app/api/query/route")).GET;
  const QUERY = "/api/query?lat=40.7&lon=-74.0&include=address";

  it("maps the Nominatim payload onto the address object", async () => {
    const fetchMock = stubFetch([
      {
        match: "nominatim.openstreetmap.org",
        respond: () =>
          new Response(
            JSON.stringify({
              display_name: "New York, NY, USA",
              name: "New York",
              type: "city",
              address: { city: "New York" },
              osm_id: 12345,
              osm_type: "relation",
            }),
            { status: 200 },
          ),
      },
    ]);

    const data = await (await (await GET())(mockRequest(QUERY))).json();
    expect(data.address).toEqual({
      display_name: "New York, NY, USA",
      name: "New York",
      type: "city",
      address: { city: "New York" },
      osm_id: 12345,
      osm_type: "relation",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to the first display_name fragment when name is absent", async () => {
    stubFetch([
      {
        match: "nominatim.openstreetmap.org",
        respond: () => new Response(JSON.stringify({ display_name: "Springfield, IL, USA" }), { status: 200 }),
      },
    ]);
    const data = await (await (await GET())(mockRequest(QUERY))).json();
    expect(data.address.display_name).toBe("Springfield, IL, USA");
    expect(data.address.name).toBe("Springfield");
    expect(data.address.type).toBeNull();
    expect(data.address.osm_id).toBeNull();
  });

  it("returns a null address when Nominatim reports no result", async () => {
    stubFetch([
      {
        match: "nominatim.openstreetmap.org",
        respond: () => new Response(JSON.stringify({ error: "Unable to geocode" }), { status: 200 }),
      },
    ]);
    const data = await (await (await GET())(mockRequest(QUERY))).json();
    expect(data.address).toBeNull();
  });

  it("returns a null address on a non-2xx upstream response", async () => {
    stubFetch([
      { match: "nominatim.openstreetmap.org", respond: () => new Response("blocked", { status: 403 }) },
    ]);
    const data = await (await (await GET())(mockRequest(QUERY))).json();
    expect(data.address).toBeNull();
  });

  it("returns a null address when the geocode request throws", async () => {
    const fetchMock = vi.fn(() => Promise.reject(new Error("dns failure")));
    vi.stubGlobal("fetch", fetchMock);
    const data = await (await (await GET())(mockRequest(QUERY))).json();
    expect(data.address).toBeNull();
    expect(data.error).toBeUndefined();
  });

  it("returns nulls for every address field when Nominatim answers with an empty object", async () => {
    stubFetch([
      { match: "nominatim.openstreetmap.org", respond: () => new Response(JSON.stringify({}), { status: 200 }) },
    ]);
    const data = await (await (await GET())(mockRequest(QUERY))).json();
    expect(data.address).toEqual({
      display_name: null,
      name: null,
      type: null,
      address: null,
      osm_id: null,
      osm_type: null,
    });
  });

  it.each([
    ["missing", "18"],
    ["0", "0"],
    ["99", "18"],
    ["abc", "18"],
    ["12", "12"],
  ])("clamps address_zoom=%s into 0..18", async (raw, expected) => {
    const fetchMock = stubFetch([
      {
        match: "nominatim.openstreetmap.org",
        respond: () => new Response(JSON.stringify({ display_name: "somewhere" }), { status: 200 }),
      },
    ]);
    await (await GET())(mockRequest(`${QUERY}&address_zoom=${raw}`));
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain(`zoom=${expected}`);
    expect(url).toContain("addressdetails=1");
  });
});

describe("Query API — weather include", () => {
  const GET = async () => (await import("@/app/api/query/route")).GET;

  it("converts metric values to imperial units", async () => {
    vi.mocked(getWeather).mockResolvedValueOnce(metricWeather());
    const resp = await (
      await GET()
    )(mockRequest("/api/query?lat=40.7&lon=-74.0&include=weather&units=imperial"));
    expect(resp.status).toBe(200);
    const data = await resp.json();

    expect(data.weather.current.temperature).toBe(59);
    expect(data.weather.current.apparentTemperature).toBe(55.4);
    expect(data.weather.current.windSpeed).toBe(6.2);
    expect(data.weather.current.windGusts).toBe(12.4);
    expect(data.weather.current.pressure).toBe(29.91);
    expect(data.weather.current.precipitation).toBe(0.06);
    expect(data.weather.current.visibility).toBe(0);

    expect(data.weather.daily[0].tempMax).toBe(68);
    expect(data.weather.daily[0].tempMin).toBe(50);
    expect(data.weather.daily[0].precipitationSum).toBe(0.08);
    expect(data.weather.daily[0].windSpeedMax).toBe(9.3);

    expect(data.weather.units).toEqual({
      temperature: "°F",
      windSpeed: "mph",
      pressure: "inHg",
      precipitation: "in",
      visibility: "mi",
    });
  });

  it("returns a null weather payload when the provider has no data", async () => {
    vi.mocked(getWeather).mockResolvedValueOnce(null);
    const resp = await (await GET())(mockRequest("/api/query?lat=40.7&lon=-74.0&include=weather"));
    expect(resp.status).toBe(200);
    expect((await resp.json()).weather).toBeNull();
  });
});

describe("Query API — tides include", () => {
  const GET = async () => (await import("@/app/api/query/route")).GET;

  it("returns tide data and a 30 minute cache window", async () => {
    vi.mocked(getTides).mockResolvedValueOnce(tideData());
    const resp = await (await GET())(mockRequest("/api/query?lat=40.7&lon=-74.0&include=tides"));
    expect(resp.status).toBe(200);
    expect(resp.headers.get("Cache-Control")).toBe("public, max-age=1800");
    const data = await resp.json();
    expect(data.tides.source).toBe("noaa");
    expect(data.tides.predictions).toHaveLength(1);
  });
});

describe("Query API — cache windows", () => {
  const GET = async () => (await import("@/app/api/query/route")).GET;

  it.each([
    ["elevation", 3600],
    ["tides", 1800],
    ["weather", 300],
    ["elevation,weather,tides", 300],
    ["elevation,tides", 1800],
  ])("uses a %s second window for include=%s", async (include, maxAge) => {
    const resp = await (await GET())(mockRequest(`/api/query?lat=40.7&lon=-74.0&include=${include}`));
    expect(resp.headers.get("Cache-Control")).toBe(`public, max-age=${maxAge}`);
  });
});

describe("Query API — waterways include", () => {
  const GET = async () => (await import("@/app/api/query/route")).GET;
  const QUERY = "/api/query?lat=40.7&lon=-74.0&include=waterways";

  const overpassElements = (count: number): unknown[] =>
    Array.from({ length: count }, (_unused, i) => ({
      id: 1000 + i,
      tags: { name: `River ${i}`, waterway: "river" },
    }));

  it("maps Overpass elements to named waterway features", async () => {
    stubFetch([
      {
        match: "overpass-api.de",
        respond: () =>
          new Response(
            JSON.stringify({
              elements: [
                { id: 1, tags: { name: "Hudson", waterway: "river" } },
                { id: 2, tags: { natural: "water" } },
                { id: 3 },
              ],
            }),
            { status: 200 },
          ),
      },
    ]);

    const data = await (await (await GET())(mockRequest(QUERY))).json();
    expect(data.waterways.count).toBe(3);
    expect(data.waterways.features).toEqual([
      { id: 1, name: "Hudson", type: "river" },
      { id: 2, name: null, type: "water" },
      { id: 3, name: null, type: null },
    ]);
  });

  it("caps the returned feature list at 20 while reporting the full count", async () => {
    stubFetch([
      {
        match: "overpass-api.de",
        respond: () => new Response(JSON.stringify({ elements: overpassElements(25) }), { status: 200 }),
      },
    ]);
    const data = await (await (await GET())(mockRequest(QUERY))).json();
    expect(data.waterways.count).toBe(25);
    expect(data.waterways.features).toHaveLength(20);
  });

  it("reports zero waterways when the response has no elements array", async () => {
    stubFetch([{ match: "overpass-api.de", respond: () => new Response(JSON.stringify({}), { status: 200 }) }]);
    const data = await (await (await GET())(mockRequest(QUERY))).json();
    expect(data.waterways).toEqual({ count: 0, features: [] });
  });

  it("returns null waterways on a non-2xx upstream response", async () => {
    stubFetch([{ match: "overpass-api.de", respond: () => new Response("busy", { status: 429 }) }]);
    const data = await (await (await GET())(mockRequest(QUERY))).json();
    expect(data.waterways).toBeNull();
  });

  it("returns null waterways when the Overpass request throws", async () => {
    const fetchMock = vi.fn(() => Promise.reject(new Error("timeout")));
    vi.stubGlobal("fetch", fetchMock);
    const data = await (await (await GET())(mockRequest(QUERY))).json();
    expect(data.waterways).toBeNull();
  });

  it("sends the bounded bbox query to Overpass", async () => {
    const fetchMock = stubFetch([
      {
        match: "overpass-api.de",
        respond: () => new Response(JSON.stringify({ elements: [] }), { status: 200 }),
      },
    ]);
    await (await GET())(mockRequest("/api/query?lat=10.5&lon=20.25&include=waterways"));
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://overpass-api.de/api/interpreter");
    expect(init.method).toBe("POST");
    const rawBody = init.body;
    if (typeof rawBody !== "string") throw new Error("expected a string Overpass request body");
    const body = decodeURIComponent(rawBody);
    expect(body).toContain("(10.49,20.24,10.51,20.26)");
    expect(body).toContain('way["waterway"~"river|stream|canal"]');
  });
});
