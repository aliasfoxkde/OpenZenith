import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/cache", () => ({
  cachedFetch: vi.fn((url: string) => fetch(url)),
  CACHE_TTL: { FLIGHTS: 15, EARTHQUAKES: 60, NLNOG: 3600 },
}));

describe("Flights API", () => {
  it("returns flight data from OpenSky", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ states_count: 100, states: [] }), { status: 200 }),
    );

    const { GET } = await import("@/app/api/flights/route");
    const resp = await GET(new Request("http://localhost/api/flights"));
    expect(resp.status).toBe(200);
    const data = await resp.json();
    expect(data).toHaveProperty("states");
  });

  it("passes bbox params to upstream", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ states_count: 0, states: [] }), { status: 200 }),
    );

    const { GET } = await import("@/app/api/flights/route");
    await GET(new Request("http://localhost/api/flights?lamin=40&lamax=42&lomin=-74&lomax=-72"));

    const calledUrl = spy.mock.calls[0][0] as string;
    expect(calledUrl).toContain("lamin=40");
    expect(calledUrl).toContain("lamax=42");
  });

  it("returns error on upstream failure", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("error", { status: 500 }));

    const { GET } = await import("@/app/api/flights/route");
    const resp = await GET(new Request("http://localhost/api/flights"));
    expect(resp.status).toBe(502);
  });
});
