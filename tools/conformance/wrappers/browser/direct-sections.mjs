#!/usr/bin/env node
// Direct DcpWasm method calls in a real browser, apart from the kit catalogs (MP-03 P2): the sections below build one
// internal request (dcp-ai-browser-direct/1, not a kit contract) from existing fixtures, run it through
// wasm-browser.mjs (which forwards the browser options), and judge the page's raw observations here, in Node. The
// page never sees an expectation.
//
//   node tools/conformance/wrappers/browser/direct-sections.mjs --report <file.json> [wasm-browser.mjs options...]
//
// Sections (API, cases, source of the expectation):
//   domain_separation   DcpWasm.domainSeparatedMessage  20  interop_vectors.json#domain_separation_all_contexts (19)
//                                                           and mandate_acknowledgment_vectors.json#domain_separation (1)
//   security_tier       DcpWasm.computeSecurityTier     79  interop_vectors.json#security_tier.cases
//   ped1_classical_only DcpWasm.compositeVerify          2  ed25519_ped1_vectors.json#composite (frozen), binding
//                                                           classical_only: the corpus's real Ed25519 signature over the
//                                                           exact preimage; no PQ component, nothing simulated
//   hybrid_roundtrip    generateHybridKeypair ->         2  scenarios (Intent and MandateAcknowledgment contexts), each a
//                       compositeSign -> compositeVerify    signed positive and four negatives (payload, context, a
//                                                           classical bit, a PQ bit): real Ed25519 + ML-DSA-65 keys
//                                                           generated in the page and never posted
// Contract /5 does not credit computeSecurityTier: it reads the mode and tier verifyBundle reports. No KEM, SLH-DSA or
// experimental method is called. Exit 0: every section passes; 1: a case fails; 3: the browser run failed (no answer).
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..", "..", "..");
const WRAPPER = path.join(HERE, "..", "wasm-browser.mjs");
const FIXTURES = {
  interop: "tests/interop/v2/interop_vectors.json",
  ack: "tests/interop/v2/mandate_acknowledgment_vectors.json",
  ped1: "tests/interop/v2/ed25519_ped1_vectors.json",
};
const PED1_FROZEN = "f5990f8fcc8709c2c3b52e775c8210f0dcb32219c3e7cd36c527e44f49d1e396";

const args = process.argv.slice(2);
const at = args.indexOf("--report");
if (at === -1 || !args[at + 1]) {
  process.stderr.write("usage: direct-sections.mjs --report <file.json> [wasm-browser.mjs options...]\n");
  process.exit(2);
}
const reportPath = path.resolve(args[at + 1]);
const passthrough = [...args.slice(0, at), ...args.slice(at + 2)];

const raw = Object.fromEntries(Object.entries(FIXTURES).map(([k, f]) => [k, fs.readFileSync(path.join(REPO, f))]));
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");
if (sha(raw.ped1) !== PED1_FROZEN) {
  process.stderr.write("the P-ED-1 corpus is not the frozen one\n");
  process.exit(3);
}
const interop = JSON.parse(raw.interop);
const ack = JSON.parse(raw.ack).domain_separation;
const ped1 = JSON.parse(raw.ped1).composite;
const hexOf = (s) => Buffer.from(s, "utf8").toString("hex");
const b64 = (hex) => Buffer.from(hex, "hex").toString("base64");

// ── The cases and, kept here, their expectations ──
const cases = [];
const expect = new Map();
const add = (section, c, want) => {
  const id = `${section}/${cases.length}`;
  cases.push({ id, ...c });
  expect.set(id, { section, ...want });
};
const ds = interop.domain_separation_all_contexts;
for (const [name, dsm] of Object.entries(ds.dsm_hex)) {
  add("domain_separation", { call: "domainSeparatedMessage", context: `DCP-AI.v2.${name}`, payload_hex: hexOf(ds.payload_canonical) }, { value: dsm, label: name });
}
add("domain_separation", { call: "domainSeparatedMessage", context: ack.context, payload_hex: hexOf(ack.payload_canonical) }, { value: ack.dsm_hex, label: ack.context });
for (const t of interop.security_tier.cases) {
  const c = { call: "computeSecurityTier", intent: t.intent };
  if (Object.hasOwn(t, "policy_decision")) c.policy_decision = t.policy_decision;
  add("security_tier", c, { value: t.expected, label: t.name });
}
for (const p of ped1.cases) {
  add("ped1_classical_only", {
    call: "compositeVerify",
    context: ped1.context,
    payload_b64: Buffer.from(ped1.payload_canonical, "utf8").toString("base64"),
    composite_sig: { classical: { alg: "ed25519", kid: "ped1-corpus", sig_b64: b64(p.signature_hex) }, pq: null, binding: "classical_only" },
    classical_public_key_b64: b64(p.public_key_hex),
    pq_public_key_b64: null,
  }, { accept: p.accept, label: p.id });
}
for (const [context, other] of [["DCP-AI.v2.Intent", "DCP-AI.v2.PolicyDecision"], ["DCP-AI.v2.MandateAcknowledgment", "DCP-AI.v2.Delegation"]]) {
  add("hybrid_roundtrip", { call: "hybridRoundtrip", context, other_context: other, payload: { action: "read", resource: "doc-1", n: 1 }, altered_payload: { action: "read", resource: "doc-1", n: 2 } }, { label: context });
}

// ── Run ──
const request = { contract: "dcp-ai-browser-direct/1", run_id: crypto.randomUUID(), nonce: crypto.randomBytes(16).toString("hex"), cases };
const run = spawnSync(process.execPath, [WRAPPER, ...passthrough], { input: JSON.stringify(request), maxBuffer: 16 * 1024 * 1024, timeout: 3_700_000 });
const report = {
  schema: "dcp-ai-browser-direct-report/1",
  run_id: request.run_id,
  fixtures_sha256: Object.fromEntries(Object.entries(raw).map(([k, b]) => [FIXTURES[k], sha(b)])),
  wrapper: { argv: passthrough, exit: run.status, signal: run.signal, stderr: String(run.stderr ?? "").slice(0, 4000) },
  implementation: null,
  status: "error",
  sections: {},
  cases: [],
};
const finish = (code) => {
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");
  const lines = Object.entries(report.sections).map(([s, v]) => `${s} (${v.api}): ${v.pass}/${v.cases}${v.fail ? `, ${v.fail} failed` : ""}`);
  process.stdout.write(`${report.status.toUpperCase()}${lines.length ? `\n${lines.join("\n")}` : ""}\n`);
  process.exit(code);
};
let response;
try { response = JSON.parse(run.stdout.toString("utf8")); } catch { response = null; }
if (run.status !== 0 || !response || response.run_id !== request.run_id || response.nonce !== request.nonce || response.contract !== request.contract || !Array.isArray(response.results)) {
  finish(3);
}
report.implementation = response.implementation;

// ── Judgement: only a returned value equal to the fixture's passes; a throw or a missing answer never does ──
const API = {
  domain_separation: "DcpWasm.domainSeparatedMessage",
  security_tier: "DcpWasm.computeSecurityTier",
  ped1_classical_only: "DcpWasm.compositeVerify (classical_only)",
  hybrid_roundtrip: "DcpWasm.generateHybridKeypair, compositeSign, compositeVerify",
};
// Equal values whatever the order of their keys (the binding's JSON sorts them; an expectation here may not).
const sorted = (v) => (Array.isArray(v) ? v.map(sorted) : v !== null && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sorted(v[k])])) : v);
const same = (a, b) => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));
const isVerdict = (o, valid, classical, pq) => o?.kind === "return" && same(o.value, { valid, classical_valid: classical, pq_valid: pq });
const byId = new Map();
for (const r of response.results) {
  if (byId.has(r?.id)) byId.set(r.id, "duplicate");
  else byId.set(r?.id, r);
}
const dsmSeen = new Set();
for (const [id, want] of expect) {
  const r = byId.get(id);
  let pass = false;
  let why = null;
  const o = r?.observed;
  if (r === undefined) why = "missing";
  else if (r === "duplicate") why = "duplicate";
  else if (want.section === "domain_separation") {
    pass = o?.kind === "return" && o.value === want.value;
    if (pass && dsmSeen.has(o.value)) { pass = false; why = "a DSM equal to another context's"; }
    dsmSeen.add(o?.value);
  } else if (want.section === "security_tier") {
    pass = o?.kind === "return" && same(Object.keys(o.value ?? {}).sort(), ["checkpoint_interval", "tier", "verification_mode"]) &&
      same([o.value.tier, o.value.verification_mode, o.value.checkpoint_interval], [want.value.tier, want.value.verification_mode, want.value.checkpoint_interval]);
  } else if (want.section === "ped1_classical_only") {
    // The complete result: valid and classical_valid are the corpus's accept. Under classical_only there is no PQ
    // component, so DcpWasm's CompositeVerifyResult (pq_valid typed boolean) must say false: nothing PQ was verified.
    // This pins DcpWasm; the kit's /2 leaves pq_valid uncommitted for classical_only, where other SDKs may give null.
    pass = isVerdict(o, want.accept, want.accept, false);
  } else {
    const v = o?.value;
    pass = o?.kind === "return" && v.binding === "pq_over_classical" && same(v.algs, ["ed25519", "ml-dsa-65"]) && v.kids_are_the_pair === true &&
      isVerdict(v.signed, true, true, true) &&
      isVerdict(v.payload_altered, false, false, false) &&
      isVerdict(v.context_altered, false, false, false) &&
      // spec/DCP-AI-v2.0.md § 5: under pq_over_classical the PQ signature covers the classical signature's bytes, so a
      // changed classical signature also fails the PQ component.
      isVerdict(v.classical_signature_altered, false, false, false) &&
      isVerdict(v.pq_signature_altered, false, true, false);
  }
  if (!pass && !why) why = "observed differs from the fixture";
  report.cases.push({ id, section: want.section, label: want.label, pass, why, observed: o ?? null });
  const s = (report.sections[want.section] ??= { api: API[want.section], cases: 0, pass: 0, fail: 0 });
  s.cases += 1;
  if (pass) s.pass += 1;
  else s.fail += 1;
}
const extra = [...byId.keys()].filter((id) => !expect.has(id));
if (extra.length) report.extra_results = extra;
report.status = report.cases.every((c) => c.pass) && extra.length === 0 ? "pass" : "fail";
finish(report.status === "pass" ? 0 : 1);
