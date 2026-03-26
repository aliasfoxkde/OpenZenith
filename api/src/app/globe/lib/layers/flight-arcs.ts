import type { DataStatus } from "../types";

export function loadFlightArcs(
  viewer: any, Cesium: any,
  updateStatus: (key: string, u: Partial<DataStatus>) => void,
) {
  if (!Cesium || !viewer) return;

  const doLoad = async () => {
    try {
      updateStatus("flightArcs", { error: null });
      const res = await fetch("https://opensky-network.org/api/states/all");
      const data = await res.json();
      if (!data.states) { updateStatus("flightArcs", { error: "no data" }); return; }
      const highAlt = data.states.filter((s: any[]) => s[5] != null && s[6] != null && (s[7] || 0) > 30000);
      const shuffled = highAlt.sort(() => Math.random() - 0.5).slice(0, 200);
      let arcCount = 0;

      for (let i = 0; i < shuffled.length - 1; i += 2) {
        const a = shuffled[i];
        const b = shuffled[i + 1];
        const lonA = a[5], latA = a[6], altA = a[7] || 0;
        const lonB = b[5], latB = b[6], altB = b[7] || 0;
        const dist = Math.sqrt((lonA - lonB) ** 2 + (latA - latB) ** 2);
        if (dist < 15 || dist > 80) continue;
        const positions: any[] = [];
        const segments = 30;
        for (let t = 0; t <= segments; t++) {
          const frac = t / segments;
          const lat = latA + (latB - latA) * frac;
          const lon = lonA + (lonB - lonA) * frac;
          const alt = Math.max(altA, altB) * (1 + 0.5 * Math.sin(Math.PI * frac));
          positions.push(Cesium.Cartesian3.fromDegrees(lon, lat, alt));
        }
        const altRatio = Math.max(altA, altB) / 45000;
        const color = Cesium.Color.fromHsl(0.6 - altRatio * 0.2, 0.8, 0.6, 0.3);
        viewer.entities.add({
          id: `arc-${arcCount}`,
          polyline: { positions, width: 1.5, material: new Cesium.ColorMaterialProperty({ color, transparent: true }) },
          properties: { type: "arc" },
        });
        arcCount++;
      }
      updateStatus("flightArcs", { lastUpdate: Date.now(), count: arcCount });
    } catch { updateStatus("flightArcs", { error: "fetch failed" }); }
  };

  doLoad();
}
