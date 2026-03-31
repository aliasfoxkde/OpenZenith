import type { UploadedDataset } from "./types";
import { DATASET_COLORS } from "./constants";

let datasetCounter = 0;

/** Parse a GeoJSON string into a FeatureCollection */
export function parseGeoJSON(text: string): GeoJSON.FeatureCollection {
  const data = JSON.parse(text);
  if (data.type === "FeatureCollection") return data;
  if (data.type === "Feature") return { type: "FeatureCollection", features: [data] };
  if (data.type === "Geometry") return { type: "FeatureCollection", features: [{ type: "Feature", geometry: data, properties: {} }] };
  // Array of features or coordinates
  if (Array.isArray(data)) {
    if (data.length > 0 && data[0].type === "Feature") return { type: "FeatureCollection", features: data };
    // Assume array of [lon, lat] coordinates
    return {
      type: "FeatureCollection",
      features: data.map((c: any) => ({
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: c },
        properties: {},
      })),
    };
  }
  throw new Error("Unrecognized GeoJSON structure");
}

/** Parse CSV text into a GeoJSON FeatureCollection */
export function parseCSV(text: string): { data: GeoJSON.FeatureCollection; headers: string[] } {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) throw new Error("CSV must have at least a header and one data row");

  // Detect delimiter
  const delimiter = lines[0].includes("\t") ? "\t" : ",";

  const headers = lines[0].split(delimiter).map((h) => h.trim().replace(/^["']|["']$/g, ""));

  // Find lat/lon columns (case-insensitive)
  const latIdx = headers.findIndex((h) => /^(lat|latitude|y)$/i.test(h));
  const lonIdx = headers.findIndex((h) => /^(lon|lng|longitude|x)$/i.test(h));

  if (latIdx === -1 || lonIdx === -1) {
    throw new Error(`CSV must have lat/lon columns. Found: ${headers.join(", ")}`);
  }

  const features: GeoJSON.Feature[] = [];
  for (let i = 1; i < lines.length; i++) {
    const vals = lines[i].split(delimiter).map((v) => v.trim().replace(/^["']|["']$/g, ""));
    if (vals.length < headers.length) continue;

    const lat = parseFloat(vals[latIdx]);
    const lon = parseFloat(vals[lonIdx]);
    if (isNaN(lat) || isNaN(lon)) continue;

    const props: Record<string, string | number> = {};
    for (let j = 0; j < headers.length; j++) {
      if (j === latIdx || j === lonIdx) continue;
      const num = parseFloat(vals[j]);
      props[headers[j]] = isNaN(num) ? vals[j] : num;
    }

    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [lon, lat] },
      properties: props,
    });
  }

  return {
    data: { type: "FeatureCollection", features },
    headers,
  };
}

/** Parse GPX text into a GeoJSON FeatureCollection */
export function parseGPX(text: string): GeoJSON.FeatureCollection {
  const parser = new DOMParser();
  const doc = parser.parseFromString(text, "text/xml");
  const features: GeoJSON.Feature[] = [];

  // Parse waypoints
  const wpts = doc.querySelectorAll("wpt");
  for (const wpt of wpts) {
    const lat = parseFloat(wpt.getAttribute("lat") || "0");
    const lon = parseFloat(wpt.getAttribute("lon") || "0");
    const name = wpt.querySelector("name")?.textContent || "";
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [lon, lat] },
      properties: { name, type: "waypoint" },
    });
  }

  // Parse tracks
  const trks = doc.querySelectorAll("trk");
  for (const trk of trks) {
    const name = trk.querySelector("name")?.textContent || "";
    const trksegs = trk.querySelectorAll("trkseg");
    for (const seg of trksegs) {
      const coords: [number, number][] = [];
      const pts = seg.querySelectorAll("trkpt");
      for (const pt of pts) {
        const lat = parseFloat(pt.getAttribute("lat") || "0");
        const lon = parseFloat(pt.getAttribute("lon") || "0");
        coords.push([lon, lat]);
      }
      if (coords.length > 1) {
        features.push({
          type: "Feature",
          geometry: { type: "LineString", coordinates: coords },
          properties: { name, type: "track" },
        });
      }
    }
  }

  // Parse routes
  const rtes = doc.querySelectorAll("rte");
  for (const rte of rtes) {
    const name = rte.querySelector("name")?.textContent || "";
    const rpts = rte.querySelectorAll("rtept");
    const coords: [number, number][] = [];
    for (const pt of rpts) {
      const lat = parseFloat(pt.getAttribute("lat") || "0");
      const lon = parseFloat(pt.getAttribute("lon") || "0");
      coords.push([lon, lat]);
    }
    if (coords.length > 1) {
      features.push({
        type: "Feature",
        geometry: { type: "LineString", coordinates: coords },
        properties: { name, type: "route" },
      });
    }
  }

  return { type: "FeatureCollection", features };
}

/** Parse KML text into a GeoJSON FeatureCollection */
export function parseKML(text: string): GeoJSON.FeatureCollection {
  const parser = new DOMParser();
  const doc = parser.parseFromString(text, "text/xml");
  const features: GeoJSON.Feature[] = [];

  // Parse Placemarks
  const placemarks = doc.querySelectorAll("Placemark");
  for (const pm of placemarks) {
    const name = pm.querySelector("name")?.textContent || "";
    const desc = pm.querySelector("description")?.textContent || "";

    // Point
    const point = pm.querySelector("Point coordinates");
    if (point) {
      const coords = point.textContent!.trim().split(/\s+/).map(Number);
      if (coords.length >= 2) {
        features.push({
          type: "Feature",
          geometry: { type: "Point", coordinates: [coords[0], coords[1]] },
          properties: { name, description: desc },
        });
        continue;
      }
    }

    // LineString
    const line = pm.querySelector("LineString coordinates");
    if (line) {
      const coords = line
        .textContent!.trim()
        .split(/\s+/)
        .reduce((acc: [number, number][], _, i, arr) => {
          if (i % 3 === 0) acc.push([Number(arr[i]), Number(arr[i + 1])]);
          return acc;
        }, []);
      if (coords.length > 1) {
        features.push({
          type: "Feature",
          geometry: { type: "LineString", coordinates: coords },
          properties: { name, description: desc },
        });
        continue;
      }
    }

    // Polygon (with inner boundary / hole support)
    const outerRing = pm.querySelector("Polygon outerBoundaryIs LinearRing coordinates");
    if (outerRing) {
      const parseRing = (el: Element): [number, number][] =>
        el.textContent!.trim().split(/\s+/).reduce((acc: [number, number][], _, i, arr) => {
          if (i % 3 === 0) acc.push([Number(arr[i]), Number(arr[i + 1])]);
          return acc;
        }, []);

      const outerCoords = parseRing(outerRing);
      if (outerCoords.length > 3) {
        const innerRings = [...pm.querySelectorAll("Polygon innerBoundaryIs LinearRing coordinates")]
          .map(parseRing)
          .filter((r) => r.length > 3);
        features.push({
          type: "Feature",
          geometry: { type: "Polygon", coordinates: [outerCoords, ...innerRings] },
          properties: { name, description: desc },
        });
      }
      continue;
    }

    // MultiGeometry
    const multi = pm.querySelector("MultiGeometry");
    if (multi) {
      const extractGeoms = (container: Element): GeoJSON.Geometry[] => {
        const geoms: GeoJSON.Geometry[] = [];
        for (const child of Array.from(container.children)) {
          const tag = child.tagName;
          if (tag === "Point") {
            const coords = child.querySelector("coordinates")?.textContent?.trim().split(/\s+/).map(Number);
            if (coords && coords.length >= 2) geoms.push({ type: "Point", coordinates: [coords[0], coords[1]] });
          } else if (tag === "LineString") {
            const lineCoords = child.querySelector("coordinates")?.textContent?.trim().split(/\s+/).reduce((acc: [number, number][], _, i, arr) => {
              if (i % 3 === 0) acc.push([Number(arr[i]), Number(arr[i + 1])]);
              return acc;
            }, []);
            if (lineCoords && lineCoords.length > 1) geoms.push({ type: "LineString", coordinates: lineCoords });
          } else if (tag === "Polygon") {
            const outer = child.querySelector("outerBoundaryIs LinearRing coordinates");
            if (outer) {
              const outerCoords = outer.textContent!.trim().split(/\s+/).reduce((acc: [number, number][], _, i, arr) => {
                if (i % 3 === 0) acc.push([Number(arr[i]), Number(arr[i + 1])]);
                return acc;
              }, []);
              const inners = [...child.querySelectorAll("innerBoundaryIs LinearRing coordinates")].map((el) =>
                el.textContent!.trim().split(/\s+/).reduce((acc: [number, number][], _, i, arr) => {
                  if (i % 3 === 0) acc.push([Number(arr[i]), Number(arr[i + 1])]);
                  return acc;
                }, []),
              ).filter((r) => r.length > 3);
              if (outerCoords.length > 3) geoms.push({ type: "Polygon", coordinates: [outerCoords, ...inners] });
            }
          } else if (tag === "MultiGeometry") {
            geoms.push(...extractGeoms(child));
          }
        }
        return geoms;
      };

      const geoms = extractGeoms(multi);
      if (geoms.length > 0) {
        // Determine unified type
        const types = new Set(geoms.map((g) => g.type));
        if (types.size === 1) {
          const t = geoms[0].type as "Point" | "LineString" | "Polygon";
          features.push({
            type: "Feature",
            geometry: {
              type: `Multi${t}` as "MultiPoint" | "MultiLineString" | "MultiPolygon",
              coordinates: geoms.map((g) => g.coordinates),
            },
            properties: { name, description: desc },
          });
        } else {
          // Mixed types — emit as separate features
          for (const geom of geoms) {
            features.push({ type: "Feature", geometry: geom, properties: { name, description: desc } });
          }
        }
      }
    }
  }

  return { type: "FeatureCollection", features };
}

/** Auto-detect format and parse file */
export function parseFile(
  text: string,
  fileName: string,
): { data: GeoJSON.FeatureCollection; format: string; headers?: string[] } {
  const ext = fileName.toLowerCase().split(".").pop();

  if (ext === "geojson" || ext === "json") {
    return { data: parseGeoJSON(text), format: "GeoJSON" };
  }
  if (ext === "csv" || ext === "tsv") {
    const result = parseCSV(text);
    return { data: result.data, format: ext === "tsv" ? "TSV" : "CSV", headers: result.headers };
  }
  if (ext === "gpx") {
    return { data: parseGPX(text), format: "GPX" };
  }
  if (ext === "kml") {
    return { data: parseKML(text), format: "KML" };
  }

  // Try auto-detect
  try {
    const parsed = JSON.parse(text);
    if (parsed.type && parsed.type.includes("Feature")) {
      return { data: parseGeoJSON(text), format: "GeoJSON" };
    }
  } catch {
    // Not JSON
  }

  // Try CSV
  if (text.includes(",") || text.includes("\t")) {
    try {
      const result = parseCSV(text);
      return { data: result.data, format: "CSV", headers: result.headers };
    } catch {
      // Not CSV
    }
  }

  // Try GPX
  if (text.includes("<gpx") || text.includes("<wpt")) {
    try {
      return { data: parseGPX(text), format: "GPX" };
    } catch {
      // Not GPX
    }
  }

  // Try KML
  if (text.includes("<kml") || text.includes("<Placemark")) {
    try {
      return { data: parseKML(text), format: "KML" };
    } catch {
      // Not KML
    }
  }

  throw new Error("Could not detect file format");
}

/** Create an UploadedDataset from parsed data */
export function createDataset(
  data: GeoJSON.FeatureCollection,
  fileName: string,
  format: string,
  headers?: string[],
): UploadedDataset {
  const id = `dataset-${++datasetCounter}`;
  const colorIndex = datasetCounter % DATASET_COLORS.length;
  return {
    id,
    name: fileName,
    format,
    featureCount: data.features.length,
    visible: true,
    color: DATASET_COLORS[colorIndex],
    data,
    ...(headers ? { headers } : {}),
  };
}
