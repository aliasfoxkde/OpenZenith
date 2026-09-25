/**
 * Earthquakes tab of the Data Explorer: USGS feed filters and the quake
 * list. Extracted verbatim from explore/page.tsx; fetch state stays in
 * the page so filters survive tab switches.
 */
import type { GeoFeature, NoaaData } from "../data";
import { magBg, magColor } from "../data";

interface EarthquakesTabProps {
  data: NoaaData | null;
  error: string;
  loading: boolean;
  minMag: string;
  period: string;
  onMinMagChange: (value: string) => void;
  onPeriodChange: (value: string) => void;
  onFetch: () => void;
}

export function EarthquakesTab({
  data,
  error,
  loading,
  minMag,
  period,
  onMinMagChange,
  onPeriodChange,
  onFetch,
}: EarthquakesTabProps) {
  return (
    <>
      <h2>USGS Earthquake Feed</h2>
      <p style={{ fontSize: "0.8rem", color: "#a3a3a3", margin: "0 0 1rem" }}>
        Real-time earthquake data from USGS. Filter by minimum magnitude and time period.
      </p>

      <div className="ex-filter-group">
        <label>Min Magnitude</label>
        <select value={minMag} onChange={(e) => { onMinMagChange(e.target.value); }}>
          <option value="0">All</option>
          <option value="1">M1.0+</option>
          <option value="2.5">M2.5+</option>
          <option value="4.5">M4.5+</option>
          <option value="5">M5.0+</option>
          <option value="6">M6.0+</option>
        </select>
        <label>Period</label>
        <select value={period} onChange={(e) => { onPeriodChange(e.target.value); }}>
          <option value="hour">Past Hour</option>
          <option value="day">Past Day</option>
          <option value="week">Past Week</option>
          <option value="month">Past Month</option>
        </select>
        <button className="primary" onClick={onFetch} disabled={loading}>
          {loading ? "Fetching..." : "Fetch"}
        </button>
      </div>

      {error && (
        <div className="ex-card" style={{ borderColor: "rgba(239,68,68,0.3)", marginTop: "1rem" }}>
          <span className="ex-badge err">Error</span> {error}
        </div>
      )}

      {data?.features && (
        <div>
          <div className="ex-info-bar">
            <span>
              <span className="num">{data.features.length}</span> earthquakes
            </span>
            <span className="ex-sep" />
            <span style={{ color: "#a3a3a3" }}>
              Generated: {data.metadata?.generated ? new Date(data.metadata.generated).toLocaleString() : "N/A"}
            </span>
          </div>
          <div className="ex-quake-list">
            {data.features.map((f: GeoFeature, i: number) => {
              const p = f.properties;
              const mag = p.mag;
              return (
                <div key={i} className="ex-quake-item">
                  {mag != null && (
                    <div className="ex-quake-mag" style={{ color: magColor(mag), background: magBg(mag) }}>
                      {mag.toFixed(1)}
                    </div>
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: "0.82rem", fontWeight: 500, color: "#ccc", marginBottom: "0.1rem" }}>
                      {p.place}
                    </div>
                    <div className="ex-row" style={{ fontSize: "0.72rem", color: "#a3a3a3" }}>
                      <span>
                        {p.coordinates?.[1]?.toFixed(3)}, {p.coordinates?.[0]?.toFixed(3)}
                      </span>
                      <span className="ex-sep" />
                      <span>Depth: {typeof p.depth === "number" ? p.depth.toFixed(1) : p.depth} km</span>
                      <span className="ex-sep" />
                      <span>{p.tsunami ? "🌊 Tsunami" : ""}</span>
                    </div>
                  </div>
                  <div style={{ fontSize: "0.7rem", color: "#a3a3a3", textAlign: "right", whiteSpace: "nowrap" }}>
                    <div>{p.time != null ? new Date(p.time).toLocaleString() : ""}</div>
                    <div style={{ color: "#a3a3a3" }}>
                      {p.type} &middot; {p.cd ? `felt ${p.cd}` : ""}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}
