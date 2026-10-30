#!/usr/bin/env node
// Performance child for the TypeScript SDK (dcp-ai-perf/1): the local build sdks/typescript/dist of this checkout,
// not a published package. Timed per call: UTF-8 decode and JSON.parse of the input bytes, then
// await verifySignedBundleV2(bundle, registry, policy, { now }). The registry and the policy are set up once.
// Provenance: every bare import of dist/index.js (read from the file itself) is resolved from dist as Node resolves
// it (module.findPackageJSON); the child reports the resolved package.json, its name, version and hash, and exits 3
// when one cannot be resolved rather than report it as loaded.
import crypto from "crypto";
import fs from "fs";
import { builtinModules, findPackageJSON } from "module";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { measure, readRequest, respond } from "./child.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..", "..");
const DIST = path.join(REPO, "sdks", "typescript", "dist", "index.js");

function resolvedImports() {
  const text = fs.readFileSync(DIST, "utf8");
  const specifiers = new Set([...text.matchAll(/^import\s[^;]*?from\s*["']([^"']+)["']|^import\s*["']([^"']+)["']/gm)].map((m) => m[1] ?? m[2]));
  const bare = [...specifiers].filter((s) => !s.startsWith(".") && !s.startsWith("node:") && !builtinModules.includes(s)).sort();
  return bare.map((specifier) => {
    let file;
    try { file = findPackageJSON(specifier, pathToFileURL(DIST).href); } catch (e) { file = undefined; process.stderr.write(`perf child: ${specifier}: ${e.message}\n`); }
    if (!file) {
      process.stderr.write(`perf child: cannot resolve ${specifier} from ${DIST}\n`);
      process.exit(3);
    }
    const raw = fs.readFileSync(file);
    const pkg = JSON.parse(raw);
    return { specifier, package_json: path.relative(REPO, file), name: pkg.name, version: pkg.version, sha256: crypto.createHash("sha256").update(raw).digest("hex") };
  });
}

const req = readRequest();
const imports = resolvedImports();
const sdk = await import(pathToFileURL(DIST).href);
const registry = new sdk.AlgorithmRegistry();
registry.registerSigner(new sdk.Ed25519Provider());
registry.registerSigner(new sdk.MlDsa65Provider());
const decoder = new TextDecoder("utf-8", { fatal: true });
const options = { now: req.now };

const body = await measure(req, (bytes) => sdk.verifySignedBundleV2(JSON.parse(decoder.decode(bytes)), registry, req.policy, options));

respond(req, {
  sdk: "ts", entrypoint: "verifySignedBundleV2", source: "checkout", clock: "process.hrtime.bigint", unit: "ns",
  runtime: { node: process.version, v8: process.versions.v8, platform: process.platform, arch: process.arch },
  loaded: { dist: path.relative(REPO, DIST), imports_resolved_from_dist: imports },
}, body);
