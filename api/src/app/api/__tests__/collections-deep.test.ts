import { describe, it, expect } from "vitest";
import { mockRequest } from "./helpers";

describe("Collection by ID — extended", () => {
  it("returns metadata for each known collection", async () => {
    const { GET } = await import("@/app/api/collections/[id]/route");
    const ids = ["earthquakes", "natural_events", "wildfires", "nlnog_nodes", "warnings", "waterways"];
    for (const id of ids) {
      const resp = await GET(mockRequest(`/api/collections/${id}`), {
        params: Promise.resolve({ id }),
      });
      expect(resp.status).toBe(200);
      const data = await resp.json();
      expect(data.id).toBe(id);
      expect(data.title).toBeTruthy();
      expect(data.links).toBeTruthy();
      expect(data.extent.spatial.bbox).toBeTruthy();
    }
  });

  it("includes self, items, and root links", async () => {
    const { GET } = await import("@/app/api/collections/[id]/route");
    const resp = await GET(mockRequest("/api/collections/wildfires"), {
      params: Promise.resolve({ id: "wildfires" }),
    });
    const data = await resp.json();
    const rels = data.links.map((l: { rel: string }) => l.rel);
    expect(rels).toContain("self");
    expect(rels).toContain("items");
    expect(rels).toContain("root");
  });
});

describe("Collection Items — extended", () => {
  it("OPTIONS returns CORS headers", async () => {
    const { OPTIONS } = await import("@/app/api/collections/[id]/items/route");
    const resp = await OPTIONS();
    expect(resp.status).toBe(200);
    expect(resp.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });
});
