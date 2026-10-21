/**
 * Client elevation — the slippy-tile assembly and its SRTM cell overlap guard.
 *
 * The DEM fixtures, the fetch router and the `afterEach` global-stub reset
 * live in `./client-elevation.harness` — imported first so the stub is in place.
 */

import { describe, it, expect } from "vitest";
import {
  HF_MERGED,
  NODATA,
  chunkPayload,
  installFixtures,
  linearTileChunks,
  mergedFile,
  mergedWithFlatChunk0,
  mergedWithLinearChunk0,
  slot,
} from "./client-elevation.harness";
import { getClientTileData } from "../client-elevation";

describe("getClientTileData", () => {
  it("returns a zero-filled tile for out-of-coverage requests without fetching", async () => {
    const { calls } = installFixtures();

    // z2/1/0 covers 66.5N..85.1N — north of the SRTM mask
    const tile = await getClientTileData(2, 1, 0);

    expect(tile).not.toBeNull();
    expect(tile?.width).toBe(256);
    expect(tile?.height).toBe(256);
    expect(tile?.heights).toHaveLength(65536);
    expect([...(tile?.heights as Float32Array)].every((h) => h === 0)).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it("fills every pixel from a single SRTM chunk when the tile sits inside it", async () => {
    installFixtures({ merged: { N46W074: mergedWithFlatChunk0(500) } });

    // z15 9652/11532 lies entirely inside chunk (0,0) of N46W074
    const tile = await getClientTileData(15, 9652, 11532);

    expect(tile?.width).toBe(256);
    expect(tile?.height).toBe(256);
    expect(tile?.heights).toHaveLength(65536);
    expect([...(tile?.heights as Float32Array)].every((h) => h === 500)).toBe(true);
  });

  it("stitches two SRTM tiles across a one-degree boundary", async () => {
    installFixtures({
      merged: {
        // west of -74: chunk (0,14) holds the remainder column (500 + row +
        // 14*17 + col for its 17 real pixels; stored 256 wide, zero padded)
        N40W075: mergedFile(
          [{ slot: slot(0, 14), data: chunkPayload((r, c) => 500 + r + 14 * 17 + c, 256, 256) }],
          15,
          15,
        ),
        // east of -74: chunk (0,0) holds 100 + row + col
        N40W074: mergedFile([{ slot: slot(0, 0), data: chunkPayload((r, c) => 100 + r + c, 256, 256) }], 15, 15),
      },
    });

    // z13 2412/3072 straddles lon -74 near lat 40.98
    const tile = await getClientTileData(13, 2412, 3072);
    const heights = tile?.heights as Float32Array;
    const at = (py: number, px: number) => heights[py * 256 + px];

    // hand-computed pixel centres
    expect(at(0, 0)).toBe(813); // west of -74 -> N40W075 remainder chunk
    expect(at(0, 23)).toBe(173); // east of -74 -> N40W074 chunk (0,0)
    expect(at(128, 200)).toBe(342);
    expect(at(255, 255)).toBe(436);
    expect(at(200, 5)).toBe(909);
    expect([...heights].every((h) => h !== NODATA)).toBe(true);
  });

  it("leaves NODATA heights where the slippy tile falls outside the fetched SRTM tiles", async () => {
    // z13 2412/2816: lat 48.9225..48.8936 (SRTM rows 279..383 -> chunk row 1),
    // lon -74.00390625..-73.9599609375 (SRTM cols 0..144 -> chunk col 0).
    // Only N48W074 is served; the western sliver N48W075 (lon < -74) has no
    // merged file -> 404.
    installFixtures({
      merged: { N48W074: mergedFile(linearTileChunks([[1, 0]]), 15, 15) },
    });

    const tile = await getClientTileData(13, 2412, 2816);
    const heights = tile?.heights as Float32Array;
    const at = (py: number, px: number) => heights[py * 256 + px];

    // Columns 0..22 are west of -74 (N48W074) and stay NODATA.
    const nodata = [...heights].filter((h) => h === NODATA);
    expect(nodata).toHaveLength(23 * 256);
    expect(at(0, 0)).toBe(NODATA);
    expect(at(0, 22)).toBe(NODATA);

    // Column 23 onwards lands in N48W074; value = 100 + tileRow + tileCol.
    expect(at(0, 23)).toBe(379); // tile pixel (279, 0)
    expect(at(0, 255)).toBe(523); // tile pixel (279, 144)
    expect(at(128, 23)).toBe(431); // tile pixel (331, 0)
    expect(at(255, 23)).toBe(483); // tile pixel (383, 0)
    expect(at(255, 255)).toBe(627); // tile pixel (383, 144)
  });

  it("leaves NODATA where the neighbouring chunk is missing instead of wrapping values", async () => {
    // z13 2413/3072 spans chunk columns 144..302 of N40W074, i.e. chunks
    // (0,0) and (0,1); only (0,0) is present in the merged file.
    installFixtures({ merged: { N40W074: mergedWithLinearChunk0() } });

    const tile = await getClientTileData(13, 2413, 3072);
    const heights = tile?.heights as Float32Array;
    const at = (py: number, px: number) => heights[py * 256 + px];

    // Inside chunk (0,0): correct values (100 + tileRow + tileCol).
    expect(at(0, 0)).toBe(317); // tile pixel (73, 144)
    expect(at(0, 179)).toBe(428); // tile pixel (73, 255)
    // From column 256 the pixels belong to the missing chunk (0,1) — they
    // stay NODATA rather than inheriting chunk (0,0) wrapped to local col 0.
    expect(at(0, 180)).toBe(NODATA);
    expect(at(0, 255)).toBe(NODATA);
  });

  it("returns null when a needed chunk index is outside the merged index", async () => {
    // z13 2412/2852: lat 47.872..47.843 -> SRTM rows 460..566 (chunk rows 1..2),
    // so chunk (1,0) is requested. The served merged file declares a 1x1 index,
    // whose only entry cannot address chunk (1,0) -> the lookup throws and the
    // public wrapper turns that into a null tile.
    installFixtures({ merged: { N47W074: mergedFile([], 1, 1) } });

    const tile = await getClientTileData(13, 2412, 2852);

    expect(tile).toBeNull();
  });
});

describe("getClientTileData — SRTM cell overlap guard", () => {
  it("skips a sampled cell whose overlap with the slippy tile is empty", async () => {
    const { calls } = installFixtures();

    // z18/138342/81630 spans lat 55.99915..55.99992 — narrower than the 0.001°
    // sampling epsilon. `south + 0.001` reaches past the tile's north edge into
    // the N56 row, whose cell starts at lat 56 (above the whole tile), so the
    // north/south overlap of that sampled cell is empty and it must be dropped
    // before any chunk is requested for it.
    const tile = await getClientTileData(18, 138342, 81630);

    expect(tile?.width).toBe(256);
    expect(tile?.height).toBe(256);
    expect([...(tile?.heights as Float32Array)].every((h) => h === NODATA)).toBe(true);
    const requested = calls.map((c) => c.url.match(HF_MERGED)?.[1]).filter((name) => name !== undefined);
    // The tile still assembles from the cell it genuinely overlaps...
    expect(requested).toContain("N55E009");
    // ...but never touches the cell whose overlap was empty.
    expect(requested).not.toContain("N56E009");
  });

  it("keeps tile rows outside the sampled cell nodata instead of wrapping them", async () => {
    // z6/18/23 spans 45.09N..40.98N over 5.6° of longitude, so it overlaps nine
    // SRTM cells. Serving only chunk rows 0..2 / cols 0..2 of every cell fills
    // the rows that genuinely fall inside a sampled cell; the rest of the tile
    // (including the 68 rows north of lat 44) must stay NODATA.
    const servedChunks = mergedFile(
      [0, 1, 2].flatMap((chunkRow) =>
        [0, 1, 2].map((chunkCol) => ({ slot: slot(chunkRow, chunkCol), data: chunkPayload(() => 500, 256, 256) })),
      ),
      15,
      15,
    );
    installFixtures({ mergedFor: () => servedChunks });

    const tile = await getClientTileData(6, 18, 23);
    const heights = [...(tile?.heights as Float32Array)];

    // The first 68 tile rows lie north of every cell whose chunks decoded —
    // the per-row cell guard keeps them nodata instead of inheriting the
    // served chunks' values.
    const firstFilled = heights.findIndex((h) => h !== NODATA);
    expect(firstFilled).toBeGreaterThan(-1);
    expect(Math.floor(firstFilled / 256)).toBe(68);
    expect(heights.slice(0, 68 * 256).every((h) => h === NODATA)).toBe(true);
    // Only the rows that genuinely fall inside a sampled cell carry values —
    // a sliver of the 256x256 tile, not a wrap of the served chunk.
    const filled = heights.filter((h) => h !== NODATA).length;
    expect(filled).toBeGreaterThan(0);
    expect(filled).toBeLessThan(heights.length / 100);
  });
});
