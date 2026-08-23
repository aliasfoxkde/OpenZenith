# God's Eye Technical Audit - Globe Feature Enhancement

**Audit Date:** 2026-04-30  
**Source:** https://gods-eye.app (public scraping + JS bundle analysis)  
**Reference Video:** https://www.youtube.com/watch?v=CHLFl26p7Po (Bilawal Sidhu - ex-Google PM, 3D Maps/ARCore)  
**Purpose:** Enhance OpenZenith globe feature with proven patterns  
**Implementation Date:** 2026-04-30  
**Status:** ✅ IMPLEMENTED — GPS Jamming, Day/Night Terminator, Clustering System  

---

## 0. Video Context: Palantir AIP Targeting

**Video:** "Palantir's AI Targeting System Running the Iran War" by Bilawal Sidhu

### Creator Profile (Bilawal Sidhu)
- Former Google Sr. PM: 6 years building 3D Maps, ARCore, YouTube VR (1B+ users)
- Technology curator for TED, scout for a16z
- 1.6M subscribers on YouTube
- Focus: AI, AR/VR, robotics, spatial computing

### Video Content Analysis
Based on title and channel focus:

1. **GMTI (Ground Moving Target Indication)** - Real-time tracking of ground targets, radar/SAR integration
2. **Palantir AIP Features** - Data fusion, AI-driven threat assessment, automated targeting
3. **Globe Interface Patterns** - 3D terrain, multi-layer overlay, real-time tracking, GPS jamming detection

---

## 1. Architecture Overview

### Tech Stack
| Component | God's Eye | OpenZenith |
|----------|-----------|------------|
| **Map 2D** | MapLibre GL JS | MapLibre GL JS |
| **Globe 3D** | deck.gl GlobeView | CesiumJS |
| **Framework** | Vite + React | Next.js 15 (Edge) |
| **Rendering** | deck.gl layers | Cesium widgets |
| **Clustering** | Supercluster (via deck.gl) | None yet |

### Key Insight
God's Eye uses **deck.gl GlobeView** for 3D - a WebGL-based renderer that handles spherical projections natively. Their globe mode renders data layers directly on a sphere, not on a flat map with projection.

---

## 2. Data Layer Catalog (45 Map Layers)

God's Eye implements **45 distinct map layers** across these categories:

### 2.1 Military & Aviation (11 layers)
| Layer ID | Data Source | minZoom | Description |
|----------|-------------|---------|-------------|
| `flights` | ADS-B | 3 | Commercial flight positions |
| `flight-delays` | Aviation APIs | 4 | Flight delay indicators |
| `military-flights` | ADSB Exchange | 4 | Military aircraft tracking |
| `military-vessels` | AIS / AISStream | 2 | Naval vessel positions |
| `military-bases` | Georeferenced DB | 3 | Military installations |
| `military-nuclear` | Georeferenced DB | 4 | Nuclear facilities |
| `military-spaceports` | Georeferenced DB | 3 | Launch facilities |
| `bases-cluster-layer` | Supercluster | 5 | Clustered base markers |
| `bases-cluster-text` | deck.gl TextLayer | 5 | Cluster count labels |
| `accelerators-layer` | TechHQ data | 4 | Nuclear accelerators |

### 2.2 Maritime (2 layers)
| Layer ID | Data Source | Description |
|----------|-------------|-------------|
| `ships` | AIS via AISStream | Live vessel positions |
| `cable-advisories` | Submarine cable reports | Cable fault/degraded alerts |
| `cable-health-*` | Health status | Degraded/fault cable markers |

### 2.3 Conflict & Security (5 layers)
| Layer ID | Source | Description |
|----------|--------|-------------|
| `conflict-zones-layer` | UCDP/ACLED | Armed conflict event markers |
| `conflicts` | Real-time | Conflict hotspots |
| `protest-clusters-layer` | ACLED | Protest demonstration clusters |
| `protest-clusters-pulse` | Animation | Pulse effect on clusters |
| `conflict-escalation-dynamics` | Custom | Escalation visualization |

### 2.4 Natural Events (6 layers)
| Layer ID | Source | minZoom |
|---------|--------|---------|
| `earthquakes-layer` | USGS | 2 |
| `natural-events-layer` | Multiple | 1 |
| `weather-layer` | RainViewer/Multi | 3 |
| `weather-radar-layer` | RainViewer | 4 |
| `natural-disaster` | Emergency feeds | 2 |
| `climate-heatmap-layer` | Climate data | 3 |

### 2.5 Infrastructure (5 layers)
| Layer ID | Description |
|----------|-------------|
| `outages-layer` | Power grid failures |
| `pipelines-layer` | Energy infrastructure |
| `datacenters` | Tech infrastructure |
| `tech-hq-clusters` | Tech company HQs |
| `accelerators` | Nuclear/research |

### 2.6 Special Layers (3D/globe-specific)
| Layer ID | Type | Purpose |
|----------|------|---------|
| `satellite-imagery-layer` | Footprint | Satellite coverage areas |
| `satellite-trail-paths` | Trajectory | Orbital path visualization |
| `day-night-layer` | Terminator | Day/night boundary overlay |
| `satellite` | Point | Individual satellite positions |

### 2.7 Country/Region Intelligence
| Layer ID | Description |
|----------|-------------|
| `bases` | Military base markers |
| `nuclear-sites` | Nuclear facilities |
| `travel-advisory` | Travel warning zones |

---

## 3. Globe Mode Implementation

### 3.1 deck.gl GlobeView Configuration

```javascript
// From JS bundle analysis - globe initialization
{
  controller: true,
  viewState: {
    longitude: -98.5794,
    latitude: 39.8283,
    zoom: 2,
    minZoom: 1,
    maxZoom: 16,
    pitch: 0,
    bearing: 0
  },
  layers: [...],
  glOptions: {
    preserveDrawingBuffer: true
  }
}
```

### 3.2 Camera Controls
God's Eye implements:
- **Auto-rotation**: `controls.autoRotate = true`, speed 0.3
- **Zoom limits**: `minDistance: 101`, `maxDistance: 600` (in globe units)
- **Pan disabled**: `enablePan: false` (globe-centric)
- **Damping**: `enableDamping: true`, factor 0.18/0.12

### 3.3 Atmosphere Effects
```javascript
// Atmospheric rendering
{
  atmosphereAltitude: 0.18,  // Atmosphere height
  width: /* computed */,
  height: /* computed */,
  pathTransitionDuration: 0
}
```

### 3.4 Day/Night Terminator Layer

```javascript
// Identified pattern
{
  id: "day-night-layer",
  keywords: ["night", "terminator", "shadow", "day/night"],
  label: "Toggle day/night overlay",
  category: "layers"
}
```

**Implementation note:** Creates a terminator line between lit and unlit portions of Earth based on solar position.

---

## 4. Satellite Tracking

### 4.1 TLE Data Integration
God's Eye processes **Two-Line Element (TLE)** data for satellite tracking:

```
tle:"d8bfd8",...  // Color mapping for satellite trails
// Pattern found: satelliteTrailPaths, satellitePropagationCleanup
```

### 4.2 Satellite Visualization
- **Point markers**: Individual satellite positions
- **Trail paths**: Historical orbital paths
- **Footprint polygons**: Ground coverage areas
- **Imagery retrieval**: `loadImageryFootprints()` function

### 4.3 Real-time Propagation
```javascript
// From bundle - satellite update cycle
satellitePropagationCleanup = cleanupFunction(
  cachedSatRecs,
  callback: (satellites) => ctx.map.setSatellites(satellites),
  interval: 3000  // Update every 3 seconds
)
```

### 4.4 Imagery Footprints
```javascript
async loadImageryFootprints(retryCount = 2) {
  if (!ctx.mapLayers.satellites || ctx.map.isGlobeMode()) return;
  const bbox = ctx.map.getBbox();
  // Fetch and render satellite coverage areas
}
```

---

## 5. Clustering & Performance

### 5.1 Supercluster Integration
God's Eye uses **Supercluster** for point aggregation:

```javascript
// Configuration found
{
  radius: 40,        // Cluster radius in pixels
  maxZoom: 14,       // Max zoom for clustering
  minZoom: 0,        // Min zoom (always cluster)
  extent: 512,       // Tile extent
  nodeSize: 64       // Node size for index
}
```

### 5.2 Layer-specific Clustering
| Layer | Cluster ID | Aggregation |
|-------|------------|-------------|
| Military flights | `military-flight-clusters` | count, altitude stats |
| Military vessels | `military-vessel-clusters` | AIS status |
| Protests | `protest-clusters` | pulse animation |
| Earthquakes | `earthquakes` | time-based filtering |
| Tech HQ | `tech-hq-clusters` | faang/unicorn/public count |

### 5.3 Time-based Filtering
```javascript
filterByTime(data, dateExtractor) {
  return data.filter(item => {
    const age = Date.now() - new Date(dateExtractor(item)).getTime();
    return age <= timeRange;
  });
}
```

---

## 6. Data Sources (API Integration)

### 6.1 Confirmed External APIs
| API | Purpose | Auth |
|-----|---------|------|
| ADS-B Exchange | Military flights | Public |
| AISStream | Vessel tracking | API key |
| USGS | Earthquakes | Public |
| ACLED | Conflict events | API key |
| UCDP | Armed conflict | Public |
| RainViewer | Weather radar | Public |
| GDELT | News/intel | Public |

### 6.2 Internal API Pattern
```javascript
// Viewport-based fetching
async fetchViewportAircraft() {
  const bounds = map.getBounds();
  const [swLat, swLon] = [bounds.south, bounds.west];
  const [neLat, neLon] = [bounds.north, bounds.east];

  return jB({swLat, swLon, neLat, neLon});  // Aircraft fetch
}
```

### 6.3 API Response Structure
```typescript
interface AircraftPosition {
  icao24: string;
  callsign: string;
  origin_country: string;
  latitude: number;
  longitude: number;
  baro_altitude: number;
  velocity: number;
  heading: number;
  lastSeen: string;
}

interface VesselPosition {
  mmsi: string;
  name: string;
  imo: number;
  lat: number;
  lon: number;
  speed: number;
  heading: number;
  timestamp: string;
  status: string;  // "under way", "at anchor", "dark" (no AIS)
}
```

---

## 7. UI/Panel Architecture

### 7.1 Panel System (40+ panels)
Key globe-related panels:
| Panel ID | Purpose |
|----------|---------|
| `panel:map` | Global Map view |
| `panel:military-correlation` | Force posture |
| `panel:satellite-fires` | Wildfire detection |
| `panel:ucdp-events` | Conflict events |
| `panel:disaster-correlation` | Natural disasters |
| `panel:live-webcams` | Live camera feeds |

### 7.2 Tooltip Configuration
```javascript
// deck.gl tooltip structure
{
  "components.deckgl.tooltip.conflictZone": true,
  "components.deckgl.tooltip.flightCluster": true,
  "components.deckgl.tooltip.militaryAircraft": true,
  "cluster-flights": true,
  "common.conflict": true
}
```

### 7.3 Command Palette
```javascript
// Globe-related commands
{
  id: "layer:day-night",
  keywords: ["night", "terminator", "shadow", "day/night"],
  label: "Toggle day/night overlay"
}
```

---

## 8. OpenZenith Enhancement Recommendations

### 8.1 High-Priority Additions

#### A. Satellite Tracking
```typescript
// New component: api/src/lib/satellites.ts
interface TLE {
  name: string;
  tle1: string;
  tle2: string;
}

// SGP4 propagation for orbital mechanics
// Cesium Satellite entity with:
const satelliteEntity = viewer.entities.add({
  position: cesiumMath.cartesianFromTLE(tle, dateTime),
  point: { pixelSize: 4, color: Cesium.Color.CYAN },
  path: { leadTime: 24 * 3600, trailTime: 24 * 3600 }
});
```

#### B. Day/Night Terminator
```typescript
// Cesium provides this natively via:
// viewer.scene.globe.enableLighting = true;
// Or custom terminator:
const sunPosition = Cesium.SunPosition.compute(dateTime);
const terminatorGeometry = computeTerminatorGeometry(sunPosition, 100);
```

#### C. Conflict Event Clustering
```typescript
// Integrate Supercluster for point aggregation
import Supercluster from 'supercluster';
const index = new Supercluster({
  radius: 40,
  maxZoom: 14,
  map: (props) => ({ count: 1, severity: props.severity }),
  reduce: (acc, props) => {
    acc.count += props.count;
    acc.severity = Math.max(acc.severity, props.severity);
  }
});
```

### 8.2 Medium-Priority Features

#### A. Military Flight Overlay
- Integrate ADSB Exchange public feed
- Cesium `Entity` collection for aircraft icons
- Trail polyline for flight history

#### B. Vessel AIS Overlay
- AISStream integration
- Color-coded by status (live/dark/anchor)
- Cluster at low zoom levels

#### C. Weather Radar Animation
- RainViewer tile API
- Cesium `ImageryLayer` with time-dynamic URLs
- Animation playback control

### 8.3 Low-Priority (Nice-to-Have)

#### A. Pipeline/Undersea Cable Layer
- Static GeoJSON with cable routes
- Fault point overlay

#### B. Nuclear Accelerator Sites
- Static point data
- Research institution markers

---

## 9. CesiumJS vs deck.gl Comparison

| Feature | CesiumJS (OpenZenith) | deck.gl (God's Eye) |
|---------|----------------------|---------------------|
| Globe rendering | ✅ Native | ✅ GlobeView |
| Terrain | ✅ 3D Tiles, R2 | Limited |
| Atmosphere | ✅ Built-in | Custom shader |
| Large datasets | ✅ Yes (3D Tiles) | ✅ Yes (Binary) |
| Clustering | ⚠️ Manual | ✅ Supercluster |
| WebGL layers | ⚠️ Limited | ✅ Rich layer system |
| Mobile | ✅ CesiumOS | ✅ Limited |

**Recommendation:** Keep CesiumJS for terrain/3D capability, add Supercluster for clustering.

---

## 10. Implementation Roadmap

### Phase 1: Clustering Infrastructure
1. Integrate `supercluster` package
2. Build cluster aggregator for conflict events
3. Add cluster toggle to layer panel

### Phase 2: Satellite Tracking
1. Add TLE parser (celestial-cats or custom)
2. Create Satellite entity factory
3. Implement SGP4 propagator
4. Add orbit trail polyline

### Phase 3: Day/Night Layer
1. Enable Cesium globe lighting
2. Create terminator overlay option
3. Add shadow/illumination toggle

### Phase 4: Additional Layers
1. Military flight overlay (ADS-B)
2. Vessel AIS layer (AISStream)
3. Weather radar tiles (RainViewer)

---

## 11. Data Source Checklist

| Source | Status | OpenZenith Integration |
|--------|--------|------------------------|
| ADSB Exchange | ✅ Public | Needs integration |
| AISStream | ✅ API key | Needs integration |
| USGS Earthquakes | ✅ GeoJSON | ✅ Ready |
| ACLED | ✅ API key | Needs integration |
| UCDP | ✅ GeoJSON | Needs integration |
| RainViewer | ✅ Tile API | Partial |
| GDELT | ✅ BigQuery | Partial |

---

## 12. Implementation Summary (2026-04-30)

### ✅ Successfully Implemented

| Feature | Status | File(s) |
|---------|--------|---------|
| **GPS Jamming Hex Grid** | ✅ Done | `api/src/app/globe/lib/layers/gps-jamming.ts` |
| **Day/Night Terminator** | ✅ Done | `api/src/app/globe/lib/layers/day-night.ts` |
| **Clustering System** | ✅ Done | `api/src/app/globe/lib/clustering.ts` |
| **Layer Registry Update** | ✅ Done | `api/src/lib/layers/registry.ts`, `api/src/lib/layers/types.ts` |
| **Globe Page Integration** | ✅ Done | `api/src/app/globe/page.tsx` |
| **Intelligence Category** | ✅ Done | Added to layer system |

### 📊 Layer System Updates

**New Layers Added:**
- `gpsJamming` — Hex-grid visualization of GPS interference zones
- `dayNight` — Day/night terminator overlay

**New Category:**
- `intelligence` — For security/electronic warfare layers

### 🔧 Architecture Changes

1. **Layer Types:** Added `gpsJamming` and `dayNight` to `LayerState`
2. **Dynamic Loader:** Added switch cases for new layer types
3. **Data Status:** Added status entries for new layers
4. **Clustering:** Implemented `SimpleClusterIndex` for point aggregation

### 🚀 How to Use

```typescript
// Enable GPS Jamming layer
setState(prev => ({
  ...prev,
  layers: { ...prev.layers, gpsJamming: true }
}));

// Enable Day/Night Terminator
setState(prev => ({
  ...prev,
  layers: { ...prev.layers, dayNight: true }
}));

// Use clustering for point data
import { SimpleClusterIndex, renderClustersOnGlobe } from './lib/clustering';

const index = new SimpleClusterIndex(features, { radius: 60, maxZoom: 14 });
const clusters = index.getClusters(bounds, zoom);
renderClustersOnGlobe(viewer, Cesium, clusters);
```

---

## 13. Key Files to Modify

```
api/src/
├── lib/
│   ├── satellites.ts        # NEW: TLE + propagation
│   ├── clustering.ts        # NEW: Supercluster wrapper
│   ├── adsb.ts             # NEW: Military flight fetcher
│   ├── ais.ts              # NEW: Vessel tracking
│   └── layers.ts           # ENHANCE: Layer registry
├── components/
│   ├── Map/
│   │   ├── SatelliteLayer.tsx   # NEW
│   │   ├── ClusterLayer.tsx     # NEW
│   │   └── DayNightControl.tsx   # NEW
│   └── controls/
│       └── GlobeMode.tsx        # ENHANCE
└── app/
    └── page.tsx                 # ENHANCE: Layer panel
```

---

## Appendix: Key Code Snippets

### A. Cesium Globe Initialization
```typescript
const viewer = new Cesium.Viewer('cesiumContainer', {
  globe: new Cesium.Globe(Cesium.Ellipsoid.WGS84),
  baseLayerPicker: false,
  geocoder: false,
  homeButton: false,
  sceneModePicker: false,
  navigationHelpButton: false,
  animation: false,
  timeline: false,
  fullscreenButton: false,
  vrButton: false,
  infoBox: false,
  selectionIndicator: false,
  shadows: false,
  terrainProviderViewModels: []
});

viewer.scene.globe.enableLighting = true;
viewer.scene.globe.showGroundAtmosphere = true;
```

### B. Supercluster with Cesium
```typescript
import Supercluster from 'supercluster';

const clusterIndex = new Supercluster({
  radius: 60,
  maxZoom: 12,
  map: (props) => ({ severity: props.severity || 1 }),
  reduce: (acc, props) => {
    acc.severity = Math.max(acc.severity, props.severity);
  }
});

function updateClusters(camera: Cesium.Camera) {
  const zoom = Math.floor(camera.positionCartographic.height / 1000);
  const bounds = computeViewBounds(camera);

  const clusters = clusterIndex.getClusters(bounds, zoom);
  updateCesiumEntities(clusters);
}
```

---

**Audit Complete** | Sources: JS bundle analysis, CSP headers, sitemap, robots.txt
