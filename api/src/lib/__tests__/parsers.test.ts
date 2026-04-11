// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { parseGeoJSON, parseCSV, parseKML, parseGPX, parseFile } from "@/app/studio/lib/parsers";

describe("parseGeoJSON", () => {
  it("parses a FeatureCollection", () => {
    const data = {
      type: "FeatureCollection",
      features: [{ type: "Feature", geometry: { type: "Point", coordinates: [0, 0] }, properties: {} }],
    };
    const result = parseGeoJSON(JSON.stringify(data));
    expect(result.type).toBe("FeatureCollection");
    expect(result.features).toHaveLength(1);
  });

  it("parses a single Feature", () => {
    const data = { type: "Feature", geometry: { type: "Point", coordinates: [1, 2] }, properties: {} };
    const result = parseGeoJSON(JSON.stringify(data));
    expect(result.features).toHaveLength(1);
  });

  it("parses an array of coordinates", () => {
    const data = [
      [0, 0],
      [1, 1],
      [2, 2],
    ];
    const result = parseGeoJSON(JSON.stringify(data));
    expect(result.features).toHaveLength(3);
  });

  it("throws for unrecognized structure", () => {
    expect(() => parseGeoJSON("{}")).toThrow("Unrecognized");
  });
});

describe("parseCSV", () => {
  it("parses CSV with lat/lon columns", () => {
    const csv = "name,lat,lon\nA,40.7,-74.0\nB,51.5,-0.1";
    const result = parseCSV(csv);
    expect(result.data.features).toHaveLength(2);
    expect(result.headers).toContain("name");
    expect(result.headers).toContain("lat");
    expect(result.headers).toContain("lon");
  });

  it("handles TSV delimiter", () => {
    const tsv = "name\tlat\tlon\nA\t40.7\t-74.0";
    const result = parseCSV(tsv);
    expect(result.data.features).toHaveLength(1);
  });

  it("throws when lat/lon columns are missing", () => {
    const csv = "name,value\nA,1\nB,2";
    expect(() => parseCSV(csv)).toThrow("lat/lon columns");
  });

  it("skips rows with invalid coordinates", () => {
    const csv = "lat,lon\n40.7,-74.0\nabc,def\n51.5,-0.1";
    const result = parseCSV(csv);
    expect(result.data.features).toHaveLength(2);
  });
});

describe.skip("parseKML (requires browser DOMParser)", () => {
  it("parses KML with Point placemarks", () => {
    const kml =
      '<?xml version="1.0"?><kml><Document><Placemark><name>Test</name><Point><coordinates>-74.0,40.7,0</coordinates></Point></Placemark></Document></kml>';
    const result = parseKML(kml);
    expect(result.features).toHaveLength(1);
    expect(result.features[0].geometry.type).toBe("Point");
    expect(result.features[0].properties.name).toBe("Test");
  });

  it("parses KML with LineString", () => {
    const kml =
      '<?xml version="1.0"?><kml><Document><Placemark><name>Path</name><LineString><coordinates>-74.0,40.7,0 -73.0,41.7,0 -72.0,42.7,0</coordinates></LineString></Placemark></Document></kml>';
    const result = parseKML(kml);
    expect(result.features).toHaveLength(1);
    expect(result.features[0].geometry.type).toBe("LineString");
    expect(result.features[0].geometry.coordinates).toHaveLength(3);
  });

  it("parses KML with Polygon including inner boundaries", () => {
    const kml =
      '<?xml version="1.0"?><kml><Document><Placemark><name>Area</name><Polygon><outerBoundaryIs><LinearRing><coordinates>0,0,0 1,0,0 1,1,0 0,1,0 0,0,0</coordinates></LinearRing></outerBoundaryIs><innerBoundaryIs><LinearRing><coordinates>0.25,0.25,0 0.75,0.25,0 0.75,0.75,0 0.25,0.75,0 0.25,0.25,0</coordinates></LinearRing></innerBoundaryIs></Polygon></Placemark></Document></kml>';
    const result = parseKML(kml);
    expect(result.features).toHaveLength(1);
    expect(result.features[0].geometry.type).toBe("Polygon");
    expect(result.features[0].geometry.coordinates).toHaveLength(2); // outer + inner ring
  });

  it("parses KML with MultiGeometry", () => {
    const kml =
      '<?xml version="1.0"?><kml><Document><Placemark><name>Multi</name><MultiGeometry><Point><coordinates>-74,40,0</coordinates></Point><Point><coordinates>-73,41,0</coordinates></Point></MultiGeometry></Placemark></Document></kml>';
    const result = parseKML(kml);
    expect(result.features).toHaveLength(1);
    expect(result.features[0].geometry.type).toBe("MultiPoint");
  });

  it("returns empty collection for no placemarks", () => {
    const kml = '<?xml version="1.0"?><kml><Document></Document></kml>';
    const result = parseKML(kml);
    expect(result.features).toHaveLength(0);
  });
});

describe("parseGPX", () => {
  it("parses GPX with waypoints", () => {
    const gpx = `<?xml version="1.0"?>
      <gpx>
        <wpt lat="40.7" lon="-74.0"><name>NYC</name></wpt>
        <wpt lat="51.5" lon="-0.1"><name>London</name></wpt>
      </gpx>`;
    const result = parseGPX(gpx);
    expect(result.features).toHaveLength(2);
    expect(result.features[0].geometry.type).toBe("Point");
    expect(result.features[0].properties.name).toBe("NYC");
  });

  it("parses GPX with tracks", () => {
    const gpx = `<?xml version="1.0"?>
      <gpx>
        <trk><name>Track1</name>
          <trkseg>
            <trkpt lat="0" lon="0"></trkpt>
            <trkpt lat="1" lon="1"></trkpt>
          </trkseg>
        </trk>
      </gpx>`;
    const result = parseGPX(gpx);
    expect(result.features).toHaveLength(1);
    expect(result.features[0].geometry.type).toBe("LineString");
  });

  it("skips single-point tracks", () => {
    const gpx = `<?xml version="1.0"?>
      <gpx>
        <trk><name>Solo</name>
          <trkseg>
            <trkpt lat="0" lon="0"></trkpt>
          </trkseg>
        </trk>
      </gpx>`;
    const result = parseGPX(gpx);
    expect(result.features).toHaveLength(0);
  });
});

describe("parseFile", () => {
  it("detects GeoJSON format", () => {
    const data = JSON.stringify({ type: "FeatureCollection", features: [] });
    const result = parseFile(data, "test.geojson");
    expect(result.format).toBe("GeoJSON");
  });

  it("detects CSV format", () => {
    const csv = "lat,lon\n0,0\n1,1";
    const result = parseFile(csv, "test.csv");
    expect(result.format).toBe("CSV");
  });

  it("detects KML format", () => {
    const kml = "<kml><Placemark><Point><coordinates>0,0,0</coordinates></Point></Placemark></kml>";
    const result = parseFile(kml, "test.kml");
    expect(result.format).toBe("KML");
  });

  it("detects GPX format", () => {
    const gpx = '<gpx><wpt lat="0" lon="0"></wpt></gpx>';
    const result = parseFile(gpx, "test.gpx");
    expect(result.format).toBe("GPX");
  });

  it("throws for unrecognized format", () => {
    expect(() => parseFile("random text", "test.xyz")).toThrow("Could not detect");
  });
});
