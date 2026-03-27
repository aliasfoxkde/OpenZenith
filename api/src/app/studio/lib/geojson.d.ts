declare namespace GeoJSON {
  type Position = number[];
  interface Point {
    type: "Point";
    coordinates: Position;
  }
  interface MultiPoint {
    type: "MultiPoint";
    coordinates: Position[];
  }
  interface LineString {
    type: "LineString";
    coordinates: Position[];
  }
  interface MultiLineString {
    type: "MultiLineString";
    coordinates: Position[][];
  }
  interface Polygon {
    type: "Polygon";
    coordinates: Position[][];
  }
  interface MultiPolygon {
    type: "MultiPolygon";
    coordinates: Position[][][];
  }
  interface Geometry {
    type: string;
    coordinates: any;
  }
  interface Feature {
    type: "Feature";
    geometry: Geometry | Point | MultiPoint | LineString | MultiLineString | Polygon | MultiPolygon;
    properties: Record<string, any>;
    bbox?: number[];
  }
  interface FeatureCollection {
    type: "FeatureCollection";
    features: Feature[];
  }
}
