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
    expect(keys).toContain(`https://edge-cache.openzenith.internal/elevation-color/v${RENDER_SCHEMA_VERSION}/3/4/5`);
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

  it("copies a Uint8Array payload into its own exact-size buffer", async () => {
    // Rendered tile bytes arrive as views over larger decode buffers; the
    // stored Response must hold a copy, not the view.
    const shared = new Uint8Array(16);
    shared.set([9, 8, 7, 6], 4);
    const view = shared.subarray(4, 8);

    await edgePutTile("contours", 3, 4, 5, view, "image/png");
    const got = await edgeGetTile("contours", 3, 4, 5);
    expect(got?.byteLength).toBe(4);
    expect(Array.from(new Uint8Array(got ?? new ArrayBuffer(0)))).toEqual([9, 8, 7, 6]);
  });
});

describe("edge-cache global Cache API resolution", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    setEdgeCacheProvider(null);
  });

  it("uses the global Cache API when no provider override is installed", async () => {
    const entries = new Map<string, Response>();
    // The Cache API accepts RequestInfo | URL keys; resolve each union
    // member to its URL text instead of String()-ing the object (a Request
    // would stringify as "[object Object]").
    const keyOf = (key: RequestInfo | URL): string =>
      typeof key === "string" ? key : key instanceof URL ? key.href : key.url;
    vi.stubGlobal("caches", {
      open: () =>
        Promise.resolve({
          match: (key: RequestInfo | URL) => Promise.resolve(entries.get(keyOf(key))),
          put: (key: RequestInfo | URL, response: Response) => {
            entries.set(keyOf(key), response);
            return Promise.resolve();
          },
        }),
    });
    setEdgeCacheProvider(null); // restore the default global lookup

    await edgePutTile("landcover", 3, 4, 5, asciiBuf("global"), "image/png");
    await expect(edgeGetTile("landcover", 3, 4, 5)).resolves.toMatchObject({ byteLength: 6 });
    expect([...entries.keys()][0]).toContain("/landcover/3/4/5");
  });

  it("treats a global caches object without an open() function as no cache", async () => {
    // Node/vitest expose no `caches`; a partial stand-in must read as absent.
    vi.stubGlobal("caches", {});
    setEdgeCacheProvider(null);
    await expect(edgeGetTile("landcover", 3, 4, 5)).resolves.toBeNull();
    await expect(edgePutTile("landcover", 3, 4, 5, asciiBuf("x"))).resolves.toBeUndefined();
  });

  it("treats a throwing global caches accessor as no cache", async () => {
    // Workers surface `caches` through a request-scoped accessor that throws
    // outside a request context.
    setEdgeCacheProvider(null);
    const receiver = globalThis as { caches?: unknown };
    Object.defineProperty(globalThis, "caches", {
      configurable: true,
      get() {
        throw new Error("No such context");
      },
    });
    try {
      await expect(edgeGetTile("landcover", 3, 4, 5)).resolves.toBeNull();
      await expect(edgeGetJson("api/landcover")).resolves.toBeNull();
    } finally {
      delete receiver.caches;
    }
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

  it("returns null when the cache lookup itself fails", async () => {
    await edgePutJson("api/geojson", { ok: true }, 60);
    setEdgeCacheProvider(() => ({
      open: () =>
        Promise.resolve({
          match: () => Promise.reject(new Error("cache I/O error")),
          put: () => Promise.resolve(),
        }),
    }));
    await expect(edgeGetJson("api/geojson")).resolves.toBeNull();
  });
});

describe("apiCacheKey", () => {
  it("normalizes routes and appends query params", () => {
    expect(apiCacheKey("earthquakes")).toBe("api/earthquakes");
    expect(apiCacheKey("/earthquakes", { period: "all_day" })).toBe("api/earthquakes?period=all_day");
    expect(apiCacheKey("/military", { lon: "1", lat: "2" })).toBe("api/military?lon=1&lat=2");
  });

  it("omits the query separator when the params object serializes empty", () => {
    expect(apiCacheKey("/wildfires", {})).toBe("api/wildfires");
  });
});
