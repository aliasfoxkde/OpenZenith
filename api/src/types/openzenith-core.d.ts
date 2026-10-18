/**
 * TypeScript declarations for openzenith-core WASM exports.
 */

declare module "*.wasm" {
  const content: WebAssembly.Module;
  export default content;
}

// CSS side-effect imports (Next.js convention)
declare module "*.css" {}

// WASM module declarations
declare module "/pkg/openzenith_core.js" {
  export function initSync(module: { module: WebAssembly.Module }): void;
  export default function init(): Promise<void>;
}
