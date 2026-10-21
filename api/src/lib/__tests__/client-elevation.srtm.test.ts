/**
 * Client elevation — the SRTM path and the corrupt/failing merged files.
 *
 * The DEM fixtures, the fetch router and the `afterEach` global-stub reset
 * live in `./client-elevation.harness` — imported first so the stub is in place.
 */

import { describe, it, expect } from "vitest";
import {
  installFixtures,
  jsonResponse,
  mergedWithFlatChunk0,
  mergedWithLinearChunk0,
} from "./client-elevation.harness";
import { getClientElevation } from "../client-elevation";

describe("getClientElevation — SRTM path", () => {
  it("decodes a HuggingFace merged chunk and reports the SRTM tile", async () => {
    const { calls } = installFixtures({ merged: { N41W074: mergedWithLinearChunk0() } });

    const result = await getClientElevation(41.95, -73.95);

    // pixel (180,180) of chunk (0,0) -> 100 + 180 + 180
    expect(result).toEqual({
      elevation: 460,
      surfaceType: "land",
      tile: "N41W074",
      status: "ok",
      source: "srtm",
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(
      "https://huggingface.co/datasets/aliasfox/srtm30m-merged/resolve/main/N41/N41W074.merged",
    );
    expect(calls[0]!.range).toBeNull();
  });

  it("normalises wrap-around longitudes before choosing a tile", async () => {
    installFixtures({ merged: { N41W074: mergedWithLinearChunk0() } });

    // 286.05 - 360 = -73.95 -> the same tile and pixel as the canonical longitude
    const result = await getClientElevation(41.95, 286.05);
    expect(result).toEqual({
      elevation: 460,
      surfaceType: "land",
      tile: "N41W074",
      status: "ok",
      source: "srtm",
    });
  });

  it("reports negative SRTM values as ocean but still credits SRTM for them", async () => {
    installFixtures({ merged: { N47W074: mergedWithFlatChunk0(-25) } });

    const result = await getClientElevation(47.95, -73.95);
    expect(result).toEqual({
      elevation: -25,
      surfaceType: "ocean",
      tile: "N47W074",
      status: "ok",
      // the value genuinely came from SRTM (below-sea-level land such as
      // Death Valley) — the ocean surface type must not re-label the source
      source: "srtm",
    });
  });
});

describe("getClientElevation — corrupt and failing merged files", () => {
  it("treats a merged file with a bad magic number as absent and asks the server", async () => {
    const garbage = new Uint8Array(64); // right size, wrong magic
    installFixtures({
      merged: { N40W074: garbage },
      pointEndpoint: () => jsonResponse({ elevation: 7, surface_type: "land", tile: "N40W074" }),
    });

    const result = await getClientElevation(40.5, -73.5);
    expect(result).toMatchObject({ elevation: 7, status: "ok", source: undefined });
  });

  it("falls through to the server when the merged fetch rejects outright", async () => {
    installFixtures({
      mergedThrows: ["N40W074"],
      pointEndpoint: () => jsonResponse({ elevation: 8, surface_type: "land", tile: "N40W074" }),
    });

    const result = await getClientElevation(40.5, -73.5);
    expect(result).toMatchObject({ elevation: 8, status: "ok", source: undefined });
  });

  it("defaults the surface type to unknown when the server omits it", async () => {
    installFixtures({
      merged: { N42W074: 404 },
      pointEndpoint: () => jsonResponse({ elevation: 6 }),
    });

    const result = await getClientElevation(41.5, -73.5);
    expect(result).toMatchObject({ elevation: 6, surfaceType: "unknown", status: "ok" });
  });
});
