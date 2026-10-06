import type { TleRecord } from "../data-fetchers";

/**
 * Draws ground tracks for three notable satellites (ISS 25544, Hubble 20580,
 * Tiangong 48274). Requires the globally loaded satellite.js
 * (window.satellite) and no-ops without it. Fetches a live TLE per satellite
 * from Celestrak (gp.php?CATNR=...&FORMAT=json) via /api/proxy, propagates
 * SGP4 for 200 steps at 30 s intervals from load time, and adds one
 * ground-clamped glowing cyan polyline per satellite (`gtrack-<n>`) to
 * viewer.entities. Returns void. No status callback, no polling interval and
 * no cleanup of its own; a failed or short TLE fetch silently drops that
 * satellite.
 */
export function loadGroundTracks(
  viewer: CesiumType.Viewer,
  Cesium: typeof CesiumType,
  signal?: AbortSignal,
) {
  // Caller (page.tsx loadLayerDynamic) guarantees viewer/Cesium; the CDN
  // satellite.js script is the one dependency this layer must verify itself.
  const satJs = window.satellite;
  if (!satJs) return;

  const notable = [
    { name: "ISS", catnr: 25544 },
    { name: "Hubble", catnr: 20580 },
    { name: "Tiangong", catnr: 48274 },
  ];
  const now = Date.now();
  let count = 0;

  const loadTrack = async (sat: (typeof notable)[0]) => {
    try {
      const r = await fetch(`/api/proxy/https://celestrak.org/NORAD/elements/gp.php?CATNR=${sat.catnr}&FORMAT=json`, { signal });
      const body: unknown = await r.json();
      if (!Array.isArray(body)) return;
      const tles = body as TleRecord[];
      if (!tles[0]?.TLE_LINE1) return;
      const tle = tles[0];
      const satrec = satJs.twoline2satrec(tle.TLE_LINE1, tle.TLE_LINE2);
      const positions: CesiumType.Cartesian3[] = [];
      for (let i = 0; i <= 200; i++) {
        const date = new Date(now + i * 30000);
        const posVel = satJs.propagate(satrec, date);
        if (!posVel.position) continue;
        const gd = satJs.eciToGeodetic(posVel.position, satJs.gstime(date));
        const lon = satJs.degreesLong(gd.longitude);
        const lat = satJs.degreesLat(gd.latitude);
        positions.push(Cesium.Cartesian3.fromDegrees(lon, lat, 0));
      }
      if (positions.length < 2) return;
      viewer.entities.add({
        id: `gtrack-${count}`,
        polyline: {
          positions,
          width: 1.5,
          material: new Cesium.PolylineGlowMaterialProperty({
            glowPower: 0.1,
            color: Cesium.Color.CYAN.withAlpha(0.3),
          }),
          clampToGround: true,
        },
        properties: { type: "groundTrack", name: sat.name },
      });
      count++;
    } catch {
      /* skip */
    }
  };

  void Promise.all(notable.map(loadTrack));
}
