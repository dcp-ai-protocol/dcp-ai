#!/usr/bin/env node
// Performance child for the WASM build of the Rust SDK (dcp-ai-perf/1), from this checkout, in its own output folder
// (tools/conformance/wrappers/.build/perf-wasm-pkg, built by tools/conformance-perf.js). The Rust crates compiled into
// the .wasm are those of sdks/rust/Cargo.lock, recorded in the build record. Timed per call, all public-boundary
// costs included: UTF-8 decode of the input bytes, wasm_verify_signed_bundle_v2(text, policyJson) (which copies the
// string into WASM memory, parses the bundle and the policy, and serializes its result), with Date.now replaced by
// the verification instant around the call because the export reads the host clock, and JSON.parse of its result.
import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { measure, readRequest, refuse, respond } from "./child.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..", "..");
const PKG = process.argv[2] === "--pkg" && process.argv.length === 4 ? path.resolve(process.argv[3]) : path.join(REPO, "tools", "conformance", "wrappers", ".build", "perf-wasm-pkg");

const req = readRequest();
const glue = path.join(PKG, "dcp_ai.js");
const wasmFile = path.join(PKG, "dcp_ai_bg.wasm");
if (!fs.existsSync(glue) || !fs.existsSync(wasmFile)) refuse(`no WASM build at ${PKG}`);
const mod = await import(pathToFileURL(glue).href);
await mod.default({ module_or_path: fs.readFileSync(wasmFile) });
const decoder = new TextDecoder("utf-8", { fatal: true });
const policyJson = JSON.stringify(req.policy);
const realNow = Date.now;
const at = () => req.now;

const body = await measure(req, (bytes) => {
  const text = decoder.decode(bytes);
  Date.now = at;
  let out;
  try { out = mod.wasm_verify_signed_bundle_v2(text, policyJson); } finally { Date.now = realNow; }
  return JSON.parse(out);
});

respond(req, {
  sdk: "wasm", entrypoint: "wasm_verify_signed_bundle_v2", source: "checkout", clock: "process.hrtime.bigint", unit: "ns",
  runtime: { node: process.version, v8: process.versions.v8, platform: process.platform, arch: process.arch, host_clock: "Date.now replaced by verification_time during each call" },
  loaded: { glue: path.relative(REPO, glue), wasm: path.relative(REPO, wasmFile), crates: "sdks/rust/Cargo.lock (see the build record)" },
}, body);
