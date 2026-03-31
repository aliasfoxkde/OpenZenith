// Augment Response.json() to return Promise<any> instead of Promise<unknown>
// This avoids having to cast every res.json() call throughout the codebase.
interface Response {
  json(): Promise<any>;
}
