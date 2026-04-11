/**
 * CSR-first CesiumJS terrain provider.
 *
 * Fetches SRTM chunks directly from HuggingFace in the browser,
 * assembles Float32Array heightmaps — no PNG round-trip needed.
 *
 * Falls back to server PNG tiles (/api/dem-tile) when HuggingFace
 * is unreachable (CORS blocked, offline, etc.).
 */

import { getClientTileData } from "@/lib/client-elevation";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CesiumType = any;

const TERRAIN_URL = "/api/dem-tile";
const MAX_TERRAIN_ZOOM = 10;

/**
 * Create a CSR-first terrain provider that fetches elevation data
 * directly from HuggingFace, bypassing the server.
 */
export function createCSRTerrainProvider(Cesium: CesiumType) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const provider = new (Cesium as any).EllipsoidTerrainProvider();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const HDT = (Cesium as any).HeightmapTerrainData;

  const heightmapStructure = {
    heightScale: 1.0,
    heightOffset: 0.0,
    elementsPerHeight: 1,
    stride: 1,
    elementMultiplier: 1.0,
    isBigEndian: false,
  };

  provider.requestTileGeometry = function (
    x: number,
    y: number,
    level: number,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    _request: any,
  ) {
    if (level > MAX_TERRAIN_ZOOM || !HDT) {
      return Promise.resolve(null);
    }

    // Try CSR-direct from HuggingFace first
    return getClientTileData(level, x, y)
      .then((result) => {
        if (result && result.heights) {
          return new HDT({
            buffer: result.heights,
            width: result.width,
            height: result.height,
            structure: heightmapStructure,
            childTileMask: level < MAX_TERRAIN_ZOOM ? 15 : 0,
          });
        }

        // Fallback: server PNG tile
        return fallbackServerTile(Cesium, level, x, y);
      })
      .catch(() => {
        // Both failed — return flat terrain
        return fallbackServerTile(Cesium, level, x, y);
      });
  };

  provider.getTileDataAvailable = function (x: number, y: number, level: number) {
    if (level > MAX_TERRAIN_ZOOM) return false;
    return undefined; // Cesium interprets as "assume available"
  };

  return provider;
}

/**
 * Fallback: fetch server-side PNG tile and decode Terrarium encoding.
 */
function fallbackServerTile(Cesium: CesiumType, level: number, x: number, y: number): Promise<any> {
  const url = `${TERRAIN_URL}/${level}/${x}/${y}`;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const HDT = (Cesium as any).HeightmapTerrainData;
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
        structure: {
          heightScale: 1.0,
          heightOffset: 0.0,
          elementsPerHeight: 1,
          stride: 1,
          elementMultiplier: 1.0,
          isBigEndian: false,
        },
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
        structure: {
          heightScale: 1.0,
          heightOffset: 0.0,
          elementsPerHeight: 1,
          stride: 1,
          elementMultiplier: 1.0,
          isBigEndian: false,
        },
      });
    });
}
