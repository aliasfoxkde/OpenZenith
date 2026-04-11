/**
 * Globe Tool — Elevation Profile.
 *
 * Draws a line on the globe, samples terrain elevation along it,
 * and renders a cross-section chart in an overlay panel.
 * Uses the /api/elevation endpoint for sampling.
 */

import { formatDistance, haversineDistance, polylineLength } from "./measure";
import { getClientElevationBatch } from "@/lib/client-elevation";

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
    const samplePoints: Array<{ lat: number; lon: number; dist: number }> = [];

    for (let i = 0; i < numSamples; i++) {
      const targetDist = i * stepDist;
      let currentDist = 0;
      let lng: number = coords[0][0];
      let lat: number = coords[0][1];

      // Find the segment for this distance
      for (let j = 0; j < coords.length - 1; j++) {
        const segDist = haversineDistance(coords[j][1], coords[j][0], coords[j + 1][1], coords[j + 1][0]);
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

      samplePoints.push({ lat, lon: lng, dist: targetDist });
    }

    // Fix: ensure last point is exact endpoint
    const lastPt = pts[pts.length - 1];
    samplePoints[samplePoints.length - 1] = { lat: lastPt.lat, lon: lastPt.lng, dist: totalDist };

    // Batch fetch all elevations in one call
    const batchResults = await getClientElevationBatch(
      samplePoints.map((p, i) => ({ lat: p.lat, lon: p.lon, id: String(i) })),
    );

    for (let i = 0; i < batchResults.length; i++) {
      const r = batchResults[i];
      profile.push({ lng: r.lon, lat: r.lat, elev: r.elevation, dist: samplePoints[i].dist });
    }

    state.profile = profile;
  };

  return { state, addPoint, clear };
}

/**
 * Render an elevation profile chart onto a canvas element.
 * Returns the canvas element (caller appends to DOM).
 */
export function renderProfileChart(profile: ProfilePoint[], width: number, height: number): HTMLCanvasElement {
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
    ctx.fillText("Click 2+ points on the globe to create a profile", width / 2, height / 2);
    return canvas;
  }

  const minElev = Math.min(0, ...elevs);
  const maxElev = Math.max(0, ...elevs);
  const elevRange = maxElev - minElev || 1;
  const maxDist = profile[profile.length - 1].dist || 1;
  const hasUnderwater = minElev < 0;
  const hasLand = maxElev > 0;

  // Title
  ctx.fillStyle = "#ff4488";
  ctx.font = "bold 11px 'JetBrains Mono', monospace";
  ctx.textAlign = "left";
  ctx.fillText("ELEVATION PROFILE", pad.left, 14);

  // Stats
  ctx.fillStyle = "rgba(255,255,255,0.6)";
  ctx.font = "9px 'JetBrains Mono', monospace";
  ctx.textAlign = "right";
  const statsParts = [`Min: ${minElev.toFixed(0)}m  Max: ${maxElev.toFixed(0)}m`];
  if (hasUnderwater && hasLand) statsParts.push("Depth: " + Math.abs(minElev).toFixed(0) + "m");
  else if (hasUnderwater) statsParts.push("Max depth: " + Math.abs(minElev).toFixed(0) + "m");
  ctx.fillText(statsParts.join("  "), width - pad.right, 14);

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

  // Sea level line (0m) — only if the range crosses zero
  if (hasUnderwater && hasLand) {
    const seaY = pad.top + chartH - ((0 - minElev) / elevRange) * chartH;
    ctx.strokeStyle = "rgba(100, 180, 255, 0.5)";
    ctx.lineWidth = 1;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(pad.left, seaY);
    ctx.lineTo(pad.left + chartW, seaY);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = "rgba(100, 180, 255, 0.5)";
    ctx.font = "8px 'JetBrains Mono', monospace";
    ctx.textAlign = "left";
    ctx.fillText("SEA LEVEL", pad.left + 2, seaY - 3);
  }

  // Draw fill gradient — green for above water, blue for below
  ctx.beginPath();
  let firstValid = true;
  for (const pt of profile) {
    if (pt.elev == null) {
      firstValid = true;
      continue;
    }
    const x = pad.left + (pt.dist / maxDist) * chartW;
    const y = pad.top + chartH - ((pt.elev - minElev) / elevRange) * chartH;
    if (firstValid) {
      ctx.moveTo(x, y);
      firstValid = false;
    } else ctx.lineTo(x, y);
  }
  // Close fill to bottom
  const lastValidX = pad.left + ((profile[profile.length - 1].dist || 0) / maxDist) * chartW;
  ctx.lineTo(lastValidX, pad.top + chartH);
  const firstValidPt = profile.find((p) => p.elev != null);
  if (firstValidPt) {
    ctx.lineTo(pad.left + (firstValidPt.dist / maxDist) * chartW, pad.top + chartH);
  }
  ctx.closePath();

  if (hasUnderwater && hasLand) {
    // Two-tone gradient: blue below sea level, green above
    const seaY = pad.top + chartH - ((0 - minElev) / elevRange) * chartH;
    const gradient = ctx.createLinearGradient(0, pad.top, 0, pad.top + chartH);
    gradient.addColorStop(0, "rgba(34, 197, 94, 0.3)");
    gradient.addColorStop(Math.max(0, (seaY - pad.top) / chartH - 0.01), "rgba(34, 197, 94, 0.15)");
    gradient.addColorStop(Math.min(1, (seaY - pad.top) / chartH + 0.01), "rgba(59, 130, 246, 0.15)");
    gradient.addColorStop(1, "rgba(59, 130, 246, 0.3)");
    ctx.fillStyle = gradient;
  } else if (hasUnderwater) {
    const gradient = ctx.createLinearGradient(0, pad.top, 0, pad.top + chartH);
    gradient.addColorStop(0, "rgba(59, 130, 246, 0.15)");
    gradient.addColorStop(1, "rgba(59, 130, 246, 0.3)");
    ctx.fillStyle = gradient;
  } else {
    const gradient = ctx.createLinearGradient(0, pad.top, 0, pad.top + chartH);
    gradient.addColorStop(0, "rgba(34, 197, 94, 0.3)");
    gradient.addColorStop(1, "rgba(34, 197, 94, 0.02)");
    ctx.fillStyle = gradient;
  }
  ctx.fill();

  // Draw line — color segments by above/below water when profile crosses sea level
  if (hasUnderwater && hasLand) {
    // Two-color line: green above, blue below
    const drawSegment = (startX: number, startY: number, endX: number, endY: number, underwater: boolean) => {
      ctx.beginPath();
      ctx.moveTo(startX, startY);
      ctx.lineTo(endX, endY);
      ctx.strokeStyle = underwater ? "#3b82f6" : "#22c55e";
      ctx.lineWidth = 2;
      ctx.stroke();
    };

    let prevX = 0;
    let prevY = 0;
    let prevValid = false;
    let prevUnderwater = false;

    for (const pt of profile) {
      if (pt.elev == null) {
        prevValid = false;
        continue;
      }
      const x = pad.left + (pt.dist / maxDist) * chartW;
      const y = pad.top + chartH - ((pt.elev - minElev) / elevRange) * chartH;
      const underwater = pt.elev < 0;

      if (prevValid && underwater !== prevUnderwater) {
        // Segment crosses sea level — interpolate the crossing point
        const seaY = pad.top + chartH - ((0 - minElev) / elevRange) * chartH;
        const t = (seaY - prevY) / (y - prevY);
        const crossX = prevX + t * (x - prevX);

        drawSegment(prevX, prevY, crossX, seaY, prevUnderwater);
        drawSegment(crossX, seaY, x, y, underwater);
      } else if (prevValid) {
        drawSegment(prevX, prevY, x, y, underwater);
      }

      prevX = x;
      prevY = y;
      prevValid = true;
      prevUnderwater = underwater;
    }
  } else {
    // Single-color line
    ctx.beginPath();
    firstValid = true;
    for (const pt of profile) {
      if (pt.elev == null) {
        firstValid = true;
        continue;
      }
      const x = pad.left + (pt.dist / maxDist) * chartW;
      const y = pad.top + chartH - ((pt.elev - minElev) / elevRange) * chartH;
      if (firstValid) {
        ctx.moveTo(x, y);
        firstValid = false;
      } else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = hasUnderwater ? "#3b82f6" : "#22c55e";
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  // Start/end dots
  if (profile[0]?.elev != null) {
    const sx = pad.left;
    const sy = pad.top + chartH - ((profile[0].elev - minElev) / elevRange) * chartH;
    ctx.beginPath();
    ctx.arc(sx, sy, 4, 0, Math.PI * 2);
    ctx.fillStyle = profile[0].elev < 0 ? "#60a5fa" : "#22c55e";
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
    ctx.fillStyle = last.elev < 0 ? "#60a5fa" : "#22c55e";
    ctx.fill();
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  return canvas;
}
