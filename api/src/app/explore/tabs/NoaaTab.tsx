/**
 * NOAA & USGS tab of the Data Explorer: dataset catalog, point-based NWS
 * inputs, and the results renderers (GeoJSON quakes, NWS forecast periods,
 * NWS alerts, NHC storms, EONET events, raw JSON fallback). Extracted
 * verbatim from explore/page.tsx; fetch state stays in the page so filters
 * survive tab switches.
 */
import type { EonetEvent, GeoFeature, NoaaData, NoaaForecastPeriod, NwsAlertProperties } from "../data";
import { NOAA_DATASETS, magBg, magColor } from "../data";

interface NoaaTabProps {
  selected: number;
  data: NoaaData | null;
  error: string;
  loading: boolean;
  nwsLat: string;
  nwsLon: string;
  onSelectDataset: (index: number) => void;
  onNwsLatChange: (value: string) => void;
  onNwsLonChange: (value: string) => void;
  onFetch: () => void;
}

export function NoaaTab({
  selected,
  data,
  error,
  loading,
  nwsLat,
  nwsLon,
  onSelectDataset,
  onNwsLatChange,
  onNwsLonChange,
  onFetch,
}: NoaaTabProps) {
  return (
    <>
      <h2>NOAA &amp; USGS Data Sources</h2>
      <p style={{ fontSize: "0.8rem", color: "#a3a3a3", margin: "0 0 1rem" }}>
        Access weather warnings, hurricane data, earthquake feeds, and NASA natural events via our CORS proxy.
      </p>

      <div className="ex-ds-grid" style={{ marginBottom: "1.25rem" }}>
        {NOAA_DATASETS.map((ds, i) => (
          <div
            key={i}
            className={`ex-ds-card ${selected === i ? "selected" : ""}`}
            onClick={() => {
              onSelectDataset(i);
            }}
          >
            <div className="ex-row" style={{ marginBottom: "0.4rem" }}>
              <span className={`ex-badge ${ds.source === "USGS" ? "usgs" : ds.source === "NASA" ? "nasa" : "noaa"}`}>
                {ds.source}
              </span>
            </div>
            <div style={{ fontWeight: 600, fontSize: "0.88rem", marginBottom: "0.2rem" }}>{ds.label}</div>
            <div style={{ fontSize: "0.78rem", color: "#a3a3a3", lineHeight: 1.45 }}>{ds.desc}</div>
            {ds.url === null && (
              <div className="ex-row" style={{ marginTop: "0.5rem", gap: "0.3rem" }}>
                <input
                  style={{ width: 90, fontSize: "0.78rem", padding: "0.3rem 0.5rem" }}
                  placeholder="lat"
                  aria-label="NWS alert latitude"
                  value={nwsLat}
                  onClick={(e) => { e.stopPropagation(); }}
                  onChange={(e) => { onNwsLatChange(e.target.value); }}
                />
                <input
                  style={{ width: 90, fontSize: "0.78rem", padding: "0.3rem 0.5rem" }}
                  placeholder="lon"
                  aria-label="NWS alert longitude"
                  value={nwsLon}
                  onClick={(e) => { e.stopPropagation(); }}
                  onChange={(e) => { onNwsLonChange(e.target.value); }}
                />
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="ex-row">
        <button className="primary" onClick={onFetch} disabled={loading}>
          {loading ? "Fetching..." : "Fetch Data"}
        </button>
        <span style={{ fontSize: "0.72rem", color: "#a3a3a3" }}>Via /api/proxy</span>
      </div>

      {error && (
        <div className="ex-card" style={{ borderColor: "rgba(239,68,68,0.3)", marginTop: "1rem" }}>
          <span className="ex-badge err">Error</span> {error}
        </div>
      )}

      {data && (
        <div style={{ marginTop: "1rem" }}>
          <h3>Results: {NOAA_DATASETS[selected].label}</h3>
          {/* Earthquakes GeoJSON */}
          {data.features && (
            <div>
              <div className="ex-stat">
                <span className="num">{data.features.length}</span> features
              </div>
              {data.metadata?.generated && (
                <div className="ex-stat">
                  <span style={{ color: "#a3a3a3" }}>Generated:</span>{" "}
                  {new Date(data.metadata.generated).toLocaleString()}
                </div>
              )}
              <div className="ex-quake-list" style={{ marginTop: "0.5rem" }}>
                {data.features.slice(0, 60).map((f: GeoFeature, i: number) => {
                  const p = f.properties;
                  const coords = f.geometry?.coordinates as number[] | undefined;
                  const mag = p.mag || p.magnitude;
                  return (
                    <div key={i} className="ex-quake-item">
                      {mag != null && (
                        <div className="ex-quake-mag" style={{ color: magColor(mag), background: magBg(mag) }}>
                          {mag.toFixed(1)}
                        </div>
                      )}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: "0.82rem", fontWeight: 500, color: "#ccc", marginBottom: "0.1rem" }}>
                          {p.place || p.title || p.name || p.event || "(unnamed)"}
                        </div>
                        <div className="ex-row" style={{ fontSize: "0.72rem", color: "#a3a3a3" }}>
                          {coords && (
                            <span>
                              {coords[1]?.toFixed(3)}, {coords[0]?.toFixed(3)}
                            </span>
                          )}
                          {p.depth != null && (
                            <>
                              <span className="ex-sep" />
                              <span>Depth: {typeof p.depth === "number" ? p.depth.toFixed(1) : p.depth} km</span>
                            </>
                          )}
                          {p.type && (
                            <>
                              <span className="ex-sep" />
                              <span>{p.type}</span>
                            </>
                          )}
                          {p.eventType && (
                            <>
                              <span className="ex-sep" />
                              <span>{p.eventType}</span>
                            </>
                          )}
                        </div>
                      </div>
                      <div style={{ fontSize: "0.7rem", color: "#a3a3a3", whiteSpace: "nowrap" }}>
                        {p.time ? new Date(p.time).toLocaleString() : ""}
                      </div>
                    </div>
                  );
                })}
              </div>
              {data.features.length > 60 && (
                <div className="ex-empty" style={{ padding: "0.75rem" }}>
                  ...and {(data.features.length - 60).toLocaleString()} more
                </div>
              )}
            </div>
          )}
          {/* NWS forecast */}
          {data.properties?.periods && (
            <div>
              <div className="ex-stat">
                <span style={{ color: "#a3a3a3" }}>Source:</span> {data.properties.forecastGenerator || "NWS"}
              </div>
              <div style={{ marginTop: "0.75rem" }}>
                {data.properties.periods.slice(0, 48).map((p: NoaaForecastPeriod, i: number) => (
                  <div key={i} className="ex-quake-item">
                    <div style={{ width: 48, textAlign: "center", flexShrink: 0 }}>
                      <div style={{ fontSize: "0.75rem", fontWeight: 600, color: "#7cb8ff" }}>
                        {p.isDaytime ? "☀️" : "🌙"}
                      </div>
                      <div
                        style={{
                          fontSize: "0.9rem",
                          fontWeight: 700,
                          color: "#e0e0e0",
                          fontFamily: "'JetBrains Mono',monospace",
                        }}
                      >
                        {p.temperature}&deg;{p.temperatureUnit}
                      </div>
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: "0.82rem", fontWeight: 500 }}>{p.name}</div>
                      <div style={{ fontSize: "0.75rem", color: "#a3a3a3" }}>{p.shortForecast}</div>
                      <div style={{ fontSize: "0.72rem", color: "#a3a3a3", marginTop: "0.15rem" }}>
                        {p.windSpeed} {p.windDirection}
                      </div>
                    </div>
                    <div style={{ fontSize: "0.72rem", color: "#a3a3a3" }}>
                      {p.startTime &&
                        new Date(p.startTime).toLocaleString([], {
                          month: "short",
                          day: "numeric",
                          hour: "numeric",
                        })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {/* NWS alerts */}
          {Array.isArray(data.features) && data.features[0]?.properties?.severity && (
            <div>
              <div className="ex-stat">
                <span className="num">{data.features.length}</span> active alerts
              </div>
              <div className="ex-quake-list" style={{ marginTop: "0.5rem" }}>
                {data.features.map((f: GeoFeature, i: number) => {
                  const p = f.properties as NwsAlertProperties;
                  /* Severity text sits on a 9% tint of the same hue,
                     so light shades keep the badge above AAA 7:1. */
                  const sevColor =
                    p.severity === "Extreme"
                      ? "#fca5a5" /* 8.33:1 on #252129 */
                      : p.severity === "Severe"
                        ? "#fdba74" /* 9.26:1 on #252324 */
                        : p.severity === "Moderate"
                          ? "#fde047" /* 11.57:1 on #252620 */
                          : "#7cb8ff"; /* 7.66:1 on #192331 */
                  return (
                    <div key={i} className="ex-quake-item">
                      <div style={{ width: 8, height: 40, borderRadius: 4, background: sevColor, flexShrink: 0 }} />
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: "0.82rem", fontWeight: 500, color: "#ccc" }}>{p.event || p.title}</div>
                        <div className="ex-row" style={{ fontSize: "0.72rem", color: "#a3a3a3", marginTop: "0.1rem" }}>
                          <span className="ex-badge" style={{ background: `${sevColor}18`, color: sevColor }}>
                            {p.severity}
                          </span>
                          <span>{p.areaDesc?.split(";")[0] || ""}</span>
                        </div>
                        <div style={{ fontSize: "0.72rem", color: "#a3a3a3", marginTop: "0.15rem" }}>
                          {p.headline || ""}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {/* NHC storms */}
          {data.activeStorms && (
            <div>
              <div className="ex-stat">
                <span className="num">{data.activeStorms.length}</span> active storms
              </div>
              <pre style={{ marginTop: "0.75rem" }}>{JSON.stringify(data.activeStorms, null, 2)}</pre>
            </div>
          )}
          {/* NASA EONET */}
          {data.events && (
            <div>
              <div className="ex-stat">
                <span className="num">{data.events.length}</span> events
              </div>
              <div className="ex-quake-list" style={{ marginTop: "0.5rem" }}>
                {data.events.map((ev: EonetEvent, i: number) => (
                  <div key={i} className="ex-quake-item">
                    <div
                      style={{
                        width: 8,
                        height: 40,
                        borderRadius: 4,
                        background: ev.categories?.[0]?.color || "#4a9eff",
                        flexShrink: 0,
                      }}
                    />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: "0.82rem", fontWeight: 500, color: "#ccc" }}>{ev.title}</div>
                      <div className="ex-row" style={{ fontSize: "0.72rem", color: "#a3a3a3", marginTop: "0.1rem" }}>
                        {ev.categories?.[0]?.title && <span className="ex-tag">{ev.categories[0].title}</span>}
                        {ev.sources?.[0]?.id && <span className="ex-tag">{ev.sources[0].id}</span>}
                      </div>
                      {(() => {
                        const c = ev.geometry?.coordinates;
                        if (!c || !Array.isArray(c[0]) || !Array.isArray(c[0][0])) return null;
                        const firstCoord = (c[0] as unknown as number[][]).at(0);
                        if (!firstCoord) return null;
                        return (
                          <div style={{ fontSize: "0.7rem", color: "#a3a3a3", marginTop: "0.1rem" }}>
                            {typeof firstCoord[1] === "number" ? firstCoord[1].toFixed(2) : ""},{" "}
                            {typeof firstCoord[0] === "number" ? firstCoord[0].toFixed(2) : ""}
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {/* Fallback: raw JSON */}
          {!data.features && !data.properties?.periods && !data.activeStorms && !data.events && (
            <pre style={{ marginTop: "0.75rem" }}>{JSON.stringify(data, null, 2).substring(0, 8000)}</pre>
          )}
        </div>
      )}
    </>
  );
}
