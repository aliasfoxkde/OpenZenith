/**
 * Overture Maps tab of the Data Explorer: theme/type selection, bbox
 * query toolbar, and the results readout. Extracted verbatim from
 * explore/page.tsx; fetch state stays in the page so filters survive tab
 * switches.
 */
import type { OvertureResponse } from "../data";
import { OVERTURE_THEMES } from "../data";

interface OvertureTabProps {
  theme: string;
  type: string;
  bbox: string;
  data: OvertureResponse | null;
  error: string;
  loading: boolean;
  /** Select a theme card: switches theme, resets the type, clears results. */
  onSelectTheme: (id: string, firstType: string) => void;
  onTypeChange: (value: string) => void;
  onBboxChange: (value: string) => void;
  onFetch: () => void;
}

export function OvertureTab({
  theme,
  type,
  bbox,
  data,
  error,
  loading,
  onSelectTheme,
  onTypeChange,
  onBboxChange,
  onFetch,
}: OvertureTabProps) {
  const selectedTheme = OVERTURE_THEMES.find((t) => t.id === theme);
  return (
    <>
      <h2>Overture Maps</h2>
      <p style={{ fontSize: "0.8rem", color: "#a3a3a3", margin: "0 0 1rem" }}>
        Open map data from the Overture Maps Foundation. Select a theme and type, then enter a bounding box to query
        features.
      </p>

      <div className="ex-ds-grid" style={{ marginBottom: "1rem" }}>
        {OVERTURE_THEMES.map((t) => (
          <div
            key={t.id}
            className={`ex-ds-card ${theme === t.id ? "selected" : ""}`}
            onClick={() => {
              onSelectTheme(t.id, t.types[0]);
            }}
          >
            <div style={{ fontWeight: 600, fontSize: "0.88rem", marginBottom: "0.2rem" }}>{t.label}</div>
            <div style={{ fontSize: "0.78rem", color: "#a3a3a3", lineHeight: 1.45 }}>{t.desc}</div>
            <div className="ex-row" style={{ marginTop: "0.5rem", gap: "0.3rem" }}>
              {t.types.map((tt) => (
                <span key={tt} className="ex-tag">
                  {tt}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="ex-toolbar">
        <label style={{ fontSize: "0.75rem", color: "#a3a3a3", whiteSpace: "nowrap" }}>Type</label>
        <select value={type} onChange={(e) => { onTypeChange(e.target.value); }} style={{ width: "auto", minWidth: 120 }}>
          {selectedTheme?.types.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <input
          placeholder="west,south,east,north (e.g. -74.02,40.70,-73.95,40.78)"
          value={bbox}
          onChange={(e) => { onBboxChange(e.target.value); }}
          onKeyDown={(e) => { if (e.key === "Enter") onFetch(); }}
        />
        <button className="primary" onClick={onFetch} disabled={loading}>
          {loading ? "Fetching..." : "Query"}
        </button>
      </div>

      <div className="ex-info-bar">
        <span style={{ fontSize: "0.72rem", color: "#a3a3a3" }}>API: api.overturemaps.org/v0/{theme}/{type}</span>
      </div>

      {error && (
        <div className="ex-card" style={{ borderColor: "rgba(239,68,68,0.3)", marginTop: "1rem" }}>
          <span className="ex-badge err">Error</span> {error}
        </div>
      )}

      {data && (
        <div style={{ marginTop: "1rem" }}>
          <h3>
            Results: {theme}/{type}
          </h3>
          <div className="ex-stat">
            <span className="num">{data.features.length || 0}</span> features
          </div>
          {data.features.length > 0 && (
            <pre style={{ maxHeight: 500, marginTop: "0.5rem" }}>{JSON.stringify(data.features.slice(0, 20), null, 2)}</pre>
          )}
          {data.features.length > 20 && (
            <div className="ex-empty" style={{ padding: "0.75rem" }}>
              ...and {(data.features.length - 20).toLocaleString()} more features
            </div>
          )}
        </div>
      )}
    </>
  );
}
