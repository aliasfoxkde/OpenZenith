"use client";

import { useState, useCallback, useRef } from "react";

/* ═══════════════════════════════════════════════════════════════
   Types
   ═══════════════════════════════════════════════════════════════ */

interface ArcGISService {
  name: string;
  type: string;
  url: string;
}

interface ArcGISTarget {
  host: string;
  id: string;
  url: string;
  serviceCount?: number;
  services?: ArcGISService[];
  loading?: boolean;
  error?: string;
}

interface OverpassResult {
  elements: any[];
  osm3s?: { timestamp_osm_base: string };
}

/* ═══════════════════════════════════════════════════════════════
   Constants
   ═══════════════════════════════════════════════════════════════ */

const KNOWN_HOSTS: ArcGISTarget[] = [
  { host: "services9.arcgis.com", id: "RHVPKKiFTONKtxq3", url: "https://services9.arcgis.com/RHVPKKiFTONKtxq3/ArcGIS/rest/services" },
  { host: "services7.arcgis.com", id: "WHDO3oT6B54vXxsx", url: "https://services7.arcgis.com/WHDO3oT6B54vXxsx/ArcGIS/rest/services" },
  { host: "services6.arcgis.com", id: "P0j8gBhkWyUvGMOJ", url: "https://services6.arcgis.com/P0j8gBhkWyUvGMOJ/ArcGIS/rest/services" },
  { host: "services3.arcgis.com", id: "NV3gBKL1xPmJ6h8V", url: "https://services3.arcgis.com/NV3gBKL1xPmJ6h8V/ArcGIS/rest/services" },
  { host: "services1.arcgis.com", id: "Wl7Y1mXPaBnJF4o4", url: "https://services1.arcgis.com/Wl7Y1mXPaBnJF4o4/ArcGIS/rest/services" },
  { host: "services.arcgis.com", id: "6tLsIO2BUcJ2mKgv", url: "https://services.arcgis.com/6tLsIO2BUcJ2mKgv/ArcGIS/rest/services" },
  { host: "services2.arcgis.com", id: "jDGuO8AoQLB0zqXz", url: "https://services2.arcgis.com/jDGuO8AoQLB0zqXz/ArcGIS/rest/services" },
  { host: "services8.arcgis.com", id: "HEYY8eQgKtITtGVcc", url: "https://services8.arcgis.com/HEYY8eQgKtITtGVcc/ArcGIS/rest/services" },
  { host: "services10.arcgis.com", id: "jDGuO8AoQLB0zqXz", url: "https://services10.arcgis.com/jDGuO8AoQLB0zqXz/ArcGIS/rest/services" },
  { host: "services11.arcgis.com", id: "6tLsIO2BUcJ2mKgv", url: "https://services11.arcgis.com/6tLsIO2BUcJ2mKgv/ArcGIS/rest/services" },
  { host: "services12.arcgis.com", id: "rJILGiHnLq1MxPsB", url: "https://services12.arcgis.com/rJILGiHnLq1MxPsB/ArcGIS/rest/services" },
  { host: "opendata.arcgis.com", id: "zNFqk4i7h0oYAdW4", url: "https://opendata.arcgis.com/datasets/zNFqk4i7h0oYAdW4" },
];

const OVERPASS_QUERIES = [
  { label: "Amenities in view", query: '[out:json][timeout:25];({node["amenity"]({{bbox}});way["amenity"]({{bbox}});relation["amenity"]({{bbox}});});out center;' },
  { label: "Power lines", query: '[out:json][timeout:25];way["power"="line"]({{bbox}});out geom;' },
  { label: "Waterways", query: '[out:json][timeout:25];way["waterway"]({{bbox}});out geom;' },
  { label: "Buildings", query: '[out:json][timeout:25];way["building"]({{bbox}});out geom;(._<;);out skel qt 50;' },
  { label: "Roads", query: '[out:json][timeout:25];way["highway"]({{bbox}});out geom;' },
  { label: "Aerialways", query: '[out:json][timeout:25];way["aerialway"]({{bbox}});out geom;' },
  { label: "Natural features", query: '[out:json][timeout:25];(node["natural"]({{bbox}});way["natural"]({{bbox}}););out center;' },
  { label: "Historic sites", query: '[out:json][timeout:25];(node["historic"]({{bbox}});way["historic"]({{bbox}}););out center;' },
  { label: "Railways", query: '[out:json][timeout:25];way["railway"]({{bbox}});out geom;' },
  { label: "Landuse", query: '[out:json][timeout:25];way["landuse"]({{bbox}});out geom;' },
];

/* ═══════════════════════════════════════════════════════════════
   CSS
   ═══════════════════════════════════════════════════════════════ */

const S = `
.explore{max-width:1280px;margin:0 auto;padding:1.5rem;font-family:system-ui,-apple-system,sans-serif;color:#e0e0e0;background:#0a0e17;min-height:100vh}
.explore h1{font-size:1.5rem;font-weight:700;margin:0 0 0.25rem;letter-spacing:-0.02em}
.explore .sub{color:#666;font-size:0.85rem;margin:0 0 1.5rem}
.explore h2{font-size:1.1rem;font-weight:600;margin:1.5rem 0 0.75rem;padding-bottom:0.5rem;border-bottom:1px solid #1a1a1a}
.explore h3{font-size:0.9rem;font-weight:600;margin:1rem 0 0.5rem}
.explore a{color:#4a9eff;text-decoration:none}
.explore a:hover{text-decoration:underline}
.explore input,.explore textarea,.explore select{background:#111;color:#e0e0e0;border:1px solid #333;border-radius:6px;padding:0.5rem 0.75rem;font-size:0.85rem;font-family:inherit;outline:none;width:100%;box-sizing:border-box}
.explore input:focus,.explore textarea:focus{border-color:#4a9eff}
.explore button{padding:0.45rem 1rem;border-radius:6px;border:none;font-size:0.85rem;font-weight:500;cursor:pointer;font-family:inherit;transition:opacity .15s}
.explore button:hover{opacity:0.85}
.explore button.primary{background:#4a9eff;color:#000}
.explore button.secondary{background:#1a1a1a;color:#ccc;border:1px solid #333}
.explore button.danger{background:#ef4444;color:#fff}
.explore pre{background:#111;border:1px solid #222;border-radius:8px;padding:0.75rem 1rem;font-size:0.78rem;line-height:1.6;overflow:auto;max-height:500px;color:#bbb}
.explore .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:0.75rem}
.explore .card{background:#111;border:1px solid #1a1a1a;border-radius:10px;padding:1rem;transition:border-color .15s}
.explore .card:hover{border-color:#333}
.explore .badge{display:inline-block;padding:0.1rem 0.5rem;border-radius:4px;font-size:0.7rem;font-weight:500}
.explore .badge.fs{background:rgba(74,158,255,0.15);color:#4a9eff}
.explore .badge.ms{background:rgba(168,85,247,0.15);color:#a855f7}
.explore .badge.ts{background:rgba(34,197,94,0.15);color:#22c55e}
.explore .badge.is{background:rgba(251,146,60,0.15);color:#fb923c}
.explore .badge.wms{background:rgba(234,179,8,0.15);color:#eab308}
.explore .badge.err{background:rgba(239,68,68,0.15);color:#ef4444}
.explore .stat{display:flex;align-items:center;gap:0.5rem;margin:0.25rem 0;font-size:0.8rem}
.explore .stat .num{color:#4a9eff;font-weight:600}
.explore .row{display:flex;gap:0.5rem;align-items:center;flex-wrap:wrap}
.explore .tag{font-size:0.7rem;padding:0.15rem 0.5rem;border-radius:4px;background:#1a1a1a;color:#888;border:1px solid #222}
.explore .sep{width:1px;height:16px;background:#222;margin:0 0.25rem}
.explore .empty{text-align:center;padding:2rem;color:#555;font-size:0.85rem}
.explore .back{display:inline-flex;align-items:center;gap:0.3rem;color:#666;font-size:0.8rem;text-decoration:none;margin-bottom:1rem}
.explore .back:hover{color:#aaa}
.explore .query-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:0.5rem;margin-bottom:1rem}
.explore .query-btn{padding:0.4rem 0.6rem;font-size:0.78rem;background:#111;color:#aaa;border:1px solid #222;border-radius:6px;cursor:pointer;text-align:left;transition:all .15s;font-family:inherit}
.explore .query-btn:hover{border-color:#4a9eff;color:#4a9eff;background:rgba(74,158,255,0.05)}
`;

/* ═══════════════════════════════════════════════════════════════
   Component
   ═══════════════════════════════════════════════════════════════ */

export default function ExplorePage() {
  const [tab, setTab] = useState<"arcgis" | "overpass">("arcgis");

  // ArcGIS state
  const [hosts, setHosts] = useState<ArcGISTarget[]>(KNOWN_HOSTS);
  const [selectedHost, setSelectedHost] = useState<string | null>(null);
  const [serviceDetails, setServiceDetails] = useState<any>(null);
  const [serviceFields, setServiceFields] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [customUrl, setCustomUrl] = useState("");

  // Overpass state
  const [opQuery, setOpQuery] = useState("");
  const [opBbox, setOpBbox] = useState("-74.02,40.70,-73.95,40.78");
  const [opResult, setOpResult] = useState<OverpassResult | null>(null);
  const [opLoading, setOpLoading] = useState(false);
  const [opError, setOpError] = useState("");
  const [opStats, setOpStats] = useState<{ nodes: number; ways: number; relations: number }>({ nodes: 0, ways: 0, relations: 0 });
  const bboxRef = useRef<HTMLInputElement>(null);

  // ─── ArcGIS: discover services for a host ───
  const discoverHost = useCallback(async (host: ArcGISTarget) => {
    setHosts((prev) => prev.map((h) => h.id === host.id ? { ...h, loading: true, error: undefined } : h));
    try {
      const resp = await fetch(`/api/arcgis?url=${encodeURIComponent(host.url + "?f=pjson")}`);
      const data = await resp.json();
      if (data.error) throw new Error(data.error);
      const services = (data.services || []).map((s: any) => ({
        name: s.name,
        type: s.type,
        url: s.url,
      }));
      setHosts((prev) => prev.map((h) => h.id === host.id ? { ...h, serviceCount: services.length, services, loading: false } : h));
    } catch (e: any) {
      setHosts((prev) => prev.map((h) => h.id === host.id ? { ...h, loading: false, error: e.message || "failed" } : h));
    }
  }, []);

  const discoverAll = useCallback(async () => {
    setLoading(true);
    const undiscovered = hosts.filter((h) => h.serviceCount == null && !h.loading);
    // Discover up to 4 at a time to avoid overwhelming
    for (let i = 0; i < undiscovered.length; i += 4) {
      const batch = undiscovered.slice(i, i + 4);
      await Promise.all(batch.map(discoverHost));
    }
    setLoading(false);
  }, [hosts, discoverHost]);

  // ─── ArcGIS: get service details ───
  const fetchServiceInfo = useCallback(async (service: ArcGISService) => {
    setSelectedHost(service.url);
    setServiceDetails(null);
    setServiceFields([]);
    try {
      const resp = await fetch(`/api/arcgis?url=${encodeURIComponent(service.url + "?f=pjson")}`);
      const data = await resp.json();
      if (data.error) throw new Error(data.error);
      setServiceDetails(data);
      // Fetch fields for first layer
      if (data.layers?.length > 0) {
        const layerId = data.layers[0].id;
        const layerResp = await fetch(`/api/arcgis?url=${encodeURIComponent(service.url + `/${layerId}?f=pjson`)}`);
        const layerData = await layerResp.json();
        setServiceFields(layerData.fields || []);
      }
    } catch (e: any) {
      setServiceDetails({ error: e.message });
    }
  }, []);

  // ─── ArcGIS: add custom host ───
  const addCustomHost = useCallback(() => {
    if (!customUrl.trim()) return;
    const match = customUrl.match(/https?:\/\/([a-z0-9.-]+)\/([A-Za-z0-9_-]+)\/ArcGIS\/rest\/services/);
    if (!match) return;
    const [_, host, id] = match;
    const newHost: ArcGISTarget = { host, id, url: customUrl.replace(/\/$/, "") };
    setHosts((prev) => [...prev, newHost]);
    setCustomUrl("");
    discoverHost(newHost);
  }, [customUrl, discoverHost]);

  // ─── Overpass: run query ───
  const runOverpass = useCallback(async () => {
    if (!opQuery.trim()) return;
    setOpLoading(true);
    setOpError("");
    setOpResult(null);
    try {
      const resolvedQuery = opQuery.replace(/\{\{bbox\}\}/g, opBbox);
      const resp = await fetch("/api/overpass", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: resolvedQuery }),
      });
      const data = await resp.json();
      if (data.error) throw new Error(data.error);
      if (data.remark) throw new Error(data.remark);
      setOpResult(data);
      const nodes = (data.elements || []).filter((e: any) => e.type === "node").length;
      const ways = (data.elements || []).filter((e: any) => e.type === "way").length;
      const relations = (data.elements || []).filter((e: any) => e.type === "relation").length;
      setOpStats({ nodes, ways, relations });
    } catch (e: any) {
      setOpError(e.message || "Overpass query failed");
    } finally {
      setOpLoading(false);
    }
  }, [opQuery, opBbox]);

  const typeBadge = (type: string) => {
    const t = (type || "").toLowerCase();
    if (t.includes("feature")) return "fs";
    if (t.includes("map")) return "ms";
    if (t.includes("tile")) return "ts";
    if (t.includes("image")) return "is";
    if (t.includes("wms")) return "wms";
    return t.substring(0, 4);
  };

  const totalServices = hosts.reduce((sum, h) => sum + (h.serviceCount || 0), 0);

  return (
    <div className="explore">
      <style dangerouslySetInnerHTML={{ __html: S }} />

      <a href="/" className="back">&larr; OpenZenith</a>
      <h1>Data Explorer</h1>
      <p className="sub">Discover ArcGIS REST services and query OpenStreetMap via Overpass API</p>

      {/* Tabs */}
      <div className="row" style={{ marginBottom: "1rem" }}>
        <button className={tab === "arcgis" ? "primary" : "secondary"} onClick={() => setTab("arcgis")}>ArcGIS Services</button>
        <button className={tab === "overpass" ? "primary" : "secondary"} onClick={() => setTab("overpass")}>Overpass / OSM</button>
      </div>

      {/* ═══ ARCGIS TAB ═══ */}
      {tab === "arcgis" && (
        <>
          <div className="row" style={{ marginBottom: "1rem" }}>
            <input
              placeholder="https://servicesX.arcgis.com/XXXX/ArcGIS/rest/services"
              value={customUrl}
              onChange={(e) => setCustomUrl(e.target.value)}
              style={{ flex: 1 }}
              onKeyDown={(e) => e.key === "Enter" && addCustomHost()}
            />
            <button className="primary" onClick={addCustomHost}>Add Host</button>
            <button className="secondary" onClick={discoverAll} disabled={loading}>
              {loading ? "Scanning..." : `Scan All (${hosts.filter((h) => h.serviceCount == null).length} remaining)`}
            </button>
          </div>

          <div className="stat">
            <span className="num">{hosts.filter((h) => h.serviceCount != null).length}</span> hosts scanned
            <span className="sep" />
            <span className="num">{totalServices.toLocaleString()}</span> services found
          </div>

          <h2>Hosts ({hosts.length})</h2>
          <div className="grid">
            {hosts.map((h) => (
              <div key={h.id} className="card">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: "0.85rem" }}>{h.host}</div>
                    <div style={{ fontSize: "0.7rem", color: "#555", fontFamily: "monospace" }}>{h.id}</div>
                  </div>
                  <div className="row">
                    {h.serviceCount != null && <span className="badge fs">{h.serviceCount} services</span>}
                    {h.loading && <span className="badge" style={{ background: "#222", color: "#eab308" }}>scanning...</span>}
                    {h.error && <span className="badge err">{h.error.substring(0, 30)}</span>}
                  </div>
                </div>
                <div className="row">
                  <button className="secondary" style={{ fontSize: "0.75rem", padding: "0.3rem 0.6rem" }}
                    onClick={() => discoverHost(h)} disabled={h.loading}>
                    {h.serviceCount != null ? "Refresh" : "Scan"}
                  </button>
                  {h.services && h.services.length > 0 && (
                    <button className="secondary" style={{ fontSize: "0.75rem", padding: "0.3rem 0.6rem" }}
                      onClick={() => { setSelectedHost(h.url); setServiceDetails(null); setServiceFields([]); }}>
                      View Services ({h.services.length})
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Service list for selected host */}
          {selectedHost && !serviceDetails && (() => {
            const host = hosts.find((h) => h.url === selectedHost);
            if (!host?.services?.length) return null;
            return (
              <div style={{ marginTop: "1rem" }}>
                <h3>Services: {host.host}</h3>
                <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem", maxHeight: 600, overflow: "auto" }}>
                  {host.services.map((s, i) => (
                    <div key={i} className="card" style={{ padding: "0.6rem 0.8rem", cursor: "pointer" }}
                      onClick={() => fetchServiceInfo(s)}>
                      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                        <span className="badge {typeBadge(s.type)}">{s.type.replace("Server", "")}</span>
                        <span style={{ fontSize: "0.8rem", color: "#ccc" }}>{s.name}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}

          {/* Service detail view */}
          {serviceDetails && (
            <div style={{ marginTop: "1rem" }}>
              <h3 style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <button className="secondary" style={{ fontSize: "0.7rem", padding: "0.2rem 0.5rem" }} onClick={() => { setServiceDetails(null); setServiceFields([]); }}>&larr;</button>
                Service Details
              </h3>
              {serviceDetails.error ? (
                <div className="card" style={{ borderColor: "#ef4444" }}>
                  <span className="badge err">Error</span> {serviceDetails.error}
                </div>
              ) : (
                <div className="card">
                  <div className="stat"><span style={{ color: "#555" }}>Description:</span> {serviceDetails.description || serviceDetails.serviceDescription || "(none)"}</div>
                  <div className="stat"><span style={{ color: "#555" }}>Copyright:</span> {serviceDetails.copyrightText || "(none)"}</div>
                  <div className="stat"><span style={{ color: "#555" }}>Layers:</span> <span className="num">{serviceDetails.layers?.length || 0}</span></div>
                  <div className="stat"><span style={{ color: "#555" }}>Capabilities:</span> {serviceDetails.capabilities || "N/A"}</div>
                  <div className="stat"><span style={{ color: "#555" }}>Max Records:</span> {serviceDetails.maxRecordCount?.toLocaleString() || "N/A"}</div>
                  <div className="stat"><span style={{ color: "#555" }}>Spatial Ref:</span> WKID {serviceDetails.spatialReference?.wkid || "N/A"}</div>
                  <div className="stat"><span style={{ color: "#555" }}>Export Formats:</span> {serviceDetails.supportedExportFormats || "N/A"}</div>

                  {serviceDetails.layers?.length > 0 && (
                    <div style={{ marginTop: "0.75rem" }}>
                      <div style={{ fontSize: "0.8rem", fontWeight: 600, marginBottom: "0.4rem" }}>Layers</div>
                      {serviceDetails.layers.map((l: any) => (
                        <div key={l.id} style={{ fontSize: "0.78rem", padding: "0.2rem 0", color: "#aaa" }}>
                          <span style={{ color: "#4a9eff", marginRight: "0.4rem" }}>{l.id}</span>
                          {l.name} <span className="tag">{l.geometryType}</span>
                          {l.defaultVisibility ? null : <span className="tag" style={{ color: "#666" }}>hidden</span>}
                        </div>
                      ))}
                    </div>
                  )}

                  {serviceFields.length > 0 && (
                    <div style={{ marginTop: "0.75rem" }}>
                      <div style={{ fontSize: "0.8rem", fontWeight: 600, marginBottom: "0.4rem" }}>
                        Fields (Layer {serviceDetails.layers?.[0]?.id})
                      </div>
                      <pre style={{ maxHeight: 300, fontSize: "0.72rem" }}>
                        {serviceFields.map((f: any) => `${f.name.padEnd(25)} ${f.type.padEnd(20)} ${f.alias || ""}`).join("\n")}
                      </pre>
                    </div>
                  )}

                  <div style={{ marginTop: "0.75rem" }}>
                    <div style={{ fontSize: "0.8rem", fontWeight: 600, marginBottom: "0.4rem" }}>Query URL</div>
                    <pre style={{ fontSize: "0.72rem", wordBreak: "break-all" }}>
                      {selectedHost}/0/query?f=json&where=1%3D1&outFields=*&returnGeometry=true&resultRecordCount=10
                    </pre>
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* ═══ OVERPASS TAB ═══ */}
      {tab === "overpass" && (
        <>
          <h2>Overpass API / OpenStreetMap</h2>
          <p style={{ fontSize: "0.8rem", color: "#666", margin: "0 0 1rem" }}>
            Query OpenStreetMap data using the Overpass QL language. Use <code style={{ color: "#4a9eff" }}>&#123;&#123;bbox&#125;&#125;</code> as a placeholder for the bounding box.
          </p>

          <div style={{ marginBottom: "0.75rem" }}>
            <label style={{ fontSize: "0.8rem", color: "#888", display: "block", marginBottom: "0.25rem" }}>
              Bounding Box (west,south,east,north)
            </label>
            <input value={opBbox} onChange={(e) => setOpBbox(e.target.value)} placeholder="-74.02,40.70,-73.95,40.78" />
          </div>

          <div style={{ marginBottom: "0.5rem" }}>
            <label style={{ fontSize: "0.8rem", color: "#888", display: "block", marginBottom: "0.25rem" }}>
              Overpass QL Query
            </label>
            <textarea
              value={opQuery}
              onChange={(e) => setOpQuery(e.target.value)}
              rows={6}
              placeholder={`[out:json][timeout:25];\nnode["amenity"]({{bbox}});\nout;`}
              style={{ fontFamily: "monospace", fontSize: "0.82rem", resize: "vertical" }}
            />
          </div>

          <div className="row" style={{ marginBottom: "1rem" }}>
            <button className="primary" onClick={runOverpass} disabled={opLoading}>
              {opLoading ? "Running..." : "Run Query"}
            </button>
            <span style={{ fontSize: "0.75rem", color: "#555" }}>
              Via proxy: /api/overpass
            </span>
          </div>

          <div style={{ marginBottom: "1rem" }}>
            <div style={{ fontSize: "0.8rem", fontWeight: 600, marginBottom: "0.5rem" }}>Quick Queries</div>
            <div className="query-grid">
              {OVERPASS_QUERIES.map((q, i) => (
                <button key={i} className="query-btn" onClick={() => setOpQuery(q.query)}>
                  {q.label}
                </button>
              ))}
            </div>
          </div>

          {opError && (
            <div className="card" style={{ borderColor: "#ef4444", marginBottom: "1rem" }}>
              <span className="badge err">Error</span> {opError}
            </div>
          )}

          {opResult && (
            <div>
              <h3>Results</h3>
              <div className="stat">
                <span className="num">{opStats.nodes.toLocaleString()}</span> nodes
                <span className="sep" />
                <span className="num">{opStats.ways.toLocaleString()}</span> ways
                <span className="sep" />
                <span className="num">{opStats.relations.toLocaleString()}</span> relations
                <span className="sep" />
                <span style={{ color: "#555" }}>Snapshot: {opResult.osm3s?.timestamp_osm_base || "N/A"}</span>
              </div>

              {opResult.elements.length > 0 && (
                <pre style={{ marginTop: "0.75rem" }}>
                  {JSON.stringify(opResult.elements.slice(0, 50), null, 2)}
                  {opResult.elements.length > 50 && `\n... and ${(opResult.elements.length - 50).toLocaleString()} more elements`}
                </pre>
              )}

              {opResult.elements.length === 0 && (
                <div className="empty">No elements found for this query and bounding box.</div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
