"use client";

import { useState, useRef, useEffect } from "react";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { GetInTouch } from "@/components/GetInTouch";
import { ErrorBoundary } from "@/components/ErrorBoundary";

function useTheme() {
  const [dark, setDark] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  });
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e: MediaQueryListEvent) => { setDark(e.matches); };
    mq.addEventListener("change", handler);
    return () => { mq.removeEventListener("change", handler); };
  }, []);
  return dark;
}

const S = `
@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600&display=swap');
.ct-wrap{position:relative;width:100vw;min-height:100vh;overflow-x:hidden;font-family:system-ui,-apple-system,sans-serif}
.ct-body{max-width:900px;margin:0 auto;padding:1.5rem 2rem 4rem}
.ct-body h1{font-size:1.5rem;font-weight:700;margin:0 0 0.25rem;letter-spacing:-0.02em}
/* Secondary text uses the global theme tokens: #a3a3a3 = 7.85:1 on #0a0a0a
   (dark) and #525252 = 7.49:1 on #fafafa (light) — both above the AAA 7:1 bar. */
.ct-body .sub{color:var(--oz-text-secondary);font-size:0.85rem;margin:0 0 2rem;line-height:1.6}
.ct-body h2{font-size:1.05rem;font-weight:600;margin:2rem 0 0.75rem;padding-bottom:0.5rem}
.ct-body h3{font-size:0.9rem;font-weight:600;margin:1.25rem 0 0.5rem}
.ct-body p{font-size:0.85rem;color:var(--oz-text-secondary);line-height:1.6;margin:0.5rem 0}
.ct-body code{background:rgba(90,169,255,0.12);color:#7cb8ff;padding:0.1rem 0.3rem;border-radius:3px;font-family:'JetBrains Mono',monospace;font-size:0.82rem}
[data-theme="light"] .ct-body code{background:rgba(8,74,133,0.08);color:#084a85}
/* In-text links are distinguishable without color alone (WCAG 1.4.1). */
.ct-body p a{text-decoration:underline}
.ct-body a{color:#5aa9ff;text-decoration:none}
[data-theme="light"] .ct-body a{color:#084a85}
.ct-body a:hover{text-decoration:underline}
.ct-card{background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.06);border-radius:12px;padding:1.25rem;margin-bottom:0.75rem;transition:border-color .15s}
.ct-card:hover{border-color:rgba(255,255,255,0.12)}
.ct-card .icon{width:36px;height:36px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:0.9rem;margin-bottom:0.5rem}
/* Icon letters sit on a 12% tint of their own hue over the card surface, so
   each hue needs a dark-theme light shade and a light-theme deep shade to
   clear AAA 7:1 (ratios measured against the blended tint surface). */
.ct-card .icon.green{background:rgba(34,197,94,0.12);color:#4ade80} /* 9.3:1 on #112518 */
.ct-card .icon.blue{background:rgba(74,158,255,0.12);color:#7cb8ff} /* 8.0:1 on #16202c */
.ct-card .icon.purple{background:rgba(168,85,247,0.12);color:#d8b4fe} /* 9.7:1 on #21172b */
.ct-card .icon.amber{background:rgba(234,179,8,0.12);color:#eab308} /* 8.2:1 on #29230e */
[data-theme="light"] .ct-card .icon.green{color:#14532d} /* 8.2:1 on #e5f8ec */
[data-theme="light"] .ct-card .icon.blue{color:#0c4a6e} /* 8.4:1 on #e9f3ff */
[data-theme="light"] .ct-card .icon.purple{color:#581c87} /* 9.4:1 on #f5ebf9 */
[data-theme="light"] .ct-card .icon.amber{color:#713f12} /* 8.0:1 on #fcf6e1 */
.ct-card h3{margin:0 0 0.2rem;font-size:0.9rem;font-weight:600}
.ct-card p{margin:0;color:var(--oz-text-secondary);font-size:0.82rem;line-height:1.5}
.ct-steps{counter-reset:step;display:flex;flex-direction:column;gap:0}
.ct-step{counter-increment:step;position:relative;padding-left:2.5rem;margin-bottom:1.25rem}
.ct-step::before{content:counter(step);position:absolute;left:0;top:0.15rem;width:22px;height:22px;border-radius:50%;background:rgba(74,158,255,0.12);color:#7cb8ff;display:flex;align-items:center;justify-content:center;font-size:0.72rem;font-weight:700;font-family:'JetBrains Mono',monospace}
[data-theme="light"] .ct-step::before{color:#0c4a6e} /* 8.2:1 on #e6f0fb */
/* Steps use h3 so the outline stays h1 > h2 > h3 (axe heading-order). */
.ct-step h3{margin:0 0 0.15rem;font-size:0.85rem;font-weight:600;color:var(--oz-text)}
.ct-step p{margin:0;color:var(--oz-text-secondary);font-size:0.8rem;line-height:1.5}
.ct-step code{background:rgba(90,169,255,0.12);color:#7cb8ff; /* 8.23:1 on #141d27 */padding:0.1rem 0.3rem;border-radius:3px;font-family:'JetBrains Mono',monospace;font-size:0.78rem}
[data-theme="light"] .ct-step code{background:rgba(8,74,133,0.08);color:#084a85}
.ct-format{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:0.5rem;margin:0.75rem 0}
.ct-format-btn{padding:0.4rem 0.7rem;font-size:0.78rem;background:rgba(255,255,255,0.03);color:var(--oz-text-secondary);border:1px solid var(--oz-border);border-radius:6px;cursor:pointer;text-align:left;transition:all .15s;font-family:inherit}
.ct-format-btn:hover{border-color:#5aa9ff;color:#5aa9ff}
[data-theme="light"] .ct-format-btn:hover{border-color:#084a85;color:#084a85}
.ct-upload{border:2px dashed rgba(255,255,255,0.08);border-radius:12px;padding:2rem;text-align:center;transition:all .15s;cursor:pointer;background:transparent;margin-bottom:1rem}
[data-theme="light"] .ct-upload{border-color:rgba(0,0,0,0.08)}
.ct-upload:hover,.ct-upload.dragover{border-color:#5aa9ff;background:rgba(74,158,255,0.03)}
.ct-upload-icon{font-size:2rem;margin-bottom:0.5rem;color:#5aa9ff}
[data-theme="light"] .ct-upload-icon{color:#084a85}
.ct-upload-text{font-size:0.85rem;color:var(--oz-text-secondary);margin-bottom:0.25rem}
.ct-upload-hint{font-size:0.75rem;color:var(--oz-text-secondary)}
.ct-upload input{display:none}
.ct-preview{background:var(--oz-bg-code);border:1px solid var(--oz-border);border-radius:8px;padding:0.75rem 1rem;font-family:'JetBrains Mono',monospace;font-size:0.78rem;color:var(--oz-text);max-height:300px;overflow:auto;white-space:pre-wrap;margin-bottom:1rem}
/* The API reference is a fixed dark code surface in both themes, so its
   palette is light-on-dark and stays above AAA 7:1. */
.ct-api-ref{background:#0d1117;border:1px solid #1a1a1a;border-radius:8px;padding:0.75rem 1rem;font-family:'JetBrains Mono',monospace;font-size:0.75rem;color:#a3a3a3;line-height:1.7;overflow-x:auto;margin-bottom:1rem}
.ct-api-ref .comment{color:#9aa4ae} /* 7.48:1 on #0d1117 */
.ct-api-ref .key{color:#5aa9ff} /* 7.71:1 on #0d1117 */
.ct-api-ref .str{color:#22c55e} /* 8.31:1 on #0d1117 */
@media(max-width:768px){
  .ct-body{padding:1rem 1.25rem 3rem}
  .ct-format{grid-template-columns:1fr}
}
`;

export default function ContributePage() {
  const dark = useTheme();
  const [uploadData, setUploadData] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = reader.result as string;
        if (file.name.endsWith(".json")) {
          const parsed = JSON.parse(text);
          setUploadData(JSON.stringify(parsed, null, 2));
        } else if (file.name.endsWith(".csv") || file.name.endsWith(".geojson") || file.name.endsWith(".txt")) {
          setUploadData(text);
        } else {
          setUploadData(`[Binary file: ${file.name} (${(file.size / 1024).toFixed(1)} KB)]`);
        }
      } catch {
        setUploadData(`[Error reading file: ${file.name}]`);
      }
    };
    reader.readAsText(file);
  };

  return (
    <ErrorBoundary>
      <div
        className="ct-wrap"
        style={{ background: dark ? "#0a0a0a" : "#fafafa", color: dark ? "#e5e5e5" : "#171717" }}
      >
        <style dangerouslySetInnerHTML={{ __html: S }} />

        {/* Shared Nav */}
        <Navbar dark={dark} breadcrumb="Contribute" />

        <main className="ct-body">
          <h1>Contribute Data</h1>
          <p className="sub">
            OpenZenith thrives on community-contributed data. Here&apos;s how you can add your geospatial datasets, data
            layers, and tools to the platform. All data is reviewed before being integrated.
          </p>

          {/* Overview cards */}
          {/* h2 anchors the card h3s so the heading outline has no skipped level. */}
          <h2>How To Contribute</h2>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(250px,1fr))",
              gap: "0.75rem",
              marginBottom: "2rem",
            }}
          >
            <div className="ct-card">
              <div className="icon blue">1</div>
              <h3>Prepare Your Data</h3>
              <p>
                Format your geospatial data in a supported format. We accept GeoJSON, CSV, and other standard formats.
                Ensure coordinates use WGS84 (lat/lon).
              </p>
            </div>
            <div className="ct-card">
              <div className="icon green">2</div>
              <h3>Submit for Review</h3>
              <p>
                Upload your data or open a pull request with a proposal. Include documentation of the data source,
                update frequency, and coverage area.
              </p>
            </div>
            <div className="ct-card">
              <div className="icon purple">3</div>
              <h3>Integration</h3>
              <p>
                Once approved, your data layer is added to Globe, the API, or the data explorer with full attribution.
              </p>
            </div>
            <div className="ct-card">
              <div className="icon amber">4</div>
              <h3>Ongoing Updates</h3>
              <p>
                For live data sources, set up automated updates or periodic refreshes. We support polling, webhooks, and
                push-based ingestion.
              </p>
            </div>
          </div>

          {/* Supported formats */}
          <h2>Supported Formats</h2>
          <div className="ct-format">
            <button
              className="ct-format-btn"
              onClick={() =>
                { setUploadData(
                  '{"type":"FeatureCollection","features":[{"type":"Feature","geometry":{"type":"Point","coordinates":[0,0]},"properties":{}}]}',
                ); }
              }
            >
              GeoJSON
            </button>
            <button
              className="ct-format-btn"
              onClick={() =>
                { setUploadData(
                  "latitude,longitude,name,elevation_m\n40.7128,-74.0060,New York,10\n34.0522,-118.2437,Los Angeles,93",
                ); }
              }
            >
              CSV
            </button>
            <button className="ct-format-btn" onClick={() => { setUploadData('GEOGCS["WGS 84"]\nDATA["WGS 84"]\n'); }}>
              Well-Known Text
            </button>
            <button
              className="ct-format-btn"
              onClick={() => { setUploadData("PointZM 86.9258 27.9881 8848.86\nPointZM 87.086 27.9881 8516\n"); }}
            >
              GPX Tracks
            </button>
            <button
              className="ct-format-btn"
              onClick={() => { setUploadData("id;name;type;latitude;longitude;elevation\n1;Peak;summit;27.98;86.93;8849"); }}
            >
              Custom CSV
            </button>
          </div>

          {/* Upload area */}
          <h2>Upload Your Data</h2>
          <div
            className={`ct-upload ${dragOver ? "dragover" : ""}`}
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => { setDragOver(false); }}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              const file = e.dataTransfer.files.item(0);
              if (file) handleFile(file);
            }}
          >
            <div className="ct-upload-icon">&#8593;</div>
            <div className="ct-upload-text">Drop a file here or click to browse</div>
            <div className="ct-upload-hint">GeoJSON, CSV, GPX, or plain text &middot; Max 50 MB</div>
            <input
              ref={fileRef}
              type="file"
              accept=".json,.geojson,.csv,.gpx,.txt,.wkt"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
              }}
            />
          </div>

          {uploadData && (
            <div>
              <h3>Preview</h3>
              <div className="ct-preview">{uploadData}</div>
              <p style={{ fontSize: "0.75rem", color: "var(--oz-text-secondary)" }}>
                To submit this data, open a pull request on{" "}
                <a href="https://github.com/aliasfoxkde/OpenZenith/pulls" target="_blank" rel="noopener noreferrer">
                  GitHub
                </a>{" "}
                with the file and a description of the dataset.
              </p>
            </div>
          )}

          {/* Data sources we integrate */}
          <h2>Data Source Integration</h2>
          <p>We can ingest data from various real-time and static sources:</p>
          <div className="ct-steps">
            <div className="ct-step">
              <h3>Static GeoJSON / CSV Files</h3>
              <p>
                Upload point, line, or polygon datasets. Ideal for place markers, boundaries, trails, and point clouds.
                Hosted on GitHub alongside the code or on your own CDN.
              </p>
            </div>
            <div className="ct-step">
              <h3>ArcGIS REST Services</h3>
              <p>
                We already proxy ArcGIS FeatureServer queries. If you have a public ArcGIS service, we can add it to the
                data explorer for interactive querying.
              </p>
            </div>
            <div className="ct-step">
              <h3>Overpass API / OSM</h3>
              <p>
                Any Overpass QL query can be saved as a preset. Suggest new quick-query templates for the Explore page.
              </p>
            </div>
            <div className="ct-step">
              <h3>Real-Time Feeds (WMS/WFS/WCS)</h3>
              <p>
                Weather data, satellite imagery, and other OGC-standard services can be added as live layers to Globe
                with configurable refresh intervals.
              </p>
            </div>
            <div className="ct-step">
              <h3>Custom Tile Services</h3>
              <p>
                Have a custom tile server? We can add XYZ tile sources, WMTS layers, or TMS endpoints as basemap or
                overlay options.
              </p>
            </div>
            <div className="ct-step">
              <h3>API Endpoints</h3>
              <p>
                If you have a REST API serving geospatial data, we can create a proxy endpoint (like{" "}
                <code>/api/flights</code>) to fetch and display it on Globe.
              </p>
            </div>
          </div>

          {/* Pull request template */}
          <h2>Contribute via Pull Request</h2>
          <p style={{ fontSize: "0.82rem", color: "var(--oz-text-secondary)", lineHeight: 1.5 }}>
            The easiest way to contribute is via a GitHub pull request. Here&apos;s the process:
          </p>
          <div className="ct-steps">
            <div className="ct-step">
              <h3>Fork the Repository</h3>
              <p>
                Click &quot;Fork&quot; on{" "}
                <a href="https://github.com/aliasfoxkde/OpenZenith" target="_blank">
                  GitHub
                </a>{" "}
                to create your copy.
              </p>
            </div>
            <div className="ct-step">
              <h3>Prepare Your Data</h3>
              <p>
                Place your data file in an appropriate location. For static datasets, the <code>public/data/</code>{" "}
                directory works well. Include metadata (source, license, coverage).
              </p>
            </div>
            <div className="ct-step">
              <h3>Add a Route or Layer</h3>
              <p>
                Create a new API route in <code>src/app/api/</code> or add your data as a layer in the Globe component.
                Include proper attribution.
              </p>
            </div>
            <div className="ct-step">
              <h3>Update Documentation</h3>
              <p>
                Add your endpoint to the OpenAPI spec in <code>src/app/api/openapi.json/route.ts</code> and update the
                docs page.
              </p>
            </div>
            <div className="ct-step">
              <h3>Open a Pull Request</h3>
              <p>
                Describe what your data is, where it comes from, and how often it updates. We&apos;ll review, test, and
                merge.
              </p>
            </div>
          </div>

          {/* API Reference */}
          <h2>API Integration Points</h2>
          <p>For developers, here&apos;s how to integrate your data with OpenZenith:</p>
          <div className="ct-api-ref">
            <div>
              <span className="comment">// Add a new data source proxy (see src/app/api/proxy/ for examples)</span>
            </div>
            <div>
              <span className="comment">// Route: /api/&#123;your-dataset&#125;</span>
            </div>
            <div>
              <span className="key">export async function</span> GET(request) &#123;
            </div>
            <div>
              {" "}
              <span className="key">const</span> url = <span className="str">`https://your-api.com/data`</span>;
            </div>
            <div>
              {" "}
              <span className="key">const</span> res = <span className="key">await</span> fetch(url);
            </div>
            <div>
              {" "}
              <span className="key">const</span> data = <span className="key">await</span> res.json();
            </div>
            <div>
              {" "}
              <span className="key">return</span> NextResponse.json(data, &#123;
            </div>
            <div>
              {" "}
              headers: &#123; <span className="str">"Access-Control-Allow-Origin"</span>:{" "}
              <span className="str">"*"</span> &#125;,
            </div>
            <div> &#125;);</div>
            <div className="comment" style={{ marginTop: "0.75rem" }}>
              // Add to Globe as a toggleable layer // See src/app/globe/page.tsx loadEarthquakes() for patterns
            </div>
          </div>
        </main>

        {/* Shared Get in Touch */}
        <GetInTouch
          dark={dark}
          heading="Submit a Proposal"
          description="Have a dataset you'd like to add? Want to discuss integration? Submit a proposal below and we'll get back to you."
          submitLabel="Send Proposal"
          successTitle="Proposal Received"
          successMessage="We'll review your submission and get back to you within a few days."
        />

        {/* Shared Footer */}
        <Footer dark={dark} />
      </div>
    </ErrorBoundary>
  );
}
