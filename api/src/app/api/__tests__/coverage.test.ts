import { describe, it, expect } from "vitest";
import { GET, OPTIONS } from "@/app/api/coverage/route";

describe("Coverage dataset metadata API", () => {
  it("returns the dataset registry with tile endpoint", async () => {
    const resp = await GET();
    expect(resp.status).toBe(200);
    expect(resp.headers.get("Access-Control-Allow-Origin")).toBeDefined();
    expect(resp.headers.get("Cache-Control")).toContain("max-age");

    const body = await resp.json();
    expect(Array.isArray(body.datasets)).toBe(true);
    expect(body.tileEndpoint).toBe("/api/elevation-accuracy/{z}/{x}/{y}");

    const ids = body.datasets.map((d: { id: string }) => d.id);
    expect(ids).toContain("srtm_glo30");
    expect(ids).toContain("gebco");
    expect(ids).toContain("arcticdem");
  });

  it("every dataset carries resolution, source and coverage metadata", async () => {
    const body = await (await GET()).json();
    for (const d of body.datasets) {
      expect(typeof d.id).toBe("string");
      expect(typeof d.name).toBe("string");
      expect(typeof d.resolution).toBe("number");
      expect(d.resolution).toBeGreaterThan(0);
      expect(typeof d.source).toBe("string");
      expect(d.coverage).toBeDefined();
      expect(typeof d.color).toBe("string");
    }
  });

  it("exposes CORS preflight", async () => {
    const resp = await OPTIONS();
    expect(resp.headers.get("Access-Control-Allow-Origin")).toBeDefined();
  });
});
