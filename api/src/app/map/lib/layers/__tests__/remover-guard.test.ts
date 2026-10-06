/**
 * Source invariant: layer removers must go through removeLayerIfPresent /
 * removeSourceIfPresent. MapLibre v5 logs a console ErrorEvent for
 * "cannot remove non-existing layer/source" even when the call sits in a
 * try/catch, and the layer-toggle crawl counts those as defects — the
 * prod crawl (2026-10-05) caught seven modules still logging on toggle-off.
 * types.ts is exempt: it is where the guards themselves are defined.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const layerDir = join(__dirname, "..");
const layerFiles = readdirSync(layerDir).filter((f) => f.endsWith(".ts") && f !== "types.ts");

describe("layer remover guard invariant", () => {
  it("has guard helpers for both layers and sources", () => {
    const src = readFileSync(join(layerDir, "types.ts"), "utf8");
    expect(src).toContain("export function removeLayerIfPresent");
    expect(src).toContain("export function removeSourceIfPresent");
  });

  it("never calls map.removeLayer/map.removeSource directly", () => {
    const violations = layerFiles
      .filter((f) => /map\.(removeLayer|removeSource)\(/.test(readFileSync(join(layerDir, f), "utf8")))
      .map((f) => `map/lib/layers/${f}`);
    expect(violations).toEqual([]);
  });

  it("imports the guards it uses from the shared types module", () => {
    const violations = layerFiles
      .filter((f) => {
        const src = readFileSync(join(layerDir, f), "utf8");
        const usesGuards = /remove(Layer|Source)IfPresent\(map/.test(src);
        const importsGuards = /import \{[^}]*remove(Layer|Source)IfPresent[^}]*\} from "\.\/types"/.test(src);
        return usesGuards && !importsGuards;
      })
      .map((f) => `map/lib/layers/${f}`);
    expect(violations).toEqual([]);
  });
});
