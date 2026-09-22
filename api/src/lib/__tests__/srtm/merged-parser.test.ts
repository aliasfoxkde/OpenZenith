import { describe, it, expect } from "vitest";
import { deflateSync, inflateSync } from "fflate";
import { parseMergedHeader, extractChunkFromMerged, getLatDir, getTileBase } from "../../srtm/merged-parser";
import type { MergedIndex } from "../../srtm/merged-parser";

/**
 * OZCHNK01 fixtures are synthesised inline:
 *   [8] magic "OZCHNK01" [2] version LE [1] rows [1] cols
 *   [rows*cols * 8] index entries (offset LE, size LE)
 *   [..] concatenated deflate-compressed chunk payloads
 */
const MAGIC = [0x4f, 0x5a, 0x43, 0x48, 0x4e, 0x4b, 0x30, 0x31];

class MergedBuilder {
  private chunks: Uint8Array[] = [];
  private index: Array<{ offset: number; size: number }> = [];

  constructor(
    readonly version: number,
    readonly rows: number,
    readonly cols: number,
  ) {}

  /** Append a payload; it is deflate-compressed like the real merged files. */
  addChunk(payload: string): this {
    const compressed = deflateSync(new TextEncoder().encode(payload), { level: 1 });
    this.index.push({ offset: 0, size: compressed.length });
    this.chunks.push(compressed);
    return this;
  }

  build(): Uint8Array {
    const indexSize = this.rows * this.cols * 8;
    const bodyLength = this.chunks.reduce((sum, c) => sum + c.length, 0);
    const out = new Uint8Array(12 + indexSize + bodyLength);
    out.set(MAGIC, 0);
    const view = new DataView(out.buffer);
    view.setUint16(8, this.version, true);
    out[10] = this.rows;
    out[11] = this.cols;

    let cursor = 12 + indexSize;
    this.chunks.forEach((chunk, i) => {
      this.index[i].offset = cursor;
      out.set(chunk, cursor);
      cursor += chunk.length;
    });

    this.index.forEach((entry, i) => {
      const at = 12 + i * 8;
      view.setUint32(at, entry.offset, true);
      view.setUint32(at + 4, entry.size, true);
    });

    return out;
  }
}

describe("parseMergedHeader", () => {
  it("parses a valid v1 header and index", () => {
    const data = new MergedBuilder(1, 2, 3).addChunk("alpha").addChunk("beta").addChunk("gamma").build();

    const index = parseMergedHeader(data);

    expect(index).not.toBeNull();
    expect(index?.rows).toBe(2);
    expect(index?.cols).toBe(3);
    expect(index?.entries).toHaveLength(6);
    // Chunks 3..5 were never appended, so their entries stay zero-filled.
    expect(index?.entries[0].size).toBeGreaterThan(0);
    expect(index?.entries[5]).toEqual({ offset: 0, size: 0 });
  });

  it("parses a v2 (float32) header", () => {
    const index = parseMergedHeader(new MergedBuilder(2, 1, 1).addChunk("x").build());
    expect(index).toEqual({ rows: 1, cols: 1, entries: [{ offset: expect.any(Number), size: expect.any(Number) }] });
  });

  it("reads chunk offsets relative to the file start", () => {
    const data = new MergedBuilder(1, 1, 2).addChunk("first").addChunk("second").build();
    const index = parseMergedHeader(data) as MergedIndex;

    // Index (2 entries x 8 bytes) sits between the 12-byte header and the data.
    expect(index.entries[0].offset).toBe(12 + 16);
    expect(index.entries[1].offset).toBe(index.entries[0].offset + index.entries[0].size);
  });

  it("returns null for a truncated buffer", () => {
    expect(parseMergedHeader(new Uint8Array(11))).toBeNull();
    expect(parseMergedHeader(new Uint8Array(0))).toBeNull();
  });

  it("returns null when the magic bytes are wrong", () => {
    const data = new MergedBuilder(1, 1, 1).addChunk("x").build();
    data[3] = 0x58; // "OZCXNK01"
    expect(parseMergedHeader(data)).toBeNull();
  });

  it("returns null for an unsupported version", () => {
    const data = new MergedBuilder(3, 1, 1).addChunk("x").build();
    expect(parseMergedHeader(data)).toBeNull();
  });

  it("treats zero-dimension tiles as an empty index", () => {
    const data = new MergedBuilder(1, 0, 0).build();
    expect(parseMergedHeader(data)).toEqual({ rows: 0, cols: 0, entries: [] });
  });

  it("parses a subarray view without swallowing its byte offset", () => {
    const full = new MergedBuilder(1, 1, 1).addChunk("payload").build();
    const padded = new Uint8Array(4 + full.length);
    padded.set(full, 4);
    const view = padded.subarray(4);

    const index = parseMergedHeader(view);

    expect(index?.entries[0].size).toBeGreaterThan(0);
    // The reported offset must point inside the view, not the backing buffer.
    const chunk = extractChunkFromMerged(view, index as MergedIndex, 0, 0);
    expect(decodeChunk(chunk)).toBe("payload");
  });
});

describe("extractChunkFromMerged", () => {
  const data = new MergedBuilder(1, 2, 2).addChunk("one").addChunk("two").addChunk("three").addChunk("four").build();
  const index = parseMergedHeader(data) as MergedIndex;

  it("extracts the requested chunk by row/col", () => {
    expect(decodeChunk(extractChunkFromMerged(data, index, 0, 0))).toBe("one");
    expect(decodeChunk(extractChunkFromMerged(data, index, 0, 1))).toBe("two");
    expect(decodeChunk(extractChunkFromMerged(data, index, 1, 0))).toBe("three");
    expect(decodeChunk(extractChunkFromMerged(data, index, 1, 1))).toBe("four");
  });

  it("addresses chunks in row-major order", () => {
    expect(decodeChunk(extractChunkFromMerged(data, index, 1, 0))).toBe("three");
  });

  it("returns an empty slice for a zero-size entry", () => {
    const sparse = new MergedBuilder(1, 1, 1).build();
    const sparseIndex = parseMergedHeader(sparse) as MergedIndex;
    expect(extractChunkFromMerged(sparse, sparseIndex, 0, 0)).toHaveLength(0);
  });
});

function decodeChunk(chunk: Uint8Array): string {
  return new TextDecoder().decode(inflateSync(chunk));
}

describe("srtm name helpers", () => {
  it("getLatDir returns the hemisphere/latitude prefix", () => {
    expect(getLatDir("N28E086.tif")).toBe("N28");
    expect(getLatDir("S23W043.tif")).toBe("S23");
  });

  it("getTileBase strips the .tif extension", () => {
    expect(getTileBase("N28E086.tif")).toBe("N28E086");
    expect(getTileBase("N28E086")).toBe("N28E086");
  });
});
