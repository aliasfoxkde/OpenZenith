"use client";

import { useState, useCallback, useRef, useEffect } from "react";

interface Props {
  dark: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  map: any;
}

const DATASETS = [
  {
    id: "dem",
    label: "Elevation (Terrarium PNG)",
    endpoint: "/api/dem-tile",
    desc: "256x256 Terrarium-encoded elevation tiles",
    format: "png",
  },
  {
    id: "hillshade",
    label: "Hillshade",
    endpoint: "/api/elevation-color",
    desc: "Color-coded elevation gradient tiles",
    format: "png",
  },
  {
    id: "contours",
    label: "Contours",
    endpoint: "/api/contours",
    desc: "Topographic contour line tiles",
    format: "png",
  },
  {
    id: "accuracy",
    label: "Elevation Accuracy",
    endpoint: "/api/elevation-accuracy",
    desc: "Data resolution heatmap tiles",
    format: "png",
  },
  {
    id: "population",
    label: "Population Density",
    endpoint: "/api/population",
    desc: "VIIRS Black Marble population tiles",
    format: "png",
  },
  {
    id: "landcover",
    label: "Land Cover",
    endpoint: "/api/landcover",
    desc: "MODIS IGBP land cover classification",
    format: "png",
  },
];

const CODE_EXAMPLES: Record<string, { label: string; code: string }> = {
  maplibre: {
    label: "MapLibre GL JS",
    code: `// Add Terrarium DEM tiles to a MapLibre map
map.addSource("elevation", {
  type: "raster-dem",
  tiles: ["https://openzenith.pages.dev/api/dem-tile/{z}/{x}/{y}"],
  tileSize: 256,
  encoding: "terrarium"
});
map.addLayer({
  id: "hillshade",
  type: "hillshade",
  source: "elevation",
  paint: {
    "hillshade-shadow-color": "#000000",
    "hillshade-highlight-color": "#ffffff",
    "hillshade-exaggeration": 0.5
  }
});

// 3D terrain
map.setTerrain({ source: "elevation", exaggeration: 1.5 });`,
  },
  python: {
    label: "Python SDK",
    code: `# Install: pip install openzenith
from openzenith import load_tiles, get_elevation, slope, hillshade

# Download tiles for a region
load_tiles(zoom_levels=[5, 6, 7, 8])

# Query elevation
elev = get_elevation(40.7128, -74.0060)
print(f"NYC elevation: {elev:.1f}m")

# Batch query
from openzenith import get_elevation_batch
results = get_elevation_batch([
    (40.7128, -74.0060),
    (35.6762, 139.6503),
])

# Download tiles for a specific region
from openzenith import download_tiles
result = download_tiles(region="europe", zoom_levels=[5, 6, 7, 8])
print(f"Downloaded {result['total_tiles']:,} tiles")`,
  },
  curl: {
    label: "cURL / API",
    code: `# Query elevation at a point
curl "https://openzenith.pages.dev/api/elevation?lat=40.7128&lon=-74.0060"

# Batch query
curl -X POST "https://openzenith.pages.dev/api/elevation/batch" \\
  -H "Content-Type: application/json" \\
  -d '{"points":[[40.7128,-74.0060],[35.6762,139.6503]]}'

# Single tile
curl -o tile.png "https://openzenith.pages.dev/api/dem-tile/8/76/96.png"

# GeoJSON export
curl "https://openzenith.pages.dev/api/query?lat=40.7&lon=-74.0&include=elevation,address"`,
  },
  cesium: {
    label: "CesiumJS",
    code: `// Add terrain from OpenZenith to CesiumJS
const viewer = new Cesium.Viewer("cesiumContainer");

// Use OpenZenith DEM tiles as terrain source
const terrainProvider = await Cesium.CesiumTerrainProvider.fromUrl(
  Cesium.IonResource.fromAssetId(1) // or custom provider
);

// Terrarium-encoded tiles via /api/dem-tile/{z}/{x}/{y}
viewer.terrainProvider = terrainProvider;
viewer.scene.globe.enableLighting = true;`,
  },
  deckgl: {
    label: "deck.gl",
    code: `import { TileLayer } from "@deck.gl/geo-layers";

// Terrain tiles in deck.gl
const terrainLayer = new TileLayer({
  id: "terrain",
  data: "https://openzenith.pages.dev/api/elevation-color/{z}/{x}/{y}",
  minZoom: 0,
  maxZoom: 12,
  tileSize: 256,

  renderSubLayers: (props) => {
    const { bbox, tile } = props;
    return new deck.BitmapLayer(props, {
      image: tile,
      bounds: bbox,
    });
  },
});`,
  },
};

const BASE_URL = "https://openzenith.pages.dev";

function latLonToTile(lat: number, lon: number, zoom: number): [number, number] {
  const n = 2 ** zoom;
  const x = Math.floor(((lon + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n);
  return [x, y];
}

function generateBashScript(
  ds: (typeof DATASETS)[0],
  dataset: string,
  bbox: { latMin: number; lonMin: number; latMax: number; lonMax: number },
  zMin: number,
  zMax: number,
  tiles: { z: number; x: number; y: number }[],
): string {
  const tileList = tiles.map((t) => t.z + "/" + t.x + "/" + t.y).join(" ");
  return [
    "#!/bin/bash",
    "# OpenZenith Tile Downloader",
    "# Dataset: " + ds.label,
    "# Region: [" +
      bbox.latMin.toFixed(4) +
      ", " +
      bbox.lonMin.toFixed(4) +
      "] to [" +
      bbox.latMax.toFixed(4) +
      ", " +
      bbox.lonMax.toFixed(4) +
      "]",
    "# Zoom: " + zMin + "-" + zMax + " | Tiles: " + tiles.length,
    "",
    'OUTDIR="tiles/' + dataset + '"',
    'mkdir -p "$OUTDIR"',
    "",
    "COUNT=0",
    "TOTAL=" + tiles.length,
    "",
    "for TILE in " + tileList + "; do",
    '  Z=$(echo "$TILE" | cut -d/ -f1)',
    '  X=$(echo "$TILE" | cut -d/ -f2)',
    '  Y=$(echo "$TILE" | cut -d/ -f3)',
    '  DIR="$OUTDIR/$Z/$X"',
    '  mkdir -p "$DIR"',
    '  FILE="$DIR/$Y.' + ds.format + '"',
    '  if [ ! -f "$FILE" ]; then',
    '    curl -sS -o "$FILE" "' + BASE_URL + ds.endpoint + "/$Z/$X/$Y." + ds.format + '"',
    "    COUNT=$((COUNT + 1))",
    "    if [ $((COUNT % 50)) -eq 0 ]; then",
    '      echo "Progress: $COUNT / $TOTAL"',
    "    fi",
    "  fi",
    "done",
    "",
    'echo "Done! Downloaded to $OUTDIR"',
    "",
  ].join("\n");
}

function generatePythonScript(
  ds: (typeof DATASETS)[0],
  dataset: string,
  bbox: { latMin: number; lonMin: number; latMax: number; lonMax: number },
  zMin: number,
  zMax: number,
  tiles: { z: number; x: number; y: number }[],
): string {
  const pyTiles = tiles.map((t) => "    (" + t.z + ", " + t.x + ", " + t.y + "),").join("\n");
  return [
    "#!/usr/bin/env python3",
    '"""OpenZenith Tile Downloader',
    "",
    "Dataset: " + ds.label,
    "Region: [" +
      bbox.latMin.toFixed(4) +
      ", " +
      bbox.lonMin.toFixed(4) +
      "] to [" +
      bbox.latMax.toFixed(4) +
      ", " +
      bbox.lonMax.toFixed(4) +
      "]",
    "Zoom: " + zMin + "-" + zMax + " | Tiles: " + tiles.length,
    '"""',
    "",
    "import os",
    "import urllib.request",
    "from concurrent.futures import ThreadPoolExecutor, as_completed",
    "",
    'BASE = "' + BASE_URL + '"',
    'ENDPOINT = "' + ds.endpoint + '"',
    'OUTDIR = "tiles/' + dataset + '"',
    'EXT = "' + ds.format + '"',
    "",
    "TILES = [",
    pyTiles,
    "]",
    "",
    "",
    "def download(z, x, y):",
    '    path = os.path.join(OUTDIR, str(z), str(x), f"{y}.{EXT}")',
    "    if os.path.exists(path):",
    "        return path, False",
    "    os.makedirs(os.path.dirname(path), exist_ok=True)",
    '    url = f"{BASE}{ENDPOINT}/{z}/{x}/{y}.{EXT}"',
    "    try:",
    "        urllib.request.urlretrieve(url, path)",
    "        return path, True",
    "    except Exception as e:",
    '        print(f"  Error {url}: {e}")',
    "        return path, False",
    "",
    "",
    "def main():",
    '    print(f"Downloading {len(TILES)} tiles to {OUTDIR}/")',
    "    downloaded = 0",
    "    with ThreadPoolExecutor(max_workers=8) as pool:",
    "        futures = {pool.submit(download, z, x, y): (z, x, y) for z, x, y in TILES}",
    "        for i, fut in enumerate(as_completed(futures), 1):",
    "            path, ok = fut.result()",
    "            if ok:",
    "                downloaded += 1",
    "            if i % 50 == 0 or i == len(TILES):",
    '                print(f"  Progress: {i}/{len(TILES)} ({downloaded} downloaded)")',
    '    print(f"Done! {downloaded} new tiles saved to {OUTDIR}/")',
    "",
    "",
    'if __name__ == "__main__":',
    "    main()",
    "",
  ].join("\n");
}

export function TileDownloadTool({ dark, map }: Props) {
  const [dataset, setDataset] = useState(DATASETS[0].id);
  const [zMin, setZMin] = useState(5);
  const [zMax, setZMax] = useState(10);
  const [bbox, setBbox] = useState<{ latMin: number; lonMin: number; latMax: number; lonMax: number } | null>(null);
  const [activeExample, setActiveExample] = useState("maplibre");
  const [drawing, setDrawing] = useState(false);
  const [drawStart, setDrawStart] = useState<{ x: number; y: number } | null>(null);
  const boxSourceRef = useRef<string | null>(null);
  const boxLayerRef = useRef<string | null>(null);

  const cardBg = dark ? "#161616" : "#fff";
  const border = dark ? "#2a2a2a" : "#e5e5e5";
  const text = dark ? "#e5e5e5" : "#171717";
  const textSec = dark ? "#888" : "#666";
  const accent = "#22c55e";
  const codeBg = dark ? "#0d1117" : "#f6f8fa";

  const ds = DATASETS.find((d) => d.id === dataset) || DATASETS[0];

  // Calculate tile count
  const tileCount = (() => {
    if (!bbox) return 0;
    let total = 0;
    for (let z = zMin; z <= zMax; z++) {
      const [x1, y1] = latLonToTile(bbox.latMax, bbox.lonMin, z);
      const [x2, y2] = latLonToTile(bbox.latMin, bbox.lonMax, z);
      total += (x2 - x1 + 1) * (y2 - y1 + 1);
    }
    return total;
  })();

  // Cleanup box layers on unmount
  useEffect(() => {
    return () => {
      try {
        if (map && boxSourceRef.current) {
          map.removeLayer(boxLayerRef.current!);
          map.removeSource(boxSourceRef.current);
        }
      } catch {
        /* map may be gone */
      }
    };
  }, [map]);

  // Draw bbox on map
  const updateBoxLayer = useCallback(
    (b: { latMin: number; lonMin: number; latMax: number; lonMax: number }) => {
      if (!map) return;
      const sourceId = "tile-download-box";
      const layerId = "tile-download-box-line";
      try {
        map.removeLayer(layerId);
      } catch {
        /* ok */
      }
      try {
        map.removeSource(sourceId);
      } catch {
        /* ok */
      }
      map.addSource(sourceId, {
        type: "geojson",
        data: {
          type: "Feature",
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [b.lonMin, b.latMax],
                [b.lonMax, b.latMax],
                [b.lonMax, b.latMin],
                [b.lonMin, b.latMin],
                [b.lonMin, b.latMax],
              ],
            ],
          },
          properties: {},
        },
      });
      map.addLayer({
        id: layerId,
        type: "line",
        source: sourceId,
        paint: { "line-color": "#22c55e", "line-width": 2, "line-dasharray": [4, 2] },
      });
      boxSourceRef.current = sourceId;
      boxLayerRef.current = layerId;
    },
    [map],
  );

  const useCurrentView = useCallback(() => {
    if (!map) return;
    const bounds = map.getBounds();
    const b = {
      latMin: bounds.getSouth(),
      lonMin: bounds.getWest(),
      latMax: bounds.getNorth(),
      lonMax: bounds.getEast(),
    };
    setBbox(b);
    updateBoxLayer(b);
  }, [map, updateBoxLayer]);

  const handleMapClick = useCallback(
    (e: { lngLat: { lat: number; lng: number } }) => {
      if (!drawing) return;
      if (!drawStart) {
        setDrawStart({ x: e.lngLat.lng, y: e.lngLat.lat });
        return;
      }
      const b = {
        latMin: Math.min(drawStart.y, e.lngLat.lat),
        lonMin: Math.min(drawStart.x, e.lngLat.lng),
        latMax: Math.max(drawStart.y, e.lngLat.lat),
        lonMax: Math.max(drawStart.x, e.lngLat.lng),
      };
      setBbox(b);
      setDrawing(false);
      setDrawStart(null);
      updateBoxLayer(b);
    },
    [drawing, drawStart, updateBoxLayer],
  );

  const handleMouseMove = useCallback(
    (e: { lngLat: { lat: number; lng: number } }) => {
      if (!drawing || !drawStart || !map) return;
      updateBoxLayer({
        latMin: Math.min(drawStart.y, e.lngLat.lat),
        lonMin: Math.min(drawStart.x, e.lngLat.lng),
        latMax: Math.max(drawStart.y, e.lngLat.lat),
        lonMax: Math.max(drawStart.x, e.lngLat.lng),
      });
    },
    [drawing, drawStart, map, updateBoxLayer],
  );

  useEffect(() => {
    if (!map) return;
    const onClick = (e: any) => handleMapClick(e);
    const onMove = (e: any) => handleMouseMove(e);
    map.on("click", onClick);
    map.on("mousemove", onMove);
    return () => {
      map.off("click", onClick);
      map.off("mousemove", onMove);
    };
  }, [map, handleMapClick, handleMouseMove]);

  const clearBbox = useCallback(() => {
    setBbox(null);
    setDrawStart(null);
    if (map) {
      try {
        map.removeLayer(boxLayerRef.current!);
      } catch {
        /* ok */
      }
      try {
        map.removeSource(boxSourceRef.current!);
      } catch {
        /* ok */
      }
    }
  }, [map]);

  const getTiles = useCallback(() => {
    if (!bbox) return [];
    const tiles: { z: number; x: number; y: number }[] = [];
    for (let z = zMin; z <= zMax; z++) {
      const [x1, y1] = latLonToTile(bbox.latMax, bbox.lonMin, z);
      const [x2, y2] = latLonToTile(bbox.latMin, bbox.lonMax, z);
      for (let x = x1; x <= x2; x++) {
        for (let y = y1; y <= y2; y++) {
          tiles.push({ z, x, y });
        }
      }
    }
    return tiles;
  }, [bbox, zMin, zMax]);

  const downloadScript = useCallback(
    (type: "bash" | "python") => {
      if (!bbox) return;
      const tiles = getTiles();
      const script =
        type === "bash"
          ? generateBashScript(ds, dataset, bbox, zMin, zMax, tiles)
          : generatePythonScript(ds, dataset, bbox, zMin, zMax, tiles);
      const blob = new Blob([script], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = type === "bash" ? "download_tiles.sh" : "download_tiles.py";
      a.click();
      URL.revokeObjectURL(url);
    },
    [bbox, ds, dataset, zMin, zMax, getTiles],
  );

  const copyCode = useCallback((code: string) => {
    navigator.clipboard.writeText(code);
  }, []);

  const sizeEstimate = tileCount > 0 ? "~" + ((tileCount * 15) / 1024).toFixed(1) + " MB" : "\u2014";

  return (
    <div style={{ padding: 16, fontSize: 13, color: text }}>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>Tile Downloader</div>
        <div style={{ fontSize: 11, color: textSec, lineHeight: 1.5 }}>
          Select a region, choose a dataset and zoom range, then download a script to fetch tiles locally.
        </div>
      </div>

      {/* Dataset */}
      <div style={{ marginBottom: 12 }}>
        <label style={{ fontSize: 11, fontWeight: 600, display: "block", marginBottom: 4 }}>Dataset</label>
        <select
          value={dataset}
          onChange={(e) => setDataset(e.target.value)}
          style={{
            width: "100%",
            padding: "6px 8px",
            borderRadius: 4,
            border: "1px solid " + border,
            background: cardBg,
            color: text,
            fontSize: 12,
          }}
        >
          {DATASETS.map((d) => (
            <option key={d.id} value={d.id}>
              {d.label}
            </option>
          ))}
        </select>
        <div style={{ fontSize: 10, color: textSec, marginTop: 2 }}>{ds.desc}</div>
      </div>

      {/* Zoom */}
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <div style={{ flex: 1 }}>
          <label style={{ fontSize: 11, fontWeight: 600, display: "block", marginBottom: 4 }}>Min Zoom</label>
          <input
            type="number"
            min={0}
            max={12}
            value={zMin}
            onChange={(e) => setZMin(Math.max(0, Math.min(12, parseInt(e.target.value) || 0)))}
            style={{
              width: "100%",
              padding: "6px 8px",
              borderRadius: 4,
              border: "1px solid " + border,
              background: cardBg,
              color: text,
              fontSize: 12,
            }}
          />
        </div>
        <div style={{ flex: 1 }}>
          <label style={{ fontSize: 11, fontWeight: 600, display: "block", marginBottom: 4 }}>Max Zoom</label>
          <input
            type="number"
            min={0}
            max={12}
            value={zMax}
            onChange={(e) => setZMax(Math.max(0, Math.min(12, parseInt(e.target.value) || 0)))}
            style={{
              width: "100%",
              padding: "6px 8px",
              borderRadius: 4,
              border: "1px solid " + border,
              background: cardBg,
              color: text,
              fontSize: 12,
            }}
          />
        </div>
      </div>

      {/* Region buttons */}
      <div style={{ marginBottom: 12 }}>
        <label style={{ fontSize: 11, fontWeight: 600, display: "block", marginBottom: 4 }}>Region</label>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <button
            onClick={useCurrentView}
            style={{
              padding: "5px 10px",
              borderRadius: 4,
              border: "1px solid " + border,
              background: cardBg,
              color: text,
              fontSize: 11,
              cursor: "pointer",
            }}
          >
            Use Current View
          </button>
          <button
            onClick={() => {
              setDrawing(!drawing);
              setDrawStart(null);
            }}
            style={{
              padding: "5px 10px",
              borderRadius: 4,
              border: "1px solid " + (drawing ? accent : border),
              background: drawing ? accent + "22" : cardBg,
              color: drawing ? accent : text,
              fontSize: 11,
              cursor: "pointer",
            }}
          >
            {drawing ? "Cancel Draw" : "Draw on Map"}
          </button>
          {bbox && (
            <button
              onClick={clearBbox}
              style={{
                padding: "5px 10px",
                borderRadius: 4,
                border: "1px solid #ef4444",
                background: "#ef444422",
                color: "#ef4444",
                fontSize: 11,
                cursor: "pointer",
              }}
            >
              Clear
            </button>
          )}
        </div>
        {drawing && (
          <div style={{ fontSize: 10, color: accent, marginTop: 4 }}>
            Click two points on the map to define a bounding box.
          </div>
        )}
      </div>

      {/* BBox info */}
      {bbox && (
        <div
          style={{
            padding: 10,
            borderRadius: 6,
            background: cardBg,
            border: "1px solid " + border,
            marginBottom: 12,
            fontSize: 11,
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Selected Region</div>
          <div style={{ fontFamily: "monospace", fontSize: 10, lineHeight: 1.6 }}>
            <div>
              Lat: {bbox.latMin.toFixed(4)} to {bbox.latMax.toFixed(4)}
            </div>
            <div>
              Lon: {bbox.lonMin.toFixed(4)} to {bbox.lonMax.toFixed(4)}
            </div>
          </div>
          <div style={{ display: "flex", gap: 16, marginTop: 6, color: textSec }}>
            <span>
              <strong style={{ color: accent }}>{tileCount.toLocaleString()}</strong> tiles
            </span>
            <span>
              <strong style={{ color: accent }}>{sizeEstimate}</strong> est.
            </span>
            <span>
              z{zMin}&ndash;z{zMax}
            </span>
          </div>
        </div>
      )}

      {/* Download */}
      {bbox && tileCount > 0 && (
        <div style={{ marginBottom: 16 }}>
          <label style={{ fontSize: 11, fontWeight: 600, display: "block", marginBottom: 6 }}>Download Script</label>
          <div style={{ display: "flex", gap: 6 }}>
            <button
              onClick={() => downloadScript("bash")}
              style={{
                flex: 1,
                padding: "8px 12px",
                borderRadius: 6,
                border: "none",
                background: accent,
                color: "#000",
                fontWeight: 600,
                fontSize: 12,
                cursor: "pointer",
              }}
            >
              Shell Script
            </button>
            <button
              onClick={() => downloadScript("python")}
              style={{
                flex: 1,
                padding: "8px 12px",
                borderRadius: 6,
                border: "none",
                background: "#3b82f6",
                color: "#fff",
                fontWeight: 600,
                fontSize: 12,
                cursor: "pointer",
              }}
            >
              Python Script
            </button>
          </div>
          <div style={{ fontSize: 10, color: textSec, marginTop: 4 }}>
            Runs locally &mdash; downloads tiles via curl/urllib to a <code>tiles/</code> directory.
          </div>
        </div>
      )}

      {/* Separator */}
      <div style={{ borderTop: "1px solid " + border, margin: "16px 0" }} />

      {/* Code examples */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Code Examples</div>
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 8 }}>
          {Object.entries(CODE_EXAMPLES).map(([key, ex]) => (
            <button
              key={key}
              onClick={() => setActiveExample(key)}
              style={{
                padding: "4px 8px",
                borderRadius: 4,
                border: "1px solid " + (activeExample === key ? accent : border),
                background: activeExample === key ? accent + "22" : cardBg,
                color: activeExample === key ? accent : textSec,
                fontSize: 10,
                cursor: "pointer",
              }}
            >
              {ex.label}
            </button>
          ))}
        </div>
        <div style={{ position: "relative" }}>
          <button
            onClick={() => copyCode(CODE_EXAMPLES[activeExample].code)}
            style={{
              position: "absolute",
              top: 6,
              right: 6,
              padding: "3px 8px",
              borderRadius: 3,
              border: "1px solid " + border,
              background: cardBg,
              color: textSec,
              fontSize: 10,
              cursor: "pointer",
              zIndex: 1,
            }}
          >
            Copy
          </button>
          <pre
            style={{
              padding: 12,
              borderRadius: 6,
              background: codeBg,
              border: "1px solid " + border,
              fontSize: 10,
              lineHeight: 1.5,
              overflow: "auto",
              maxHeight: 300,
              color: dark ? "#c9d1d9" : "#24292f",
              fontFamily: "monospace",
              whiteSpace: "pre",
            }}
          >
            {CODE_EXAMPLES[activeExample].code}
          </pre>
        </div>
      </div>

      {/* API Reference */}
      <div style={{ borderTop: "1px solid " + border, margin: "16px 0", paddingTop: 12 }}>
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>API Endpoints</div>
        <div style={{ fontSize: 11, lineHeight: 1.7 }}>
          {[
            { url: "/api/elevation?lat=&lon=", desc: "Point elevation query" },
            { url: "/api/elevation/batch", desc: "Batch elevation (POST)" },
            { url: "/api/dem-tile/{z}/{x}/{y}.png", desc: "Terrarium PNG elevation tile" },
            { url: "/api/elevation-color/{z}/{x}/{y}.png", desc: "Color-coded elevation tile" },
            { url: "/api/contours/{z}/{x}/{y}.png", desc: "Contour line tile" },
            { url: "/api/health", desc: "API health check" },
            { url: "/api/openapi.json", desc: "OpenAPI 3.0.3 spec" },
          ].map((ep) => (
            <div key={ep.url} style={{ marginBottom: 2 }}>
              <code style={{ color: accent, fontSize: 10 }}>
                {BASE_URL}
                {ep.url}
              </code>
              <span style={{ color: textSec, marginLeft: 6 }}>&mdash; {ep.desc}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Python SDK Reference */}
      <div style={{ borderTop: "1px solid " + border, margin: "16px 0", paddingTop: 12 }}>
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Python SDK</div>
        <div style={{ fontSize: 11, color: textSec, lineHeight: 1.6 }}>
          <code style={{ color: accent }}>pip install openzenith</code>
        </div>
        <div style={{ fontSize: 11, lineHeight: 1.7, marginTop: 6 }}>
          {[
            { fn: "download_tiles(region='europe')", desc: "Download tiles by region" },
            { fn: "download_tiles(bbox=(...), zoom_levels=[...])", desc: "Download by bbox + zoom" },
            { fn: "load_tiles(zoom_levels=[0-8])", desc: "Download all tiles from HuggingFace" },
            { fn: "get_elevation(lat, lon)", desc: "Query elevation at a point" },
            { fn: "get_elevation_batch(points)", desc: "Batch elevation query" },
            { fn: "slope(grid, cell_size)", desc: "Compute terrain slope" },
            { fn: "hillshade(grid, azimuth, altitude)", desc: "Compute hillshade" },
            { fn: "viewshed(grid, row, col, height)", desc: "Compute visibility" },
            { fn: "contour_to_geojson(grid, interval)", desc: "Export contour lines" },
            { fn: "openzenith tiles --region europe", desc: "CLI: download by region" },
          ].map((fn) => (
            <div key={fn.fn} style={{ marginBottom: 2 }}>
              <code style={{ color: "#3b82f6", fontSize: 10 }}>{fn.fn}</code>
              <span style={{ color: textSec, marginLeft: 6 }}>&mdash; {fn.desc}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
