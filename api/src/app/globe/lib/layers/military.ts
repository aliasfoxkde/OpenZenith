/* eslint-disable @typescript-eslint/no-explicit-any */
import type { DataStatus } from "../types";
import { fetchMilitaryFlights } from "../data-fetchers";

interface MilitaryAircraft {
  lat?: number;
  lon?: number;
  alt_baro?: number;
  alt_geom?: number;
  call?: string;
  reg?: string;
  [key: string]: unknown;
}

export function loadMilitaryFlights(
  viewer: any,
  Cesium: any,
  updateStatus: (key: string, u: Partial<DataStatus>) => void,
  removeEntities: (prefix: string) => void,
  intervalsRef: React.MutableRefObject<ReturnType<typeof setInterval>[]>,
  stateLayers: { militaryFlights: boolean },
) {
  updateStatus("militaryFlights", { error: null });

  const doLoad = async () => {
    try {
      const data = await fetchMilitaryFlights();
      if (!Cesium || !viewer || !data.ac) {
        if (data.msg && data.msg.includes("purchase")) {
          updateStatus("militaryFlights", { error: "ADSBExchange requires API key", lastUpdate: Date.now(), count: 0 });
        }
        return;
      }
      const ac = data.ac.filter((a: MilitaryAircraft) => a.lat && a.lon);
      updateStatus("militaryFlights", { lastUpdate: Date.now(), count: ac.length });
      ac.forEach((a: MilitaryAircraft, i: number) => {
        const alt = a.alt_baro || a.alt_geom || 0;
        viewer.entities.add({
          id: `mil-${i}`,
          name: a.call || a.reg || "MIL",
          position: Cesium.Cartesian3.fromDegrees(a.lon!, a.lat!, alt),
          point: { pixelSize: 5, color: Cesium.Color.MAGENTA, outlineColor: Cesium.Color.WHITE.withAlpha(0.3) },
          label: {
            text: a.call || "",
            font: "bold 10px monospace",
            fillColor: Cesium.Color.MAGENTA,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            pixelOffset: new Cesium.Cartesian2(8, -8),
            showBackground: true,
            backgroundColor: Cesium.Color.BLACK.withAlpha(0.6),
            backgroundPadding: new Cesium.Cartesian2(3, 2),
          },
          properties: { type: "military", ...a },
        });
      });

      const iv = setInterval(async () => {
        if (!stateLayers.militaryFlights) return;
        try {
          const d = await fetchMilitaryFlights();
          if (d.ac) {
            removeEntities("mil-");
            d.ac
              .filter((a: MilitaryAircraft) => a.lat && a.lon)
              .forEach((a: MilitaryAircraft, i: number) => {
                viewer.entities.add({
                  id: `mil-${i}`,
                  position: Cesium.Cartesian3.fromDegrees(a.lon!, a.lat!, a.alt_baro || 0),
                  point: { pixelSize: 5, color: Cesium.Color.MAGENTA },
                  label: {
                    text: a.call || "",
                    font: "bold 10px monospace",
                    fillColor: Cesium.Color.MAGENTA,
                    style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                    pixelOffset: new Cesium.Cartesian2(8, -8),
                    showBackground: true,
                    backgroundColor: Cesium.Color.BLACK.withAlpha(0.6),
                    backgroundPadding: new Cesium.Cartesian2(3, 2),
                  },
                });
              });
            updateStatus("militaryFlights", {
              lastUpdate: Date.now(),
              count: d.ac.filter((a: MilitaryAircraft) => a.lat && a.lon).length,
            });
          }
        } catch {
          /* retry */
        }
      }, 30000);
      intervalsRef.current.push(iv);
    } catch {
      updateStatus("militaryFlights", { error: "fetch failed" });
    }
  };

  doLoad();
}
