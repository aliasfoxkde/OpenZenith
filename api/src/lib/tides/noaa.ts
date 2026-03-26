/**
 * NOAA Tides and Currents data fetcher.
 *
 * Uses the free NOAA Tides and Currents API.
 * US coastal locations only — finds the nearest tide station.
 *
 * API docs: https://api.tidesandcurrents.noaa.gov/api/prod/
 */

interface TidePrediction {
  time: string;
  type: "H" | "L";
  height: number;
  typeLabel: "High" | "Low";
}

interface TideStation {
  id: string;
  name: string;
  lat: number;
  lon: number;
  distance: number;
  distanceUnit: string;
}

export interface TideData {
  station: TideStation;
  predictions: TidePrediction[];
  source: string;
}

/**
 * Calculate distance between two coordinates in nautical miles.
 */
function distanceNm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3440.065; // Earth radius in nautical miles
  const toRad = (d: number) => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Find the nearest tide station to a given coordinate.
 * Uses NOAA station metadata API.
 */
async function findNearestStation(lat: number, lon: number): Promise<TideStation | null> {
  try {
    const url = "https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations.json?type=tidestations";
    const res = await fetch(url, {
      headers: { "User-Agent": "OpenZenith/1.0 (geospatial platform)" },
    });
    if (!res.ok) return null;

    const data = await res.json();
    const stations = data.stations;
    if (!Array.isArray(stations)) return null;

    let nearest: { id: string; name: string; lat: number; lon: number; dist: number } | null = null;

    for (const s of stations) {
      if (!s.lat || !s.lng) continue;
      const sLat = parseFloat(s.lat);
      const sLon = parseFloat(s.lng);
      if (isNaN(sLat) || isNaN(sLon)) continue;

      const dist = distanceNm(lat, lon, sLat, sLon);
      if (!nearest || dist < nearest.dist) {
        nearest = { id: s.id, name: s.name, lat: sLat, lon: sLon, dist };
      }
    }

    if (!nearest) return null;

    return {
      id: nearest.id,
      name: nearest.name,
      lat: nearest.lat,
      lon: nearest.lon,
      distance: Math.round(nearest.dist * 10) / 10,
      distanceUnit: "nm",
    };
  } catch {
    return null;
  }
}

/**
 * Fetch tide predictions for a station.
 */
async function fetchPredictions(
  stationId: string,
  startDate: string,
  endDate: string,
): Promise<TidePrediction[]> {
  const params = new URLSearchParams({
    product: "predictions",
    application: "NOS.COOPS.TAC.WL",
    begin_date: startDate,
    end_date: endDate,
    datum: "MLLW",
    time_zone: "lst_ldt",
    units: "english",
    interval: "hilo",
    format: "json",
  });

  const url = `https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?${params}`;
  const res = await fetch(url, {
    headers: { "User-Agent": "OpenZenith/1.0 (geospatial platform)" },
  });

  if (!res.ok) return [];

  const data = await res.json();
  if (!data.predictions) return [];

  return data.predictions.map((p: { t: string; v: string; type: string }) => ({
    time: p.t,
    type: p.type as "H" | "L",
    height: parseFloat(p.v),
    typeLabel: p.type === "H" ? "High" : "Low",
  }));
}

/**
 * Get tide data for a location.
 * Finds the nearest station and fetches today's + tomorrow's predictions.
 */
export async function getTides(
  lat: number,
  lon: number,
): Promise<TideData | null> {
  try {
    const station = await findNearestStation(lat, lon);
    if (!station) return null;

    // Only return if station is reasonably close (within 50nm)
    if (station.distance > 50) return null;

    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const fmt = (d: Date) => d.toISOString().split("T")[0];
    const predictions = await fetchPredictions(station.id, fmt(today), fmt(tomorrow));

    return {
      station,
      predictions,
      source: "noaa-tides",
    };
  } catch {
    return null;
  }
}
