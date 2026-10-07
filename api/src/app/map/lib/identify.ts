/**
 * Feature identify for the 2D map: resolve a click against the queryable
 * data layers and format the hit's canonical fields.
 *
 * Feature properties come straight from third-party feeds (USGS, OpenSky,
 * AIS, NWS, EONET, Overpass, …) and are untyped at the MapLibre boundary, so
 * every read here goes through a `typeof` guard — a missing or oddly-typed
 * field drops its row instead of rendering "undefined". Formatting is pure:
 * `identifyAt` takes a map-like object, so unit tests drive it with a stub.
 */

/** One label/value line in an identify popup. */
export type IdentifyRow = [label: string, value: string];

/** What the click handler needs to render one identify popup. */
export interface IdentifyResult {
  /** Layer-registry id the hit belongs to (drives export/legend parity). */
  registryId: string;
  /** Human layer title, shown as the popup heading. */
  title: string;
  /** Formatted rows, in display order; missing fields are already dropped. */
  rows: IdentifyRow[];
  /** Where to anchor the popup — the clicked position, not the feature. */
  lngLat: [number, number];
}

/**
 * The members of a queried feature the row builders read. Properties are
 * widened to `unknown` here: MapLibre types them `any`, and the guards below
 * are the real check.
 */
export interface IdentifyFeature {
  properties: Record<string, unknown>;
  geometry: GeoJSON.Geometry | null;
}

/** Per-layer identify metadata: registry id, display title, row builder. */
interface IdentifyMeta {
  registryId: string;
  title: string;
  rows(feature: IdentifyFeature): IdentifyRow[];
}

/* ─── Value guards ─── */

/** Trimmed string for present non-empty strings and finite numbers, else null. */
function text(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

/** The value when it is a finite number, else null. */
function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Fixed-precision decimal, or null when the value is not a finite number. */
function fixed(value: unknown, digits = 1): string | null {
  const n = finite(value);
  return n === null ? null : n.toFixed(digits);
}

/** Truncate a long string on an ellipsis, leaving short strings untouched. */
function clip(value: unknown, max: number): string | null {
  const s = text(value);
  if (s === null || s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

/** metres → "n m"; also parses the string tags Overpass returns for height. */
function metres(value: unknown): string | null {
  const n = finite(value) ?? (typeof value === "string" ? finiteOrNull(value) : null);
  return n === null ? null : `${Math.round(n)} m`;
}

/** Parse a numeric string without handing `Number("")`-style NaNs through. */
function finiteOrNull(raw: string): number | null {
  const n = Number(raw.trim());
  return Number.isFinite(n) && raw.trim() !== "" ? n : null;
}

/** m/s → km/h, the unit the flights feed actually reports. */
function kmh(value: unknown): string | null {
  const n = finite(value);
  return n === null ? null : `${(n * 3.6).toFixed(1)} km/h`;
}

/** Knots, as reported by ADS-B ground speed and AIS Speed. */
function knots(value: unknown): string | null {
  const n = finite(value);
  return n === null ? null : `${Math.round(n)} kn`;
}

/** Kilometres, as reported by satellite altitude. */
function km(value: unknown): string | null {
  const n = finite(value);
  return n === null ? null : `${Math.round(n)} km`;
}

/** Millibars/hectopascals — the storm-pressure unit in the hurricane feed. */
function mb(value: unknown): string | null {
  const n = finite(value);
  return n === null ? null : `${Math.round(n)} mb`;
}

/** Kelvin, one decimal — the FIRMS brightness band value. */
function kelvin(value: unknown): string | null {
  const k = fixed(value);
  return k === null ? null : `${k} K`;
}

/** Megawatts, one decimal — the FIRMS fire radiative power value. */
function megawatts(value: unknown): string | null {
  const w = fixed(value);
  return w === null ? null : `${w} MW`;
}

/** Moment magnitude with the M prefix USGS reports it under. */
function magnitude(value: unknown): string | null {
  const m = fixed(value);
  return m === null ? null : `M${m}`;
}

/** Booleans render as words; anything else is absent rather than "false". */
function yesNo(value: unknown): string | null {
  if (typeof value !== "boolean") return null;
  return value ? "yes" : "no";
}

/** FIRMS day/night flag, normalised to a word when it is a D/N value. */
function dayNight(value: unknown): string | null {
  const s = text(value);
  if (s === null) return null;
  const first = s.charAt(0).toUpperCase();
  if (first === "D") return "Day";
  if (first === "N") return "Night";
  return s;
}

/**
 * First `title` of an EONET categories array, tolerating the un-flattened
 * shape the identify layer still sees if a cached payload predates the
 * source-side `category` normalisation.
 */
function eonetCategory(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  const first: unknown = value[0];
  if (!first || typeof first !== "object") return null;
  return text((first as { title?: unknown }).title);
}

/** Epoch ms or ISO string → ms, else null (feeds disagree on the type). */
function epochMs(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const ms = Date.parse(value);
    return Number.isNaN(ms) ? null : ms;
  }
  return null;
}

/** Coarse human span for the relative half of a timestamp. */
function relativeSpan(seconds: number): [value: number, unit: string] {
  const abs = Math.abs(seconds);
  if (abs < 60) return [abs, "s"];
  if (abs < 3600) return [Math.round(abs / 60), "min"];
  if (abs < 86400) return [Math.round(abs / 3600), "h"];
  return [Math.round(abs / 86400), "d"];
}

/** "4h ago · 2026-10-07 14:02Z" — relative for scanning, absolute for records. */
function formatEpoch(value: unknown): string | null {
  const ms = epochMs(value);
  if (ms === null) return null;
  const seconds = Math.round((Date.now() - ms) / 1000);
  const [span, unit] = relativeSpan(seconds);
  const relative = `${span}${unit} ${seconds < 0 ? "from now" : "ago"}`;
  const absolute = new Date(ms).toISOString().replace("T", " ").slice(0, 16);
  return `${relative} · ${absolute}Z`;
}

/** Third dimension of a Point geometry — the USGS depth, in km. */
function pointDepth(geometry: GeoJSON.Geometry | null): string | null {
  if (!geometry || geometry.type !== "Point") return null;
  const depth = fixed((geometry.coordinates as number[])[2]);
  return depth === null ? null : `${depth} km`;
}

/** Drop the rows whose value came back absent. */
function compact(rows: Array<[label: string, value: string | null]>): IdentifyRow[] {
  const kept: IdentifyRow[] = [];
  for (const row of rows) {
    if (row[1] !== null) kept.push([row[0], row[1]]);
  }
  return kept;
}

/* ─── Layer table ─── */

/**
 * Queryable MapLibre layer id → identify metadata. Glow, heatmap and label
 * layers deliberately share a source with one of these, so only the ids in
 * this table are queried — identifying a glow duplicate would just repeat the
 * same record twice.
 */
export const IDENTIFY_LAYERS: Record<string, IdentifyMeta> = {
  "earthquakes-circles": {
    registryId: "earthquakes",
    title: "Earthquakes",
    rows: (f) =>
      compact([
        ["Magnitude", magnitude(f.properties.mag)],
        ["Place", text(f.properties.place)],
        ["Depth", pointDepth(f.geometry)],
        ["Time", formatEpoch(f.properties.time)],
      ]),
  },
  "warnings-fill": {
    registryId: "warnings",
    title: "Weather Warnings",
    rows: (f) =>
      compact([
        ["Event", text(f.properties.event)],
        ["Severity", text(f.properties.severity)],
        ["Urgency", text(f.properties.urgency)],
        ["Headline", clip(f.properties.headline, 120)],
        ["Area", clip(f.properties.areaDesc, 140)],
        ["Expires", formatEpoch(f.properties.expires)],
      ]),
  },
  "waterways-line": {
    registryId: "waterways",
    title: "Waterways",
    rows: (f) =>
      compact([
        ["Name", text(f.properties.name)],
        ["Waterway", text(f.properties.waterway)],
        ["Natural", text(f.properties.natural)],
      ]),
  },
  "wildfires-circles": {
    registryId: "wildfires",
    title: "Wildfires",
    rows: (f) =>
      compact([
        ["Brightness", kelvin(f.properties.brightness)],
        ["Fire radiative power", megawatts(f.properties.frp)],
        ["Confidence", text(f.properties.confidence)],
        ["Day/Night", dayNight(f.properties.daynight)],
        ["Satellite", text(f.properties.satellite)],
      ]),
  },
  "flights-circles": {
    registryId: "flights",
    title: "Flights (ADS-B)",
    rows: (f) =>
      compact([
        ["Callsign", text(f.properties.callsign)],
        ["ICAO24", text(f.properties.icao24)],
        ["Origin", text(f.properties.origin_country)],
        ["Ground speed", kmh(f.properties.velocity)],
        ["Baro altitude", metres(f.properties.baro_altitude)],
        ["On ground", yesNo(f.properties.on_ground)],
      ]),
  },
  "vessels-points": {
    registryId: "vessels",
    title: "Vessels (AIS)",
    rows: (f) =>
      compact([
        ["Name", text(f.properties.name)],
        ["MMSI", text(f.properties.mmsi)],
        ["Ship type", text(f.properties.shipType)],
        ["Speed", knots(f.properties.speed)],
        ["Destination", clip(f.properties.destination, 80)],
      ]),
  },
  "satellites-points": {
    registryId: "satellites",
    title: "Satellites",
    rows: (f) =>
      compact([
        ["Name", text(f.properties.name)],
        ["Altitude", km(f.properties.altitude)],
        ["Notable", yesNo(f.properties.notable)],
      ]),
  },
  "military-points": {
    registryId: "militaryFlights",
    title: "Military ADS-B",
    rows: (f) =>
      compact([
        ["Callsign", text(f.properties.callsign)],
        ["Type", text(f.properties.type)],
        ["Altitude", metres(f.properties.alt)],
        ["Ground speed", knots(f.properties.speed)],
      ]),
  },
  "hurricanes-points": {
    registryId: "hurricaneTracks",
    title: "Hurricane Tracks",
    rows: (f) =>
      compact([
        ["Storm", text(f.properties.name)],
        ["Category", text(f.properties.categoryLabel) ?? text(f.properties.category)],
        ["Max sustained wind", knots(f.properties.wind)],
        ["Pressure", mb(f.properties.pressure)],
        ["Fix time", text(f.properties.isoTime)],
      ]),
  },
  "buildings-fill": {
    registryId: "buildings",
    title: "Building Footprints",
    rows: (f) =>
      compact([
        ["Name", text(f.properties.name) ?? text(f.properties.id)],
        ["Building", text(f.properties.building)],
        ["Height", metres(f.properties.height)],
        ["Levels", text(f.properties.levels)],
      ]),
  },
  "natural-events-points": {
    registryId: "events",
    title: "Natural Events",
    rows: (f) =>
      compact([
        ["Event", text(f.properties.title)],
        [
          "Category",
          text(f.properties.categoryLabel) ??
            text(f.properties.category) ??
            eonetCategory(f.properties.categories),
        ],
        ["Date", formatEpoch(f.properties.date)],
      ]),
  },
  "volcanoes-points": {
    registryId: "volcanoes",
    title: "Volcano Alerts",
    rows: (f) =>
      compact([
        ["Volcano", text(f.properties.name)],
        ["Alert", text(f.properties.alertLevel) ?? text(f.properties.alert)],
        ["Observatory", text(f.properties.observatory)],
        ["Synopsis", clip(f.properties.synopsis, 160)],
      ]),
  },
  "nlnog-circles": {
    registryId: "nlnogNodes",
    title: "NLNOG Nodes",
    rows: (f) =>
      compact([
        ["Hostname", text(f.properties.hostname)],
        ["City", text(f.properties.city)],
        ["Country", text(f.properties.country)],
        ["ASN", text(f.properties.asn)],
      ]),
  },
  "air-quality-circle": {
    registryId: "airQuality",
    title: "Air Quality",
    rows: (f) =>
      compact([
        ["US AQI", text(f.properties.us_aqi)],
        ["AQI level", text(f.properties.aqi_level)],
      ]),
  },
};

/* ─── Hit resolution ─── */

/** The same table as a Map, so an unknown layer id reads as `undefined`. */
const META_BY_LAYER = new Map(Object.entries(IDENTIFY_LAYERS));

/** The MapLibre layer a queried feature was rendered by, when present. */
function hitLayerId(feature: GeoJSON.Feature): string | null {
  const layer: unknown = (feature as { layer?: unknown }).layer;
  if (!layer || typeof layer !== "object") return null;
  const id: unknown = (layer as { id?: unknown }).id;
  return typeof id === "string" ? id : null;
}

/** Narrow a queried feature down to the members the row builders read. */
function toIdentifyFeature(feature: GeoJSON.Feature): IdentifyFeature {
  // GeoJSON types properties as `any`; the cast restores a known index
  // signature while keeping the runtime-absent case, and every read
  // downstream is guarded anyway.
  const props = feature.properties as Record<string, unknown> | null;
  return {
    properties: props ?? {},
    geometry: feature.geometry,
  };
}

/**
 * Identify the topmost rendered data-layer feature at a screen point.
 *
 * Only the layers in {@link IDENTIFY_LAYERS} are queried. Hits are deduped by
 * registry id keeping the first occurrence, and the first entry — MapLibre
 * returns features front-to-back, so that is the topmost hit — is the popup
 * that gets shown; overlapping layers of different registry ids do not stack
 * popups. Returns null when nothing queryable is under the point, so the
 * click handler can fall through to the elevation probe.
 */
export function identifyAt(
  map: Pick<maplibregl.Map, "queryRenderedFeatures" | "unproject">,
  point: { x: number; y: number },
): IdentifyResult | null {
  let hits: GeoJSON.Feature[];
  try {
    hits = map.queryRenderedFeatures(point, { layers: Object.keys(IDENTIFY_LAYERS) });
  } catch {
    // A style mid-swap can make the query throw; that is "nothing to identify".
    return null;
  }

  const byRegistry = new Map<string, { meta: IdentifyMeta; feature: IdentifyFeature }>();
  for (const hit of hits) {
    // A miss means the feature came from a layer outside the table.
    const meta = META_BY_LAYER.get(hitLayerId(hit) ?? "");
    if (!meta || byRegistry.has(meta.registryId)) continue;
    byRegistry.set(meta.registryId, { meta, feature: toIdentifyFeature(hit) });
  }

  const top = byRegistry.values().next();
  if (top.done) return null;

  const lngLat = map.unproject([point.x, point.y]);
  return {
    registryId: top.value.meta.registryId,
    title: top.value.meta.title,
    rows: top.value.meta.rows(top.value.feature),
    lngLat: [lngLat.lng, lngLat.lat],
  };
}
