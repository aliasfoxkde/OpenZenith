/**
 * Flights tab of the Data Explorer: OpenSky ADS-B filters and the results
 * table. Extracted verbatim from explore/page.tsx; fetch state stays in
 * the page so filters survive tab switches.
 */
import type { FlightResponse, FlightState } from "../data";

interface FlightsTabProps {
  data: FlightResponse | null;
  error: string;
  loading: boolean;
  bbox: string;
  callsign: string;
  altMin: string;
  altMax: string;
  onGround: "all" | "airborne" | "ground";
  onBboxChange: (value: string) => void;
  onCallsignChange: (value: string) => void;
  onAltMinChange: (value: string) => void;
  onAltMaxChange: (value: string) => void;
  onStatusChange: (value: "all" | "airborne" | "ground") => void;
  onFetch: () => void;
}

export function FlightsTab({
  data,
  error,
  loading,
  bbox,
  callsign,
  altMin,
  altMax,
  onGround,
  onBboxChange,
  onCallsignChange,
  onAltMinChange,
  onAltMaxChange,
  onStatusChange,
  onFetch,
}: FlightsTabProps) {
  return (
    <>
      <h2>Flight Tracker (ADS-B)</h2>
      <p style={{ fontSize: "0.8rem", color: "#a3a3a3", margin: "0 0 1rem" }}>
        Real-time flight data from OpenSky Network. Filter by callsign, altitude, bounding box, and airborne status.
      </p>

      <div className="ex-filter-group">
        <label>BBox</label>
        <input
          placeholder="west,south,east,north"
          value={bbox}
          onChange={(e) => { onBboxChange(e.target.value); }}
          style={{ width: 220 }}
        />
        <label>Callsign</label>
        <input
          placeholder="UAL, DAL, AAL..."
          value={callsign}
          onChange={(e) => { onCallsignChange(e.target.value); }}
          style={{ width: 120 }}
        />
      </div>
      <div className="ex-filter-group">
        <label>Alt Min (m)</label>
        <input placeholder="0" type="number" value={altMin} onChange={(e) => { onAltMinChange(e.target.value); }} />
        <label>Alt Max (m)</label>
        <input placeholder="15000" type="number" value={altMax} onChange={(e) => { onAltMaxChange(e.target.value); }} />
        <label>Status</label>
        <select value={onGround} onChange={(e) => { onStatusChange(e.target.value as "all" | "airborne" | "ground"); }}>
          <option value="all">All</option>
          <option value="airborne">Airborne</option>
          <option value="ground">Ground</option>
        </select>
      </div>

      <div className="ex-row" style={{ marginBottom: "1rem" }}>
        <button className="primary" onClick={onFetch} disabled={loading}>
          {loading ? "Fetching..." : "Fetch Flights"}
        </button>
        <span style={{ fontSize: "0.72rem", color: "#a3a3a3" }}>Via /api/flights &middot; 15s cache</span>
      </div>

      {error && (
        <div className="ex-card" style={{ borderColor: "rgba(239,68,68,0.3)" }}>
          <span className="ex-badge err">Error</span> {error}
        </div>
      )}

      {data && (
        <div>
          <div className="ex-info-bar">
            <span>
              <span className="num">{data.states.length}</span> flights
            </span>
            {data.states.length !== data.totalRaw && (
              <>
                <span className="ex-sep" />
                <span style={{ color: "#a3a3a3" }}>filtered from {data.totalRaw}</span>
              </>
            )}
            <span className="ex-sep" />
            <span style={{ color: "#a3a3a3" }}>Time: {new Date(data.time * 1000).toLocaleTimeString()}</span>
          </div>
          <div style={{ overflow: "auto", maxHeight: 500, borderRadius: 8, border: "1px solid #1a1a1a" }}>
            <table className="ex-flight-table">
              <thead>
                <tr>
                  <th>Callsign</th>
                  <th>Country</th>
                  <th>Lat</th>
                  <th>Lon</th>
                  <th>Alt (m)</th>
                  <th>Speed (m/s)</th>
                  <th>Heading</th>
                  <th>Vert Rate</th>
                  <th>Squawk</th>
                </tr>
              </thead>
              <tbody>
                {data.states.slice(0, 200).map((s: FlightState, i: number) => (
                  <tr key={i}>
                    <td style={{ fontWeight: 600, color: "#e0e0e0" }}>{s[1] || "---"}</td>
                    <td>{s[2] || ""}</td>
                    <td>{typeof s[6] === "number" ? s[6].toFixed(4) : "---"}</td>
                    <td>{typeof s[5] === "number" ? s[5].toFixed(4) : "---"}</td>
                    <td>{s[7] != null && typeof s[7] === "number" ? s[7].toFixed(0) : "---"}</td>
                    <td>{s[9] != null && typeof s[9] === "number" ? s[9].toFixed(0) : "---"}</td>
                    <td>{s[10] != null && typeof s[10] === "number" ? s[10].toFixed(0) : "---"}</td>
                    <td
                      style={{
                        color:
                          typeof s[11] === "number"
                            ? s[11] > 0
                              ? "#34d399" /* 9.18:1 on #111925 */
                              : s[11] < 0
                                ? "#fca5a5" /* 9.30:1 on #111925 */
                                : "#a3a3a3"
                            : "#a3a3a3", /* 7.0:1 on #111925 */
                      }}
                    >
                      {s[11] != null && typeof s[11] === "number"
                        ? (s[11] > 0 ? "+" : "") + s[11].toFixed(0)
                        : "---"}
                    </td>
                    <td>{s[14] || ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data.states.length > 200 && (
            <div className="ex-empty" style={{ padding: "0.75rem" }}>
              ...and {(data.states.length - 200).toLocaleString()} more flights
            </div>
          )}
        </div>
      )}
    </>
  );
}
