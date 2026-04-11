import type { DataStatus } from "../types";

export function loadNlnogNodes(viewer: any, Cesium: any, updateStatus: (key: string, u: Partial<DataStatus>) => void) {
  if (!Cesium || !viewer) return;

  const doLoad = async () => {
    try {
      updateStatus("nlnogNodes", { error: null });
      const res = await fetch("/api/nlnog");
      const data = await res.json();
      if (!data.nodes) {
        updateStatus("nlnogNodes", { error: "no data" });
        return;
      }
      const nodes = data.nodes as any[];
      const ds = Cesium.CustomDataSource("NLNOG Ring Nodes");

      for (const node of nodes) {
        ds.entities.add({
          id: `nlnog-${node.id}`,
          position: Cesium.Cartesian3.fromDegrees(node.lon, node.lat),
          point: {
            pixelSize: new Cesium.CallbackProperty(() => {
              return 4 + 2 * Math.sin(Date.now() / 800 + (node.id || 0));
            }, false),
            color: Cesium.Color.fromCssColorString("#f97316"),
            outlineColor: Cesium.Color.WHITE.withAlpha(0.3),
            outlineWidth: 1,
            scaleByDistance: new Cesium.NearFarScalar(1e5, 2.0, 5e6, 0.5),
          },
          label: {
            text: node.city || node.hostname,
            font: "10px sans-serif",
            style: Cesium.LabelStyle.FILL,
            fillColor: Cesium.Color.WHITE.withAlpha(0.8),
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 1,
            pixelOffset: new Cesium.Cartesian2(0, -10),
            showBackground: true,
            backgroundColor: new Cesium.Color(0, 0, 0, 0.6),
            backgroundPadding: new Cesium.Cartesian2(4, 3),
            scaleByDistance: new Cesium.NearFarScalar(1e5, 1.0, 3e6, 0.0),
          },
          properties: { type: "nlnog", asn: node.asn, hostname: node.hostname, country: node.country },
        });
      }

      const maxDistKm = 2000;
      let lineCount = 0;
      for (let i = 0; i < nodes.length && lineCount < 200; i++) {
        for (let j = i + 1; j < nodes.length && lineCount < 200; j++) {
          const a = nodes[i],
            b = nodes[j];
          const dLat = (b.lat - a.lat) * 111;
          const dLon = (b.lon - a.lon) * 111 * Math.cos(Cesium.Math.toRadians((a.lat + b.lat) / 2));
          const dist = Math.sqrt(dLat * dLat + dLon * dLon);
          if (dist < maxDistKm && dist > 100) {
            ds.entities.add({
              id: `nlnog-line-${lineCount}`,
              polyline: {
                positions: Cesium.Cartesian3.fromDegreesArray([a.lon, a.lat, b.lon, b.lat]),
                width: 1,
                material: new Cesium.PolylineGlowMaterialProperty({
                  glowPower: 0.1,
                  color: Cesium.Color.fromCssColorString("#f97316").withAlpha(0.2),
                }),
                clampToGround: true,
              },
              properties: { type: "nlnog-line" },
            });
            lineCount++;
          }
        }
      }

      viewer.dataSources.add(ds);
      updateStatus("nlnogNodes", { lastUpdate: Date.now(), count: nodes.length });
    } catch {
      updateStatus("nlnogNodes", { error: "fetch failed" });
    }
  };

  doLoad();
}
