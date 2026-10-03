"use client";

import { useEffect, useRef, useState } from "react";
import { BASEMAPS } from "@/lib/basemaps";
import { waitForMapLibre } from "./maplibre-loader";
import { isDarkNow } from "./useTheme";
import { addOrUpdatePin, flyToWithPadding } from "./map-helpers";

export interface FlyTarget {
  lat: number;
  lon: number;
}

/**
 * The landing page's non-interactive hero map: raster basemap + boundary glow
 * + elevation-accuracy overlay. Owns the full map lifecycle (init-once, theme
 * swaps, fly-to) so page.tsx only has to raise a flyTarget.
 */
export function HeroMap({ dark, flyTarget }: { dark: boolean; flyTarget: FlyTarget | null }) {
  const mapDivRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const pendingFlyRef = useRef<FlyTarget | null>(null);
  const [loading, setLoading] = useState(true);

  // Init hero map once on mount — deferred to browser-idle. The hero map is
  // decorative (non-interactive); starting the ~250 KB MapLibre download and
  // map construction after first paint keeps hydration and the headline from
  // competing with it, without delaying anything the visitor can act on. The
  // initial basemap is resolved from the theme store (initTheme() has already
  // restored localStorage by effect ordering) rather than the `dark` prop: a
  // light-preference visitor never triggers a `dark` change, so waiting for
  // one would leave the map permanently uninitialized.
  useEffect(() => {
    if (!mapDivRef.current || mapRef.current) return;
    let cancelled = false;
    // Browser-idle scheduling with a setTimeout fallback (Safari < 17 has no
    // requestIdleCallback). Both cancel paths run: cancelIdleCallback is a
    // no-op on a timeout handle and vice versa, whichever one owns the id.
    const schedule: (cb: () => void) => number =
      typeof window.requestIdleCallback === "function"
        ? (cb) => window.requestIdleCallback(cb)
        : (cb) => window.setTimeout(cb, 200);
    const cancel = (id: number) => {
      if (typeof window.cancelIdleCallback === "function") window.cancelIdleCallback(id);
      window.clearTimeout(id);
    };
    const initMap = async () => {
      try {
        const mlgl = await waitForMapLibre();
        if (cancelled || !mapDivRef.current) return;

        const darkAtInit = isDarkNow();
        const basemapDef = darkAtInit ? BASEMAPS.dark : BASEMAPS.voyager;

        // mlgl is the untyped CDN namespace; the local annotation gives every
        // lifecycle call below the hand-rolled global.d.ts types.
        const map: maplibregl.Map = new mlgl.Map({
          container: mapDivRef.current,
          style: {
            version: 8,
            sources: {
              osm: {
                type: "raster",
                tiles: [basemapDef.url],
                tileSize: 256,
                attribution: basemapDef.attribution,
                maxzoom: basemapDef.maxzoom,
              },
            },
            layers: [{ id: "osm", type: "raster", source: "osm" }],
            glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
          },
          center: [0, 25],
          zoom: 1.5,
          interactive: false,
          attributionControl: false,
        });

        map.on("load", () => {
          if (cancelled) return;
          // The basemap alone is the first paint. Boundaries and the
          // elevation-accuracy overlay are decoration — attach them once the
          // map has drained its initial work instead of racing the basemap
          // tiles for bandwidth during first render.
          setLoading(false);
          map.once("idle", () => {
            if (cancelled) return;

            // Admin boundary glow layers
            try {
              map.addSource("boundaries", {
                type: "vector",
                tiles: ["https://tiles.openfreemap.org/planet/{z}/{x}/{y}.pbf"],
                maxzoom: 6,
              });
              const boundaryColor = darkAtInit ? "0, 229, 255" : "0, 80, 180";
              map.addLayer(
                {
                  id: "boundary-glow",
                  type: "line",
                  source: "boundaries",
                  "source-layer": "boundary",
                  paint: {
                    "line-color": `rgba(${boundaryColor}, 0.12)`,
                    "line-width": ["interpolate", ["linear"], ["zoom"], 1, 1, 3, 2, 6, 3],
                    "line-blur": 2,
                  },
                },
                "osm",
              );
              map.addLayer(
                {
                  id: "boundary-line",
                  type: "line",
                  source: "boundaries",
                  "source-layer": "boundary",
                  paint: {
                    "line-color": `rgba(${boundaryColor}, 0.25)`,
                    "line-width": ["interpolate", ["linear"], ["zoom"], 1, 0.5, 3, 0.8, 6, 1],
                    "line-opacity": 0.6,
                  },
                },
                "boundary-glow",
              );
            } catch {
              // Boundary tiles unavailable — continue without
            }

            // Elevation accuracy overlay (shows data resolution)
            try {
              map.addSource("elevation-accuracy", {
                type: "raster",
                tiles: ["/api/elevation-accuracy/{z}/{x}/{y}"],
                tileSize: 256,
                maxzoom: 5,
              });
              map.addLayer(
                {
                  id: "elevation-accuracy",
                  type: "raster",
                  source: "elevation-accuracy",
                  paint: {
                    "raster-opacity": 0.4,
                    "raster-fade-duration": 300,
                  },
                },
                "osm",
              );
            } catch {
              // Accuracy layer unavailable
            }
          });
        });

        mapRef.current = map;

        // If a target arrived before the map loaded, fly now
        if (pendingFlyRef.current) {
          const pending = pendingFlyRef.current;
          pendingFlyRef.current = null;
          setTimeout(() => {
            flyToWithPadding(map, pending.lon, pending.lat, 8);
            addOrUpdatePin(map, pending.lon, pending.lat);
          }, 500);
        }
      } catch {
        setLoading(false);
      }
    };
    const idleId = schedule(() => {
      if (!cancelled) void initMap();
    });
    return () => {
      cancelled = true;
      cancel(idleId);
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []); // init once; theme flips are handled by the setTiles effect below

  // Update basemap + boundary colors when the theme changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    try {
      const source = map.getSource("osm");
      if (source && source.setTiles) {
        const url = dark ? BASEMAPS.dark.url : BASEMAPS.voyager.url;
        // initTheme() notify can fire this right after init with no actual
        // flip — skip the refetch when the basemap already matches
        if (source.tiles?.[0] !== url) {
          source.setTiles([url]);
        }
      }
      // Update boundary colors
      const bc = dark ? "0, 229, 255" : "0, 80, 180";
      if (map.getLayer("boundary-glow")) {
        map.setPaintProperty("boundary-glow", "line-color", `rgba(${bc}, 0.12)`);
      }
      if (map.getLayer("boundary-line")) {
        map.setPaintProperty("boundary-line", "line-color", `rgba(${bc}, 0.25)`);
      }
    } catch {
      // Map not ready or source unavailable
    }
  }, [dark]);

  // Fly to the requested target — immediately once loaded, otherwise buffer
  // it for the init effect (which waits 500ms post-load for tile settles).
  useEffect(() => {
    if (!flyTarget) return;
    const map = mapRef.current;
    if (!map) {
      pendingFlyRef.current = flyTarget;
      return;
    }
    flyToWithPadding(map, flyTarget.lon, flyTarget.lat, 8);
    addOrUpdatePin(map, flyTarget.lon, flyTarget.lat);
  }, [flyTarget]);

  return (
    <>
      <div
        id="hero-map"
        ref={mapDivRef}
        className="oz-hero-map"
        style={{
          position: "absolute",
          inset: 0,
          // No CSS filter here: dark mode uses the Esri World Dark Gray
          // basemap, which is already dark — a per-frame brightness/contrast/
          // saturate filter over a full-bleed canvas is pure GPU cost, and
          // the overlay gradient below owns text contrast.
        }}
      />
      {/* Subtle overlay — lets map texture show through */}
      <div
        className="oz-hero-overlay"
        style={{
          position: "absolute",
          inset: 0,
          background: dark
            ? "linear-gradient(180deg, rgba(10,10,10,0.72) 0%, rgba(10,10,10,0.22) 40%, rgba(10,10,10,0.62) 100%)"
            : "linear-gradient(180deg, rgba(255,255,255,0.80) 0%, rgba(255,255,255,0.40) 40%, rgba(255,255,255,0.80) 100%)",
          pointerEvents: "none",
          zIndex: 2,
        }}
      />
      {loading && (
        <div
          id="hero-loading"
          className="oz-hero-loading"
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            transform: "translate(-50%,-50%)",
            // Opaque: a translucent backdrop made the effective contrast
            // depend on whatever was behind it (axe caught #22c55e over the
            // light hero overlay in Firefox mid-load). #22c55e on #0a0a0a
            // is ~8.7:1 — AAA — regardless of theme or load state.
            background: "#0a0a0a",
            color: "#22c55e",
            padding: "0.5rem 1rem",
            borderRadius: 6,
            fontSize: "0.85rem",
            zIndex: 4,
          }}
        >
          Loading elevation map...
        </div>
      )}
    </>
  );
}
