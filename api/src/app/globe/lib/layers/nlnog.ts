/* eslint-disable @typescript-eslint/no-explicit-any */
import { isAbort } from "../data-fetchers";
import { warnLayerError } from "@/lib/diagnostics";
import type { DataStatus } from "../types";

/** Node shape served by /api/nlnog. */
interface NlnogNode {
  id: number;
  hostname: string;
  asn: number;
  city: string;
  country: string;
  lat: number;
  lon: number;
}

/**
 * Renders the NLNOG Ring node network as a `CustomDataSource("NLNOG Ring
 * Nodes")` added to `viewer.dataSources`: a 5px orange (#f97316) point with a
 * city/hostname label per node, plus up to 200 ground-clamped glow polylines
 * joining node pairs 100-2000 km apart (distance is a flat ~111 km/degree
 * approximation, not geodesic). One-shot live fetch of `GET /api/nlnog`, the
 * edge-cached proxy for the NLNOG Ring API at api.ring.nlnog.net/1.0/nodes;
 * coordinates are degrees. No polling interval and no cleanup helper — a reload
 * adds a second data source, and the globe page's toggle-off path clears
 * entities whose id starts with `nlnog-`. Reports node count or error through
 * `updateStatus("nlnogNodes")`. Returns nothing.
 */
export function loadNlnogNodes(viewer: any, Cesium: any, updateStatus: (key: string, u: Partial<DataStatus>) => void,
  signal?: AbortSignal,) {
  if (!Cesium || !viewer) return;

  const doLoad = async () => {
    try {
      updateStatus("nlnogNodes", { error: null });
      const res = await fetch("/api/nlnog", { signal });
      const data = await res.json();
      if (!data.nodes) {
        updateStatus("nlnogNodes", { error: "no data" });
        return;
      }
      const nodes = data.nodes as NlnogNode[];
      const ds = Cesium.CustomDataSource("NLNOG Ring Nodes");

      for (const node of nodes) {
        ds.entities.add({
          id: `nlnog-${node.id}`,
          position: Cesium.Cartesian3.fromDegrees(node.lon, node.lat),
          point: {
            pixelSize: 5,
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
    } catch (err) {
      if (isAbort(err)) return; // teardown, not a failure
      warnLayerError("nlnogNodes", err);
      updateStatus("nlnogNodes", {
        error: "fetch failed" });
    }
  };

  void doLoad();
}
