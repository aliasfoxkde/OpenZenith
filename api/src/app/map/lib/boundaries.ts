/**
 * Country-boundary overlay data: lazy topojson-client + world-atlas loaders
 * with module-level caches. Extracted from map/page.tsx.
 */

const BOUNDARIES_URL = "https://unpkg.com/world-atlas@2.0.2/countries-110m.json";

/** world-atlas TopoJSON topology — only the object this app converts. */
type WorldAtlas = { objects: { countries: unknown } };

let topojsonLib: TopoJSONClient | null = null;
let boundariesGeoJSON: GeoJSON.FeatureCollection | null = null;

async function loadTopojsonLib(): Promise<TopoJSONClient> {
  if (topojsonLib) return topojsonLib;
  if (window.topojson) return (topojsonLib = window.topojson);
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://unpkg.com/topojson-client@3/dist/topojson-client.min.js";
    s.onload = () => {
      topojsonLib = window.topojson ?? null;
      if (topojsonLib) resolve(topojsonLib);
      else reject(new Error("topojson-client failed to load"));
    };
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

/**
 * Country-boundary polygons for the map's boundary overlay, as a GeoJSON
 * FeatureCollection of Natural Earth 110m countries. Fetches the world-atlas
 * TopoJSON from unpkg, converts it with topojson-client (injected via a
 * `<script>` tag if `window.topojson` is absent), and caches the converted
 * result in module state so later calls return the same object without a
 * second network round-trip. Resolves `null` when the fetch or conversion
 * fails — callers must treat that as "no boundaries", not an error.
 */
export async function loadBoundariesData(): Promise<GeoJSON.FeatureCollection | null> {
  if (boundariesGeoJSON) return boundariesGeoJSON;
  try {
    const topo = await loadTopojsonLib();
    const res = await fetch(BOUNDARIES_URL);
    if (!res.ok) return null;
    const world = (await res.json()) as WorldAtlas;
    boundariesGeoJSON = topo.feature(world, world.objects.countries);
    return boundariesGeoJSON;
  } catch {
    return null;
  }
}
