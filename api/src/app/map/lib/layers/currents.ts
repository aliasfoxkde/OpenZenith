import type { LayerHandle } from "./types";

/* ─── Ocean Currents — Windy.com-style Flow Particle Renderer ─── */

const OCEAN_CURRENTS = [
  { name: "Gulf Stream", path: [[-80,25],[-78,30],[-75,35],[-70,38],[-65,40],[-55,42],[-45,45],[-35,50],[-20,55]] },
  { name: "N. Atlantic Drift", path: [[-20,55],[-15,58],[-10,60],[-5,62],[0,63],[5,64],[10,65]] },
  { name: "Canary Current", path: [[-15,45],[-18,40],[-20,35],[-20,28],[-18,22],[-16,15]] },
  { name: "N. Equatorial (Atl)", path: [[-20,15],[-30,14],[-40,13],[-50,12],[-60,11],[-70,10]] },
  { name: "Caribbean Current", path: [[-80,10],[-78,12],[-75,14],[-72,16],[-68,18]] },
  { name: "S. Equatorial (Atl)", path: [[-5,0],[-10,-3],[-18,-5],[-25,-7],[-32,-8]] },
  { name: "Brazil Current", path: [[-35,-5],[-38,-10],[-42,-15],[-47,-20],[-50,-25],[-53,-30],[-55,-35]] },
  { name: "Kuroshio", path: [[125,20],[128,24],[132,28],[136,32],[140,35],[145,38],[150,40],[155,42],[160,45]] },
  { name: "N. Pacific Drift", path: [[160,45],[170,45],[180,43],[-170,42],[-160,40],[-150,38]] },
  { name: "California Current", path: [[-125,45],[-124,40],[-123,35],[-122,30],[-120,25],[-118,20]] },
  { name: "N. Equatorial (Pac)", path: [[-150,12],[-140,12],[-130,11],[-120,10],[-110,9]] },
  { name: "S. Equatorial (Pac)", path: [[-80,-5],[-100,-5],[-120,-6],[-140,-7],[-160,-8],[-170,-9]] },
  { name: "E. Australian", path: [[155,-15],[154,-20],[153,-25],[152,-30],[150,-35],[148,-38]] },
  { name: "Agulhas", path: [[38,-15],[37,-20],[35,-25],[32,-30],[28,-34],[22,-37]] },
  { name: "Antarctic Circumpolar", path: [[0,-55],[30,-56],[60,-57],[90,-56],[120,-55],[150,-56],[180,-57],[-150,-56],[-120,-55],[-90,-56],[-60,-57],[-30,-56]] },
  { name: "Benguela", path: [[15,-32],[14,-28],[12,-24],[10,-20],[8,-15],[5,-10]] },
  { name: "Somali Current", path: [[48,-2],[47,2],[46,6],[50,10],[54,12]] },
  { name: "S. Equatorial (Ind)", path: [[90,-10],[80,-10],[70,-10],[60,-8],[50,-6]] },
  { name: "W. Australian", path: [[110,-12],[112,-18],[113,-24],[113,-30],[112,-35]] },
];

// ─── Vector field ───

interface Vec2 { dx: number; dy: number }

const GRID_W = 360;
const GRID_H = 180;
const flowField: Vec2[] = new Array(GRID_W * GRID_H).fill(null).map(() => ({ dx: 0, dy: 0 }));
// Pre-computed magnitudes for particle speed
const flowMag: Float32Array = new Float32Array(GRID_W * GRID_H);

function buildFlowField(): void {
  for (let i = 0; i < flowField.length; i++) {
    flowField[i] = { dx: 0, dy: 0 };
    flowMag[i] = 0;
  }

  for (const current of OCEAN_CURRENTS) {
    const path = current.path;
    for (let i = 0; i < path.length - 1; i++) {
      const [x1, y1] = path[i];
      const [x2, y2] = path[i + 1];
      if (Math.abs(x2 - x1) > 180) continue;

      const dx = x2 - x1;
      const dy = y2 - y1;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len < 0.01) continue;

      // Normalized direction
      const ndx = dx / len;
      const ndy = dy / len;

      // Rasterize this segment's influence onto the grid
      // Walk along the segment in 0.5° steps and spread influence perpendicular
      const steps = Math.ceil(len / 0.5);
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const cx = x1 + t * dx;
        const cy = y1 + t * dy;

        // Spread perpendicular to flow direction, influence radius 8°
        const perpX = -ndy;
        const perpY = ndx;
        const spreadSteps = 16; // 8° each side at 0.5° steps
        for (let p = -spreadSteps; p <= spreadSteps; p++) {
          const gx = Math.floor(cx + perpX * p * 0.5 + 180);
          const gy = Math.floor(90 - (cy + perpY * p * 0.5));
          if (gx < 0 || gx >= GRID_W || gy < 0 || gy >= GRID_H) continue;

          const dist = Math.abs(p * 0.5);
          if (dist > 8) continue;

          const weight = Math.pow(1 - dist / 8, 1.5); // smooth falloff
          const idx = gy * GRID_W + gx;
          flowField[idx].dx += ndx * weight;
          flowField[idx].dy += ndy * weight;
        }
      }
    }
  }

  // Normalize vectors and compute magnitudes
  for (let i = 0; i < flowField.length; i++) {
    const v = flowField[i];
    const mag = Math.sqrt(v.dx * v.dx + v.dy * v.dy);
    flowMag[i] = mag;
    if (mag > 0.001) {
      flowField[i].dx /= mag;
      flowField[i].dy /= mag;
    }
  }
}

buildFlowField();

// ─── Particles ───

interface FlowParticle {
  x: number;
  y: number;
  age: number;
  maxAge: number;
  prevX: number;  // previous screen x (for line drawing)
  prevY: number;  // previous screen y
  trail: Float32Array;  // ring buffer of screen coords
  trailHead: number;    // write position in ring buffer
  trailCount: number;   // how many valid entries
  speed: number;
  maxTrail: number;
}

const PARTICLE_COUNT = 6000;
const MAX_TRAIL = 50;

let canvasEl: HTMLCanvasElement | null = null;
let animFrame = 0;
let particles: FlowParticle[] = [];
let mapRef: maplibregl.Map | null = null;
let isMoving = false;

function createParticle(): FlowParticle {
  return {
    x: 0, y: 0, age: 0, maxAge: 0,
    prevX: 0, prevY: 0,
    trail: new Float32Array(MAX_TRAIL * 2),
    trailHead: 0, trailCount: 0,
    speed: 0, maxTrail: 0,
  };
}

function spawnParticle(p: FlowParticle): void {
  // Pick a random cell with flow above threshold
  for (let attempt = 0; attempt < 80; attempt++) {
    const gx = Math.floor(Math.random() * GRID_W);
    const gy = Math.floor(Math.random() * GRID_H);
    const idx = gy * GRID_W + gx;
    const mag = flowMag[idx];
    if (mag > 0.15) {
      const lon = gx - 180 + 0.5;
      const lat = 90 - gy - 0.5;
      // Perpendicular spread — tighter near path, wider away
      const angle = Math.atan2(flowField[idx].dy, flowField[idx].dx);
      const spread = (Math.random() - 0.5) * 4;
      p.x = lon + Math.cos(angle + Math.PI / 2) * spread;
      p.y = lat + Math.sin(angle + Math.PI / 2) * spread;
      p.age = 0;
      p.maxAge = 80 + Math.random() * 120;
      p.speed = 0.15 + Math.min(mag, 1) * 0.25;
      p.maxTrail = Math.min(MAX_TRAIL, 8 + Math.floor(mag * 25));
      p.trailHead = 0;
      p.trailCount = 0;
      return;
    }
  }
  // Fallback on a path directly
  const c = OCEAN_CURRENTS[Math.floor(Math.random() * OCEAN_CURRENTS.length)];
  const pt = c.path[Math.floor(Math.random() * c.path.length)];
  p.x = pt[0] + (Math.random() - 0.5) * 3;
  p.y = pt[1] + (Math.random() - 0.5) * 3;
  p.age = 0;
  p.maxAge = 80 + Math.random() * 100;
  p.speed = 0.2;
  p.maxTrail = 20;
  p.trailHead = 0;
  p.trailCount = 0;
}

function getFlowAt(lon: number, lat: number): { dx: number; dy: number; mag: number } {
  const gx = Math.floor(lon + 180 + 0.5);
  const gy = Math.floor(90 - lat + 0.5);
  if (gx < 0 || gx >= GRID_W || gy < 0 || gy >= GRID_H) return { dx: 0, dy: 0, mag: 0 };
  const idx = gy * GRID_W + gx;
  return { dx: flowField[idx].dx, dy: flowField[idx].dy, mag: flowMag[idx] };
}

function renderFrame() {
  const map = mapRef;
  const canvas = canvasEl;
  if (!map || !canvas) return;
  const container = (map as any).getContainer();
  if (!container) return;

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

  // Windy.com color: consistent blue
  const R = 60, G = 140, B = 255;

  for (let i = 0; i < particles.length; i++) {
    const p = particles[i];

    // Advect
    const v = getFlowAt(p.x, p.y);
    if (v.mag > 0.01) {
      p.x += v.dx * p.speed;
      p.y += v.dy * p.speed;
    }

    p.age++;

    // Respawn
    if (p.age >= p.maxAge || p.x < -180 || p.x > 180 || p.y < -90 || p.y > 90) {
      spawnParticle(p);
      continue;
    }

    // Screen position
    const point = map.project([p.x, p.y]);

    // Off-screen check with margin
    if (point.x < -100 || point.x > width + 100 || point.y < -100 || point.y > height + 100) {
      p.trailCount = 0;
      p.trailHead = 0;
      p.prevX = point.x;
      p.prevY = point.y;
      continue;
    }

    // Add to ring buffer
    const head = p.trailHead;
    p.trail[head * 2] = point.x;
    p.trail[head * 2 + 1] = point.y;
    p.trailHead = (head + 1) % MAX_TRAIL;
    if (p.trailCount < MAX_TRAIL) p.trailCount++;

    // Don't draw very short trails
    if (p.trailCount < 3) continue;

    // Fade in/out
    const fadeIn = Math.min(1, p.age / 12);
    const fadeOut = Math.min(1, (p.maxAge - p.age) / 20);
    const baseAlpha = fadeIn * fadeOut;

    // Draw trail as a single gradient path
    // Read trail from oldest to newest
    const count = p.trailCount;
    const startIdx = (p.trailHead - count + MAX_TRAIL) % MAX_TRAIL;

    ctx.beginPath();
    let sx = p.trail[startIdx * 2];
    let sy = p.trail[startIdx * 2 + 1];
    ctx.moveTo(sx, sy);

    for (let j = 1; j < count; j++) {
      const idx = (startIdx + j) % MAX_TRAIL;
      const tx = p.trail[idx * 2];
      const ty = p.trail[idx * 2 + 1];
      // Skip discontinuities (from map movement)
      if (Math.abs(tx - sx) > 200 || Math.abs(ty - sy) > 200) {
        ctx.moveTo(tx, ty);
      } else {
        ctx.lineTo(tx, ty);
      }
      sx = tx;
      sy = ty;
    }

    ctx.strokeStyle = `rgba(${R}, ${G}, ${B}, ${baseAlpha * 0.6})`;
    ctx.lineWidth = 1;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.stroke();

    // Brighter head segment (last ~30% of trail)
    if (count > 4) {
      const headStart = Math.max(0, count - Math.floor(count * 0.3));
      const headIdx = (startIdx + headStart) % MAX_TRAIL;
      ctx.beginPath();
      sx = p.trail[headIdx * 2];
      sy = p.trail[headIdx * 2 + 1];
      ctx.moveTo(sx, sy);
      for (let j = headStart + 1; j < count; j++) {
        const idx = (startIdx + j) % MAX_TRAIL;
        const tx = p.trail[idx * 2];
        const ty = p.trail[idx * 2 + 1];
        if (Math.abs(tx - sx) > 200 || Math.abs(ty - sy) > 200) {
          ctx.moveTo(tx, ty);
        } else {
          ctx.lineTo(tx, ty);
        }
        sx = tx;
        sy = ty;
      }
      ctx.strokeStyle = `rgba(${R}, ${G}, ${B}, ${baseAlpha * 0.9})`;
      ctx.lineWidth = 1.3;
      ctx.stroke();
    }
  }

  animFrame = requestAnimationFrame(renderFrame);
}

export function addOceanCurrents(map: maplibregl.Map, _handle: LayerHandle): void {
  if (canvasEl) return;

  mapRef = map;

  // Canvas overlay
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
    const p = createParticle();
    spawnParticle(p);
    p.age = Math.floor(Math.random() * p.maxAge); // stagger
    particles.push(p);
  }

  // Static path lines (very subtle)
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
    paint: { "line-color": "rgba(60, 140, 255, 0.06)", "line-width": 1 },
  });

  // Labels at midpoints
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
      color: rgb(100, 170, 255);
      font-size: 10px;
      font-weight: 600;
      font-family: ui-monospace, SFMono-Regular, monospace;
      text-shadow: 0 0 6px rgba(0,0,0,0.9), 0 0 12px rgba(0,0,0,0.6);
      white-space: nowrap;
      pointer-events: none;
      opacity: 0.65;
    `;
    const marker = new MlglMarker({ element: el, anchor: "center" })
      .setLngLat([midLon, midLat])
      .addTo(map);
    markers.push(marker);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (addOceanCurrents as any)._markers = markers;

  // Start animation
  animFrame = requestAnimationFrame(renderFrame);

  // Clear trails on camera move
  const onMoveStart = () => { isMoving = true; };
  const onMoveEnd = () => {
    isMoving = false;
    for (const p of particles) { p.trailCount = 0; p.trailHead = 0; }
  };
  map.on("movestart", onMoveStart);
  map.on("moveend", onMoveEnd);
  map.on("zoomend", onMoveEnd);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (addOceanCurrents as any)._onMoveStart = onMoveStart;
  (addOceanCurrents as any)._onMoveEnd = onMoveEnd;
}

export function removeOceanCurrents(map: maplibregl.Map): void {
  if (animFrame) {
    cancelAnimationFrame(animFrame);
    animFrame = 0;
  }

  if (canvasEl && canvasEl.parentNode) {
    canvasEl.parentNode.removeChild(canvasEl);
  }
  canvasEl = null;
  mapRef = null;
  particles = [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const markers = (addOceanCurrents as any)._markers as any[] | undefined;
  if (markers) {
    for (const m of markers) { m.remove(); }
    (addOceanCurrents as any)._markers = [];
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const onMoveStart = (addOceanCurrents as any)._onMoveStart;
  const onMoveEnd = (addOceanCurrents as any)._onMoveEnd;
  if (onMoveStart) try { map.off("movestart", onMoveStart); } catch {}
  if (onMoveEnd) {
    try { map.off("moveend", onMoveEnd); } catch {}
    try { map.off("zoomend", onMoveEnd); } catch {}
  }

  try { map.removeLayer("ocean-currents-lines"); } catch {}
  try { map.removeSource("ocean-currents-paths"); } catch {}
}
