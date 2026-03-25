"use client";

import { useEffect, useRef, useState, useCallback } from "react";

// Convert raw Int16 elevation to terrarium-encoded RGBA for MapLibre
function elevationToTerrarium(data: Int16Array): Uint8Array {
  const pixels = new Uint8Array(data.length * 4);
  for (let i = 0; i < data.length; i++) {
    const elev = data[i];
    const isNodata = elev === -32768;
    // Terrarium: height = (R * 256 + G + B / 256) - 32768
    // So: R = floor((height + 32768) / 256), G = (height + 32768) % 256
    if (isNodata) {
      // Transparent for nodata
      pixels[i * 4] = 0;
      pixels[i * 4 + 1] = 0;
      pixels[i * 4 + 2] = 0;
      pixels[i * 4 + 3] = 0;
    } else {
      const h = elev + 32768;
      pixels[i * 4] = Math.floor(h / 256);
      pixels[i * 4 + 1] = h % 256;
      pixels[i * 4 + 2] = 0;
      pixels[i * 4 + 3] = 255;
    }
  }
  return pixels;
}

export default function Demo() {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);
  const [elevation, setElevation] = useState<{
    lat: number;
    lon: number;
    elevation: number | null;
  } | null>(null);
  const [mapReady, setMapReady] = useState(false);

  // Initialize map
  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return;
    if (typeof window === "undefined") return;

    const mlgl = (window as any).maplibregl;
    if (!mlgl) return;

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
        layers: [
          {
            id: "osm",
            type: "raster",
            source: "osm",
          },
        ],
      },
      center: [86.9, 28.0],
      zoom: 8,
      maxZoom: 15,
    });

    // Add hillshade source and layer once map is loaded
    map.on("load", () => {
      // Add elevation source using our binary tiles
      // MapLibre raster-dem expects terrarium-encoded PNG, so we use
      // a custom approach: fetch .bin tiles and render as canvas images
      addElevationLayer(map, mlgl);
      setMapReady(true);
    });

    // Click to query elevation
    map.on("click", async (e: any) => {
      const { lat, lng } = e.lngLat;
      try {
        const res = await fetch(
          `/api/elevation?lat=${lat.toFixed(4)}&lon=${lng.toFixed(4)}`,
        );
        const data = await res.json();
        setElevation({ lat, lon: lng, elevation: data.elevation });
      } catch {
        setElevation({ lat, lon: lng, elevation: null });
      }
    });

    map.addControl(new mlgl.NavigationControl());

    mapInstanceRef.current = map;

    return () => {
      map.remove();
      mapInstanceRef.current = null;
    };
  }, []);

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", position: "relative" }}>
      {/* Header bar */}
      <div
        style={{
          padding: "0.5rem 1rem",
          background: "#0a0a0a",
          color: "#e5e5e5",
          display: "flex",
          alignItems: "center",
          gap: "0.6rem",
          zIndex: 10,
        }}
      >
        <a href="/" style={{ color: "#e5e5e5", textDecoration: "none", fontWeight: 700, display: "flex", alignItems: "center", gap: "0.4rem" }}>
          <svg width="20" height="20" viewBox="0 0 32 32" fill="none">
            <path d="M16 2L28 28H4L16 2Z" fill="#22c55e" opacity="0.9" />
            <path d="M16 2L22 15H10L16 2Z" fill="#22c55e" opacity="0.5" />
            <path d="M4 28L16 18L28 28H4Z" fill="#22c55e" opacity="0.3" />
          </svg>
          OpenZenith
        </a>
        <span style={{ color: "#333" }}>/</span>
        <span style={{ color: "#888", fontSize: "0.9rem" }}>Elevation Map</span>
        {elevation && (
          <span
            style={{
              marginLeft: "auto",
              fontFamily: "monospace",
              fontSize: "0.9rem",
            }}
          >
            {elevation.elevation !== null
              ? `${elevation.elevation.toLocaleString()}m`
              : "No data"}{" "}
            <span style={{ color: "#888" }}>
              @ {elevation.lat.toFixed(4)}, {elevation.lon.toFixed(4)}
            </span>
          </span>
        )}
      </div>

      {/* Map container */}
      <div ref={mapRef} style={{ flex: 1 }} />

      {/* Loading overlay */}
      {!mapReady && (
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
          }}
        >
          Loading map...
        </div>
      )}

      {/* Click hint */}
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
        }}
      >
        Click anywhere to query elevation
      </div>
    </div>
  );
}

/**
 * Add elevation visualization layer to the map.
 * Fetches our .bin tiles, converts to terrarium-encoded canvas images,
 * and adds a raster-dem source for hillshade rendering.
 */
function addElevationLayer(map: any, mlgl: any) {
  // Create a custom tile source that converts .bin to terrarium PNG
  const elevationSource: any = {
    type: "raster-dem",
    tileSize: 256,
    maxzoom: 12,
    minzoom: 0,
    encoding: "terrarium",
    tiles: [], // We'll use a different approach
  };

  // Since we can't easily convert .bin to terrarium PNG client-side in
  // a raster-dem source, we use a canvas-based approach with a custom
  // source type. For simplicity, we add hillshade via direct tile rendering.

  // Approach: use addProtocol to register a custom tile protocol
  mlgl.addProtocol("elevation", async (params: any, callback: any) => {
    const { z, x, y } = params;
    try {
      const res = await fetch(`/api/tile/${z}/${x}/${y}`);
      if (!res.ok) {
        callback(null, null, null);
        return { cancel: () => {} };
      }
      const buffer = await res.arrayBuffer();
      const int16 = new Int16Array(buffer);
      const terrarium = elevationToTerrarium(int16);

      // Encode as PNG
      const canvas = document.createElement("canvas");
      canvas.width = 256;
      canvas.height = 256;
      const ctx = canvas.getContext("2d")!;
      const imageData = ctx.createImageData(256, 256);
      imageData.data.set(terrarium);
      ctx.putImageData(imageData, 0, 0);

      canvas.toBlob(
        (blob: Blob | null) => {
          if (blob) {
            callback(null, blob, null, null);
          } else {
            callback(new Error("Failed to create PNG"));
          }
        },
        "image/png",
      );

      return { cancel: () => {} };
    } catch (err) {
      callback(err);
      return { cancel: () => {} };
    }
  });

  // Add the elevation source using our custom protocol
  map.addSource("elevation", {
    type: "raster-dem",
    tiles: ["elevation://{z}/{x}/{y}"],
    tileSize: 256,
    maxzoom: 12,
    encoding: "terrarium",
  });

  // Add hillshade layer
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
        "hillshade-direction": 315,
        "hillshade-illumination-anchor": "corner",
      },
    },
    "osm",
  );
}
