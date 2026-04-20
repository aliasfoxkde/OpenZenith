import type { LayerHandle } from "./types";

/* ─── Ocean Currents — Animated Flow ─── */

/** Major ocean current definitions (simplified flow paths) */
const OCEAN_CURRENTS = [
  // Gulf Stream (NW Atlantic)
  {
    name: "Gulf Stream",
    color: "#ff4444",
    width: 2.5,
    path: [
      [-80, 25], [-78, 30], [-75, 35], [-70, 38], [-65, 40],
      [-55, 42], [-45, 45], [-35, 50], [-20, 55],
    ],
  },
  // North Atlantic Drift
  {
    name: "N. Atlantic Drift",
    color: "#ff6666",
    width: 2,
    path: [
      [-20, 55], [-15, 58], [-10, 60], [-5, 62], [0, 63], [5, 64], [10, 65],
    ],
  },
  // Canary Current
  {
    name: "Canary Current",
    color: "#4488ff",
    width: 1.5,
    path: [
      [-15, 45], [-18, 40], [-20, 35], [-20, 28], [-18, 22], [-16, 15],
    ],
  },
  // North Equatorial Current (Atlantic)
  {
    name: "N. Equatorial (Atl)",
    color: "#4488ff",
    width: 1.5,
    path: [
      [-20, 15], [-30, 14], [-40, 13], [-50, 12], [-60, 11], [-70, 10],
    ],
  },
  // Caribbean Current
  {
    name: "Caribbean Current",
    color: "#44aaff",
    width: 1.5,
    path: [
      [-80, 10], [-78, 12], [-75, 14], [-72, 16], [-68, 18],
    ],
  },
  // South Equatorial Current (Atlantic)
  {
    name: "S. Equatorial (Atl)",
    color: "#4488ff",
    width: 1.5,
    path: [
      [-5, 0], [-10, -3], [-18, -5], [-25, -7], [-32, -8],
    ],
  },
  // Brazil Current
  {
    name: "Brazil Current",
    color: "#ff4444",
    width: 1.5,
    path: [
      [-35, -5], [-38, -10], [-42, -15], [-47, -20], [-50, -25], [-53, -30], [-55, -35],
    ],
  },
  // Kuroshio Current
  {
    name: "Kuroshio",
    color: "#ff4444",
    width: 2.5,
    path: [
      [125, 20], [128, 24], [132, 28], [136, 32], [140, 35],
      [145, 38], [150, 40], [155, 42], [160, 45],
    ],
  },
  // North Pacific Drift
  {
    name: "N. Pacific Drift",
    color: "#ff6666",
    width: 1.5,
    path: [
      [160, 45], [170, 45], [180, 43], [-170, 42], [-160, 40], [-150, 38],
    ],
  },
  // California Current
  {
    name: "California Current",
    color: "#4488ff",
    width: 1.5,
    path: [
      [-125, 45], [-124, 40], [-123, 35], [-122, 30], [-120, 25], [-118, 20],
    ],
  },
  // North Equatorial Current (Pacific)
  {
    name: "N. Equatorial (Pac)",
    color: "#4488ff",
    width: 1.5,
    path: [
      [-150, 12], [-140, 12], [-130, 11], [-120, 10], [-110, 9],
    ],
  },
  // South Equatorial Current (Pacific)
  {
    name: "S. Equatorial (Pac)",
    color: "#4488ff",
    width: 1.5,
    path: [
      [-80, -5], [-100, -5], [-120, -6], [-140, -7], [-160, -8], [-170, -9],
    ],
  },
  // East Australian Current
  {
    name: "E. Australian",
    color: "#ff4444",
    width: 1.5,
    path: [
      [155, -15], [154, -20], [153, -25], [152, -30], [150, -35], [148, -38],
    ],
  },
  // Agulhas Current
  {
    name: "Agulhas",
    color: "#ff4444",
    width: 2,
    path: [
      [38, -15], [37, -20], [35, -25], [32, -30], [28, -34], [22, -37],
    ],
  },
  // Antarctic Circumpolar
  {
    name: "Antarctic Circumpolar",
    color: "#00ccff",
    width: 2,
    path: [
      [0, -55], [30, -56], [60, -57], [90, -56], [120, -55], [150, -56],
      [180, -57], [-150, -56], [-120, -55], [-90, -56], [-60, -57], [-30, -56],
    ],
  },
  // Benguela Current
  {
    name: "Benguela",
    color: "#4488ff",
    width: 1.5,
    path: [
      [15, -32], [14, -28], [12, -24], [10, -20], [8, -15], [5, -10],
    ],
  },
  // Somali Current
  {
    name: "Somali Current",
    color: "#ff6666",
    width: 1.5,
    path: [
      [48, -2], [47, 2], [46, 6], [50, 10], [54, 12],
    ],
  },
  // Indian Ocean Gyre (South Equatorial)
  {
    name: "S. Equatorial (Ind)",
    color: "#4488ff",
    width: 1.5,
    path: [
      [90, -10], [80, -10], [70, -10], [60, -8], [50, -6],
    ],
  },
  // West Australian Current
  {
    name: "W. Australian",
    color: "#4488ff",
    width: 1.5,
    path: [
      [110, -12], [112, -18], [113, -24], [113, -30], [112, -35],
    ],
  },
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let currentMarkers: any[] = [];
let particleOffset = 0;

const PARTICLES_PER_CURRENT = 4;
const SPEED = 0.002;

export function addOceanCurrents(map: maplibregl.Map, handle: LayerHandle): void {
  if (map.getSource("ocean-currents-paths")) return;

  // 1. Static flow path lines
  const pathFeatures: GeoJSON.Feature[] = OCEAN_CURRENTS.map((c) => ({
    type: "Feature" as const,
    geometry: {
      type: "LineString" as const,
      coordinates: c.path,
    },
    properties: { name: c.name, color: c.color, width: c.width },
  }));

  map.addSource("ocean-currents-paths", {
    type: "geojson",
    data: { type: "FeatureCollection", features: pathFeatures },
  });

  map.addLayer({
    id: "ocean-currents-lines",
    type: "line",
    source: "ocean-currents-paths",
    paint: {
      "line-color": ["get", "color"],
      "line-width": ["get", "width"],
      "line-opacity": 0.35,
    },
  });

  // 2. Animated particle layer (empty initially, updated by animation loop)
  map.addSource("ocean-currents-particles", {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
  });

  map.addLayer({
    id: "ocean-currents-dots",
    type: "circle",
    source: "ocean-currents-particles",
    paint: {
      "circle-radius": 3,
      "circle-color": ["get", "color"],
      "circle-opacity": 0.85,
      "circle-blur": 0.3,
    },
  });

  // 3. HTML marker labels at path midpoints (no font dependency)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const MlglMarker = (map as any).constructor as typeof maplibregl.Marker;
  for (const current of OCEAN_CURRENTS) {
    const midIdx = Math.floor(current.path.length / 2);
    const [midLon, midLat] = current.path[midIdx];
    const el = document.createElement("div");
    el.textContent = current.name;
    el.style.cssText = `
      color: ${current.color};
      font-size: 10px;
      font-weight: 600;
      font-family: ui-monospace, SFMono-Regular, monospace;
      text-shadow: 0 0 6px rgba(0,0,0,0.9), 0 0 12px rgba(0,0,0,0.6);
      white-space: nowrap;
      pointer-events: none;
      opacity: 0.8;
    `;
    const marker = new MlglMarker({ element: el, anchor: "center" })
      .setLngLat([midLon, midLat])
      .addTo(map);
    currentMarkers.push(marker);
  }

  // 4. Particle animation loop
  const animate = () => {
    particleOffset = (particleOffset + SPEED) % 1;
    const particleFeatures: GeoJSON.Feature[] = [];

    for (const current of OCEAN_CURRENTS) {
      const pathLen = current.path.length;
      if (pathLen < 2) continue;

      for (let p = 0; p < PARTICLES_PER_CURRENT; p++) {
        const offset = p / PARTICLES_PER_CURRENT;
        const t = (particleOffset + offset) % 1;
        const posF = t * (pathLen - 1);
        const idx = Math.floor(posF);
        const frac = posF - idx;

        if (idx >= pathLen - 1) continue;

        const [lon1, lat1] = current.path[idx];
        const [lon2, lat2] = current.path[idx + 1];

        // Skip antimeridian interpolation jumps
        if (Math.abs(lon2 - lon1) > 180) continue;

        const lon = lon1 + (lon2 - lon1) * frac;
        const lat = lat1 + (lat2 - lat1) * frac;

        particleFeatures.push({
          type: "Feature",
          geometry: { type: "Point", coordinates: [lon, lat] },
          properties: { color: current.color },
        });
      }
    }

    try {
      (map.getSource("ocean-currents-particles") as any).setData({
        type: "FeatureCollection",
        features: particleFeatures,
      });
    } catch {
      /* map may have been removed */
    }
  };

  animate();
  handle.intervals.push(setInterval(animate, 100));
}

export function removeOceanCurrents(map: maplibregl.Map): void {
  // Remove markers
  for (const m of currentMarkers) {
    m.remove();
  }
  currentMarkers = [];

  // Remove layers and sources
  try {
    map.removeLayer("ocean-currents-dots");
  } catch {}
  try {
    map.removeLayer("ocean-currents-lines");
  } catch {}
  try {
    map.removeSource("ocean-currents-particles");
  } catch {}
  try {
    map.removeSource("ocean-currents-paths");
  } catch {}
}
