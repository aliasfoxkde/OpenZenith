/**
 * TypeScript declarations for openzenith-core WASM exports.
 */

declare module "*.wasm" {
  const content: WebAssembly.Module;
  /**
   * Default export for `*.wasm` imports: the compiled WebAssembly module
   * that was emitted at build time.
   */
  export default content;
}

// CSS side-effect imports (Next.js convention)
declare module "*.css" {}

// WASM module declarations
declare module "/pkg/openzenith_core.js" {
  export function initSync(module: { module: WebAssembly.Module }): void;
  /**
   * Default export of the wasm-bindgen JS shim: initializes the WASM instance
   * asynchronously and resolves once the module is ready to accept calls.
   */
  export default function init(): Promise<void>;
}
