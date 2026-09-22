/**
 * Source invariant: any map or globe layer that flags an "error" status must
 * also log the underlying exception via warnLayerError.
 *
 * The status badge tells users THAT a layer failed; warnLayerError tells
 * developers WHY. This scan keeps the two from drifting apart — the audit
 * that wired all ~60 layer failure paths through warnLayerError used to be
 * enforceable only by review.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const layerDirs = [
  join(__dirname, ".."), // map/lib/layers
  join(__dirname, "../../../../globe/lib/layers"), // globe/lib/layers
];

const layerFiles = layerDirs.flatMap((dir) =>
  readdirSync(dir)
    .filter((f) => f.endsWith(".ts"))
    .map((f) => join(dir, f)),
);

function flagsErrorStatus(src: string): boolean {
  return (
    /setStatus\([^)]*,\s*"error"\)/.test(src) ||
    // `error: null` only clears a previous failure — not a report. The
    // value alternation must consume a non-space character so \s* can't
    // backtrack ahead of the whitespace and dodge the null check.
    /updateStatus\([^)]*\{[^}]*error:\s*(?:["'`[{]|\d|(?!null\b)[a-zA-Z_$])/.test(src)
  );
}

describe("layer error diagnostics invariant", () => {
  it("flags error status in at least the audited layer files", () => {
    const flagging = layerFiles.filter((f) => flagsErrorStatus(readFileSync(f, "utf8")));
    expect(flagging.length).toBeGreaterThan(40);
  });

  it("logs the exception wherever a layer reports an error status", () => {
    const violations = layerFiles
      .filter((f) => {
        const src = readFileSync(f, "utf8");
        return flagsErrorStatus(src) && !src.includes("warnLayerError");
      })
      .map((f) => f.replace(/.*src\/app\//, ""));
    expect(violations).toEqual([]);
  });

  it("routes warnLayerError through the shared diagnostics module", () => {
    const violations = layerFiles
      .filter((f) => readFileSync(f, "utf8").includes("warnLayerError"))
      .filter((f) => {
        const src = readFileSync(f, "utf8");
        const definesLocally = /export function warnLayerError/.test(src);
        const importsShared = /warnLayerError[^]*?from ["']@\/lib\/diagnostics["']|warnLayerError[^]*?from ["']\.\/types["']/.test(src);
        return !definesLocally && !importsShared;
      })
      .map((f) => f.replace(/.*src\/app\//, ""));
    expect(violations).toEqual([]);
  });
});
