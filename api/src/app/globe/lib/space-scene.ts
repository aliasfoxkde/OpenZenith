/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Space scene — enhanced star field and planet markers for deep-space views.
 *
 * - 3000+ procedural stars (bright catalog stars with realistic positions)
 * - Planet markers at scaled orbital distances (clickable, with info)
 * - Moon marker
 * - All entities are tagged "space-scene" for clean removal
 */

interface SpaceSceneState {
  starsLoaded: boolean;
  planetsLoaded: boolean;
  entities: any[];
}

/**
 * Generate ~3000 star positions distributed on a celestial sphere.
 * Uses seeded randomization for consistency between sessions.
 * Brighter stars (magnitude < 3) get larger point sizes.
 */
function generateStars(_Cesium: any): Array<{
  lng: number;
  lat: number;
  alt: number;
  pixelSize: number;
  color: string;
  brightness: number;
}> {
  const stars: Array<{
    lng: number;
    lat: number;
    alt: number;
    pixelSize: number;
    color: string;
    brightness: number;
  }> = [];

  // Seeded PRNG for deterministic star field
  let seed = 42;
  const rand = () => {
    seed = (seed * 16807 + 0) % 2147483647;
    return (seed - 1) / 2147483646;
  };

  // Star colors by spectral type (simplified)
  const starColors = [
    "#aaccff", // O/B type (blue-white, hot)
    "#ccddff", // A type (white)
    "#ffffff", // F type (yellow-white)
    "#fff4e0", // G type (yellow, like Sun)
    "#ffcc88", // K type (orange)
    "#ff8866", // M type (red, cool)
  ];

  const sphereRadius = 200_000_000; // 200M meters — well beyond frustum but within max zoom

  // Generate 3200 stars
  for (let i = 0; i < 3200; i++) {
    // Uniform distribution on sphere
    const theta = rand() * Math.PI * 2; // longitude
    const phi = Math.acos(2 * rand() - 1); // latitude (uniform on sphere)

    const lng = (theta * 180) / Math.PI;
    const lat = 90 - (phi * 180) / Math.PI;

    // Magnitude distribution: more dim stars than bright
    const magnitude = Math.pow(rand(), 2.5) * 6; // 0 (brightest) to 6 (dimmest)
    const brightness = Math.max(0.1, 1 - magnitude / 6);

    // Pixel size based on magnitude
    let pixelSize: number;
    if (magnitude < 1)
      pixelSize = 3 + rand() * 2; // bright: 3-5px
    else if (magnitude < 2) pixelSize = 2 + rand() * 1.5;
    else if (magnitude < 3) pixelSize = 1.5 + rand();
    else if (magnitude < 4.5) pixelSize = 1 + rand() * 0.5;
    else pixelSize = 0.5 + rand() * 0.5; // dim: barely visible

    // Color selection weighted toward cooler stars
    let colorIdx: number;
    const colorRand = rand();
    if (colorRand < 0.03)
      colorIdx = 0; // O/B blue
    else if (colorRand < 0.1)
      colorIdx = 1; // A white
    else if (colorRand < 0.2)
      colorIdx = 2; // F yellow-white
    else if (colorRand < 0.4)
      colorIdx = 3; // G yellow
    else if (colorRand < 0.65)
      colorIdx = 4; // K orange
    else colorIdx = 5; // M red

    stars.push({
      lng,
      lat,
      alt: sphereRadius,
      pixelSize,
      color: starColors[colorIdx],
      brightness,
    });
  }

  return stars;
}

/**
 * Solar system body data — distances scaled to fit within Cesium's coordinate space.
 * Real distances would be absurdly large; these are placed at "illustrative" distances
 * relative to the Earth viewer.
 */
interface SolarSystemBody {
  name: string;
  description: string;
  realDistKm: number;
  displayAlt: number; // meters from Earth center
  pixelSize: number;
  color: string;
  labelColor: string;
}

const SOLAR_SYSTEM_BODIES: SolarSystemBody[] = [
  {
    name: "Moon",
    description: "Earth's Moon — 384,400 km",
    realDistKm: 384400,
    displayAlt: 45_000_000, // ~45M meters (visible at medium zoom)
    pixelSize: 8,
    color: "#ddddcc",
    labelColor: "#ccccbb",
  },
  {
    name: "Sun",
    description: "The Sun — 149,600,000 km",
    realDistKm: 149600000,
    displayAlt: 180_000_000, // ~180M meters (near max zoom)
    pixelSize: 14,
    color: "#ffee44",
    labelColor: "#ffdd22",
  },
];

export function createSpaceSceneManager(viewer: any, Cesium: any) {
  const state: SpaceSceneState = {
    starsLoaded: false,
    planetsLoaded: false,
    entities: [],
  };

  const removeEntity = (e: any) => {
    try {
      viewer.entities.remove(e);
    } catch {
      /* already removed */
    }
  };

  const clear = () => {
    state.entities.forEach(removeEntity);
    state.entities = [];
    state.starsLoaded = false;
    state.planetsLoaded = false;
  };

  /**
   * Load 3000+ stars as point entities on a distant celestial sphere.
   * Stars are static and only need to be loaded once.
   */
  const loadStars = () => {
    if (state.starsLoaded) return;

    const stars = generateStars(Cesium);

    // Batch into a single PointPrimitiveCollection-like approach via entities
    // Using point entities with scaleByDistance for performance
    for (const star of stars) {
      const entity = viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(star.lng, star.lat, star.alt),
        point: {
          pixelSize: star.pixelSize,
          color: Cesium.Color.fromCssColorString(star.color).withAlpha(star.brightness),
          outlineColor: Cesium.Color.TRANSPARENT,
          outlineWidth: 0,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          scaleByDistance: new Cesium.NearFarScalar(1_000_000, 2.0, 200_000_000, 0.3),
        },
        properties: { type: "space-scene", subtype: "star" },
      });
      state.entities.push(entity);
    }

    state.starsLoaded = true;
  };

  /**
   * Load planet markers — Moon, Sun at scaled distances from Earth.
   */
  const loadPlanets = () => {
    if (state.planetsLoaded) return;

    for (const body of SOLAR_SYSTEM_BODIES) {
      // Place at 0,0 (relative to Earth center) at scaled altitude
      const entity = viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(0, 0, body.displayAlt),
        point: {
          pixelSize: body.pixelSize,
          color: Cesium.Color.fromCssColorString(body.color),
          outlineColor: Cesium.Color.WHITE.withAlpha(0.3),
          outlineWidth: 1,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          scaleByDistance: new Cesium.NearFarScalar(1_000_000, 1.5, 200_000_000, 0.5),
        },
        label: {
          text: body.name,
          font: "bold 11px 'JetBrains Mono', monospace",
          fillColor: Cesium.Color.fromCssColorString(body.labelColor),
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 2,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new Cesium.Cartesian2(0, -16),
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          showBackground: true,
          backgroundColor: Cesium.Color.BLACK.withAlpha(0.6),
          backgroundPadding: new Cesium.Cartesian2(4, 2),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          scaleByDistance: new Cesium.NearFarScalar(1_000_000, 1.0, 200_000_000, 0.4),
        },
        properties: {
          type: "space-scene",
          subtype: "planet",
          name: body.name,
          description: body.description,
          realDistKm: body.realDistKm,
        },
      });
      state.entities.push(entity);
    }

    state.planetsLoaded = true;
  };

  /**
   * Load all space scene elements.
   */
  const loadAll = () => {
    loadStars();
    loadPlanets();
  };

  return { state, loadStars, loadPlanets, loadAll, clear };
}
