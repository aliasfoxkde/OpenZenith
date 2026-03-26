import type { DataStatus } from "../types";
import { fetchCelestrak } from "../data-fetchers";

export function loadSatellites(
  viewer: any, Cesium: any,
  updateStatus: (key: string, u: Partial<DataStatus>) => void,
  removeEntities: (prefix: string) => void,
  intervalsRef: React.MutableRefObject<ReturnType<typeof setInterval>[]>,
  entitiesRef: React.MutableRefObject<Record<string, any>>,
  satDataRef: React.MutableRefObject<any[]>,
  stateLayers: { satellites: boolean },
) {
  updateStatus("satellites", { error: null });

  const doLoad = async () => {
    try {
      const tles = await fetchCelestrak();
      if (!Cesium || !viewer || !Array.isArray(tles)) return;
      const satJs = (window as any).satellite;
      const now = new Date();
      const features = tles.slice(0, 3000).filter((t: any) => t.TLE_LINE1 && t.TLE_LINE2).map((t: any) => {
        let coords: [number, number, number] | null = null;
        let velocity = 0;
        if (satJs) {
          try {
            const satrec = satJs.twoline2satrec(t.TLE_LINE1, t.TLE_LINE2);
            const pos = satJs.propagate(satrec, now);
            if (pos.position && pos.velocity) {
              const gd = satJs.eciToGeodetic(pos.position, satJs.gstime(now));
              coords = [satJs.degreesLong(gd.longitude), satJs.degreesLat(gd.latitude), gd.height];
              velocity = Math.sqrt(pos.velocity.x ** 2 + pos.velocity.y ** 2 + pos.velocity.z ** 2);
            }
          } catch { /* skip */ }
        }
        return { tle1: t.TLE_LINE1, tle2: t.TLE_LINE2, name: t.NAME || t.OBJECT_NAME, coords, velocity };
      }).filter((f: any) => f.coords);
      satDataRef.current = features;
      updateStatus("satellites", { lastUpdate: Date.now(), count: features.length });

      const points = new Cesium.PointPrimitiveCollection();
      viewer.scene.primitives.add(points);

      features.forEach((f: any) => {
        const altKm = f.coords[2];
        const isLEO = altKm < 2000;
        const isGEO = altKm > 30000;
        const color = isLEO ? Cesium.Color.CYAN : isGEO ? Cesium.Color.ORANGE : Cesium.Color.YELLOW;
        points.add({
          position: Cesium.Cartesian3.fromDegrees(f.coords[0], f.coords[1], Math.max(altKm * 1000, 160000)),
          pixelSize: isGEO ? 4 : 3,
          color: color.withAlpha(0.6),
          outlineColor: color.withAlpha(0.2),
          outlineWidth: 1,
          scaleByDistance: new Cesium.NearFarScalar(1e6, 2.0, 5e7, 0.5),
          translucencyByDistance: new Cesium.NearFarScalar(1e6, 1.0, 5e7, 0.3),
        });
      });
      entitiesRef.current["sat-points"] = points;

      const iv = setInterval(async () => {
        if (!stateLayers.satellites) return;
        try {
          const t = await fetchCelestrak();
          if (!Array.isArray(t)) return;
          const sj = (window as any).satellite;
          const n = new Date();
          const updated = t.slice(0, 3000).filter((x: any) => x.TLE_LINE1 && x.TLE_LINE2).map((x: any) => {
            let c: [number, number, number] | null = null;
            let v = 0;
            if (sj) { try { const sr = sj.twoline2satrec(x.TLE_LINE1, x.TLE_LINE2); const p = sj.propagate(sr, n); if (p.position) { const g = sj.eciToGeodetic(p.position, sj.gstime(n)); c = [sj.degreesLong(g.longitude), sj.degreesLat(g.latitude), g.height]; if (p.velocity) v = Math.sqrt(p.velocity.x ** 2 + p.velocity.y ** 2 + p.velocity.z ** 2); } } catch { /* skip */ } }
            return { tle1: x.TLE_LINE1, tle2: x.TLE_LINE2, name: x.NAME || x.OBJECT_NAME, coords: c, velocity: v };
          }).filter((f: any) => f.coords);
          satDataRef.current = updated;
          const pts = entitiesRef.current["sat-points"] as any;
          if (pts) {
            const count = Math.min(updated.length, pts.length);
            for (let i = 0; i < count; i++) {
              const f = updated[i];
              if (!f.coords) continue;
              pts.get(i).position = Cesium.Cartesian3.fromDegrees(f.coords[0], f.coords[1], Math.max(f.coords[2] * 1000, 160000));
            }
          }
          updateStatus("satellites", { lastUpdate: Date.now(), count: updated.length });
        } catch { /* retry */ }
      }, 300000);
      intervalsRef.current.push(iv);
    } catch { updateStatus("satellites", { error: "fetch failed" }); }
  };

  doLoad();
}
