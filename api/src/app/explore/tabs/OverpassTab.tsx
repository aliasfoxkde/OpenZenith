/**
 * Overpass tab of the Data Explorer: Overpass QL query editor, quick-query
 * buttons, and the results readout. Extracted verbatim from
 * explore/page.tsx; fetch state stays in the page so filters survive tab
 * switches.
 */
import type { OverpassResult } from "../data";
import { OVERPASS_QUERIES } from "../data";

interface OverpassTabProps {
  query: string;
  bbox: string;
  result: OverpassResult | null;
  error: string;
  loading: boolean;
  stats: { nodes: number; ways: number; relations: number };
  onQueryChange: (value: string) => void;
  onBboxChange: (value: string) => void;
  onRun: () => void;
}

export function OverpassTab({
  query,
  bbox,
  result,
  error,
  loading,
  stats,
  onQueryChange,
  onBboxChange,
  onRun,
}: OverpassTabProps) {
  return (
    <>
      <h2>Overpass API / OpenStreetMap</h2>
      <p style={{ fontSize: "0.8rem", color: "#a3a3a3", margin: "0 0 1rem" }}>
        Query OpenStreetMap data using the Overpass QL language. Use{" "}
        <code
          style={{
            color: "#7cb8ff",
            background: "rgba(74,158,255,0.1)",
            padding: "0.1rem 0.3rem",
            borderRadius: 3,
          }}
        >
          &#123;&#123;bbox&#125;&#125;
        </code>{" "}
        as a placeholder for the bounding box.
      </p>

      <div style={{ marginBottom: "0.75rem" }}>
        <label style={{ fontSize: "0.78rem", color: "#a3a3a3", display: "block", marginBottom: "0.25rem" }}>
          Bounding Box (west,south,east,north)
        </label>
        <input value={bbox} onChange={(e) => { onBboxChange(e.target.value); }} placeholder="-74.02,40.70,-73.95,40.78" />
      </div>

      <div style={{ marginBottom: "0.5rem" }}>
        <label style={{ fontSize: "0.78rem", color: "#a3a3a3", display: "block", marginBottom: "0.25rem" }}>
          Overpass QL Query
        </label>
        <textarea
          value={query}
          onChange={(e) => { onQueryChange(e.target.value); }}
          rows={6}
          placeholder={`[out:json][timeout:25];\nnode["amenity"]({{bbox}});\nout;`}
          style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: "0.82rem", resize: "vertical" }}
        />
      </div>

      <div className="ex-row" style={{ marginBottom: "1rem" }}>
        <button className="primary" onClick={onRun} disabled={loading}>
          {loading ? "Running..." : "Run Query"}
        </button>
        <span style={{ fontSize: "0.72rem", color: "#a3a3a3" }}>Via /api/overpass</span>
      </div>

      <div style={{ marginBottom: "1rem" }}>
        <div style={{ fontSize: "0.8rem", fontWeight: 600, marginBottom: "0.5rem" }}>Quick Queries</div>
        <div className="ex-query-grid">
          {OVERPASS_QUERIES.map((q, i) => (
            <button key={i} className="ex-query-btn" onClick={() => { onQueryChange(q.query); }}>
              {q.label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="ex-card" style={{ borderColor: "rgba(239,68,68,0.3)", marginBottom: "1rem" }}>
          <span className="ex-badge err">Error</span> {error}
        </div>
      )}

      {result && (
        <div>
          <h3>Results</h3>
          <div className="ex-stat">
            <span className="num">{stats.nodes.toLocaleString()}</span> nodes
            <span className="ex-sep" />
            <span className="num">{stats.ways.toLocaleString()}</span> ways
            <span className="ex-sep" />
            <span className="num">{stats.relations.toLocaleString()}</span> relations
            <span className="ex-sep" />
            <span style={{ color: "#a3a3a3" }}>Snapshot: {result.osm3s?.timestamp_osm_base || "N/A"}</span>
          </div>
          {result.elements.length > 0 && (
            <pre style={{ marginTop: "0.75rem" }}>
              {JSON.stringify(result.elements.slice(0, 50), null, 2)}
              {result.elements.length > 50 &&
                `\n... and ${(result.elements.length - 50).toLocaleString()} more elements`}
            </pre>
          )}
          {result.elements.length === 0 && (
            <div className="ex-empty">No elements found for this query and bounding box.</div>
          )}
        </div>
      )}
    </>
  );
}
