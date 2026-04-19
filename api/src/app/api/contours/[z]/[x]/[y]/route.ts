import { NextRequest, NextResponse } from "next/server";
import { getTileData } from "@/lib/tile";
import { HuggingFaceChunkBackend } from "@/lib/storage/backend";
import { r2GetTile, r2PutTile } from "@/lib/storage/r2-tile-cache";
import { CORS_HEADERS, corsPreflightResponse } from "@/lib/cors";

/**
 * Elevation contour lines endpoint.
 *
 * Generates contour lines from assembled elevation data using the
 * marching squares algorithm. Returns GeoJSON FeatureCollection.
 *
 * Major contours every 500m, minor contours every 100m.
 * Each contour has properties: elevation (m), type (major/minor).
 *
 * Tile URL pattern: /api/contours/{z}/{x}/{y}
 * Format: GeoJSON (application/json)
 */

const HF_BACKEND = new HuggingFaceChunkBackend("aliasfox/srtm30m-merged", true);

export const runtime = "edge";

const CACHE_HEADERS: Record<string, string> = {
  "Cache-Control": "public, max-age=3600, s-maxage=3600",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
};

const NODATA = -32768;
const _MINOR_INTERVAL = 100; // meters between minor contours
const _MAJOR_INTERVAL = 500; // meters between major contours

// Zoom level determines which contour interval to use (higher zoom = finer)
function getContourInterval(zoom: number) {
  if (zoom >= 10) return { minor: 50, major: 200 };
  if (zoom >= 8) return { minor: 100, major: 500 };
  if (zoom >= 6) return { minor: 200, major: 1000 };
  return { minor: 500, major: 2000 };
}

export async function OPTIONS() {
  return corsPreflightResponse();
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ z: string; x: string; y: string }> }) {
  const { z, x, y } = await params;

  const zoom = parseInt(z, 10);
  const tileX = parseInt(x, 10);
  const tileY = parseInt(y, 10);

  if (isNaN(zoom) || zoom < 4 || zoom > 14 || isNaN(tileX) || isNaN(tileY)) {
    return NextResponse.json(
      { error: "Invalid tile coordinates (z must be 4-14)" },
      { status: 400, headers: CORS_HEADERS },
    );
  }

  // R2 cache-aside: check R2 first
  try {
    const cached = await r2GetTile("contours", zoom, tileX, tileY);
    if (cached) {
      return new Response(cached, {
        headers: {
          ...CACHE_HEADERS,
          "Content-Type": "application/geojson",
          "X-Tile-Type": "contours",
          "X-Cache": "HIT",
        },
      });
    }
  } catch {
    // R2 unavailable
  }

  try {
    const tileData = await getTileData(zoom, tileX, tileY, HF_BACKEND);
    const geojson = generateContours(tileData, zoom, tileX, tileY);
    const body = JSON.stringify(geojson);

    // Store in R2
    r2PutTile("contours", zoom, tileX, tileY, new TextEncoder().encode(body), "application/geojson").catch(() => {});

    return new Response(body, {
      headers: {
        ...CACHE_HEADERS,
        "Content-Type": "application/geojson",
        "X-Tile-Type": "contours",
        "X-Cache": "MISS",
      },
    });
  } catch (error) {
    console.error(`Contour tile error: ${zoom}/${tileX}/${tileY}`, error);
    return NextResponse.json(
      { type: "FeatureCollection", features: [] },
      { headers: { ...CACHE_HEADERS, "Content-Type": "application/geojson" } },
    );
  }
}

/**
 * Marching squares contour generation.
 *
 * For each contour level, scan the elevation grid and extract iso-line segments.
 * Segments are assembled into polylines for the GeoJSON output.
 */
function generateContours(
  tile: { data: Int16Array; width: number; height: number },
  zoom: number,
  _tileX: number,
  _tileY: number,
): GeoJSON.FeatureCollection {
  const { data, width, height } = tile;
  const interval = getContourInterval(zoom);
  const features: GeoJSON.Feature[] = [];

  // Find elevation range in tile
  let minElev = Infinity;
  let maxElev = -Infinity;
  for (let i = 0; i < data.length; i++) {
    const v = data[i];
    if (v !== NODATA) {
      if (v < minElev) minElev = v;
      if (v > maxElev) maxElev = v;
    }
  }

  if (minElev === Infinity) {
    return { type: "FeatureCollection", features: [] };
  }

  // Round contour levels to intervals
  const startLevel = Math.ceil(minElev / interval.minor) * interval.minor;
  const endLevel = Math.floor(maxElev / interval.minor) * interval.minor;

  // Convert tile pixel coordinates to lat/lon
  const { north, south, west, east } = tileToLatLon(zoom, _tileX, _tileY);
  const latStep = (north - south) / height;
  const lonStep = (east - west) / width;

  // For each contour level, extract segments using marching squares
  for (let level = startLevel; level <= endLevel; level += interval.minor) {
    const isMajor = level % interval.major === 0;
    const segments: [number, number][] = []; // [lat, lon] pairs

    // March through each cell
    for (let row = 0; row < height - 1; row++) {
      for (let col = 0; col < width - 1; col++) {
        // Four corners of the cell (NW, NE, SW, SE)
        const nw = data[row * width + col];
        const ne = data[row * width + col + 1];
        const sw = data[(row + 1) * width + col];
        const se = data[(row + 1) * width + col + 1];

        // Skip cells with any NODATA
        if (nw === NODATA || ne === NODATA || sw === NODATA || se === NODATA) continue;

        // Marching squares: determine case from corner comparisons
        const caseIndex = (nw >= level ? 8 : 0) | (ne >= level ? 4 : 0) | (se >= level ? 2 : 0) | (sw >= level ? 1 : 0);

        if (caseIndex === 0 || caseIndex === 15) continue;

        // Interpolation helper: fraction along edge where contour crosses
        const lerpEdge = (a: number, b: number) => {
          if (a === b) return 0.5;
          return (level - a) / (b - a);
        };

        // Convert pixel coordinate to lat/lon
        const toLon = (c: number) => west + (c + 0.5) * lonStep;
        const toLat = (r: number) => north - (r + 0.5) * latStep;

        // Edge midpoints (interpolated)
        const topMid = lerpEdge(nw, ne);
        const rightMid = lerpEdge(ne, se);
        const bottomMid = lerpEdge(sw, se);
        const leftMid = lerpEdge(nw, sw);

        // Coordinates for each edge midpoint
        const topPt: [number, number] = [toLat(row), toLon(col + topMid)];
        const rightPt: [number, number] = [toLat(row + rightMid), toLon(col + 1)];
        const bottomPt: [number, number] = [toLat(row + 1), toLon(col + bottomMid)];
        const leftPt: [number, number] = [toLat(row + leftMid), toLon(col)];

        // Add line segments based on marching squares case
        const segs = marchingSquaresCase(caseIndex, topPt, rightPt, bottomPt, leftPt);
        for (const seg of segs) {
          segments.push(seg[0], seg[1]);
        }
      }
    }

    // Assemble segments into polylines (simplified: one LineString per contiguous segment pair)
    if (segments.length < 4) continue;

    // Group connected segments into polylines using a simple greedy chain
    const polylines = chainSegments(segments);

    for (const polyline of polylines) {
      if (polyline.length < 2) continue;

      features.push({
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: polyline.map(([lat, lon]) => [lon, lat]), // GeoJSON is [lon, lat]
        },
        properties: {
          elevation: level,
          type: isMajor ? "major" : "minor",
        },
      });
    }
  }

  return { type: "FeatureCollection", features };
}

/**
 * Marching squares lookup: for each of the 16 cases, return the line segments
 * connecting edge midpoints. Each segment is [[lat1,lon1], [lat2,lon2]].
 */
function marchingSquaresCase(
  caseIndex: number,
  top: [number, number],
  right: [number, number],
  bottom: [number, number],
  left: [number, number],
): [[number, number], [number, number]][] {
  switch (caseIndex) {
    case 1:
      return [[left, bottom]];
    case 2:
      return [[bottom, right]];
    case 3:
      return [[left, right]];
    case 4:
      return [[right, top]];
    case 5:
      return [
        [left, top],
        [bottom, right],
      ]; // saddle
    case 6:
      return [[bottom, top]];
    case 7:
      return [[left, top]];
    case 8:
      return [[top, left]];
    case 9:
      return [[top, bottom]];
    case 10:
      return [
        [top, right],
        [left, bottom],
      ]; // saddle
    case 11:
      return [[top, right]];
    case 12:
      return [[right, left]];
    case 13:
      return [[bottom, left]];
    case 14:
      return [[right, bottom]];
    default:
      return [];
  }
}

/**
 * Chain disconnected segments into polylines by connecting endpoints.
 * Uses simple greedy matching with a distance tolerance.
 */
function chainSegments(segments: [number, number][], _tolerance: number = 0.0005): [number, number][][] {
  // Build an adjacency structure from paired points
  const pointStr = (lat: number, lon: number) => `${lat.toFixed(6)},${lon.toFixed(6)}`;
  const edgeMap = new Map<string, [number, number][]>();

  for (let i = 0; i < segments.length; i += 2) {
    const a = segments[i];
    const b = segments[i + 1];
    if (!a || !b) continue;

    const keyA = pointStr(a[0], a[1]);
    const keyB = pointStr(b[0], b[1]);

    if (!edgeMap.has(keyA)) edgeMap.set(keyA, []);
    if (!edgeMap.has(keyB)) edgeMap.set(keyB, []);
    edgeMap.get(keyA)!.push(b);
    edgeMap.get(keyB)!.push(a);
  }

  const visited = new Set<string>();
  const polylines: [number, number][][] = [];

  for (const [key, neighbors] of edgeMap) {
    if (visited.has(key) || neighbors.length === 0) continue;

    // Start a new polyline from this point
    const startParts = key.split(",");
    const polyline: [number, number][] = [[parseFloat(startParts[0]), parseFloat(startParts[1])]];

    // Extend in both directions
    // Forward
    let current = key;
    let safety = 0;
    while (safety < 5000) {
      safety++;
      visited.add(current);
      const nbrs = edgeMap.get(current);
      if (!nbrs || nbrs.length === 0) break;

      let found = false;
      for (const nb of nbrs) {
        const nbKey = pointStr(nb[0], nb[1]);
        if (!visited.has(nbKey)) {
          polyline.push(nb);
          current = nbKey;
          found = true;
          break;
        }
      }
      if (!found) break;
    }

    if (polyline.length >= 2) {
      polylines.push(polyline);
    }
  }

  return polylines;
}

function tileToLatLon(z: number, x: number, y: number) {
  const n = 2 ** z;
  const north = (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI;
  const south = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 1)) / n))) * 180) / Math.PI;
  const west = (x / n) * 360 - 180;
  const east = ((x + 1) / n) * 360 - 180;
  return { north, south, west, east };
}
