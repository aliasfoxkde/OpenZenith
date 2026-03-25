/**
 * Chunk-based storage backend for pre-extracted SRTM tiles.
 *
 * Fetches individual 256x256 Deflate-compressed chunks from HuggingFace
 * instead of parsing full GeoTIFF files with Range requests.
 *
 * Chunk URL pattern:
 *   https://huggingface.co/datasets/{repo}/resolve/main/{latDir}/{base}_{row}_{col}.deflate
 */

export type BackendType = "huggingface" | "http";

export interface ChunkBackend {
  /** Fetch a single 256x256 chunk by SRTM tile name and grid position. */
  fetchChunk(srtmName: string, row: number, col: number): Promise<ArrayBuffer>;
  /** Check if a chunk exists. */
  chunkExists(srtmName: string, row: number, col: number): Promise<boolean>;
}

export function createChunkBackend(
  type: BackendType,
  config: Record<string, string>,
): ChunkBackend {
  switch (type) {
    case "huggingface":
      return new HuggingFaceChunkBackend(
        config.repo || "aliasfox/srtm30m-chunks",
      );
    case "http":
      return new HttpChunkBackend(config.baseUrl || "");
    default:
      throw new Error(`Unknown backend type: ${type}`);
  }
}

export function getDefaultBackend(): ChunkBackend {
  const type = (process.env.STORAGE_BACKEND || "huggingface") as BackendType;
  return createChunkBackend(type, {
    repo: process.env.HF_REPO || "aliasfox/srtm30m-chunks",
    baseUrl: process.env.TILES_BASE_URL || "",
  });
}

/** Build the chunk filename from SRTM tile name and grid position. */
export function chunkFilename(
  srtmName: string,
  row: number,
  col: number,
): string {
  const base = srtmName.replace(".tif", "");
  const latDir = base.substring(0, 3);
  const rowStr = String(row).padStart(2, "0");
  const colStr = String(col).padStart(2, "0");
  return `${latDir}/${base}_${rowStr}_${colStr}.deflate`;
}

// --- Implementations ---

class HuggingFaceChunkBackend implements ChunkBackend {
  constructor(private repo: string) {}

  getChunkUrl(srtmName: string, row: number, col: number): string {
    const path = chunkFilename(srtmName, row, col);
    return `https://huggingface.co/datasets/${this.repo}/resolve/main/${path}`;
  }

  async fetchChunk(
    srtmName: string,
    row: number,
    col: number,
  ): Promise<ArrayBuffer> {
    const url = this.getChunkUrl(srtmName, row, col);
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(
        `Chunk not found: ${srtmName} row=${row} col=${col} (${response.status})`,
      );
    }
    return response.arrayBuffer();
  }

  async chunkExists(
    srtmName: string,
    row: number,
    col: number,
  ): Promise<boolean> {
    try {
      const response = await fetch(this.getChunkUrl(srtmName, row, col), {
        method: "HEAD",
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}

class HttpChunkBackend implements ChunkBackend {
  constructor(private baseUrl: string) {}

  getChunkUrl(srtmName: string, row: number, col: number): string {
    const path = chunkFilename(srtmName, row, col);
    return `${this.baseUrl.replace(/\/$/, "")}/${path}`;
  }

  async fetchChunk(
    srtmName: string,
    row: number,
    col: number,
  ): Promise<ArrayBuffer> {
    const url = this.getChunkUrl(srtmName, row, col);
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(
        `Chunk not found: ${srtmName} row=${row} col=${col} (${response.status})`,
      );
    }
    return response.arrayBuffer();
  }

  async chunkExists(
    srtmName: string,
    row: number,
    col: number,
  ): Promise<boolean> {
    try {
      const response = await fetch(this.getChunkUrl(srtmName, row, col), {
        method: "HEAD",
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}
