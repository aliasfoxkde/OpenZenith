/**
 * Hover-tooltip HTML builder for globe entities.
 *
 * Entity names, quake places, callsigns and event titles come from
 * third-party feeds (USGS, OpenSky, AIS, EONET) and are rendered through
 * `dangerouslySetInnerHTML` in the hover tooltip, so they must never be
 * trusted as HTML — every interpolated value goes through `escapeHtml`.
 */

export interface TooltipEntityProperty {
  getValue?: () => unknown;
}

export interface TooltipEntity {
  id?: string;
  name?: string;
  properties?: Record<string, TooltipEntityProperty | undefined>;
}

/**
 * Escape a third-party value for safe interpolation into tooltip HTML.
 */
export function escapeHtml(value: unknown): string {
  return String(value).replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case "&": return "&amp;";
      case "<": return "&lt;";
      case ">": return "&gt;";
      case '"': return "&quot;";
      default: return "&#39;";
    }
  });
}

/**
 * Build the hover tooltip body for a picked entity, or "" when the entity
 * has no tooltip-worthy content. Branches key off the entity id prefix,
 * falling back to the `orbitalTrack` property type and finally the name.
 */
export function buildEntityTooltip(ent: TooltipEntity | undefined | null): string {
  if (!ent) return "";

  const entType = ent.properties?.type?.getValue?.() || "";
  const entName = ent.name || "";
  const entId = ent.id || "";
  let html = "";
  if (entId.startsWith("eq-")) {
    const mag = ent.properties?.mag?.getValue?.() || "";
    const place = ent.properties?.place?.getValue?.() || "";
    html = `<div style="font-weight:700;color:var(--err)">M${escapeHtml(mag)}</div><div>${escapeHtml(place)}</div>`;
  } else if (entId.startsWith("flight-") || entId.startsWith("mil-")) {
    const callsign = escapeHtml(entName);
    const alt = ent.properties?.altitude?.getValue?.() as number | undefined;
    const speed = ent.properties?.velocity?.getValue?.() as number | undefined;
    html = `<div style="font-weight:700;color:var(--warn)">${callsign}</div>${alt != null ? `<div>Alt: ${Math.round(alt * 3.281)}ft</div>` : ""}${speed != null ? `<div>Spd: ${Math.round(speed * 1.944)}kts</div>` : ""}`;
  } else if (entId.startsWith("vessel-")) {
    const name = escapeHtml(entName);
    const mmsi = escapeHtml(entId.replace("vessel-", ""));
    html = `<div style="font-weight:700;color:#4488ff">${name}</div><div>MMSI: ${mmsi}</div>`;
  } else if (entId.startsWith("sat-") || entType === "orbitalTrack") {
    const name = escapeHtml(entName);
    const alt = ent.properties?.altitude?.getValue?.() as number | undefined;
    html = `<div style="font-weight:700;color:#aa44ff">${name}</div>${alt != null ? `<div>Alt: ${(alt / 1000).toFixed(0)}km</div>` : ""}`;
  } else if (entId.startsWith("storm-")) {
    html = `<div style="font-weight:700;color:#ff00ff">${escapeHtml(entName || "Storm")}</div>`;
  } else if (entId.startsWith("event-")) {
    const cat = ent.properties?.category?.getValue?.() || "";
    const title = ent.properties?.title?.getValue?.() || entName || "Event";
    html = `<div style="font-weight:700">${escapeHtml(title)}</div><div style="color:var(--text-muted)">${escapeHtml(cat)}</div>`;
  } else if (entName) {
    html = `<div>${escapeHtml(entName)}</div>`;
  }
  return html;
}
