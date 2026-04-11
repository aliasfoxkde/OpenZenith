/**
 * Air quality API endpoint.
 *
 * Returns current air quality data as GeoJSON point features
 * from the Open-Meteo Air Quality API.
 */

export const runtime = "edge";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const lat = parseFloat(url.searchParams.get("lat") || "40.7");
  const lon = parseFloat(url.searchParams.get("lon") || "-74.0");
  try {
    // Open-Meteo Air Quality API
    const aqUrl = new URL("https://air-quality-api.open-meteo.com/v1/air-quality");
    aqUrl.searchParams.set("latitude", lat.toString());
    aqUrl.searchParams.set("longitude", lon.toString());
    aqUrl.searchParams.set("current", "pm10,pm2_5,carbon_monoxide,nitrogen_dioxide,sulphur_dioxide,ozone,us_aqi");
    aqUrl.searchParams.set("timezone", "auto");

    const res = await fetch(aqUrl.toString());
    if (!res.ok) {
      return Response.json({ error: "Failed to fetch air quality data" }, { status: 502 });
    }

    const data = await res.json();
    const current = data.current;
    if (!current) {
      return Response.json({ type: "FeatureCollection", features: [] });
    }

    const feature: GeoJSON.Feature = {
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [lon, lat],
      },
      properties: {
        pm2_5: current.pm2_5,
        pm10: current.pm10,
        co: current.carbon_monoxide,
        no2: current.nitrogen_dioxide,
        so2: current.sulphur_dioxide,
        o3: current.ozone,
        us_aqi: current.us_aqi,
        time: current.time,
        aqi_level: getAqiLevel(current.us_aqi || 0),
      },
    };

    return Response.json({ type: "FeatureCollection", features: [feature] });
  } catch {
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

function getAqiLevel(aqi: number): string {
  if (aqi <= 50) return "Good";
  if (aqi <= 100) return "Moderate";
  if (aqi <= 150) return "Unhealthy for Sensitive Groups";
  if (aqi <= 200) return "Unhealthy";
  if (aqi <= 300) return "Very Unhealthy";
  return "Hazardous";
}
