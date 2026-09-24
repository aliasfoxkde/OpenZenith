import { describe, it, expect, vi } from "vitest";
import { mockRequest } from "./helpers";
import { getTileData } from "@/lib/tile";

vi.mock("@/lib/tile", () => ({
  getTileData: vi.fn().mockResolvedValue({
    data: new Int16Array([100, 200, 150, 250, 300, 350, 400, 450, 500]),
    width: 3,
    height: 3,
  }),
}));

// Let the route's tile math run normally unless a test pins a failure to a
// marker latitude (the 400-validation above never reaches zoom-math).
const notAnError: unknown = { fatal: "not an Error instance" };
vi.mock("@/lib/srtm/zoom-math", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/srtm/zoom-math")>();
  return {
    ...actual,
    latLonToTile: vi.fn((lat: number, lon: number, zoom: number) => {
      if (lat === 77.77) throw new Error("tile math exploded");
      if (lat === 77.78) throw notAnError;
      return actual.latLonToTile(lat, lon, zoom);
    }),
  };
});

/** Typed body reader keeps the new assertions off the unsafe-any lint path. */
async function jsonBody(
  resp: Response,
): Promise<{ results?: { id?: string; elevation: number | null }[]; error?: string }> {
  return (await resp.json()) as { results?: { id?: string; elevation: number | null }[]; error?: string };
}

describe("Elevation Batch API", () => {
  it("answers CORS preflight requests", async () => {
    const { OPTIONS } = await import("@/app/api/elevation/batch/route");
    const resp = OPTIONS();
    expect(resp.status).toBe(204);
    expect(resp.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("returns elevations for valid points", async () => {
    const { POST } = await import("@/app/api/elevation/batch/route");
    const req = mockRequest(
      "/api/elevation/batch",
      "POST",
      JSON.stringify({
        points: [
          { lat: 40.7, lon: -74.0 },
          { lat: 51.5, lon: -0.1 },
        ],
      }),
    );
    const resp = await POST(req);
    expect(resp.status).toBe(200);
    const data = await resp.json();
    expect(data.results).toHaveLength(2);
    expect(data.results[0].lat).toBe(40.7);
    expect(data.results[0].lon).toBe(-74.0);
    expect(typeof data.results[0].elevation).toBe("number");
  });

  it("rejects empty points array", async () => {
    const { POST } = await import("@/app/api/elevation/batch/route");
    const req = mockRequest("/api/elevation/batch", "POST", JSON.stringify({ points: [] }));
    const resp = await POST(req);
    expect(resp.status).toBe(400);
  });

  it("rejects more than 2000 points", async () => {
    const { POST } = await import("@/app/api/elevation/batch/route");
    const points = Array.from({ length: 2001 }, (_, i) => ({ lat: 0, lon: i * 0.01 }));
    const req = mockRequest("/api/elevation/batch", "POST", JSON.stringify({ points }));
    const resp = await POST(req);
    expect(resp.status).toBe(400);
  });

  it("rejects invalid coordinates", async () => {
    const { POST } = await import("@/app/api/elevation/batch/route");
    const req = mockRequest("/api/elevation/batch", "POST", JSON.stringify({ points: [{ lat: 999, lon: 0 }] }));
    const resp = await POST(req);
    expect(resp.status).toBe(400);
  });

  it("rejects invalid JSON", async () => {
    const { POST } = await import("@/app/api/elevation/batch/route");
    const req = mockRequest("/api/elevation/batch", "POST", "not json");
    const resp = await POST(req);
    expect(resp.status).toBe(400);
  });

  it("preserves optional id field", async () => {
    const { POST } = await import("@/app/api/elevation/batch/route");
    const req = mockRequest(
      "/api/elevation/batch",
      "POST",
      JSON.stringify({ points: [{ lat: 40.7, lon: -74.0, id: "nyc" }] }),
    );
    const resp = await POST(req);
    const data = await resp.json();
    expect(data.results[0].id).toBe("nyc");
  });

  it("groups points that share a tile into one fetch", async () => {
    const { POST } = await import("@/app/api/elevation/batch/route");
    const fetchesBefore = vi.mocked(getTileData).mock.calls.length;
    const req = mockRequest(
      "/api/elevation/batch",
      "POST",
      JSON.stringify({
        points: [
          { lat: 40.7001, lon: -74.0001 },
          { lat: 40.7002, lon: -74.0002 },
        ],
      }),
    );
    const resp = await POST(req);
    const data = await jsonBody(resp);
    expect(data.results).toHaveLength(2);
    expect(vi.mocked(getTileData).mock.calls.length).toBe(fetchesBefore + 1);
  });

  it("returns null elevation when the whole sampled neighbourhood is nodata", async () => {
    vi.mocked(getTileData).mockResolvedValueOnce({
      data: new Int16Array(9).fill(-32768),
      width: 3,
      height: 3,
      zoom: 12,
    });
    const { POST } = await import("@/app/api/elevation/batch/route");
    const req = mockRequest("/api/elevation/batch", "POST", JSON.stringify({ points: [{ lat: 40.7, lon: -74.0 }] }));
    const resp = await POST(req);
    const data = await jsonBody(resp);
    expect(data.results?.[0].elevation).toBeNull();
  });

  it("reports null for points whose tile fails to load, without failing the batch", async () => {
    vi.mocked(getTileData).mockRejectedValueOnce(new Error("upstream 500"));
    const { POST } = await import("@/app/api/elevation/batch/route");
    // Two different z12 tiles: the first fails, the second uses the default mock.
    const req = mockRequest(
      "/api/elevation/batch",
      "POST",
      JSON.stringify({
        points: [
          { lat: 40.7, lon: -74.0 },
          { lat: 51.5, lon: -0.1 },
        ],
      }),
    );
    const resp = await POST(req);
    const data = await jsonBody(resp);
    expect(data.results?.[0].elevation).toBeNull();
    expect(typeof data.results?.[1].elevation).toBe("number");
  });

  it("passes an Error's message through when tile math throws", async () => {
    const { POST } = await import("@/app/api/elevation/batch/route");
    const req = mockRequest("/api/elevation/batch", "POST", JSON.stringify({ points: [{ lat: 77.77, lon: 0 }] }));
    const resp = await POST(req);
    expect(resp.status).toBe(200);
    expect(await resp.json()).toEqual({ error: "tile math exploded" });
  });

  it("reports Unknown error for non-Error throws", async () => {
    const { POST } = await import("@/app/api/elevation/batch/route");
    const req = mockRequest("/api/elevation/batch", "POST", JSON.stringify({ points: [{ lat: 77.78, lon: 0 }] }));
    const resp = await POST(req);
    expect(resp.status).toBe(200);
    expect(await resp.json()).toEqual({ error: "Unknown error" });
  });
});
