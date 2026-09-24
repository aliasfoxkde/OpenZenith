/**
 * Country-boundary overlay data: lazy topojson-client + world-atlas loaders
 * with module-level caches. Extracted from map/page.tsx.
 */

const BOUNDARIES_URL = "https://unpkg.com/world-atlas@2.0.2/countries-110m.json";

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

export async function loadBoundariesData(): Promise<GeoJSON.FeatureCollection | null> {
  if (boundariesGeoJSON) return boundariesGeoJSON;
  try {
    const topo = await loadTopojsonLib();
    const res = await fetch(BOUNDARIES_URL);
    if (!res.ok) return null;
    const world = await res.json();
    boundariesGeoJSON = topo.feature(world, world.objects.countries);
    return boundariesGeoJSON;
  } catch {
    return null;
  }
}
