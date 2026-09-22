/**
 * Tests for the edge cache helpers in src/lib/cache.ts (cachedFetch /
 * staleWhileRevalidate). The Cache API is emulated with an in-memory store so
 * both the "Cache API available" and "fallback" branches are exercised.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The global setup file replaces this module with a fetch passthrough; restore
// the real implementation so the Cache API branches are actually exercised.
vi.mock("@/lib/cache", async (importOriginal) => {
  return await importOriginal<typeof import("@/lib/cache")>();
});

type CacheStore = Map<string, Response>;

interface FakeCache {
  match: (key: string) => Promise<Response | null>;
  put: (key: string, response: Response) => Promise<void>;
}

interface FakeCaches {
  stores: Map<string, CacheStore>;
  open: (name: string) => Promise<FakeCache>;
}

const NAMESPACE = "openzenith-v1";
const URL_UNDER_TEST = "https://upstream.example.com/data";

function createCaches(): FakeCaches {
  const stores = new Map<string, CacheStore>();
  stores.set(NAMESPACE, new Map<string, Response>());
  return {
    stores,
    open: (name: string) => {
      let store = stores.get(name);
      if (!store) {
        store = new Map<string, Response>();
        stores.set(name, store);
      }
      const bound = store;
      return Promise.resolve({
        match: (key: string) => Promise.resolve(bound.get(key) ?? null),
        put: (key: string, response: Response) => {
          bound.set(key, response);
          return Promise.resolve();
        },
      } satisfies FakeCache);
    },
  };
}

function jsonResponse(body: string, status = 200): Response {
  return new Response(body, { status, headers: { "content-type": "application/json" } });
}

function seedEntry(store: CacheStore, body: string, cachedAtMs: number, extraHeaders: Record<string, string> = {}) {
  store.set(`${NAMESPACE}:${URL_UNDER_TEST}`, new Response(body, { headers: { "x-cached-at": String(cachedAtMs), ...extraHeaders } }));
}

const fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>();

async function readText(response: Response): Promise<string> {
  return response.clone().text();
}

describe("cachedFetch", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("falls back to a direct fetch when the Cache API is unavailable", async () => {
    fetchMock.mockResolvedValue(jsonResponse('{"direct":true}'));

    const { cachedFetch } = await import("@/lib/cache");
    const response = await cachedFetch(URL_UNDER_TEST, 60);

    expect(fetchMock).toHaveBeenCalledWith(URL_UNDER_TEST, undefined);
    expect(await readText(response)).toBe('{"direct":true}');
    expect(response.status).toBe(200);
  });

  it("returns a fresh cached response without hitting upstream", async () => {
    const caches = createCaches();
    vi.stubGlobal("caches", caches);
    seedEntry(caches.stores.get(NAMESPACE) as CacheStore, '{"cached":1}', Date.now() - 1000);
    fetchMock.mockResolvedValue(jsonResponse('{"fresh":1}'));

    const { cachedFetch } = await import("@/lib/cache");
    const response = await cachedFetch(URL_UNDER_TEST, 60);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(await readText(response)).toBe('{"cached":1}');
  });

  it("fetches upstream on a miss and populates the cache", async () => {
    const caches = createCaches();
    vi.stubGlobal("caches", caches);
    fetchMock.mockResolvedValue(jsonResponse('{"fresh":1}'));

    const { cachedFetch } = await import("@/lib/cache");
    const response = await cachedFetch(URL_UNDER_TEST, 60, { headers: { "x-api-key": "k" } });

    expect(fetchMock).toHaveBeenCalledWith(URL_UNDER_TEST, { headers: { "x-api-key": "k" } });
    expect(await readText(response)).toBe('{"fresh":1}');

    const store = caches.stores.get(NAMESPACE) as CacheStore;
    expect(store.size).toBe(1);
    const stored = store.get(`${NAMESPACE}:${URL_UNDER_TEST}`) as Response;
    expect(await stored.clone().text()).toBe('{"fresh":1}');
    expect(stored.headers.get("x-cache-status")).toBe("HIT");
    expect(Number(stored.headers.get("x-cached-at"))).toBeGreaterThan(0);
  });

  it("revalidates when the cached entry is older than the TTL", async () => {
    const caches = createCaches();
    vi.stubGlobal("caches", caches);
    seedEntry(caches.stores.get(NAMESPACE) as CacheStore, '{"stale":1}', Date.now() - 61_000);
    fetchMock.mockResolvedValue(jsonResponse('{"fresh":2}'));

    const { cachedFetch } = await import("@/lib/cache");
    const response = await cachedFetch(URL_UNDER_TEST, 60);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await readText(response)).toBe('{"fresh":2}');
  });

  it("revalidates when the cached entry has no timestamp header", async () => {
    const caches = createCaches();
    vi.stubGlobal("caches", caches);
    caches.stores.get(NAMESPACE)?.set(`${NAMESPACE}:${URL_UNDER_TEST}`, jsonResponse('{"no-timestamp":1}'));
    fetchMock.mockResolvedValue(jsonResponse('{"fresh":3}'));

    const { cachedFetch } = await import("@/lib/cache");
    const response = await cachedFetch(URL_UNDER_TEST, 60);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await readText(response)).toBe('{"fresh":3}');
  });

  it("treats an unparseable timestamp as stale", async () => {
    const caches = createCaches();
    vi.stubGlobal("caches", caches);
    seedEntry(caches.stores.get(NAMESPACE) as CacheStore, '{"bad":1}', Number.NaN);
    fetchMock.mockResolvedValue(jsonResponse('{"fresh":4}'));

    const { cachedFetch } = await import("@/lib/cache");
    const response = await cachedFetch(URL_UNDER_TEST, 60);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await readText(response)).toBe('{"fresh":4}');
  });

  it("returns a non-ok upstream response untouched and caches nothing", async () => {
    const caches = createCaches();
    vi.stubGlobal("caches", caches);
    fetchMock.mockResolvedValue(jsonResponse("boom", 503));

    const { cachedFetch } = await import("@/lib/cache");
    const response = await cachedFetch(URL_UNDER_TEST, 60);

    expect(response.status).toBe(503);
    expect(caches.stores.get(NAMESPACE)?.size ?? 0).toBe(0);
  });

  it("falls back to a direct fetch when the Cache API throws", async () => {
    vi.stubGlobal("caches", {
      open: () => Promise.reject(new Error("cache unavailable")),
    });
    fetchMock.mockResolvedValue(jsonResponse('{"direct":2}'));

    const { cachedFetch } = await import("@/lib/cache");
    const response = await cachedFetch(URL_UNDER_TEST, 60);

    expect(fetchMock).toHaveBeenCalledWith(URL_UNDER_TEST, undefined);
    expect(await readText(response)).toBe('{"direct":2}');
  });
});

describe("staleWhileRevalidate", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("falls back to a direct fetch when the Cache API is unavailable", async () => {
    fetchMock.mockResolvedValue(jsonResponse('{"direct":3}'));

    const { staleWhileRevalidate } = await import("@/lib/cache");
    const response = await staleWhileRevalidate(URL_UNDER_TEST, 60);

    expect(fetchMock).toHaveBeenCalledWith(URL_UNDER_TEST, undefined);
    expect(await readText(response)).toBe('{"direct":3}');
  });

  it("serves a fresh entry with an x-cache-status of HIT", async () => {
    const caches = createCaches();
    vi.stubGlobal("caches", caches);
    seedEntry(caches.stores.get(NAMESPACE) as CacheStore, '{"cached":2}', Date.now() - 1000, { "x-cache-status": "MISS" });
    fetchMock.mockResolvedValue(jsonResponse('{"fresh":5}'));

    const { staleWhileRevalidate } = await import("@/lib/cache");
    const response = await staleWhileRevalidate(URL_UNDER_TEST, 60);

    expect(await readText(response)).toBe('{"cached":2}');
    expect(response.headers.get("x-cache-status")).toBe("HIT");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("serves a stale entry and revalidates in the background", async () => {
    const caches = createCaches();
    vi.stubGlobal("caches", caches);
    const store = caches.stores.get(NAMESPACE) as CacheStore;
    seedEntry(store, '{"stale":2}', Date.now() - 90_000);
    fetchMock.mockResolvedValue(jsonResponse('{"fresh":6}'));

    const { staleWhileRevalidate } = await import("@/lib/cache");
    const response = await staleWhileRevalidate(URL_UNDER_TEST, 60);

    expect(await readText(response)).toBe('{"stale":2}');
    expect(response.headers.get("x-cache-status")).toBe("STALE");

    await vi.waitFor(() => {
      const stored = store.get(`${NAMESPACE}:${URL_UNDER_TEST}`);
      expect(stored).toBeDefined();
      expect(stored?.headers.get("x-cached-at")).not.toBeNull();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("waits for upstream when the entry is beyond the stale window", async () => {
    const caches = createCaches();
    vi.stubGlobal("caches", caches);
    const store = caches.stores.get(NAMESPACE) as CacheStore;
    seedEntry(store, '{"ancient":1}', Date.now() - 500_000);
    fetchMock.mockResolvedValue(jsonResponse('{"fresh":7}'));

    const { staleWhileRevalidate } = await import("@/lib/cache");
    const response = await staleWhileRevalidate(URL_UNDER_TEST, 60, 120);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await readText(response)).toBe('{"fresh":7}');
    const stored = store.get(`${NAMESPACE}:${URL_UNDER_TEST}`) as Response;
    expect(stored.headers.get("x-cache-status")).toBe("MISS");
  });

  it("uses the stale window default equal to the TTL", async () => {
    const caches = createCaches();
    vi.stubGlobal("caches", caches);
    seedEntry(caches.stores.get(NAMESPACE) as CacheStore, '{"stale":3}', Date.now() - 110_000);
    fetchMock.mockResolvedValue(jsonResponse('{"fresh":8}'));

    const { staleWhileRevalidate } = await import("@/lib/cache");
    // ttl=60 with no explicit stale window → fresh window is 60, stale is 120
    const response = await staleWhileRevalidate(URL_UNDER_TEST, 60);

    expect(await readText(response)).toBe('{"stale":3}');
    expect(response.headers.get("x-cache-status")).toBe("STALE");
  });

  it("keeps the stale entry when background revalidation fails", async () => {
    const caches = createCaches();
    vi.stubGlobal("caches", caches);
    const store = caches.stores.get(NAMESPACE) as CacheStore;
    const cachedAt = Date.now() - 90_000;
    seedEntry(store, '{"stale":4}', cachedAt);
    fetchMock.mockResolvedValue(jsonResponse("boom", 500));

    const { staleWhileRevalidate } = await import("@/lib/cache");
    const response = await staleWhileRevalidate(URL_UNDER_TEST, 60);

    expect(await readText(response)).toBe('{"stale":4}');
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    const stored = store.get(`${NAMESPACE}:${URL_UNDER_TEST}`) as Response;
    // The failed revalidation must not overwrite the still-usable entry.
    expect(stored.headers.get("x-cached-at")).toBe(String(cachedAt));
  });

  it("returns a non-ok upstream response and caches nothing", async () => {
    const caches = createCaches();
    vi.stubGlobal("caches", caches);
    fetchMock.mockResolvedValue(jsonResponse("boom", 404));

    const { staleWhileRevalidate } = await import("@/lib/cache");
    const response = await staleWhileRevalidate(URL_UNDER_TEST, 60);

    expect(response.status).toBe(404);
    expect(caches.stores.get(NAMESPACE)?.size ?? 0).toBe(0);
  });

  it("falls back to a direct fetch when the Cache API throws", async () => {
    vi.stubGlobal("caches", {
      open: () => Promise.reject(new Error("cache unavailable")),
    });
    fetchMock.mockResolvedValue(jsonResponse('{"direct":4}'));

    const { staleWhileRevalidate } = await import("@/lib/cache");
    const response = await staleWhileRevalidate(URL_UNDER_TEST, 60);

    expect(await readText(response)).toBe('{"direct":4}');
  });
});
