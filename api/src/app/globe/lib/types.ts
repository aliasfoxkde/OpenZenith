export interface LayerState {
  earthquakes: boolean;
  radar: boolean;
  satellite: boolean;
  flights: boolean;
  militaryFlights: boolean;
  vessels: boolean;
  warnings: boolean;
  events: boolean;
  satellites: boolean;
  hillshade: boolean;
  elevationColor: boolean;
  hurricaneTracks: boolean;
  blueMarble: boolean;
  nightLights: boolean;
  nlnogNodes: boolean;
  flightArcs: boolean;
  orbitalTracks: boolean;
  groundTracks: boolean;
}

export interface DashboardState {
  center: [number, number];
  zoom: number;
  basemap: string;
  layers: LayerState;
  theme: string;
  viewMode: "3d" | "2d" | "columbus";
}

export interface DataStatus {
  key: string;
  label: string;
  lastUpdate: number | null;
  count: number;
  error: string | null;
}
