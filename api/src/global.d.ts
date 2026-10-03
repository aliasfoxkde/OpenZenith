// Cloudflare Pages environment bindings (KV, D1, etc.)
// No R2 bindings: the platform runs on free storage only (HuggingFace origin
// + the per-colo Cache API).

// Augment Response.json() to return Promise<any> instead of Promise<unknown>
// This avoids having to cast every res.json() call throughout the codebase.
interface Response {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  json(): Promise<any>;
}

declare module "shpjs" {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export function parseZip(buffer: ArrayBuffer): any;
}

// MapLibre GL JS is loaded via CDN script tag, not npm import.
// Declare the global type so we can use `maplibregl.Map` etc.
declare namespace maplibregl {
  class Map {
    constructor(options?: Record<string, unknown>);
    addSource(id: string, source: Record<string, unknown>): this;
    removeSource(id: string): this;
    getSource(id: string):
      | {
          setData(data: unknown): void;
          type: string;
          _data?: GeoJSON.FeatureCollection;
          // Raster sources expose the current tile URL template and allow
          // swapping it in place (theme basemap changes) without a rebuild.
          tiles?: string[];
          setTiles?(tiles: string[]): void;
        }
      | undefined;
    addLayer(layer: Record<string, unknown>, beforeId?: string): this;
    removeLayer(id: string): this;
    getLayer(id: string): Record<string, unknown> | undefined;
    setLayoutProperty(layerId: string, name: string, value: unknown): this;
    setPaintProperty(layerId: string, name: string, value: unknown): this;
    setFilter(layerId: string, filter?: unknown): this;
    setStyle(style: Record<string, unknown>): this;
    getBounds(): { getSouthWest(): { lat: number; lng: number }; getNorthEast(): { lat: number; lng: number } };
    fitBounds(
      bounds:
        | LngLatBounds
        | {
            getSouthWest(): { lng: number; lat: number };
            getNorthEast(): { lng: number; lat: number };
          },
      options?: Record<string, unknown>,
    ): this;
    // Mouse events carry a lngLat/point payload; everything else is declared
    // loosely (the app's handlers for them take no event argument). Handlers
    // may be async — MapLibre ignores the returned promise (fire-and-forget).
    on(
      type: "click" | "mousedown" | "mousemove" | "mouseup" | "mouseout" | "dblclick" | "contextmenu",
      listener: (e: maplibregl.MapMouseEvent) => void | Promise<void>,
    ): this;
    on(type: string, listener: (...args: unknown[]) => void | Promise<void>): this;
    off(type: string, listener: (...args: unknown[]) => void): this;
    once(type: string, listener: (...args: unknown[]) => void): this;
    addControl(control: unknown, position?: string): this;
    removeControl(control: unknown): this;
    getCenter(): { lng: number; lat: number };
    getZoom(): number;
    setZoom(zoom: number): this;
    getBearing(): number;
    getPitch(): number;
    setTerrain(options: Record<string, unknown> | undefined): this;
    getCanvas(): HTMLCanvasElement;
    queryRenderedFeatures(point?: unknown, parameters?: Record<string, unknown>): GeoJSON.Feature[];
    querySourceFeatures(sourceId: string, parameters?: Record<string, unknown>): unknown[];
    flyTo(options: Record<string, unknown>): this;
    project(lnglat: [number, number]): { x: number; y: number };
    unproject(point: [number, number] | { x: number; y: number }): { lng: number; lat: number };
    remove(): void;
    dragPan: { enable(): void; disable(): void };
  }

  /** Payload MapLibre delivers for mouse events on the map (lngLat + screen point). */
  interface MapMouseEvent {
    lngLat: { lng: number; lat: number };
    point: { x: number; y: number };
  }

  class LngLatBounds {
    extend(point: [number, number] | { lng: number; lat: number }): this;
    isEmpty(): boolean;
    getCenter(): { lng: number; lat: number };
    getSouthWest(): { lng: number; lat: number };
    getNorthEast(): { lng: number; lat: number };
  }

  class Marker {
    constructor(options?: Record<string, unknown>);
    setLngLat(lnglat: [number, number]): this;
    addTo(map: Map): this;
    setPopup(popup: Popup): this;
    remove(): this;
  }

  class Popup {
    constructor(options?: Record<string, unknown>);
    setHTML(html: string): this;
  }

  // Constructor-only controls — declared as bare constructor types (a
  // constructor-only class trips no-extraneous-class, and these expose no
  // members this app touches).
  const NavigationControl: new (options?: Record<string, unknown>) => object;
  const GeolocateControl: new (options?: Record<string, unknown>) => object;
}

/** Type for the maplibregl global namespace object (returned by waitForMapLibre). */
interface MapLibreGL {
  Map: typeof maplibregl.Map;
  Marker: typeof maplibregl.Marker;
  Popup: typeof maplibregl.Popup;
  LngLatBounds: typeof maplibregl.LngLatBounds;
  NavigationControl: typeof maplibregl.NavigationControl;
  GeolocateControl: typeof maplibregl.GeolocateControl;
}

/** Minimal type for the topojson-client global. */
interface TopoJSONClient {
  feature(topology: unknown, object: unknown): GeoJSON.FeatureCollection;
}

interface Window {
  maplibregl?: MapLibreGL;
  topojson?: TopoJSONClient;
  _maplibreLoading?: Promise<void>;
}
