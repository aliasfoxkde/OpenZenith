/* eslint-disable @typescript-eslint/no-explicit-any */
import type { DataStatus } from "../types";
import { ICONS } from "../constants";
import { fetchCelestrak } from "../data-fetchers";
import { createRetryGuard } from "../helpers";

/** Orbital shell definitions (altitude in meters) */
const ORBITAL_SHELLS = [
  { name: "LEO", minAlt: 160_000, maxAlt: 2_000_000, color: "#00ffff", alpha: 0.06 },
  { name: "MEO", minAlt: 2_000_000, maxAlt: 35_000_000, color: "#ffff00", alpha: 0.04 },
  { name: "GEO", minAlt: 35_000_000, maxAlt: 36_500_000, color: "#ff8800", alpha: 0.08 },
];

/** Satellite purpose classification from name heuristics */
function classifySatellite(name: string): string {
  const n = name.toUpperCase();
  if (/STARLINK|KUiper/i.test(n)) return "communication";
  if (/IRIDIUM|GLOBALSTAR|ORBCOMM|ONEWEB/i.test(n)) return "communication";
  if (/GPS|GALILEO|GLONASS|BEIDOU|QZSS/i.test(n)) return "navigation";
  if (/GOES|METEOSAT|HIMAWARI|NOAA|TERRA|AQUA|SUOMI|JPSS/i.test(n)) return "weather";
  if (/LACROSSE|USA-\d|NROL|ZUMA/i.test(n)) return "military";
  if (/HUBBLE|JWST|CHANDRA|XMM|INTEGRAL/i.test(n)) return "scientific";
  if (/ISS|TIANGONG|SOYUZ|PROGRESS|CREW/i.test(n)) return "station";
  return "other";
}

/** Orbital classification from altitude */
function classifyOrbit(altKm: number): string {
  if (altKm < 2000) return "LEO";
  if (altKm < 35000) return "MEO";
  return "GEO";
}

/** Purpose-based color */
function purposeColor(purpose: string, Cesium: any): any {
  switch (purpose) {
    case "communication":
      return Cesium.Color.LIME;
    case "navigation":
      return Cesium.Color.YELLOW;
    case "weather":
      return Cesium.Color.CYAN;
    case "military":
      return Cesium.Color.RED;
    case "scientific":
      return Cesium.Color.MAGENTA;
    case "station":
      return Cesium.Color.WHITE;
    default:
      return Cesium.Color.GRAY;
  }
}

export function loadSatellites(
  viewer: any,
  Cesium: any,
  updateStatus: (key: string, u: Partial<DataStatus>) => void,
  removeEntities: (prefix: string) => void,
  intervalsRef: React.MutableRefObject<ReturnType<typeof setInterval>[]>,
  entitiesRef: React.MutableRefObject<Record<string, any>>,
  satDataRef: React.MutableRefObject<any[]>,
  stateLayers: { satellites: boolean; orbitalTracks?: boolean; groundTracks?: boolean },
) {
  updateStatus("satellites", { error: null });
  const retry = createRetryGuard();

  const doLoad = async () => {
    try {
      const tles = await fetchCelestrak();
      if (!Cesium || !viewer || !Array.isArray(tles)) return;
      const satJs = (window as any).satellite;
      const now = new Date();
      const features = tles
        .slice(0, 1500)
        .filter((t: any) => t.TLE_LINE1 && t.TLE_LINE2)
        .map((t: any) => {
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
            } catch {
              /* skip */
            }
          }
          const name = t.NAME || t.OBJECT_NAME || "";
          return {
            tle1: t.TLE_LINE1,
            tle2: t.TLE_LINE2,
            name,
            coords,
            velocity,
            purpose: classifySatellite(name),
            orbit: coords ? classifyOrbit(coords[2]) : "Unknown",
            noradId: t.NORAD_CAT_ID,
          };
        })
        .filter((f: any) => f.coords);
      satDataRef.current = features;
      updateStatus("satellites", { lastUpdate: Date.now(), count: features.length });

      // ─── Orbital shell ellipsoids ───
      for (const shell of ORBITAL_SHELLS) {
        viewer.entities.add({
          id: `orbit-shell-${shell.name}`,
          position: Cesium.Cartesian3.fromDegrees(0, 0, 0),
          ellipsoid: {
            radii: new Cesium.Cartesian3(6_371_000 + shell.maxAlt, 6_371_000 + shell.maxAlt, 6_371_000 + shell.maxAlt),
            material: Cesium.Color.fromCssColorString(shell.color).withAlpha(shell.alpha),
            outline: true,
            outlineColor: Cesium.Color.fromCssColorString(shell.color).withAlpha(shell.alpha * 3),
            outlineWidth: 1,
          },
          label: {
            text: shell.name,
            font: "10px 'JetBrains Mono', monospace",
            fillColor: Cesium.Color.fromCssColorString(shell.color).withAlpha(0.7),
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 1,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            pixelOffset: new Cesium.Cartesian2(0, -20),
            verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
            scaleByDistance: new Cesium.NearFarScalar(1e7, 1.0, 5e7, 0.0),
          },
          properties: { type: "orbit-shell", shell: shell.name },
        });
      }

      // ─── Satellite point primitives (performant batch rendering) ───
      const points = new Cesium.PointPrimitiveCollection();
      viewer.scene.primitives.add(points);

      features.forEach((f: any) => {
        const altKm = f.coords[2];
        const color = purposeColor(f.purpose, Cesium);
        const size = f.orbit === "GEO" ? 6 : f.orbit === "MEO" ? 5 : 4;
        points.add({
          position: Cesium.Cartesian3.fromDegrees(f.coords[0], f.coords[1], Math.max(altKm * 1000, 160_000)),
          pixelSize: size,
          color: color.withAlpha(0.85),
          outlineColor: color.withAlpha(0.4),
          outlineWidth: 1,
          scaleByDistance: new Cesium.NearFarScalar(5e5, 3.0, 5e7, 1.0),
          translucencyByDistance: new Cesium.NearFarScalar(5e5, 1.0, 8e7, 0.4),
        });
      });
      entitiesRef.current["sat-points"] = points;

      // ─── Notable satellite entities with labels and ground tracks ───
      const notablePatterns = [
        /ISS\b|ZARYA/,
        /HUBBLE/,
        /STARLINK/i,
        /GPS\b/,
        /GOES\b/,
        /METEOSAT/,
        /TERRA\b/,
        /AQUA\b/,
        /JWST/,
        /TIANGONG/,
      ];
      const notableSats = features.filter((f: any) => notablePatterns.some((p) => p.test(f.name)));

      for (const sat of notableSats.slice(0, 50)) {
        if (!sat.coords) continue;
        const altM = Math.max(sat.coords[2] * 1000, 160_000);
        const color = purposeColor(sat.purpose, Cesium);
        const isStation = sat.purpose === "station";

        // Billboard + label for notable sats
        viewer.entities.add({
          id: `sat-notable-${sat.noradId || sat.name}`,
          name: sat.name,
          position: Cesium.Cartesian3.fromDegrees(sat.coords[0], sat.coords[1], altM),
          billboard: {
            image: ICONS.satellite,
            width: isStation ? 18 : 14,
            height: isStation ? 18 : 14,
            color: color.withAlpha(0.9),
            scaleByDistance: new Cesium.NearFarScalar(5e5, 1.5, 2e7, 0.4),
          },
          label: {
            text: sat.name,
            font: `${isStation ? "bold 12px" : "10px"} 'JetBrains Mono', monospace`,
            fillColor: color,
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 2,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            pixelOffset: new Cesium.Cartesian2(0, -16),
            verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
            showBackground: true,
            backgroundColor: Cesium.Color.BLACK.withAlpha(0.65),
            backgroundPadding: new Cesium.Cartesian2(4, 2),
            scaleByDistance: new Cesium.NearFarScalar(5e5, 1.0, 1e7, 0.0),
            distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 2e7),
          },
          description: [
            sat.name,
            `Orbit: ${sat.orbit}  Alt: ${Math.round(sat.coords[2])}km`,
            `Vel: ${Math.round(sat.velocity * 1000)} m/s`,
            `Type: ${sat.purpose}`,
            sat.noradId ? `NORAD: ${sat.noradId}` : null,
          ]
            .filter(Boolean)
            .join("\n"),
          properties: { type: "sat-notable", ...sat },
        });

        // Ground track — project sub-satellite point trail
        if (satJs && sat.tle1 && sat.tle2) {
          try {
            const satrec = satJs.twoline2satrec(sat.tle1, sat.tle2);
            const trackPts: any[] = [];
            // 90-minute orbit, sample every 2 min = 45 points
            for (let m = -90; m <= 90; m += 2) {
              const t = new Date(now.getTime() + m * 60000);
              try {
                const pos = satJs.propagate(satrec, t);
                if (pos.position) {
                  const gd = satJs.eciToGeodetic(pos.position, satJs.gstime(t));
                  trackPts.push(satJs.degreesLong(gd.longitude), satJs.degreesLat(gd.latitude));
                }
              } catch {
                /* skip bad propagation */
              }
            }
            if (trackPts.length >= 4) {
              viewer.entities.add({
                id: `sat-track-${sat.noradId || sat.name}`,
                polyline: {
                  positions: Cesium.Cartesian3.fromDegreesArrayHeight(
                    trackPts,
                    trackPts.map(() => 500),
                  ),
                  width: 1.5,
                  material: new Cesium.PolylineGlowMaterialProperty({
                    glowPower: 0.15,
                    color: color.withAlpha(0.35),
                  }),
                  clampToGround: true,
                },
                properties: { type: "sat-ground-track", name: sat.name },
              });
            }
          } catch {
            /* skip track for this sat */
          }
        }
      }

      // ─── Refresh interval ───
      const iv = setInterval(async () => {
        if (!stateLayers.satellites) return;
        try {
          const t = await fetchCelestrak();
          if (!Array.isArray(t)) return;
          const sj = (window as any).satellite;
          const n = new Date();
          const updated = t
            .slice(0, 1500)
            .filter((x: any) => x.TLE_LINE1 && x.TLE_LINE2)
            .map((x: any) => {
              let c: [number, number, number] | null = null;
              let v = 0;
              if (sj) {
                try {
                  const sr = sj.twoline2satrec(x.TLE_LINE1, x.TLE_LINE2);
                  const p = sj.propagate(sr, n);
                  if (p.position) {
                    const g = sj.eciToGeodetic(p.position, sj.gstime(n));
                    c = [sj.degreesLong(g.longitude), sj.degreesLat(g.latitude), g.height];
                    if (p.velocity) v = Math.sqrt(p.velocity.x ** 2 + p.velocity.y ** 2 + p.velocity.z ** 2);
                  }
                } catch {
                  /* skip */
                }
              }
              const name = x.NAME || x.OBJECT_NAME || "";
              return {
                tle1: x.TLE_LINE1,
                tle2: x.TLE_LINE2,
                name,
                coords: c,
                velocity: v,
                purpose: classifySatellite(name),
                orbit: c ? classifyOrbit(c[2]) : "Unknown",
                noradId: x.NORAD_CAT_ID,
              };
            })
            .filter((f: any) => f.coords);
          satDataRef.current = updated;

          // Update point positions
          const pts = entitiesRef.current["sat-points"] as any;
          if (pts) {
            const count = Math.min(updated.length, pts.length);
            for (let i = 0; i < count; i++) {
              const f = updated[i];
              if (!f.coords) continue;
              pts.get(i).position = Cesium.Cartesian3.fromDegrees(
                f.coords[0],
                f.coords[1],
                Math.max(f.coords[2] * 1000, 160_000),
              );
            }
          }

          // Update notable satellite positions
          const newNotable = updated.filter((f: any) => notablePatterns.some((p) => p.test(f.name)));
          for (const sat of newNotable.slice(0, 50)) {
            const entity = viewer.entities.getById(`sat-notable-${sat.noradId || sat.name}`);
            if (entity && sat.coords) {
              entity.position = Cesium.Cartesian3.fromDegrees(
                sat.coords[0],
                sat.coords[1],
                Math.max(sat.coords[2] * 1000, 160_000),
              );
            }
          }

          updateStatus("satellites", { lastUpdate: Date.now(), count: updated.length, error: null });
          retry.recordSuccess();
        } catch {
          retry.recordFailure();
          updateStatus("satellites", {
            error: retry.shouldRetry ? `Retrying (${retry.failureCount}/5)...` : "Satellite data unavailable",
          });
        }
      }, 300000);
      intervalsRef.current.push(iv);
    } catch {
      updateStatus("satellites", { error: "fetch failed" });
    }
  };

  doLoad();
}
