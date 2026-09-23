import { describe, it, expect, vi } from "vitest";
import { mockRequest } from "./helpers";

// A full 17-element OpenSky state vector, in the documented index order.
const FULL_STATE = [
  "abc123", // 0 icao24
  "  DAL123  ", // 1 callsign
  "United States", // 2 origin_country
  1700000000, // 3 time_position
  1700000100, // 4 last_contact
  -74.01, // 5 longitude
  40.7, // 6 latitude
  10500, // 7 baro_altitude
  false, // 8 on_ground
  240.5, // 9 velocity
  92, // 10 true_track
  -1.2, // 11 vertical_rate
  [1, 2], // 12 sensors
  10800, // 13 geo_altitude
  "1200", // 14 squawk
  false, // 15 spi
  1, // 16 position_source
];

// Same vector but with the callsign slot omitted upstream — the slimmer must
// coerce that to null rather than crash on .trim().
const NO_CALLSIGN_STATE = FULL_STATE.map((v, i) => (i === 1 ? null : v));

const SLIMMED_FULL_STATE = {
  icao24: "abc123",
  callsign: "DAL123",
  origin_country: "United States",
  longitude: -74.01,
  latitude: 40.7,
  baro_altitude: 10500,
  on_ground: false,
  velocity: 240.5,
  true_track: 92,
  vertical_rate: -1.2,
  squawk: "1200",
  position_source: 1,
};

describe("Flights API", () => {
  it("returns flight data from OpenSky", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ states_count: 100, states: [] }), { status: 200 }),
    );

    const { GET } = await import("@/app/api/flights/route");
    const resp = await GET(mockRequest("/api/flights"));
    expect(resp.status).toBe(200);
    const data = await resp.json();
    expect(data).toHaveProperty("states");
  });

  it("passes bbox params to upstream", async () => {
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ states_count: 0, states: [] }), { status: 200 }));

    const { GET } = await import("@/app/api/flights/route");
    await GET(mockRequest("/api/flights?lamin=40&lamax=42&lomin=-74&lomax=-72"));

    const calledUrl = spy.mock.calls[0][0] as string;
    expect(calledUrl).toContain("lamin=40");
    expect(calledUrl).toContain("lamax=42");
  });

  it("returns empty array on upstream failure", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("error", { status: 500 }));

    const { GET } = await import("@/app/api/flights/route");
    const resp = await GET(mockRequest("/api/flights"));
    expect(resp.status).toBe(200);
    const data = await resp.json();
    expect(data.states).toEqual([]);
    expect(data.error).toBeDefined();
  });

  it("exposes CORS preflight", async () => {
    const { OPTIONS } = await import("@/app/api/flights/route");
    const resp = OPTIONS();
    expect(resp.status).toBe(204);
    expect(resp.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("rejects a partial or out-of-range bbox with 400", async () => {
    const { GET } = await import("@/app/api/flights/route");
    const resp = await GET(mockRequest("/api/flights?lamin=40&lamax=200"));
    expect(resp.status).toBe(400);
    const data = await resp.json();
    expect(data.error).toContain("Invalid bbox params");
  });

  it("forwards the bbox query param to upstream", async () => {
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ time: 1, states: [] }), { status: 200 }));

    const { GET } = await import("@/app/api/flights/route");
    await GET(mockRequest("/api/flights?bbox=eur"));

    const calledUrl = spy.mock.calls[0][0] as string;
    expect(calledUrl).toContain("bbox=eur");
  });

  it("slims state vectors, dropping heavy fields and trimming callsigns", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ time: 1700000100, states: [FULL_STATE, NO_CALLSIGN_STATE] }), { status: 200 }),
    );

    const { GET } = await import("@/app/api/flights/route");
    const resp = await GET(mockRequest("/api/flights"));
    expect(resp.status).toBe(200);
    expect(resp.headers.get("Cache-Control")).toBe("public, max-age=60");

    const data = await resp.json();
    expect(data.time).toBe(1700000100);
    expect(data.states).toHaveLength(2);
    // time_position, last_contact, sensors, geo_altitude and spi are all gone.
    expect(data.states[0]).toEqual(SLIMMED_FULL_STATE);
    expect(data.states[1].callsign).toBeNull();
  });

  it("slims state vectors for bbox-scoped requests too", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ time: 1, states: [FULL_STATE] }), { status: 200 }),
    );

    const { GET } = await import("@/app/api/flights/route");
    const resp = await GET(mockRequest("/api/flights?lamin=40&lamax=42&lomin=-74&lomax=-72"));
    const data = await resp.json();
    expect(data.states).toEqual([SLIMMED_FULL_STATE]);
  });

  it("returns an empty state list when upstream omits states", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify({ time: 5 }), { status: 200 }));

    const { GET } = await import("@/app/api/flights/route");
    const resp = await GET(mockRequest("/api/flights"));
    const data = await resp.json();
    expect(data.states).toEqual([]);
  });

  it("returns 200 with the thrown message when upstream fetch rejects", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("socket hang up"));

    const { GET } = await import("@/app/api/flights/route");
    const resp = await GET(mockRequest("/api/flights"));
    expect(resp.status).toBe(200);
    const data = await resp.json();
    expect(data.states).toEqual([]);
    expect(data.error).toBe("socket hang up");
  });

  it("falls back to a generic message when the rejection is not an Error", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce("timed out");

    const { GET } = await import("@/app/api/flights/route");
    const resp = await GET(mockRequest("/api/flights"));
    expect(resp.status).toBe(200);
    const data = await resp.json();
    expect(data.error).toBe("Flight data fetch failed");
  });
});
