import { describe, it, expect } from "vitest";
import { bodyAs } from "./helpers";
import { GET, OPTIONS } from "@/app/api/coverage/route";

/**
 * Coverage registry response — the per-dataset fields asserted on. `coverage`
 * is only checked for presence, so it stays `unknown`.
 */
interface CoverageBody {
  datasets: Array<{
    id: string;
    name: string;
    resolution: number;
    source: string;
    coverage: unknown;
    color: string;
  }>;
  tileEndpoint: string;
}

describe("Coverage dataset metadata API", () => {
  it("returns the dataset registry with tile endpoint", async () => {
    const resp = await GET();
    expect(resp.status).toBe(200);
    expect(resp.headers.get("Access-Control-Allow-Origin")).toBeDefined();
    expect(resp.headers.get("Cache-Control")).toContain("max-age");

    const body = await bodyAs<CoverageBody>(resp);
    expect(Array.isArray(body.datasets)).toBe(true);
    expect(body.tileEndpoint).toBe("/api/elevation-accuracy/{z}/{x}/{y}");

    const ids = body.datasets.map((d) => d.id);
    expect(ids).toContain("srtm_glo30");
    expect(ids).toContain("gebco");
    expect(ids).toContain("arcticdem");
  });

  it("every dataset carries resolution, source and coverage metadata", async () => {
    const body = await bodyAs<CoverageBody>(await GET());
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
