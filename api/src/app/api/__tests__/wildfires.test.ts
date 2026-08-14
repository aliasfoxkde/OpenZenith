import { describe, it, expect, vi } from "vitest";

// Mock env vars
const originalEnv = process.env;

function createMockRequest(url: string) {
  return { url } as unknown as import("next/server").NextRequest;
}

describe("Wildfires API", () => {
  it("returns empty features when no API key is configured", async () => {
    // Temporarily remove the key
    process.env = { ...originalEnv, FIRMS_MAP_KEY: "" };

    const { GET } = await import("@/app/api/wildfires/route");
    const resp = await GET(createMockRequest("https://example.com/api/wildfires"));
    const data = await resp.json();
    expect(data.type).toBe("FeatureCollection");
    expect(data.features).toHaveLength(0);
    expect(data.error).toContain("not configured");

    process.env = originalEnv;
  });

  it("accepts custom bbox and days parameters", async () => {
    process.env = { ...originalEnv, FIRMS_MAP_KEY: "test-key" };
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        "latitude,longitude,brightness,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_t31,frp,daynight",
        {
          status: 200,
        },
      ),
    );

    const { GET } = await import("@/app/api/wildfires/route");
    const resp = await GET(createMockRequest("https://example.com/api/wildfires?days=3&bbox=-130,25,-60,50"));
    const data = await resp.json();
    expect(data.type).toBe("FeatureCollection");
    expect(data.days).toBe(3);
    expect(data.bbox).toBe("-130,25,-60,50");

    process.env = originalEnv;
  });
});
