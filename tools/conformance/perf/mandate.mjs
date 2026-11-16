#!/usr/bin/env node
// Mandate chain child for the TypeScript SDK (contract dcp-ai-perf-mandate/1, tools/conformance/perf-scale.js): the
// local build sdks/typescript/dist of this checkout. Timed per call: UTF-8 decode and JSON.parse of the workload
// bytes, a {chain, keys} document, then await verifyMandateChain(registry, chain, revoked, keys, now) with no revoked
// mandate and the request's verification instant. The registry is set up once. The warmup, the timed samples and the
// check of every result are measure() of child.mjs, unchanged; the request and the response are this contract's.
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { decodeBase64Strict, utf8 } from "../external.js";
import { measure, refuse } from "./child.mjs";

export const CONTRACT = "dcp-ai-perf-mandate/1";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..", "..");
const DIST = path.join(REPO, "sdks", "typescript", "dist", "index.js");
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const keysAre = (o, keys) => isObj(o) && Object.keys(o).length === keys.length && keys.every((k) => k in o);

let req;
try { req = JSON.parse(utf8(fs.readFileSync(0))); } catch (e) { refuse(`the request is not UTF-8 JSON (${e.message})`); }
if (!keysAre(req, ["contract", "run_id", "nonce", "verification_time", "warmup", "samples", "workloads"]) || req.contract !== CONTRACT) {
  refuse(`the request must be exactly a ${CONTRACT} request`);
}
const count = (n) => Number.isSafeInteger(n) && n >= 1;
if (typeof req.run_id !== "string" || typeof req.nonce !== "string" || !count(req.warmup) || !count(req.samples)) refuse("run_id, nonce, warmup and samples have the wrong types");
const now = typeof req.verification_time === "string" && /Z$/.test(req.verification_time) ? Date.parse(req.verification_time) : NaN;
if (!Number.isFinite(now)) refuse("verification_time is not an RFC 3339 instant");
if (!Array.isArray(req.workloads) || req.workloads.length === 0) refuse("workloads must be a non-empty array");
const ids = new Set();
req.workloads = req.workloads.map((w) => {
  if (!keysAre(w, ["id", "input_b64", "input_sha256", "expect"]) || typeof w.id !== "string" || ids.has(w.id)
      || !keysAre(w.expect, ["verified"]) || typeof w.expect.verified !== "boolean") refuse("a workload has the wrong shape");
  ids.add(w.id);
  const bytes = decodeBase64Strict(w.input_b64);
  if (!bytes || crypto.createHash("sha256").update(bytes).digest("hex") !== w.input_sha256) refuse(`workload ${w.id}: input_b64 does not match input_sha256`);
  return { id: w.id, bytes, expect: w.expect.verified };
});

const sdk = await import(pathToFileURL(DIST).href);
const registry = new sdk.AlgorithmRegistry();
registry.registerSigner(new sdk.Ed25519Provider());
registry.registerSigner(new sdk.MlDsa65Provider());
const decoder = new TextDecoder("utf-8", { fatal: true });
const none = new Set();

const body = await measure(req, async (bytes) => {
  const doc = JSON.parse(decoder.decode(bytes));
  const r = await sdk.verifyMandateChain(registry, doc.chain, none, doc.keys, now);
  return { verified: r.valid, errors: r.errors };
});

const { status, ...rest } = body;
process.stdout.write(JSON.stringify({
  contract: CONTRACT, run_id: req.run_id, nonce: req.nonce, status,
  implementation: {
    sdk: "ts", entrypoint: "verifyMandateChain", source: "checkout", clock: "process.hrtime.bigint", unit: "ns",
    runtime: { node: process.version, v8: process.versions.v8, platform: process.platform, arch: process.arch },
    loaded: { dist: path.relative(REPO, DIST) },
  },
  ...rest,
}));
