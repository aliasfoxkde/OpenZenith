import { describe, it, expect } from "vitest";
import { bodyAs } from "./helpers";

interface PmtilesBody {
  error: string;
  message: string;
  alternatives: Array<{ type: string; url: string; format: string }>;
}

describe("PMTiles API (deprecated)", () => {
  it("returns 410 Gone", async () => {
    const { GET } = await import("@/app/api/pmtiles/[key]/route");
    const resp = await GET();
    expect(resp.status).toBe(410);
    const data = await bodyAs<PmtilesBody>(resp);
    expect(data.error).toContain("deprecated");
    expect(data.alternatives).toBeTruthy();
    expect(data.alternatives.length).toBeGreaterThan(0);
  });

  it("lists alternative endpoints", async () => {
    const { GET } = await import("@/app/api/pmtiles/[key]/route");
    const data = await bodyAs<PmtilesBody>(await GET());
    const urls = data.alternatives.map((a) => a.url);
    expect(urls).toContain("/api/dem-tile/{z}/{x}/{y}");
    expect(urls).toContain("/api/elevation?lat={lat}&lon={lon}");
  });

  it("answers CORS preflight", async () => {
    const { OPTIONS } = await import("@/app/api/pmtiles/[key]/route");
    const resp = await OPTIONS();
    expect(resp.status).toBe(204);
    expect(resp.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });
});
