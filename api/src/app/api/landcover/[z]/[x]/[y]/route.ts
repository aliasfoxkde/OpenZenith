/**
 * CORINE Land Cover tile proxy.
 *
 * Proxies WMS tiles from EEA (European Environment Agency)
 * CORINE Land Cover 2018 dataset.
 */

export const runtime = "edge";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ z: string; x: string; y: string }> },
) {
  const { z, x, y } = await params;

  const wmsUrl = new URL("https://image.discomap.eea.europa.eu/arcgis/services/CLMS/CLMS_CORINE/MapServer/WMSServer");
  wmsUrl.searchParams.set("SERVICE", "WMS");
  wmsUrl.searchParams.set("VERSION", "1.3.0");
  wmsUrl.searchParams.set("REQUEST", "GetMap");
  wmsUrl.searchParams.set("LAYERS", "1");
  wmsUrl.searchParams.set("FORMAT", "image/png");
  wmsUrl.searchParams.set("TRANSPARENT", "TRUE");
  wmsUrl.searchParams.set("WIDTH", "256");
  wmsUrl.searchParams.set("HEIGHT", "256");
  wmsUrl.searchParams.set("CRS", "EPSG:3857");
  wmsUrl.searchParams.set("STYLES", "");

  const zoom = parseInt(z, 10);
  const tileX = parseInt(x, 10);
  const tileY = parseInt(y, 10);

  const n = Math.pow(2, zoom);
  const lon1 = (tileX / n) * 360 - 180;
  const lon2 = ((tileX + 1) / n) * 360 - 180;
  const lat1Rad = Math.atan(Math.sinh(Math.PI * (1 - 2 * tileY / n)));
  const lat2Rad = Math.atan(Math.sinh(Math.PI * (1 - 2 * (tileY + 1) / n)));
  const lat1 = (lat1Rad * 180) / Math.PI;
  const lat2 = (lat2Rad * 180) / Math.PI;

  wmsUrl.searchParams.set("BBOX", `${lat2},${lon1},${lat1},${lon2}`);

  try {
    const res = await fetch(wmsUrl.toString(), {
      headers: { "User-Agent": "OpenZenith/1.0" },
    });

    if (!res.ok) {
      return new Response("Tile not available", { status: res.status });
    }

    const contentType = res.headers.get("content-type") || "image/png";
    const buffer = await res.arrayBuffer();

    return new Response(buffer, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=604800", // 1 week cache
      },
    });
  } catch {
    return new Response("Failed to fetch tile", { status: 502 });
  }
}
