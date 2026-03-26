import { elevationColor } from "../helpers";

export async function loadElevationColor(viewer: any, Cesium: any, entitiesRef: Record<string, any>) {
  if (!Cesium || !viewer) return;

  const camera = viewer.camera;
  const cg = camera.positionCartographic;
  const lng = Cesium.Math.toDegrees(cg.longitude);
  const lat = Cesium.Math.toDegrees(cg.latitude);
  const height = cg.height;

  // Skip in space mode — too many points, no visible terrain
  if (height > 5000000) return;

  const gridSize = height > 1000000 ? 12 : height > 200000 ? 18 : 24;
  const span = Math.min(height * 0.8, 2);
  const step = span / gridSize;

  const points: { lat: number; lon: number; id: string }[] = [];
  for (let i = 0; i <= gridSize; i++) {
    for (let j = 0; j <= gridSize; j++) {
      const pLat = lat - span / 2 + i * step;
      const pLon = lng - span / 2 + j * step;
      points.push({ lat: +pLat.toFixed(4), lon: +pLon.toFixed(4), id: `${i}-${j}` });
    }
  }

  try {
    const r = await fetch("/api/elevation/batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ points }),
    });
    if (!r.ok) return; // Batch endpoint unavailable — skip silently
    const data = await r.json();
    if (!data.results) return;

    if (entitiesRef.current["elev-points"]) {
      viewer.scene.primitives.remove(entitiesRef.current["elev-points"]);
    }

    const pointCollection = new Cesium.PointPrimitiveCollection();
    viewer.scene.primitives.add(pointCollection);

    for (const pt of data.results) {
      if (pt.elevation === null || pt.elevation < -9000) continue;
      const color = Cesium.Color.fromCssColorString(elevationColor(pt.elevation));
      pointCollection.add({
        position: Cesium.Cartesian3.fromDegrees(pt.lon, pt.lat, 0),
        pixelSize: 4,
        color: color.withAlpha(0.7),
        outlineColor: color.withAlpha(0.3),
        outlineWidth: 1,
        scaleByDistance: new Cesium.NearFarScalar(1e4, 1.5, 1e6, 0.5),
        translucencyByDistance: new Cesium.NearFarScalar(1e4, 1.0, 1e6, 0.2),
      });
    }

    entitiesRef.current["elev-points"] = pointCollection;
  } catch { /* batch fetch failed — skip silently */ }
}
