import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const expectedSha = process.env.EXPECTED_SHA;
const projectName = process.env.PAGES_PROJECT || "openzenith";

if (!expectedSha) {
  console.error("EXPECTED_SHA is required");
  process.exit(1);
}

const { stdout } = await execFileAsync(
  "npx",
  ["wrangler", "pages", "deployment", "list", "--project-name", projectName, "--json"],
  { cwd: "api", maxBuffer: 4 * 1024 * 1024 },
);

const deployments = JSON.parse(stdout);
const production = deployments.find((deployment) => deployment.Environment === "Production" && deployment.Branch === "main");

if (!production) {
  console.error(`No production deployment found for ${projectName}`);
  process.exit(1);
}

const source = String(production.Source || "");
if (!source || !expectedSha.startsWith(source)) {
  console.error(`Deployment provenance mismatch: expected ${expectedSha}, latest production source is ${source || "missing"}`);
  console.error(`Deployment: ${production.Deployment || "unknown"}`);
  process.exit(1);
}

console.log(`PASS production deployment ${production.Deployment} source=${source}`);
