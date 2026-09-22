/**
 * Tests for src/lib/storage/r2-json-cache.ts — the R2 cache-aside used for
 * JSON API responses. The R2 bucket binding is emulated in-memory and injected
 * through the setR2BucketProvider() seam.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The global setup file stubs this module out for route tests; restore the real
// implementation here.
vi.mock("@/lib/storage/r2-json-cache", async (importOriginal) => {
  return await importOriginal<typeof import("@/lib/storage/r2-json-cache")>();
});

import { apiCacheKey, r2GetJson, r2PutJson } from "@/lib/storage/r2-json-cache";
import { setR2BucketProvider } from "@/lib/storage/r2-binding";

interface R2PutOptions {
  httpMetadata?: {
    contentType?: string;
    cacheControl?: string;
    cacheExpiry?: Date;
  };
  customMetadata?: Record<string, string>;
}

interface FakeR2Object {
  customMetadata?: Record<string, string>;
  text: () => Promise<string>;
  arrayBuffer: () => Promise<ArrayBuffer>;
  setBody: (body: string) => void;
}

interface RecordedPut {
  key: string;
  value: unknown;
  options: R2PutOptions | undefined;
}

interface FakeBucket {
  store: Map<string, FakeR2Object>;
  getCalls: string[];
  puts: RecordedPut[];
  deletes: string[];
  getError: Error | null;
  putError: Error | null;
  get(key: string): Promise<FakeR2Object | null>;
  put(key: string, value: unknown, options?: R2PutOptions): Promise<void>;
  delete(key: string): Promise<void>;
}

function makeObject(body: string, customMetadata?: Record<string, string>): FakeR2Object {
  const record: { body: string; customMetadata?: Record<string, string> } = { body, customMetadata };
  return {
    customMetadata,
    text: () => Promise.resolve(record.body),
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    setBody: (next: string) => {
      record.body = next;
    },
  };
}

function createBucket(): FakeBucket {
  const bucket: FakeBucket = {
    store: new Map<string, FakeR2Object>(),
    getCalls: [],
    puts: [],
    deletes: [],
    getError: null,
    putError: null,
    get: (key: string) => {
      bucket.getCalls.push(key);
      if (bucket.getError) return Promise.reject(bucket.getError);
      return Promise.resolve(bucket.store.get(key) ?? null);
    },
    put: (key: string, value: unknown, options?: R2PutOptions) => {
      bucket.puts.push({ key, value, options });
      if (bucket.putError) return Promise.reject(bucket.putError);
      const body = typeof value === "string" ? value : JSON.stringify(value);
      bucket.store.set(key, makeObject(body, options?.customMetadata));
      return Promise.resolve();
    },
    delete: (key: string) => {
      bucket.deletes.push(key);
      bucket.store.delete(key);
      return Promise.resolve();
    },
  };
  return bucket;
}

/** Fixed "now" so cachedAt / TTL maths are deterministic. */
const NOW = 1_760_000_000_000;

describe("r2PutJson", () => {
  let bucket: FakeBucket;

  beforeEach(() => {
    vi.useFakeTimers({ now: NOW });
    bucket = createBucket();
    setR2BucketProvider(() => bucket);
  });

  afterEach(() => {
    vi.useRealTimers();
    setR2BucketProvider(null);
  });

  it("stores a JSON body with content type and TTL metadata", async () => {
    await r2PutJson("api/earthquakes/all_day", { count: 3 }, 120);

    expect(bucket.puts).toHaveLength(1);
    const put = bucket.puts[0];
    expect(put.key).toBe("api/earthquakes/all_day");
    expect(put.value).toBe('{"count":3}');
    expect(put.options?.httpMetadata?.contentType).toBe("application/json");
    expect(put.options?.httpMetadata?.cacheControl).toBe("public, max-age=120, s-maxage=120");
    expect(String(put.options?.customMetadata?.ttl)).toBe("120000");
    expect(String(put.options?.customMetadata?.cachedAt)).toBe(String(NOW));
  });

  it("defaults to a 60 second TTL", async () => {
    await r2PutJson("api/vessels", []);

    const put = bucket.puts[0];
    expect(put.value).toBe("[]");
    expect(String(put.options?.customMetadata?.ttl)).toBe("60000");
  });

  it("is a no-op when no R2 binding is available", async () => {
    setR2BucketProvider(() => {
      throw new Error("not running in a Cloudflare Pages context");
    });

    await expect(r2PutJson("api/earthquakes", { a: 1 })).resolves.toBeUndefined();
  });

  it("is a no-op when the provider resolves no binding", async () => {
    setR2BucketProvider(() => null);

    await expect(r2PutJson("api/earthquakes", { a: 1 })).resolves.toBeUndefined();
  });

  it("swallows R2 write failures", async () => {
    bucket.putError = new Error("R2 write failed");

    await expect(r2PutJson("api/earthquakes", { a: 1 })).resolves.toBeUndefined();
  });
});

describe("r2GetJson", () => {
  let bucket: FakeBucket;

  beforeEach(() => {
    vi.useFakeTimers({ now: NOW });
    bucket = createBucket();
    setR2BucketProvider(() => bucket);
  });

  afterEach(() => {
    vi.useRealTimers();
    setR2BucketProvider(null);
  });

  it("returns null when no R2 binding is available", async () => {
    setR2BucketProvider(() => {
      throw new Error("not running in a Cloudflare Pages context");
    });

    expect(await r2GetJson("api/earthquakes")).toBeNull();
  });

  it("returns null on a cache miss", async () => {
    expect(await r2GetJson("api/missing")).toBeNull();
    expect(bucket.getCalls).toEqual(["api/missing"]);
  });

  it("round-trips a value written by r2PutJson", async () => {
    interface Payload {
      features: Array<{ id: number }>;
    }
    const payload: Payload = { features: [{ id: 1 }, { id: 2 }] };
    await r2PutJson("api/earthquakes/all_day", payload, 60);

    const result = await r2GetJson<Payload>("api/earthquakes/all_day");
    expect(result).toEqual(payload);
  });

  it("serves an object written directly into the bucket", async () => {
    bucket.store.set("api/flights", makeObject('{"ok":true}', { cachedAt: String(NOW), ttl: "60000" }));

    expect(await r2GetJson<{ ok: boolean }>("api/flights")).toEqual({ ok: true });
    expect(bucket.deletes).toHaveLength(0);
  });

  it("returns null and deletes the object once the TTL has elapsed", async () => {
    await r2PutJson("api/flights", { ok: true }, 30);

    vi.setSystemTime(NOW + 31_000);
    expect(await r2GetJson("api/flights")).toBeNull();
    expect(bucket.deletes).toEqual(["api/flights"]);
  });

  it("keeps serving the object inside the TTL window", async () => {
    await r2PutJson("api/flights", { ok: true }, 30);

    vi.setSystemTime(NOW + 29_000);
    expect(await r2GetJson("api/flights")).toEqual({ ok: true });
  });

  it("treats an object without cache metadata as expired", async () => {
    bucket.store.set("api/legacy", makeObject('{"legacy":true}'));

    expect(await r2GetJson("api/legacy")).toBeNull();
    expect(bucket.deletes).toEqual(["api/legacy"]);
  });

  it("returns null when the R2 read fails", async () => {
    bucket.getError = new Error("network unreachable");

    expect(await r2GetJson("api/earthquakes")).toBeNull();
  });

  it("returns null when the stored body is not valid JSON", async () => {
    await r2PutJson("api/broken", { a: 1 }, 60);
    const stored = bucket.store.get("api/broken") as FakeR2Object;
    stored.setBody("{not json");

    expect(await r2GetJson("api/broken")).toBeNull();
  });
});

describe("apiCacheKey", () => {
  it("normalises the leading slash", () => {
    expect(apiCacheKey("/earthquakes/all_day")).toBe("api/earthquakes/all_day");
  });

  it("keeps routes that already lack a leading slash", () => {
    expect(apiCacheKey("elevation")).toBe("api/elevation");
  });

  it("appends query parameters in insertion order", () => {
    expect(apiCacheKey("elevation", { lat: "40.7", lon: "-74.0" })).toBe(
      "api/elevation?lat=40.7&lon=-74.0",
    );
  });

  it("form-encodes parameter values", () => {
    expect(apiCacheKey("elevation", { name: "a b" })).toBe("api/elevation?name=a+b");
  });

  it("omits the query string when no params are given", () => {
    expect(apiCacheKey("elevation", {})).toBe("api/elevation");
  });
});
