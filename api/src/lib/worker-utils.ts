/**
 * Web Worker utilities for offloading heavy computation.
 *
 * Uses inline workers via Blob URLs to avoid webpack/bundling issues
 * with Next.js and Cloudflare Pages.
 */

/** Create an inline Web Worker from a script string */
function createInlineWorker(script: string): Worker {
  const blob = new Blob([script], { type: "application/javascript" });
  const url = URL.createObjectURL(blob);
  const worker = new Worker(url);
  URL.revokeObjectURL(url);
  return worker;
}

/** One satellite propagated to one moment — the SGP4 worker's unit of output. */
export interface Sgp4Fix {
  /** Geodetic position [lonDeg, latDeg, altKm]. */
  coords: [number, number, number];
  /** Speed in km/s. */
  velocity: number;
}

/** Order-preserving fixes plus flat [lonDeg, latDeg, ...] ground tracks. */
export interface CataloguePropagation {
  /** Null for decayed or malformed TLEs — callers drop them. */
  fixes: (Sgp4Fix | null)[];
  /** One trail per requested track index, in request order. */
  tracks: number[][];
}

/**
 * SGP4 worker: loads the same-origin /vendor/satellite.min.js build the globe
 * page already ships (browser HTTP cache, no extra bundle weight), then
 * propagates a catalogue of TLE pairs to one epoch plus optional ±90 min
 * ground tracks at 2-min steps. importScripts is undefined inside the vm-based
 * unit tests and whenever the vendor script is missing — both surface as a
 * rejection so the caller can fall back to main-thread propagation.
 */
const SGP4_WORKER_SCRIPT = `
const SGP4_VENDOR = "/vendor/satellite.min.js";
try { importScripts(SGP4_VENDOR); } catch { /* reported via the guard below */ }

const sgp4Fix = (sat, l1, l2, at) => {
  try {
    const rec = sat.twoline2satrec(l1, l2);
    const pos = sat.propagate(rec, at);
    if (pos.position && pos.velocity) {
      const gd = sat.eciToGeodetic(pos.position, sat.gstime(at));
      return {
        coords: [sat.degreesLong(gd.longitude), sat.degreesLat(gd.latitude), gd.height],
        velocity: Math.sqrt(pos.velocity.x ** 2 + pos.velocity.y ** 2 + pos.velocity.z ** 2),
      };
    }
  } catch { /* decayed or malformed TLE */ }
  return null;
};

self.onmessage = (e) => {
  const sat = self.satellite;
  if (!sat) {
    self.postMessage({ error: "satellite.js unavailable in worker" });
    return;
  }
  const d = e.data;
  const at = new Date(d.atMs);
  const fixes = [];
  for (let i = 0; i < d.tles.length; i++) {
    fixes.push(sgp4Fix(sat, d.tles[i][0], d.tles[i][1], at));
  }
  const tracks = [];
  for (let k = 0; k < d.trackIdx.length; k++) {
    const tle = d.tles[d.trackIdx[k]];
    const pts = [];
    for (let m = -90; m <= 90; m += 2) {
      const fix = sgp4Fix(sat, tle[0], tle[1], new Date(d.atMs + m * 60000));
      if (fix) pts.push(fix.coords[0], fix.coords[1]);
    }
    tracks.push(pts);
  }
  self.postMessage({ fixes, tracks });
};
`;

/**
 * Propagate a satellite catalogue in a one-shot Web Worker.
 *
 * `tles` are [TLE_LINE1, TLE_LINE2] pairs; fixes come back order-preserving.
 * `trackIdx` names catalogue entries (indices into `tles`) that additionally
 * get a ±90-minute sub-satellite trail sampled every 2 minutes — the bulk of
 * the globe layer's propagation work (~50 sats x 91 samples), which this moves
 * off the main thread entirely.
 */
export function propagateCatalogueInWorker(
  tles: ReadonlyArray<readonly [string, string]>,
  atMs: number,
  trackIdx: readonly number[] = [],
): Promise<CataloguePropagation> {
  return new Promise((resolve, reject) => {
    const worker = createInlineWorker(SGP4_WORKER_SCRIPT);
    worker.onmessage = (e: MessageEvent<CataloguePropagation | { error: string }>) => {
      worker.terminate();
      if ("fixes" in e.data) resolve(e.data);
      else reject(new Error(e.data.error));
    };
    worker.onerror = (e) => {
      worker.terminate();
      reject(new Error(e.message));
    };
    worker.postMessage({ tles, atMs, trackIdx });
  });
}

/**
 * Compute interpolated profile coordinates in a Web Worker.
 *
 * Takes start/end coordinates and returns an array of interpolated
 * [lon, lat] pairs with distance information.
 */
export function computeProfileInWorker(
  start: [number, number],
  end: [number, number],
): Promise<{ points: [number, number][]; totalDistance: number }> {
  const workerCode = `
    function haversine(lat1, lon1, lat2, lon2) {
      const R = 6371000;
      const toRad = (d) => (d * Math.PI) / 180;
      const dLat = toRad(lat2 - lat1);
      const dLon = toRad(lon2 - lon1);
      const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
      return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    self.onmessage = function(e) {
      const { start, end } = e.data;
      const dist = haversine(start[1], start[0], end[1], end[0]);
      const numSamples = Math.min(200, Math.max(50, Math.round(dist / 100)));
      const points = [];
      for (let i = 0; i <= numSamples; i++) {
        const t = i / numSamples;
        points.push([start[0] + t * (end[0] - start[0]), start[1] + t * (end[1] - start[1])]);
      }
      self.postMessage({ points, totalDistance: dist });
    };
  `;

  return new Promise((resolve, reject) => {
    const worker = createInlineWorker(workerCode);
    // The inline worker posts exactly this payload shape (see workerCode).
    worker.onmessage = (e: MessageEvent<{ points: [number, number][]; totalDistance: number }>) => {
      worker.terminate();
      resolve(e.data);
    };
    worker.onerror = (e) => {
      worker.terminate();
      reject(new Error(e.message));
    };
    worker.postMessage({ start, end });
  });
}
