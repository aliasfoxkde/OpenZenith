/**
 * Map bootstrap and layer-stack helpers: DEM source, z-order enforcement,
 * label/boundary overlays, 3D terrain, and elevation-pin markers.
 * Extracted verbatim from map/page.tsx.
 */
import type { RefObject } from "react";
import { getBasemap } from "@/lib/basemaps";
import { SURVEILLANCE_THEME as T } from "@/lib/theme";
import { loadBoundariesData } from "./boundaries";
import type { ElevationPin } from "./view-state";

export function addElevationSource(map: maplibregl.Map, _mlgl: MapLibreGL) {
  // Only add if not already present
  if (map.getSource("elevation")) return;

  map.addSource("elevation", {
    type: "raster-dem",
    tiles: ["/api/dem-tile/{z}/{x}/{y}"],
    tileSize: 256,
    demTileSize: 512,
    maxzoom: 10,
    encoding: "terrarium",
  });
}

/** Enforce correct z-order (bottom to top). */
export function reorderMapLayers(map: maplibregl.Map, _layers: Record<string, boolean>): void {
  // Definitive bottom-to-top order.
  // moveLayer(id) without beforeId moves the layer to the top of the stack.
  // By iterating bottom-to-top, each successive moveLayer places the next
  // layer on top, building the correct visual stack.
  const Z_ORDER = [
    // Terrain
    "bathymetry",
    "elevation-color-layer",
    "elevation-accuracy-layer",
    "elevation-accuracy-edges",
    "accuracy-zones-line",
    "accuracy-coastline-line",
    "contours-minor",
    "contours-major",
    // Data layers
    "ocean-currents-lines",
    // Reference
    "equator-line",
    // Labels — always on top
    "labels-raster",
  ];

  for (const id of Z_ORDER) {
    if (map.getLayer(id)) {
      try {
        // maplibregl.Map.moveLayer is not in the public types but exists at runtime
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (map as any).moveLayer(id);
      } catch {
        /* skip */
      }
    }
  }

  // Hillshade — always move to the very top (above all data layers)
  // Must happen after the Z_ORDER loop so it sits above everything moved there,
  // then labels are moved back to the absolute top.
  if (map.getLayer("hillshade-base")) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- maplibregl.Map.moveLayer not in public types
      (map as any).moveLayer("hillshade-base");
    } catch {
      /* skip */
    }
  }
  // Labels — always on absolute top (above hillshade)
  if (map.getLayer("labels-raster")) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- maplibregl.Map.moveLayer not in public types
      (map as any).moveLayer("labels-raster");
    } catch {
      /* skip */
    }
  }
}

/** Add transparent label tiles on top of everything. */
export function addLabelLayer(map: maplibregl.Map, basemapKey: string) {
  if (map.getLayer("labels-raster")) return;
  // Only add labels for basemaps that don't render their own (registry flag)
  const def = getBasemap(basemapKey);
  if (def.hasLabels || !def.labelUrl) return;
  try {
    if (!map.getSource("labels")) {
      map.addSource("labels", { type: "raster", tiles: [def.labelUrl], tileSize: 256 });
    }
    map.addLayer({
      id: "labels-raster",
      type: "raster",
      source: "labels",
      paint: { "raster-opacity": 0.9 },
    });
  } catch {
    /* layer may already exist */
  }
}

export function addBoundaryLayers(map: maplibregl.Map) {
  if (map.getLayer("boundaries-glow")) return;
  void loadBoundariesData().then((data) => {
    if (!data) return;
    try {
      if (!map.getSource("boundaries")) {
        map.addSource("boundaries", { type: "geojson", data });
      }
      if (!map.getLayer("boundaries-glow")) {
        map.addLayer({
          id: "boundaries-glow",
          type: "line",
          source: "boundaries",
          paint: { "line-color": "rgba(0, 229, 255, 0.12)", "line-width": 8, "line-blur": 5 },
        });
      }
      if (!map.getLayer("boundaries-glow-inner")) {
        map.addLayer({
          id: "boundaries-glow-inner",
          type: "line",
          source: "boundaries",
          paint: { "line-color": "rgba(0, 229, 255, 0.4)", "line-width": 2.5, "line-blur": 1.5 },
        });
      }
      if (!map.getLayer("boundaries-core")) {
        map.addLayer({
          id: "boundaries-core",
          type: "line",
          source: "boundaries",
          paint: { "line-color": "#00e5ff", "line-width": 1, "line-opacity": 0.8 },
        });
      }
    } catch {
      /* map may have been removed */
    }
  });
}

export function removeBoundaryLayers(map: maplibregl.Map) {
  ["boundaries-core", "boundaries-glow-inner", "boundaries-glow"].forEach((id) => {
    try {
      map.removeLayer(id);
    } catch {}
  });
  try {
    map.removeSource("boundaries");
  } catch {}
}

export function enable3DTerrain(map: maplibregl.Map) {
  if (!map.getSource("elevation")) return;
  try {
    map.setTerrain({ source: "elevation", exaggeration: 1.5 });
  } catch {}
}

export function disable3DTerrain(map: maplibregl.Map) {
  try {
    map.setTerrain(undefined);
  } catch {}
}

export function addPinMarker(
  map: maplibregl.Map,
  mlgl: MapLibreGL,
  pin: ElevationPin,
  pinsStore: RefObject<maplibregl.Marker[]>,
) {
  const el = document.createElement("div");
  el.style.cssText = `
    display: flex; flex-direction: column; align-items: center; cursor: pointer;
    filter: drop-shadow(0 2px 6px rgba(0,0,0,0.6));
  `;
  el.innerHTML = `
    <div style="
      background: rgba(10,15,26,0.9); color: ${T.green}; padding: 2px 8px; border-radius: 4px;
      font-size: 11px; font-weight: 600; font-family: ${T.fontMono}; white-space: nowrap;
      border: 1px solid ${T.border}; box-shadow: 0 0 8px rgba(34,197,94,0.3);
      letter-spacing: 0.03em;
      text-shadow: 0 0 8px rgba(34,197,94,0.4);
    ">${pin.elevation !== null ? pin.elevation.toLocaleString() + "m" : pin.status === "unavailable" ? "Service unavailable" : "No data"}</div>
    <div style="
      color: #94a3b8; font-size: 9px; font-family: ${T.fontMono}; white-space: nowrap;
      letter-spacing: 0.02em; margin-top: -1px;
    ">${pin.lat.toFixed(4)}, ${pin.lon.toFixed(4)}</div>
    <svg width="12" height="8" viewBox="0 0 12 8"><path d="M6 8L0 0h12z" fill="rgba(10,15,26,0.9)"/></svg>
    <div style="width: 8px; height: 8px; border-radius: 50%; background: ${T.green}; border: 2px solid ${T.bg}; margin-top: -2px; box-shadow: 0 0 6px ${T.green};"></div>
  `;

  const marker = new mlgl.Marker({ element: el, anchor: "bottom" }).setLngLat([pin.lon, pin.lat]).addTo(map);

  pinsStore.current.push(marker);
  // Keep only last 50 markers
  while (pinsStore.current.length > 50) {
    pinsStore.current.shift()?.remove();
  }
}
