/**
 * PMTiles archive serving endpoint.
 *
 * The archive itself lives on HuggingFace and is served with HTTP Range
 * support by the resolve endpoint, so this route only resolves a key to its
 * archive URL: a known key 302-redirects there and GDAL (/vsicurl +
 * PMTiles driver), MapLibre's pmtiles protocol and QGIS read the archive
 * directly from HF without this route sitting in the path.
 *
 * Key grammar: `z<zoom>.pmtiles` (e.g. `z7.pmtiles`). Archives are built per
 * zoom by `scripts/build_pmtiles_z7.py`; a zoom that has not been built yet
 * answers 410 with the list of archives that do exist.
 *
 * 302 (not 301) on purpose: the archive set grows zoom by zoom and the
 * redirect target is the repository's current state, so a permanently-cached
 * redirect would freeze clients on today's set.
 */

import { NextRequest, NextResponse } from "next/server";
import { CORS_HEADERS, corsPreflightResponse } from "@/lib/cors";

export const runtime = "edge";

const PMTILES_REPO = "aliasfox/srtm30m-terrain-pmtiles";

/** Archive key -> HuggingFace resolve URL. One line per new zoom. */
const PMTILES_ARCHIVES: Record<string, string> = {
  "z7.pmtiles": `https://huggingface.co/datasets/${PMTILES_REPO}/resolve/main/z7.pmtiles`,
};

const AVAILABLE_KEYS = Object.keys(PMTILES_ARCHIVES);

// Preflight has nothing to await — stays promise-returning because callers await handlers.
export function OPTIONS() {
  return Promise.resolve(corsPreflightResponse());
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const target = PMTILES_ARCHIVES[key];

  if (target) {
    return new NextResponse(null, {
      status: 302,
      headers: {
        ...CORS_HEADERS,
        Location: target,
        // The archive URL is stable for a built zoom; the redirect itself is
        // the only thing that can change (a new zoom, or a re-pointed repo).
        "Cache-Control": "public, max-age=86400",
      },
    });
  }

  return NextResponse.json(
    {
      error: "PMTiles archive not available",
      message: `PMTiles archive not built for this zoom; available: ${AVAILABLE_KEYS.join(", ")}. Got key "${key}" — request z<zoom>.pmtiles (e.g. z7.pmtiles).`,
      alternatives: [
        ...(AVAILABLE_KEYS.length
          ? [
              {
                type: "pmtiles-archive",
                url: `/api/pmtiles/${AVAILABLE_KEYS[0]}`,
                format: "PMTiles v3 (Terrarium PNG)",
              },
            ]
          : []),
        { type: "dem-tiles", url: "/api/dem-tile/{z}/{x}/{y}", format: "Terrarium PNG" },
        { type: "ogc-tiles", url: "/api/tiles/WebMercatorQuad/{z}/{x}/{y}", format: "OGC API Tiles" },
        { type: "elevation", url: "/api/elevation?lat={lat}&lon={lon}", format: "JSON" },
      ],
    },
    {
      status: 410,
      headers: CORS_HEADERS,
    },
  );
}
