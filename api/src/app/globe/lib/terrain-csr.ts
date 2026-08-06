/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * CSR-first CesiumJS terrain provider.
 *
 * Fetches SRTM chunks directly from HuggingFace in the browser,
 * assembles Float32Array heightmaps — no PNG round-trip needed.
 *
 * Falls back to server PNG tiles (/api/dem-tile) when HuggingFace
 * is unreachable (CORS blocked, offline, etc.).
 *
 * Uses a custom TerrainProvider approach compatible with CesiumJS 1.119
 * instead of overriding EllipsoidTerrainProvider (which is unreliable).
 */

import { getClientTileData } from "@/lib/client-elevation";

type CesiumType = any;

const TERRAIN_URL = "/api/dem-tile";
const MAX_TERRAIN_ZOOM = 10;

const HEIGHTMAP_STRUCTURE = {
  heightScale: 1.0,
  heightOffset: 0.0,
  elementsPerHeight: 1,
  stride: 1,
  elementMultiplier: 1.0,
  isBigEndian: false,
};

/**
 * Create a CSR-first terrain provider.
 *
 * Returns an object that satisfies Cesium's TerrainProvider interface.
 * Uses the prototype chain to ensure CesiumJS 1.119 recognizes it
 * as a valid TerrainProvider.
 */
export function createCSRTerrainProvider(Cesium: CesiumType) {
  // Access Cesium's internal terrain provider infrastructure
  const TDT = Cesium.HeightmapTerrainData;
  const Resource = Cesium.Resource;

  // Build a plain object that CesiumJS treats as a TerrainProvider
  // by assigning the constructor prototype
  const provider: any = Object.create(Cesium.TerrainProvider.prototype);

  provider.ready = true;
  provider.readyPromise = Promise.resolve(provider);
  // Use Object.defineProperty so hasVertexNormals is a writable property,
  // not a read-only getter inherited from TerrainProvider.prototype.
  // This fixes: "Cannot set property hasVertexNormals of #<nl> which has only a getter"
  Object.defineProperty(provider, "hasVertexNormals", { value: false, writable: true, configurable: true });
  Object.defineProperty(provider, "hasWaterMask", { value: false, writable: true, configurable: true });
  provider.errorEvent = new Cesium.Event();

  provider.requestTileGeometry = function (x: number, y: number, level: number, _request: any) {
    if (level > MAX_TERRAIN_ZOOM || !TDT) {
      return Promise.resolve(null);
    }

    // Try CSR-direct from HuggingFace first
    return getClientTileData(level, x, y)
      .then((result: any) => {
        if (result && result.heights) {
          return new TDT({
            buffer: result.heights,
            width: result.width,
            height: result.height,
            structure: HEIGHTMAP_STRUCTURE,
            childTileMask: level < MAX_TERRAIN_ZOOM ? 15 : 0,
          });
        }

        // Fallback: server PNG tile
        return fallbackServerTile(Cesium, level, x, y);
      })
      .catch(() => {
        // Both failed — try server fallback
        return fallbackServerTile(Cesium, level, x, y);
      });
  };

  provider.getTileDataAvailable = function (x: number, y: number, level: number) {
    if (level > MAX_TERRAIN_ZOOM) return false;
    return undefined; // Cesium interprets as "assume available"
  };

  provider.getLevelMaximumGeometricError = function (level: number) {
    // Earth circumference ~40075017m; 2^level tiles at that level
    return (40075017.0 * 2.0) / ((1 << level) * 65);
  };

  provider.tilingScheme = new Cesium.GeographicTilingScheme({
    ellipsoid: Cesium.Ellipsoid.WGS84,
    numberOfLevelZeroTilesX: 2,
    numberOfLevelZeroTilesY: 1,
  });

  provider.ellipsoid = Cesium.Ellipsoid.WGS84;

  return provider;
}

/**
 * Fallback: fetch server-side PNG tile and decode Terrarium encoding.
 */
function fallbackServerTile(Cesium: CesiumType, level: number, x: number, y: number): Promise<any> {
  const url = `${TERRAIN_URL}/${level}/${x}/${y}?format=png`;
  const HDT = Cesium.HeightmapTerrainData;
  if (!HDT) return Promise.resolve(null);

  return Cesium.Resource.fetchImage({ url })
    .then((image: HTMLImageElement) => {
      const w = image.width;
      const h = image.height;
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(image, 0, 0);
      const imageData = ctx.getImageData(0, 0, w, h);
      const pixels = imageData.data;

      // Decode Terrarium encoding to float32 heightmap
      const heights = new Float32Array(w * h);
      for (let i = 0; i < heights.length; i++) {
        const offset = i * 4;
        const R = pixels[offset];
        const G = pixels[offset + 1];
        const B = pixels[offset + 2];
        heights[i] = R * 256 + G + B / 256 - 32768;
      }

      return new HDT({
        buffer: heights,
        width: w,
        height: h,
        structure: HEIGHTMAP_STRUCTURE,
        childTileMask: level < MAX_TERRAIN_ZOOM ? 15 : 0,
      });
    })
    .catch(() => {
      // Server also failed — return flat
      const flat = new Float32Array(256 * 256);
      return new HDT({
        buffer: flat,
        width: 256,
        height: 256,
        structure: HEIGHTMAP_STRUCTURE,
      });
    });
}
