"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { waitForMapLibre } from "@/app/landing/maplibre-loader";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function addElevationLayer(map: any, _mlgl: any) {
  map.addSource("elevation", {
    type: "raster-dem",
    tiles: ["/api/dem-tile/{z}/{x}/{y}"],
    tileSize: 256,
    maxzoom: 12,
    encoding: "terrarium",
  });

  // Hillshade — added last so it renders on top of everything
  map.addLayer(
    {
      id: "hillshade",
      type: "hillshade",
      source: "elevation",
      paint: {
        "hillshade-shadow-color": "#000000",
        "hillshade-highlight-color": "#ffffff",
        "hillshade-accent-color": "#333333",
        "hillshade-exaggeration": 0.3,
      },
    },
  );
}

export default function Demo() {
  const mapRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapInstanceRef = useRef<any>(null);
  const [elevation, setElevation] = useState<{
    lat: number;
    lon: number;
    elevation: number | null;
  } | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return;

    let cancelled = false;

    (async () => {
      try {
        const mlgl = await waitForMapLibre();
        if (cancelled || !mapRef.current) return;

        const map = new mlgl.Map({
          container: mapRef.current,
          style: {
            version: 8,
            sources: {
              osm: {
                type: "raster",
                tiles: [
                  "https://a.tile.openstreetmap.org/{z}/{x}/{y}.png",
                  "https://b.tile.openstreetmap.org/{z}/{x}/{y}.png",
                ],
                tileSize: 256,
                attribution: "&copy; OpenStreetMap contributors",
              },
            },
            layers: [{ id: "osm", type: "raster", source: "osm" }],
          },
          center: [86.9, 28.0],
          zoom: 8,
          maxZoom: 15,
        });

        map.on("load", () => {
          if (cancelled) return;
          addElevationLayer(map, mlgl);
          setMapReady(true);
        });

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        map.on("click", async (e: any) => {
          const { lat, lng } = e.lngLat;
          try {
            const res = await fetch(`/api/elevation?lat=${lat.toFixed(4)}&lon=${lng.toFixed(4)}`);
            const data = (await res.json()) as { elevation: number | null };
            setElevation({ lat, lon: lng, elevation: data.elevation });
          } catch {
            setElevation({ lat, lon: lng, elevation: null });
          }
        });

        map.addControl(new mlgl.NavigationControl());
        mapInstanceRef.current = map;
      } catch {
        setLoadError(true);
      }
    })();

    return () => {
      cancelled = true;
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, []);

  return (
    <ErrorBoundary>
      <div style={{ height: "100vh", display: "flex", flexDirection: "column", position: "relative" }}>
        {/* Header bar */}
        <div
          style={{
            padding: "0.7rem 1.5rem",
            background: "#0a0a0a",
            color: "#e5e5e5",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            zIndex: 10,
            flexShrink: 0,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <Link
              href="/"
              style={{
                color: "#e5e5e5",
                textDecoration: "none",
                fontWeight: 700,
                display: "flex",
                alignItems: "center",
                gap: "0.4rem",
              }}
            >
              <svg width="20" height="20" viewBox="0 0 32 32" fill="none">
                <path d="M16 2L28 28H4L16 2Z" fill="#22c55e" opacity="0.9" />
                <path d="M16 2L22 15H10L16 2Z" fill="#22c55e" opacity="0.5" />
                <path d="M4 28L16 18L28 28H4Z" fill="#22c55e" opacity="0.3" />
              </svg>
              OpenZenith
            </Link>
            <span style={{ color: "#333" }}>/</span>
            <span style={{ color: "#888", fontSize: "0.9rem" }}>Elevation Map</span>
          </div>
          <div style={{ display: "flex", gap: "1rem", alignItems: "center" }}>
            <Link href="/" style={{ color: "#888", textDecoration: "none", fontSize: "0.85rem" }}>
              Home
            </Link>
            <a href="/api/docs" style={{ color: "#888", textDecoration: "none", fontSize: "0.85rem" }}>
              Docs
            </a>
            <a
              href="https://github.com/aliasfoxkde/OpenZenith"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                color: "#888",
                textDecoration: "none",
                fontSize: "0.85rem",
                display: "flex",
                alignItems: "center",
                gap: "0.25rem",
              }}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
              </svg>
              GitHub
            </a>
          </div>
          {elevation && (
            <span style={{ marginLeft: "auto", fontFamily: "monospace", fontSize: "0.9rem" }}>
              {elevation.elevation !== null ? `${elevation.elevation.toLocaleString()}m` : "No data"}{" "}
              <span style={{ color: "#888" }}>
                @ {elevation.lat.toFixed(4)}, {elevation.lon.toFixed(4)}
              </span>
            </span>
          )}
        </div>

        {/* Map container */}
        <div ref={mapRef} style={{ flex: 1, minHeight: 0 }} />

        {/* Loading overlay */}
        {!mapReady && !loadError && (
          <div
            style={{
              position: "absolute",
              top: "4rem",
              left: "50%",
              transform: "translateX(-50%)",
              background: "rgba(0,0,0,0.7)",
              color: "#fff",
              padding: "0.5rem 1rem",
              borderRadius: 4,
              fontSize: "0.85rem",
              zIndex: 5,
            }}
          >
            Loading map...
          </div>
        )}

        {/* Error overlay */}
        {loadError && (
          <div
            style={{
              position: "absolute",
              top: "4rem",
              left: "50%",
              transform: "translateX(-50%)",
              background: "rgba(180,0,0,0.8)",
              color: "#fff",
              padding: "0.75rem 1.25rem",
              borderRadius: 6,
              fontSize: "0.85rem",
              zIndex: 5,
              textAlign: "center",
            }}
          >
            Failed to load MapLibre GL. Please refresh the page.
          </div>
        )}

        {/* Click hint */}
        {mapReady && (
          <div
            style={{
              position: "absolute",
              bottom: "2rem",
              left: "50%",
              transform: "translateX(-50%)",
              background: "rgba(0,0,0,0.7)",
              color: "#fff",
              padding: "0.5rem 1rem",
              borderRadius: 4,
              fontSize: "0.85rem",
              pointerEvents: "none",
              zIndex: 5,
            }}
          >
            Click anywhere to query elevation
          </div>
        )}
      </div>
    </ErrorBoundary>
  );
}
