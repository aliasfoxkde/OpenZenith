import { NextRequest, NextResponse } from "next/server";
import { getTileData } from "@/lib/tile";
import { getTileDataCRS84, crs84MatrixSize } from "@/lib/tile-crs84";
import { HuggingFaceChunkBackend } from "@/lib/storage/backend";
import { encodeTerrariumPNG } from "@/lib/terrarium-png";
import { CORS_HEADERS, corsPreflightResponse } from "@/lib/cors";

/**
 * Marks this route for the Cloudflare Edge runtime, so its handlers execute
 * as Edge Workers rather than in the Node.js server runtime.
 */
export const runtime = "edge";

/**
 * OGC API - Tiles tile data endpoint.
 *
 * Serves terrain elevation tiles in Terrarium PNG encoding.
 * Assembles tiles on-the-fly from HuggingFace SRTM 30m chunk datasets.
 *
 * Follows OGC API - Tiles 1.0 path: /tiles/{tileMatrixSetId}/{tileMatrix}/{tileRow}/{tileCol}
 */

const CACHE_HEADERS: Record<string, string> = {
  "Cache-Control": "public, max-age=31536000, immutable",
  ...CORS_HEADERS,
};

// Direct HuggingFace backend — avoids process.env which may not work on edge
const HF_BACKEND = new HuggingFaceChunkBackend("aliasfox/srtm30m-merged", true);

/**
 * CORS preflight for the OGC API - Tiles tile endpoint: answers OPTIONS with
 * the shared CORS headers and an empty body.
 */
export function OPTIONS() {
  return corsPreflightResponse();
}

/**
 * GET /api/tiles/{tileMatrixSetId}/{tileMatrix}/{tileRow}/{tileCol} — serves
 * a terrain elevation tile in Terrarium PNG encoding, following the
 * OGC API - Tiles 1.0 path layout.
 *
 * `tileMatrixSetId` selects the grid: `WebMercatorQuad` (assembled natively
 * from the 3857 SRTM XYZ sources) or `WorldCRS84Quad` (per-pixel resampling
 * into true EPSG:4326 tiles); any other value is a 400. `tileMatrix` is the
 * zoom level (0–14, otherwise 400) and `tileRow`/`tileCol` are the row and
 * column — note the column is `tileCol` and the row is `tileRow`, so they
 * map to the usual x/y in that order. A tile outside the matrix for its zoom
 * answers 404. Successful responses are `image/png` with
 * `Cache-Control: public, max-age=31536000, immutable` and an
 * `X-Dem-Tile-Source` marker; an assembly failure answers 502 rather than
 * a flat ocean tile.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ tileMatrixSetId: string; tileMatrix: string; tileRow: string; tileCol: string }> },
) {
  const { tileMatrixSetId, tileMatrix, tileRow, tileCol } = await params;

  // Validate tile matrix set. Both advertised sets are assembled
  // conformantly: WebMercatorQuad natively (the sources are 3857 XYZ grids)
  // and WorldCRS84Quad by per-pixel sampling of the same sources into true
  // lat/lon tiles (see lib/tile-crs84.ts).
  const validSets = ["WebMercatorQuad", "WorldCRS84Quad"];
  if (!validSets.includes(tileMatrixSetId)) {
    return NextResponse.json(
      { code: "InvalidParameterValue", description: `Unknown tileMatrixSet: ${tileMatrixSetId}` },
      { status: 400, headers: CORS_HEADERS },
    );
  }

  // Validate zoom level
  const z = parseInt(tileMatrix, 10);
  if (isNaN(z) || z < 0 || z > 14) {
    return NextResponse.json(
      { code: "InvalidParameterValue", description: `Invalid tileMatrix (zoom): ${tileMatrix}` },
      { status: 400, headers: CORS_HEADERS },
    );
  }

  // Validate tile coordinates
  const x = parseInt(tileCol, 10);
  const y = parseInt(tileRow, 10);
  if (isNaN(x) || isNaN(y) || x < 0 || y < 0) {
    return NextResponse.json(
      { code: "InvalidParameterValue", description: "Invalid tile coordinates" },
      { status: 400, headers: CORS_HEADERS },
    );
  }

  // Validate tile is within range for this zoom. WorldCRS84Quad's matrices
  // are 2^(z+1) columns x 2^z rows; WebMercatorQuad's are square 2^z.
  const { matrixWidth, matrixHeight } =
    tileMatrixSetId === "WorldCRS84Quad" ? crs84MatrixSize(z) : { matrixWidth: 2 ** z, matrixHeight: 2 ** z };
  if (x >= matrixWidth || y >= matrixHeight) {
    return NextResponse.json(
      { code: "TileOutOfRange", description: `Tile ${z}/${x}/${y} is out of range` },
      { status: 404, headers: CORS_HEADERS },
    );
  }

  try {
    const tileData =
      tileMatrixSetId === "WorldCRS84Quad"
        ? await getTileDataCRS84(z, x, y, HF_BACKEND)
        : await getTileData(z, x, y, HF_BACKEND);
    const png = encodeTerrariumPNG(tileData.data, tileData.width, tileData.height);

    return new Response(png.buffer as ArrayBuffer, {
      headers: {
        ...CACHE_HEADERS,
        "Content-Type": "image/png",
        "Content-Length": String(png.byteLength),
        "X-Dem-Tile-Source": "huggingface",
      },
    });
  } catch {
    // getTileData / getTileDataCRS84 return all-NODATA grids (HTTP 200) for
    // genuine ocean / out-of-coverage tiles, so reaching this catch means
    // assembly itself failed (HuggingFace outage, decode error). Report 502
    // instead of serving a flat 0m ocean tile that masks the outage.
    return NextResponse.json(
      { code: "NoApplicableCode", description: "Failed to assemble tile" },
      { status: 502, headers: CORS_HEADERS },
    );
  }
}
