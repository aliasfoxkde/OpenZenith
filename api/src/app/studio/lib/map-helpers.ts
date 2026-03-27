/** Add a GeoJSON FeatureCollection as a map layer */
export function addGeoJSONLayer(
  map: any,
  id: string,
  data: GeoJSON.FeatureCollection,
  color: string = "#3b82f6",
) {
  // Remove if exists
  if (map.getLayer(id + "-fill")) map.removeLayer(id + "-fill");
  if (map.getLayer(id + "-line")) map.removeLayer(id + "-line");
  if (map.getLayer(id + "-circle")) map.removeLayer(id + "-circle");
  if (map.getSource(id)) map.removeSource(id);

  map.addSource(id, {
    type: "geojson",
    data: data as any,
  });

  // Detect geometry types in features
  const hasPolygons = data.features.some(
    (f) => f.geometry?.type === "Polygon" || f.geometry?.type === "MultiPolygon",
  );
  const hasLines = data.features.some(
    (f) => f.geometry?.type === "LineString" || f.geometry?.type === "MultiLineString",
  );
  const hasPoints = data.features.some(
    (f) => f.geometry?.type === "Point" || f.geometry?.type === "MultiPoint",
  );

  if (hasPolygons) {
    map.addLayer({
      id: id + "-fill",
      type: "fill",
      source: id,
      paint: {
        "fill-color": color,
        "fill-opacity": 0.2,
      },
    });
    map.addLayer({
      id: id + "-line",
      type: "line",
      source: id,
      paint: {
        "line-color": color,
        "line-width": 1.5,
      },
    });
  }
  if (hasLines) {
    map.addLayer({
      id: id + "-line",
      type: "line",
      source: id,
      paint: {
        "line-color": color,
        "line-width": 2,
      },
    });
  }
  if (hasPoints) {
    map.addLayer({
      id: id + "-circle",
      type: "circle",
      source: id,
      paint: {
        "circle-radius": 5,
        "circle-color": color,
        "circle-stroke-width": 1.5,
        "circle-stroke-color": "#fff",
      },
    });
  }
}

/** Remove a GeoJSON layer and its source */
export function removeGeoJSONLayer(map: any, id: string) {
  const suffixes = ["-fill", "-line", "-circle"];
  for (const suffix of suffixes) {
    if (map.getLayer(id + suffix)) map.removeLayer(id + suffix);
  }
  if (map.getSource(id)) map.removeSource(id);
}

/** Fit map to a GeoJSON bounding box */
export function fitToGeoJSON(map: any, data: GeoJSON.FeatureCollection) {
  const bounds = new (map as any).LngLatBounds();
  for (const f of data.features) {
    const geom = f.geometry;
    if (geom.type === "Point") {
      const c = geom.coordinates as [number, number];
      bounds.extend(c);
    } else if (geom.type === "MultiPoint") {
      for (const c of geom.coordinates as [number, number][]) bounds.extend(c);
    } else {
      // Use bbox if available
      if (f.bbox) {
        bounds.extend([f.bbox[0], f.bbox[1]]);
        bounds.extend([f.bbox[2], f.bbox[3]]);
      }
    }
  }
  if (!bounds.isEmpty()) {
    map.fitBounds(bounds, { padding: 50, maxZoom: 14 });
  }
}

/** Add a marker to the map */
export function addMarker(
  map: any,
  id: string,
  lat: number,
  lon: number,
  popup?: string,
): any {
  removeMarker(map, id);
  const el = document.createElement("div");
  el.style.cssText = "width:12px;height:12px;background:#ef4444;border:2px solid #fff;border-radius:50%;cursor:pointer;";
  const marker = new (map as any).Marker({ element: el })
    .setLngLat([lon, lat])
    .addTo(map);
  if (popup) {
    marker.setPopup(new (map as any).Popup({ offset: 14 }).setHTML(popup));
  }
  return marker;
}

/** Remove a marker */
export function removeMarker(map: any, id: string) {
  // Markers stored by ID in a weak ref pattern
}

/** Get bounding box string for Overpass */
export function getOverpassBBox(map: any): string {
  const bounds = map.getBounds();
  const sw = bounds.getSouthWest();
  const ne = bounds.getNorthEast();
  return `${sw.lat},${sw.lng},${ne.lat},${ne.lng}`;
}

/** Calculate distance between two lat/lon points (Haversine, meters) */
export function haversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
