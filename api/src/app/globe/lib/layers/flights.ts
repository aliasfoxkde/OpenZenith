import type { DataStatus } from "../types";
import { ICONS } from "../constants";
import { fetchFlights } from "../data-fetchers";

export function loadFlights(
  viewer: any, Cesium: any,
  updateStatus: (key: string, u: Partial<DataStatus>) => void,
  removeEntities: (prefix: string) => void,
  intervalsRef: React.MutableRefObject<ReturnType<typeof setInterval>[]>,
  stateLayers: { flights: boolean },
) {
  updateStatus("flights", { error: null });

  const addFlightEntity = (s: any[], i: number) => {
    const callsign = (s[1] || "").trim();
    const alt = s[7] || 0;
    const spd = s[9] || 0;
    const hdg = s[10] || 0;
    const color = alt > 10000 ? Cesium.Color.RED : alt > 5000 ? Cesium.Color.ORANGE : Cesium.Color.LIME;

    viewer.entities.add({
      id: `flight-${i}`,
      name: callsign || "N/A",
      position: Cesium.Cartesian3.fromDegrees(s[5], s[6], alt),
      billboard: {
        image: ICONS.flight,
        width: 20,
        height: 20,
        rotation: Cesium.Math.toRadians(-hdg),
        alignedAxis: Cesium.Cartesian3.UNIT_Z,
        color: color.withAlpha(0.9),
        scaleByDistance: new Cesium.NearFarScalar(1e5, 1.5, 2e6, 0.4),
      },
      label: callsign ? {
        text: callsign, font: "10px sans-serif", fillColor: Cesium.Color.WHITE.withAlpha(0.8),
        outlineColor: Cesium.Color.BLACK, style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cesium.Cartesian2(10, -8), verticalOrigin: Cesium.VerticalOrigin.CENTER,
        showBackground: true, backgroundColor: Cesium.Color.BLACK.withAlpha(0.5),
        backgroundPadding: new Cesium.Cartesian2(3, 2),
        scaleByDistance: new Cesium.NearFarScalar(1e5, 1.0, 5e5, 0.0),
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 500000),
      } : undefined,
      properties: { type: "flight", callsign, altitude: alt, speed: spd, heading: hdg, country: s[2] },
    });

    if (spd > 100 && hdg > 0) {
      const vecLen = Math.min(spd * 0.15, 8000);
      const hdgRad = Cesium.Math.toRadians(hdg);
      const dLat = vecLen * Math.cos(hdgRad) / 111320;
      const dLon = vecLen * Math.sin(hdgRad) / (111320 * Math.cos(Cesium.Math.toRadians(s[6])));
      viewer.entities.add({
        id: `flight-vec-${i}`,
        position: Cesium.Cartesian3.fromDegrees(s[5], s[6], alt),
        polyline: {
          positions: Cesium.Cartesian3.fromDegreesArray([s[5], s[6], s[5] + dLon, s[6] + dLat], alt, alt),
          width: 1.5,
          material: color.withAlpha(0.4),
          clampToGround: false,
        },
        properties: { type: "flight-vec" },
      });
    }
  };

  const doLoad = async () => {
    try {
      const data = await fetchFlights();
      if (!Cesium || !viewer || !data.states) return;
      const states = data.states.filter((s: any[]) => s[5] != null && s[6] != null);
      updateStatus("flights", { lastUpdate: Date.now(), count: states.length });
      states.forEach((s: any[], i: number) => addFlightEntity(s, i));

      const iv = setInterval(async () => {
        if (!stateLayers.flights) return;
        try {
          const d = await fetchFlights();
          if (d.states) {
            removeEntities("flight-");
            d.states.filter((s: any[]) => s[5] != null && s[6] != null).forEach((s: any[], i: number) => addFlightEntity(s, i));
            updateStatus("flights", { lastUpdate: Date.now(), count: d.states.filter((s: any[]) => s[5] != null).length });
          }
        } catch { /* retry */ }
      }, 15000);
      intervalsRef.current.push(iv);
    } catch { updateStatus("flights", { error: "fetch failed" }); }
  };

  doLoad();
}
