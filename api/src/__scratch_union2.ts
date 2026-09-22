const MAP: Record<string, { title: string }> = { a: { title: "x" } };

// A: annotation only
export function a(id: string): string {
  const col: { title: string } | undefined = MAP[id];
  if (!col) return "missing";
  return col.title;
}

// B: annotation + assertion
export function b(id: string): string {
  const col = MAP[id] as { title: string } | undefined;
  if (!col) return "missing";
  return col.title;
}

// C: helper returning T | undefined
function maybe<T>(v: T): T | undefined {
  return v ?? undefined;
}
export function c(id: string): string {
  const col = maybe(MAP[id]);
  if (!col) return "missing";
  return col.title;
}

// D: Partial<Record<...>> map type
const PMAP: Partial<Record<string, { title: string }>> = { a: { title: "x" } };
export function d(id: string): string {
  const col = PMAP[id];
  if (!col) return "missing";
  return col.title;
}

// E: while-style array index with annotated undefined
const ARR = [{ t: 1 }, { t: 2 }];
export function e(i: number): number {
  const item: { t: number } | undefined = ARR[i];
  if (!item) return -1;
  return item.t;
}
