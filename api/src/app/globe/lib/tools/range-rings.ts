/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Range rings — concentric circles drawn at a center point.
 */

export interface RangeRingState {
  active: boolean;
  center: { lat: number; lng: number } | null;
  radiiKm: number[];
  entities: any[];
}

export function createRangeRingManager(viewer: any, Cesium: any) {
  const state: RangeRingState = {
    active: false,
    center: null,
    radiiKm: [50, 100, 200, 500],
    entities: [],
  };

  const clear = () => {
    state.entities.forEach((e) => viewer.entities.remove(e));
    state.entities = [];
    state.active = false;
    state.center = null;
  };

  const placeAt = (lat: number, lng: number) => {
    clear();
    state.center = { lat, lng };
    state.active = true;

    for (const radiusKm of state.radiiKm) {
      // Convert km to degrees (approximate at equator, good enough for visualization)
      const radiusDeg = radiusKm / 111.32;
      const entity = viewer.entities.add({
        id: `ring-${radiusKm}km`,
        position: Cesium.Cartesian3.fromDegrees(lng, lat),
        ellipse: {
          semiMajorAxis: radiusDeg,
          semiMinorAxis: radiusDeg,
          material: Cesium.Color.fromCssColorString("#00ff88").withAlpha(0.4),
          outline: true,
          outlineColor: Cesium.Color.fromCssColorString("#00ff88").withAlpha(0.8),
          outlineWidth: 1,
          height: 0,
          classificationType: Cesium.ClassificationType.BOTH,
        },
        label: {
          text: `${radiusKm} km`,
          font: "10px 'JetBrains Mono', monospace",
          fillColor: Cesium.Color.fromCssColorString("#00ff88").withAlpha(0.9),
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 2,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new Cesium.Cartesian2(0, -12),
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          showBackground: true,
          backgroundColor: Cesium.Color.BLACK.withAlpha(0.6),
          backgroundPadding: new Cesium.Cartesian2(4, 2),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        properties: { type: "range-ring" },
      });
      state.entities.push(entity);
    }
  };

  const setRadii = (radiiKm: number[]) => {
    state.radiiKm = radiiKm;
    if (state.active && state.center) {
      placeAt(state.center.lat, state.center.lng);
    }
  };

  return { state, placeAt, setRadii, clear };
}
