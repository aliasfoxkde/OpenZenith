"use client";

import { useState, useEffect } from "react";

interface Param {
  name: string;
  in: string;
  required?: boolean;
  schema?: { type: string; minimum?: number; maximum?: number };
  description: string;
  example?: string | number;
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

function schemaToType(schema: Record<string, unknown>, indent = 0): string {
  const pad = "  ".repeat(indent);
  if (!schema) return pad + "any";

  if (schema.type === "string" && schema.format === "binary") return pad + "binary";
  if (schema.type === "string") return pad + "string";
  if (schema.type === "number" || schema.type === "integer") return pad + "number";
  if (schema.type === "boolean") return pad + "boolean";
  if (schema.type === "array") {
    const items = schema.items as Record<string, unknown> | undefined;
    return pad + "array<" + schemaToType(items || {}, 0).trim() + ">";
  }
  if (schema.type === "object" && schema.properties) {
    const props = schema.properties as Record<string, Record<string, unknown>>;
    const lines = [pad + "{"];
    for (const [key, val] of Object.entries(props)) {
      lines.push(pad + "  " + key + ": " + schemaToType(val, 0).trim() + ";");
    }
    lines.push(pad + "}");
    return lines.join("\n");
  }
  return pad + String(schema.type || "any");
}

function ExampleBlock({ data }: { data: Record<string, unknown> }) {
  return (
    <pre
      style={{
        background: "#1a1a1a",
        color: "#e5e5e5",
        padding: "1rem",
        borderRadius: 8,
        fontSize: "0.8rem",
        lineHeight: 1.6,
        overflow: "auto",
        fontFamily: "'SF Mono', 'Fira Code', monospace",
      }}
    >
      {JSON.stringify(data, null, 2)}
    </pre>
  );
}

function ParamTable({ params }: { params: Param[] }) {
  return (
    <table
      style={{
        width: "100%",
        borderCollapse: "collapse",
        fontSize: "0.85rem",
      }}
    >
      <thead>
        <tr>
          {["Name", "In", "Type", "Required", "Description"].map((h) => (
            <th
              key={h}
              style={{
                textAlign: "left",
                padding: "0.5rem 0.75rem",
                borderBottom: "1px solid #333",
                color: "#888",
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
                color: "#22c55e",
                fontSize: "0.85rem",
              }}
            >
              {p.name}
            </td>
            <td
              style={{
                padding: "0.5rem 0.75rem",
                borderBottom: "1px solid #1a1a1a",
                color: "#888",
              }}
            >
              {p.in}
            </td>
            <td
              style={{
                padding: "0.5rem 0.75rem",
                borderBottom: "1px solid #1a1a1a",
                color: "#888",
                fontSize: "0.8rem",
              }}
            >
              {p.schema?.type}
              {p.schema?.minimum !== undefined && p.schema?.maximum !== undefined
                ? ` (${p.schema.minimum}..${p.schema.maximum})`
                : ""}
            </td>
            <td
              style={{
                padding: "0.5rem 0.75rem",
                borderBottom: "1px solid #1a1a1a",
              }}
            >
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
              style={{
                padding: "0.5rem 0.75rem",
                borderBottom: "1px solid #1a1a1a",
                color: "#ccc",
                lineHeight: 1.4,
              }}
            >
              {p.description}
              {p.example !== undefined && (
                <div style={{ marginTop: 4, fontFamily: "monospace", fontSize: "0.8rem", color: "#22c55e" }}>
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

  const color = METHOD_COLORS[method] || "#888";

  async function tryEndpoint() {
    setLoading(true);
    setError("");
    setResponseJson(null);
    setResponseStatus(null);
    try {
      let url = serverUrl + path;
      if (method === "GET" && endpoint.parameters) {
        const queryParams = endpoint.parameters
          .filter((p) => p.in === "query" && p.example !== undefined)
          .map((p) => `${p.name}=${encodeURIComponent(String(p.example))}`)
          .join("&");
        if (queryParams) url += "?" + queryParams;
      }
      const res = await fetch(url);
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
    <div
      style={{
        border: "1px solid #222",
        borderRadius: 12,
        overflow: "hidden",
        marginBottom: "0.75rem",
      }}
    >
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
          color: "#e5e5e5",
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
        <span
          style={{
            fontFamily: "monospace",
            fontSize: "0.85rem",
            flex: 1,
          }}
        >
          {path}
        </span>
        <span style={{ color: "#555", fontSize: "0.85rem" }}>
          {open ? "\u25b2" : "\u25bc"}
        </span>
      </button>

      {open && (
        <div style={{ padding: "1.25rem", background: "#0d0d0d" }}>
          <p style={{ margin: "0 0 1rem", fontSize: "0.9rem", color: "#aaa", lineHeight: 1.6 }}>
            {endpoint.description}
          </p>

          {endpoint.parameters && endpoint.parameters.length > 0 && (
            <div style={{ marginBottom: "1.25rem" }}>
              <h4
                style={{
                  margin: "0 0 0.75rem",
                  fontSize: "0.8rem",
                  color: "#888",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                }}
              >
                Parameters
              </h4>
              <ParamTable params={endpoint.parameters} />
            </div>
          )}

          {/* Responses */}
          <div style={{ marginBottom: "1.25rem" }}>
            <h4
              style={{
                margin: "0 0 0.75rem",
                fontSize: "0.8rem",
                color: "#888",
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
                    color: code.startsWith("2") ? "#22c55e" : code.startsWith("4") ? "#f59e0b" : "#888",
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
                color: "#888",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
              }}
            >
              Try it
            </h4>
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
                    color: responseStatus.startsWith("2") ? "#22c55e" : "#ef4444",
                    marginBottom: "0.4rem",
                  }}
                >
                  Status: {responseStatus}
                </div>
                {responseJson && <ExampleBlock data={JSON.parse(responseJson)} />}
              </div>
            )}
            {error && (
              <div style={{ marginTop: "0.5rem", color: "#ef4444", fontSize: "0.85rem" }}>{error}</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function DocsPage() {
  const [spec, setSpec] = useState<OpenApiSpec | null>(null);
  const [activeTag, setActiveTag] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/openapi.json")
      .then((r) => r.json())
      .then(setSpec);
  }, []);

  if (!spec) {
    return (
      <div
        style={{
          minHeight: "100vh",
          background: "#0a0a0a",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#888",
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

  const activeEndpoints = activeTag
    ? tagged[activeTag] || []
    : Object.values(tagged).flat();

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#0a0a0a",
        color: "#e5e5e5",
        fontFamily: "inherit",
      }}
    >
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
        <a
          href="/"
          style={{
            color: "#e5e5e5",
            textDecoration: "none",
            fontWeight: 700,
            display: "flex",
            alignItems: "center",
            gap: "0.4rem",
          }}
        >
          <svg width="20" height="20" viewBox="0 0 32 32" fill="none">
            <path d="M16 2L28 28H4L16 2Z" fill="#22c55e" opacity="0.9" />
            <path d="M16 2L22 15H10L16 2Z" fill="#22c55e" opacity="0.5" />
            <path d="M4 28L16 18L28 28H4Z" fill="#22c55e" opacity="0.3" />
          </svg>
          OpenZenith
        </a>
        <span style={{ color: "#333" }}>/</span>
        <span style={{ color: "#888", fontSize: "0.9rem" }}>API Docs</span>
      </div>

      {/* Title section */}
      <div style={{ maxWidth: 960, margin: "0 auto", padding: "0 1.5rem 2rem" }}>
        <h1
          style={{
            fontSize: "1.8rem",
            fontWeight: 700,
            letterSpacing: "-0.02em",
            margin: "0 0 0.5rem",
          }}
        >
          {spec.info.title}
        </h1>
        <p style={{ color: "#888", margin: "0 0 1rem", lineHeight: 1.6, fontSize: "0.95rem" }}>
          {spec.info.description}
        </p>
        <div style={{ display: "flex", gap: "1rem", alignItems: "center", flexWrap: "wrap" }}>
          <span
            style={{
              background: "#1a2e1a",
              color: "#22c55e",
              padding: "0.2rem 0.6rem",
              borderRadius: 4,
              fontSize: "0.8rem",
              fontFamily: "monospace",
            }}
          >
            v{spec.info.version}
          </span>
          {spec.info.license && (
            <span style={{ color: "#555", fontSize: "0.85rem" }}>{spec.info.license.name}</span>
          )}
          <span style={{ color: "#555", fontSize: "0.85rem" }}>Server: {serverUrl}</span>
        </div>
      </div>

      {/* Tag filters */}
      <div style={{ maxWidth: 960, margin: "0 auto", padding: "0 1.5rem 1.5rem" }}>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          <button
            onClick={() => setActiveTag(null)}
            style={{
              background: !activeTag ? "#22c55e" : "#161616",
              color: !activeTag ? "#000" : "#888",
              border: "1px solid " + (!activeTag ? "#22c55e" : "#222"),
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
                background: activeTag === tag.name ? "#22c55e" : "#161616",
                color: activeTag === tag.name ? "#000" : "#888",
                border: "1px solid " + (activeTag === tag.name ? "#22c55e" : "#222"),
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
      <div style={{ maxWidth: 960, margin: "0 auto", padding: "0 1.5rem 3rem" }}>
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
    </div>
  );
}
