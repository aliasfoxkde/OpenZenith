# GOALS

## Completed
- [x] Combine public datasets by coverage, resolution, and date
- [x] Add World coverage of Elevation Data (and make simple to use)
  - [x] SRTM 30m (NASA, ±60° latitude, HuggingFace chunks)
  - [x] Copernicus GLO-30 (global land, 30m, HuggingFace merged chunks)
  - [x] GEBCO 2025 (global ocean bathymetry, 450m, COG tiles)
  - [x] Auto-cascade: SRTM → Copernicus → GEBCO
- [x] Unified query API with include= filtering (`/api/query`)
  - [x] Elevation (default)
  - [x] Address (reverse geocode via Nominatim)
  - [x] Weather (current + forecast via Open-Meteo)
  - [x] Tides (NOAA, US coastal)
  - [x] Waterways (Overpass API)
- [x] Address search in hero banner (geocode + coordinate parsing)
- [x] Dynamic API documentation (`/api/docs`)
- [x] Landing page with MapLibre hero, elevation lookup, code snippets
- [x] Globe page with CesiumJS (satellites, earthquakes, flights, vessels, weather)
- [x] Map page with MapLibre GL (elevation profile, tools, widgets)
- [x] Waterways API endpoint (Overpass-based river/lake GeoJSON)
- [x] Weather warnings API (NOAA/NWS ArcGIS)
- [x] Flight tracking (OpenSky authenticated API)
- [x] Vessel tracking (AISstream.io)
- [x] Satellite tracking (Celestrak)
- [x] Earthquake visualization (USGS)
- [x] Hurricane visualization (NOAA/NHC)
- [x] Widget system (layers, tools, basemaps, settings)

## Tasks:
- [ ] Add riverway data for use with flood data, flow, etc.
- [ ] Elevation profile underwater support (GEBCO depth shading)
- [ ] PWA Support, caching and Manifest.json file
- [ ] Build and deploy pipeline optimization

## Planning
- [ ] Integrate Self-Hosted OSM and Overpass Turbo servers and data
- [ ] Create an interactive "Eagle Eye" map, using all available sources
- [ ] Create Interactive Mapping Tools:
  - [ ] Elevation Mapping Tools
  - [ ] Trajectory Mapping Tools
  - [ ] Oil Spill Simulation Tools
  - [ ] Hurricane Mapping Tools
- [ ] Create Widgets
  - [ ] Trace Downstream
- [ ] NOAA Monitoring Notification Service with free signup
  - [ ] Include options such as region of interest, ability to opt-in/out/customize, etc.
  - [ ] Make options both drop down and interactive on the map and maybe even customizable

## Research
- [ ] OSM Available Data
  - [ ] Streets, Waterways, Traffic, etc.
- [ ] Public data sources to use
  - [ ] OSM, ESRI, Marine Traffic, Air Traffic, Vehicle Traffic,
        Population Density, Traffic Cameras, Public Video Feeds, etc.
  - [ ] Symbolize and show Realtime Hurricane Data, Fire tracking, water sources, etc.
  - [ ] Show flow simulation of currents, etc.

## Other/Future
- [ ] Add disclaimer "This Application was Developed with TaskWizer AI technologies."
- [ ] Add link to portfolio website with about, projects, etc.
- [ ] Integrate solar system, satellite tracking, space crafts, and orbital systems into the "Globe" app
  - Examples: https://eyes.nasa.gov/apps/orrery, https://spacein3d.com/universe-sandbox,
              https://www.solarsystemscope.com, https://www.webglearth.com
- [ ] Add Donation buttons with goals (setup custom PayPal account, etc.)
- [ ] MCP Server for AI tool integration

## Design and Styling
- [ ] Create/improve favicon and app icons
- [ ] Add map styling, symbology and etc.

## API Reference
- Full docs: `/api/docs` (dynamically generated markdown)
- Unified query: `GET /api/query?lat=X&lon=Y&include=elevation,address,weather,tides`
- All endpoints: `/api/elevation`, `/api/bathymetry`, `/api/geocode`, `/api/reverse-geocode`, `/api/weather/warnings`, `/api/waterways`, `/api/geoip`, `/api/health`
