/**
 * Level of Detail (LOD) system for the Globe viewer.
 *
 * Automatically hides/shows entity types based on camera altitude
 * to maintain performance at all zoom levels.
 */

export interface LODZone {
  name: string;
  minAlt: number;  // meters
  maxAlt: number;  // meters
  /** Entity prefixes that should be visible in this zone */
  visible: string[];
  /** Label for status bar */
  label: string;
}

/** LOD zone definitions — each covers an altitude range */
export const LOD_ZONES: LODZone[] = [
  {
    name: "earth",
    minAlt: 0,
    maxAlt: 500_000,
    label: "SURFACE",
    visible: [
      "eq-", "warn-", "event-", "flight-", "flight-vec-", "flight-trail-",
      "vessel-", "nlnog-", "mil-", "storm-dot-", "storm-", "storm-label-",
      "storm-spiral-", "storm-eye-", "storm-ring-", "radar-",
    ],
  },
  {
    name: "low-orbit",
    minAlt: 500_000,
    maxAlt: 5_000_000,
    label: "LOW ORBIT",
    visible: [
      "eq-", "warn-", "event-", "flight-", "flight-vec-", "flight-trail-",
      "vessel-", "nlnog-", "storm-", "storm-label-",
      "storm-spiral-", "storm-eye-", "storm-ring-", "sat-",
    ],
  },
  {
    name: "high-orbit",
    minAlt: 5_000_000,
    maxAlt: 50_000_000,
    label: "HIGH ORBIT",
    visible: [
      "eq-", "event-", "storm-", "storm-label-",
      "sat-", "sat-notable-", "sat-track-", "orbit-shell-",
    ],
  },
  {
    name: "deep-space",
    minAlt: 50_000_000,
    maxAlt: Infinity,
    label: "DEEP SPACE",
    visible: [
      "sat-", "sat-notable-", "sat-track-", "orbit-shell-",
    ],
  },
];

/** Entity prefixes grouped by type for quick lookup */
const ENTITY_PREFIXES: Record<string, string[]> = {
  earthquakes: ["eq-"],
  flights: ["flight-", "flight-vec-", "flight-trail-"],
  militaryFlights: ["mil-"],
  vessels: ["vessel-"],
  warnings: ["warn-"],
  events: ["event-"],
  satellites: ["sat-", "sat-notable-", "sat-track-", "orbit-shell-"],
  hurricanes: ["storm-", "storm-dot-", "storm-label-", "storm-spiral-", "storm-eye-", "storm-ring-"],
  nlnogNodes: ["nlnog-"],
  radar: ["radar-"],
};

/** Get the LOD zone for a given camera altitude */
export function getZoneForAltitude(alt: number): LODZone {
  return LOD_ZONES.find((z) => alt >= z.minAlt && alt < z.maxAlt) || LOD_ZONES[LOD_ZONES.length - 1];
}

/** Check if a given entity ID should be visible in the given zone */
export function isEntityVisibleInZone(entityId: string, zone: LODZone): boolean {
  for (const prefix of zone.visible) {
    if (entityId.startsWith(prefix)) return true;
  }
  return false;
}

/** Get the zone name for display */
export function getZoneLabel(alt: number): string {
  return getZoneForAltitude(alt).label;
}

/** Apply LOD to all entities in the viewer */
export function applyLOD(
  viewer: any,
  Cesium: any,
  currentAlt: number,
  currentZone: LODZone | null,
): LODZone {
  const zone = getZoneForAltitude(currentAlt);

  // Skip if zone hasn't changed
  if (currentZone && currentZone.name === zone.name) return zone;

  const allVisible = new Set(zone.visible);

  // Update entity show/hide
  const entities = viewer.entities.values;
  for (let i = 0; i < entities.length; i++) {
    const entity = entities[i];
    const id = entity.id || "";
    const type = entity.properties?.type?.getValue?.() || "";

    // Only manage LOD for known entity types
    let managed = false;
    for (const prefixes of Object.values(ENTITY_PREFIXES)) {
      for (const prefix of prefixes) {
        if (id.startsWith(prefix) || type.startsWith(prefix.replace("-", ""))) {
          managed = true;
          break;
        }
      }
      if (managed) break;
    }

    if (!managed) continue;

    entity.show = isEntityVisibleInZone(id, zone);
  }

  // Also manage point primitive collections (satellites use these)
  const primitives = viewer.scene.primitives;
  for (let i = 0; i < primitives.length; i++) {
    const p = primitives.get(i);
    if (p instanceof Cesium.PointPrimitiveCollection) {
      // Show satellite points only in orbit zones and above
      p.show = currentAlt >= 500_000;
    }
  }

  return zone;
}
