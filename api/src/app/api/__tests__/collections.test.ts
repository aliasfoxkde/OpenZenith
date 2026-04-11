import { describe, it, expect } from "vitest";

describe("Collections API", () => {
  it("returns list of collections", async () => {
    const { GET } = await import("@/app/api/collections/route");
    const resp = await GET(new Request("http://localhost/api/collections"));
    expect(resp.status).toBe(200);
    const data = await resp.json();
    expect(data.collections).toBeTruthy();
    expect(data.collections.length).toBeGreaterThan(0);
    expect(data.links).toBeTruthy();
  });
});

describe("Collection by ID API", () => {
  it("returns collection metadata for valid ID", async () => {
    const { GET } = await import("@/app/api/collections/[id]/route");
    const resp = await GET(new Request("http://localhost/api/collections/earthquakes"), { params: Promise.resolve({ id: "earthquakes" }) });
    expect(resp.status).toBe(200);
    const data = await resp.json();
    expect(data.id).toBe("earthquakes");
    expect(data.title).toBe("Earthquakes");
  });

  it("returns 404 for invalid collection ID", async () => {
    const { GET } = await import("@/app/api/collections/[id]/route");
    const resp = await GET(new Request("http://localhost/api/collections/nonexistent"), { params: Promise.resolve({ id: "nonexistent" }) });
    expect(resp.status).toBe(404);
  });
});

describe("Collection Items API", () => {
  it("returns 404 for invalid collection ID", async () => {
    const { GET } = await import("@/app/api/collections/[id]/items/route");
    const resp = await GET(new Request("http://localhost/api/collections/nonexistent/items"), { params: Promise.resolve({ id: "nonexistent" }) });
    expect(resp.status).toBe(404);
  });
});
