/* eslint-disable @typescript-eslint/no-explicit-any */
import type { DataStatus } from "../types";

export function loadOrbitalTracks(
  viewer: any,
  Cesium: any,
  updateStatus: (key: string, u: Partial<DataStatus>) => void,
) {
  const satJs = (window as any).satellite;
  if (!Cesium || !viewer || !satJs) return;
  updateStatus("satellites", { error: null });

  const groups = [
    { name: "ISS", catnr: 25544 },
    { name: "Hubble", catnr: 20580 },
    { name: "Tiangong", catnr: 48274 },
    { name: "GPS Ops", url: "/api/proxy/https://celestrak.org/NORAD/elements/gp.php?GROUP=gps-ops&FORMAT=json" },
    { name: "Starlink", url: "/api/proxy/https://celestrak.org/NORAD/elements/gp.php?GROUP=starlink&FORMAT=json" },
  ];

  const now = Date.now();
  let trackCount = 0;

  const loadGroup = async (group: (typeof groups)[0]) => {
    let tles: any[] = [];
    if (group.url) {
      try {
        const r = await fetch(group.url);
        tles = (await r.json()).slice(0, 20);
      } catch {
        return;
      }
    } else if (group.catnr) {
      try {
        const r = await fetch(
          `/api/proxy/https://celestrak.org/NORAD/elements/gp.php?CATNR=${group.catnr}&FORMAT=json`,
        );
        const data = await r.json();
        if (Array.isArray(data)) tles = data;
      } catch {
        return;
      }
    }

    for (const tle of tles) {
      if (!tle.TLE_LINE1 || !tle.TLE_LINE2) continue;
      try {
        const satrec = satJs.twoline2satrec(tle.TLE_LINE1, tle.TLE_LINE2);
        const positionProperty = new Cesium.SampledPositionProperty();
        positionProperty.setInterpolationOptions({
          interpolationDegree: 5,
          interpolationAlgorithm: Cesium.LagrangePolynomialApproximation,
        });

        for (let i = -90; i <= 90; i++) {
          const date = new Date(now + i * 120000);
          const posVel = satJs.propagate(satrec, date);
          if (!posVel.position) continue;
          const gmst = satJs.gstime(date);
          const ecf = satJs.eciToEcf(posVel.position, gmst);
          positionProperty.addSample(
            Cesium.JulianDate.fromDate(date),
            new Cesium.Cartesian3(ecf.x * 1000, ecf.y * 1000, ecf.z * 1000),
          );
        }

        const isISS = group.name === "ISS";
        const isNotable = group.name === "Hubble" || group.name === "Tiangong";
        const trackColor =
          group.name === "Starlink"
            ? Cesium.Color.CYAN.withAlpha(0.15)
            : group.name === "GPS Ops"
              ? Cesium.Color.YELLOW.withAlpha(0.3)
              : Cesium.Color.CYAN.withAlpha(0.5);

        viewer.entities.add({
          id: `orbit-${trackCount}`,
          position: positionProperty,
          point: {
            pixelSize: isISS ? 8 : isNotable ? 6 : 3,
            color: isISS
              ? Cesium.Color.WHITE
              : group.name === "Starlink"
                ? Cesium.Color.CYAN.withAlpha(0.3)
                : trackColor,
            outlineColor: Cesium.Color.WHITE.withAlpha(isISS ? 0.8 : 0.2),
            outlineWidth: isISS ? 2 : 1,
            scaleByDistance: new Cesium.NearFarScalar(1e6, 2.0, 5e7, 0.5),
          },
          label:
            isISS || isNotable
              ? {
                  text: `${group.name} (NORAD ${tle.NORAD_CAT_ID || group.catnr})`,
                  font: "bold 11px 'JetBrains Mono', monospace",
                  fillColor: Cesium.Color.WHITE.withAlpha(0.9),
                  outlineColor: Cesium.Color.BLACK,
                  outlineWidth: 2,
                  style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                  pixelOffset: new Cesium.Cartesian2(12, -8),
                  showBackground: true,
                  backgroundColor: Cesium.Color.BLACK.withAlpha(0.6),
                  backgroundPadding: new Cesium.Cartesian2(4, 3),
                  scaleByDistance: new Cesium.NearFarScalar(1e6, 1.0, 2e7, 0.4),
                  distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 30000000),
                }
              : undefined,
          path: {
            resolution: 120,
            material: new Cesium.PolylineGlowMaterialProperty({ glowPower: isISS ? 0.25 : 0.15, color: trackColor }),
            width: isISS ? 2.5 : group.name === "Starlink" ? 0.5 : 1.5,
            leadTime: 5400,
            trailTime: 5400,
            distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 40000000),
          },
          properties: { type: "orbitalTrack", group: group.name },
        });
        trackCount++;
      } catch {
        /* skip bad TLE */
      }
    }
  };

  Promise.all(groups.map(loadGroup))
    .then(() => {
      updateStatus("satellites", { lastUpdate: Date.now(), count: trackCount });
    })
    .catch(() => {
      updateStatus("satellites", { error: "orbital tracks failed" });
    });
}
