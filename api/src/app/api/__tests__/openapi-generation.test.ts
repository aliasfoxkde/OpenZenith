import { describe, it, expect } from "vitest";
import { execFile } from "node:child_process";
import { readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// Next.js route segment to OpenAPI parameter: [param] -> {param}, [...rest] -> {rest}.
function toTemplate(routeDir: string, file: string): string {
  const segments = relative(routeDir, file).split(/[/\\]/).slice(0, -1);
  const mapped = segments.map((p) =>
    p.startsWith("[...") ? `{${p.slice(4, -1)}}` : p.startsWith("[") ? `{${p.slice(1, -1)}}` : p,
  );
  return `/api/${mapped.join("/")}`;
}

async function walkRoutes(dir: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(dir)) {
    const full = join(dir, entry);
    if ((await stat(full)).isDirectory()) found.push(...(await walkRoutes(full)));
    else if (entry === "route.ts") found.push(full);
  }
  return found;
}

describe("OpenAPI generation", () => {
  it("served spec.json is current with the route tree and package version", async () => {
    // Fails whenever the committed spec no longer matches (base.json +
    // routes + package version): a route added without regenerating, or a
    // version bump without regeneration.
    await expect(
      execFileAsync("node", [join("scripts", "gen-openapi.mjs"), "--check"], {
        cwd: process.cwd(),
      }),
    ).resolves.toBeDefined();
  });

  it("documents every live route", async () => {
    const { default: spec } = await import("@/app/api/openapi.json/spec.json");
    const apiDir = join(process.cwd(), "src/app/api");
    for (const file of await walkRoutes(apiDir)) {
      const template = toTemplate(apiDir, file);
      expect(
        spec.paths[template as keyof typeof spec.paths],
        `route ${template} is missing from the OpenAPI spec`,
      ).toBeDefined();
    }
  });
});
