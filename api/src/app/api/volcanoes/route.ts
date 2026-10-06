import { NextResponse } from "next/server";
import { cachedFetch, CACHE_TTL } from "@/lib/cache";
import { CORS_HEADERS, corsPreflightResponse } from "@/lib/cors";

export const runtime = "edge";

export function OPTIONS() {
  return corsPreflightResponse();
}

/** One HANS elevated-volcano record (getElevatedVolcanoes / getCapElevated shape). */
interface ElevatedVolcano {
  volcano_name?: string;
  vnum?: string;
  latitude?: number;
  longitude?: number;
  alert_level?: string;
  color_code?: string;
  synopsis?: string;
  obs_fullname?: string;
  notice_url?: string;
  sent_utc?: string;
  [key: string]: unknown;
}

/** Subset of `/hans-public/api/volcano/getVolcano/{vnum}` used for coord backfill. */
interface VolcanoMeta {
  latitude?: number;
  longitude?: number;
  [key: string]: unknown;
}

const HANS = "https://volcanoes.usgs.gov/hans-public/api/volcano";
/** Bound the per-request coordinate backfill so a large advisory list can't fan out. */
const MAX_COORD_LOOKUPS = 8;

/** GVP-consistent colour scale: WARNING red, WATCH orange, ADVISORY amber. */
function alertColor(level: string): string {
  if (level === "WARNING") return "#ef4444";
  if (level === "WATCH") return "#f97316";
  return "#fbbf24";
}

/**
 * Volcanoes endpoint — current USGS volcano alert statuses as a GeoJSON
 * FeatureCollection. Originally this proxied the Smithsonian GVP weekly RSS,
 * but volcano.si.edu sits behind a JavaScript bot-verification challenge
 * ("Smithsonian request verification") that server-side fetches can never
 * pass — every edge request got 403 challenge HTML — and the browser-direct
 * fetch the layer used before that was CORS-blocked. The authoritative,
 * bot-friendly equivalent is the USGS HANS API: `getCapElevated` (ORANGE/
 * WATCH and above, with coordinates) joined with `getElevatedVolcanoes` (all
 * elevated volcanoes, no coordinates — those are backfilled per-vnum from
 * `getVolcano/{vnum}`, bounded at MAX_COORD_LOOKUPS). An unavailable upstream
 * becomes a silent 200 empty FeatureCollection (codebase convention); the
 * `x-volcano-status` header distinguishes that from a genuinely quiet week.
 */
export async function GET() {
  const empty = (status: string) =>
    new NextResponse(JSON.stringify({ type: "FeatureCollection", features: [] }), {
      status: 200,
      headers: {
        ...CORS_HEADERS,
        "Content-Type": "application/geo+json; charset=utf-8",
        "x-volcano-status": status,
      },
    });

  try {
    const [capRes, elevatedRes] = await Promise.all([
      cachedFetch(`${HANS}/getCapElevated`, CACHE_TTL.VOLCANOES, { signal: AbortSignal.timeout(12000) }),
      cachedFetch(`${HANS}/getElevatedVolcanoes`, CACHE_TTL.VOLCANOES, { signal: AbortSignal.timeout(12000) }),
    ]);
    if (!capRes.ok || !elevatedRes.ok) return empty("upstream-unavailable");

    const cap = (await capRes.json()) as ElevatedVolcano[];
    const elevated = (await elevatedRes.json()) as ElevatedVolcano[];
    if (!Array.isArray(cap) || !Array.isArray(elevated)) return empty("upstream-malformed");

    // CAP entries carry coordinates; dedupe by vnum so the per-vnum list is
    // exactly the advisory-level volcanoes still needing a lookup.
    const byVnum = new Map<string, ElevatedVolcano>();
    for (const v of [...cap, ...elevated]) {
      if (typeof v.vnum === "string" && !byVnum.has(v.vnum)) byVnum.set(v.vnum, v);
    }

    const missing = [...byVnum.values()].filter(
      (v) => typeof v.latitude !== "number" || typeof v.longitude !== "number",
    );
    for (const v of missing.slice(0, MAX_COORD_LOOKUPS)) {
      if (typeof v.vnum !== "string") continue;
      try {
        const metaRes = await cachedFetch(`${HANS}/getVolcano/${v.vnum}`, CACHE_TTL.VOLCANOES, {
          signal: AbortSignal.timeout(12000),
        });
        if (!metaRes.ok) continue;
        const meta = (await metaRes.json()) as VolcanoMeta;
        if (typeof meta.latitude === "number" && typeof meta.longitude === "number") {
          v.latitude = meta.latitude;
          v.longitude = meta.longitude;
        }
      } catch {
        // One failed lookup drops that volcano, not the feed.
      }
    }

    const features = [...byVnum.values()]
      .filter((v) => typeof v.latitude === "number" && typeof v.longitude === "number" && v.volcano_name)
      .map((v) => {
        const alert = v.alert_level === "WARNING" || v.alert_level === "WATCH" ? v.alert_level : "ADVISORY";
        return {
          type: "Feature" as const,
          geometry: { type: "Point" as const, coordinates: [v.longitude, v.latitude] },
          properties: {
            name: v.volcano_name,
            title: v.volcano_name,
            alert,
            alertLevel: alert,
            color: alertColor(alert),
            synopsis: v.synopsis ?? null,
            observatory: v.obs_fullname ?? null,
            noticeUrl: v.notice_url ?? null,
            updated: v.sent_utc ?? null,
            vnum: v.vnum ?? null,
          },
        };
      });

    return new NextResponse(JSON.stringify({ type: "FeatureCollection", features }), {
      status: 200,
      headers: {
        ...CORS_HEADERS,
        "Content-Type": "application/geo+json; charset=utf-8",
        "Cache-Control": "public, max-age=3600",
        "x-volcano-status": "ok",
      },
    });
  } catch {
    return empty("upstream-unavailable");
  }
}
