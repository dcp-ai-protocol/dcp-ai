// Shared part of the JavaScript performance children (contract dcp-ai-perf/1, tools/conformance/perf.js): reads and
// checks one request on stdin, runs the warmup and the timed samples round-robin over the workloads, checks every
// result, and writes one response: status "ok" with every sample, or "check_failed" with no timing at all.
// A malformed request exits 2; nothing here generates keys, signs or caches a verification.
import crypto from "crypto";
import fs from "fs";
import { decodeBase64Strict, utf8 } from "../external.js";

export const CONTRACT = "dcp-ai-perf/1";
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const keysAre = (o, keys) => isObj(o) && Object.keys(o).length === keys.length && keys.every((k) => k in o);

export function refuse(message) {
  process.stderr.write(`perf child: ${message}\n`);
  process.exit(2);
}

/** The request, checked: every workload's bytes match its input_sha256. */
export function readRequest() {
  let req;
  try { req = JSON.parse(utf8(fs.readFileSync(0))); } catch (e) { refuse(`the request is not UTF-8 JSON (${e.message})`); }
  if (!keysAre(req, ["contract", "run_id", "nonce", "verification_time", "policy", "warmup", "samples", "workloads"]) || req.contract !== CONTRACT) {
    refuse(`the request must be exactly a ${CONTRACT} request`);
  }
  const count = (n) => Number.isSafeInteger(n) && n >= 1;
  if (typeof req.run_id !== "string" || typeof req.nonce !== "string" || !isObj(req.policy) || !count(req.warmup) || !count(req.samples)) {
    refuse("run_id, nonce, policy, warmup and samples have the wrong types");
  }
  const now = typeof req.verification_time === "string" && /Z$|[+-]\d{2}:\d{2}$/.test(req.verification_time) ? Date.parse(req.verification_time) : NaN;
  if (!Number.isFinite(now)) refuse("verification_time is not an RFC 3339 instant");
  if (!Array.isArray(req.workloads) || req.workloads.length === 0) refuse("workloads must be a non-empty array");
  const ids = new Set();
  const workloads = req.workloads.map((w) => {
    if (!keysAre(w, ["id", "input_b64", "input_sha256", "expect"]) || typeof w.id !== "string" || ids.has(w.id)
        || !keysAre(w.expect, ["verified"]) || typeof w.expect.verified !== "boolean") refuse("a workload has the wrong shape");
    ids.add(w.id);
    const bytes = decodeBase64Strict(w.input_b64);
    if (!bytes || crypto.createHash("sha256").update(bytes).digest("hex") !== w.input_sha256) refuse(`workload ${w.id}: input_b64 does not match input_sha256`);
    return { id: w.id, bytes, expect: w.expect.verified };
  });
  return { ...req, now, workloads };
}

/** Why a result is not the expected one, or null. */
function problem(expect, r) {
  if (typeof r.verified !== "boolean" || !Array.isArray(r.errors) || !r.errors.every((e) => typeof e === "string")) return "malformed_result";
  if (r.verified !== expect) return "verdict";
  if (r.verified && r.errors.length > 0) return "contradiction";
  if (!r.verified && r.errors.length === 0) return "no_errors";
  return null;
}

/**
 * Runs `verify(bytes)` (sync or async, returning {verified, errors}) W times then N times per workload, round-robin,
 * timing each call with process.hrtime.bigint(). Returns the response body after the envelope.
 */
export async function measure(req, verify) {
  const first = new Map();
  const samples = new Map(req.workloads.map((w) => [w.id, []]));
  for (const [phase, rounds] of [["warmup", req.warmup], ["sample", req.samples]]) {
    for (let index = 0; index < rounds; index++) {
      for (const w of req.workloads) {
        const t0 = process.hrtime.bigint();
        let r = verify(w.bytes);
        if (r instanceof Promise) r = await r;
        const t1 = process.hrtime.bigint();
        const why = problem(w.expect, r);
        if (why) {
          const errors = Array.isArray(r?.errors) ? r.errors.filter((e) => typeof e === "string") : [];
          return { status: "check_failed", failure: { id: w.id, phase, index, verified: r?.verified === true, errors, reason: why } };
        }
        if (!first.has(w.id)) first.set(w.id, r.errors.slice());
        if (phase === "sample") samples.get(w.id).push(Number(t1 - t0));
      }
    }
  }
  return {
    status: "ok",
    results: req.workloads.map((w) => ({
      id: w.id, verified: w.expect, errors_first: first.get(w.id), warmup_checked: req.warmup, checked: req.samples, samples_ns: samples.get(w.id),
    })),
  };
}

export function respond(req, implementation, body) {
  const { status, ...rest } = body;
  process.stdout.write(JSON.stringify({ contract: CONTRACT, run_id: req.run_id, nonce: req.nonce, status, implementation, ...rest }));
}
