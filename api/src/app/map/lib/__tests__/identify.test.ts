/**
 * Tests for the 2D map feature-identify resolver. The layer table is the
 * contract with the layer modules' MapLibre ids, and the row builders are the
 * contract with each feed's property shape — both are pinned here so a
 * renamed property or layer id fails loudly instead of rendering "undefined".
 */
import { describe, it, expect } from "vitest";

import { identifyAt, IDENTIFY_LAYERS } from "../identify";

/** A feature shaped the way MapLibre returns query hits (layer id attached). */
function hit(
  layerId: string,
  properties: Record<string, unknown>,
  coordinates: number[] = [0, 0],
): GeoJSON.Feature & { layer: { id: string } } {
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates },
    properties,
    layer: { id: layerId },
  };
}

/** In-memory map stand-in covering the two members identifyAt touches. */
function mockMap(hits: GeoJSON.Feature[]) {
  const queries: Array<{ point: unknown; layers: unknown }> = [];
  return {
    queries,
    queryRenderedFeatures(point: unknown, params?: Record<string, unknown>) {
      queries.push({ point, layers: params?.layers });
      return hits;
    },
    unproject(p: [number, number]) {
      return { lng: p[0] + 0.5, lat: p[1] + 0.25 };
    },
  };
}

type MockMap = ReturnType<typeof mockMap>;

function identify(map: MockMap, point: { x: number; y: number }) {
  return identifyAt(map, point);
}

const labels = (rows: Array<[string, string]>): string[] => rows.map(([label]) => label);

describe("IDENTIFY_LAYERS", () => {
  it("covers the queryable layer ids and nothing that shares their sources", () => {
    expect(Object.keys(IDENTIFY_LAYERS).sort()).toEqual(
      [
        "air-quality-circle",
        "buildings-fill",
        "earthquakes-circles",
        "flights-circles",
        "hurricanes-points",
        "military-points",
        "natural-events-points",
        "nlnog-circles",
        "satellites-points",
        "vessels-points",
        "volcanoes-points",
        "warnings-fill",
        "waterways-line",
        "wildfires-circles",
      ].sort(),
    );
  });

  it("gives every entry a registry id and display title", () => {
    for (const meta of Object.values(IDENTIFY_LAYERS)) {
      expect(meta.registryId).toBeTruthy();
      expect(meta.title).toBeTruthy();
    }
  });
});

describe("identifyAt", () => {
  it("returns null when nothing queryable is under the point", () => {
    const map = mockMap([]);
    expect(identify(map, { x: 10, y: 20 })).toBeNull();
    expect(map.queries[0]?.point).toEqual({ x: 10, y: 20 });
  });

  it("returns null when the query throws (style mid-swap)", () => {
    const map = mockMap([]);
    map.queryRenderedFeatures = () => {
      throw new Error("style is being modified");
    };
    expect(identify(map, { x: 1, y: 2 })).toBeNull();
  });

  it("queries only the table's layer ids, so glow/heatmap layers cannot hit", () => {
    const map = mockMap([hit("wildfires-heat", { confidence: 80 })]);
    expect(identify(map, { x: 3, y: 4 })).toBeNull();
    expect(map.queries[0]?.layers).toEqual(Object.keys(IDENTIFY_LAYERS));
  });

  it("shows the topmost hit only and dedupes by registry id", () => {
    const map = mockMap([
      hit("earthquakes-circles", { mag: 5.5 }, [1, 2]),
      hit("earthquakes-circles", { mag: 2.2 }, [3, 4]),
      hit("natural-events-points", { title: "Kilauea", category: "Volcanoes" }, [5, 6]),
    ]);
    const res = identify(map, { x: 7, y: 8 });
    expect(res?.registryId).toBe("earthquakes");
    expect(res?.rows).toEqual([["Magnitude", "M5.5"]]);
  });

  it("anchors the popup at the clicked position", () => {
    const res = identify(mockMap([hit("waterways-line", { name: "Thames" })]), { x: 10, y: 20 });
    expect(res?.lngLat).toEqual([10.5, 20.25]);
  });

  it("formats an earthquake: magnitude, place, depth from the geometry, time", () => {
    const res = identify(
      mockMap([
        hit(
          "earthquakes-circles",
          { mag: 4.32, place: "12 km NE of Ridgecrest, CA", time: 1760000000000 },
          [-117.5, 35.6, 8.4],
        ),
      ]),
      { x: 0, y: 0 },
    );
    expect(res?.registryId).toBe("earthquakes");
    expect(res?.title).toBe("Earthquakes");
    expect(res?.rows).toEqual([
      ["Magnitude", "M4.3"],
      ["Place", "12 km NE of Ridgecrest, CA"],
      ["Depth", "8.4 km"],
      ["Time", expect.stringMatching(/^\d+(s|min|h|d) ago · 2025-10-09 08:53Z$/)],
    ]);
  });

  it("drops the earthquake rows the feed left out", () => {
    const res = identify(mockMap([hit("earthquakes-circles", {}, [-117.5, 35.6])]), { x: 0, y: 0 });
    expect(res?.rows).toEqual([]);
  });

  it("formats a flight, converting m/s to km/h and reporting ground state", () => {
    const res = identify(
      mockMap([
        hit("flights-circles", {
          icao24: "a1b2c3",
          callsign: "UAL123",
          origin_country: "United States",
          velocity: 250,
          baro_altitude: 10999.4,
          on_ground: false,
        }),
      ]),
      { x: 0, y: 0 },
    );
    expect(res?.title).toBe("Flights (ADS-B)");
    expect(res?.rows).toEqual([
      ["Callsign", "UAL123"],
      ["ICAO24", "a1b2c3"],
      ["Origin", "United States"],
      ["Ground speed", "900.0 km/h"],
      ["Baro altitude", "10999 m"],
      ["On ground", "no"],
    ]);
  });

  it("formats a warning, clipping long headline and area text", () => {
    const res = identify(
      mockMap([
        hit("warnings-fill", {
          event: "Tornado Warning",
          severity: "Extreme",
          urgency: "Immediate",
          headline: "Tornado Warning headline. ".repeat(8),
          areaDesc: "A County; B County; C County",
          expires: 1760000000000,
        }),
      ]),
      { x: 0, y: 0 },
    );
    expect(res?.title).toBe("Weather Warnings");
    const headline = res?.rows.find(([label]) => label === "Headline")?.[1];
    expect(headline).toHaveLength(120);
    expect(headline?.endsWith("…")).toBe(true);
    expect(res?.rows).toEqual([
      ["Event", "Tornado Warning"],
      ["Severity", "Extreme"],
      ["Urgency", "Immediate"],
      ["Headline", headline ?? ""],
      ["Area", "A County; B County; C County"],
      ["Expires", expect.stringMatching(/ ago · 2025-10-09 08:53Z$/)],
    ]);
  });

  it("keeps only the warning rows the alert actually carries", () => {
    const res = identify(mockMap([hit("warnings-fill", { event: "Flood Advisory", headline: "" })]), {
      x: 0,
      y: 0,
    });
    expect(labels(res?.rows ?? [])).toEqual(["Event"]);
  });

  it("formats a vessel from the AIS accumulation shape", () => {
    const res = identify(
      mockMap([
        hit("vessels-points", {
          mmsi: 235009802,
          name: "EVER GIVEN",
          shipType: "Cargo",
          speed: 12.4,
          destination: "Rotterdam. ".repeat(10),
        }),
      ]),
      { x: 0, y: 0 },
    );
    expect(res?.title).toBe("Vessels (AIS)");
    expect(res?.rows).toEqual([
      ["Name", "EVER GIVEN"],
      ["MMSI", "235009802"],
      ["Ship type", "Cargo"],
      ["Speed", "12 kn"],
      ["Destination", expect.stringMatching(/^Rotterdam\..{0,79}…$/)],
    ]);
    const destination = res?.rows.find(([label]) => label === "Destination")?.[1];
    expect(destination).toHaveLength(80);
  });

  it("reads the flattened event category, falling back to the EONET array", () => {
    const flattened = identify(
      mockMap([hit("natural-events-points", { title: "Kilauea", category: "volcanoes", categoryLabel: "Volcanoes" })]),
      { x: 0, y: 0 },
    );
    expect(flattened?.rows).toEqual([
      ["Event", "Kilauea"],
      ["Category", "Volcanoes"],
    ]);

    const unflattened = identify(
      mockMap([
        hit("natural-events-points", {
          title: "Kilauea",
          categories: [{ id: "volcanoes", title: "Volcanoes" }],
        }),
      ]),
      { x: 0, y: 0 },
    );
    expect(unflattened?.rows).toEqual([
      ["Event", "Kilauea"],
      ["Category", "Volcanoes"],
    ]);
  });
});
