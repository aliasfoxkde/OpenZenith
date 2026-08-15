/**
 * Edge-safe storage backends.
 * Node.js-only LocalTifBackend is in local-tif-backend.ts.
 */

export { HuggingFaceChunkBackend } from "./huggingface-backend";
export { OZT2HuggingFaceBackend } from "./ozt2-backend";
export type { ChunkBackend } from "./huggingface-backend";
export type { OZT2BackendOptions } from "./ozt2-backend";
