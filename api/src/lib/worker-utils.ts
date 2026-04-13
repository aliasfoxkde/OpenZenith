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
    worker.onmessage = (e) => {
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
