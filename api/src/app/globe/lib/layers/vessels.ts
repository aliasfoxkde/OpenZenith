import type { DataStatus } from "../types";

export function loadVessels(
  _viewer: any, _cesiumRef: any,
  updateStatus: (key: string, u: Partial<DataStatus>) => void,
) {
  // Placeholder - AIS data via proxy or public feed
  updateStatus("vessels", { lastUpdate: Date.now(), count: 0 });
}
