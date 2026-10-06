import { existsSync, readdirSync as readDirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { decodeOZT2 } from "../ozt2_decode";

/**
 * Cross-implementation check: the TypeScript decoder must reproduce the Python
 * decoder (openzenith.tile_format_v2) bit-exactly on real dataset tiles,
 * including the quantized bit depths (8/9/10/11) and the all-nodata bits-16
 * shape. Reference values were produced by tile_format_v2.decode on
 * 2026-10-05; the sweep additionally decodes a fresh sample from the local
 * dataset. Both skip wherever the data/ mirror is absent (CI runners).
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../data/ozt2_tiles");
const HAS_DATA = existsSync(ROOT);

/** Python-decoder reference values (openzenith.tile_format_v2.decode). */
const REF: Array<{ path: string; min: number; max: number; mean: number; c: number; tl: number; br: number }> = [
  { path: "z11/389/810.ozt2", min: 1906, max: 2291, mean: 2121.7912, c: 2202, tl: 2119, br: 2162 },
  { path: "z11/633/1188.ozt2", min: 4247, max: 6101, mean: 4873.7296, c: 4591, tl: 4728, br: 4728 },
  { path: "z11/531/727.ozt2", min: 200, max: 301, mean: 244.1671, c: 257, tl: 251, br: 228 },
  { path: "z11/1175/687.ozt2", min: 178, max: 242, mean: 198.343, c: 193, tl: 182, br: 230 },
  { path: "z11/302/687.ozt2", min: -1, max: 371, mean: 51.9481, c: 49, tl: 97, br: 0 },
  { path: "z11/1347/650.ozt2", min: 93, max: 471, mean: 156.7594, c: 121, tl: 112, br: 317 },
  { path: "z10/811/317.ozt2", min: 392, max: 846, mean: 660.7812, c: 703, tl: 669, br: 509 },
  { path: "z10/822/508.ozt2", min: -5, max: 555, mean: 14.6819, c: 3, tl: 0, br: 16 },
  { path: "z10/788/351.ozt2", min: 1806, max: 2398, mean: 2013.8312, c: 2001, tl: 2050, br: 1932 },
  { path: "z10/917/435.ozt2", min: -32768, max: 0, mean: -20736.0, c: -32768, tl: 0, br: -32768 },
  { path: "z10/757/323.ozt2", min: 109, max: 270, mean: 178.5625, c: 146, tl: 246, br: 244 },
  { path: "z10/894/568.ozt2", min: 246, max: 385, mean: 297.8503, c: 289, tl: 315, br: 297 },
];

describe.skipIf(!HAS_DATA)("TS decoder vs Python decoder on real dataset tiles", () => {
  it.each(REF)("matches on $path", async (r) => {
    const buf = readFileSync(`${ROOT}/${r.path}`);
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    const res = await decodeOZT2(ab);
    const g = res.elevation;
    expect(res.width).toBe(256);
    expect(res.height).toBe(256);
    let sum = 0;
    let min = Infinity, max = -Infinity;
    for (let i = 0; i < g.length; i++) { sum += g[i]; if (g[i] < min) min = g[i]; if (g[i] > max) max = g[i]; }
    expect(min).toBe(r.min);
    expect(max).toBe(r.max);
    expect(sum / g.length).toBeCloseTo(r.mean, 3);
    expect(g[128 * 256 + 128]).toBe(r.c);
    expect(g[0]).toBe(r.tl);
    expect(g[255 * 256 + 255]).toBe(r.br);
  });

  it("decodes a sample of existing dataset tiles across zooms without error", async () => {
    // Deterministic sweep over files that actually exist: every decode must
    // succeed and yield 256x256. Compressor flags are read from the header.
    let decoded = 0, brotli = 0, zstd = 0;
    for (const z of [7, 8, 9, 10, 11]) {
      const xs = readDirSync(`${ROOT}/z${z}`).slice(0, 2);
      for (const x of xs) {
        const ys = readDirSync(`${ROOT}/z${z}/${x}`, { withFileTypes: true })
          .filter((e) => e.isFile() && e.name.endsWith(".ozt2"))
          .slice(0, 12)
          .map((e) => e.name);
        for (const y of ys) {
          const buf = readFileSync(`${ROOT}/z${z}/${x}/${y}`);
          const comp = (buf[5] >> 2) & 0b11;
          if (comp === 0) brotli++; else if (comp === 1) zstd++;
          const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
          const res = await decodeOZT2(ab);
          expect(res.width).toBe(256);
          expect(res.height).toBe(256);
          decoded++;
        }
      }
    }
    console.log(`sweep: ${decoded} tiles (${brotli} brotli, ${zstd} zstd)`);
    expect(brotli).toBeGreaterThan(0);
    expect(decoded).toBe(brotli + zstd);
  });
});
