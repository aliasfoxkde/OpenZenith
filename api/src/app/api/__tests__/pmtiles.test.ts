import { describe, it, expect } from "vitest";
import { mockRequest, bodyAs } from "./helpers";

interface PmtilesBody {
  error: string;
  message: string;
  alternatives: Array<{ type: string; url: string; format: string }>;
}

function getKey(key: string) {
  return {
    request: mockRequest(`/api/pmtiles/${key}`),
    ctx: { params: Promise.resolve({ key }) },
  };
}

async function getForKey(key: string) {
  const { GET } = await import("@/app/api/pmtiles/[key]/route");
  const { request, ctx } = getKey(key);
  return GET(request, ctx);
}

describe("PMTiles API (archive redirect)", () => {
  it("302-redirects a built archive key to HuggingFace", async () => {
    const resp = await getForKey("z7.pmtiles");
    expect(resp.status).toBe(302);
    const location = resp.headers.get("Location");
    expect(location).toBeTruthy();
    expect(location).toContain("huggingface.co/datasets/aliasfox/srtm30m-terrain-pmtiles/resolve/main/");
    expect(location?.endsWith("/z7.pmtiles")).toBe(true);
  });

  it("caches the redirect and keeps CORS headers on it", async () => {
    const resp = await getForKey("z7.pmtiles");
    expect(resp.headers.get("Cache-Control")).toBe("public, max-age=86400");
    expect(resp.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(resp.headers.get("Access-Control-Allow-Methods")).toContain("GET");
  });

  it("answers 410 with the not-built message for an unbuilt zoom", async () => {
    const resp = await getForKey("z12.pmtiles");
    expect(resp.status).toBe(410);
    const data = await bodyAs<PmtilesBody>(resp);
    expect(data.error).toContain("not available");
    expect(data.message).toContain("archive not built for");
    expect(data.message).toContain("available: z7");
    expect(data.alternatives.length).toBeGreaterThan(0);
  });

  it("answers 410 for a key outside the z<zoom>.pmtiles grammar", async () => {
    const resp = await getForKey("terrain");
    expect(resp.status).toBe(410);
    const data = await bodyAs<PmtilesBody>(resp);
    expect(data.message).toContain("z<zoom>.pmtiles");
  });

  it("lists alternative endpoints on the 410 body", async () => {
    const data = await bodyAs<PmtilesBody>(await getForKey("z8.pmtiles"));
    const urls = data.alternatives.map((a) => a.url);
    expect(urls).toContain("/api/dem-tile/{z}/{x}/{y}");
    expect(urls).toContain("/api/elevation?lat={lat}&lon={lon}");
    expect(urls.some((u) => u.startsWith("/api/pmtiles/z7.pmtiles"))).toBe(true);
  });

  it("answers CORS preflight", async () => {
    const { OPTIONS } = await import("@/app/api/pmtiles/[key]/route");
    const resp = await OPTIONS();
    expect(resp.status).toBe(204);
    expect(resp.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });
});
