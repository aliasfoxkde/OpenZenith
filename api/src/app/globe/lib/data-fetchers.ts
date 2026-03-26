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

export async function fetchFlights(bbox?: { lamin: number; lamax: number; lomin: number; lomax: number }): Promise<any> {
  const params = bbox
    ? `?lamin=${bbox.lamin}&lamax=${bbox.lamax}&lomin=${bbox.lomin}&lomax=${bbox.lomax}`
    : "";
  const r = await fetch(`/api/opensky/flights${params}`);
  return r.json();
}

export async function fetchFlightsAnonymous(): Promise<any> {
  const r = await fetch("/api/flights");
  return r.json();
}

export async function fetchMilitaryFlights(lat = 30, lon = -90, dist = 500): Promise<any> {
  try {
    const r = await fetch(`/api/military?lat=${lat}&lon=${lon}&dist=${dist}`);
    return r.json();
  } catch {
    return { ac: [] };
  }
}

export async function fetchVessels(): Promise<any> {
  try {
    const r = await fetch("/api/vessels");
    return r.json();
  } catch {
    return { error: "Failed to fetch vessel config" };
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
