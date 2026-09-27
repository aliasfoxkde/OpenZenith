import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  apiCacheKey,
  edgeGetJson,
  edgeGetTile,
  edgePutJson,
  edgePutTile,
  RENDER_SCHEMA_VERSION,
  setEdgeCacheProvider,
} from "../storage/edge-cache";

// The global setup file mocks this module for route tests; these unit tests
// exercise the real implementation, so restore it file-locally.
vi.mock("@/lib/storage/edge-cache", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/storage/edge-cache")>();
  return { ...actual };
});

/**
 * In-memory Cache API double keyed by URL, so the edge-cache helpers can be
 * exercised without a Workers runtime.
 */
/** The edge-cache helpers always address entries with absolute URL strings. */
function keyToString(key: RequestInfo | URL): string {
  if (typeof key === "string") return key;
  if (key instanceof URL) return key.href;
  return key.url;
}

function makeCacheStore() {
  const entries = new Map<string, Response>();
  const store = {
    open: vi.fn(() =>
      Promise.resolve({
        match: vi.fn((key: RequestInfo | URL) => {
          const hit = entries.get(keyToString(key));
          return hit ? Promise.resolve(hit.clone()) : Promise.resolve(undefined);
        }),
        put: vi.fn((key: RequestInfo | URL, response: Response) => {
          entries.set(keyToString(key), response);
          return Promise.resolve();
        }),
      }),
    ),
  };
  return { store, entries };
}

const asciiBuf = (text: string): ArrayBuffer => new TextEncoder().encode(text).buffer;

let cache: ReturnType<typeof makeCacheStore>;

beforeEach(() => {
  cache = makeCacheStore();
  setEdgeCacheProvider(() => cache.store);
});

afterEach(() => {
  setEdgeCacheProvider(null);
});

describe("edge-cache tiles", () => {
  it("round-trips a tile through put then get", async () => {
    await edgePutTile("landcover", 3, 4, 5, asciiBuf("tile-bytes"), "image/png");
    const got = await edgeGetTile("landcover", 3, 4, 5);
    expect(new TextDecoder().decode(got ?? new ArrayBuffer(0))).toBe("tile-bytes");
  });

  it("versions rendered types in the key and leaves passthrough types unversioned", async () => {
    await edgePutTile("elevation-color", 3, 4, 5, asciiBuf("rendered"), "image/png");
    await edgePutTile("landcover", 3, 4, 5, asciiBuf("passthrough"), "image/png");

    const keys = [...cache.entries.keys()];
    expect(keys).toContain(
      `https://edge-cache.openzenith.internal/elevation-color/v${RENDER_SCHEMA_VERSION}/3/4/5`,
    );
    expect(keys).toContain("https://edge-cache.openzenith.internal/landcover/3/4/5");
  });

  it("treats an expired entry as a miss", async () => {
    await edgePutTile("landcover", 3, 4, 5, asciiBuf("stale"), "image/png");

    // Age the stored entry past its TTL.
    const key = "https://edge-cache.openzenith.internal/landcover/3/4/5";
    const stored = cache.entries.get(key);
    expect(stored).toBeDefined();
    const headers = new Headers(stored?.headers);
    headers.set("x-cached-at", String(Date.now() - 31 * 24 * 60 * 60 * 1000));
    cache.entries.set(key, new Response(await (stored as Response).arrayBuffer(), { headers }));

    expect(await edgeGetTile("landcover", 3, 4, 5)).toBeNull();
  });

  it("treats an entry with no freshness metadata as a miss", async () => {
    const key = "https://edge-cache.openzenith.internal/landcover/3/4/5";
    cache.entries.set(key, new Response(asciiBuf("undated"), { headers: new Headers() }));
    expect(await edgeGetTile("landcover", 3, 4, 5)).toBeNull();
  });

  it("returns null on a plain miss", async () => {
    expect(await edgeGetTile("landcover", 3, 4, 5)).toBeNull();
  });

  it("no-ops reads and writes when the Cache API is unavailable", async () => {
    setEdgeCacheProvider(() => null);
    await expect(edgePutTile("landcover", 3, 4, 5, asciiBuf("x"))).resolves.toBeUndefined();
    await expect(edgeGetTile("landcover", 3, 4, 5)).resolves.toBeNull();
  });

  it("survives a rejecting cache store", async () => {
    setEdgeCacheProvider(() => {
      throw new Error("no request context");
    });
    await expect(edgePutTile("landcover", 3, 4, 5, asciiBuf("x"))).resolves.toBeUndefined();
    await expect(edgeGetTile("landcover", 3, 4, 5)).resolves.toBeNull();
  });

  it("survives a cache open that rejects", async () => {
    setEdgeCacheProvider(() => ({
      open: () => Promise.reject(new Error("cache unavailable")),
    }));
    await expect(edgePutTile("landcover", 3, 4, 5, asciiBuf("x"))).resolves.toBeUndefined();
    await expect(edgeGetTile("landcover", 3, 4, 5)).resolves.toBeNull();
  });
});

describe("edge-cache JSON", () => {
  it("round-trips a JSON payload through put then get", async () => {
    await edgePutJson("api/earthquakes?period=all_day", { count: 7 }, 60);
    await expect(edgeGetJson<{ count: number }>("api/earthquakes?period=all_day")).resolves.toEqual({ count: 7 });
  });

  it("returns null for an expired payload instead of stale data", async () => {
    await edgePutJson("api/satellites", { group: "active" }, 60);
    const key = "https://edge-cache.openzenith.internal/api/satellites";
    const stored = cache.entries.get(key);
    expect(stored).toBeDefined();
    const headers = new Headers(stored?.headers);
    headers.set("x-cached-at", String(Date.now() - 61_000));
    cache.entries.set(key, new Response(await (stored as Response).text(), { headers }));

    await expect(edgeGetJson("api/satellites")).resolves.toBeNull();
  });

  it("returns null on a miss or without a cache", async () => {
    await expect(edgeGetJson("api/nope")).resolves.toBeNull();
    setEdgeCacheProvider(() => null);
    await expect(edgeGetJson("api/nope")).resolves.toBeNull();
    await expect(edgePutJson("api/nope", { a: 1 })).resolves.toBeUndefined();
  });
});

describe("apiCacheKey", () => {
  it("normalizes routes and appends query params", () => {
    expect(apiCacheKey("earthquakes")).toBe("api/earthquakes");
    expect(apiCacheKey("/earthquakes", { period: "all_day" })).toBe("api/earthquakes?period=all_day");
    expect(apiCacheKey("/military", { lon: "1", lat: "2" })).toBe("api/military?lon=1&lat=2");
  });
});
