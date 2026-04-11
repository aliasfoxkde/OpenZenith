import type { DataStatus } from "../types";

const WAVE_ICON = `<svg viewBox="0 0 24 24" width="20" height="20"><path d="M2 14c2-2 4-2 6 0s4 2 6 0 4-2 6 0" fill="none" stroke="#00aaff" stroke-width="1.5" stroke-linecap="round"/><path d="M2 18c2-2 4-2 6 0s4 2 6 0 4-2 6 0" fill="none" stroke="#0088dd" stroke-width="1.5" stroke-linecap="round" opacity="0.7"/></svg>`;

function waveColor(height: number): string {
  if (height >= 6) return "#ff0000";
  if (height >= 4) return "#ff8800";
  if (height >= 2) return "#ffcc00";
  if (height >= 1) return "#00cc44";
  return "#00aaff";
}

export function loadMarineWeather(
  viewer: any,
  Cesium: any,
  updateStatus: (key: string, u: Partial<DataStatus>) => void,
  removeEntities: (prefix: string) => void,
  intervalsRef: React.MutableRefObject<ReturnType<typeof setInterval>[]>,
  stateLayers: { marineWeather: boolean },
) {
  updateStatus("marineWeather", { error: null });

  const doLoad = async () => {
    try {
      // Sample ocean grid points
      const points = [];
      for (let lat = -60; lat <= 60; lat += 20) {
        for (let lon = -180; lon < 180; lon += 30) {
          points.push({ lat, lon });
        }
      }

      let count = 0;
      for (const pt of points) {
        try {
          const url = `/api/proxy/https://marine-api.open-meteo.com/v1/marine?latitude=${pt.lat}&longitude=${pt.lon}&current=wave_height,wind_wave_height,wind_wave_direction,sea_surface_temperature`;
          const r = await fetch(url);
          const data = await r.json();
          const current = data.current;
          if (!current || current.wave_height == null) continue;
          if (!Cesium || !viewer) break;

          const waveH = current.wave_height;
          const sst = current.sea_surface_temperature;
          const colorStr = waveColor(waveH);
          const c = Cesium.Color.fromCssColorString(colorStr);

          viewer.entities.add({
            id: `marine-${pt.lat}-${pt.lon}`,
            position: Cesium.Cartesian3.fromDegrees(pt.lon, pt.lat, 0),
            billboard: {
              image: WAVE_ICON,
              width: 16,
              height: 16,
              scaleByDistance: new Cesium.NearFarScalar(1e6, 1.2, 3e7, 0.3),
            },
            point: {
              pixelSize: 4,
              color: c,
              outlineColor: Cesium.Color.WHITE.withAlpha(0.3),
              outlineWidth: 1,
            },
            label: {
              text: `${waveH.toFixed(1)}m`,
              font: "8px 'JetBrains Mono', monospace",
              fillColor: c.withAlpha(0.8),
              outlineColor: Cesium.Color.BLACK,
              outlineWidth: 2,
              style: Cesium.LabelStyle.FILL_AND_OUTLINE,
              pixelOffset: new Cesium.Cartesian2(10, -6),
              verticalOrigin: Cesium.VerticalOrigin.CENTER,
              showBackground: true,
              backgroundColor: Cesium.Color.BLACK.withAlpha(0.6),
              backgroundPadding: new Cesium.Cartesian2(3, 1),
              scaleByDistance: new Cesium.NearFarScalar(1e6, 1.0, 3e7, 0.0),
              distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 3e7),
            },
            description: [
              `Marine Weather — ${pt.lat.toFixed(0)}°N, ${pt.lon.toFixed(0)}°E`,
              `Wave Height: ${waveH.toFixed(1)}m`,
              current.wind_wave_height != null ? `Wind Wave: ${current.wind_wave_height.toFixed(1)}m` : null,
              current.wind_wave_direction != null ? `Wave Dir: ${current.wind_wave_direction.toFixed(0)}°` : null,
              sst != null ? `SST: ${sst.toFixed(1)}°C` : null,
              `Source: Open-Meteo Marine API`,
            ]
              .filter(Boolean)
              .join("\n"),
            properties: { type: "marine", waveHeight: waveH },
          });
          count++;
        } catch {
          /* skip point */
        }
      }

      updateStatus("marineWeather", { lastUpdate: Date.now(), count });

      const iv = setInterval(async () => {
        if (!stateLayers.marineWeather) return;
        removeEntities("marine-");
        doLoad();
      }, 3600000); // 1 hour
      intervalsRef.current.push(iv);
    } catch {
      updateStatus("marineWeather", { error: "fetch failed" });
    }
  };

  doLoad();
}
