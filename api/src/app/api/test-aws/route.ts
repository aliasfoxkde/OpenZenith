export const runtime = "edge";

export async function GET() {
  const t0 = Date.now();
  try {
    const resp = await fetch("https://s3.amazonaws.com/elevation-tiles-prod/terrarium/0/0/0.png");
    const buf = await resp.arrayBuffer();
    const fetchMs = Date.now() - t0;

    // Test 1: fflate inflateSync
    let fflateResult = "not tested";
    try {
      const { inflateSync } = await import("fflate");
      const compressed = extractIDAT(new Uint8Array(buf));
      if (compressed) {
        const raw = inflateSync(compressed);
        fflateResult = `ok (${raw.length} bytes)`;
      } else {
        fflateResult = "no IDAT found";
      }
    } catch (err) {
      fflateResult = `error: ${err}`;
    }

    // Test 2: DecompressionStream
    let streamResult = "not tested";
    try {
      const compressed = extractIDAT(new Uint8Array(buf));
      if (compressed) {
        const ds = new DecompressionStream("deflate");
        const writer = ds.writable.getWriter();
        writer.write(compressed.buffer as ArrayBuffer);
        writer.close();
        const reader = ds.readable.getReader();
        const chunks: Uint8Array[] = [];
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
        }
        const totalLen = chunks.reduce((s, c) => s + c.length, 0);
        streamResult = `ok (${totalLen} bytes)`;
      } else {
        streamResult = "no IDAT found";
      }
    } catch (err) {
      streamResult = `error: ${err}`;
    }

    return Response.json({
      bodySize: buf.byteLength,
      fetchMs,
      fflate: fflateResult,
      decompressionStream: streamResult,
    });
  } catch (err) {
    return Response.json({ error: String(err), elapsed_ms: Date.now() - t0 }, { status: 500 });
  }
}

function extractIDAT(png: Uint8Array): Uint8Array | null {
  let offset = 8;
  const chunks: Uint8Array[] = [];
  while (offset < png.length) {
    const chunkLen = (png[offset] << 24) | (png[offset + 1] << 16) | (png[offset + 2] << 8) | png[offset + 3];
    const chunkType = String.fromCharCode(png[offset + 4], png[offset + 5], png[offset + 6], png[offset + 7]);
    if (chunkType === "IDAT") {
      chunks.push(png.subarray(offset + 8, offset + 8 + chunkLen));
    }
    offset += 12 + chunkLen;
  }
  if (chunks.length === 0) return null;
  const total = chunks.reduce((s, c) => s + c.length, 0);
  const result = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    result.set(c, off);
    off += c.length;
  }
  return result;
}
