/* eslint-disable @typescript-eslint/no-explicit-any */
import type { DataStatus } from "../types";

/**
 * Ocean currents visualization using particle flow animation.
 * Renders major ocean circulation patterns (Gulf Stream, Kuroshio, etc.)
 * as animated polyline particles flowing along known current paths.
 */

/** Major ocean current definitions (simplified flow paths) */
const OCEAN_CURRENTS = [
  // Gulf Stream (NW Atlantic)
  {
    name: "Gulf Stream",
    color: "#ff4444",
    width: 2.5,
    path: [
      [-80, 25],
      [-78, 30],
      [-75, 35],
      [-70, 38],
      [-65, 40],
      [-55, 42],
      [-45, 45],
      [-35, 50],
      [-20, 55],
    ],
  },
  // North Atlantic Drift
  {
    name: "N. Atlantic Drift",
    color: "#ff6666",
    width: 2,
    path: [
      [-20, 55],
      [-15, 58],
      [-10, 60],
      [-5, 62],
      [0, 63],
      [5, 64],
      [10, 65],
    ],
  },
  // Canary Current
  {
    name: "Canary Current",
    color: "#4488ff",
    width: 1.5,
    path: [
      [-15, 45],
      [-18, 40],
      [-20, 35],
      [-20, 28],
      [-18, 22],
      [-16, 15],
    ],
  },
  // North Equatorial Current (Atlantic)
  {
    name: "N. Equatorial (Atl)",
    color: "#4488ff",
    width: 1.5,
    path: [
      [-20, 15],
      [-30, 14],
      [-40, 13],
      [-50, 12],
      [-60, 11],
      [-70, 10],
    ],
  },
  // Caribbean Current
  {
    name: "Caribbean Current",
    color: "#44aaff",
    width: 1.5,
    path: [
      [-80, 10],
      [-78, 12],
      [-75, 14],
      [-72, 16],
      [-68, 18],
    ],
  },
  // South Equatorial Current (Atlantic)
  {
    name: "S. Equatorial (Atl)",
    color: "#4488ff",
    width: 1.5,
    path: [
      [-5, 0],
      [-10, -3],
      [-18, -5],
      [-25, -7],
      [-32, -8],
    ],
  },
  // Brazil Current
  {
    name: "Brazil Current",
    color: "#ff4444",
    width: 1.5,
    path: [
      [-35, -5],
      [-38, -10],
      [-42, -15],
      [-47, -20],
      [-50, -25],
      [-53, -30],
      [-55, -35],
    ],
  },
  // Kuroshio Current
  {
    name: "Kuroshio",
    color: "#ff4444",
    width: 2.5,
    path: [
      [125, 20],
      [128, 24],
      [132, 28],
      [136, 32],
      [140, 35],
      [145, 38],
      [150, 40],
      [155, 42],
      [160, 45],
    ],
  },
  // North Pacific Drift
  {
    name: "N. Pacific Drift",
    color: "#ff6666",
    width: 1.5,
    path: [
      [160, 45],
      [170, 45],
      [180, 43],
      [-170, 42],
      [-160, 40],
      [-150, 38],
    ],
  },
  // California Current
  {
    name: "California Current",
    color: "#4488ff",
    width: 1.5,
    path: [
      [-125, 45],
      [-124, 40],
      [-123, 35],
      [-122, 30],
      [-120, 25],
      [-118, 20],
    ],
  },
  // North Equatorial Current (Pacific)
  {
    name: "N. Equatorial (Pac)",
    color: "#4488ff",
    width: 1.5,
    path: [
      [-150, 12],
      [-140, 12],
      [-130, 11],
      [-120, 10],
      [-110, 9],
    ],
  },
  // South Equatorial Current (Pacific)
  {
    name: "S. Equatorial (Pac)",
    color: "#4488ff",
    width: 1.5,
    path: [
      [-80, -5],
      [-100, -5],
      [-120, -6],
      [-140, -7],
      [-160, -8],
      [-170, -9],
    ],
  },
  // East Australian Current
  {
    name: "E. Australian",
    color: "#ff4444",
    width: 1.5,
    path: [
      [155, -15],
      [154, -20],
      [153, -25],
      [152, -30],
      [150, -35],
      [148, -38],
    ],
  },
  // Agulhas Current
  {
    name: "Agulhas",
    color: "#ff4444",
    width: 2,
    path: [
      [38, -15],
      [37, -20],
      [35, -25],
      [32, -30],
      [28, -34],
      [22, -37],
    ],
  },
  // Antarctic Circumpolar
  {
    name: "Antarctic Circumpolar",
    color: "#00ccff",
    width: 2,
    path: [
      [0, -55],
      [30, -56],
      [60, -57],
      [90, -56],
      [120, -55],
      [150, -56],
      [180, -57],
      [-150, -56],
      [-120, -55],
      [-90, -56],
      [-60, -57],
      [-30, -56],
    ],
  },
  // Benguela Current
  {
    name: "Benguela",
    color: "#4488ff",
    width: 1.5,
    path: [
      [15, -32],
      [14, -28],
      [12, -24],
      [10, -20],
      [8, -15],
      [5, -10],
    ],
  },
  // Somali Current
  {
    name: "Somali Current",
    color: "#ff6666",
    width: 1.5,
    path: [
      [48, -2],
      [47, 2],
      [46, 6],
      [50, 10],
      [54, 12],
    ],
  },
  // Indian Ocean Gyre (South Equatorial)
  {
    name: "S. Equatorial (Ind)",
    color: "#4488ff",
    width: 1.5,
    path: [
      [90, -10],
      [80, -10],
      [70, -10],
      [60, -8],
      [50, -6],
    ],
  },
  // West Australian Current
  {
    name: "W. Australian",
    color: "#4488ff",
    width: 1.5,
    path: [
      [110, -12],
      [112, -18],
      [113, -24],
      [113, -30],
      [112, -35],
    ],
  },
];

/** Warm current: red/orange, Cold current: blue, Circumpolar: cyan */
function currentDescription(c: (typeof OCEAN_CURRENTS)[0]): string {
  const warm = c.color.startsWith("#ff");
  const type = warm ? "Warm Current" : "Cold Current";
  if (c.name.includes("Circumpolar")) return "Antarctic Circumpolar Current — Eastward flow around Antarctica";
  return `${c.name} — ${type}`;
}

export function loadCurrents(
  viewer: any,
  Cesium: any,
  updateStatus: (key: string, u: Partial<DataStatus>) => void,
  _removeEntities: (prefix: string) => void,
  _intervalsRef: React.MutableRefObject<ReturnType<typeof setInterval>[]>,
  _stateLayers: { currents: boolean },
) {
  updateStatus("currents", { error: null });

  const doLoad = () => {
    if (!Cesium || !viewer) return;

    const particlesPerCurrent = 5;
    let pIdx = 0;

    for (const current of OCEAN_CURRENTS) {
      const color = Cesium.Color.fromCssColorString(current.color);
      const positions = current.path.map(([lon, lat]) => Cesium.Cartesian3.fromDegrees(lon, lat));

      // ─── Static flow path ───
      viewer.entities.add({
        id: `current-path-${pIdx}`,
        polyline: {
          positions,
          width: current.width,
          material: new Cesium.PolylineGlowMaterialProperty({
            glowPower: 0.2,
            color: color.withAlpha(0.3),
          }),
        },
        properties: { type: "current-path", name: current.name },
      });

      // ─── Animated flow particles ───
      for (let p = 0; p < particlesPerCurrent; p++) {
        const offset = p / particlesPerCurrent;
        const segLen = 3; // How many path points the particle spans

        const particlePositions = new Cesium.CallbackProperty(() => {
          const totalPts = current.path.length;
          if (totalPts < 2) return positions;

          // Progress along path (0..1), cycling with offset
          const cycleSpeed = 0.0003; // Speed of particle movement
          const t = (Date.now() * cycleSpeed + offset) % 1;
          const startF = t * (totalPts - 1);
          const startI = Math.floor(startF);
          const endF = Math.min(startF + segLen, totalPts - 1);
          const endI = Math.floor(endF);

          if (startI >= totalPts - 1) return positions;

          const pts: CesiumType.Cartesian3[] = [];
          for (let i = startI; i <= Math.min(endI, totalPts - 1); i++) {
            pts.push(Cesium.Cartesian3.fromDegrees(current.path[i][0], current.path[i][1]));
          }
          return pts;
        }, false);

        viewer.entities.add({
          id: `current-particle-${pIdx}-${p}`,
          polyline: {
            positions: particlePositions,
            width: current.width + 1,
            material: color.withAlpha(0.7),
          },
          properties: { type: "current-particle", name: current.name },
        });
      }

      // ─── Current label at midpoint ───
      const midIdx = Math.floor(current.path.length / 2);
      const [midLon, midLat] = current.path[midIdx];
      viewer.entities.add({
        id: `current-label-${pIdx}`,
        position: Cesium.Cartesian3.fromDegrees(midLon, midLat),
        label: {
          text: current.name,
          font: "9px 'JetBrains Mono', monospace",
          fillColor: color.withAlpha(0.8),
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 1,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new Cesium.Cartesian2(0, -10),
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          showBackground: true,
          backgroundColor: Cesium.Color.BLACK.withAlpha(0.5),
          backgroundPadding: new Cesium.Cartesian2(3, 1),
          scaleByDistance: new Cesium.NearFarScalar(2e6, 1.0, 3e7, 0.0),
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 3e7),
        },
        description: currentDescription(current),
        properties: { type: "current-label", name: current.name },
      });

      pIdx++;
    }

    updateStatus("currents", { lastUpdate: Date.now(), count: OCEAN_CURRENTS.length });
  };

  doLoad();
}
