export function loadGroundTracks(viewer: any, Cesium: any) {
  const satJs = (window as any).satellite;
  if (!Cesium || !viewer || !satJs) return;

  const notable = [
    { name: "ISS", catnr: 25544 },
    { name: "Hubble", catnr: 20580 },
    { name: "Tiangong", catnr: 48274 },
  ];
  const now = Date.now();
  let count = 0;

  const loadTrack = async (sat: typeof notable[0]) => {
    try {
      const r = await fetch(`/api/proxy/https://celestrak.org/NORAD/elements/gp.php?CATNR=${sat.catnr}&FORMAT=json`);
      const data = await r.json();
      if (!Array.isArray(data) || !data[0]?.TLE_LINE1) return;
      const tle = data[0];
      const satrec = satJs.twoline2satrec(tle.TLE_LINE1, tle.TLE_LINE2);
      const positions: any[] = [];
      for (let i = 0; i <= 200; i++) {
        const date = new Date(now + i * 30000);
        const posVel = satJs.propagate(satrec, date);
        if (!posVel.position) continue;
        const gd = satJs.eciToGeodetic(posVel.position, satJs.gstime(date));
        const lon = satJs.degreesLong(gd.longitude);
        const lat = satJs.degreesLat(gd.latitude);
        positions.push(Cesium.Cartesian3.fromDegrees(lon, lat, 0));
      }
      if (positions.length < 2) return;
      viewer.entities.add({
        id: `gtrack-${count}`,
        polyline: {
          positions,
          width: 1.5,
          material: new Cesium.PolylineGlowMaterialProperty({ glowPower: 0.1, color: Cesium.Color.CYAN.withAlpha(0.3) }),
          clampToGround: true,
        },
        properties: { type: "groundTrack", name: sat.name },
      });
      count++;
    } catch { /* skip */ }
  };

  Promise.all(notable.map(loadTrack));
}
