/**
 * Client elevation — the /api/elevation server fallback.
 *
 * The DEM fixtures, the fetch router and the `afterEach` global-stub reset
 * live in `./client-elevation.harness` — imported first so the stub is in place.
 */

import { describe, it, expect } from "vitest";
import {
  installFixtures,
  jsonResponse,
} from "./client-elevation.harness";
import { getClientElevation } from "../client-elevation";

describe("getClientElevation — server fallback", () => {
  it("uses /api/elevation when HuggingFace has no merged file", async () => {
    const { calls } = installFixtures({
      merged: { N42W074: 404 },
      pointEndpoint: () =>
        jsonResponse({ elevation: 12.5, surface_type: "land", tile: "N42W074", source: "huggingface" }),
    });

    const result = await getClientElevation(42.95, -73.95);

    expect(result).toEqual({
      elevation: 12.5,
      surfaceType: "land",
      tile: "N42W074",
      status: "ok",
      source: "huggingface",
    });
    expect(calls.at(-1)?.url).toBe("/api/elevation?lat=42.950000&lon=-73.950000");
  });

  it("sends the normalised longitude to the server endpoint", async () => {
    const { calls } = installFixtures({
      merged: { N42W074: 404 },
      pointEndpoint: () => jsonResponse({ elevation: 1, surface_type: "land", tile: "N42W074" }),
    });

    await getClientElevation(42.95, 286.05);
    expect(calls.at(-1)?.url).toBe("/api/elevation?lat=42.950000&lon=-73.950000");
  });

  it("reports no_data when the server has no elevation and flags it", async () => {
    installFixtures({
      merged: { N43W074: 404 },
      pointEndpoint: () => jsonResponse({ elevation: null, ok: false, surface_type: "unknown", source: "none" }),
    });

    const result = await getClientElevation(43.95, -73.95);
    expect(result).toEqual({
      elevation: null,
      surfaceType: "unknown",
      tile: "",
      status: "no_data",
      source: "none",
    });
  });

  it("reports no_data when the server only signals source none", async () => {
    installFixtures({
      merged: { N43W074: 404 },
      pointEndpoint: () => jsonResponse({ elevation: null, source: "none", tile: "N43W074" }),
    });

    const result = await getClientElevation(43.95, -73.95);
    expect(result.status).toBe("no_data");
    expect(result.tile).toBe("N43W074");
    expect(result.surfaceType).toBe("unknown");
  });

  it("reports unavailable when the server elevation is null without a signal", async () => {
    installFixtures({
      merged: { N43W074: 404 },
      pointEndpoint: () => jsonResponse({ elevation: null, surface_type: "ocean", tile: "N43W074" }),
    });

    const result = await getClientElevation(43.95, -73.95);
    expect(result).toEqual({
      elevation: null,
      surfaceType: "unknown",
      tile: "",
      status: "unavailable",
      source: "none",
    });
  });

  it("reports unavailable when the server responds with an error status", async () => {
    installFixtures({
      merged: { N43W074: 404 },
      pointEndpoint: () => jsonResponse({ elevation: 1 }, 503),
    });

    const result = await getClientElevation(43.95, -73.95);
    expect(result.status).toBe("unavailable");
    expect(result.elevation).toBeNull();
  });

  it("reports unavailable when every network hop rejects", async () => {
    installFixtures({
      merged: { N43W074: 404 },
      pointEndpoint: () => {
        throw new TypeError("fetch failed");
      },
    });

    const result = await getClientElevation(43.95, -73.95);
    expect(result).toEqual({
      elevation: null,
      surfaceType: "unknown",
      tile: "",
      status: "unavailable",
      source: "none",
    });
  });

  it("skips the client path for points outside SRTM coverage", async () => {
    const { calls } = installFixtures({
      pointEndpoint: () => jsonResponse({ elevation: 99, surface_type: "land", tile: "" }),
    });

    const result = await getClientElevation(75, 0);

    expect(result).toEqual({
      elevation: 99,
      surfaceType: "land",
      tile: "",
      status: "ok",
      source: undefined,
    });
    expect(calls.every((call) => !call.url.includes("huggingface.co"))).toBe(true);
    expect(calls).toHaveLength(1);
  });
});
