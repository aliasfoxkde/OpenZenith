/**
 * Minimal CesiumJS type declarations.
 *
 * CesiumJS is loaded via CDN (not npm), so these declarations provide
 * typing for the APIs actually used in the globe page.
 */

declare namespace CesiumType {
  /** Cesium Property object — has getValue(time) for time-dynamic values. */
  interface Property {
    getValue(time?: JulianDate): unknown;
  }

  /** Entity properties bag — dynamic keys, values are Property objects. */
  interface PropertyBag {
    [key: string]: Property | undefined;
  }

  interface PrimitiveLike {
    id?: string;
    [key: string]: unknown;
  }

  interface ScreenSpaceEvent {
    position: Cartesian2;
    endPosition: Cartesian2;
    [key: string]: unknown;
  }

  class Viewer {
    scene: Scene;
    camera: Camera;
    entities: EntityCollection;
    dataSources: DataSourceCollection;
    imageryLayers: ImageryLayerCollection;
    clock: Clock;
    terrainProvider: unknown;
    container: HTMLElement;
    constructor(container: HTMLElement, options: Record<string, unknown>);
    destroy(): void;
    zoomTo(target: unknown, options?: unknown): Promise<void>;
    flyTo(options: Record<string, unknown>): Promise<void>;
    forceResize(): void;
    render(): void;
  }

  class Scene {
    globe: Globe;
    backgroundColor: Color;
    camera: Camera;
    canvas: HTMLCanvasElement;
    skyBox: { show: boolean } | undefined;
    skyAtmosphere: { show: boolean; hueShift: number; saturationShift: number; brightnessShift: number };
    fog: { enabled: boolean };
    screenSpaceCameraController: {
      enableRotate: boolean;
      enableZoom: boolean;
      enableTranslate: boolean;
      enableTilt: boolean;
      enableLook: boolean;
      enableCollisionDetection: boolean;
      minimumZoomDistance: number;
      maximumZoomDistance: number;
      minimumZoomRate: number;
      maximumZoomRate: number;
      zoomFactor: number;
      inertiaSpin: number;
      inertiaTranslate: number;
      inertiaZoom: number;
      minimumCollisionTerrainHeight: number;
    };
    postProcessStages: { fxaa: { enabled: boolean }; add: (stage: unknown) => unknown };
    primitives: {
      add: (primitive: unknown) => unknown;
      remove: (primitive: unknown) => boolean;
      length: number;
      get(index: number): unknown;
    };
    preRender: Event;
    requestRender(): void;
    postRender: Event;
    pick(position: Cartesian2): { id?: Entity; primitive?: unknown } | undefined;
    morphTo2D(duration?: number): void;
    morphTo3D(duration?: number): void;
    morphToColumbusView(duration?: number): void;
    [key: string]: unknown;
  }

  class Event {
    addEventListener(listener: (...args: unknown[]) => void): Event.RemoveListener;
    removeEventListener(listener: (...args: unknown[]) => void): void;
  }

  namespace Event {
    type RemoveListener = () => void;
  }

  class Globe {
    baseColor: Color;
    terrainProvider: unknown;
    depthTestAgainstTerrain: boolean;
    showGroundAtmosphere: boolean;
    show: boolean;
    enableLighting: boolean;
    lightingFadeInDistance: number;
    lightingFadeOutDistance: number;
    ellipsoid: { pickRay?: (ray: unknown) => unknown };
  }

  class Camera {
    flyTo(options: Record<string, unknown>): Promise<void>;
    setView(options: Record<string, unknown>): void;
    lookAt(target: Cartesian3, offset: HeadingPitchRange): void;
    getHeading(): number;
    getPitch(): number;
    heading: number;
    pitch: number;
    roll: number;
    position: Cartesian3;
    positionWC: Cartesian3;
    positionCartographic: Cartographic;
    frustum: { far: number };
    changed: Event;
    pickEllipsoid(position: Cartesian2, ellipsoid?: unknown): Cartesian3 | undefined;
    /** Restores the camera's absolute transform after lookAt() — pass Matrix4.IDENTITY. */
    lookAtTransform(transform?: unknown, offset?: unknown): void;
    zoomIn(amount?: number): void;
    zoomOut(amount?: number): void;
    [key: string]: unknown;
  }

  /** 4×4 transform matrix; the globe surface only reads Matrix4.IDENTITY. */
  interface Matrix4 {
    clone(result?: Matrix4): Matrix4;
  }
  const Matrix4: {
    IDENTITY: Matrix4;
    clone(m: Matrix4, result?: Matrix4): Matrix4;
  };

  class Clock {
    startTime: JulianDate;
    stopTime: JulianDate;
    currentTime: JulianDate;
    shouldAnimate: boolean;
    multiplier: number;
  }

  class EntityCollection {
    add(entity: Record<string, unknown>): Entity;
    remove(entity: Entity): boolean;
    removeAll(): void;
    getById(id: string): Entity | undefined;
    removeById(id: string): boolean;
    values: Entity[];
  }

  class DataSourceCollection {
    add(dataSource: unknown): unknown;
    remove(dataSource: unknown): boolean;
    get(index: number): unknown;
    length: number;
  }

  class Entity {
    id: string;
    name?: string;
    show?: boolean | CallbackProperty;
    // A raw Cartesian3 is legal on assignment — Cesium's property descriptor
    // wraps it in a ConstantPositionProperty.
    position?: PositionProperty | Cartesian3;
    orientation?: unknown;
    point?: Record<string, unknown>;
    label?: Record<string, unknown>;
    billboard?: Record<string, unknown>;
    polyline?: Record<string, unknown>;
    polygon?: Record<string, unknown>;
    rectangle?: Record<string, unknown>;
    ellipse?: Record<string, unknown>;
    description?: string;
    properties?: Record<string, unknown> & { [key: string]: Property | undefined };
    parent?: Entity;
    [key: string]: unknown;
  }

  class Cartesian3 {
    constructor(x?: number, y?: number, z?: number);
    static fromDegrees(lon: number, lat: number, height?: number): Cartesian3;
    static fromDegreesArray(coordinates: number[], height?: number, height2?: number): Cartesian3[];
    static fromDegreesArrayHeight(coordinates: number[], heights: number[]): Cartesian3[];
    static fromElements(x: number, y: number, z: number, result?: Cartesian3): Cartesian3;
    static fromCartesian(cartesian: Cartesian3): Cartesian3;
    static distance(left: Cartesian3, right: Cartesian3): number;
    static normalize(cartesian: Cartesian3, result?: Cartesian3): Cartesian3;
    static subtract(left: Cartesian3, right: Cartesian3, result?: Cartesian3): Cartesian3;
    static add(left: Cartesian3, right: Cartesian3, result?: Cartesian3): Cartesian3;
    static multiplyByScalar(cartesian: Cartesian3, scalar: number, result?: Cartesian3): Cartesian3;
    static lerp(start: Cartesian3, end: Cartesian3, t: number, result?: Cartesian3): Cartesian3;
    static dot(left: Cartesian3, right: Cartesian3): number;
    static cross(left: Cartesian3, right: Cartesian3, result?: Cartesian3): Cartesian3;
    static magnitude(cartesian: Cartesian3): number;
    static divideByScalar(cartesian: Cartesian3, scalar: number, result?: Cartesian3): Cartesian3;
    static clone(cartesian: Cartesian3, result?: Cartesian3): Cartesian3;
    static ZERO: Cartesian3;
    static UNIT_X: Cartesian3;
    static UNIT_Y: Cartesian3;
    static UNIT_Z: Cartesian3;
    x: number;
    y: number;
    z: number;
  }

  class Cartesian2 {
    constructor(x?: number, y?: number);
    static fromElements(x: number, y: number, result?: Cartesian2): Cartesian2;
    x: number;
    y: number;
  }

  class Cartographic {
    static fromDegrees(longitude: number, latitude: number, height?: number): Cartographic;
    static fromCartesian(cartesian: Cartesian3): Cartographic;
    longitude: number;
    latitude: number;
    height: number;
  }

  /** WGS84 is the only ellipsoid the globe page needs by name. */
  class Ellipsoid {
    static WGS84: Ellipsoid;
    geodeticSurfaceNormal(cartesian: Cartesian3, result?: Cartesian3): Cartesian3;
  }

  class Rectangle {
    static fromDegrees(west: number, south: number, east: number, north: number, result?: Rectangle): Rectangle;
    west: number;
    south: number;
    east: number;
    north: number;
  }

  class GeographicTilingScheme {
    constructor(options?: {
      ellipsoid?: Ellipsoid;
      rectangle?: Rectangle;
      numberOfLevelZeroTilesX?: number;
      numberOfLevelZeroTilesY?: number;
    });
    getNumberOfXTilesAtLevel(level: number): number;
    getNumberOfYTilesAtLevel(level: number): number;
  }

  class Credit {
    constructor(html: string, showOnScreen?: boolean);
    element: HTMLElement;
    showOnScreen: boolean;
  }

  /** Base class for terrain providers — used via `.prototype` when duck-typing. */
  class TerrainProvider {
    requestTileGeometry?(x: number, y: number, level: number, request: unknown): Promise<unknown>;
    getTileDataAvailable?(x: number, y: number, level: number): boolean | undefined;
  }

  class JulianDate {
    static now(): JulianDate;
    static fromDate(date: Date, result?: JulianDate): JulianDate;
    static fromIso8601(iso8601: string, result?: JulianDate): JulianDate;
    static secondsDifference(left: JulianDate, right: JulianDate): number;
    static addSeconds(julianDate: JulianDate, seconds: number, result?: JulianDate): JulianDate;
    static compare(left: JulianDate, right: JulianDate): number;
    dayNumber: number;
    secondsOfDay: number;
  }

  class Color {
    static fromCssColorString(color: string): Color;
    static fromBytes(red: number, green: number, blue: number, alpha?: number, result?: Color): Color;
    static fromAlpha(color: Color, alpha: number, result?: Color): Color;
    static RED: Color;
    static GREEN: Color;
    static BLUE: Color;
    static WHITE: Color;
    static BLACK: Color;
    static YELLOW: Color;
    static CYAN: Color;
    static MAGENTA: Color;
    static ORANGE: Color;
    static TRANSPARENT: Color;
    static LIME: Color;
    static GRAY: Color;
    static DEEPSKYBLUE: Color;
    static LIGHTBLUE: Color;
    constructor(red: number, green: number, blue: number, alpha?: number);
    red: number;
    green: number;
    blue: number;
    alpha: number;
    withAlpha(alpha: number, result?: Color): Color;
    toCssColorString(): string;
    static fromHsl(hue: number, saturation: number, lightness: number, alpha?: number, result?: Color): Color;
  }

  class NearFarScalar {
    constructor(near: number, nearValue: number, far: number, farValue: number);
    near: number;
    nearValue: number;
    far: number;
    farValue: number;
  }

  class DistanceDisplayCondition {
    constructor(near: number, far: number);
    near: number;
    far: number;
  }

  /** Time-dynamic property resolved by a callback each frame. */
  interface CallbackProperty {
    getValue(time?: JulianDate): unknown;
  }

  /** Time-dynamic position property — resolves to a world position. */
  interface PositionProperty {
    getValue(time?: JulianDate): Cartesian3;
  }

  const CallbackProperty: new (callback: (time: JulianDate) => unknown, isConstant: boolean) => CallbackProperty;

  class SampledPositionProperty {
    constructor(referenceFrame?: number);
    getValue(time?: JulianDate): Cartesian3;
    addSample(time: JulianDate, position: Cartesian3): void;
    setInterpolationOptions(options: { interpolationAlgorithm?: unknown; interpolationDegree?: number }): void;
  }

  interface UrlTemplateImageryProvider {
    [key: string]: unknown;
  }

  const UrlTemplateImageryProvider: new (options: {
    url: string;
    maximumLevel?: number;
    credit?: string;
  }) => UrlTemplateImageryProvider;

  class PointPrimitiveCollection {
    constructor(options?: Record<string, unknown>);
    add(point: unknown): unknown;
    get(index: number): { position: Cartesian3 | CallbackProperty };
    remove(point: unknown): boolean;
    removeAll(): void;
    length: number;
    show: boolean;
  }

  class PolygonHierarchy {
    constructor(positions: Cartesian3[], holes?: Cartesian3[][]);
    positions: Cartesian3[];
    holes: Cartesian3[][];
  }

  class HeadingPitchRange {
    constructor(heading: number, pitch: number, range: number);
    heading: number;
    pitch: number;
    range: number;
  }

  class CustomDataSource {
    constructor(name: string);
    name: string;
    entities: EntityCollection;
    show: boolean;
  }

  class ScreenSpaceEventHandler {
    constructor(element: HTMLElement);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    setInputAction(action: (...args: any[]) => void, type: number, modifier?: number): void;
    removeInputAction(type: number, modifier?: number): void;
    destroy(): void;
  }

  class ImageryLayer {
    alpha: number;
    show: boolean;
  }

  class ImageryLayerCollection {
    addImageryProvider(provider: unknown, index?: number): ImageryLayer;
    get(index: number): ImageryLayer;
    remove(imageryLayer: unknown, destroy?: boolean): boolean;
    removeAll(): void;
    length: number;
  }

  const Math: {
    toRadians(degrees: number): number;
    toDegrees(radians: number): number;
    clamp(value: number, min: number, max: number): number;
    randomBetween(min: number, max: number): number;
    PI: number;
    TWO_PI: number;
    PI_OVER_TWO: number;
    degsToRad: number;
  };

  const LabelStyle: {
    FILL: number;
    OUTLINE: number;
    FILL_AND_OUTLINE: number;
  };

  const VerticalOrigin: {
    TOP: number;
    CENTER: number;
    BOTTOM: number;
    BASELINE: number;
  };

  const ClassificationType: {
    BOTH: number;
    TERRAIN: number;
    CESIUM_3D_TILE: number;
  };

  const SceneMode: {
    SCENE3D: number;
    SCENE2D: number;
    COLUMBUS_VIEW: number;
    MORPHING: number;
  };

  const ScreenSpaceEventType: {
    LEFT_CLICK: number;
    RIGHT_CLICK: number;
    MIDDLE_CLICK: number;
    LEFT_DOUBLE_CLICK: number;
    MOUSE_MOVE: number;
    WHEEL: number;
  };

  interface PolylineGlowMaterialProperty {
    [key: string]: unknown;
  }

  const PolylineGlowMaterialProperty: new (options: {
    color?: Color;
    glowPower?: number;
    taperPower?: number;
  }) => PolylineGlowMaterialProperty;

  interface PolylineDashMaterialProperty {
    [key: string]: unknown;
  }

  const PolylineDashMaterialProperty: new (options: {
    color?: Color;
    dashLength?: number;
    dashPattern?: number;
  }) => PolylineDashMaterialProperty;

  interface ColorMaterialProperty {
    [key: string]: unknown;
  }

  const ColorMaterialProperty: new (options: {
    color?: Color;
    transparent?: boolean;
    alpha?: number | CallbackProperty;
  }) => ColorMaterialProperty;

  class EllipsoidTerrainProvider {
    constructor();
    requestTileGeometry?: (x: number, y: number, level: number, request: unknown) => Promise<unknown>;
    getTileDataAvailable?: (x: number, y: number, level: number) => boolean | undefined;
  }

  interface HeightmapTerrainData {
    [key: string]: unknown;
  }

  const HeightmapTerrainData: new (options: {
    buffer: Float32Array;
    width: number;
    height: number;
    structure: {
      heightScale: number;
      heightOffset: number;
      elementsPerHeight: number;
      stride: number;
      elementMultiplier: number;
      isBigEndian: boolean;
    };
    childTileMask?: number;
  }) => HeightmapTerrainData;

  const Resource: {
    new (options?: { url: string }): { fetch(options?: Record<string, unknown>): Promise<Response> };
    fetchImage(options: { url: string }): Promise<HTMLImageElement>;
  };

  const Ion: { defaultAccessToken: string | undefined };

  function LagrangePolynomialApproximation(options: unknown): unknown;
}

/** satellite.js SGP4 propagator record (opaque; built from a TLE pair). */
interface SatelliteJsSatrec {
  error?: number;
  [key: string]: unknown;
}

/**
 * Minimal satellite.js surface the globe layers use (loaded via CDN).
 * propagate() omits position/velocity for decayed or unpropagatable sats,
 * so callers must guard both.
 */
interface SatelliteJsApi {
  twoline2satrec(tleLine1: string, tleLine2: string): SatelliteJsSatrec;
  /** Legacy alias for twoline2satrec kept for existing callers. */
  satrec(tleLine1: string, tleLine2: string): SatelliteJsSatrec;
  propagate(
    satrec: SatelliteJsSatrec,
    date: Date,
  ): {
    position?: { x: number; y: number; z: number };
    velocity?: { x: number; y: number; z: number };
  };
  gstime(date: Date | number): number;
  eciToGeodetic(
    positionEci: { x: number; y: number; z: number },
    gstime: number,
  ): { longitude: number; latitude: number; height: number };
  eciToEcf(
    positionEci: { x: number; y: number; z: number },
    gstime: number,
  ): { x: number; y: number; z: number };
  degreesLat(radians: number): number;
  degreesLong(radians: number): number;
}

interface Window {
  Cesium?: typeof CesiumType;
  CESIUM_BASE_URL?: string;
  satellite?: SatelliteJsApi;
  /** Set by the globe page once its viewer is live; E2E/support detect init through it. */
  __ozViewer?: unknown;
  __ozSetFollowEntity?: (entity: CesiumType.Entity | null) => void;
  // Set by layers/vessels.ts so the layer can be torn down without a
  // module-level singleton.
  __ozCleanupVessels?: () => void;
}
