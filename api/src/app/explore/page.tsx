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
@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600&display=swap');
.ex-wrap{position:relative;width:100vw;min-height:100vh;overflow-x:hidden;font-family:system-ui,-apple-system,sans-serif;color:#e0e0e0;background:#0a0e17}
.ex-nav{position:sticky;top:0;z-index:100;background:rgba(10,14,23,0.92);backdrop-filter:blur(12px);border-bottom:1px solid rgba(255,255,255,0.08);display:flex;align-items:center;padding:0 1.5rem;height:48px;gap:0.75rem}
.ex-nav-brand{display:flex;align-items:center;gap:0.4rem;color:#e0e0e0;font-weight:700;font-size:0.95rem;text-decoration:none;letter-spacing:-0.02em}
.ex-nav-brand svg{flex-shrink:0}
.ex-nav-crumb{color:#333;font-size:0.85rem;margin-left:0.25rem}
.ex-nav-links{display:flex;gap:1rem;margin-left:auto;align-items:center}
.ex-nav-links a{color:#666;font-size:0.8rem;text-decoration:none;transition:color .15s}
.ex-nav-links a:hover{color:#ccc}
.ex-body{padding:1.5rem 2rem 3rem;max-width:1600px;margin:0 auto}
.ex-body h1{font-size:1.5rem;font-weight:700;margin:0 0 0.25rem;letter-spacing:-0.02em}
.ex-body .sub{color:#555;font-size:0.85rem;margin:0 0 1.5rem}
.ex-body h2{font-size:1.05rem;font-weight:600;margin:1.5rem 0 0.75rem;padding-bottom:0.5rem;border-bottom:1px solid rgba(255,255,255,0.06)}
.ex-body h3{font-size:0.9rem;font-weight:600;margin:1rem 0 0.5rem}
.ex-body a{color:#4a9eff;text-decoration:none}
.ex-body a:hover{text-decoration:underline}
.ex-body input,.ex-body textarea,.ex-body select{background:#0d1117;color:#e0e0e0;border:1px solid #222;border-radius:6px;padding:0.5rem 0.75rem;font-size:0.85rem;font-family:inherit;outline:none;width:100%;box-sizing:border-box;transition:border-color .15s}
.ex-body input:focus,.ex-body textarea:focus{border-color:#4a9eff}
.ex-body button{padding:0.45rem 1rem;border-radius:6px;border:none;font-size:0.85rem;font-weight:500;cursor:pointer;font-family:inherit;transition:all .15s}
.ex-body button:hover{opacity:0.85}
.ex-body button:disabled{opacity:0.4;cursor:not-allowed}
.ex-body button.primary{background:#4a9eff;color:#000}
.ex-body button.secondary{background:rgba(255,255,255,0.04);color:#ccc;border:1px solid #222}
.ex-body button.danger{background:#ef4444;color:#fff}
.ex-body pre{background:#0d1117;border:1px solid #1a1a1a;border-radius:8px;padding:0.75rem 1rem;font-size:0.78rem;line-height:1.6;overflow:auto;max-height:500px;color:#aaa;font-family:'JetBrains Mono',monospace}
.ex-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:0.75rem}
.ex-card{background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.06);border-radius:10px;padding:1rem;transition:border-color .15s}
.ex-card:hover{border-color:rgba(255,255,255,0.12)}
.ex-badge{display:inline-block;padding:0.1rem 0.5rem;border-radius:4px;font-size:0.7rem;font-weight:500}
.ex-badge.fs{background:rgba(74,158,255,0.12);color:#4a9eff}
.ex-badge.ms{background:rgba(168,85,247,0.12);color:#a855f7}
.ex-badge.ts{background:rgba(34,197,94,0.12);color:#22c55e}
.ex-badge.is{background:rgba(251,146,60,0.12);color:#fb923c}
.ex-badge.wms{background:rgba(234,179,8,0.12);color:#eab308}
.ex-badge.err{background:rgba(239,68,68,0.12);color:#ef4444}
.ex-stat{display:flex;align-items:center;gap:0.5rem;margin:0.25rem 0;font-size:0.8rem}
.ex-stat .num{color:#4a9eff;font-weight:600;font-family:'JetBrains Mono',monospace}
.ex-row{display:flex;gap:0.5rem;align-items:center;flex-wrap:wrap}
.ex-tag{font-size:0.7rem;padding:0.15rem 0.5rem;border-radius:4px;background:rgba(255,255,255,0.03);color:#666;border:1px solid #1a1a1a}
.ex-sep{width:1px;height:16px;background:#1a1a1a;margin:0 0.25rem}
.ex-empty{text-align:center;padding:2rem;color:#444;font-size:0.85rem}
.ex-query-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:0.5rem;margin-bottom:1rem}
.ex-query-btn{padding:0.4rem 0.6rem;font-size:0.78rem;background:rgba(255,255,255,0.02);color:#888;border:1px solid #1a1a1a;border-radius:6px;cursor:pointer;text-align:left;transition:all .15s;font-family:inherit}
.ex-query-btn:hover{border-color:#4a9eff;color:#4a9eff;background:rgba(74,158,255,0.05)}
.ex-tabs{display:flex;gap:0.25rem;margin-bottom:1.25rem;background:rgba(255,255,255,0.02);border-radius:8px;padding:3px;border:1px solid rgba(255,255,255,0.06)}
.ex-tab{padding:0.4rem 1rem;border-radius:6px;border:none;font-size:0.82rem;font-weight:500;cursor:pointer;font-family:inherit;transition:all .15s;background:transparent;color:#666}
.ex-tab:hover{color:#aaa}
.ex-tab.active{background:rgba(74,158,255,0.12);color:#4a9eff}
.ex-toolbar{display:flex;gap:0.5rem;align-items:center;margin-bottom:1rem;padding:0.75rem 1rem;background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.06);border-radius:8px}
.ex-toolbar input{flex:1}
.ex-info-bar{display:flex;gap:1rem;align-items:center;padding:0.5rem 0;margin-bottom:1rem;font-size:0.8rem;color:#555;border-bottom:1px solid rgba(255,255,255,0.04);padding-bottom:0.75rem}
@media(max-width:768px){
  .ex-body{padding:1rem}
  .ex-grid{grid-template-columns:1fr}
  .ex-nav{padding:0 0.75rem}
  .ex-query-grid{grid-template-columns:repeat(auto-fill,minmax(140px,1fr))}
}
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
    <div className="ex-wrap">
      <style dangerouslySetInnerHTML={{ __html: S }} />

      {/* Nav */}
      <div className="ex-nav">
        <a href="/" className="ex-nav-brand">
          <svg width="20" height="20" viewBox="0 0 32 32" fill="none">
            <path d="M16 2L28 28H4L16 2Z" fill="#22c55e" opacity="0.9" />
            <path d="M16 2L22 15H10L16 2Z" fill="#22c55e" opacity="0.5" />
            <path d="M4 28L16 18L28 28H4Z" fill="#22c55e" opacity="0.3" />
          </svg>
          OpenZenith
        </a>
        <span className="ex-nav-crumb">/</span>
        <span style={{ color: "#666", fontSize: "0.85rem" }}>Explore</span>
        <div className="ex-nav-links">
          <a href="/">Home</a>
          <a href="/map">Map</a>
          <a href="/worldview">WorldView</a>
          <a href="/api/docs">Docs</a>
        </div>
      </div>

      <div className="ex-body">
        <h1>Data Explorer</h1>
        <p className="sub">Discover ArcGIS REST services and query OpenStreetMap via Overpass API</p>

        {/* Tabs */}
        <div className="ex-tabs">
          <button className={`ex-tab ${tab === "arcgis" ? "active" : ""}`} onClick={() => setTab("arcgis")}>ArcGIS Services</button>
          <button className={`ex-tab ${tab === "overpass" ? "active" : ""}`} onClick={() => setTab("overpass")}>Overpass / OSM</button>
        </div>

        {/* ═══ ARCGIS TAB ═══ */}
        {tab === "arcgis" && (
          <>
            <div className="ex-toolbar">
              <input
                placeholder="https://servicesX.arcgis.com/XXXX/ArcGIS/rest/services"
                value={customUrl}
                onChange={(e) => setCustomUrl(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addCustomHost()}
              />
              <button className="primary" onClick={addCustomHost}>Add Host</button>
              <button className="secondary" onClick={discoverAll} disabled={loading}>
                {loading ? "Scanning..." : `Scan All`}
              </button>
            </div>

            <div className="ex-info-bar">
              <span><span className="num">{hosts.filter((h) => h.serviceCount != null).length}</span> hosts scanned</span>
              <span className="ex-sep" />
              <span><span className="num">{totalServices.toLocaleString()}</span> services found</span>
              {hosts.filter((h) => h.serviceCount == null).length > 0 && (
                <>
                  <span className="ex-sep" />
                  <span>{hosts.filter((h) => h.serviceCount == null).length} remaining</span>
                </>
              )}
            </div>

            <h2>Hosts ({hosts.length})</h2>
            <div className="ex-grid">
              {hosts.map((h) => (
                <div key={h.id} className="ex-card">
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: "0.85rem" }}>{h.host}</div>
                      <div style={{ fontSize: "0.7rem", color: "#444", fontFamily: "'JetBrains Mono',monospace" }}>{h.id}</div>
                    </div>
                    <div className="ex-row">
                      {h.serviceCount != null && <span className="ex-badge fs">{h.serviceCount} services</span>}
                      {h.loading && <span className="ex-badge" style={{ background: "rgba(234,179,8,0.12)", color: "#eab308" }}>scanning...</span>}
                      {h.error && <span className="ex-badge err">{h.error.substring(0, 30)}</span>}
                    </div>
                  </div>
                  <div className="ex-row">
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
                      <div key={i} className="ex-card" style={{ padding: "0.6rem 0.8rem", cursor: "pointer" }}
                        onClick={() => fetchServiceInfo(s)}>
                        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                          <span className={`ex-badge ${typeBadge(s.type)}`}>{s.type.replace("Server", "")}</span>
                          <span style={{ fontSize: "0.8rem", color: "#bbb" }}>{s.name}</span>
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
                  <div className="ex-card" style={{ borderColor: "rgba(239,68,68,0.3)" }}>
                    <span className="ex-badge err">Error</span> {serviceDetails.error}
                  </div>
                ) : (
                  <div className="ex-card">
                    <div className="ex-stat"><span style={{ color: "#555" }}>Description:</span> {serviceDetails.description || serviceDetails.serviceDescription || "(none)"}</div>
                    <div className="ex-stat"><span style={{ color: "#555" }}>Copyright:</span> {serviceDetails.copyrightText || "(none)"}</div>
                    <div className="ex-stat"><span style={{ color: "#555" }}>Layers:</span> <span className="num">{serviceDetails.layers?.length || 0}</span></div>
                    <div className="ex-stat"><span style={{ color: "#555" }}>Capabilities:</span> {serviceDetails.capabilities || "N/A"}</div>
                    <div className="ex-stat"><span style={{ color: "#555" }}>Max Records:</span> {serviceDetails.maxRecordCount?.toLocaleString() || "N/A"}</div>
                    <div className="ex-stat"><span style={{ color: "#555" }}>Spatial Ref:</span> WKID {serviceDetails.spatialReference?.wkid || "N/A"}</div>
                    <div className="ex-stat"><span style={{ color: "#555" }}>Export Formats:</span> {serviceDetails.supportedExportFormats || "N/A"}</div>

                    {serviceDetails.layers?.length > 0 && (
                      <div style={{ marginTop: "0.75rem" }}>
                        <div style={{ fontSize: "0.8rem", fontWeight: 600, marginBottom: "0.4rem" }}>Layers</div>
                        {serviceDetails.layers.map((l: any) => (
                          <div key={l.id} style={{ fontSize: "0.78rem", padding: "0.2rem 0", color: "#888" }}>
                            <span style={{ color: "#4a9eff", marginRight: "0.4rem" }}>{l.id}</span>
                            {l.name} <span className="ex-tag">{l.geometryType}</span>
                            {l.defaultVisibility ? null : <span className="ex-tag" style={{ color: "#555" }}>hidden</span>}
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
            <p style={{ fontSize: "0.8rem", color: "#555", margin: "0 0 1rem" }}>
              Query OpenStreetMap data using the Overpass QL language. Use <code style={{ color: "#4a9eff", background: "rgba(74,158,255,0.1)", padding: "0.1rem 0.3rem", borderRadius: 3 }}>&#123;&#123;bbox&#125;&#125;</code> as a placeholder for the bounding box.
            </p>

            <div style={{ marginBottom: "0.75rem" }}>
              <label style={{ fontSize: "0.78rem", color: "#666", display: "block", marginBottom: "0.25rem" }}>
                Bounding Box (west,south,east,north)
              </label>
              <input value={opBbox} onChange={(e) => setOpBbox(e.target.value)} placeholder="-74.02,40.70,-73.95,40.78" />
            </div>

            <div style={{ marginBottom: "0.5rem" }}>
              <label style={{ fontSize: "0.78rem", color: "#666", display: "block", marginBottom: "0.25rem" }}>
                Overpass QL Query
              </label>
              <textarea
                value={opQuery}
                onChange={(e) => setOpQuery(e.target.value)}
                rows={6}
                placeholder={`[out:json][timeout:25];\nnode["amenity"]({{bbox}});\nout;`}
                style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: "0.82rem", resize: "vertical" }}
              />
            </div>

            <div className="ex-row" style={{ marginBottom: "1rem" }}>
              <button className="primary" onClick={runOverpass} disabled={opLoading}>
                {opLoading ? "Running..." : "Run Query"}
              </button>
              <span style={{ fontSize: "0.72rem", color: "#444" }}>
                Via /api/overpass
              </span>
            </div>

            <div style={{ marginBottom: "1rem" }}>
              <div style={{ fontSize: "0.8rem", fontWeight: 600, marginBottom: "0.5rem" }}>Quick Queries</div>
              <div className="ex-query-grid">
                {OVERPASS_QUERIES.map((q, i) => (
                  <button key={i} className="ex-query-btn" onClick={() => setOpQuery(q.query)}>
                    {q.label}
                  </button>
                ))}
              </div>
            </div>

            {opError && (
              <div className="ex-card" style={{ borderColor: "rgba(239,68,68,0.3)", marginBottom: "1rem" }}>
                <span className="ex-badge err">Error</span> {opError}
              </div>
            )}

            {opResult && (
              <div>
                <h3>Results</h3>
                <div className="ex-stat">
                  <span className="num">{opStats.nodes.toLocaleString()}</span> nodes
                  <span className="ex-sep" />
                  <span className="num">{opStats.ways.toLocaleString()}</span> ways
                  <span className="ex-sep" />
                  <span className="num">{opStats.relations.toLocaleString()}</span> relations
                  <span className="ex-sep" />
                  <span style={{ color: "#444" }}>Snapshot: {opResult.osm3s?.timestamp_osm_base || "N/A"}</span>
                </div>

                {opResult.elements.length > 0 && (
                  <pre style={{ marginTop: "0.75rem" }}>
                    {JSON.stringify(opResult.elements.slice(0, 50), null, 2)}
                    {opResult.elements.length > 50 && `\n... and ${(opResult.elements.length - 50).toLocaleString()} more elements`}
                  </pre>
                )}

                {opResult.elements.length === 0 && (
                  <div className="ex-empty">No elements found for this query and bounding box.</div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
