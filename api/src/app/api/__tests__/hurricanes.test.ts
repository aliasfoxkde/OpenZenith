import { describe, it, expect, vi } from "vitest";
import { mockRequest } from "./helpers";

// Route tests run without an R2 binding, where the real r2GetJson resolves
// null. The mock mirrors that default but lets individual tests plant a
// cache entry to drive the HIT path.
const r2State = vi.hoisted<{ cached?: unknown }>(() => ({ cached: undefined }));

vi.mock("@/lib/storage/r2-json-cache", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/storage/r2-json-cache")>();
  return { ...actual, r2GetJson: () => Promise.resolve(r2State.cached) };
});

const MOCK_IBTRACS = `SID,SEASON,BASIN,SUBBASIN,NAME,ISO_TIME,NATURE,LAT,LON,WMO_WIND,WMO_PRES,TRACK_TYPE
2024272N18284,2024,NA,NORTH_ATLANTIC,MILTON,2024-10-09 18:00:00,TS,22.8,-89.1,55,982,main
2024272N18284,2024,NA,NORTH_ATLANTIC,MILTON,2024-10-09 12:00:00,TS,23.0,-89.4,50,987,main`;

/** Typed body reader keeps the later storm-row suites off the unsafe-any lint path. */
interface HurricaneCollectionBody {
  features?: Array<{ properties: Record<string, unknown> }>;
}
async function geoJsonBody(resp: Response): Promise<HurricaneCollectionBody> {
  return (await resp.json()) as HurricaneCollectionBody;
}

const MOCK_SHORT_CSV = `SID,SEASON,BASIN,SUBBASIN,NAME,ISO_TIME,NATURE,LAT,LON,WMO_WIND,WMO_PRES,TRACK_TYPE
2024272N18284,2024,NA,NORTH_ATLANTIC,MILTON,2024-10-09 18:00:00,TS,22.8,-89.1,55,982,main`;

// One two-point storm per Saffir-Simpson rung (max wind drives the category).
// Line 2 mirrors IBTrACS's units row — the parser skips it (i starts at 2).
function ladderRow(
  sid: string,
  name: string,
  wind: number,
  iso: string,
  lat: string,
  lon: string,
): string {
  return `${sid},2024,NA,NORTH_ATLANTIC,${name},${iso},TS,${lat},${lon},${wind},982,main`;
}
const HEADER = "SID,SEASON,BASIN,SUBBASIN,NAME,ISO_TIME,NATURE,LAT,LON,WMO_WIND,WMO_PRES,TRACK_TYPE";
const UNITS = ",,,,yr,,,deg deg,deg deg,kts,mb,";
const MOCK_TRACK_LADDER = [
  HEADER,
  UNITS,
  ladderRow("c5", "NOT_NAMED", 140, "2024-10-09 18:00:00", "22.8", "-89.1"),
  ladderRow("c5", "NOT_NAMED", 130, "2024-10-09 12:00:00", "23.0", "-89.4"),
  ladderRow("c4", "IVAN", 120, "2024-10-09 18:00:00", "24.8", "-90.1"),
  ladderRow("c4", "IVAN", 110, "2024-10-09 12:00:00", "25.0", "-90.4"),
  ladderRow("c3", "III", 100, "2024-10-09 18:00:00", "26.8", "-91.1"),
  ladderRow("c3", "III", 95, "2024-10-09 12:00:00", "27.0", "-91.4"),
  ladderRow("c2", "II", 90, "2024-10-09 18:00:00", "28.8", "-92.1"),
  ladderRow("c2", "II", 85, "2024-10-09 12:00:00", "29.0", "-92.4"),
  ladderRow("c1", "I", 70, "2024-10-09 18:00:00", "30.8", "-93.1"),
  ladderRow("c1", "I", 65, "2024-10-09 12:00:00", "31.0", "-93.4"),
  ladderRow("ts", "TSTORM", 55, "2024-10-09 18:00:00", "32.8", "-94.1"),
  ladderRow("ts", "TSTORM", 50, "2024-10-09 12:00:00", "33.0", "-94.4"),
  ladderRow("td", "DEP", 20, "2024-10-09 18:00:00", "34.8", "-95.1"),
  ladderRow("td", "DEP", 15, "2024-10-09 12:00:00", "35.0", "-95.4"),
].join("\n");

describe("Hurricanes API", () => {
  it("skips storms with a single track point (line geometry needs 2+)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(MOCK_SHORT_CSV, { status: 200, headers: { "Content-Type": "text/csv" } }),
    );

    const { GET } = await import("@/app/api/hurricanes/route");
    const resp = await GET(mockRequest("/api/hurricanes?active=false"));
    expect(resp.status).toBe(200);
    const data = await resp.json();
    expect(data.type).toBe("FeatureCollection");
    expect(data.features).toHaveLength(0);
  });

  it("returns GeoJSON FeatureCollection", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(MOCK_IBTRACS, { status: 200, headers: { "Content-Type": "text/csv" } }),
    );

    const { GET } = await import("@/app/api/hurricanes/route");
    const resp = await GET(mockRequest("/api/hurricanes?active=false"));
    expect(resp.status).toBe(200);
    const data = await resp.json();
    expect(data.type).toBe("FeatureCollection");
    expect(data.features.length).toBeGreaterThan(0);
    expect(data.features[0].properties.name).toBe("MILTON");
    expect(data.features[0].properties.wind).toBe(50);
  });

  it("returns error on upstream failure", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("error", { status: 500 }));

    const { GET } = await import("@/app/api/hurricanes/route");
    const resp = await GET(mockRequest("/api/hurricanes"));
    expect(resp.status).toBe(200);
  });

  it("handles empty CSV response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("SID,SEASON\n", { status: 200, headers: { "Content-Type": "text/csv" } }),
    );

    const { GET } = await import("@/app/api/hurricanes/route");
    const resp = await GET(mockRequest("/api/hurricanes"));
    expect(resp.status).toBe(200);
    const data = await resp.json();
    expect(data.features).toHaveLength(0);
  });

  it("returns error on malformed CSV", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("not,csv,at,all", { status: 200 }),
    );

    const { GET } = await import("@/app/api/hurricanes/route");
    const resp = await GET(mockRequest("/api/hurricanes"));
    expect(resp.status).toBe(200);
  });

  it("handles CORS preflight OPTIONS", async () => {
    const { OPTIONS } = await import("@/app/api/hurricanes/route");
    const resp = OPTIONS();
    expect(resp.status).toBe(204);
  });

  it("serves an R2 cache hit with X-Cache HIT and skips upstream", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    r2State.cached = { type: "FeatureCollection", features: [{ type: "Feature" }] };

    try {
      const { GET } = await import("@/app/api/hurricanes/route");
      const resp = await GET(mockRequest("/api/hurricanes"));
      expect(resp.status).toBe(200);
      expect(resp.headers.get("X-Cache")).toBe("HIT");
      expect((await resp.json()).features).toHaveLength(1);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      r2State.cached = undefined;
    }
  });

  it("returns 200 with the thrown error message when upstream fetch rejects", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("boom"));

    const { GET } = await import("@/app/api/hurricanes/route");
    const resp = await GET(mockRequest("/api/hurricanes"));
    expect(resp.status).toBe(200);
    const data = await resp.json();
    expect(data.error).toBe("boom");
  });

  it("track=full returns MultiLineString tracks with Saffir-Simpson categories", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(MOCK_TRACK_LADDER, { status: 200 }),
    );

    const { GET } = await import("@/app/api/hurricanes/route");
    const resp = await GET(mockRequest("/api/hurricanes?track=full"));
    expect(resp.status).toBe(200);
    const data = await resp.json();

    // The active-only recency filter must NOT apply to full tracks, even with
    // the default active=true and 2024 timestamps.
    expect(data.features).toHaveLength(7);

    const bySid = new Map<string, Record<string, unknown>>(
      data.features.map((f: { properties: Record<string, unknown> }) => [f.properties.sid, f.properties]),
    );
    expect(bySid.get("c5")?.category).toBe(5);
    expect(bySid.get("c4")?.category).toBe(4);
    expect(bySid.get("c3")?.category).toBe(3);
    expect(bySid.get("c2")?.category).toBe(2);
    expect(bySid.get("c1")?.category).toBe(1);
    expect(bySid.get("ts")?.category).toBe(-1);
    expect(bySid.get("td")?.category).toBe(0);
    expect(bySid.get("c5")?.categoryLabel).toBe("Cat 5");
    expect(bySid.get("c1")?.categoryLabel).toBe("Cat 1");
    expect(bySid.get("ts")?.categoryLabel).toBe("Tropical Storm");
    expect(bySid.get("td")?.categoryLabel).toBe("Tropical Depression");
    // Category is driven by max wind across the track (140), not the last fix.
    expect(bySid.get("c5")?.wind).toBe(140);
    // NOT_NAMED is normalised to UNNAMED.
    expect(bySid.get("c5")?.name).toBe("UNNAMED");

    const geo = data.features.find(
      (f: { properties: { sid: string } }) => f.properties.sid === "c5",
    );
    expect(geo.geometry.type).toBe("MultiLineString");
    expect(geo.geometry.coordinates[0]).toEqual([
      [-89.1, 22.8],
      [-89.4, 23.0],
    ]);
  });

  it("track=full skips malformed rows, repeated headers and single-point storms", async () => {
    const messy = [
      HEADER,
      UNITS,
      ladderRow("good", "OK", 65, "2024-10-09 18:00:00", "22.8", "-89.1"),
      ladderRow("good", "OK", 60, "2024-10-09 12:00:00", "23.0", "-89.4"),
      "truncated,row", // too few columns
      `SID,SEASON,BASIN,SUBBASIN,NAME,ISO_TIME,NATURE,LAT,LON,WMO_WIND,WMO_PRES,TRACK_TYPE`, // header repeat in data
      ladderRow("nan", "NANLAT", 65, "2024-10-09 18:00:00", "n/a", "-89.1"), // NaN lat
      ladderRow("single", "ONEPT", 65, "2024-10-09 18:00:00", "22.8", "-89.1"), // only 1 track point
    ].join("\n");
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(messy, { status: 200 }));

    const { GET } = await import("@/app/api/hurricanes/route");
    const resp = await GET(mockRequest("/api/hurricanes?track=full"));
    const data = await resp.json();
    expect(data.features).toHaveLength(1);
    expect(data.features[0].properties.sid).toBe("good");
    expect(data.features[0].properties.trackPoints).toBe(2);
  });

  it("filters point features to storms active in the last 7 days", async () => {
    // MOCK_IBTRACS timestamps are 2024 — outside the 7-day cutoff, so the
    // default active=true drops them.
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(MOCK_IBTRACS, { status: 200 }),
    );

    const { GET } = await import("@/app/api/hurricanes/route");
    const resp = await GET(mockRequest("/api/hurricanes"));
    const data = await resp.json();
    expect(data.features).toHaveLength(0);
  });

  it("point mode skips short rows, repeated headers, blank sids and NaN fixes, and defaults blank fields", async () => {
    const messy = [
      HEADER,
      UNITS,
      "truncated,row", // too few columns
      ",,,", // no SID
      HEADER, // header repeat inside the data block
      "bad1,2024,NA,NORTH_ATLANTIC,BAD,2024-10-09 18:00:00,TS,n/a,-89.1,50,982,main", // NaN lat
      "ok1,,NA,NORTH_ATLANTIC,,,TS,22.8,-89.1,,,main", // blank name/season/time/wind/pressure
      "ok2,2024,NA,NORTH_ATLANTIC,IVAN,2024-10-09 18:00:00,TS,24.8,-90.1,120,945,main",
    ].join("\n");
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(messy, { status: 200 }));

    const { GET } = await import("@/app/api/hurricanes/route");
    const resp = await GET(mockRequest("/api/hurricanes?active=false"));
    const data = await geoJsonBody(resp);

    expect(data.features).toHaveLength(2);
    const bySid = new Map<unknown, Record<string, unknown>>(
      (data.features ?? []).map((f) => [f.properties.sid, f.properties] as const),
    );
    // Blank columns fall back to the documented defaults; zero wind and
    // pressure normalise to null, season to 0, name to UNNAMED.
    expect(bySid.get("ok1")).toMatchObject({
      name: "UNNAMED",
      season: 0,
      wind: null,
      pressure: null,
      category: 0,
      categoryLabel: "Tropical Depression",
      isoTime: "",
    });
    expect(bySid.get("ok2")).toMatchObject({ name: "IVAN", wind: 120, category: 4, categoryLabel: "Cat 4" });
  });

  it("returns an empty collection when the SID column is missing from a 3+ line CSV", async () => {
    const noSid = ["SEASON,BASIN", ",,", ",,"].join("\n");
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(noSid, { status: 200 }));

    const { GET } = await import("@/app/api/hurricanes/route");
    const resp = await GET(mockRequest("/api/hurricanes"));
    const data = await geoJsonBody(resp);
    expect(data.features).toHaveLength(0);
  });

  it("track mode defaults blank wind/name/season and reports a null max wind", async () => {
    const blanks = [
      HEADER,
      UNITS,
      "ghost,,NA,NORTH_ATLANTIC,,,TS,22.8,-89.1,,,main", // every optional field blank
      "ghost,,NA,NORTH_ATLANTIC,,,TS,23.0,-89.4,,,main",
    ].join("\n");
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(blanks, { status: 200 }));

    const { GET } = await import("@/app/api/hurricanes/route");
    const resp = await GET(mockRequest("/api/hurricanes?track=full&active=false"));
    const data = await geoJsonBody(resp);

    expect(data.features).toHaveLength(1);
    expect((data.features ?? [])[0]?.properties).toMatchObject({
      sid: "ghost",
      name: "UNNAMED",
      season: 0,
      wind: null, // maxWind 0 -> null
      category: 0,
      categoryLabel: "Tropical Depression",
      isoTime: "",
    });
  });
});
