/**
 * Custom CesiumJS terrain provider that fetches Terrarium PNG tiles
 * from R2 via /api/dem-tile/{z}/{x}/{y} and decodes them to heightmaps.
 *
 * Terrarium encoding: height_m = (R * 256 + G + B / 256) - 32768
 *
 * This avoids the need for quantized-mesh conversion by using
 * CesiumJS's built-in HeightmapTerrainData with decoded elevation values.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CesiumType = any;

const TERRAIN_URL = "/api/dem-tile";
const MAX_TERRAIN_ZOOM = 12;

/**
 * Create a terrain provider that loads Terrarium PNG heightmap tiles from R2.
 */
export function createTerrariumTerrainProvider(Cesium: CesiumType) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const provider = new (Cesium as any).EllipsoidTerrainProvider();

  // Override requestTileGeometry to fetch and decode Terrarium PNG tiles
  const origRequest = provider.requestTileGeometry?.bind(provider);
  provider.requestTileGeometry = function (
    x: number,
    y: number,
    level: number,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    request: any,
  ) {
    // Beyond our tile zoom, fall back to flat ellipsoid
    if (level > MAX_TERRAIN_ZOOM) {
      return origRequest ? origRequest(x, y, level, request) : Promise.resolve(null);
    }

    const url = `${TERRAIN_URL}/${level}/${x}/${y}`;
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

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const HDT = (Cesium as any).HeightmapTerrainData;
        if (!HDT) return null;

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
        // Tile fetch failed — return flat terrain
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const HDT = (Cesium as any).HeightmapTerrainData;
        if (!HDT) return null;
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
  };

  // Override getTileDataAvailable to report availability
  provider.getTileDataAvailable = function (x: number, y: number, level: number) {
    if (level > MAX_TERRAIN_ZOOM) return false;
    return undefined; // Cesium interprets as "assume available"
  };

  return provider;
}
