"use client";

import { useState, useMemo, useCallback } from "react";
import type { UploadedDataset } from "../lib/types";

interface Props {
  dark: boolean;
  dataset: UploadedDataset;
}

export function DataTable({ dark, dataset }: Props) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [filterText, setFilterText] = useState("");
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 50;

  const features = useMemo(() => {
    let list = dataset.data.features.filter((f) => f.geometry);

    // Filter
    if (filterText) {
      const q = filterText.toLowerCase();
      list = list.filter((f) => {
        const props = f.properties ?? {};
        return Object.values(props).some((v) => String(v).toLowerCase().includes(q));
      });
    }

    // Sort
    if (sortKey) {
      list = [...list].sort((a, b) => {
        const va = a.properties?.[sortKey];
        const vb = b.properties?.[sortKey];
        if (va == null && vb == null) return 0;
        if (va == null) return 1;
        if (vb == null) return -1;
        if (typeof va === "number" && typeof vb === "number") {
          return sortDir === "asc" ? va - vb : vb - va;
        }
        const sa = String(va);
        const sb = String(vb);
        return sortDir === "asc" ? sa.localeCompare(sb) : sb.localeCompare(sa);
      });
    }

    return list;
  }, [dataset.data.features, sortKey, sortDir, filterText]);

  const totalPages = Math.ceil(features.length / PAGE_SIZE);
  const paged = features.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  // Column names
  const columns = useMemo(() => {
    const geomCol = { key: "__geom__", label: "Geometry" };
    const propKeys = new Set<string>();
    for (const f of dataset.data.features) {
      if (f.properties) {
        for (const k of Object.keys(f.properties)) propKeys.add(k);
      }
    }
    // Show first 8 property columns
    const propCols = Array.from(propKeys)
      .slice(0, 8)
      .map((k) => ({ key: k, label: k }));
    return [geomCol, ...propCols];
  }, [dataset.data.features]);

  const handleSort = useCallback(
    (key: string) => {
      if (sortKey === key) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      } else {
        setSortKey(key);
        setSortDir("asc");
      }
      setPage(0);
    },
    [sortKey],
  );

  const handleExportGeoJSON = useCallback(() => {
    const json = JSON.stringify(dataset.data, null, 2);
    downloadFile(json, `${dataset.name}.geojson`, "application/geo+json");
  }, [dataset]);

  const handleExportCSV = useCallback(() => {
    const props = Object.keys(dataset.data.features[0]?.properties ?? {});
    const header = props.join(",");
    const rows = dataset.data.features.map((f) =>
      props
        .map((p) => {
          const v = f.properties?.[p];
          if (typeof v === "string" && (v.includes(",") || v.includes('"'))) return `"${v.replace(/"/g, '""')}"`;
          return v ?? "";
        })
        .join(","),
    );
    downloadFile([header, ...rows].join("\n"), `${dataset.name}.csv`, "text/csv");
  }, [dataset]);

  const handleExportKML = useCallback(() => {
    const placemarks = dataset.data.features
      .map((f) => {
        const name = f.properties?.name ?? "";
        const desc = f.properties?.description ?? "";
        const geom = f.geometry;
        let geomXml = "";
        if (geom.type === "Point") {
          geomXml = `<Point><coordinates>${geom.coordinates[0]},${geom.coordinates[1]},0</coordinates></Point>`;
        } else if (geom.type === "LineString") {
          const coords = geom.coordinates.map((c: number[]) => `${c[0]},${c[1]},0`).join(" ");
          geomXml = `<LineString><coordinates>${coords}</coordinates></LineString>`;
        } else if (geom.type === "Polygon") {
          const rings = geom.coordinates
            .map(
              (ring: number[][]) =>
                `<outerBoundaryIs><LinearRing><coordinates>${ring.map((c: number[]) => `${c[0]},${c[1]},0`).join(" ")}</coordinates></LinearRing></outerBoundaryIs>`,
            )
            .join("");
          geomXml = `<Polygon>${rings}</Polygon>`;
        }
        return `<Placemark><name>${escapeXml(name)}</name>${desc ? `<description>${escapeXml(desc)}</description>` : ""}${geomXml}</Placemark>`;
      })
      .join("\n");
    const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
<Document><name>${escapeXml(dataset.name)}</name>
${placemarks}
</Document>
</kml>`;
    downloadFile(kml, `${dataset.name}.kml`, "application/vnd.google-earth.kml+xml");
  }, [dataset]);

  const border = dark ? "#2a2a2a" : "#e5e5e5";
  const text = dark ? "#e5e5e5" : "#171717";
  const textSec = dark ? "#888" : "#737373";
  const inputBg = dark ? "#1a1a1a" : "#f5f5f5";
  const thBg = dark ? "#1a1a1a" : "#f9f9f9";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {/* Export buttons */}
      <div style={{ display: "flex", gap: 4 }}>
        <button onClick={handleExportGeoJSON} style={btnStyle(inputBg, border, text)}>
          GeoJSON
        </button>
        <button onClick={handleExportCSV} style={btnStyle(inputBg, border, text)}>
          CSV
        </button>
        <button onClick={handleExportKML} style={btnStyle(inputBg, border, text)}>
          KML
        </button>
      </div>

      {/* Search */}
      <input
        type="text"
        placeholder="Filter features..."
        value={filterText}
        onChange={(e) => {
          setFilterText(e.target.value);
          setPage(0);
        }}
        style={{
          background: inputBg,
          border: `1px solid ${border}`,
          borderRadius: 3,
          color: text,
          fontSize: 11,
          padding: "4px 8px",
          outline: "none",
          width: "100%",
        }}
      />

      {/* Table */}
      <div style={{ overflow: "auto", maxHeight: 300, border: `1px solid ${border}`, borderRadius: 4 }}>
        <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 10 }}>
          <thead>
            <tr style={{ background: thBg, position: "sticky", top: 0, zIndex: 1 }}>
              {columns.map((col) => (
                <th
                  key={col.key}
                  onClick={() => handleSort(col.key)}
                  style={{
                    padding: "4px 6px",
                    textAlign: "left",
                    borderBottom: `1px solid ${border}`,
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                    color: textSec,
                    fontWeight: 600,
                    userSelect: "none",
                  }}
                >
                  {col.label}
                  {sortKey === col.key && (sortDir === "asc" ? " \u2191" : " \u2193")}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {paged.map((f, i) => (
              <tr key={i} style={{ borderBottom: `1px solid ${border}` }}>
                <td style={{ padding: "2px 6px", color: textSec }}>{f.geometry?.type?.replace("Multi", "") ?? "-"}</td>
                {columns.slice(1).map((col) => {
                  const v = f.properties?.[col.key];
                  return (
                    <td
                      key={col.key}
                      style={{
                        padding: "2px 6px",
                        color: text,
                        maxWidth: 120,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {v != null ? (typeof v === "number" ? v.toLocaleString() : String(v)) : ""}
                    </td>
                  );
                })}
              </tr>
            ))}
            {paged.length === 0 && (
              <tr>
                <td colSpan={columns.length} style={{ padding: "12px", textAlign: "center", color: textSec }}>
                  No matching features
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, color: textSec, fontSize: 10 }}>
          <button onClick={() => setPage(0)} disabled={page === 0} style={btnStyle(inputBg, border, text)}>
            First
          </button>
          <button
            onClick={() => setPage(Math.max(0, page - 1))}
            disabled={page === 0}
            style={btnStyle(inputBg, border, text)}
          >
            Prev
          </button>
          <span>
            {page + 1} / {totalPages}
          </span>
          <button
            onClick={() => setPage(Math.min(totalPages - 1, page + 1))}
            disabled={page >= totalPages - 1}
            style={btnStyle(inputBg, border, text)}
          >
            Next
          </button>
          <button
            onClick={() => setPage(totalPages - 1)}
            disabled={page >= totalPages - 1}
            style={btnStyle(inputBg, border, text)}
          >
            Last
          </button>
          <span style={{ marginLeft: "auto" }}>{features.length} features</span>
        </div>
      )}
    </div>
  );
}

function btnStyle(bg: string, border: string, color: string): React.CSSProperties {
  return {
    background: bg,
    border: `1px solid ${border}`,
    borderRadius: 3,
    color,
    cursor: "pointer",
    fontSize: 10,
    padding: "2px 8px",
  };
}

function downloadFile(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
