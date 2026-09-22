/**
 * Tests for src/lib/storage/cache.ts — the chunk cache used by the elevation
 * and tile generators. Covers the Cloudflare Cache API path, the in-memory
 * fallback, and the 30 day TTL.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface FakeCache {
  match: (key: string) => Promise<Response | null>;
  put: (key: string, response: Response) => Promise<void>;
}

interface FakeCaches {
  stores: Map<string, Map<string, Response>>;
  openCalls: string[];
  open: (name: string) => Promise<FakeCache>;
}

const CACHE_NAME = "openzenith-dem-chunks";
const KEY = "oz:test:chunk";

/** 30 days in seconds — mirrors the TTL in storage/cache.ts. */
const TTL_SECS = 30 * 24 * 3600;

function createCaches(): FakeCaches {
  const stores = new Map<string, Map<string, Response>>();
  const openCalls: string[] = [];
  stores.set(CACHE_NAME, new Map<string, Response>());
  return {
    stores,
    openCalls,
    open: async (name: string) => {
      openCalls.push(name);
      let store = stores.get(name);
      if (!store) {
        store = new Map<string, Response>();
        stores.set(name, store);
      }
      const bound = store;
      return {
        match: async (key: string) => bound.get(key) ?? null,
        put: async (key: string, response: Response) => {
          bound.set(key, response);
        },
      };
    },
  };
}

function bytes(length: number, fill: number): ArrayBuffer {
  const out = new ArrayBuffer(length);
  new Uint8Array(out).fill(fill);
  return out;
}

vi.mock("@/lib/storage/cache", async (importOriginal) => {
  return await importOriginal<typeof import("@/lib/storage/cache")>();
});

describe("storage chunk cache (memory fallback)", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("returns null for an unknown key", async () => {
    const { cacheGet } = await import("@/lib/storage/cache");
    expect(await cacheGet("oz:unknown:key")).toBeNull();
  });

  it("round-trips a stored entry through the in-memory fallback", async () => {
    const { cacheGet, cachePut } = await import("@/lib/storage/cache");
    const data = bytes(16, 7);

    await cachePut(KEY, data);
    const result = await cacheGet(KEY);

    expect(result).toBeInstanceOf(ArrayBuffer);
    expect(result?.byteLength).toBe(16);
    expect(new Uint8Array(result as ArrayBuffer)[0]).toBe(7);
  });

  it("drops entries once the 30 day TTL has elapsed", async () => {
    vi.useFakeTimers({ now: Date.now() });
    const { cacheGet, cachePut } = await import("@/lib/storage/cache");
    const key = "oz:ttl:chunk";

    await cachePut(key, bytes(4, 1));
    expect(await cacheGet(key)).not.toBeNull();

    vi.setSystemTime(Date.now() + (TTL_SECS + 60) * 1000);
    expect(await cacheGet(key)).toBeNull();
    // The expired entry was evicted rather than left in place.
    expect(await cacheGet(key)).toBeNull();

    // Entries inside the window stay readable.
    await cachePut(key, bytes(4, 2));
    vi.setSystemTime(Date.now() + (TTL_SECS - 60) * 1000);
    expect(await cacheGet(key)).not.toBeNull();
  });

  it("keeps entries for distinct keys independent", async () => {
    const { cacheGet, cachePut } = await import("@/lib/storage/cache");
    await cachePut("oz:key:a", bytes(4, 1));
    await cachePut("oz:key:b", bytes(4, 2));

    expect(new Uint8Array((await cacheGet("oz:key:a")) as ArrayBuffer)[0]).toBe(1);
    expect(new Uint8Array((await cacheGet("oz:key:b")) as ArrayBuffer)[0]).toBe(2);
  });
});

describe("storage chunk cache (Cloudflare Cache API)", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("writes through to the Cache API with a long max-age", async () => {
    const caches = createCaches();
    vi.stubGlobal("caches", caches);
    const { cacheGet, cachePut } = await import("@/lib/storage/cache");

    await cachePut(KEY, bytes(8, 9));

    expect(caches.openCalls).toEqual([CACHE_NAME]);
    const store = caches.stores.get(CACHE_NAME) as Map<string, Response>;
    const stored = store.get(KEY) as Response;
    expect(stored.headers.get("Cache-Control")).toBe(`public, max-age=${TTL_SECS}`);
    expect(stored.headers.get("Content-Type")).toBe("application/octet-stream");
    // Reads are served from the Cache API copy.
    const result = (await cacheGet(KEY)) as ArrayBuffer;
    expect(new Uint8Array(result)[7]).toBe(9);
  });

  it("prefers the Cache API entry over the in-memory fallback", async () => {
    const { cachePut } = await import("@/lib/storage/cache");
    await cachePut(KEY, bytes(4, 1)); // memory only (no Cache API yet)

    const caches = createCaches();
    vi.stubGlobal("caches", caches);
    (caches.stores.get(CACHE_NAME) as Map<string, Response>).set(KEY, new Response(bytes(4, 42)));
    const { cacheGet } = await import("@/lib/storage/cache");

    const result = (await cacheGet(KEY)) as ArrayBuffer;
    expect(new Uint8Array(result)[0]).toBe(42);
  });

  it("serves a Cache API entry that was written by another isolate", async () => {
    const caches = createCaches();
    vi.stubGlobal("caches", caches);
    (caches.stores.get(CACHE_NAME) as Map<string, Response>).set(
      "oz:remote:chunk",
      new Response(bytes(6, 5)),
    );
    const { cacheGet } = await import("@/lib/storage/cache");

    const result = (await cacheGet("oz:remote:chunk")) as ArrayBuffer;
    expect(result.byteLength).toBe(6);
    expect(new Uint8Array(result)[5]).toBe(5);
  });

  it("falls back to memory when the Cache API is unusable", async () => {
    vi.stubGlobal("caches", {
      open: async () => {
        throw new Error("no Cache API in this isolate");
      },
    });
    const { cacheGet, cachePut } = await import("@/lib/storage/cache");

    await cachePut(KEY, bytes(4, 3));
    const result = (await cacheGet(KEY)) as ArrayBuffer;

    expect(new Uint8Array(result)[0]).toBe(3);
  });

  it("ignores Cache API write failures", async () => {
    vi.stubGlobal("caches", {
      open: async () => ({
        match: async () => null,
        put: async () => Promise.reject(new Error("quota exceeded")),
      }),
    });
    const { cacheGet, cachePut } = await import("@/lib/storage/cache");

    await expect(cachePut(KEY, bytes(4, 4))).resolves.toBeUndefined();
    const result = (await cacheGet(KEY)) as ArrayBuffer;
    expect(new Uint8Array(result)[0]).toBe(4);
  });
});
