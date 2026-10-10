// Rebuild node_modules/.bin entries as real shell shims.
//
// WHY: the GitForge fedora runner binds the job workspace through an sshfs
// bridge whose sftp layer denies READLINK ("Operation not permitted"), so
// every npm-created bin symlink is unexecutable inside the job container —
// `npx tsc` falls back to the bogus `tsc@2.0.4` stub and `npm run <script>`
// dies with EPERM (same signature as the 2026-10-05 vitest failure).
// Real files work over that transport, so this walks every package's
// package.json `bin` field and rewrites each .bin entry as a plain shim
// that execs the target through its shebang interpreter.
//
// Usage: node relink-bins.mjs <path-to-node_modules> [...more]
// Idempotent; safe to run before every node step (CI jobs do).
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const targets = process.argv.slice(2).map((arg) => resolve(arg));
if (targets.length === 0) {
  console.error("usage: node relink-bins.mjs <node_modules-dir> [...]");
  process.exit(2);
}

/** Collect every directory under root that directly holds a package.json. */
function packageDirs(root, depth = 0, out = [], seen = new Set()) {
  if (depth > 4 || seen.has(root) || !existsSync(root)) return out;
  seen.add(root);
  let entries;
  try {
    entries = readdirSync(root);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry === ".bin" || entry === ".cache") continue;
    const full = join(root, entry);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (!st.isDirectory()) continue;
    if (entry === "node_modules") {
      packageDirs(full, depth + 1, out, seen);
      continue;
    }
    if (existsSync(join(full, "package.json"))) {
      out.push(full);
      packageDirs(join(full, "node_modules"), depth + 1, out, seen);
    }
  }
  return out;
}

/** Parse a target script's shebang into an interpreter argv prefix. */
function interpreterOf(scriptPath) {
  // Bin entry points are small shims; a full read for the shebang is fine.
  const first = readFileSync(scriptPath, "utf8").split("\n")[0];
  if (!first.startsWith("#!")) return ["node"];
  const parts = first.slice(2).trim().split(/\s+/).filter(Boolean);
  // `#!/usr/bin/env node` -> ["node"]; `#!/bin/sh` -> ["/bin/sh"]
  if (parts[0].endsWith("env")) return parts.length > 1 ? parts.slice(1) : ["node"];
  return parts;
}

for (const nm of targets) {
  const binDir = join(nm, ".bin");
  let shims = 0;
  for (const pkgDir of packageDirs(nm)) {
    let manifest;
    try {
      manifest = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
    } catch {
      continue;
    }
    if (!manifest.bin) continue;
    const bins =
      typeof manifest.bin === "string"
        ? { [String(manifest.name).split("/").pop()]: manifest.bin }
        : manifest.bin;
    for (const [name, rel] of Object.entries(bins)) {
      const script = resolve(pkgDir, rel);
      if (!existsSync(script)) continue;
      mkdirSync(binDir, { recursive: true });
      const shimPath = join(binDir, name);
      rmSync(shimPath, { force: true }); // symlink or stale file — replace both
      const [cmd, ...args] = interpreterOf(script);
      const argPrefix = args.map((a) => JSON.stringify(a)).join(" ");
      writeFileSync(
        shimPath,
        `#!/bin/sh\nexec ${JSON.stringify(cmd)} ${argPrefix}${JSON.stringify(script)} "$@"\n`,
      );
      chmodSync(shimPath, 0o755);
      shims += 1;
    }
  }
  console.log(`relink-bins: ${shims} shims written under ${binDir}`);
  if (shims === 0) {
    console.error(`relink-bins: no bin entries found under ${nm} — wrong path?`);
    process.exit(1);
  }
}
