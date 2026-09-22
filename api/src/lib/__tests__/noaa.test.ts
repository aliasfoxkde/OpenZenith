import { describe, it, expect, vi, afterEach } from "vitest";
import { getTides } from "../tides/noaa";

const STATIONS_URL = /mdapi\/prod\/webapi\/stations\.json/;
const PREDICTIONS_URL = /api\/prod\/datagetter/;

interface StationRow {
  id: string;
  name: string;
  lat?: unknown;
  lng?: unknown;
}

function station(id: string, name: string, lat: string, lng: string): StationRow {
  return { id, name, lat, lng };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

type Responder = (url: string) => Response;

function routeFetch(routes: Array<{ match: RegExp; respond: Responder }>): ReturnType<typeof vi.fn> {
  return vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
    const url = typeof input === "string" ? input : input.toString();
    for (const route of routes) {
      if (route.match.test(url)) return route.respond(url);
    }
    return jsonResponse({ error: `unexpected fetch: ${url}` }, 500);
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getTides — station selection", () => {
  it("returns the nearest station's predictions", async () => {
    const stations: StationRow[] = [
      station("1612340", "Honolulu", "21.311", "-157.867"),
      station("9999999", "Two Degrees Away", "2.0", "2.0"),
      { id: "0000000", name: "No Coordinates" },
    ];
    const fetchMock = routeFetch([
      {
        match: STATIONS_URL,
        respond: () =>
          jsonResponse({
            stations: [...stations, station("1234567", "Close To Query", "0.1", "0.2")],
          }),
      },
      {
        match: PREDICTIONS_URL,
        respond: () =>
          jsonResponse({
            predictions: [
              { t: "2026-01-01 03:12", v: "1.234", type: "H" },
              { t: "2026-01-01 09:40", v: "0.100", type: "L" },
            ],
          }),
      },
    ]);
    vi.stubGlobal("fetch", fetchMock);

    const result = await getTides(0, 0);

    expect(result).not.toBeNull();
    expect(result?.source).toBe("noaa-tides");
    expect(result?.station.id).toBe("1234567");
    expect(result?.station.name).toBe("Close To Query");
    expect(result?.station.lat).toBe(0.1);
    expect(result?.station.lon).toBe(0.2);
    expect(result?.station.distanceUnit).toBe("nm");
    // haversine on a 3440.065 nm sphere: 0.1 deg lat + 0.2 deg lon -> 13.4254 nm -> 13.4
    expect(result?.station.distance).toBe(13.4);
    expect(result?.predictions).toHaveLength(2);
    expect(result?.predictions[0]).toEqual({
      time: "2026-01-01 03:12",
      type: "H",
      height: 1.234,
      typeLabel: "High",
    });
    expect(result?.predictions[1]).toEqual({
      time: "2026-01-01 09:40",
      type: "L",
      height: 0.1,
      typeLabel: "Low",
    });
  });

  it("picks the closer of two valid stations and rounds distance to 0.1 nm", async () => {
    const stations: StationRow[] = [
      station("A", "Thirty nm away", "0.3", "-0.4"),
      station("B", "Thirteen nm away", "0.1", "0.2"),
    ];
    const fetchMock = routeFetch([
      { match: STATIONS_URL, respond: () => jsonResponse({ stations }) },
      { match: PREDICTIONS_URL, respond: () => jsonResponse({ predictions: [] }) },
    ]);
    vi.stubGlobal("fetch", fetchMock);

    const result = await getTides(0, 0);

    expect(result?.station.id).toBe("B");
    // 0.1 deg lat + 0.2 deg lon -> 13.4254 nm -> 13.4
    expect(result?.station.distance).toBe(13.4);
    expect(result?.station.distance).toBeLessThan(50);
    expect(result?.predictions).toEqual([]);
  });

  it("ignores stations whose coordinates are missing or unparsable", async () => {
    const stations: StationRow[] = [
      { id: "nolat", name: "No lat", lat: undefined, lng: "0.2" },
      { id: "nolng", name: "No lng", lat: "0.1", lng: undefined },
      { id: "nan", name: "Not a number", lat: "abc", lng: "0.2" },
      { id: "nan2", name: "Not a number 2", lat: "0.1", lng: "xyz" },
      station("valid", "Only Valid", "0.3", "-0.4"),
    ];
    const fetchMock = routeFetch([
      { match: STATIONS_URL, respond: () => jsonResponse({ stations }) },
      { match: PREDICTIONS_URL, respond: () => jsonResponse({ predictions: [{ t: "t", v: "2", type: "H" }] }) },
    ]);
    vi.stubGlobal("fetch", fetchMock);

    const result = await getTides(0, 0);

    expect(result?.station.id).toBe("valid");
    // 0.3 deg lat + 0.4 deg lon -> 30.02 nm
    expect(result?.station.distance).toBe(30.0);
  });

  it("returns null when the nearest station is beyond 50 nm", async () => {
    const fetchMock = routeFetch([
      { match: STATIONS_URL, respond: () => jsonResponse({ stations: [station("far", "Far", "2.0", "2.0")] }) },
      {
        match: PREDICTIONS_URL,
        respond: () => {
          throw new Error("predictions must not be requested");
        },
      },
    ]);
    vi.stubGlobal("fetch", fetchMock);

    const result = await getTides(0, 0);

    expect(result).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("getTides — upstream failure handling", () => {
  it("returns null when the station list request is not ok", async () => {
    const fetchMock = routeFetch([{ match: STATIONS_URL, respond: () => jsonResponse({}, 503) }]);
    vi.stubGlobal("fetch", fetchMock);

    expect(await getTides(40, -70)).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns null when the payload has no station array", async () => {
    const fetchMock = routeFetch([{ match: STATIONS_URL, respond: () => jsonResponse({ stations: "nope" }) }]);
    vi.stubGlobal("fetch", fetchMock);

    expect(await getTides(40, -70)).toBeNull();
  });

  it("returns null when the payload is empty", async () => {
    const fetchMock = routeFetch([{ match: STATIONS_URL, respond: () => jsonResponse({}) }]);
    vi.stubGlobal("fetch", fetchMock);

    expect(await getTides(40, -70)).toBeNull();
  });

  it("returns null when no station has usable coordinates", async () => {
    const fetchMock = routeFetch([
      {
        match: STATIONS_URL,
        respond: () => jsonResponse({ stations: [{ id: "x", name: "x" }, { id: "y", name: "y" }] }),
      },
    ]);
    vi.stubGlobal("fetch", fetchMock);

    expect(await getTides(40, -70)).toBeNull();
  });

  it("returns null when the station request rejects (network failure)", async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    vi.stubGlobal("fetch", fetchMock);

    expect(await getTides(40, -70)).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns null when the prediction request is not ok", async () => {
    const fetchMock = routeFetch([
      { match: STATIONS_URL, respond: () => jsonResponse({ stations: [station("A", "A", "0.1", "0.2")] }) },
      { match: PREDICTIONS_URL, respond: () => jsonResponse({ error: "boom" }, 500) },
    ]);
    vi.stubGlobal("fetch", fetchMock);

    const result = await getTides(0, 0);
    expect(result).not.toBeNull();
    expect(result?.station.id).toBe("A");
    expect(result?.predictions).toEqual([]);
  });

  it("returns empty predictions when the payload has no predictions array", async () => {
    const fetchMock = routeFetch([
      { match: STATIONS_URL, respond: () => jsonResponse({ stations: [station("A", "A", "0.1", "0.2")] }) },
      { match: PREDICTIONS_URL, respond: () => jsonResponse({ error: "No data was found" }) },
    ]);
    vi.stubGlobal("fetch", fetchMock);

    const result = await getTides(0, 0);
    expect(result?.predictions).toEqual([]);
  });

  it("returns null when the prediction payload is malformed JSON (caught by getTides)", async () => {
    const fetchMock = routeFetch([
      { match: STATIONS_URL, respond: () => jsonResponse({ stations: [station("A", "A", "0.1", "0.2")] }) },
      {
        match: PREDICTIONS_URL,
        respond: () => new Response("<html>gateway error</html>", { status: 200, headers: { "Content-Type": "text/html" } }),
      },
    ]);
    vi.stubGlobal("fetch", fetchMock);

    expect(await getTides(0, 0)).toBeNull();
  });
});

describe("getTides — request shape", () => {
  it("requests today and tomorrow in MLLW english hilo json form", async () => {
    const fetchMock = routeFetch([
      { match: STATIONS_URL, respond: () => jsonResponse({ stations: [station("A", "A", "0.1", "0.2")] }) },
      {
        match: PREDICTIONS_URL,
        respond: (url) => {
          const params = new URL(url).searchParams;
          expect(params.get("product")).toBe("predictions");
          expect(params.get("application")).toBe("NOS.COOPS.TAC.WL");
          expect(params.get("datum")).toBe("MLLW");
          expect(params.get("time_zone")).toBe("lst_ldt");
          expect(params.get("units")).toBe("english");
          expect(params.get("interval")).toBe("hilo");
          expect(params.get("format")).toBe("json");
          expect(params.get("begin_date")).toBe(new Date().toISOString().slice(0, 10));
          const tomorrow = new Date();
          tomorrow.setDate(tomorrow.getDate() + 1);
          expect(params.get("end_date")).toBe(tomorrow.toISOString().slice(0, 10));
          return jsonResponse({ predictions: [] });
        },
      },
    ]);
    vi.stubGlobal("fetch", fetchMock);

    await getTides(0, 0);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const stationUrl = String(fetchMock.mock.calls[0][0]);
    expect(stationUrl).toContain("type=tidestations");
    expect(String(fetchMock.mock.calls[1][0])).toContain("datagetter");
  });

  it("parses fractional and integer heights from the v field", async () => {
    const fetchMock = routeFetch([
      { match: STATIONS_URL, respond: () => jsonResponse({ stations: [station("A", "A", "0.1", "0.2")] }) },
      {
        match: PREDICTIONS_URL,
        respond: () =>
          jsonResponse({
            predictions: [
              { t: "2026-01-01 00:00", v: "-1.5", type: "L" },
              { t: "2026-01-01 06:00", v: "4", type: "H" },
              { t: "2026-01-01 12:00", v: "12.0625", type: "H" },
            ],
          }),
      },
    ]);
    vi.stubGlobal("fetch", fetchMock);

    const result = await getTides(0, 0);
    expect(result?.predictions.map((p) => p.height)).toEqual([-1.5, 4, 12.0625]);
    expect(result?.predictions.map((p) => p.typeLabel)).toEqual(["Low", "High", "High"]);
    expect(result?.predictions.every((p) => p.type === "L" || p.type === "H")).toBe(true);
  });
});
