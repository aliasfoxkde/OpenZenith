import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { unzlibSync } from "fflate";

/**
 * Tests for /api/elevation-accuracy/[z]/[x]/[y] — the pure-compute resolution
 * heatmap. No storage or network is involved, so the suite validates the tile
 * coordinates, decodes the emitted PNG, and checks the per-source color
 * classification plus the fallback contract.
 */

vi.mock("fflate", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fflate")>();
  return { ...actual, zlibSync: vi.fn(actual.zlibSync) };
});

import { GET, OPTIONS } from "@/app/api/elevation-accuracy/[z]/[x]/[y]/route";
import { zlibSync } from "fflate";

const routeCtx = (z: string, x: string, y: string) => ({
  params: Promise.resolve({ z, x, y }),
});

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

interface DecodedPng {
  width: number;
  height: number;
  /** RGB triple per pixel, indexed as y * width + x. */
  pixels: Array<[number, number, number]>;
}

/** Decode the encoder's filter-none, 8-bit RGB output back into pixels. */
function decodePng(bytes: Uint8Array): DecodedPng {
  expect(Array.from(bytes.slice(0, 8))).toEqual(PNG_SIGNATURE);

  let width = 0;
  let height = 0;
  const idat: Uint8Array[] = [];
  let offset = 8;

  while (offset < bytes.length) {
    const view = new DataView(bytes.buffer, bytes.byteOffset + offset, 8);
    const length = view.getUint32(0);
    const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
    const data = bytes.slice(offset + 8, offset + 8 + length);

    if (type === "IHDR") {
      const ihdr = new DataView(data.buffer, data.byteOffset, 8);
      width = ihdr.getUint32(0);
      height = ihdr.getUint32(4);
    } else if (type === "IDAT") {
      idat.push(data);
    }
    offset += 12 + length;
  }

  expect(width).toBe(256);
  expect(height).toBe(256);

  const total = idat.reduce((sum, chunk) => sum + chunk.length, 0);
  const compressed = new Uint8Array(total);
  let cursor = 0;
  for (const chunk of idat) {
    compressed.set(chunk, cursor);
    cursor += chunk.length;
  }

  const raw = unzlibSync(compressed);
  const pixels: Array<[number, number, number]> = [];
  const stride = 1 + width * 3;
  for (let y = 0; y < height; y++) {
    expect(raw[y * stride]).toBe(0); // filter type None
    for (let x = 0; x < width; x++) {
      const off = y * stride + 1 + x * 3;
      pixels.push([raw[off], raw[off + 1], raw[off + 2]]);
    }
  }
  return { width, height, pixels };
}

/** Mirror of the route's Web Mercator tile math: pixel index for a lat/lon. */
function pixelIndex(z: number, x: number, y: number, lat: number, lon: number): number {
  const n = 2 ** z;
  const north = (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI;
  const south = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 1)) / n))) * 180) / Math.PI;
  const west = (x / n) * 360 - 180;
  const east = ((x + 1) / n) * 360 - 180;
  const px = Math.floor(((lon - west) / (east - west)) * 256);
  const py = Math.floor(((north - lat) / (north - south)) * 256);
  return py * 256 + px;
}

beforeEach(() => {
  vi.mocked(zlibSync).mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function getTile(z: number, x: number, y: number): Promise<Response> {
  return GET(new NextRequest(`http://localhost/api/elevation-accuracy/${z}/${x}/${y}`), routeCtx(String(z), String(x), String(y)));
}

describe("Elevation accuracy API validation (/api/elevation-accuracy)", () => {
  it("rejects non-numeric tile coordinates with 400", async () => {
    const resp = await GET(new NextRequest("http://localhost/api/elevation-accuracy/abc/1/1"), routeCtx("abc", "1", "1"));
    expect(resp.status).toBe(400);
    const body = (await resp.json()) as { error: string };
    expect(body.error).toBe("Invalid tile coordinates");
  });

  it("rejects zoom above the supported range with 400", async () => {
    const resp = await getTile(15, 0, 0);
    expect(resp.status).toBe(400);
    const body = (await resp.json()) as { error: string };
    expect(body.error).toBe("Invalid tile coordinates");
  });

  it("strips the .png extension from the y segment", async () => {
    const resp = await GET(new NextRequest("http://localhost/api/elevation-accuracy/8/100/60.png"), routeCtx("8", "100", "60.png"));
    expect(resp.status).toBe(200);
    expect(resp.headers.get("Content-Type")).toBe("image/png");
  });

  it("exposes CORS preflight", async () => {
    const resp = await OPTIONS();
    expect(resp.status).toBe(204);
    expect(resp.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });
});

describe("Elevation accuracy API tile encoding", () => {
  it("emits a 256x256 PNG with cache headers on a world tile", async () => {
    const resp = await getTile(0, 0, 0);
    expect(resp.status).toBe(200);
    expect(resp.headers.get("Content-Type")).toBe("image/png");
    expect(resp.headers.get("X-Tile-Type")).toBe("elevation-accuracy");
    expect(resp.headers.get("Cache-Control")).toContain("max-age=31536000");

    const bytes = new Uint8Array(await resp.arrayBuffer());
    expect(resp.headers.get("Content-Length")).toBe(String(bytes.byteLength));
    const decoded = decodePng(bytes);
    expect(decoded.pixels).toHaveLength(256 * 256);
  });

  it.each([
    ["Europe land uses the 10m EEA green", 48, 10, [34, 197, 94]],
    ["Arctic land uses the 2m cyan", 75, -100, [0, 210, 230]],
    ["Antarctic land uses the 2m cyan", -75, 0, [0, 210, 230]],
    ["SRTM-band land uses the 30m green", -20, -60, [34, 139, 34]],
    ["Ocean uses the GEBCO blue", 0, -140, [33, 113, 181]],
  ])("%s", async (_name, lat, lon, expected) => {
    const resp = await getTile(0, 0, 0);
    const decoded = decodePng(new Uint8Array(await resp.arrayBuffer()));
    expect(decoded.pixels[pixelIndex(0, 0, 0, lat, lon)]).toEqual(expected);
  });

  it("returns 200 with a fallback tile when encoding fails (never 5xx)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(zlibSync).mockImplementationOnce(() => {
      throw new Error("zlib failure");
    });

    const resp = await getTile(8, 100, 60);
    expect(resp.status).toBe(200);
    expect(resp.headers.get("X-Tile-Type")).toBe("fallback");
    expect(resp.headers.get("Content-Type")).toBe("image/png");
    const bytes = new Uint8Array(await resp.arrayBuffer());
    expect(Array.from(bytes.slice(0, 8))).toEqual(PNG_SIGNATURE);
  });
});
