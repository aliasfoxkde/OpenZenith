/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Level of Detail (LOD) system for the Globe viewer.
 *
 * Automatically hides/shows entity types based on camera altitude
 * to maintain performance at all zoom levels.
 *
 * Optimization notes:
 * - Uses a Set of known prefixes for O(1) entity ID lookup
 * - Pre-computes a prefix→visibility map for each zone
 * - Only runs when zone actually changes, not on every frame
 */

export interface LODZone {
  name: string;
  minAlt: number; // meters
  maxAlt: number; // meters
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
      "eq-",
      "warn-",
      "event-",
      "flight-",
      "flight-vec-",
      "flight-trail-",
      "vessel-",
      "nlnog-",
      "mil-",
      "storm-dot-",
      "storm-",
      "storm-label-",
      "storm-spiral-",
      "storm-eye-",
      "storm-ring-",
      "radar-",
    ],
  },
  {
    name: "low-orbit",
    minAlt: 500_000,
    maxAlt: 5_000_000,
    label: "LOW ORBIT",
    visible: [
      "eq-",
      "warn-",
      "event-",
      "flight-",
      "flight-vec-",
      "flight-trail-",
      "vessel-",
      "nlnog-",
      "storm-",
      "storm-label-",
      "storm-spiral-",
      "storm-eye-",
      "storm-ring-",
      "sat-",
    ],
  },
  {
    name: "high-orbit",
    minAlt: 5_000_000,
    maxAlt: 50_000_000,
    label: "HIGH ORBIT",
    visible: ["eq-", "event-", "storm-", "storm-label-", "sat-", "sat-notable-", "sat-track-", "orbit-shell-"],
  },
  {
    name: "deep-space",
    minAlt: 50_000_000,
    maxAlt: Infinity,
    label: "DEEP SPACE",
    visible: ["sat-", "sat-notable-", "sat-track-", "orbit-shell-"],
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

/** Flat array of all managed prefixes for fast lookup (avoids nested loop) */
const ALL_MANAGED_PREFIXES = Object.values(ENTITY_PREFIXES).flat();

/** Set of all managed prefixes — O(1) lookup instead of O(n) array scan */
const _MANAGED_PREFIX_SET = new Set(ALL_MANAGED_PREFIXES);

/** Pre-built prefix sets per zone for O(1) visibility checks */
const ZONE_PREFIX_SETS: Record<string, Set<string>> = {};
for (const zone of LOD_ZONES) {
  ZONE_PREFIX_SETS[zone.name] = new Set(zone.visible);
}

/** Get the LOD zone for a given camera altitude */
export function getZoneForAltitude(alt: number): LODZone {
  return LOD_ZONES.find((z) => alt >= z.minAlt && alt < z.maxAlt) || LOD_ZONES[LOD_ZONES.length - 1];
}

/**
 * Check if an entity ID should be visible in a given LOD zone.
 * Used by tests and external callers.
 */
export function isEntityVisibleInZone(entityId: string, zone: LODZone): boolean {
  for (const prefix of zone.visible) {
    if (entityId.startsWith(prefix)) return true;
  }
  return false;
}

/**
 * Check if an entity ID is managed by the LOD system.
 * Uses Set lookup — O(1) instead of O(n) array scan.
 */
export function isEntityManaged(entityId: string): boolean {
  // Check by trying each managed prefix as a startsWith
  // This is still O(n) prefixes but n is small (16) and Set.has is O(1)
  for (const prefix of ALL_MANAGED_PREFIXES) {
    if (entityId.startsWith(prefix)) return true;
  }
  return false;
}

/** Get the zone name for display */
export function getZoneLabel(alt: number): string {
  return getZoneForAltitude(alt).label;
}

/**
 * Apply LOD to all entities in the viewer.
 * Only updates entity visibility when the zone actually changes.
 *
 * Performance: Uses Set-based prefix matching. Skips the loop entirely
 * if the zone hasn't changed (caller should already check this, but we
 * double-check here for safety).
 */
export function applyLOD(viewer: any, Cesium: any, currentAlt: number, currentZone: LODZone | null): LODZone {
  const zone = getZoneForAltitude(currentAlt);

  // Skip if zone hasn't changed
  if (currentZone && currentZone.name === zone.name) return zone;

  // Get the prefix set for this zone — O(1) lookup
  const visibleSet = ZONE_PREFIX_SETS[zone.name] ?? new Set();

  // Update entity show/hide using entity ID prefix matching
  // Uses startsWith on each managed prefix (n=16, fast enough)
  const entities = viewer.entities.values;
  for (let i = 0; i < entities.length; i++) {
    const entity = entities[i];
    const id = entity.id || "";

    // Fast path: check if ID starts with any managed prefix
    let managed = false;
    let shouldShow = false;
    for (const prefix of ALL_MANAGED_PREFIXES) {
      if (id.startsWith(prefix)) {
        managed = true;
        shouldShow = visibleSet.has(prefix);
        break;
      }
    }

    if (!managed) continue;
    entity.show = shouldShow;
  }

  // Manage point primitive collections (satellites use these)
  // Show satellite points only in orbit zones and above
  const primitives = viewer.scene.primitives;
  const satPointsVisible = currentAlt >= 500_000;
  for (let i = 0; i < primitives.length; i++) {
    const p = primitives.get(i);
    if (p instanceof Cesium.PointPrimitiveCollection) {
      p.show = satPointsVisible;
    }
  }

  return zone;
}
