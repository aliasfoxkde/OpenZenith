/**
 * Tests for src/lib/storage/huggingface-backend.ts.
 *
 * HuggingFace responses are served from a routing fetch stub and the chunk
 * cache layer is replaced with controllable mocks, so the merged-file fast
 * path, the in-memory file cache and the .deflate fallback are all covered
 * without network access.
 *
 * Every test gets its own SRTM tile name: the merged-file cache is module
 * level, so reusing a name would silently couple tests together. Names must be
 * structurally valid (the first three characters are read as the latitude band
 * when the URL is built).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deflateSync } from "node:zlib";

const { cacheGetMock, cachePutMock } = vi.hoisted(() => ({
  cacheGetMock: vi.fn<(key: string) => Promise<ArrayBuffer | null>>(),
  cachePutMock: vi.fn<(key: string, data: ArrayBuffer) => Promise<void>>(),
}));

vi.mock("@/lib/storage/cache", () => ({
  cacheGet: (key: string) => cacheGetMock(key),
  cachePut: (key: string, data: ArrayBuffer) => cachePutMock(key, data),
}));

import { ChunkBackend, HuggingFaceChunkBackend } from "@/lib/storage/huggingface-backend";

const REPO = "aliasfox/srtm30m-merged";
const BASE = "https://huggingface.co/datasets";

const MERGED_MAGIC = [0x4f, 0x5a, 0x43, 0x48, 0x4e, 0x4b, 0x30, 0x31]; // "OZCHNK01"
const HEADER_SIZE = 12;
const ENTRY_SIZE = 8;

interface Route {
  /** Substring matched against the requested URL. */
  match: string;
  status: number;
  body?: ArrayBuffer;
  reject?: Error;
}

interface TileRef {
  name: string;
  base: string;
  dir: string;
  mergedUrl: string;
  deflateUrl: (row: number, col: number) => string;
}

function toBuffer(bytes: Uint8Array): ArrayBuffer {
  const out = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(out).set(bytes);
  return out;
}

function payload(bytes: Array<number>): ArrayBuffer {
  return toBuffer(deflateSync(Uint8Array.from(bytes)));
}

/**
 * Build an OZCHNK01 merged file. Payloads are keyed by chunk index
 * (row * cols + col); entries without a payload point at an empty range.
 */
function buildMergedFile(rows: number, cols: number, payloads: Map<number, ArrayBuffer>): ArrayBuffer {
  const entryCount = rows * cols;
  const dataStart = HEADER_SIZE + entryCount * ENTRY_SIZE;
  const offsets = new Map<number, { offset: number; size: number }>();
  let cursor = dataStart;
  for (const [index, body] of Array.from(payloads.entries()).sort((a, b) => a[0] - b[0])) {
    offsets.set(index, { offset: cursor, size: body.byteLength });
    cursor += body.byteLength;
  }

  const out = new ArrayBuffer(cursor);
  const view = new Uint8Array(out);
  MERGED_MAGIC.forEach((byte, index) => {
    view[index] = byte;
  });
  new DataView(out).setUint16(8, 1, true); // version 1 = SRTM Int16
  view[10] = rows;
  view[11] = cols;
  for (let index = 0; index < entryCount; index++) {
    const entry = offsets.get(index) ?? { offset: 0, size: 0 };
    const base = HEADER_SIZE + index * ENTRY_SIZE;
    new DataView(out).setUint32(base, entry.offset, true);
    new DataView(out).setUint32(base + 4, entry.size, true);
  }
  for (const [index, body] of payloads) {
    const entry = offsets.get(index) as { offset: number; size: number };
    view.set(new Uint8Array(body), entry.offset);
  }
  return out;
}

describe("HuggingFaceChunkBackend", () => {
  let routes: Route[];
  let tileCounter = 0;
  const requestedUrls: string[] = [];
  const fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>();

  function makeBackend(tryMerged: boolean, repo: string = REPO): HuggingFaceChunkBackend {
    return new HuggingFaceChunkBackend(repo, tryMerged);
  }

  function nextTile(): TileRef {
    const base = `N40W${String(100 + tileCounter++).padStart(3, "0")}`;
    const dir = base.substring(0, 3);
    const prefix = `${BASE}/${REPO}/resolve/main/${dir}/${base}`;
    return {
      name: `${base}.tif`,
      base,
      dir,
      mergedUrl: `${prefix}.merged`,
      deflateUrl: (row: number, col: number) =>
        `${prefix}_${String(row).padStart(2, "0")}_${String(col).padStart(2, "0")}.deflate`,
    };
  }

  beforeEach(() => {
    routes = [];
    requestedUrls.length = 0;
    cacheGetMock.mockClear();
    cachePutMock.mockClear();
    cacheGetMock.mockResolvedValue(null);
    cachePutMock.mockResolvedValue(undefined);
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (input: string) => {
      requestedUrls.push(input);
      const route = routes.find((candidate) => input.includes(candidate.match));
      if (!route) return new Response("not found", { status: 404 });
      if (route.reject) throw route.reject;
      return new Response(route.body ?? null, { status: route.status });
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("resolves chunk URLs against the configured dataset repo", () => {
    expect(makeBackend(true).buildUrl("N40/N40W074.merged")).toBe(
      `${BASE}/${REPO}/resolve/main/N40/N40W074.merged`,
    );
    expect(new HuggingFaceChunkBackend("acme/custom", true).buildUrl("N40/N40W074.merged")).toBe(
      `${BASE}/acme/custom/resolve/main/N40/N40W074.merged`,
    );
  });

  it("satisfies the ChunkBackend contract", () => {
    const backend: ChunkBackend = makeBackend(true);
    expect(typeof backend.fetchChunk).toBe("function");
  });

  it("extracts a chunk out of a fetched merged file", async () => {
    const tile = nextTile();
    const chunkBytes = payload([1, 2, 3, 4]);
    routes = [
      { match: `${tile.base}.merged`, status: 200, body: buildMergedFile(2, 2, new Map([[1, chunkBytes]])) },
    ];

    const chunk = await makeBackend(true).fetchChunk(tile.name, 0, 1);

    expect(requestedUrls).toEqual([tile.mergedUrl]);
    expect(Array.from(new Uint8Array(chunk))).toEqual(Array.from(new Uint8Array(chunkBytes)));
  });

  it("writes the fetched merged file back to the chunk cache", async () => {
    const tile = nextTile();
    const merged = buildMergedFile(1, 1, new Map([[0, payload([9, 8, 7])]]));
    routes = [{ match: `${tile.base}.merged`, status: 200, body: merged }];

    await makeBackend(true).fetchChunk(tile.name, 0, 0);

    expect(cachePutMock).toHaveBeenCalledTimes(1);
    const [key, data] = cachePutMock.mock.calls[0];
    expect(key).toBe(`oz:merged:${tile.name}`);
    expect(Array.from(new Uint8Array(data))).toEqual(Array.from(new Uint8Array(merged)));
  });

  it("serves repeat lookups from the in-memory merged cache", async () => {
    const tile = nextTile();
    const first = payload([1, 1, 1]);
    const second = payload([2, 2, 2]);
    routes = [
      {
        match: `${tile.base}.merged`,
        status: 200,
        body: buildMergedFile(
          2,
          2,
          new Map([
            [0, first],
            [3, second],
          ]),
        ),
      },
    ];
    const backend = makeBackend(true);

    const a = await backend.fetchChunk(tile.name, 0, 0);
    const b = await backend.fetchChunk(tile.name, 1, 1);

    expect(requestedUrls).toHaveLength(1);
    expect(cacheGetMock).toHaveBeenCalledTimes(2);
    expect(Array.from(new Uint8Array(a))).toEqual(Array.from(new Uint8Array(first)));
    expect(Array.from(new Uint8Array(b))).toEqual(Array.from(new Uint8Array(second)));
  });

  it("expires the in-memory merged cache after 30 minutes", async () => {
    const tile = nextTile();
    vi.useFakeTimers({ now: Date.now() });
    routes = [
      { match: `${tile.base}.merged`, status: 200, body: buildMergedFile(1, 1, new Map([[0, payload([5])]])) },
    ];
    const backend = makeBackend(true);

    await backend.fetchChunk(tile.name, 0, 0);
    vi.setSystemTime(Date.now() + 31 * 60 * 1000);
    await backend.fetchChunk(tile.name, 0, 0);

    expect(requestedUrls).toHaveLength(2);
  });

  it("serves the merged file from the chunk cache without a network request", async () => {
    const tile = nextTile();
    const chunkBytes = payload([7, 7]);
    cacheGetMock.mockResolvedValue(buildMergedFile(2, 2, new Map([[2, chunkBytes]])));

    const chunk = await makeBackend(true).fetchChunk(tile.name, 1, 0);

    expect(requestedUrls).toHaveLength(0);
    expect(cacheGetMock.mock.calls[0]).toEqual([`oz:merged:${tile.name}`]);
    expect(Array.from(new Uint8Array(chunk))).toEqual(Array.from(new Uint8Array(chunkBytes)));
    expect(cachePutMock).not.toHaveBeenCalled();
  });

  it("ignores a cached merged file whose header cannot be parsed", async () => {
    const tile = nextTile();
    const chunkBytes = payload([1]);
    cacheGetMock.mockResolvedValue(toBuffer(Uint8Array.from([1, 2, 3])));
    routes = [
      { match: `${tile.base}.merged`, status: 200, body: buildMergedFile(1, 1, new Map([[0, chunkBytes]])) },
    ];

    const chunk = await makeBackend(true).fetchChunk(tile.name, 0, 0);

    expect(requestedUrls).toEqual([tile.mergedUrl]);
    expect(Array.from(new Uint8Array(chunk))).toEqual(Array.from(new Uint8Array(chunkBytes)));
  });

  it("fetches the single-chunk .deflate file when tryMerged is false", async () => {
    const tile = nextTile();
    const chunkBytes = payload([4, 5, 6]);
    routes = [{ match: `${tile.base}_01_00.deflate`, status: 200, body: chunkBytes }];

    const chunk = await makeBackend(false).fetchChunk(tile.name, 1, 0);

    expect(requestedUrls).toEqual([tile.deflateUrl(1, 0)]);
    expect(cacheGetMock).not.toHaveBeenCalled();
    expect(Array.from(new Uint8Array(chunk))).toEqual(Array.from(new Uint8Array(chunkBytes)));
  });

  it("falls back to the .deflate file when the merged file is unavailable", async () => {
    const tile = nextTile();
    const chunkBytes = payload([8, 9]);
    routes = [
      { match: `${tile.base}.merged`, status: 404 },
      { match: `${tile.base}_00_01.deflate`, status: 200, body: chunkBytes },
    ];

    const chunk = await makeBackend(true).fetchChunk(tile.name, 0, 1);

    expect(requestedUrls).toEqual([tile.mergedUrl, tile.deflateUrl(0, 1)]);
    expect(Array.from(new Uint8Array(chunk))).toEqual(Array.from(new Uint8Array(chunkBytes)));
  });

  it("rejects with the tile name and status when the chunk is missing", async () => {
    const tile = nextTile();
    routes = [
      { match: `${tile.base}.merged`, status: 404 },
      { match: `${tile.base}_00_01.deflate`, status: 404 },
    ];

    await expect(makeBackend(true).fetchChunk(tile.name, 0, 1)).rejects.toThrow(
      `Chunk not found: ${tile.name} row=0 col=1 (404)`,
    );
  });

  it("propagates network failures from the .deflate fetch", async () => {
    const tile = nextTile();
    vi.useFakeTimers();
    routes = [
      { match: `${tile.base}.merged`, status: 404 },
      { match: `${tile.base}_00_01.deflate`, status: 200, reject: new Error("connection reset") },
    ];

    await expect(makeBackend(true).fetchChunk(tile.name, 0, 1)).rejects.toThrow("connection reset");
  });

  it("gives up on the merged file when its fetch fails", async () => {
    const tile = nextTile();
    const chunkBytes = payload([3, 3]);
    routes = [
      { match: `${tile.base}.merged`, status: 200, reject: new Error("gateway timeout") },
      { match: `${tile.base}_00_00.deflate`, status: 200, body: chunkBytes },
    ];

    const chunk = await makeBackend(true).fetchChunk(tile.name, 0, 0);

    expect(Array.from(new Uint8Array(chunk))).toEqual(Array.from(new Uint8Array(chunkBytes)));
    expect(cachePutMock).not.toHaveBeenCalled();
  });

  it("gives up on the merged file when its body is not a merged file", async () => {
    const tile = nextTile();
    const chunkBytes = payload([6, 6]);
    routes = [
      { match: `${tile.base}.merged`, status: 200, body: toBuffer(Uint8Array.from([0, 0, 0, 0])) },
      { match: `${tile.base}_00_00.deflate`, status: 200, body: chunkBytes },
    ];

    const chunk = await makeBackend(true).fetchChunk(tile.name, 0, 0);

    expect(Array.from(new Uint8Array(chunk))).toEqual(Array.from(new Uint8Array(chunkBytes)));
  });
});
