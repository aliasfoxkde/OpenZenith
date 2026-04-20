import { describe, it, expect, vi } from "vitest";
import { mockRequest } from "./helpers";


describe("OpenSky Flights API", () => {
  it("returns flight data with credit headers", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ states_count: 50, states: [] }), { status: 200 }),
    );

    const { GET } = await import("@/app/api/opensky/flights/route");
    const resp = await GET(mockRequest("/api/opensky/flights?lamin=40&lamax=42&lomin=-74&lomax=-72"));
    expect(resp.status).toBe(200);
    expect(resp.headers.get("X-Credits-Used")).toBeTruthy();
    expect(resp.headers.get("X-Authenticated")).toBe("false");
  });

  it("returns error when upstream fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("error", { status: 500 }));

    const { GET } = await import("@/app/api/opensky/flights/route");
    const resp = await GET(mockRequest("/api/opensky/flights"));
    expect(resp.status).toBe(200);
  });
});

describe("OpenSky Token API", () => {
  it("returns 503 when credentials not configured", async () => {
    const { GET } = await import("@/app/api/opensky/token/route");
    const resp = await GET();
    expect(resp.status).toBe(200);
    const data = await resp.json();
    expect(data.error).toContain("token");
  });
});
