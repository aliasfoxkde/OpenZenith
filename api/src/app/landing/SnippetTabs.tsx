"use client";

import { useEffect, useState } from "react";
import { latLonToTile } from "./locations";
import { CodeBlock } from "@/components/CodeBlock";

export interface SnippetResult {
  elevation: number | null;
  unit: string;
  srtmTile: string;
  tile: string;
  source: string;
  resolution: number;
  location: { lat: number; lon: number };
}

type SnippetTab = "url" | "tile" | "curl" | "js" | "python" | "result";

const ORIGIN = "https://openzenith.cyopsys.com";
const DEFAULT_LAT = "28.0";
const DEFAULT_LON = "86.9";

/** Plain-text form of each snippet — used for both copy and display. */
function snippetText(tab: SnippetTab, lat: string, lon: string, result: SnippetResult | null): string {
  if (tab === "result" && result) {
    return result.elevation !== null ? `${result.elevation}m (${(result.elevation * 3.28084).toFixed(2)} ft)` : "No data";
  }
  switch (tab) {
    case "url":
      return `${ORIGIN}/api/elevation?lat=${lat}&lon=${lon}`;
    case "tile": {
      const t = latLonToTile(Number(lat), Number(lon), 8);
      return `${ORIGIN}/api/tile/8/${t.x}/${t.y}`;
    }
    case "curl":
      return `curl "${ORIGIN}/api/elevation?lat=${lat}&lon=${lon}"`;
    case "js":
      return `const res = await fetch('/api/elevation?lat=${lat}&lon=${lon}')\nconst { elevation } = await res.json()`;
    default:
      return `import requests\nres = requests.get("${ORIGIN}/api/elevation", params={"lat": ${lat}, "lon": ${lon}})\nprint(res.json()["elevation"])`;
  }
}

interface SnippetTabsProps {
  lat: string;
  lon: string;
  result: SnippetResult | null;
  placeName: string | null;
  loading: boolean;
  dark: boolean;
  text: string;
  textSecondary: string;
}

/**
 * Result + code-snippet panel under the elevation lookup: tabbed API URL,
 * tile, cURL, JS, and Python examples with a copy button.
 */
export function SnippetTabs({ lat, lon, result, placeName, loading, dark, text, textSecondary }: SnippetTabsProps) {
  const [tab, setTab] = useState<SnippetTab>("url");
  const [copied, setCopied] = useState(false);

  // A fresh lookup result takes over the panel — the user asked for the
  // elevation, so show it instead of whatever snippet tab was open.
  useEffect(() => {
    if (result) setTab("result");
  }, [result]);

  const la = lat || DEFAULT_LAT;
  const lo = lon || DEFAULT_LON;

  return (
    <div
      id="snippets-panel"
      className="oz-snippets"
      aria-live="polite"
      aria-label="Elevation result"
      aria-busy={loading}
    >
      <div className="oz-snippet-bar">
        <div className="oz-snippet-tabs">
          {result && (
            <button className={`oz-snippet-tab ${tab === "result" ? "active" : ""}`} onClick={() => { setTab("result"); }}>
              Result
            </button>
          )}
          <button className={`oz-snippet-tab ${tab === "url" ? "active" : ""}`} onClick={() => { setTab("url"); }}>
            API URL
          </button>
          <button className={`oz-snippet-tab ${tab === "tile" ? "active" : ""}`} onClick={() => { setTab("tile"); }}>
            Tile
          </button>
          <button className={`oz-snippet-tab ${tab === "curl" ? "active" : ""}`} onClick={() => { setTab("curl"); }}>
            cURL
          </button>
          <button className={`oz-snippet-tab ${tab === "js" ? "active" : ""}`} onClick={() => { setTab("js"); }}>
            JS
          </button>
          <button className={`oz-snippet-tab ${tab === "python" ? "active" : ""}`} onClick={() => { setTab("python"); }}>
            Python
          </button>
        </div>
        <button
          className="oz-snippet-copy"
          onClick={() => {
            // Best-effort: clipboard access can be denied without user focus.
            navigator.clipboard.writeText(snippetText(tab, la, lo, result)).catch(() => {});
            setCopied(true);
            setTimeout(() => { setCopied(false); }, 1500);
          }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <CodeBlock dark={dark} code={snippetText(tab, la, lo, result)}>
        {tab === "result" && result && (
          <div>
            <div className="oz-result-value">
              {result.elevation !== null ? `${result.elevation.toLocaleString()}m` : "No data"}
              {result.elevation !== null && <span className="oz-result-ft">({(result.elevation * 3.28084).toFixed(2)} ft)</span>}
            </div>
            <div className="oz-result-meta">
              {result.location.lat.toFixed(4)}, {result.location.lon.toFixed(4)} &middot; {result.tile || result.srtmTile} &middot;{" "}
              {result.resolution}m
            </div>
            {placeName && (
              <div style={{ fontSize: "0.72rem", color: textSecondary, marginTop: "0.15rem", fontStyle: "italic" }}>
                near {placeName}
              </div>
            )}
          </div>
        )}
        {tab === "url" && (
          <a
            id="snippet-api-url"
            className="oz-snippet-url"
            href={`${ORIGIN}/api/elevation?lat=${la}&lon=${lo}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            {ORIGIN}/api/elevation?lat={la}&amp;lon={lo}
          </a>
        )}
        {tab === "tile" &&
          (() => {
            const t = latLonToTile(Number(la), Number(lo), 8);
            const tileUrl = `/api/tile/8/${t.x}/${t.y}`;
            const mapUrl = `/map#lng=${lo}&lat=${la}&zoom=10`;
            return (
              <>
                <a className="oz-snippet-url" href={`${ORIGIN}${tileUrl}`} target="_blank" rel="noopener noreferrer">
                  {ORIGIN}
                  {tileUrl}
                </a>
                <div style={{ marginTop: 6, display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <a
                    href={mapUrl}
                    style={{
                      fontSize: "0.68rem",
                      color: "var(--oz-accent, #00e5ff)",
                      textDecoration: "none",
                      fontFamily: "var(--oz-font-mono, monospace)",
                    }}
                  >
                    Open in Map &rarr;
                  </a>
                  <span
                    style={{
                      fontSize: "0.65rem",
                      color: "var(--oz-text-secondary, #64748b)",
                      fontFamily: "var(--oz-font-mono, monospace)",
                    }}
                  >
                    z8 &middot; {t.x}/{t.y} &middot; 256&times;256 Int16
                  </span>
                </div>
              </>
            );
          })()}
        {tab === "curl" && (
          <div>
            <span className="oz-syn-method">curl</span>{" "}
            <span style={{ color: text }}>
              &quot;{ORIGIN}/api/elevation?lat={la}&amp;lon={lo}&quot;
            </span>
          </div>
        )}
        {tab === "js" && (
          <>
            <div>
              <span className="oz-syn-keyword">const</span> res = <span style={{ color: textSecondary }}>await</span>{" "}
              <span className="oz-syn-function">fetch</span>(
              <span className="oz-syn-string">
                &apos;/api/elevation?lat={la}&amp;lon={lo}&apos;
              </span>
              )
            </div>
            <div>
              <span className="oz-syn-keyword">const</span> &#123; elevation &#125; = <span style={{ color: textSecondary }}>await</span>{" "}
              res.json()
            </div>
          </>
        )}
        {tab === "python" && (
          <>
            <div>
              <span className="oz-syn-keyword">import</span> requests
            </div>
            <div>
              res = requests.<span className="oz-syn-function">get</span>(
              <span className="oz-syn-string">&quot;{ORIGIN}/api/elevation&quot;</span>,
            </div>
            <div>
              &nbsp;&nbsp;&nbsp;&nbsp;params=&#123;<span className="oz-syn-string">&quot;lat&quot;</span>:{" "}
              <span className="oz-syn-number">{la}</span>, <span className="oz-syn-string">&quot;lon&quot;</span>:{" "}
              <span className="oz-syn-number">{lo}</span>&#125;)
            </div>
            <div>
              <span className="oz-syn-keyword">print</span>(res.json()[
              <span className="oz-syn-string">&quot;elevation&quot;</span>])
            </div>
          </>
        )}
      </CodeBlock>
    </div>
  );
}
