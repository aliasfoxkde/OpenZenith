import { describe, expect, it } from "vitest";
import { buildEntityTooltip, escapeHtml } from "../tooltip";

/** Build a Cesium-entity-shaped object with lazily-evaluated properties. */
function entity(
  id: string,
  props: Record<string, unknown> = {},
  name = "",
): Parameters<typeof buildEntityTooltip>[0] {
  const properties: Record<string, { getValue: () => unknown }> = {};
  for (const [key, value] of Object.entries(props)) {
    properties[key] = { getValue: () => value };
  }
  return { id, name, properties };
}

describe("escapeHtml", () => {
  it("escapes every HTML-significant character", () => {
    expect(escapeHtml(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&#39;");
  });

  it("coerces non-strings", () => {
    expect(escapeHtml(7.5)).toBe("7.5");
    expect(escapeHtml(null)).toBe("null");
    expect(escapeHtml(undefined)).toBe("undefined");
  });
});

describe("buildEntityTooltip", () => {
  it("returns empty string for nullish and unknown entities", () => {
    expect(buildEntityTooltip(null)).toBe("");
    expect(buildEntityTooltip(undefined)).toBe("");
    expect(buildEntityTooltip(entity("mystery-1"))).toBe("");
  });

  it("renders earthquakes with magnitude and place", () => {
    const html = buildEntityTooltip(entity("eq-42", { mag: 6.4, place: "Chile" }));
    expect(html).toContain("M6.4");
    expect(html).toContain("Chile");
  });

  it("renders flights with imperial altitude and speed", () => {
    const html = buildEntityTooltip(
      entity("flight-abc", { altitude: 10000, velocity: 250 }, "UAL123"),
    );
    expect(html).toContain("UAL123");
    expect(html).toContain("Alt: 32810ft");
    expect(html).toContain("Spd: 486kts");
  });

  it("omits altitude and speed lines when the feed omits them", () => {
    const html = buildEntityTooltip(entity("mil-xyz", {}, "F16"));
    expect(html).toContain("F16");
    expect(html).not.toContain("Alt:");
    expect(html).not.toContain("Spd:");
  });

  it("renders vessels with the MMSI taken from the id", () => {
    const html = buildEntityTooltip(entity("vessel-123456789", {}, "Ever Given"));
    expect(html).toContain("Ever Given");
    expect(html).toContain("MMSI: 123456789");
  });

  it("renders satellites by id prefix with km altitude", () => {
    const html = buildEntityTooltip(entity("sat-25544", { altitude: 420000 }, "ISS"));
    expect(html).toContain("ISS");
    expect(html).toContain("Alt: 420km");
  });

  it("renders orbital-track entities without a sat- prefix", () => {
    const html = buildEntityTooltip(entity("track-9", { type: "orbitalTrack" }, "Hubble"));
    expect(html).toContain("Hubble");
  });

  it("labels storms, defaulting the name", () => {
    expect(buildEntityTooltip(entity("storm-1", {}, "Typhoon"))).toContain("Typhoon");
    expect(buildEntityTooltip(entity("storm-2"))).toContain("Storm");
  });

  it("renders events with category and title fallbacks", () => {
    const html = buildEntityTooltip(
      entity("event-7", { category: "wildfire", title: "Fire A" }),
    );
    expect(html).toContain("Fire A");
    expect(html).toContain("wildfire");
    // Title falls back to the entity name, then the literal "Event".
    expect(buildEntityTooltip(entity("event-8", { category: "" }, "Named"))).toContain("Named");
    expect(buildEntityTooltip(entity("event-9"))).toContain("Event");
  });

  it("falls back to the bare name for unrecognized prefixes", () => {
    expect(buildEntityTooltip(entity("other-1", {}, "Something"))).toBe(
      "<div>Something</div>",
    );
  });

  it("never lets a third-party name inject markup", () => {
    const html = buildEntityTooltip(
      entity("eq-13", { mag: 5, place: `<img src=x onerror="alert(1)">` }, "<script>"),
    );
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
  });
});
