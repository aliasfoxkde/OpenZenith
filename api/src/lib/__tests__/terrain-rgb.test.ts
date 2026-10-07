import { describe, it, expect } from "vitest";
import { unzlibSync } from "fflate";
import {
  TERRAIN_RGB_MAX_CODE,
  decodeTerrainRgb,
  encodeTerrainRgbPNG,
  terrainRgbCode,
} from "../terrain-rgb";
import { encodeTerrariumPNG } from "../terrarium-png";

/** Read a PNG's dimensions and IDAT payload back into raw scanlines. */
function idatScanlines(png: Uint8Array): { width: number; height: number; raw: Uint8Array } {
  expect(png[0]).toBe(137); // PNG signature, then "PNG\r\n\x1a\n"
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let off = 8;
  let width = 0;
  let height = 0;
  const idat: Uint8Array[] = [];
  while (off < png.length) {
    const length = view.getUint32(off);
    const type = String.fromCharCode(png[off + 4], png[off + 5], png[off + 6], png[off + 7]);
    const data = png.subarray(off + 8, off + 8 + length);
    if (type === "IHDR") {
      width = view.getUint32(off + 8);
      height = view.getUint32(off + 12);
      expect(png[off + 16]).toBe(8); // bit depth
      expect(png[off + 17]).toBe(2); // colour type: truecolour
    } else if (type === "IDAT") {
      idat.push(data);
    }
    off += 12 + length; // length + type + data + CRC
  }
  const total = idat.reduce((sum, chunk) => sum + chunk.length, 0);
  const joined = new Uint8Array(total);
  idat.reduce((pos, chunk) => {
    joined.set(chunk, pos);
    return pos + chunk.length;
  }, 0);
  return { width, height, raw: unzlibSync(joined) };
}

describe("Terrain-RGB code packing", () => {
  it("packs 0 m onto the Mapbox offset", () => {
    expect(terrainRgbCode(0)).toBe(100_000);
    expect(decodeTerrainRgb(1, 134, 160)).toBeCloseTo(0, 6);
  });

  it("round-trips Everest's height at the format's 0.1 m resolution", () => {
    const code = terrainRgbCode(8848.6);
    expect(code).toBe(188_486);
    expect(decodeTerrainRgb((code >> 16) & 0xff, (code >> 8) & 0xff, code & 0xff)).toBeCloseTo(8848.6, 6);
  });

  it("clamps bathymetry below -10,000 m to code 0", () => {
    expect(terrainRgbCode(-10911)).toBe(0);
    // The Marianas sample the prompt asks about sits far below the offset.
    expect(terrainRgbCode(-10911)).toBeLessThanOrEqual(TERRAIN_RGB_MAX_CODE);
  });

  it("maps nodata and NaN onto code 0 like Mapbox's own encoder", () => {
    expect(terrainRgbCode(-32768)).toBe(0);
    expect(terrainRgbCode(Number.NaN)).toBe(0);
  });

  it("saturates instead of wrapping past the top of the range", () => {
    // The clamp sits at 2^23-1, far above any real terrain, so the observable
    // effect is that nonsense heights cannot wrap into a neighbouring digit
    // and read back as a low one.
    expect(terrainRgbCode(900_000)).toBe(TERRAIN_RGB_MAX_CODE);
    expect(
      decodeTerrainRgb(
        TERRAIN_RGB_MAX_CODE >> 16,
        (TERRAIN_RGB_MAX_CODE >> 8) & 0xff,
        TERRAIN_RGB_MAX_CODE & 0xff,
      ),
    ).toBeCloseTo(828_860.7, 6);
    // The format's own ceiling is higher; 8388607 is this encoder's clamp.
    expect(decodeTerrainRgb(255, 255, 255)).toBeCloseTo(1_667_721.5, 6);
  });

  it("lands nodata, sea level and the Everest sample on distinct digits", () => {
    const nodata = terrainRgbCode(-32768);
    expect(nodata).not.toBe(terrainRgbCode(0));
    expect(terrainRgbCode(0)).not.toBe(terrainRgbCode(8848.6));
  });
});

describe("Terrain-RGB PNG encoder", () => {
  // Heights chosen to cover nodata, deep bathymetry, sea level and land.
  const heights = new Int16Array([-32768, -4000, 0, 8848, -32768, 250, -100, 12, -32768, 5, 900, 300]);
  const png = encodeTerrainRgbPNG(heights, 4, 3);

  it("writes a 4x3 truecolour PNG whose pixels decode back to the heights", () => {
    const { width, height, raw } = idatScanlines(png);
    expect(width).toBe(4);
    expect(height).toBe(3);
    expect(raw.length).toBe(3 * (1 + 4 * 3));

    for (let py = 0; py < 3; py++) {
      expect(raw[py * (1 + 4 * 3)]).toBe(0); // filter type None
      for (let px = 0; px < 4; px++) {
        const i = py * 4 + px;
        const off = py * (1 + 4 * 3) + 1 + px * 3;
        const decoded = decodeTerrainRgb(raw[off], raw[off + 1], raw[off + 2]);
        if (heights[i] === -32768) {
          // Nodata is indistinguishable from saturated bathymetry in this format.
          expect(decoded).toBe(-10000);
        } else {
          expect(decoded).toBeCloseTo(heights[i], 1);
        }
      }
    }
  });

  it("encodes -10911 m to the same black pixel as nodata", () => {
    const deep = encodeTerrainRgbPNG(new Int16Array([-10911]), 1, 1);
    const { raw } = idatScanlines(deep);
    expect([raw[1], raw[2], raw[3]]).toEqual([0, 0, 0]);
  });
});

describe("Terrarium encoder (shared PNG writer)", () => {
  it("still decodes as Terrarium after the writer was extracted", () => {
    // The writer moved into rgb-png.ts when Terrain-RGB landed; this pins the
    // Terrarium byte layout so the refactor cannot drift it.
    const png = encodeTerrariumPNG(new Int16Array([100, -32768]), 2, 1);
    const { width, height, raw } = idatScanlines(png);
    expect(width).toBe(2);
    expect(height).toBe(1);
    const r0 = raw[1];
    const g0 = raw[2];
    expect(r0 * 256 + g0 + 0 / 256 - 32768).toBe(100);
    // NODATA is the reserved zero code in Terrarium, unlike Terrain-RGB.
    expect(raw[4] * 256 + raw[5]).toBe(0);
  });
});
