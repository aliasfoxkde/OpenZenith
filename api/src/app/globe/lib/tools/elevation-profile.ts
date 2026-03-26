/**
 * Globe Tool — Elevation Profile.
 *
 * Draws a line on the globe, samples terrain elevation along it,
 * and renders a cross-section chart in an overlay panel.
 * Uses the /api/elevation endpoint for sampling.
 */

import { formatDistance, haversineDistance, polylineLength } from "./measure";

export interface ProfilePoint {
  lng: number;
  lat: number;
  elev: number | null;
  dist: number; // cumulative distance from start in meters
}

interface ElevationProfileState {
  active: boolean;
  points: { lng: number; lat: number }[];
  profile: ProfilePoint[];
  resultEntities: any[];
}

export function createElevationProfile(viewer: any, Cesium: any) {
  const state: ElevationProfileState = {
    active: false,
    points: [],
    profile: [],
    resultEntities: [],
  };

  const clear = () => {
    state.active = false;
    state.points = [];
    state.profile = [];
    state.resultEntities.forEach((e) => viewer.entities.remove(e));
    state.resultEntities = [];
  };

  const addPoint = async (lng: number, lat: number) => {
    state.active = true;
    state.points.push({ lng, lat });
    updateLineEntities();

    if (state.points.length >= 2) {
      await sampleProfile();
    }
  };

  const updateLineEntities = () => {
    state.resultEntities.forEach((e) => viewer.entities.remove(e));
    state.resultEntities = [];

    const pts = state.points;
    if (pts.length < 1) return;

    // Line
    if (pts.length >= 2) {
      const positions = pts.flatMap((p) => [p.lng, p.lat]);
      const line = viewer.entities.add({
        id: "tool-profile-line",
        polyline: {
          positions: Cesium.Cartesian3.fromDegreesArray(positions),
          width: 3,
          material: new Cesium.PolylineGlowMaterialProperty({
            glowPower: 0.2,
            color: Cesium.Color.fromCssColorString("#ff4488"),
          }),
          clampToGround: true,
        },
        properties: { type: "tool-measure" },
      });
      state.resultEntities.push(line);
    }

    // Point markers
    for (let i = 0; i < pts.length; i++) {
      const pt = pts[i];
      const marker = viewer.entities.add({
        id: `tool-profile-pt-${i}`,
        position: Cesium.Cartesian3.fromDegrees(pt.lng, pt.lat),
        point: {
          pixelSize: i === 0 || i === pts.length - 1 ? 10 : 6,
          color: Cesium.Color.fromCssColorString("#ff4488"),
          outlineColor: Cesium.Color.WHITE,
          outlineWidth: 2,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        properties: { type: "tool-measure" },
      });
      state.resultEntities.push(marker);

      // Start/end labels
      if (i === 0 || i === pts.length - 1) {
        const label = viewer.entities.add({
          id: `tool-profile-label-${i}`,
          position: Cesium.Cartesian3.fromDegrees(pt.lng, pt.lat),
          label: {
            text: i === 0 ? "START" : "END",
            font: "bold 10px 'JetBrains Mono', monospace",
            fillColor: Cesium.Color.fromCssColorString("#ff4488"),
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 2,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            pixelOffset: new Cesium.Cartesian2(0, -16),
            verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
            showBackground: true,
            backgroundColor: Cesium.Color.BLACK.withAlpha(0.75),
            backgroundPadding: new Cesium.Cartesian2(4, 2),
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
          properties: { type: "tool-measure" },
        });
        state.resultEntities.push(label);
      }
    }

    // Total distance label at end
    if (pts.length >= 2) {
      const coords = pts.map((p) => [p.lng, p.lat] as number[]);
      const totalDist = polylineLength(coords);
      const last = pts[pts.length - 1];
      const distLabel = viewer.entities.add({
        id: "tool-profile-dist",
        position: Cesium.Cartesian3.fromDegrees(last.lng, last.lat),
        label: {
          text: formatDistance(totalDist),
          font: "bold 11px 'JetBrains Mono', monospace",
          fillColor: Cesium.Color.fromCssColorString("#ff4488"),
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 2,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new Cesium.Cartesian2(0, -30),
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          showBackground: true,
          backgroundColor: Cesium.Color.BLACK.withAlpha(0.75),
          backgroundPadding: new Cesium.Cartesian2(4, 2),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        properties: { type: "tool-measure" },
      });
      state.resultEntities.push(distLabel);
    }
  };

  const sampleProfile = async () => {
    const pts = state.points;
    if (pts.length < 2) return;

    // Interpolate points along the line (max ~100 samples)
    const coords = pts.map((p) => [p.lng, p.lat] as number[]);
    const totalDist = polylineLength(coords);
    const numSamples = Math.min(100, Math.max(20, Math.floor(totalDist / 500)));
    const stepDist = totalDist / (numSamples - 1);

    const profile: ProfilePoint[] = [];
    let cumulativeDist = 0;

    for (let i = 0; i < numSamples; i++) {
      const targetDist = i * stepDist;
      let currentDist = 0;
      let lng: number = coords[0][0];
      let lat: number = coords[0][1];

      // Find the segment for this distance
      for (let j = 0; j < coords.length - 1; j++) {
        const segDist = haversineDistance(
          coords[j][1], coords[j][0],
          coords[j + 1][1], coords[j + 1][0],
        );
        if (currentDist + segDist >= targetDist || j === coords.length - 2) {
          const frac = segDist > 0 ? (targetDist - currentDist) / segDist : 0;
          lng = coords[j][0] + frac * (coords[j + 1][0] - coords[j][0]);
          lat = coords[j][1] + frac * (coords[j + 1][1] - coords[j][1]);
          break;
        }
        currentDist += segDist;
        lng = coords[j + 1][0];
        lat = coords[j + 1][1];
      }

      // Fetch elevation
      try {
        const res = await fetch(`/api/elevation?lat=${lat.toFixed(6)}&lon=${lng.toFixed(6)}`);
        const data = await res.json();
        profile.push({ lng, lat, elev: data.elevation, dist: cumulativeDist });
      } catch {
        profile.push({ lng, lat, elev: null, dist: cumulativeDist });
      }
      cumulativeDist = targetDist;
    }

    // Fix: ensure last point is exact endpoint
    const lastPt = pts[pts.length - 1];
    try {
      const res = await fetch(`/api/elevation?lat=${lastPt.lat.toFixed(6)}&lon=${lastPt.lng.toFixed(6)}`);
      const data = await res.json();
      profile[profile.length - 1] = { ...profile[profile.length - 1], lng: lastPt.lng, lat: lastPt.lat, elev: data.elevation, dist: totalDist };
    } catch { /* keep last sampled value */ }

    state.profile = profile;
  };

  return { state, addPoint, clear };
}

/**
 * Render an elevation profile chart onto a canvas element.
 * Returns the canvas element (caller appends to DOM).
 */
export function renderProfileChart(
  profile: ProfilePoint[],
  width: number,
  height: number,
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width * (window.devicePixelRatio || 1);
  canvas.height = height * (window.devicePixelRatio || 1);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;

  const ctx = canvas.getContext("2d")!;
  const dpr = window.devicePixelRatio || 1;
  ctx.scale(dpr, dpr);

  const pad = { top: 20, right: 16, bottom: 32, left: 50 };
  const chartW = width - pad.left - pad.right;
  const chartH = height - pad.top - pad.bottom;

  // Background
  ctx.fillStyle = "rgba(0, 0, 0, 0.85)";
  ctx.fillRect(0, 0, width, height);

  // Border
  ctx.strokeStyle = "rgba(74, 158, 255, 0.3)";
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, width - 1, height - 1);

  if (profile.length < 2) {
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.font = "12px 'JetBrains Mono', monospace";
    ctx.textAlign = "center";
    ctx.fillText("Click 2+ points on the globe to create a profile", width / 2, height / 2);
    return canvas;
  }

  const elevs = profile.filter((p) => p.elev != null).map((p) => p.elev as number);
  if (elevs.length === 0) {
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.font = "12px 'JetBrains Mono', monospace";
    ctx.textAlign = "center";
    ctx.fillText("No elevation data available for this path", width / 2, height / 2);
    return canvas;
  }

  const minElev = Math.min(...elevs);
  const maxElev = Math.max(...elevs);
  const elevRange = maxElev - minElev || 1;
  const maxDist = profile[profile.length - 1].dist || 1;

  // Title
  ctx.fillStyle = "#ff4488";
  ctx.font = "bold 11px 'JetBrains Mono', monospace";
  ctx.textAlign = "left";
  ctx.fillText("ELEVATION PROFILE", pad.left, 14);

  // Stats
  ctx.fillStyle = "rgba(255,255,255,0.6)";
  ctx.font = "9px 'JetBrains Mono', monospace";
  ctx.textAlign = "right";
  ctx.fillText(
    `Min: ${minElev.toFixed(0)}m  Max: ${maxElev.toFixed(0)}m  Gain: ${(maxElev - minElev).toFixed(0)}m`,
    width - pad.right,
    14,
  );

  // Grid lines
  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.lineWidth = 0.5;
  const numGridY = 4;
  for (let i = 0; i <= numGridY; i++) {
    const y = pad.top + (chartH / numGridY) * i;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(pad.left + chartW, y);
    ctx.stroke();

    // Y-axis labels
    const elevVal = maxElev - (elevRange / numGridY) * i;
    ctx.fillStyle = "rgba(255,255,255,0.4)";
    ctx.font = "9px 'JetBrains Mono', monospace";
    ctx.textAlign = "right";
    ctx.fillText(`${elevVal.toFixed(0)}m`, pad.left - 4, y + 3);
  }

  // X-axis labels
  const numGridX = 5;
  for (let i = 0; i <= numGridX; i++) {
    const x = pad.left + (chartW / numGridX) * i;
    const distVal = (maxDist / numGridX) * i;
    ctx.fillStyle = "rgba(255,255,255,0.4)";
    ctx.font = "9px 'JetBrains Mono', monospace";
    ctx.textAlign = "center";
    ctx.fillText(formatDistance(distVal), x, height - 8);
  }

  // Draw fill gradient
  ctx.beginPath();
  let firstValid = true;
  for (const pt of profile) {
    if (pt.elev == null) { firstValid = true; continue; }
    const x = pad.left + (pt.dist / maxDist) * chartW;
    const y = pad.top + chartH - ((pt.elev - minElev) / elevRange) * chartH;
    if (firstValid) { ctx.moveTo(x, y); firstValid = false; }
    else ctx.lineTo(x, y);
  }
  // Close fill to bottom
  const lastValidX = pad.left + ((profile[profile.length - 1].dist || 0) / maxDist) * chartW;
  ctx.lineTo(lastValidX, pad.top + chartH);
  const firstValidPt = profile.find((p) => p.elev != null);
  if (firstValidPt) {
    ctx.lineTo(pad.left + (firstValidPt.dist / maxDist) * chartW, pad.top + chartH);
  }
  ctx.closePath();
  const gradient = ctx.createLinearGradient(0, pad.top, 0, pad.top + chartH);
  gradient.addColorStop(0, "rgba(255, 68, 136, 0.3)");
  gradient.addColorStop(1, "rgba(255, 68, 136, 0.02)");
  ctx.fillStyle = gradient;
  ctx.fill();

  // Draw line
  ctx.beginPath();
  firstValid = true;
  for (const pt of profile) {
    if (pt.elev == null) { firstValid = true; continue; }
    const x = pad.left + (pt.dist / maxDist) * chartW;
    const y = pad.top + chartH - ((pt.elev - minElev) / elevRange) * chartH;
    if (firstValid) { ctx.moveTo(x, y); firstValid = false; }
    else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = "#ff4488";
  ctx.lineWidth = 2;
  ctx.stroke();

  // Start/end dots
  if (profile[0]?.elev != null) {
    const sx = pad.left;
    const sy = pad.top + chartH - ((profile[0].elev - minElev) / elevRange) * chartH;
    ctx.beginPath();
    ctx.arc(sx, sy, 4, 0, Math.PI * 2);
    ctx.fillStyle = "#00ff88";
    ctx.fill();
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  const last = profile[profile.length - 1];
  if (last?.elev != null) {
    const ex = pad.left + (last.dist / maxDist) * chartW;
    const ey = pad.top + chartH - ((last.elev - minElev) / elevRange) * chartH;
    ctx.beginPath();
    ctx.arc(ex, ey, 4, 0, Math.PI * 2);
    ctx.fillStyle = "#ff4488";
    ctx.fill();
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  return canvas;
}
