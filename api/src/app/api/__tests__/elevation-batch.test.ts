import { describe, it, expect, vi } from "vitest";
import { mockRequest } from "./helpers";

vi.mock("@/lib/tile", () => ({
  getTileData: vi.fn().mockResolvedValue({
    data: new Int16Array([100, 200, 150, 250, 300, 350, 400, 450, 500]),
    width: 3,
    height: 3,
  }),
}));

describe("Elevation Batch API", () => {
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
});
