/**
 * Tests for src/lib/storage/r2-tile-cache.ts — the R2 cache-aside for generated
 * tiles. The R2 bucket binding is emulated in-memory and injected through a
 * mocked getRequestContext().
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getRequestContextMock } = vi.hoisted(() => ({
  getRequestContextMock: vi.fn(),
}));

vi.mock("@cloudflare/next-on-pages", () => ({
  getRequestContext: getRequestContextMock,
}));

// The global setup file stubs this module out for route tests; restore the real
// implementation here.
vi.mock("@/lib/storage/r2-tile-cache", async (importOriginal) => {
  return await importOriginal<typeof import("@/lib/storage/r2-tile-cache")>();
});

import { r2GetTile, r2PutTile } from "@/lib/storage/r2-tile-cache";

interface R2PutOptions {
  httpMetadata?: {
    contentType?: string;
    cacheControl?: string;
    cacheExpiry?: Date;
  };
}

interface FakeR2Object {
  body: ArrayBuffer;
  arrayBuffer: () => Promise<ArrayBuffer>;
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
  getError: Error | null;
  putError: Error | null;
  get(key: string): Promise<FakeR2Object | null>;
  put(key: string, value: unknown, options?: R2PutOptions): Promise<void>;
}

function makeObject(body: ArrayBuffer): FakeR2Object {
  return { body, arrayBuffer: async () => body };
}

function createBucket(): FakeBucket {
  const bucket: FakeBucket = {
    store: new Map<string, FakeR2Object>(),
    getCalls: [],
    puts: [],
    getError: null,
    putError: null,
    get: async (key: string) => {
      bucket.getCalls.push(key);
      if (bucket.getError) throw bucket.getError;
      return bucket.store.get(key) ?? null;
    },
    put: async (key: string, value: unknown, options?: R2PutOptions) => {
      bucket.puts.push({ key, value, options });
      if (bucket.putError) throw bucket.putError;
      const bytes =
        value instanceof ArrayBuffer
          ? new Uint8Array(value)
          : value instanceof Uint8Array
            ? value
            : new Uint8Array(0);
      const copy = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(copy).set(bytes);
      bucket.store.set(key, makeObject(copy));
    },
  };
  return bucket;
}

function tileBytes(size: number, fill: number): ArrayBuffer {
  const out = new ArrayBuffer(size);
  new Uint8Array(out).fill(fill);
  return out;
}

/** 1 year, matching the cacheExpiry written by r2PutTile. */
const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

describe("r2GetTile", () => {
  let bucket: FakeBucket;

  beforeEach(() => {
    getRequestContextMock.mockReset();
    bucket = createBucket();
    getRequestContextMock.mockReturnValue({ env: { DEM_TILES: bucket } });
  });

  afterEach(() => {
    getRequestContextMock.mockReset();
  });

  it("builds the tile key as {type}/{z}/{x}/{y}", async () => {
    bucket.store.set("elevation-color/10/350/500", makeObject(tileBytes(4, 1)));

    const result = await r2GetTile("elevation-color", 10, 350, 500);

    expect(bucket.getCalls).toEqual(["elevation-color/10/350/500"]);
    expect(result?.byteLength).toBe(4);
  });

  it("returns null on a cache miss", async () => {
    expect(await r2GetTile("terrain", 7, 12, 34)).toBeNull();
  });

  it("returns the stored bytes", async () => {
    bucket.store.set("terrain/7/12/34", makeObject(tileBytes(3, 42)));

    const result = (await r2GetTile("terrain", 7, 12, 34)) as ArrayBuffer;
    expect(new Uint8Array(result)[2]).toBe(42);
  });

  it("returns null when no R2 binding is available", async () => {
    getRequestContextMock.mockImplementation(() => {
      throw new Error("not running in a Cloudflare Pages context");
    });

    expect(await r2GetTile("terrain", 7, 12, 34)).toBeNull();
    expect(getRequestContextMock).toHaveBeenCalledTimes(1);
  });

  it("returns null when the context has no DEM_TILES binding", async () => {
    getRequestContextMock.mockReturnValue({ env: {} });

    expect(await r2GetTile("terrain", 7, 12, 34)).toBeNull();
  });

  it("returns null when the R2 read fails", async () => {
    bucket.getError = new Error("R2 timeout");

    expect(await r2GetTile("terrain", 7, 12, 34)).toBeNull();
  });
});

describe("r2PutTile", () => {
  let bucket: FakeBucket;
  let now: number;

  beforeEach(() => {
    now = Date.now();
    getRequestContextMock.mockReset();
    bucket = createBucket();
    getRequestContextMock.mockReturnValue({ env: { DEM_TILES: bucket } });
  });

  afterEach(() => {
    getRequestContextMock.mockReset();
  });

  it("stores tile bytes with immutable cache metadata", async () => {
    await r2PutTile("elevation-color", 10, 350, 500, tileBytes(8, 3), "image/png");

    expect(bucket.puts).toHaveLength(1);
    const put = bucket.puts[0] as RecordedPut;
    expect(put.key).toBe("elevation-color/10/350/500");
    expect(put.options?.httpMetadata?.contentType).toBe("image/png");
    expect(put.options?.httpMetadata?.cacheControl).toBe("public, max-age=31536000, immutable");
    const expiry = put.options?.httpMetadata?.cacheExpiry as Date;
    expect(expiry.getTime()).toBeGreaterThanOrEqual(now + YEAR_MS - 1000);

    // The stored object is readable again through r2GetTile.
    const result = (await r2GetTile("elevation-color", 10, 350, 500)) as ArrayBuffer;
    expect(result.byteLength).toBe(8);
    expect(new Uint8Array(result)[7]).toBe(3);
  });

  it("defaults the content type to application/octet-stream", async () => {
    await r2PutTile("terrain", 7, 12, 34, tileBytes(2, 5));

    const put = bucket.puts[0] as RecordedPut;
    expect(put.options?.httpMetadata?.contentType).toBe("application/octet-stream");
  });

  it("accepts a Uint8Array payload", async () => {
    await r2PutTile("terrain", 7, 12, 34, new Uint8Array([9, 8, 7]));

    const result = (await r2GetTile("terrain", 7, 12, 34)) as ArrayBuffer;
    expect(Array.from(new Uint8Array(result))).toEqual([9, 8, 7]);
  });

  it("is a no-op when no R2 binding is available", async () => {
    getRequestContextMock.mockImplementation(() => {
      throw new Error("not running in a Cloudflare Pages context");
    });

    await expect(r2PutTile("terrain", 7, 12, 34, tileBytes(2, 1))).resolves.toBeUndefined();
  });

  it("is a no-op when the context has no DEM_TILES binding", async () => {
    getRequestContextMock.mockReturnValue({ env: {} });

    await expect(r2PutTile("terrain", 7, 12, 34, tileBytes(2, 1))).resolves.toBeUndefined();
    expect(bucket.puts).toHaveLength(0);
  });

  it("swallows R2 write failures", async () => {
    bucket.putError = new Error("quota exceeded");

    await expect(r2PutTile("terrain", 7, 12, 34, tileBytes(2, 1))).resolves.toBeUndefined();
  });
});
