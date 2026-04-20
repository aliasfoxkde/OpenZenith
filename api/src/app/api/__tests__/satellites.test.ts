import { describe, it, expect, vi } from "vitest";
import { mockRequest } from "./helpers";

describe("Satellites API", () => {
  it("returns satellite data from Celestrak", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify([{ name: "ISS (ZARYA)", norad_cat_id: 25544 }]), { status: 200 }),
    );

    const { GET } = await import("@/app/api/satellites/route");
    const resp = await GET(mockRequest("/api/satellites?group=active"));
    expect(resp.status).toBe(200);
    const data = await resp.json();
    expect(data.satellites).toBeDefined();
    expect(data.satellites[0].name).toBe("ISS (ZARYA)");
  });

  it("rejects invalid group", async () => {
    const { GET } = await import("@/app/api/satellites/route");
    const resp = await GET(mockRequest("/api/satellites?group=invalid_group"));
    expect(resp.status).toBe(400);
    const data = await resp.json();
    expect(data.error).toContain("Invalid group");
  });

  it("defaults to stations group", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }));

    const { GET } = await import("@/app/api/satellites/route");
    await GET(mockRequest("/api/satellites"));

    const calledUrl = spy.mock.calls[0][0] as string;
    expect(calledUrl).toContain("GROUP=stations");
  });
});
