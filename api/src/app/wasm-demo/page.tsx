/**
 * WASM Decoder Demo — OpenZenith OZT2 terrain analysis in the browser.
 *
 * Demonstrates the shipped `openzenith_core` module (api/public/pkg):
 *   - D8 flow direction + flow accumulation on a synthetic DEM
 *   - OZT2 tile encode (real gradient residuals + zlib) and decode
 *   - Viewshed analysis
 *   - Decode of a real production tile fetched from the HuggingFace dataset
 *
 * The demo tile uses the production layout — 6-byte header, gradient
 * residuals, zlib payload — and is decoded by the module's `decode_ozt2`
 * export, which parses the header, calls back into JS for the entropy coder
 * and reconstructs in Rust. The real-tile step exercises the same path with
 * the production compressors (brotli/zstd) the shipped tiles actually carry.
 *
 * Run locally (from api/):
 *   npm run dev
 *   then open http://localhost:3000/wasm-demo
 */

"use client";

import { useEffect, useRef, useState } from "react";
import { unzlibSync, zlibSync } from "fflate";
import { decompress as fzstdDecompress } from "fzstd";
import { decompress as brotliWasmDecompress, initSync } from "brotli-dec-wasm/web";
import { BROTLI_WASM_B64 } from "@/lib/brotli_wasm";
import { Navbar } from "@/components/Navbar";

// ─── Types (mirroring api/public/pkg/openzenith_core.d.ts) ───────────────────

/** Raw instance exports — needed only to allocate input buffers. */
interface WasmInstance {
  __wbindgen_malloc: (size: number, align: number) => number;
  __wbindgen_free: (ptr: number, size: number, align: number) => void;
  memory: WebAssembly.Memory;
}

/** Metadata object returned by the module's OZT2 decoder. */
interface OZT2Metadata {
  min_elevation: number;
  elevation_range: number;
  max_elevation: number;
  bits_per_pixel: number;
  predictor: string;
  compressor: string;
  width: number;
  height: number;
}

/** Decoded tile payload plus the header fields it was reconstructed from. */
interface OZT2Tile {
  elevations: Uint16Array;
  metadata: OZT2Metadata;
}

/** Generated glue entry points — they marshal typed arrays in and out. */
interface CoreApi {
  d8_flow_direction_wasm: (demPtr: number, len: number, rows: number, cols: number, nodata: number) => Uint8Array;
  flow_accumulation_wasm: (fdPtr: number, len: number, rows: number, cols: number, nodataDir: number) => Uint32Array;
  gradient_predict_wasm: (elevPtr: number, len: number, rows: number, cols: number, nodata: number) => Int16Array;
  viewshed_wasm: (
    demPtr: number,
    len: number,
    rows: number,
    cols: number,
    observerRow: number,
    observerCol: number,
    observerHeight: number,
    cellSize: number,
    nodata: number,
    maxDistanceCells: number | null,
  ) => Uint8Array;
  decode_ozt2: (
    tileBytes: Uint8Array,
    decompressFn: (bytes: Uint8Array, compressor: number) => Uint8Array,
  ) => OZT2Tile;
}

/** The glue module: every entry point plus the async initialiser. */
interface WasmGlue extends CoreApi {
  default: (moduleOrPath?: Request | URL | string | ArrayBuffer) => Promise<WasmInstance>;
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

/** Elevation sentinel every DEM the demo feeds WASM agrees on. */
const DEM_NODATA = -32768;
/** Flow-direction sentinel the D8 export reports for pits and nodata cells. */
const FLOW_NODATA = 255;
/** Signed flow-direction sentinel `flow_accumulation_wasm` consumes. */
const FLOW_NODATA_SIGNED = -1;

/** Instantiate the WASM module from the committed pkg directory. */
async function loadWasm(): Promise<{ instance: WasmInstance; core: WasmGlue }> {
  // webpackIgnore keeps this a native browser import: the glue lives in
  // public/pkg as a static asset, not as a bundleable source module.
  const glue = (await import(/* webpackIgnore: true */ "/pkg/openzenith_core.js")) as unknown as WasmGlue;
  // Explicit URL so the glue fetches the binary sitting beside it in /pkg.
  const wasmUrl = new URL("/pkg/openzenith_core_bg.wasm", window.location.origin);
  return { instance: await glue.default(wasmUrl), core: glue };
}

/** Copy a Float32Array into WASM linear memory; returns its pointer. */
function demToWasm(wasm: WasmInstance, dem: Float32Array): number {
  const ptr = wasm.__wbindgen_malloc(dem.byteLength, 4);
  new Float32Array(wasm.memory.buffer).set(dem, ptr / 4);
  return ptr;
}

/** Copy an Int8Array into WASM linear memory; returns its pointer. */
function fdToWasm(wasm: WasmInstance, fd: Int8Array): number {
  const ptr = wasm.__wbindgen_malloc(fd.byteLength, 1);
  new Int8Array(wasm.memory.buffer).set(fd, ptr / 1);
  return ptr;
}

// ─── Colour helpers ───────────────────────────────────────────────────────────

const FLOW_PALETTE: [number, number, number][] = [
  [255, 255, 255], // 0  E
  [200, 200, 255], // 1  E
  [100, 200, 255], // 2  SE
  [50, 150, 255], // 3  S
  [50, 255, 200], // 4  SW
  [100, 255, 100], // 5  W
  [255, 255, 50], // 6  NW
  [255, 150, 50], // 7  N
];

function flowDirColour(d: number): [number, number, number] {
  if (d === 255) return [0, 0, 0];
  return FLOW_PALETTE[d] ?? [180, 180, 180];
}

function flowAccColour(v: number, max: number): [number, number, number] {
  const t = Math.log1p(v) / Math.log1p(max);
  return [Math.round(255 * (1 - t)), Math.round(255 * t), Math.round(100 * t)];
}

// ─── Canvas renderers ────────────────────────────────────────────────────────

function renderFlowDir(canvas: HTMLCanvasElement, fd: Uint8Array, rows: number, cols: number) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
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
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
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

function renderViewshed(canvas: HTMLCanvasElement, vis: Uint8Array, rows: number, cols: number) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
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

// ─── OZT2 tile encoder + entropy coder (production layout) ───────────────────

/** Header size: vmin (i16), elev_range (u16), bits (u8), flags (u8). */
const OZT2_HEADER_BYTES = 6;

// Flags-byte codes production tiles carry — identical to what the core decoder
// now reads (core/src/wasm.rs) and what the edge decoder dispatches on
// (api/src/lib/ozt2_decode.ts).
const COMP_BROTLI = 0;
const COMP_ZSTD = 1;
const COMP_ZLIB = 2;
const COMP_NONE = 3;

/** Lossless 16-bit pixels, as the Python encoder writes them. */
const OZT2_BITS_LOSSLESS = 16;

/**
 * Encode an elevation grid the way the Python encoder does — gradient
 * residuals over the raw grid, 16-bit lossless, zlib payload. `vmin` stays 0
 * so the residuals the WASM predictor produces are absolute elevations.
 */
function encodeOZT2Demo(
  instance: WasmInstance,
  core: CoreApi,
  dem: Float32Array,
  rows: number,
  cols: number,
): Uint8Array {
  const demPtr = demToWasm(instance, dem);
  const residuals = core.gradient_predict_wasm(demPtr, dem.length, rows, cols, DEM_NODATA);
  instance.__wbindgen_free(demPtr, dem.byteLength, 4);

  let maxElevation = 0;
  for (let i = 0; i < dem.length; i++) maxElevation = Math.max(maxElevation, dem[i]);
  const elevRange = Math.round(maxElevation);

  const payload = zlibSync(new Uint8Array(residuals.buffer, residuals.byteOffset, residuals.byteLength));
  const tile = new Uint8Array(OZT2_HEADER_BYTES + payload.length);
  const view = new DataView(tile.buffer);
  view.setInt16(0, 0, true);
  view.setUint16(2, elevRange, true);
  tile[4] = OZT2_BITS_LOSSLESS;
  // PRED_GRADIENT = 2 in the flags low bits; zlib = 2 in the high bits.
  tile[5] = 2 | (COMP_ZLIB << 2);
  tile.set(payload, OZT2_HEADER_BYTES);
  return tile;
}

/**
 * Decompress an OZT2 payload the way the edge decoder does, keyed by the
 * header code `decode_ozt2` passes through: brotli through the embedded WASM
 * decoder (87% of shipped tiles), zstd through fzstd (13%), zlib through
 * fflate, and the reserved no-compression code as identity. The brotli wasm
 * (~208KB) compiles lazily on the first brotli tile.
 */
let brotliReady = false;
function decompressOZT2(bytes: Uint8Array, compressor: number): Uint8Array {
  if (compressor === COMP_BROTLI) {
    if (!brotliReady) {
      const bin = atob(BROTLI_WASM_B64);
      const moduleBytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) moduleBytes[i] = bin.charCodeAt(i);
      initSync({ module: moduleBytes });
      brotliReady = true;
    }
    return brotliWasmDecompress(bytes);
  }
  if (compressor === COMP_ZSTD) return fzstdDecompress(bytes);
  if (compressor === COMP_ZLIB) return unzlibSync(bytes);
  if (compressor === COMP_NONE) return bytes;
  throw new Error(`Unsupported compressor code: ${compressor}`);
}

// ─── Main demo component ─────────────────────────────────────────────────────

export default function WasmDemo() {
  const canvasD8 = useRef<HTMLCanvasElement>(null);
  const canvasAcc = useRef<HTMLCanvasElement>(null);
  const canvasViewshed = useRef<HTMLCanvasElement>(null);

  const [status, setStatus] = useState("Loading WASM...");
  const [_wasm, setWasm] = useState<WasmInstance | null>(null);
  const [benchmarks, setBenchmarks] = useState<BenchmarkResult[]>([]);
  const [ozeTileInfo, setOzeTileInfo] = useState<string>("");

  useEffect(() => {
    loadWasm()
      .then(({ instance, core }) => {
        setWasm(instance);
        setStatus("WASM loaded — running demos...");
        runDemos(instance, core);
      })
      .catch((e: unknown) => { setStatus(`Error: ${String(e)}`); });
  }, []);

  function runDemos(instance: WasmInstance, core: WasmGlue) {
    const results: BenchmarkResult[] = [];

    // ── 1. D8 Flow Direction (pit DEM) ──────────────────────────────────────
    {
      const SIZE = 3;
      const dem = makePitDEM();
      const t0 = performance.now();
      const demPtr = demToWasm(instance, dem);
      const fd = core.d8_flow_direction_wasm(demPtr, dem.length, SIZE, SIZE, DEM_NODATA);
      const ms = performance.now() - t0;
      results.push({ label: "D8 flow direction (3×3)", ms, details: Array.from(fd).join(", ") });
      instance.__wbindgen_free(demPtr, dem.byteLength, 4);

      if (canvasD8.current) renderFlowDir(canvasD8.current, fd, SIZE, SIZE);
    }

    // ── 2. Flow Accumulation ─────────────────────────────────────────────────
    {
      const SIZE = 3;
      const dem = makePitDEM();
      const demPtr = demToWasm(instance, dem);
      const fdBytes = core.d8_flow_direction_wasm(demPtr, dem.length, SIZE, SIZE, DEM_NODATA);
      // Accumulation consumes the signed grid, so the D8 sentinel maps to -1.
      const fd = new Int8Array(fdBytes.length);
      for (let i = 0; i < fdBytes.length; i++) {
        fd[i] = fdBytes[i] === FLOW_NODATA ? FLOW_NODATA_SIGNED : fdBytes[i];
      }
      const fdPtr = fdToWasm(instance, fd);
      const t0 = performance.now();
      const acc = core.flow_accumulation_wasm(fdPtr, fd.length, SIZE, SIZE, FLOW_NODATA_SIGNED);
      const ms = performance.now() - t0;
      results.push({ label: "Flow accumulation (3×3)", ms, details: `[${Array.from(acc).join(", ")}]` });
      instance.__wbindgen_free(demPtr, dem.byteLength, 4);
      instance.__wbindgen_free(fdPtr, fd.byteLength, 1);

      if (canvasAcc.current) renderFlowAcc(canvasAcc.current, acc, SIZE, SIZE);
    }

    // ── 3. Viewshed (Everest DEM) ─────────────────────────────────────────────
    {
      const SIZE = 30;
      const dem = makeEverestDEM();
      const demPtr = demToWasm(instance, dem);
      const t0 = performance.now();
      // No maximum distance: every cell is tested.
      const vis = core.viewshed_wasm(demPtr, dem.length, SIZE, SIZE, 12, 10, 2.0, 30.0, DEM_NODATA, null);
      const ms = performance.now() - t0;
      results.push({ label: "Viewshed 30×30", ms, details: `${vis.filter((v) => v).length} visible cells` });
      instance.__wbindgen_free(demPtr, dem.byteLength, 4);

      if (canvasViewshed.current) renderViewshed(canvasViewshed.current, vis, SIZE, SIZE);
    }

    // ── 4. OZT2 tile: encode, then decode through the WASM decoder ───────────
    {
      const W = 256;
      const H = 256;
      const dem = new Float32Array(W * H);
      for (let r = 0; r < H; r++) {
        for (let c = 0; c < W; c++) {
          // A ridge running NW→SE, in whole metres like the source DEM.
          dem[r * W + c] = Math.round(1500 + r * 5 + c * 2 + (Math.random() - 0.5) * 50);
        }
      }

      const tileBytes = encodeOZT2Demo(instance, core, dem, H, W);

      const t0 = performance.now();
      // The tile is written in the production codes and the decoder reads
      // production codes — the callback is the entropy half of the production
      // decoder, keyed by the header's compressor field.
      const result = core.decode_ozt2(tileBytes, decompressOZT2);
      const ms = performance.now() - t0;

      const decoded = result.elevations;
      let mismatches = 0;
      let maxElevation = 0;
      for (let i = 0; i < dem.length; i++) {
        if (decoded[i] !== dem[i]) mismatches++;
        maxElevation = Math.max(maxElevation, decoded[i]);
      }
      const roundTrip =
        mismatches === 0 ? `all ${dem.length} cells round-trip exactly` : `${mismatches} cells differ`;
      setOzeTileInfo(
        `Decoded ${W}×${H} tile (${result.metadata.compressor}, ${result.metadata.predictor}) in ${ms.toFixed(1)}ms — ` +
          `range: [${decoded[0]}, ${maxElevation}]m, ${result.metadata.bits_per_pixel}-bit, ${roundTrip}`,
      );
      results.push({ label: `OZT2 decode ${W}×${H}`, ms });
    }

    // ── 5. Real production tile: fetch from the HuggingFace dataset ──────────
    {
      // Everest summit tile (z10, slippy math on 27.9881°N 86.9250°E). Shipped
      // tiles are brotli (the Python encoder's default) or zstd, so this
      // exercises the production entropy path the synthetic zlib tile above
      // cannot.
      const url =
        "https://huggingface.co/datasets/aliasfox/srtm30m-ozt2-v2/resolve/main/tiles/z10/758/428.ozt2";
      fetch(url, { signal: AbortSignal.timeout(15000) })
        .then(async (res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const bytes = new Uint8Array(await res.arrayBuffer());
          const t0 = performance.now();
          const tile = core.decode_ozt2(bytes, decompressOZT2);
          const ms = performance.now() - t0;
          let min = Number.POSITIVE_INFINITY;
          let max = 0;
          for (let i = 0; i < tile.elevations.length; i++) {
            min = Math.min(min, tile.elevations[i]);
            max = Math.max(max, tile.elevations[i]);
          }
          setOzeTileInfo(
            (prev) =>
              `${prev} | Real tile z10/758/428 (${bytes.length} B, ${tile.metadata.compressor}, ` +
              `${tile.metadata.predictor}): ${tile.metadata.width}×${tile.metadata.height} decoded in ` +
              `${ms.toFixed(1)}ms — range [${min}, ${max}]m`,
          );
        })
        .catch((e: unknown) => {
          setOzeTileInfo(
            (prev) => `${prev} | Real tile fetch unavailable: ${String(e instanceof Error ? e.message : e)}`,
          );
        });
    }

    // ── 6. Benchmark: D8 on larger terrain ───────────────────────────────────
    {
      const SIZE = 256;
      const dem = new Float32Array(SIZE * SIZE);
      for (let i = 0; i < dem.length; i++) {
        dem[i] = Math.random() * 5000;
      }
      const demPtr = demToWasm(instance, dem);
      const t0 = performance.now();
      core.d8_flow_direction_wasm(demPtr, dem.length, SIZE, SIZE, DEM_NODATA);
      const ms = performance.now() - t0;
      results.push({ label: `D8 flow direction ${SIZE}×${SIZE}`, ms });
      instance.__wbindgen_free(demPtr, dem.byteLength, 4);
    }

    setBenchmarks(results);
    setStatus("Done — all demos ran successfully.");
  }

  return (
    <>
      {/* The demo was the only page without site chrome; the navbar gives it
         standard navigation (and its keyboard stop) back. It renders light —
         this page has no theme support. */}
      <Navbar dark={false} breadcrumb="WASM Demo" />
      <main id="main-content" tabIndex={-1} style={{ padding: "2rem", fontFamily: "monospace", maxWidth: 900, margin: "0 auto" }}>
        <h1>OpenZenith Core — WASM Decoder Demo</h1>
      <p style={{ color: "#555" }}>{status}</p>

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
              <td style={{ padding: "0.5rem", color: "#166534" }}>{b.ms.toFixed(2)} ms</td>
              <td style={{ padding: "0.5rem", color: "#555", fontSize: "0.85em" }}>{b.details ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>D8 Flow Direction (3×3 pit DEM)</h2>
      <p style={{ fontSize: "0.8em", color: "#555" }}>
        Direction colours: White=E, LightBlue=SE, Cyan=S, Green=SW, Lime=W, Yellow=NW, Orange=N, Red=NE. Pit cell
        (top-left) = black. DEMs use -32768 as their nodata sentinel and flow direction reports 255 (mapped to -1 for
        accumulation) where no downslope neighbour exists.
      </p>
      <div style={{ background: "#111", display: "inline-block", padding: "4px", borderRadius: 4 }}>
        <canvas
          ref={canvasD8}
          role="img"
          aria-label="D8 flow direction raster of a 3 by 3 pit DEM: eight coloured direction cells around a black pit cell"
          style={{ imageRendering: "pixelated" }}
        />
      </div>

      <h2>Flow Accumulation (3×3 pit DEM)</h2>
      <p style={{ fontSize: "0.8em", color: "#555" }}>
        Upstream cell count. White = no upstream (peaks/ridges). Red = high accumulation (streams).
      </p>
      <div style={{ background: "#111", display: "inline-block", padding: "4px", borderRadius: 4 }}>
        <canvas
          ref={canvasAcc}
          role="img"
          aria-label="Flow accumulation raster of a 3 by 3 pit DEM: white ridge cells and a red high-accumulation stream cell"
          style={{ imageRendering: "pixelated" }}
        />
      </div>

      <h2>Viewshed — Mt. Everest (30×30 synthetic DEM)</h2>
      <p style={{ fontSize: "0.8em", color: "#555" }}>
        Observer at the yellow cell (2m eye height). Green = visible, Brown = hidden.
      </p>
      <div style={{ background: "#111", display: "inline-block", padding: "4px", borderRadius: 4 }}>
        <canvas
          ref={canvasViewshed}
          role="img"
          aria-label="Viewshed raster of a 30 by 30 synthetic Everest DEM: green visible cells and brown hidden cells around a yellow observer cell"
          style={{ imageRendering: "pixelated" }}
        />
      </div>

      {ozeTileInfo && (
        <>
          <h2>OZT2 Tile Decode</h2>
          <p style={{ fontSize: "0.8em", color: "#555", marginBottom: 0 }}>
            The synthetic tile is encoded here with the production layout — 6-byte header, gradient residuals from the
            module, zlib payload — then handed to the module&apos;s own decoder, which parses the header, calls back
            into JavaScript for the entropy half (brotli/zstd/zlib, keyed by the header&apos;s compressor code) and
            reconstructs the grid in Rust. A real production tile fetched from the HuggingFace dataset runs the same
            path with the compressors shipped tiles actually carry.
          </p>
          <p style={{ color: "#166534" }}>{ozeTileInfo}</p>
        </>
      )}

      <h2>Exported Functions</h2>
      <pre style={{ background: "#f5f5f5", padding: "1rem", overflowX: "auto", fontSize: "0.8em" }}>
        {`// Load the module from the pkg directory
import init, { decode_ozt2 } from '/pkg/openzenith_core.js';
const wasm = await init('/pkg/openzenith_core_bg.wasm');

// D8 flow direction — Uint8Array of 0-7 direction codes, 255 = no flow
const fd = d8_flow_direction_wasm(demPtr, len, rows, cols, -32768);

// Flow accumulation — Uint32Array of upstream counts (takes the signed grid)
const acc = flow_accumulation_wasm(fdPtr, len, rows, cols, -1);

// Stream order from accumulated flow — Uint8Array of Strahler orders
const order = stream_order_wasm(streamsPtr, fdPtr, len, rows, cols, -1);

// Gradient prediction — Int16Array of OZT2 residuals
const residuals = gradient_predict_wasm(elevPtr, len, rows, cols, -32768);

// Viewshed — Uint8Array of 0/1 visibility, null = no distance cap
const vis = viewshed_wasm(demPtr, len, rows, cols, obsRow, obsCol,
                            obsHeight, cellSize, -32768, null);

// Full OZT2 tile decode (header parsing + decompress callback + reconstruct).
// The callback receives the header's compressor code:
// 0 = brotli, 1 = zstd, 2 = zlib, 3 = none — route accordingly.
const { elevations, metadata } = decode_ozt2(tileBytes, decompressOZT2);`}
        </pre>
      </main>
    </>
  );
}
