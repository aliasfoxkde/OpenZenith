/**
 * Edge-safe storage backend — re-exports HuggingFace backend only.
 * Node.js-only LocalTifBackend is in local-tif-backend.ts.
 */

export { HuggingFaceChunkBackend } from "./huggingface-backend";
export type { ChunkBackend } from "./huggingface-backend";
