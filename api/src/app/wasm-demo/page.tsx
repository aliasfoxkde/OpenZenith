/**
 * WASM Decoder Demo — OpenZenith OZT2 terrain analysis in the browser.
 *
 * Demonstrates:
 *   - Loading the openzenith-core WASM module
 *   - D8 flow direction + flow accumulation on a synthetic DEM
 *   - OZT2 tile decode (gradient reconstruction from residuals)
 *   - Viewshed analysis
 *
 * Run locally (from api/):
 *   npm run dev
 *   then open http://localhost:3000/wasm-demo
 */

"use client";

import { useEffect, useRef, useState } from "react";

// ─── Types (mirroring wasm.rs) ────────────────────────────────────────────────

interface WasmExports {
  d8_flow_direction_wasm: (
    demPtr: number,
    len: number,
    rows: number,
    cols: number,
    nodata: number
  ) => number;
  flow_accumulation_wasm: (
    fdPtr: number,
    len: number,
    rows: number,
    cols: number,
    nodataDir: number
  ) => number;
  gradient_reconstruct_wasm: (
    residualsPtr: number,
    len: number,
    height: number,
    width: number,
    nodata: number,
    dequantMin: number,
    dequantScale: number
  ) => number;
  viewshed_wasm: (
    demPtr: number,
    len: number,
    rows: number,
    cols: number,
    observerRow: number,
    observerCol: number,
    observerHeight: number,
    cellSize: number,
    nodata: number
  ) => number;
  decode_ozt2: (tileBytes: Uint8Array, decompressFn: (bytes: Uint8Array, codec: string) => Uint8Array) => {
    elevations: Uint16Array;
    metadata: Record<string, unknown>;
  };
  initSync: (module: { module: Uint8Array }) => void;
  default: () => Promise<unknown>;
  __wbindgen_malloc: (size: number) => number;
  __wbindgen_free: (ptr: number, size: number) => void;
  memory: WebAssembly.Memory;
}

interface BenchmarkResult {
  label: string;
  ms: number;
  details?: string;
}

// ─── Demo terrain data ────────────────────────────────────────────────────────

/** Mt. Everest region — 30×30 synthetic DEM (elevation in metres) */
function makeEverestDEM(): Float32Array {
  const SIZE = 30;
  const dem = new Float32Array(SIZE * SIZE);
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      // Centre the peak slightly NW of centre
      const dr = r - 10;
      const dc = c - 12;
      const dist = Math.sqrt(dr * dr + dc * dc);
      dem[r * SIZE + c] = Math.max(0, 8849 - dist * 300 + (Math.random() - 0.5) * 50);
    }
  }
  return dem;
}

/** 3×3 pit flat — corner cell is a sink */
function makePitDEM(): Float32Array {
  const dem = new Float32Array(9);
  dem[0] = 10; // pit
  dem[1] = 15;
  dem[2] = 15;
  dem[3] = 15;
  dem[4] = 20;
  dem[5] = 20;
  dem[6] = 20;
  dem[7] = 20;
  dem[8] = 20;
  return dem;
}

// ─── WASM helpers ────────────────────────────────────────────────────────────

/** Instantiate the WASM module — fetch binary and init with explicit URL path. */
async function loadWasm(): Promise<WasmExports> {
  const initModule = await import("@/lib/wasm/openzenith_core.js");
  const init = initModule.default as (module_or_path?: Request | URL | string | ArrayBuffer) => Promise<WasmExports>;
  // ~ prefix resolves via webpack — use fetchable URL so init loads from same dir
  const wasmUrl = new URL("/pkg/openzenith_core_bg.wasm", window.location.origin);
  return await init(wasmUrl) as WasmExports;
}

/** Copy a Float32Array into WASM linear memory, return pointer + length. */
function demToWasm(wasm: WasmExports, dem: Float32Array): [number, number] {
  const ptr = wasm.__wbindgen_malloc(dem.byteLength);
  new Float32Array(wasm.memory.buffer).set(dem, ptr / 4);
  return [ptr, dem.length];
}

/** Copy an Int8Array into WASM linear memory, return pointer + length. */
function fdToWasm(wasm: WasmExports, fd: Int8Array): [number, number] {
  const ptr = wasm.__wbindgen_malloc(fd.byteLength);
  new Int8Array(wasm.memory.buffer).set(fd, ptr / 1);
  return [ptr, fd.length];
}

/** Read a Vec<u8> result written by wasm-bindgen (meta at ptr-16). */
function readVecU8(wasm: WasmExports, ptr: number): Uint8Array {
  const view = new Uint32Array(wasm.memory.buffer);
  const metaPtr = ptr - 16;
  const dataPtr = Number(view[metaPtr / 4]);
  const dataLen = Number(view[metaPtr / 4 + 1]);
  return new Uint8Array(wasm.memory.buffer).slice(dataPtr, dataPtr + dataLen);
}

/** Read a Vec<u32> result from WASM memory. */
function readVecU32(wasm: WasmExports, ptr: number): Uint32Array {
  // wasm-bindgen stores [ptr, len] at ptr-16 for Vec<T>
  const view = new Uint32Array(wasm.memory.buffer);
  const metaPtr = ptr - 16;
  const dataPtr = Number(view[metaPtr / 4]);
  const dataLen = Number(view[metaPtr / 4 + 1]);
  return new Uint32Array(wasm.memory.buffer).slice(dataPtr / 4, dataPtr / 4 + dataLen);
}

// ─── Colour helpers ───────────────────────────────────────────────────────────

const FLOW_PALETTE: [number, number, number][] = [
  [255, 255, 255], // 0  E
  [200, 200, 255], // 1  E
  [100, 200, 255], // 2  SE
  [50, 150, 255],  // 3  S
  [50, 255, 200],  // 4  SW
  [100, 255, 100], // 5  W
  [255, 255, 50],   // 6  NW
  [255, 150, 50],   // 7  N
];

function flowDirColour(d: number): [number, number, number] {
  if (d === 255) return [0, 0, 0];
  return FLOW_PALETTE[d] ?? [180, 180, 180];
}

function flowAccColour(v: number, max: number): [number, number, number] {
  const t = Math.log1p(v) / Math.log1p(max);
  return [Math.round(255 * (1 - t)), Math.round(255 * t), Math.round(100 * t)];
}

function elevationColour(v: number, minE: number, maxE: number): [number, number, number] {
  const t = Math.max(0, Math.min(1, (v - minE) / (maxE - minE)));
  // Green → Brown → White
  if (t < 0.4) {
    const s = t / 0.4;
    return [Math.round(60 + s * 80), Math.round(140 - s * 60), Math.round(60 - s * 60)];
  } else if (t < 0.8) {
    const s = (t - 0.4) / 0.4;
    return [Math.round(140 + s * 80), Math.round(80 + s * 80), Math.round(40 + s * 120)];
  } else {
    const s = (t - 0.8) / 0.2;
    return [Math.round(220 + s * 35), Math.round(160 + s * 85), Math.round(160 + s * 90)];
  }
}

// ─── Canvas renderers ────────────────────────────────────────────────────────

function renderFlowDir(canvas: HTMLCanvasElement, fd: Uint8Array, rows: number, cols: number) {
  const ctx = canvas.getContext("2d")!;
  canvas.width = cols;
  canvas.height = rows;
  const img = ctx.createImageData(cols, rows);
  for (let i = 0; i < fd.length; i++) {
    const [r, g, b] = flowDirColour(fd[i]);
    img.data[i * 4] = r;
    img.data[i * 4 + 1] = g;
    img.data[i * 4 + 2] = b;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

function renderFlowAcc(canvas: HTMLCanvasElement, acc: Uint32Array, rows: number, cols: number) {
  const ctx = canvas.getContext("2d")!;
  canvas.width = cols;
  canvas.height = rows;
  const img = ctx.createImageData(cols, rows);
  const max = Math.max(...acc) || 1;
  for (let i = 0; i < acc.length; i++) {
    const [r, g, b] = flowAccColour(acc[i], max);
    img.data[i * 4] = r;
    img.data[i * 4 + 1] = g;
    img.data[i * 4 + 2] = b;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

function renderDEM(
  canvas: HTMLCanvasElement,
  dem: Float32Array,
  rows: number,
  cols: number,
  minE: number,
  maxE: number,
  highlightCell?: [number, number]
) {
  const ctx = canvas.getContext("2d")!;
  canvas.width = cols;
  canvas.height = rows;
  const img = ctx.createImageData(cols, rows);
  for (let i = 0; i < dem.length; i++) {
    const [r, g, b] = elevationColour(dem[i], minE, maxE);
    img.data[i * 4] = r;
    img.data[i * 4 + 1] = g;
    img.data[i * 4 + 2] = b;
    img.data[i * 4 + 3] = 255;
  }
  // Highlight observer cell
  if (highlightCell) {
    const [cr, cc] = highlightCell;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const r = cr + dr;
        const c = cc + dc;
        if (r >= 0 && r < rows && c >= 0 && c < cols) {
          const idx = (r * cols + c) * 4;
          img.data[idx] = 255;
          img.data[idx + 1] = 255;
          img.data[idx + 2] = 0;
        }
      }
    }
  }
  ctx.putImageData(img, 0, 0);
}

function renderViewshed(canvas: HTMLCanvasElement, vis: Uint8Array, rows: number, cols: number) {
  const ctx = canvas.getContext("2d")!;
  canvas.width = cols;
  canvas.height = rows;
  const img = ctx.createImageData(cols, rows);
  for (let i = 0; i < vis.length; i++) {
    const v = vis[i];
    img.data[i * 4] = v ? 60 : 200;
    img.data[i * 4 + 1] = v ? 200 : 60;
    img.data[i * 4 + 2] = 60;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

// ─── OZT2 synthetic encoder (for demo — creates a real tile to decode) ───────

/** Encode a 16-bit elevation grid into OZT2 binary format for demo purposes. */
function encodeOZT2Demo(elevations: Uint16Array, width: number, height: number): Uint8Array {
  // Use a simplified encoding: store raw 16-bit values with zlib compression
  // This matches the OZT2 header format expected by decode_ozt2
  const HEADER = 6;
  const rawBytes = new Uint8Array(elevations.length * 2);
  for (let i = 0; i < elevations.length; i++) {
    const v = elevations[i];
    rawBytes[i * 2] = v & 0xff;
    rawBytes[i * 2 + 1] = (v >> 8) & 0xff;
  }

  // No compression — raw int16 LE bytes (compressor=0)
  const compressed = encodeOZT2Raw(elevations);

  const tile = new Uint8Array(HEADER + compressed.length);
  // vmin = 0 (little-endian)
  tile[0] = 0;
  tile[1] = 0;
  // elev_range = 10000 (maps to ~0-10000m)
  const elevRange = 10000;
  tile[2] = elevRange & 0xff;
  tile[3] = (elevRange >> 8) & 0xff;
  // bits = 16
  tile[4] = 16;
  // flags: predictor=0 (gradient), compressor=0 (none)
  // The wasm handles compressor=0 as raw bytes (no decompression)
  tile[5] = 0;

  tile.set(compressed, HEADER);
  return tile;
}

// Demo encoder — for compressor=0 (none) the wasm expects raw int16 LE bytes
// so no actual compression is needed here.
function encodeOZT2Raw(elevations: Uint16Array): Uint8Array {
  const rawBytes = new Uint8Array(elevations.length * 2);
  for (let i = 0; i < elevations.length; i++) {
    const v = elevations[i];
    rawBytes[i * 2] = v & 0xff;
    rawBytes[i * 2 + 1] = (v >> 8) & 0xff;
  }
  return rawBytes;
}

// ─── Main demo component ─────────────────────────────────────────────────────

export default function WasmDemo() {
  const canvasD8 = useRef<HTMLCanvasElement>(null);
  const canvasAcc = useRef<HTMLCanvasElement>(null);
  const canvasViewshed = useRef<HTMLCanvasElement>(null);

  const [status, setStatus] = useState("Loading WASM...");
  const [wasm, setWasm] = useState<WasmExports | null>(null);
  const [benchmarks, setBenchmarks] = useState<BenchmarkResult[]>([]);
  const [ozeTileInfo, setOzeTileInfo] = useState<string>("");

  useEffect(() => {
    loadWasm()
      .then((m) => {
        setWasm(m);
        setStatus("WASM loaded — running demos...");
        runDemos(m);
      })
      .catch((e) => setStatus(`Error: ${e}`));
  }, []);

  function runDemos(w: WasmExports) {
    const results: BenchmarkResult[] = [];

    // ── 1. D8 Flow Direction (pit DEM) ──────────────────────────────────────
    {
      const SIZE = 3;
      const dem = makePitDEM();
      const t0 = performance.now();
      const [demPtr, demLen] = demToWasm(w, dem);
      const fdPtr = w.d8_flow_direction_wasm(demPtr, demLen, SIZE, SIZE, -9999);
      const fdRaw = readVecU8(w, fdPtr);
      const ms = performance.now() - t0;
      results.push({ label: "D8 flow direction (3×3)", ms, details: Array.from(fdRaw).join(", ") });
      w.__wbindgen_free(demPtr, dem.byteLength);
      w.__wbindgen_free(fdPtr, fdRaw.byteLength);

      if (canvasD8.current) {
        const fd = new Uint8Array(fdRaw);
        renderFlowDir(canvasD8.current, fd, SIZE, SIZE);
      }
    }

    // ── 2. Flow Accumulation ─────────────────────────────────────────────────
    {
      const SIZE = 3;
      const dem = makePitDEM();
      const [demPtr, demLen] = demToWasm(w, dem);
      const fdPtr = w.d8_flow_direction_wasm(demPtr, demLen, SIZE, SIZE, -9999);
      const fdRaw = readVecU8(w, fdPtr);
      const fdArr = new Int8Array(fdRaw.length);
      for (let i = 0; i < fdRaw.length; i++) fdArr[i] = fdRaw[i] === 255 ? -1 : fdRaw[i];
      const [fdWasmPtr, fdWasmLen] = fdToWasm(w, fdArr);
      const t0 = performance.now();
      const accPtr = w.flow_accumulation_wasm(fdWasmPtr, fdWasmLen, SIZE, SIZE, -1);
      const accRaw = readVecU32(w, accPtr);
      const ms = performance.now() - t0;
      const acc = Array.from(accRaw);
      results.push({ label: "Flow accumulation (3×3)", ms, details: `[${acc.join(", ")}]` });
      w.__wbindgen_free(demPtr, dem.byteLength);
      w.__wbindgen_free(fdPtr, fdRaw.byteLength);
      w.__wbindgen_free(fdWasmPtr, fdArr.byteLength);
      w.__wbindgen_free(accPtr, accRaw.byteLength);

      if (canvasAcc.current) {
        const accU32 = new Uint32Array(accRaw.buffer.slice(accRaw.byteOffset, accRaw.byteOffset + accRaw.byteLength));
        renderFlowAcc(canvasAcc.current, accU32, SIZE, SIZE);
      }
    }

    // ── 3. Viewshed (Everest DEM) ─────────────────────────────────────────────
    {
      const SIZE = 30;
      const dem = makeEverestDEM();
      const [demPtr, demLen] = demToWasm(w, dem);
      const t0 = performance.now();
      const visPtr = w.viewshed_wasm(demPtr, demLen, SIZE, SIZE, 12, 10, 2.0, 30.0, -9999);
      const visRaw = readVecU8(w, visPtr);
      const ms = performance.now() - t0;
      results.push({ label: "Viewshed 30×30", ms, details: `${visRaw.filter((v) => v).length} visible cells` });
      w.__wbindgen_free(demPtr, dem.byteLength);
      w.__wbindgen_free(visPtr, visRaw.byteLength);

      if (canvasViewshed.current) {
        const vis = new Uint8Array(visRaw);
        renderViewshed(canvasViewshed.current, vis, SIZE, SIZE);
      }
    }

    // ── 4. Decode OZT2 (real binary format demo) ─────────────────────────────
    {
      // Build a synthetic OZT2 tile (256×256 flat-ish terrain)
      const W = 256;
      const H = 256;
      const elevs = new Uint16Array(W * H);
      let minE = Infinity,
        maxE = -Infinity;
      for (let i = 0; i < elevs.length; i++) {
        const row = Math.floor(i / W);
        const col = i % W;
        // Simulate a ridge running NW→SE
        const v = Math.round(1500 + row * 5 + col * 2 + (Math.random() - 0.5) * 50);
        elevs[i] = Math.max(0, Math.min(65535, v));
        minE = Math.min(minE, v);
        maxE = Math.max(maxE, v);
      }

      // Encode to OZT2-like binary
      const tileBytes = encodeOZT2Demo(elevs, W, H);

      const t0 = performance.now();
      // decode_ozt2 always calls the decompress function.
      // Our demo encoder uses compressor=0 (none), so we return data as-is.
      const result = w.decode_ozt2(tileBytes, (bytes: Uint8Array, _codec: string) => bytes);
      const ms = performance.now() - t0;
      const decodedElevs = result.elevations as unknown as Uint16Array;
      setOzeTileInfo(
        `Decoded ${W}×${H} tile in ${ms.toFixed(1)}ms — ` +
          `range: [${decodedElevs[0]}, ${Math.max(...decodedElevs)}]m`
      );
      results.push({ label: `OZT2 decode ${W}×${H}`, ms });
    }

    // ── 5. Benchmark: D8 on larger terrain ───────────────────────────────────
    {
      const SIZE = 256;
      const dem = new Float32Array(SIZE * SIZE);
      for (let i = 0; i < dem.length; i++) {
        dem[i] = Math.random() * 5000;
      }
      const [demPtr, demLen] = demToWasm(w, dem);
      const t0 = performance.now();
      const fdPtr = w.d8_flow_direction_wasm(demPtr, demLen, SIZE, SIZE, -9999);
      const fdRaw = readVecU8(w, fdPtr);
      const ms = performance.now() - t0;
      results.push({ label: `D8 flow direction ${SIZE}×${SIZE}`, ms });
      w.__wbindgen_free(demPtr, dem.byteLength);
      w.__wbindgen_free(fdPtr, fdRaw.byteLength);
    }

    setBenchmarks(results);
    setStatus("Done — all demos ran successfully.");
  }

  return (
    <div style={{ padding: "2rem", fontFamily: "monospace", maxWidth: 900, margin: "0 auto" }}>
      <h1>OpenZenith Core — WASM Decoder Demo</h1>
      <p style={{ color: "#666" }}>{status}</p>

      <h2>Benchmarks</h2>
      <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: "2rem" }}>
        <thead>
          <tr style={{ textAlign: "left", background: "#f5f5f5" }}>
            <th style={{ padding: "0.5rem" }}>Operation</th>
            <th style={{ padding: "0.5rem" }}>Time</th>
            <th style={{ padding: "0.5rem" }}>Details</th>
          </tr>
        </thead>
        <tbody>
          {benchmarks.map((b) => (
            <tr key={b.label} style={{ borderBottom: "1px solid #eee" }}>
              <td style={{ padding: "0.5rem" }}>{b.label}</td>
              <td style={{ padding: "0.5rem", color: "#2a5" }}>{b.ms.toFixed(2)} ms</td>
              <td style={{ padding: "0.5rem", color: "#666", fontSize: "0.85em" }}>{b.details ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>D8 Flow Direction (3×3 pit DEM)</h2>
      <p style={{ fontSize: "0.8em", color: "#666" }}>
        Direction colours: White=E, LightBlue=SE, Cyan=S, Green=SW, Lime=W, Yellow=NW, Orange=N, Red=NE. Pit cell (top-left) = black.
      </p>
      <div style={{ background: "#111", display: "inline-block", padding: "4px", borderRadius: 4 }}>
        <canvas ref={canvasD8} style={{ imageRendering: "pixelated" }} />
      </div>

      <h2>Flow Accumulation (3×3 pit DEM)</h2>
      <p style={{ fontSize: "0.8em", color: "#666" }}>
        Upstream cell count. White = no upstream (peaks/ridges). Red = high accumulation (streams).
      </p>
      <div style={{ background: "#111", display: "inline-block", padding: "4px", borderRadius: 4 }}>
        <canvas ref={canvasAcc} style={{ imageRendering: "pixelated" }} />
      </div>

      <h2>Viewshed — Mt. Everest (30×30 synthetic DEM)</h2>
      <p style={{ fontSize: "0.8em", color: "#666" }}>
        Observer at the yellow cell (2m eye height). Green = visible, Brown = hidden.
      </p>
      <div style={{ background: "#111", display: "inline-block", padding: "4px", borderRadius: 4 }}>
        <canvas ref={canvasViewshed} style={{ imageRendering: "pixelated" }} />
      </div>

      {ozeTileInfo && (
        <>
          <h2>OZT2 Tile Decode</h2>
          <p style={{ color: "#2a5" }}>{ozeTileInfo}</p>
        </>
      )}

      <h2>Exported Functions</h2>
      <pre style={{ background: "#f5f5f5", padding: "1rem", overflowX: "auto", fontSize: "0.8em" }}>
{`// Load WASM from CDN
import init from '@/lib/wasm/openzenith_core.js';
const wasm = await init('/pkg/openzenith_core_bg.wasm');

// D8 flow direction — returns Uint8Array of 0-7 direction codes
const fdPtr = d8_flow_direction_wasm(demPtr, len, rows, cols, nodata);

// Flow accumulation — returns Uint32Array of upstream counts
const accPtr = flow_accumulation_wasm(fdPtr, len, rows, cols, nodataDir);

// Gradient reconstruction from OZT2 residuals
const elevPtr = gradient_reconstruct_wasm(residualsPtr, len, h, w,
                                          nodata, dequantMin, dequantScale);

// Viewshed from DEM
const visPtr = viewshed_wasm(demPtr, len, rows, cols,
                              observerRow, observerCol,
                              observerHeight, cellSize, nodata);

// Full OZT2 tile decode (header parsing + decompress + reconstruct)
const { elevations, metadata } = decode_ozt2(tileBytes, decompressFn);`}
      </pre>
    </div>
  );
}
