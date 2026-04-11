import type { DataStatus } from "../types";

const AQI_ICON = `<svg viewBox="0 0 24 24" width="20" height="20"><circle cx="12" cy="12" r="9" fill="none" stroke="#888" stroke-width="1.5"/><path d="M8 10a4 4 0 018 0" fill="none" stroke="#aaa" stroke-width="1" opacity="0.6"/><circle cx="10" cy="10" r="1.5" fill="#888" opacity="0.5"/><circle cx="14" cy="10" r="1.5" fill="#888" opacity="0.5"/><path d="M8 15h8" stroke="#888" stroke-width="1" stroke-linecap="round"/></svg>`;

function aqiColor(aqi: number): string {
  if (aqi <= 50) return "#00e400";
  if (aqi <= 100) return "#ffff00";
  if (aqi <= 150) return "#ff7e00";
  if (aqi <= 200) return "#ff0000";
  if (aqi <= 300) return "#8f3f97";
  return "#7e0023";
}

function aqiLabel(aqi: number): string {
  if (aqi <= 50) return "Good";
  if (aqi <= 100) return "Moderate";
  if (aqi <= 150) return "Unhealthy (Sensitive)";
  if (aqi <= 200) return "Unhealthy";
  if (aqi <= 300) return "Very Unhealthy";
  return "Hazardous";
}

export function loadAirQuality(
  viewer: any,
  Cesium: any,
  updateStatus: (key: string, u: Partial<DataStatus>) => void,
  removeEntities: (prefix: string) => void,
  intervalsRef: React.MutableRefObject<ReturnType<typeof setInterval>[]>,
  stateLayers: { airQuality: boolean },
) {
  updateStatus("airQuality", { error: null });

  const doLoad = async () => {
    try {
      // Sample major cities globally
      const cities = [
        { name: "New York", lat: 40.71, lon: -74.01 },
        { name: "London", lat: 51.51, lon: -0.13 },
        { name: "Beijing", lat: 39.9, lon: 116.4 },
        { name: "Delhi", lat: 28.61, lon: 77.21 },
        { name: "Tokyo", lat: 35.68, lon: 139.69 },
        { name: "São Paulo", lat: -23.55, lon: -46.63 },
        { name: "Cairo", lat: 30.04, lon: 31.24 },
        { name: "Moscow", lat: 55.76, lon: 37.62 },
        { name: "Lagos", lat: 6.52, lon: 3.38 },
        { name: "Sydney", lat: -33.87, lon: 151.21 },
        { name: "Los Angeles", lat: 34.05, lon: -118.24 },
        { name: "Paris", lat: 48.86, lon: 2.35 },
        { name: "Mexico City", lat: 19.43, lon: -99.13 },
        { name: "Jakarta", lat: -6.21, lon: 106.85 },
        { name: "Bangkok", lat: 13.76, lon: 100.5 },
        { name: "Istanbul", lat: 41.01, lon: 28.98 },
        { name: "Dubai", lat: 25.2, lon: 55.27 },
        { name: "Singapore", lat: 1.35, lon: 103.82 },
        { name: "Mumbai", lat: 19.08, lon: 72.88 },
        { name: "Lima", lat: -12.05, lon: -77.04 },
      ];

      let loaded = 0;
      for (const city of cities) {
        try {
          const url = `/api/proxy/https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${city.lat}&longitude=${city.lon}&current=us_aqi,pm10,pm2_5,nitrogen_dioxide,ozone`;
          const r = await fetch(url);
          const data = await r.json();
          const current = data.current;
          if (!current) continue;

          const aqi = current.us_aqi ?? 0;
          const pm25 = current.pm2_5;
          const pm10 = current.pm10;
          const no2 = current.nitrogen_dioxide;
          const o3 = current.ozone;
          const color = aqiColor(aqi);
          const label = aqiLabel(aqi);

          if (!Cesium || !viewer) break;

          viewer.entities.add({
            id: `aq-${city.name}`,
            name: `${city.name}: AQI ${aqi} (${label})`,
            position: Cesium.Cartesian3.fromDegrees(city.lon, city.lat, 0),
            billboard: {
              image: AQI_ICON,
              width: 20,
              height: 20,
              scaleByDistance: new Cesium.NearFarScalar(5e5, 1.5, 2e7, 0.4),
            },
            point: {
              pixelSize: 6,
              color: Cesium.Color.fromCssColorString(color),
              outlineColor: Cesium.Color.WHITE.withAlpha(0.4),
              outlineWidth: 1,
            },
            label: {
              text: `AQI ${aqi}`,
              font: "bold 10px 'JetBrains Mono', monospace",
              fillColor: Cesium.Color.fromCssColorString(color),
              outlineColor: Cesium.Color.BLACK,
              outlineWidth: 2,
              style: Cesium.LabelStyle.FILL_AND_OUTLINE,
              pixelOffset: new Cesium.Cartesian2(14, -8),
              verticalOrigin: Cesium.VerticalOrigin.CENTER,
              showBackground: true,
              backgroundColor: Cesium.Color.BLACK.withAlpha(0.65),
              backgroundPadding: new Cesium.Cartesian2(4, 2),
              scaleByDistance: new Cesium.NearFarScalar(5e5, 1.0, 5e6, 0.0),
              distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 5e6),
            },
            description: [
              `${city.name} — Air Quality`,
              `AQI: ${aqi} (${label})`,
              pm25 != null ? `PM2.5: ${pm25.toFixed(1)} µg/m³` : null,
              pm10 != null ? `PM10: ${pm10.toFixed(1)} µg/m³` : null,
              no2 != null ? `NO₂: ${no2.toFixed(1)} µg/m³` : null,
              o3 != null ? `O₃: ${o3.toFixed(1)} µg/m³` : null,
              `Source: Open-Meteo Air Quality API`,
            ]
              .filter(Boolean)
              .join("\n"),
            properties: { type: "air-quality", aqi, city: city.name },
          });
          loaded++;
        } catch {
          /* skip city */
        }
      }

      updateStatus("airQuality", { lastUpdate: Date.now(), count: loaded });

      const iv = setInterval(async () => {
        if (!stateLayers.airQuality) return;
        removeEntities("aq-");
        doLoad();
      }, 1800000); // 30 min
      intervalsRef.current.push(iv);
    } catch {
      updateStatus("airQuality", { error: "fetch failed" });
    }
  };

  doLoad();
}
