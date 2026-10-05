import { warnLayerError } from "@/lib/diagnostics";
import type { DataStatus } from "../types";
import { ICONS } from "../constants";
import { fetchCelestrak, type TleRecord } from "../data-fetchers";
import { createRetryGuard } from "../helpers";
import { pushLayerTimer, type LayerTimersRef } from "./timers";

/** A satellite propagated to one moment — the layer's unit of data. */
export interface SatFeature {
  tle1: string;
  tle2: string;
  name: string;
  coords: [number, number, number];
  velocity: number;
  purpose: string;
  orbit: string;
  noradId: string | undefined;
}

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
function purposeColor(purpose: string, Cesium: typeof CesiumType): CesiumType.Color {
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

/**
 * Propagate one TLE to `at` and classify it. Returns null when the TLE
 * cannot be propagated (decayed or malformed) — the caller drops those,
 * matching the previous coords-then-filter flow.
 */
function toFeature(t: TleRecord, satJs: SatelliteJsApi | undefined, at: Date): SatFeature | null {
  let coords: [number, number, number] | null = null;
  let velocity = 0;
  if (satJs) {
    try {
      const satrec = satJs.twoline2satrec(t.TLE_LINE1, t.TLE_LINE2);
      const pos = satJs.propagate(satrec, at);
      if (pos.position && pos.velocity) {
        const gd = satJs.eciToGeodetic(pos.position, satJs.gstime(at));
        coords = [satJs.degreesLong(gd.longitude), satJs.degreesLat(gd.latitude), gd.height];
        velocity = Math.sqrt(pos.velocity.x ** 2 + pos.velocity.y ** 2 + pos.velocity.z ** 2);
      }
    } catch {
      /* skip unpropagatable TLEs */
    }
  }
  if (!coords) return null;
  const name = t.NAME || t.OBJECT_NAME || "";
  return {
    tle1: t.TLE_LINE1,
    tle2: t.TLE_LINE2,
    name,
    coords,
    velocity,
    purpose: classifySatellite(name),
    orbit: classifyOrbit(coords[2]),
    noradId: t.NORAD_CAT_ID,
  };
}

/** Name patterns for the labeled, tracked "notable" satellites. */
const NOTABLE_PATTERNS = [
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

/**
 * Builds the satellite layer from the CelesTrak active catalogue: the first
 * 1500 TLEs are propagated once via satellite.js into geodetic lon/lat degrees,
 * altitude in km and speed in km/s, and stored on `satDataRef.current` for the
 * pick handler. Rendering reaches the viewer three ways — translucent
 * LEO/MEO/GEO shell ellipsoids centred on the origin (ids `orbit-shell-<name>`,
 * so outside the `sat-` prefix), one point per satellite in a
 * `PointPrimitiveCollection` added to `scene.primitives` and cached as
 * `entitiesRef.current["sat-points"]` at max(altKm*1000, 160 km), and up to 50
 * name-matched notable satellites as billboards with labels, a description card
 * and a ground-track polyline sampled every 2 minutes across ±90 minutes at
 * 500 m.
 *
 * A 300000 ms (5 min) interval, registered through `pushLayerTimer`, refetches
 * the catalogue and slides the existing point primitives and notable entities
 * to their new positions; failures surface through `updateStatus("satellites")`
 * via a five-failure retry guard. Toggle-off clears entities prefixed `sat-` —
 * which also drops the point collection from `scene.primitives` — and clears
 * the interval through the shared `intervalsRef`.
 */
export function loadSatellites(
  viewer: CesiumType.Viewer | undefined,
  Cesium: typeof CesiumType | undefined,
  updateStatus: (key: string, u: Partial<DataStatus>) => void,
  removeEntities: (prefix: string) => void,
  intervalsRef: LayerTimersRef,
  entitiesRef: React.RefObject<Record<string, unknown>>,
  satDataRef: React.RefObject<SatFeature[]>,
  stateLayers: { satellites: boolean; orbitalTracks?: boolean; groundTracks?: boolean },
) {
  updateStatus("satellites", { error: null });
  const retry = createRetryGuard();

  const doLoad = async () => {
    try {
      const tles = await fetchCelestrak();
      if (!Cesium || !viewer) return;
      const satJs = window.satellite;
      const now = new Date();
      const features = tles
        .slice(0, 1500)
        .map((t) => toFeature(t, satJs, now))
        .filter((f): f is SatFeature => f !== null);
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

      features.forEach((f) => {
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
      const notableSats = features.filter((f) => NOTABLE_PATTERNS.some((p) => p.test(f.name)));

      for (const sat of notableSats.slice(0, 50)) {
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
        if (satJs) {
          try {
            const satrec = satJs.twoline2satrec(sat.tle1, sat.tle2);
            const trackPts: number[] = [];
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
      const iv = setInterval(() => {
        void (async () => {
          if (!stateLayers.satellites) return;
          try {
            const t = await fetchCelestrak();
            const sj = window.satellite;
            const n = new Date();
            const updated = t
              .slice(0, 1500)
              .map((x) => toFeature(x, sj, n))
              .filter((f): f is SatFeature => f !== null);
            satDataRef.current = updated;

            // Update point positions
            const pts = entitiesRef.current["sat-points"];
            if (pts instanceof Cesium.PointPrimitiveCollection) {
              const count = Math.min(updated.length, pts.length);
              for (let i = 0; i < count; i++) {
                const f = updated[i];
                pts.get(i).position = Cesium.Cartesian3.fromDegrees(
                  f.coords[0],
                  f.coords[1],
                  Math.max(f.coords[2] * 1000, 160_000),
                );
              }
            }

            // Update notable satellite positions
            const newNotable = updated.filter((f) => NOTABLE_PATTERNS.some((p) => p.test(f.name)));
            for (const sat of newNotable.slice(0, 50)) {
              const entity = viewer.entities.getById(`sat-notable-${sat.noradId || sat.name}`);
              if (entity) {
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
        })();
      }, 300000);
      pushLayerTimer(intervalsRef, "satellites", iv);
    } catch (err) {
      warnLayerError("satellites", err);
      updateStatus("satellites", {
        error: "fetch failed" });
    }
  };

  void doLoad();
}
