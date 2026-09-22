import { describe, it, expect } from "vitest";

/**
 * Tests for /api/gps-jamming — the static GPS interference hex list.
 *
 * The route is a stub with no outbound dependencies, so the suite pins the
 * response shape, the hex payload invariants, and the CORS/cache headers.
 */

import { GET, OPTIONS } from "@/app/api/gps-jamming/route";

interface JammingHex {
  lat: number;
  lon: number;
  resolution: number;
  intensity: number;
  source: string;
  timestamp: string;
}

describe("GPS jamming API (/api/gps-jamming)", () => {
  it("returns a hex list with CORS and a 10-minute cache policy", async () => {
    const resp = await GET();
    expect(resp.status).toBe(200);
    expect(resp.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(resp.headers.get("Access-Control-Allow-Methods")).toContain("GET");
    expect(resp.headers.get("Cache-Control")).toBe("public, max-age=600");

    const body = (await resp.json()) as { hexes: JammingHex[] };
    expect(Array.isArray(body.hexes)).toBe(true);
    expect(body.hexes.length).toBeGreaterThan(0);
  });

  it("emits every documented field on each hex", async () => {
    const resp = await GET();
    const body = (await resp.json()) as { hexes: JammingHex[] };

    for (const hex of body.hexes) {
      expect(Object.keys(hex).sort()).toEqual([
        "intensity",
        "lat",
        "lon",
        "resolution",
        "source",
        "timestamp",
      ]);
      expect(hex.source).toBe("ADS-B Analysis");
      expect(hex.resolution).toBe(6);
      expect(Number.isNaN(Date.parse(hex.timestamp))).toBe(false);
    }
  });

  it("keeps coordinates and intensities in their valid ranges", async () => {
    const resp = await GET();
    const body = (await resp.json()) as { hexes: JammingHex[] };

    for (const hex of body.hexes) {
      expect(hex.lat).toBeGreaterThanOrEqual(-90);
      expect(hex.lat).toBeLessThanOrEqual(90);
      expect(hex.lon).toBeGreaterThanOrEqual(-180);
      expect(hex.lon).toBeLessThanOrEqual(180);
      expect(hex.intensity).toBeGreaterThan(0);
      expect(hex.intensity).toBeLessThanOrEqual(1);
    }
  });

  it("covers the documented interference zones", async () => {
    const resp = await GET();
    const body = (await resp.json()) as { hexes: JammingHex[] };

    const zones = {
      ukraine: body.hexes.filter((h) => h.lat > 45 && h.lat < 53 && h.lon > 25 && h.lon < 40),
      middleEast: body.hexes.filter((h) => h.lat > 27 && h.lat < 36 && h.lon > 30 && h.lon < 50),
      taiwan: body.hexes.filter((h) => h.lat > 22 && h.lat < 26 && h.lon > 115 && h.lon < 122),
      korea: body.hexes.filter((h) => h.lat > 36 && h.lat < 39 && h.lon > 125 && h.lon < 129),
    };

    for (const [zone, hexes] of Object.entries(zones)) {
      expect(hexes.length, zone).toBeGreaterThan(0);
    }
  });

  it("exposes CORS preflight", async () => {
    const resp = await OPTIONS();
    expect(resp.status).toBe(204);
    expect(resp.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(resp.headers.get("Access-Control-Allow-Headers")).toBe("Content-Type");
  });
});
