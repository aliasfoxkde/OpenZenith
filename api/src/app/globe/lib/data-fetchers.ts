export async function fetchEarthquakes(): Promise<any> {
  const r = await fetch("https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson");
  return r.json();
}

export async function fetchRainViewer(): Promise<any> {
  const r = await fetch("https://api.rainviewer.com/public/weather-maps.json");
  return r.json();
}

export async function fetchEONET(): Promise<any> {
  const r = await fetch("https://eonet.gsfc.nasa.gov/api/v3/events/geojson?status=open&limit=200");
  return r.json();
}

export async function fetchFlights(): Promise<any> {
  const r = await fetch("/api/flights");
  return r.json();
}

export async function fetchMilitaryFlights(): Promise<any> {
  try {
    const r = await fetch("https://adsbexchange.com/api/aircraft/v2/lat/30/lon/-90/dist/500");
    if (!r.ok) return { ac: [] };
    return r.json();
  } catch {
    return { ac: [] };
  }
}

export async function fetchVessels(): Promise<any> {
  try {
    const r = await fetch("https://marine-api.open-meteo.com/v1/marine?latitude=40&longitude=-74&current=wave_height");
    return r.json();
  } catch {
    return {};
  }
}

export async function fetchWarnings(): Promise<any> {
  const r = await fetch("/api/weather/warnings");
  return r.json();
}

export async function fetchCelestrak(): Promise<any> {
  const r = await fetch("https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=json");
  return r.json();
}

export async function fetchHurricaneTracks(): Promise<any> {
  const r = await fetch(
    "https://www.ncei.noaa.gov/data/international-best-track-archive-for-climate-stewardship-ibtracs/v04r01/access/csv/ibtracs.last3years.list.v04r01.csv"
  );
  return r.text();
}
