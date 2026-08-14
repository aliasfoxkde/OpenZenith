/**
 * Downstream trace API — follow flow path from a point to the ocean.
 *
 * POST /api/trace
 * Body: { lat, lon, zoom, max_steps }
 *
 * Returns GeoJSON LineString of the trace path.
 */

import { NextRequest, NextResponse } from "next/server";
import { getTileData } from "@/lib/tile";
import { HuggingFaceChunkBackend } from "@/lib/storage/backend";
import { latLonToTile } from "@/lib/srtm/zoom-math";
import { CORS_HEADERS, corsPreflightResponse } from "@/lib/cors";

export const runtime = "edge";

const HF_BACKEND = new HuggingFaceChunkBackend("aliasfox/srtm30m-merged", true);
const NODATA = -32768;

const D8_DR = [0, 1, 1, 1, 0, -1, -1, -1];
const D8_DC = [1, 1, 0, -1, -1, -1, 0, 1];
const D8_DIST = [1, Math.SQRT2, 1, Math.SQRT2, 1, Math.SQRT2, 1, Math.SQRT2];

export async function OPTIONS() {
  return corsPreflightResponse();
}

export async function POST(request: NextRequest) {
  let body: { lat?: number; lon?: number; zoom?: number; max_steps?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400, headers: CORS_HEADERS });
  }

  const { lat, lon, zoom = 10, max_steps = 1000 } = body;

  if (typeof lat !== "number" || typeof lon !== "number") {
    return NextResponse.json({ error: "lat and lon are required" }, { status: 400, headers: CORS_HEADERS });
  }
  if (isNaN(lat) || isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return NextResponse.json({ error: "Invalid coordinates" }, { status: 400, headers: CORS_HEADERS });
  }

  const z = Math.min(14, Math.max(5, zoom));
  const maxSteps = Math.min(10000, Math.max(1, max_steps));

  try {
    const cellSizeDeg = 180 / (2 ** z * 256);
    const cellSizeM = cellSizeDeg * 111320;

    // Load initial grid centered on starting point
    const { x: cx, y: cy } = latLonToTile(lat, lon, z);
    const xFrac = ((lon + 180) / 360) * 2 ** z - cx;
    const latRad = (lat * Math.PI) / 180;
    const yFrac = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * 2 ** z - cy;

    const radius = 50;
    const gridRows = 2 * radius + 1;
    const gridCols = 2 * radius + 1;

    const centerPixelX = cx * 256 + xFrac * 256;
    const centerPixelY = cy * 256 + yFrac * 256;
    const minPixelX = Math.floor(centerPixelX - radius);
    const minPixelY = Math.floor(centerPixelY - radius);
    const tileXMin = Math.floor(minPixelX / 256);
    const tileXMax = Math.floor((minPixelX + gridCols - 1) / 256);
    const tileYMin = Math.floor(minPixelY / 256);
    const tileYMax = Math.floor((minPixelY + gridRows - 1) / 256);

    const tileDataMap = new Map<string, Int16Array>();
    for (let ty = tileYMin; ty <= tileYMax; ty++) {
      for (let tx = tileXMin; tx <= tileXMax; tx++) {
        const key = `${tx}/${ty}`;
        try {
          const tile = await getTileData(z, tx, ty, HF_BACKEND);
          tileDataMap.set(key, tile.data);
        } catch {
          /* unavailable */
        }
      }
    }

    function sampleElevation(latPt: number, lonPt: number): number {
      const n2 = 2 ** z;
      const tileX = Math.floor(((lonPt + 180) / 360) * n2);
      const latRad2 = (latPt * Math.PI) / 180;
      const tileY = Math.floor(((1 - Math.log(Math.tan(latRad2) + 1 / Math.cos(latRad2)) / Math.PI) / 2) * n2);
      const key = `${tileX}/${tileY}`;
      const tile = tileDataMap.get(key);
      if (!tile) return NODATA;

      const px = ((lonPt + 180) / 360) * n2 * 256 - tileX * 256;
      const py = ((1 - Math.log(Math.tan(latRad2) + 1 / Math.cos(latRad2)) / Math.PI) / 2) * n2 * 256 - tileY * 256;
      const x0 = Math.max(0, Math.min(255, Math.floor(px)));
      const y0 = Math.max(0, Math.min(255, Math.floor(py)));
      const x1 = Math.min(255, x0 + 1);
      const y1 = Math.min(255, y0 + 1);
      const fx = px - x0,
        fy = py - y0;

      const h00 = tile[y0 * 256 + x0];
      const h10 = tile[y0 * 256 + x1];
      const h01 = tile[y1 * 256 + x0];
      const h11 = tile[y1 * 256 + x1];

      if (h00 === NODATA && h10 === NODATA && h01 === NODATA && h11 === NODATA) return NODATA;
      return h00 * (1 - fx) * (1 - fy) + h10 * fx * (1 - fy) + h01 * (1 - fx) * fy + h11 * fx * fy;
    }

    function d8FromPoint(latPt: number, lonPt: number): { dir: number; elev: number; lat: number; lon: number } | null {
      const n2 = 2 ** z;
      const tileX = Math.floor(((lonPt + 180) / 360) * n2);
      const latRad2 = (latPt * Math.PI) / 180;
      const tileY = Math.floor(((1 - Math.log(Math.tan(latRad2) + 1 / Math.cos(latRad2)) / Math.PI) / 2) * n2);
      const key = `${tileX}/${tileY}`;
      const tile = tileDataMap.get(key);
      if (!tile) return null;

      const px = ((lonPt + 180) / 360) * n2 * 256 - tileX * 256;
      const py = ((1 - Math.log(Math.tan(latRad2) + 1 / Math.cos(latRad2)) / Math.PI) / 2) * n2 * 256 - tileY * 256;
      const x0 = Math.max(0, Math.min(255, Math.floor(px)));
      const y0 = Math.max(0, Math.min(255, Math.floor(py)));
      const x1 = Math.min(255, x0 + 1);
      const y1 = Math.min(255, y0 + 1);
      const fx = px - x0,
        fy = py - y0;

      const h00 = tile[y0 * 256 + x0];
      const h10 = tile[y0 * 256 + x1];
      const h01 = tile[y1 * 256 + x0];
      const h11 = tile[y1 * 256 + x1];

      if (h00 === NODATA && h10 === NODATA && h01 === NODATA && h11 === NODATA) return null;
      const centerElev = h00 * (1 - fx) * (1 - fy) + h10 * fx * (1 - fy) + h01 * (1 - fx) * fy + h11 * fx * fy;

      let bestDir = -1,
        bestDrop = 0;
      for (let d = 0; d < 8; d++) {
        const stepLat = cellSizeDeg * D8_DR[d];
        const stepLon = (cellSizeDeg * D8_DC[d]) / Math.cos((latPt * Math.PI) / 180);
        const neighborLat = latPt + stepLat;
        const neighborLon = lonPt + stepLon;

        const nKey = `${Math.floor(((neighborLon + 180) / 360) * n2)}/${Math.floor(((1 - Math.log(Math.tan((neighborLat * Math.PI) / 180) + 1 / Math.cos((neighborLat * Math.PI) / 180)) / Math.PI) / 2) * n2)}`;
        const nTile = tileDataMap.get(nKey);
        if (!nTile) continue;

        const npx = ((neighborLon + 180) / 360) * n2 * 256 - parseInt(nKey.split("/")[0]) * 256;
        const npy =
          ((1 -
            Math.log(Math.tan((neighborLat * Math.PI) / 180) + 1 / Math.cos((neighborLat * Math.PI) / 180)) / Math.PI) /
            2) *
            n2 *
            256 -
          parseInt(nKey.split("/")[1]) * 256;
        const nx0 = Math.max(0, Math.min(255, Math.floor(npx)));
        const ny0 = Math.max(0, Math.min(255, Math.floor(npy)));
        const nx1 = Math.min(255, nx0 + 1),
          ny1 = Math.min(255, ny0 + 1);
        const nfx = npx - nx0,
          nfy = npy - ny0;
        const nh00 = nTile[ny0 * 256 + nx0],
          nh10 = nTile[ny0 * 256 + nx1];
        const nh01 = nTile[ny1 * 256 + nx0],
          nh11 = nTile[ny1 * 256 + nx1];
        if (nh00 === NODATA && nh10 === NODATA && nh01 === NODATA && nh11 === NODATA) continue;
        const nElev = nh00 * (1 - nfx) * (1 - nfy) + nh10 * nfx * (1 - nfy) + nh01 * (1 - nfx) * nfy + nh11 * nfx * nfy;
        const drop = centerElev - nElev;
        if (drop > bestDrop) {
          bestDrop = drop;
          bestDir = d;
        }
      }
      if (bestDir === -1) return null;
      return { dir: bestDir, elev: centerElev, lat: latPt, lon: lonPt };
    }

    function haversineDistance(latA: number, lonA: number, latB: number, lonB: number): number {
      const R = 6371000;
      const dLat = ((latB - latA) * Math.PI) / 180;
      const dLon = ((lonB - lonA) * Math.PI) / 180;
      const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos((latA * Math.PI) / 180) * Math.cos((latB * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
      return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    const startElev = sampleElevation(lat, lon);
    if (startElev <= NODATA) {
      return NextResponse.json(
        { error: "No elevation data at starting point" },
        { status: 400, headers: CORS_HEADERS },
      );
    }

    const path: [number, number][] = [[Math.round(lat * 1e6) / 1e6, Math.round(lon * 1e6) / 1e6]];
    const elevations: number[] = [Math.round(startElev * 10) / 10];
    const distances: number[] = [0];

    let currentLat = lat;
    let currentLon = lon;
    let totalDist = 0;

    for (let step = 0; step < maxSteps; step++) {
      const result = d8FromPoint(currentLat, currentLon);
      if (!result || result.dir === -1) break;

      const stepDeg = cellSizeDeg * D8_DIST[result.dir];
      const stepLat = stepDeg * D8_DR[result.dir];
      const stepLon = (stepDeg * D8_DC[result.dir]) / Math.cos((currentLat * Math.PI) / 180);

      currentLat += stepLat;
      currentLon += stepLon;

      const newElev = sampleElevation(currentLat, currentLon);
      if (newElev <= NODATA) break;

      totalDist += haversineDistance(path[path.length - 1][0], path[path.length - 1][1], currentLat, currentLon);
      path.push([Math.round(currentLat * 1e6) / 1e6, Math.round(currentLon * 1e6) / 1e6]);
      elevations.push(Math.round(newElev * 10) / 10);
      distances.push(Math.round(totalDist * 10) / 10);

      if (newElev <= 0) break; // reached ocean
    }

    return NextResponse.json(
      {
        start: [lat, lon],
        end: [currentLat, currentLon],
        start_elev: elevations[0],
        end_elev: elevations[elevations.length - 1],
        total_distance: Math.round(totalDist),
        steps: path.length - 1,
        path,
        elevations,
        distances,
        geojson: {
          type: "Feature",
          geometry: { type: "LineString", coordinates: path },
          properties: {
            start: [lat, lon],
            end: [currentLat, currentLon],
            start_elev: elevations[0],
            end_elev: elevations[elevations.length - 1],
            total_distance: Math.round(totalDist),
            steps: path.length - 1,
          },
        },
      },
      {
        headers: { ...CORS_HEADERS, "Cache-Control": "public, max-age=86400" },
      },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 200, headers: CORS_HEADERS });
  }
}
