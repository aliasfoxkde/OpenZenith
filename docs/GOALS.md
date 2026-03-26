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
  - [x] Space scene with 3200 procedural stars and planet markers (Moon, Sun)
  - [x] Orbital tracks and ground track projections
  - [x] Dynamic atmosphere fading based on camera altitude
  - [x] LOD system for zoom-based layer visibility
- [x] Map page with MapLibre GL (elevation profile, tools, widgets)
  - [x] Shared layer registry with category-driven sidebar toggles
  - [x] 2D data layers (earthquakes, warnings, radar, waterways, hurricanes, NLNOG, natural events)
- [x] Widget system (layers, tools, basemaps, settings)
- [x] Measurement tools (distance, area)
- [x] Elevation profile with underwater support (GEBCO depth shading)
- [x] Server-side cache layer (Cache API with TTL per data source)
- [x] Flight tracking (OpenSky authenticated API, credit budget tracker)
- [x] Vessel tracking (AISstream.io WebSocket)
- [x] Satellite tracking (Celestrak)
- [x] Earthquake visualization (USGS, pulsing depth colors)
- [x] Hurricane visualization (NOAA/NHC, spiral wind rings)
- [x] Waterways API endpoint (Overpass-based river/lake GeoJSON)
- [x] Weather warnings API (NOAA/NWS ArcGIS, severity-colored polygons)
- [x] MCP Server for AI tool integration
- [x] Annotation tools (markers, lines, polygons, text, GeoJSON export)
- [x] Bookmarks with localStorage persistence
- [x] Range rings (concentric circles)
- [x] Screenshot capture and download
- [x] Gesture controls (double-click zoom, scroll zoom, drag rotate)

## Tasks
- [ ] Add riverway data for use with flood data, flow, etc.
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
- [ ] Add Donation buttons with goals (setup custom PayPal account, etc.)

## Design and Styling
- [ ] Create/improve favicon and app icons
- [ ] Add map styling, symbology and etc.

## API Reference
- Full docs: `/api/docs` (dynamically generated markdown)
- Unified query: `GET /api/query?lat=X&lon=Y&include=elevation,address,weather,tides`
- All endpoints: `/api/elevation`, `/api/bathymetry`, `/api/geocode`, `/api/reverse-geocode`, `/api/weather/warnings`, `/api/waterways`, `/api/geoip`, `/api/health`
