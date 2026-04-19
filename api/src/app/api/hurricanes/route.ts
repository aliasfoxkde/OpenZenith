import { NextRequest, NextResponse } from "next/server";
import { cachedFetch } from "@/lib/cache";
import { CORS_HEADERS, corsPreflightResponse } from "@/lib/cors";

export const runtime = "edge";

const CACHE_TTL_HURRICANES = 1800;

const IBTRACS_URL =
  "https://www.ncei.noaa.gov/data/international-best-track-archive-for-climate-stewardship-ibtracs/v04r01/access/csv/ibtracs.last3years.list.v04r01.csv";

function parseIbtracs(csv: string, fullTrack = false): GeoJSON.FeatureCollection {
  const lines = csv.trim().split("\n");
  if (lines.length < 3) return { type: "FeatureCollection", features: [] };

  // Header line has column names. Second line is units. Third line onward is data.
  const headers = lines[0].split(",").map((h) => h.trim());
  const sidIdx = headers.indexOf("SID");
  const nameIdx = headers.indexOf("NAME");
  const latIdx = headers.indexOf("LAT");
  const lonIdx = headers.indexOf("LON");
  const windIdx = headers.indexOf("WMO_WIND");
  const presIdx = headers.indexOf("WMO_PRES");
  const seasonIdx = headers.indexOf("SEASON");
  const basinIdx = headers.indexOf("BASIN");
  const natureIdx = headers.indexOf("NATURE");
  const isoTimeIdx = headers.indexOf("ISO_TIME");

  if (sidIdx === -1) return { type: "FeatureCollection", features: [] };

  if (fullTrack) {
    // Return full track polylines (MultiLineString per storm)
    const stormTracks = new Map<string, { coords: number[][]; times: string[]; winds: number[]; name: string; season: string; basin: string; nature: string }>();

    for (let i = 2; i < lines.length; i++) {
      const cols = lines[i].split(",");
      if (cols.length < headers.length) continue;
      const sid = cols[sidIdx]?.trim();
      if (!sid || sid === "SID") continue;

      const lat = parseFloat(cols[latIdx]?.trim());
      const lon = parseFloat(cols[lonIdx]?.trim());
      if (isNaN(lat) || isNaN(lon)) continue;

      const wind = parseInt(cols[windIdx]?.trim(), 10) || 0;
      const time = cols[isoTimeIdx]?.trim() || "";

      if (!stormTracks.has(sid)) {
        stormTracks.set(sid, {
          coords: [], times: [], winds: [],
          name: cols[nameIdx]?.trim() || "UNNAMED",
          season: cols[seasonIdx]?.trim() || "",
          basin: cols[basinIdx]?.trim() || "",
          nature: cols[natureIdx]?.trim() || "",
        });
      }
      const track = stormTracks.get(sid)!;
      track.coords.push([lon, lat]);
      track.times.push(time);
      track.winds.push(wind);
    }

    const features: GeoJSON.Feature[] = [];
    for (const [sid, track] of stormTracks) {
      if (track.coords.length < 2) continue;

      // Compute max wind for category
      const maxWind = Math.max(...track.winds);
      let category = 0;
      if (maxWind >= 137) category = 5;
      else if (maxWind >= 113) category = 4;
      else if (maxWind >= 96) category = 3;
      else if (maxWind >= 83) category = 2;
      else if (maxWind >= 64) category = 1;
      else if (maxWind >= 34) category = -1;

      features.push({
        type: "Feature",
        geometry: {
          type: "MultiLineString",
          coordinates: [track.coords],
        },
        properties: {
          sid,
          name: track.name === "NOT_NAMED" ? "UNNAMED" : track.name,
          season: parseInt(track.season, 10) || 0,
          basin: track.basin,
          nature: track.nature,
          wind: maxWind || null,
          pressure: null,
          category,
          categoryLabel:
            category >= 5 ? "Cat 5" : category >= 4 ? "Cat 4" : category >= 3 ? "Cat 3"
            : category >= 2 ? "Cat 2" : category >= 1 ? "Cat 1"
            : category === -1 ? "Tropical Storm" : "Tropical Depression",
          isoTime: track.times[track.times.length - 1],
          trackPoints: track.coords.length,
          times: track.times,
          winds: track.winds,
        },
      });
    }

    return { type: "FeatureCollection", features };
  }

  // Default: latest position per storm (point per storm)
  const storms = new Map<string, Record<string, string>>();

  for (let i = 2; i < lines.length; i++) {
    const cols = lines[i].split(",");
    if (cols.length < headers.length) continue;

    const sid = cols[sidIdx]?.trim();
    if (!sid) continue;

    // Skip header rows that may appear in data
    if (sid === "SID") continue;

    storms.set(sid, {
      sid,
      name: cols[nameIdx]?.trim() || "UNNAMED",
      lat: cols[latIdx]?.trim() || "",
      lon: cols[lonIdx]?.trim() || "",
      wind: cols[windIdx]?.trim() || "",
      pres: cols[presIdx]?.trim() || "",
      season: cols[seasonIdx]?.trim() || "",
      basin: cols[basinIdx]?.trim() || "",
      nature: cols[natureIdx]?.trim() || "",
      isoTime: cols[isoTimeIdx]?.trim() || "",
    });
  }

  const features: GeoJSON.Feature[] = [];

  for (const s of storms.values()) {
    const lat = parseFloat(s.lat);
    const lon = parseFloat(s.lon);
    if (isNaN(lat) || isNaN(lon)) continue;

    const wind = parseInt(s.wind, 10) || 0;
    const pres = parseInt(s.pres, 10) || 0;

    let category = 0;
    if (wind >= 137) category = 5;
    else if (wind >= 113) category = 4;
    else if (wind >= 96) category = 3;
    else if (wind >= 83) category = 2;
    else if (wind >= 64) category = 1;
    else if (wind >= 34) category = -1; // Tropical Storm

    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [lon, lat] },
      properties: {
        sid: s.sid,
        name: s.name === "NOT_NAMED" ? "UNNAMED" : s.name,
        season: parseInt(s.season, 10) || 0,
        basin: s.basin,
        nature: s.nature,
        wind: wind || null,
        pressure: pres || null,
        category,
        categoryLabel:
          category >= 5
            ? "Cat 5"
            : category >= 4
              ? "Cat 4"
              : category >= 3
                ? "Cat 3"
                : category >= 2
                  ? "Cat 2"
                  : category >= 1
                    ? "Cat 1"
                    : category === -1
                      ? "Tropical Storm"
                      : "Tropical Depression",
        isoTime: s.isoTime,
      },
    });
  }

  return { type: "FeatureCollection", features };
}

export async function OPTIONS() {
  return corsPreflightResponse();
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const activeOnly = searchParams.get("active") !== "false";
  const fullTrack = searchParams.get("track") === "full";

  try {
    const resp = await cachedFetch(IBTRACS_URL, CACHE_TTL_HURRICANES, {
      signal: AbortSignal.timeout(30000),
      headers: { "User-Agent": "OpenZenith/1.0" },
    });

    if (!resp.ok) {
      return NextResponse.json(
        { error: `NOAA IBTrACS returned ${resp.status}` },
        { status: 502, headers: CORS_HEADERS },
      );
    }

    const csv = await resp.text();
    let result = parseIbtracs(csv, fullTrack);

    // Filter to active storms only (those with recent ISO_TIME) if requested
    if (activeOnly && !fullTrack) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - 7);
      result = {
        ...result,
        features: result.features.filter((f) => {
          const t = (f.properties as Record<string, unknown>).isoTime as string;
          return t && new Date(t) >= cutoff;
        }),
      };
    }

    return NextResponse.json(result, {
      headers: { ...CORS_HEADERS, "Cache-Control": `public, max-age=${CACHE_TTL_HURRICANES}` },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Hurricane data fetch failed";
    return NextResponse.json({ error: message }, { status: 502, headers: CORS_HEADERS });
  }
}
