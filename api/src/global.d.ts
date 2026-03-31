// Augment Response.json() to return Promise<any> instead of Promise<unknown>
// This avoids having to cast every res.json() call throughout the codebase.
interface Response {
  json(): Promise<any>;
}

declare module "shpjs" {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export function parseZip(buffer: ArrayBuffer): any;
}
