"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

/* ─── Types ─── */

interface Param {
  name: string;
  in: string;
  required?: boolean;
  schema?: { type: string; format?: string; minimum?: number; maximum?: number; maxLength?: number };
  description: string;
  example?: string | number;
}

interface RequestBody {
  required: boolean;
  content: {
    "application/json": {
      schema: {
        type: string;
        required?: string[];
        properties?: Record<string, Record<string, unknown>>;
        description?: string;
        maxLength?: number;
      };
      example: Record<string, unknown>;
    };
  };
}

interface ResponseContent {
  schema?: Record<string, unknown>;
  example?: Record<string, unknown>;
}

interface Response {
  description: string;
  content?: Record<string, ResponseContent>;
}

interface Endpoint {
  summary: string;
  description: string;
  parameters?: Param[];
  requestBody?: RequestBody;
  responses: Record<string, Response>;
  tags?: string[];
}

interface OpenApiSpec {
  info: {
    title: string;
    version: string;
    description: string;
    license?: { name: string };
  };
  servers: { url: string; description: string }[];
  paths: Record<string, Record<string, Endpoint>>;
  tags: { name: string; description: string }[];
}

const METHOD_COLORS: Record<string, string> = {
  get: "#22c55e",
  post: "#3b82f6",
  put: "#f59e0b",
  delete: "#ef4444",
};

const accent = "#22c55e";
const bg = "#0a0a0a";
const cardBg = "#111";
const border = "#222";
const text = "#e5e5e5";
const textDim = "#888";

/* ─── Small Components ─── */

function CopyBtn({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      title={label}
      style={{
        background: "none",
        border: "1px solid #333",
        borderRadius: 4,
        color: copied ? accent : textDim,
        cursor: "pointer",
        padding: "0.15rem 0.4rem",
        fontSize: "0.7rem",
        fontFamily: "inherit",
        marginLeft: "0.5rem",
        verticalAlign: "middle",
      }}
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

function ExampleBlock({ data }: { data: Record<string, unknown> }) {
  return (
    <pre
      style={{
        background: "#1a1a1a",
        color: "#e5e5e5",
        padding: "1rem",
        borderRadius: 8,
        fontSize: "0.78rem",
        lineHeight: 1.6,
        overflow: "auto",
        fontFamily: "'SF Mono', 'Fira Code', monospace",
        margin: 0,
      }}
    >
      {JSON.stringify(data, null, 2)}
    </pre>
  );
}

function ParamTable({ params }: { params: Param[] }) {
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
      <thead>
        <tr>
          {["Name", "In", "Type", "Required", "Description"].map((h) => (
            <th
              key={h}
              style={{
                textAlign: "left",
                padding: "0.5rem 0.75rem",
                borderBottom: "1px solid #333",
                color: textDim,
                fontWeight: 500,
                fontSize: "0.75rem",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
              }}
            >
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {params.map((p) => (
          <tr key={p.name}>
            <td
              style={{
                padding: "0.5rem 0.75rem",
                borderBottom: "1px solid #1a1a1a",
                fontFamily: "monospace",
                color: accent,
                fontSize: "0.85rem",
              }}
            >
              {p.name}
            </td>
            <td style={{ padding: "0.5rem 0.75rem", borderBottom: "1px solid #1a1a1a", color: textDim }}>{p.in}</td>
            <td
              style={{
                padding: "0.5rem 0.75rem",
                borderBottom: "1px solid #1a1a1a",
                color: textDim,
                fontSize: "0.8rem",
              }}
            >
              {p.schema?.type}
              {p.schema?.minimum !== undefined && p.schema?.maximum !== undefined
                ? ` (${p.schema.minimum}..${p.schema.maximum})`
                : ""}
              {p.schema?.maxLength ? ` (max ${p.schema.maxLength} chars)` : ""}
            </td>
            <td style={{ padding: "0.5rem 0.75rem", borderBottom: "1px solid #1a1a1a" }}>
              {p.required ? (
                <span
                  style={{
                    background: "#3b1c1c",
                    color: "#f87171",
                    padding: "0.15rem 0.5rem",
                    borderRadius: 4,
                    fontSize: "0.75rem",
                  }}
                >
                  required
                </span>
              ) : (
                <span
                  style={{
                    background: "#1a2e1a",
                    color: "#4ade80",
                    padding: "0.15rem 0.5rem",
                    borderRadius: 4,
                    fontSize: "0.75rem",
                  }}
                >
                  optional
                </span>
              )}
            </td>
            <td
              style={{ padding: "0.5rem 0.75rem", borderBottom: "1px solid #1a1a1a", color: "#ccc", lineHeight: 1.4 }}
            >
              {p.description}
              {p.example !== undefined && (
                <div style={{ marginTop: 4, fontFamily: "monospace", fontSize: "0.8rem", color: accent }}>
                  e.g. {String(p.example)}
                </div>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/* ─── Endpoint Card with editable try-it ─── */

function EndpointCard({
  path,
  method,
  endpoint,
  serverUrl,
}: {
  path: string;
  method: string;
  endpoint: Endpoint;
  serverUrl: string;
}) {
  const [open, setOpen] = useState(false);
  const [responseStatus, setResponseStatus] = useState<string | null>(null);
  const [responseJson, setResponseJson] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [paramValues, setParamValues] = useState<Record<string, string>>({});
  const [bodyText, setBodyText] = useState("");

  const color = METHOD_COLORS[method] || "#888";
  const isPost = method === "POST" || method === "PUT" || method === "PATCH";

  // Initialize param values from examples
  useEffect(() => {
    if (endpoint.parameters) {
      const init: Record<string, string> = {};
      for (const p of endpoint.parameters) {
        if (p.in === "query" && p.example !== undefined) {
          init[p.name] = String(p.example);
        }
      }
      setParamValues(init);
    }
    if (endpoint.requestBody?.content?.["application/json"]?.example) {
      setBodyText(JSON.stringify(endpoint.requestBody.content["application/json"].example, null, 2));
    }
  }, [endpoint]);

  // Build request URL preview
  const queryParams = endpoint.parameters
    ? endpoint.parameters
        .filter((p) => p.in === "query" && paramValues[p.name])
        .map((p) => `${p.name}=${encodeURIComponent(paramValues[p.name])}`)
        .join("&")
    : "";
  const previewUrl = serverUrl + path + (queryParams ? `?${queryParams}` : "");

  async function tryEndpoint() {
    setLoading(true);
    setError("");
    setResponseJson(null);
    setResponseStatus(null);
    try {
      let url = serverUrl + path;
      if (!isPost && queryParams) url += "?" + queryParams;

      const opts: RequestInit = { method: method.toUpperCase() };
      if (isPost && endpoint.requestBody) {
        opts.headers = { "Content-Type": "application/json" };
        opts.body = bodyText || JSON.stringify(endpoint.requestBody.content["application/json"].example);
      }

      const res = await fetch(url, opts);
      setResponseStatus(String(res.status));
      const text = await res.text();
      try {
        const json = JSON.parse(text);
        setResponseJson(JSON.stringify(json, null, 2));
      } catch {
        setResponseJson(text);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ border: `1px solid ${border}`, borderRadius: 12, overflow: "hidden", marginBottom: "0.75rem" }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: "0.75rem",
          padding: "1rem 1.25rem",
          background: "#111",
          border: "none",
          cursor: "pointer",
          textAlign: "left",
          color: text,
          fontFamily: "inherit",
        }}
      >
        <span
          style={{
            background: color,
            color: "#000",
            fontWeight: 700,
            fontSize: "0.7rem",
            padding: "0.2rem 0.5rem",
            borderRadius: 4,
            minWidth: 48,
            textAlign: "center",
            textTransform: "uppercase",
          }}
        >
          {method}
        </span>
        <span style={{ fontFamily: "monospace", fontSize: "0.85rem", flex: 1 }}>{path}</span>
        <span style={{ color: "#555", fontSize: "0.85rem" }}>{open ? "\u25b2" : "\u25bc"}</span>
      </button>

      {open && (
        <div style={{ padding: "1.25rem", background: "#0d0d0d" }}>
          <p style={{ margin: "0 0 1rem", fontSize: "0.9rem", color: "#aaa", lineHeight: 1.6 }}>
            {endpoint.description}
          </p>

          {/* Parameters */}
          {endpoint.parameters && endpoint.parameters.length > 0 && (
            <div style={{ marginBottom: "1.25rem" }}>
              <h4
                style={{
                  margin: "0 0 0.75rem",
                  fontSize: "0.8rem",
                  color: textDim,
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                }}
              >
                Parameters
              </h4>
              <ParamTable params={endpoint.parameters} />
            </div>
          )}

          {/* Request body */}
          {endpoint.requestBody && (
            <div style={{ marginBottom: "1.25rem" }}>
              <h4
                style={{
                  margin: "0 0 0.75rem",
                  fontSize: "0.8rem",
                  color: textDim,
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                }}
              >
                Request Body
              </h4>
              <textarea
                value={bodyText}
                onChange={(e) => setBodyText(e.target.value)}
                rows={5}
                style={{
                  width: "100%",
                  background: "#1a1a1a",
                  color: "#e5e5e5",
                  border: `1px solid #333`,
                  borderRadius: 8,
                  padding: "0.75rem",
                  fontFamily: "'SF Mono', 'Fira Code', monospace",
                  fontSize: "0.8rem",
                  lineHeight: 1.5,
                  resize: "vertical",
                  outline: "none",
                  boxSizing: "border-box",
                }}
              />
            </div>
          )}

          {/* Responses */}
          <div style={{ marginBottom: "1.25rem" }}>
            <h4
              style={{
                margin: "0 0 0.75rem",
                fontSize: "0.8rem",
                color: textDim,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
              }}
            >
              Responses
            </h4>
            {Object.entries(endpoint.responses).map(([code, resp]) => (
              <div key={code} style={{ marginBottom: "0.75rem" }}>
                <div
                  style={{
                    fontSize: "0.8rem",
                    marginBottom: "0.4rem",
                    color: code.startsWith("2") ? accent : code.startsWith("4") ? "#f59e0b" : textDim,
                  }}
                >
                  {code} - {resp.description}
                </div>
                {resp.content &&
                  Object.entries(resp.content).map(([ct, body]) => (
                    <div key={ct} style={{ marginBottom: "0.5rem" }}>
                      {body.schema && (
                        <div
                          style={{
                            fontFamily: "monospace",
                            fontSize: "0.75rem",
                            color: "#666",
                            marginBottom: "0.3rem",
                          }}
                        >
                          Content-Type: {ct}
                        </div>
                      )}
                      {body.example && <ExampleBlock data={body.example} />}
                    </div>
                  ))}
              </div>
            ))}
          </div>

          {/* Try it */}
          <div>
            <h4
              style={{
                margin: "0 0 0.75rem",
                fontSize: "0.8rem",
                color: textDim,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
              }}
            >
              Try it
            </h4>

            {/* Editable param inputs for query params */}
            {endpoint.parameters && endpoint.parameters.filter((p) => p.in === "query").length > 0 && (
              <div style={{ marginBottom: "0.75rem", display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
                {endpoint.parameters
                  .filter((p) => p.in === "query")
                  .map((p) => (
                    <div key={p.name} style={{ flex: "1 1 180px" }}>
                      <label
                        style={{
                          display: "block",
                          fontSize: "0.7rem",
                          color: textDim,
                          marginBottom: "0.2rem",
                          fontFamily: "monospace",
                        }}
                      >
                        {p.name}
                        {p.required ? " *" : ""}
                      </label>
                      <input
                        type="text"
                        value={paramValues[p.name] || ""}
                        onChange={(e) => setParamValues({ ...paramValues, [p.name]: e.target.value })}
                        placeholder={p.example !== undefined ? String(p.example) : p.description}
                        style={{
                          width: "100%",
                          background: "#1a1a1a",
                          color: "#e5e5e5",
                          border: `1px solid #333`,
                          borderRadius: 6,
                          padding: "0.4rem 0.6rem",
                          fontSize: "0.8rem",
                          fontFamily: "monospace",
                          outline: "none",
                          boxSizing: "border-box",
                        }}
                      />
                    </div>
                  ))}
              </div>
            )}

            {/* URL preview */}
            <div
              style={{
                background: "#1a1a1a",
                borderRadius: 6,
                padding: "0.5rem 0.75rem",
                fontFamily: "monospace",
                fontSize: "0.75rem",
                color: "#555",
                marginBottom: "0.75rem",
                wordBreak: "break-all",
                lineHeight: 1.5,
              }}
            >
              <span style={{ color: textDim }}>{method.toUpperCase()} </span>
              <span style={{ color: "#aaa" }}>{previewUrl}</span>
              <CopyBtn text={previewUrl} label="Copy URL" />
            </div>

            <button
              onClick={tryEndpoint}
              disabled={loading}
              style={{
                background: color,
                color: "#000",
                border: "none",
                padding: "0.5rem 1rem",
                borderRadius: 6,
                fontSize: "0.85rem",
                fontWeight: 600,
                cursor: loading ? "wait" : "pointer",
                fontFamily: "inherit",
              }}
            >
              {loading ? "Sending..." : `Send ${method.toUpperCase()} request`}
            </button>
            {responseStatus && (
              <div style={{ marginTop: "0.75rem" }}>
                <div
                  style={{
                    fontSize: "0.8rem",
                    color: responseStatus.startsWith("2") ? accent : "#ef4444",
                    marginBottom: "0.4rem",
                  }}
                >
                  Status: {responseStatus}
                </div>
                {responseJson && <ExampleBlock data={JSON.parse(responseJson)} />}
              </div>
            )}
            {error && <div style={{ marginTop: "0.5rem", color: "#ef4444", fontSize: "0.85rem" }}>{error}</div>}
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Code Examples Section ─── */

interface CodeExample {
  lang: string;
  code: string;
}

const CODE_EXAMPLES: { title: string; examples: CodeExample[] }[] = [
  {
    title: "Elevation Lookup",
    examples: [
      { lang: "cURL", code: `curl "https://openzenith.cyopsys.com/api/elevation?lat=28.0&lon=86.9"` },
      {
        lang: "JavaScript",
        code: `const res = await fetch("/api/elevation?lat=48.8566&lon=2.3522");\nconst { elevation, srtmTile } = await res.json();\nconsole.log(\`\${elevation}m (tile: \${srtmTile})\`);`,
      },
      {
        lang: "Python",
        code: `import requests\nr = requests.get("https://openzenith.cyopsys.com/api/elevation", params={"lat": 48.8566, "lon": 2.3522})\ndata = r.json()\nprint(f"{data['elevation']}m")`,
      },
    ],
  },
  {
    title: "MapLibre GL Elevation Source",
    examples: [
      {
        lang: "JavaScript",
        code: `// Add elevation tiles as a raster-dem source\nmap.addSource("elevation", {\n  type: "raster-dem",\n  tiles: ["https://openzenith.cyopsys.com/api/tile/{z}/{x}/{y}"],\n  tileSize: 256,\n  maxzoom: 15,\n  encoding: "terrarium",\n});\n\n// Add hillshade layer\nmap.addLayer({\n  id: "hillshade",\n  type: "hillshade",\n  source: "elevation",\n});`,
      },
    ],
  },
  {
    title: "Flight Tracking",
    examples: [
      { lang: "cURL", code: `curl "https://openzenith.cyopsys.com/api/flights?bbox=-122.5,37.7,-122.3,37.8"` },
      {
        lang: "JavaScript",
        code: `const res = await fetch("/api/flights?bbox=-122.5,37.7,-122.3,37.8");\nconst { states, time } = await res.json();\nconsole.log(\`\${states.length} aircraft at \${new Date(time * 1000).toISOString()}\`);`,
      },
    ],
  },
  {
    title: "OpenStreetMap (Overpass)",
    examples: [
      {
        lang: "JavaScript",
        code: `const res = await fetch("/api/overpass", {\n  method: "POST",\n  headers: { "Content-Type": "application/json" },\n  body: JSON.stringify({\n    query: "[out:json];node(48.85,2.35,48.86,2.36)[amenity=cafe];out 3;"\n  }),\n});\nconst data = await res.json();\nconsole.log(\`\${data.elements.length} cafes found\`);`,
      },
    ],
  },
  {
    title: "Weather Warnings",
    examples: [
      { lang: "cURL", code: `curl "https://openzenith.cyopsys.com/api/weather/warnings?geometry=-125,25,-65,50"` },
      {
        lang: "JavaScript",
        code: `const res = await fetch("/api/weather/warnings?geometry=-125,25,-65,50");\nconst { type, features } = await res.json();\nconsole.log(\`\${features.length} active warnings\`);`,
      },
    ],
  },
  {
    title: "CORS Proxy",
    examples: [
      {
        lang: "cURL",
        code: `curl "https://openzenith.cyopsys.com/api/proxy/https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson"`,
      },
      {
        lang: "JavaScript",
        code: `// Fetch USGS earthquakes through the CORS proxy\nconst res = await fetch(\n  "/api/proxy/https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson"\n);\nconst data = await res.json();`,
      },
    ],
  },
];

/* ─── Main Page ─── */

export default function DocsPage() {
  const [spec, setSpec] = useState<OpenApiSpec | null>(null);
  const [activeTag, setActiveTag] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/openapi.json")
      .then((r) => r.json())
      .then((data) => setSpec(data as OpenApiSpec));
  }, []);

  if (!spec) {
    return (
      <div
        style={{
          minHeight: "100vh",
          background: bg,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: textDim,
          fontFamily: "inherit",
        }}
      >
        Loading docs...
      </div>
    );
  }

  const serverUrl = spec.servers?.[0]?.url || "";

  // Group endpoints by tag
  const tagged: Record<string, { path: string; method: string; endpoint: Endpoint }[]> = {};
  for (const [path, methods] of Object.entries(spec.paths)) {
    for (const [method, endpoint] of Object.entries(methods)) {
      const tag = endpoint.tags?.[0] || "Other";
      if (!tagged[tag]) tagged[tag] = [];
      tagged[tag].push({ path, method, endpoint: endpoint as Endpoint });
    }
  }

  const activeEndpoints = activeTag ? tagged[activeTag] || [] : Object.values(tagged).flat();

  return (
    <div style={{ minHeight: "100vh", background: bg, color: text, fontFamily: "inherit" }}>
      {/* Header */}
      <div
        style={{
          maxWidth: 960,
          margin: "0 auto",
          padding: "1.5rem",
          display: "flex",
          alignItems: "center",
          gap: "0.75rem",
        }}
      >
        <Link
          href="/"
          style={{
            color: text,
            textDecoration: "none",
            fontWeight: 700,
            display: "flex",
            alignItems: "center",
            gap: "0.4rem",
          }}
        >
          <svg width="20" height="20" viewBox="0 0 32 32" fill="none">
            <path d="M16 2L28 28H4L16 2Z" fill={accent} opacity="0.9" />
            <path d="M16 2L22 15H10L16 2Z" fill={accent} opacity="0.5" />
            <path d="M4 28L16 18L28 28H4Z" fill={accent} opacity="0.3" />
          </svg>
          OpenZenith
        </Link>
        <span style={{ color: "#333" }}>/</span>
        <span style={{ color: textDim, fontSize: "0.9rem" }}>API Docs</span>
      </div>

      {/* Title */}
      <div style={{ maxWidth: 960, margin: "0 auto", padding: "0 1.5rem 2rem" }}>
        <h1 style={{ fontSize: "1.8rem", fontWeight: 700, letterSpacing: "-0.02em", margin: "0 0 0.5rem" }}>
          {spec.info.title}
        </h1>
        <p style={{ color: textDim, margin: "0 0 1rem", lineHeight: 1.6, fontSize: "0.95rem" }}>
          {spec.info.description}
        </p>
        <div style={{ display: "flex", gap: "1rem", alignItems: "center", flexWrap: "wrap" }}>
          <span
            style={{
              background: "#1a2e1a",
              color: accent,
              padding: "0.2rem 0.6rem",
              borderRadius: 4,
              fontSize: "0.8rem",
              fontFamily: "monospace",
            }}
          >
            v{spec.info.version}
          </span>
          <span style={{ color: "#555", fontSize: "0.85rem" }}>Server: {serverUrl}</span>
        </div>
      </div>

      {/* Interactive Features */}
      <div style={{ maxWidth: 960, margin: "0 auto", padding: "0 1.5rem 2rem" }}>
        <h2 style={{ fontSize: "1.1rem", fontWeight: 600, margin: "0 0 1rem", letterSpacing: "-0.01em" }}>
          Interactive Maps
        </h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "0.75rem" }}>
          <a
            href="/map"
            style={{
              textDecoration: "none",
              color: "inherit",
              background: cardBg,
              border: `1px solid ${border}`,
              borderRadius: 12,
              padding: "1.25rem",
              display: "block",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.5rem" }}>
              <div
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 6,
                  background: "rgba(34,197,94,0.12)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: accent,
                  fontSize: "0.9rem",
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 2C8.13 2 5 4.13 5 8c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" />
                  <circle cx="12" cy="10" r="3" />
                </svg>
              </div>
              <h3 style={{ margin: 0, fontSize: "0.95rem", fontWeight: 600 }}>Elevation Map</h3>
            </div>
            <p style={{ margin: "0 0 0.5rem", fontSize: "0.8rem", color: textDim, lineHeight: 1.5 }}>
              Click any point for elevation. Hillshade, 3D terrain, contour lines, 6 basemaps, elevation pins, and
              profile tool.
            </p>
            <div style={{ fontSize: "0.7rem", color: "#555", fontFamily: "monospace", lineHeight: 1.6 }}>
              #lng=...&lat=...&zoom=...
              <br />
              #x=...&y=...&z=... (tile center)
            </div>
          </a>

          <a
            href="/globe"
            style={{
              textDecoration: "none",
              color: "inherit",
              background: cardBg,
              border: `1px solid ${border}`,
              borderRadius: 12,
              padding: "1.25rem",
              display: "block",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.5rem" }}>
              <div
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 6,
                  background: "rgba(34,197,94,0.12)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: accent,
                  fontSize: "0.9rem",
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-10-4 15.3 15.3 0 0 1-10 4 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10 15.3 15.3 0 0 1 10 4 15.3 15.3 0 0 1 10-4z" />
                </svg>
              </div>
              <h3 style={{ margin: 0, fontSize: "0.95rem", fontWeight: 600 }}>Globe Dashboard</h3>
            </div>
            <p style={{ margin: "0 0 0.5rem", fontSize: "0.8rem", color: textDim, lineHeight: 1.5 }}>
              Real-time geospatial intelligence. Earthquakes, flights, weather radar, satellites, hurricanes, natural
              events, and more.
            </p>
            <div style={{ fontSize: "0.7rem", color: "#555", fontFamily: "monospace", lineHeight: 1.6 }}>
              Layers: earthquakes, radar, flights, satellites,
              <br />
              weather, events, hurricanes, hillshade, 3D
            </div>
          </a>

          <a
            href="/explore"
            style={{
              textDecoration: "none",
              color: "inherit",
              background: cardBg,
              border: `1px solid ${border}`,
              borderRadius: 12,
              padding: "1.25rem",
              display: "block",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.5rem" }}>
              <div
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 6,
                  background: "rgba(34,197,94,0.12)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: accent,
                  fontSize: "0.9rem",
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="11" cy="11" r="8" />
                  <path d="m21 21-4.35-4.35" />
                </svg>
              </div>
              <h3 style={{ margin: 0, fontSize: "0.95rem", fontWeight: 600 }}>Data Explorer</h3>
            </div>
            <p style={{ margin: "0 0 0.5rem", fontSize: "0.8rem", color: textDim, lineHeight: 1.5 }}>
              Discover ArcGIS REST services and query OpenStreetMap via Overpass API. Browse layers, preview features,
              run custom queries.
            </p>
            <div style={{ fontSize: "0.7rem", color: "#555", fontFamily: "monospace", lineHeight: 1.6 }}>
              ArcGIS service discovery + Overpass QL
            </div>
          </a>
        </div>
      </div>

      {/* Tag filters */}
      <div style={{ maxWidth: 960, margin: "0 auto", padding: "0 1.5rem 1.5rem" }}>
        <h2 style={{ fontSize: "1.1rem", fontWeight: 600, margin: "0 0 0.75rem", letterSpacing: "-0.01em" }}>
          API Reference
        </h2>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          <button
            onClick={() => setActiveTag(null)}
            style={{
              background: !activeTag ? accent : "#161616",
              color: !activeTag ? "#000" : textDim,
              border: `1px solid ${!activeTag ? accent : border}`,
              padding: "0.35rem 0.75rem",
              borderRadius: 6,
              fontSize: "0.8rem",
              cursor: "pointer",
              fontFamily: "inherit",
              fontWeight: !activeTag ? 600 : 400,
            }}
          >
            All
          </button>
          {spec.tags.map((tag) => (
            <button
              key={tag.name}
              onClick={() => setActiveTag(tag.name)}
              style={{
                background: activeTag === tag.name ? accent : "#161616",
                color: activeTag === tag.name ? "#000" : textDim,
                border: `1px solid ${activeTag === tag.name ? accent : border}`,
                padding: "0.35rem 0.75rem",
                borderRadius: 6,
                fontSize: "0.8rem",
                cursor: "pointer",
                fontFamily: "inherit",
                fontWeight: activeTag === tag.name ? 600 : 400,
              }}
            >
              {tag.name}
            </button>
          ))}
        </div>
      </div>

      {/* Endpoints */}
      <div style={{ maxWidth: 960, margin: "0 auto", padding: "0 1.5rem 2rem" }}>
        {activeEndpoints.map(({ path, method, endpoint }) => (
          <EndpointCard
            key={`${method}-${path}`}
            path={path}
            method={method}
            endpoint={endpoint}
            serverUrl={serverUrl}
          />
        ))}
      </div>

      {/* Code Examples */}
      <div style={{ maxWidth: 960, margin: "0 auto", padding: "0 1.5rem 3rem" }}>
        <h2 style={{ fontSize: "1.1rem", fontWeight: 600, margin: "0 0 1rem", letterSpacing: "-0.01em" }}>
          Code Examples
        </h2>
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          {CODE_EXAMPLES.map((section) => (
            <div
              key={section.title}
              style={{ background: cardBg, border: `1px solid ${border}`, borderRadius: 12, padding: "1.25rem" }}
            >
              <h3 style={{ margin: "0 0 0.75rem", fontSize: "0.9rem", fontWeight: 600 }}>{section.title}</h3>
              {section.examples.map((ex) => (
                <div key={ex.lang} style={{ marginBottom: "0.5rem" }}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginBottom: "0.3rem",
                    }}
                  >
                    <span
                      style={{
                        fontSize: "0.7rem",
                        color: textDim,
                        textTransform: "uppercase",
                        fontWeight: 600,
                        letterSpacing: "0.05em",
                      }}
                    >
                      {ex.lang}
                    </span>
                    <CopyBtn text={ex.code} label={`Copy ${ex.lang}`} />
                  </div>
                  <pre
                    style={{
                      background: "#1a1a1a",
                      color: "#e5e5e5",
                      padding: "0.8rem 1rem",
                      borderRadius: 8,
                      fontSize: "0.78rem",
                      lineHeight: 1.6,
                      overflowX: "auto",
                      fontFamily: "'SF Mono', 'Fira Code', monospace",
                      margin: 0,
                    }}
                  >
                    {ex.code}
                  </pre>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
