/**
 * Satellites tab of the Data Explorer: Celestrak TLE group/search filters
 * and the results table. Extracted verbatim from explore/page.tsx; fetch
 * state stays in the page so filters survive tab switches.
 */
import type { SatelliteRecord } from "../data";
import { SATELLITE_GROUPS } from "../data";

interface SatellitesTabProps {
  data: SatelliteRecord[] | null;
  error: string;
  loading: boolean;
  group: string;
  search: string;
  onGroupChange: (value: string) => void;
  onSearchChange: (value: string) => void;
  onFetch: () => void;
}

export function SatellitesTab({
  data,
  error,
  loading,
  group,
  search,
  onGroupChange,
  onSearchChange,
  onFetch,
}: SatellitesTabProps) {
  return (
    <>
      <h2>Celestrak Satellite Tracker</h2>
      <p style={{ fontSize: "0.8rem", color: "#a3a3a3", margin: "0 0 1rem" }}>
        TLE (Two-Line Element) data for active satellites from Celestrak. Search by name or filter by group.
      </p>

      <div className="ex-filter-group">
        <label>Group</label>
        <select value={group} onChange={(e) => { onGroupChange(e.target.value); }} style={{ width: 160 }}>
          {SATELLITE_GROUPS.map((g) => (
            <option key={g.id} value={g.id}>
              {g.label}
            </option>
          ))}
        </select>
        <label>Search</label>
        <input
          placeholder="STARLINK, ISS, NOAA..."
          value={search}
          onChange={(e) => { onSearchChange(e.target.value); }}
          style={{ width: 200 }}
        />
        <button className="primary" onClick={onFetch} disabled={loading}>
          {loading ? "Fetching..." : "Fetch"}
        </button>
      </div>

      {error && (
        <div className="ex-card" style={{ borderColor: "rgba(239,68,68,0.3)", marginTop: "1rem" }}>
          <span className="ex-badge err">Error</span> {error}
        </div>
      )}

      {data && Array.isArray(data) && (
        <div>
          <div className="ex-info-bar">
            <span>
              <span className="num">{data.length}</span> satellites
            </span>
            <span className="ex-sep" />
            <span style={{ color: "#a3a3a3" }}>Group: {SATELLITE_GROUPS.find((g) => g.id === group)?.label}</span>
            {search && (
              <>
                <span className="ex-sep" />
                <span style={{ color: "#a3a3a3" }}>Filtered: &quot;{search}&quot;</span>
              </>
            )}
          </div>
          <div style={{ overflow: "auto", maxHeight: 500, borderRadius: 8, border: "1px solid #1a1a1a" }}>
            <table className="ex-flight-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>NORAD ID</th>
                  <th>Object Type</th>
                  <th>TLE Line 1</th>
                </tr>
              </thead>
              <tbody>
                {data
                  .filter(
                    (s: SatelliteRecord) => !search || (s.OBJECT_NAME || "").toUpperCase().includes(search.toUpperCase()),
                  )
                  .slice(0, 200)
                  .map((s: SatelliteRecord, i: number) => (
                    <tr key={i}>
                      <td style={{ fontWeight: 600, color: "#e0e0e0" }}>{s.OBJECT_NAME}</td>
                      <td>{s.NORAD_CAT_ID}</td>
                      <td>
                        <span className="ex-tag">{s.OBJECT_TYPE}</span>
                      </td>
                      <td style={{ fontSize: "0.68rem", color: "#a3a3a3" }}>{s.TLE_LINE1}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          {data.length > 200 && (
            <div className="ex-empty" style={{ padding: "0.75rem" }}>
              ...and {(data.length - 200).toLocaleString()} more satellites
            </div>
          )}
        </div>
      )}
    </>
  );
}
