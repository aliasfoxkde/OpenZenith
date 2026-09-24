import { describe, it, expect, vi } from "vitest";
import type { NextRequest } from "next/server";
import { mockRequest } from "./helpers";

describe("Collections API", () => {
  it("returns list of collections", async () => {
    const { GET } = await import("@/app/api/collections/route");
    const resp = GET(mockRequest("/api/collections"));
    expect(resp.status).toBe(200);
    const data = await resp.json();
    expect(data.collections).toBeTruthy();
    expect(data.collections.length).toBeGreaterThan(0);
    expect(data.links).toBeTruthy();
  });

  it("returns a 500 error payload when the request URL cannot be parsed", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { GET } = await import("@/app/api/collections/route");
    const resp = GET({ url: "not-a-url" } as unknown as NextRequest);
    expect(resp.status).toBe(500);
    expect(await resp.json()).toEqual({ error: "Failed to fetch collections" });
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});

describe("Collection by ID API", () => {
  it("returns collection metadata for valid ID", async () => {
    const { GET } = await import("@/app/api/collections/[id]/route");
    const resp = await GET(mockRequest("/api/collections/earthquakes"), {
      params: Promise.resolve({ id: "earthquakes" }),
    });
    expect(resp.status).toBe(200);
    const data = await resp.json();
    expect(data.id).toBe("earthquakes");
    expect(data.title).toBe("Earthquakes");
  });

  it("returns 404 for invalid collection ID", async () => {
    const { GET } = await import("@/app/api/collections/[id]/route");
    const resp = await GET(mockRequest("/api/collections/nonexistent"), {
      params: Promise.resolve({ id: "nonexistent" }),
    });
    expect(resp.status).toBe(404);
  });
});

describe("Collection Items API", () => {
  it("returns 404 for invalid collection ID", async () => {
    const { GET } = await import("@/app/api/collections/[id]/items/route");
    const resp = await GET(mockRequest("/api/collections/nonexistent/items"), {
      params: Promise.resolve({ id: "nonexistent" }),
    });
    expect(resp.status).toBe(404);
  });
});
