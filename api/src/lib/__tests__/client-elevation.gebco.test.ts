/**
 * Client elevation — the GEBCO strip fallback.
 *
 * The DEM fixtures, the fetch router and the `afterEach` global-stub reset
 * live in `./client-elevation.harness` — imported first so the stub is in place.
 */

import { describe, it, expect } from "vitest";
import {
  CEDA_STRIP,
  chunkPayload,
  installFixtures,
  jsonResponse,
  mergedFile,
  slot,
  stripFor,
} from "./client-elevation.harness";
import { getClientElevation } from "../client-elevation";

describe("getClientElevation — GEBCO fallback", () => {
  it("falls back to a GEBCO strip when the SRTM pixel is nodata", async () => {
    const nodataMerged = mergedFile([{ slot: slot(0, 0), data: chunkPayload(() => -32768, 256, 256) }], 15, 15);
    const { calls } = installFixtures({
      merged: { N39W074: nodataMerged },
      strips: { "gebco_2025_n90.0_s0.0_w-90.0_e0.0.tif": stripFor(3842, -3000) },
    });

    const result = await getClientElevation(39.99, -73.99);

    expect(result).toEqual({
      elevation: -3000,
      surfaceType: "ocean",
      tile: "gebco_2025_n90.0_s0.0_w-90.0_e0.0.tif",
      status: "ok",
      source: "gebco2025",
    });
    expect(calls).toHaveLength(2);
    expect(calls[1]!.url).toBe(
      "https://dap.ceda.ac.uk/bodc/gebco/global/gebco_2025/ice_surface_elevation/geotiff/gebco_2025_n90.0_s0.0_w-90.0_e0.0.tif",
    );
    // row (90 - 39.99) * 240 = 12002 -> 135948 + 12002 * 43200
    expect(calls[1]!.range).toBe("bytes=518622348-518665547");
  });

  it("keeps searching for a server value when the GEBCO strip is unusable", async () => {
    const nodataMerged = mergedFile([{ slot: slot(0, 0), data: chunkPayload(() => -32768, 256, 256) }], 15, 15);
    installFixtures({
      merged: { N38W074: nodataMerged },
      strips: { "gebco_2025_n90.0_s0.0_w-90.0_e0.0.tif": stripFor(3842, 20000) }, // physically impossible
      pointEndpoint: () => jsonResponse({ elevation: 4.5, surface_type: "land", tile: "N38W074" }),
    });

    const result = await getClientElevation(38.99, -73.99);
    expect(result).toEqual({
      elevation: 4.5,
      surfaceType: "land",
      tile: "N38W074",
      status: "ok",
      source: undefined,
    });
  });

  it("credits GEBCO with a land surface type for positive elevations", async () => {
    const nodataMerged = mergedFile([{ slot: slot(0, 0), data: chunkPayload(() => -32768, 256, 256) }], 15, 15);
    installFixtures({
      merged: { N39W074: nodataMerged },
      strips: { "gebco_2025_n90.0_s0.0_w-90.0_e0.0.tif": stripFor(3842, 150) },
    });

    const result = await getClientElevation(39.98, -73.99);
    expect(result).toMatchObject({ elevation: 150, surfaceType: "land", source: "gebco2025" });
  });

  it("reuses a cached GEBCO strip for repeat lookups without refetching", async () => {
    const nodataMerged = mergedFile([{ slot: slot(0, 0), data: chunkPayload(() => -32768, 256, 256) }], 15, 15);
    const { calls } = installFixtures({
      merged: { N39W074: nodataMerged },
      strips: { "gebco_2025_n90.0_s0.0_w-90.0_e0.0.tif": stripFor(3842, -3000) },
    });

    await getClientElevation(39.95, -73.99);
    await getClientElevation(39.95, -73.99);
    expect(calls.filter((c) => CEDA_STRIP.test(c.url))).toHaveLength(1);
  });

  it("accepts a GEBCO strip served with status 200 when the range is ignored", async () => {
    const nodataMerged = mergedFile([{ slot: slot(0, 0), data: chunkPayload(() => -32768, 256, 256) }], 15, 15);
    installFixtures({
      merged: { N39W074: nodataMerged },
      stripsAt200: { "gebco_2025_n90.0_s0.0_w-90.0_e0.0.tif": stripFor(3842, -1200) },
    });

    const result = await getClientElevation(39.97, -73.99);
    expect(result).toMatchObject({ elevation: -1200, surfaceType: "ocean", source: "gebco2025" });
  });

  it("treats a rejecting GEBCO strip fetch as unusable and asks the server", async () => {
    const nodataMerged = mergedFile([{ slot: slot(0, 0), data: chunkPayload(() => -32768, 256, 256) }], 15, 15);
    installFixtures({
      merged: { N39W074: nodataMerged },
      stripsThrows: ["gebco_2025_n90.0_s0.0_w-90.0_e0.0.tif"],
      pointEndpoint: () => jsonResponse({ elevation: 9, surface_type: "land", tile: "N39W074" }),
    });

    const result = await getClientElevation(39.96, -73.99);
    expect(result).toMatchObject({ elevation: 9, status: "ok", source: undefined });
  });

  it("rejects a truncated GEBCO strip that cannot hold the sampled column", async () => {
    const nodataMerged = mergedFile([{ slot: slot(0, 0), data: chunkPayload(() => -32768, 256, 256) }], 15, 15);
    installFixtures({
      merged: { N39W074: nodataMerged },
      strips: { "gebco_2025_n90.0_s0.0_w-90.0_e0.0.tif": new Uint8Array(10) },
      pointEndpoint: () => jsonResponse({ elevation: 3, surface_type: "land", tile: "N39W074" }),
    });

    const result = await getClientElevation(39.94, -73.99);
    expect(result).toMatchObject({ elevation: 3, status: "ok", source: undefined });
  });

  it("treats an error-status GEBCO strip request as unusable and asks the server", async () => {
    const nodataMerged = mergedFile([{ slot: slot(0, 0), data: chunkPayload(() => -32768, 256, 256) }], 15, 15);
    const { calls } = installFixtures({
      merged: { N37W074: nodataMerged },
      // CEDA answers the range request with a server error: the strip is
      // neither a 206 partial nor a 200 full body, so it cannot be decoded.
      strips: { "gebco_2025_n90.0_s0.0_w-90.0_e0.0.tif": 503 },
      pointEndpoint: () => jsonResponse({ elevation: 5, surface_type: "land", tile: "N37W074" }),
    });

    const result = await getClientElevation(37.95, -73.99);

    expect(result).toMatchObject({ elevation: 5, status: "ok", source: undefined });
    // Exactly one strip attempt was made — a failed strip is not cached, but
    // the lookup also does not retry it.
    expect(calls.filter((c) => CEDA_STRIP.test(c.url))).toHaveLength(1);
  });
});
