import type { LayerHandle } from "./types";

/* ─── Ocean Currents — Canvas Flow Particle Renderer ─── */

/** Major ocean current definitions (flow paths + metadata) */
const OCEAN_CURRENTS = [
  { name: "Gulf Stream", color: [255, 68, 68], path: [[-80,25],[-78,30],[-75,35],[-70,38],[-65,40],[-55,42],[-45,45],[-35,50],[-20,55]] },
  { name: "N. Atlantic Drift", color: [255, 102, 102], path: [[-20,55],[-15,58],[-10,60],[-5,62],[0,63],[5,64],[10,65]] },
  { name: "Canary Current", color: [68, 136, 255], path: [[-15,45],[-18,40],[-20,35],[-20,28],[-18,22],[-16,15]] },
  { name: "N. Equatorial (Atl)", color: [68, 136, 255], path: [[-20,15],[-30,14],[-40,13],[-50,12],[-60,11],[-70,10]] },
  { name: "Caribbean Current", color: [68, 170, 255], path: [[-80,10],[-78,12],[-75,14],[-72,16],[-68,18]] },
  { name: "S. Equatorial (Atl)", color: [68, 136, 255], path: [[-5,0],[-10,-3],[-18,-5],[-25,-7],[-32,-8]] },
  { name: "Brazil Current", color: [255, 68, 68], path: [[-35,-5],[-38,-10],[-42,-15],[-47,-20],[-50,-25],[-53,-30],[-55,-35]] },
  { name: "Kuroshio", color: [255, 68, 68], path: [[125,20],[128,24],[132,28],[136,32],[140,35],[145,38],[150,40],[155,42],[160,45]] },
  { name: "N. Pacific Drift", color: [255, 102, 102], path: [[160,45],[170,45],[180,43],[-170,42],[-160,40],[-150,38]] },
  { name: "California Current", color: [68, 136, 255], path: [[-125,45],[-124,40],[-123,35],[-122,30],[-120,25],[-118,20]] },
  { name: "N. Equatorial (Pac)", color: [68, 136, 255], path: [[-150,12],[-140,12],[-130,11],[-120,10],[-110,9]] },
  { name: "S. Equatorial (Pac)", color: [68, 136, 255], path: [[-80,-5],[-100,-5],[-120,-6],[-140,-7],[-160,-8],[-170,-9]] },
  { name: "E. Australian", color: [255, 68, 68], path: [[155,-15],[154,-20],[153,-25],[152,-30],[150,-35],[148,-38]] },
  { name: "Agulhas", color: [255, 68, 68], path: [[38,-15],[37,-20],[35,-25],[32,-30],[28,-34],[22,-37]] },
  { name: "Antarctic Circumpolar", color: [0, 204, 255], path: [[0,-55],[30,-56],[60,-57],[90,-56],[120,-55],[150,-56],[180,-57],[-150,-56],[-120,-55],[-90,-56],[-60,-57],[-30,-56]] },
  { name: "Benguela", color: [68, 136, 255], path: [[15,-32],[14,-28],[12,-24],[10,-20],[8,-15],[5,-10]] },
  { name: "Somali Current", color: [255, 102, 102], path: [[48,-2],[47,2],[46,6],[50,10],[54,12]] },
  { name: "S. Equatorial (Ind)", color: [68, 136, 255], path: [[90,-10],[80,-10],[70,-10],[60,-8],[50,-6]] },
  { name: "W. Australian", color: [68, 136, 255], path: [[110,-12],[112,-18],[113,-24],[113,-30],[112,-35]] },
];

interface Particle {
  currentIdx: number;
  progress: number;    // 0..1 along path
  speed: number;       // progress per frame
  age: number;         // frames alive
  maxAge: number;      // frames before respawn
  trail: number[][];   // recent [x, y] screen positions
}

const PARTICLE_COUNT = 600;
const TRAIL_LENGTH = 8;
const MAX_PARTICLE_AGE = 80;
const MIN_PARTICLE_AGE = 30;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let canvasEl: HTMLCanvasElement | null = null;
let animFrame = 0;
let particles: Particle[] = [];
let mapRef: maplibregl.Map | null = null;

function createParticle(): Particle {
  const idx = Math.floor(Math.random() * OCEAN_CURRENTS.length);
  return {
    currentIdx: idx,
    progress: Math.random(),
    speed: 0.002 + Math.random() * 0.003,
    age: 0,
    maxAge: MIN_PARTICLE_AGE + Math.random() * (MAX_PARTICLE_AGE - MIN_PARTICLE_AGE),
    trail: [],
  };
}

function interpolatePosition(current: typeof OCEAN_CURRENTS[0], t: number): [number, number] {
  const path = current.path;
  const pathLen = path.length;
  if (pathLen < 2) return [path[0][0], path[0][1]];

  const posF = t * (pathLen - 1);
  const idx = Math.floor(posF);
  const frac = posF - idx;

  if (idx >= pathLen - 1) return [path[pathLen - 1][0], path[pathLen - 1][1]];

  const [lon1, lat1] = path[idx];
  const [lon2, lat2] = path[idx + 1];

  // Skip antimeridian jumps
  if (Math.abs(lon2 - lon1) > 180) {
    // Try next segment
    if (idx + 2 < pathLen) {
      return [path[idx + 1][0], path[idx + 1][1]];
    }
    return [lon1, lat1];
  }

  return [lon1 + (lon2 - lon1) * frac, lat1 + (lat2 - lat1) * frac];
}

function renderFrame() {
  const map = mapRef;
  const canvas = canvasEl;
  if (!map || !canvas || !(map as any).getContainer()) return;

  const container = (map as any).getContainer();
  const width = container.clientWidth;
  const height = container.clientHeight;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
  }

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  // Update and draw particles
  for (let i = 0; i < particles.length; i++) {
    const p = particles[i];
    const current = OCEAN_CURRENTS[p.currentIdx];

    // Advance particle
    p.progress += p.speed;
    if (p.progress >= 1) {
      // Respawn
      const newP = createParticle();
      particles[i] = newP;
      continue;
    }

    p.age++;
    if (p.age >= p.maxAge) {
      const newP = createParticle();
      particles[i] = newP;
      continue;
    }

    // Get screen position
    const [lng, lat] = interpolatePosition(current, p.progress);
    const point = map.project([lng, lat]);

    p.trail.push([point.x, point.y]);
    if (p.trail.length > TRAIL_LENGTH) {
      p.trail.shift();
    }

    // Calculate opacity based on age (fade in/out)
    const fadeIn = Math.min(1, p.age / 10);
    const fadeOut = Math.min(1, (p.maxAge - p.age) / 15);
    const baseAlpha = fadeIn * fadeOut * 0.7;

    // Draw trail
    if (p.trail.length >= 2) {
      const [r, g, b] = current.color;
      ctx.beginPath();
      ctx.moveTo(p.trail[0][0], p.trail[0][1]);
      for (let j = 1; j < p.trail.length; j++) {
        ctx.lineTo(p.trail[j][0], p.trail[j][1]);
      }
      ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${baseAlpha})`;
      ctx.lineWidth = 1.5;
      ctx.lineCap = "round";
      ctx.stroke();
    }

    // Draw head dot
    const lastPt = p.trail[p.trail.length - 1];
    ctx.beginPath();
    ctx.arc(lastPt[0], lastPt[1], 1.2, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${current.color[0]}, ${current.color[1]}, ${current.color[2]}, ${baseAlpha * 1.2})`;
    ctx.fill();
  }

  animFrame = requestAnimationFrame(renderFrame);
}

export function addOceanCurrents(map: maplibregl.Map, handle: LayerHandle): void {
  if (canvasEl) return;

  mapRef = map;

  // Create canvas overlay
  canvasEl = document.createElement("canvas");
  canvasEl.style.cssText = `
    position: absolute;
    inset: 0;
    pointer-events: none;
    z-index: 1;
  `;
  (map as any).getContainer().appendChild(canvasEl);

  // Initialize particles
  particles = [];
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    particles.push(createParticle());
  }

  // Static flow path lines (subtle background)
  const pathFeatures: GeoJSON.Feature[] = OCEAN_CURRENTS.map((c) => ({
    type: "Feature" as const,
    geometry: { type: "LineString" as const, coordinates: c.path },
    properties: { name: c.name },
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
      "line-color": [
        "match", ["get", "name"],
        "Gulf Stream", "rgba(255,68,68,0.15)",
        "Kuroshio", "rgba(255,68,68,0.15)",
        "Agulhas", "rgba(255,68,68,0.15)",
        "Brazil Current", "rgba(255,68,68,0.15)",
        "E. Australian", "rgba(255,68,68,0.15)",
        "N. Atlantic Drift", "rgba(255,102,102,0.12)",
        "N. Pacific Drift", "rgba(255,102,102,0.12)",
        "Somali Current", "rgba(255,102,102,0.12)",
        "Antarctic Circumpolar", "rgba(0,204,255,0.12)",
        "rgba(68,136,255,0.1)",
      ],
      "line-width": 1.5,
    },
  });

  // HTML marker labels at midpoints
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const MlglMarker = (map as any).constructor as typeof maplibregl.Marker;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const markers: any[] = [];
  for (const current of OCEAN_CURRENTS) {
    const midIdx = Math.floor(current.path.length / 2);
    const [midLon, midLat] = current.path[midIdx];
    const el = document.createElement("div");
    el.textContent = current.name;
    el.style.cssText = `
      color: rgb(${current.color.join(",")});
      font-size: 10px;
      font-weight: 600;
      font-family: ui-monospace, SFMono-Regular, monospace;
      text-shadow: 0 0 6px rgba(0,0,0,0.9), 0 0 12px rgba(0,0,0,0.6);
      white-space: nowrap;
      pointer-events: none;
      opacity: 0.75;
    `;
    const marker = new MlglMarker({ element: el, anchor: "center" })
      .setLngLat([midLon, midLat])
      .addTo(map);
    markers.push(marker);
  }

  // Store markers for cleanup
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (addOceanCurrents as any)._markers = markers;

  // Start animation
  animFrame = requestAnimationFrame(renderFrame);

  // Handle map move — particles need re-projection
  const onMove = () => {
    // Clear trails on significant camera change so they don't smear
    for (const p of particles) {
      p.trail = [];
    }
  };
  map.on("moveend", onMove);
  map.on("zoomend", onMove);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (addOceanCurrents as any)._onMove = onMove;
}

export function removeOceanCurrents(map: maplibregl.Map): void {
  // Stop animation
  if (animFrame) {
    cancelAnimationFrame(animFrame);
    animFrame = 0;
  }

  // Remove canvas
  if (canvasEl && canvasEl.parentNode) {
    canvasEl.parentNode.removeChild(canvasEl);
  }
  canvasEl = null;
  mapRef = null;
  particles = [];

  // Remove markers
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const markers = (addOceanCurrents as any)._markers as any[] | undefined;
  if (markers) {
    for (const m of markers) { m.remove(); }
    (addOceanCurrents as any)._markers = [];
  }

  // Remove move listener
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const onMove = (addOceanCurrents as any)._onMove;
  if (onMove) {
    try { map.off("moveend", onMove); } catch {}
    try { map.off("zoomend", onMove); } catch {}
  }

  // Remove layers
  try { map.removeLayer("ocean-currents-lines"); } catch {}
  try { map.removeSource("ocean-currents-paths"); } catch {}
}
