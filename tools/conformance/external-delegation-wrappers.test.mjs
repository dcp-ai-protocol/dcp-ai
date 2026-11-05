// Tests of the four SDK wrappers on the opt-in delegation catalog (contract dcp-ai-conformance-external/4), through
// their real SDKs: the 97 cases, the request's clock, malformed requests, injected failures (which can only turn an
// answer into an error), the WASM refusal, and two altered TypeScript SDKs the catalog must catch. The judge itself is
// tested in external-delegation.test.mjs, with synthetic answers built from the corpus.
//
//   DCP_EXTERNAL_PYTHON=/path/to/python DCP_EXTERNAL_REQUIRE_PYTHON=1 DCP_EXTERNAL_REQUIRE_NATIVE=1 \
//     node --test tools/conformance/external-delegation-wrappers.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { spawn, spawnSync } from "child_process";
import { fileURLToPath, pathToFileURL } from "url";
import { ARTIFACTS } from "./wrappers/build.mjs";
import { loadDelegationPlan, DELEGATION_CONTRACT } from "./external-delegation.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");
const CLI = path.join(REPO, "tools", "conformance-external.js");
const TS_SDK = path.join(REPO, "sdks", "typescript", "dist", "index.js");
const TS_WRAPPER = path.join(HERE, "wrappers", "ts-sdk.mjs");
const PY_WRAPPER = path.join(HERE, "wrappers", "python_sdk.py");
const PYTHON = process.env.DCP_EXTERNAL_PYTHON;
const REQUIRE_PY = process.env.DCP_EXTERNAL_REQUIRE_PYTHON === "1";
const REQUIRE_NATIVE = process.env.DCP_EXTERNAL_REQUIRE_NATIVE === "1";
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "dcp-delegation-wrappers-"));
process.on("exit", () => fs.rmSync(TMP, { recursive: true, force: true }));

// The faults each wrapper can inject: TS and Python raise an error, Go an error or a panic, Rust a panic.
const WRAPPERS = {
  ts: { argv: [process.execPath, TS_WRAPPER, "--sdk", TS_SDK], ready: () => fs.existsSync(TS_SDK), why: "sdks/typescript/dist is not built", required: true, faults: { untyped: "implementation" } },
  python: { argv: PYTHON ? [PYTHON, "-I", PY_WRAPPER] : null, ready: () => Boolean(PYTHON), why: "DCP_EXTERNAL_PYTHON is not set", required: REQUIRE_PY, faults: { untyped: "implementation" } },
  go: { argv: [ARTIFACTS.go], ready: () => fs.existsSync(ARTIFACTS.go), why: "the Go wrapper is not built", required: REQUIRE_NATIVE, faults: { untyped: "implementation", panic: "process" } },
  rust: { argv: [ARTIFACTS.rust], ready: () => fs.existsSync(ARTIFACTS.rust), why: "the Rust wrapper is not built", required: REQUIRE_NATIVE, faults: { panic: "process" } },
};
const WASM = { argv: [process.execPath, path.join(HERE, "wrappers", "wasm.mjs")], ready: () => fs.existsSync(path.join(ARTIFACTS.wasm, "dcp_ai_bg.wasm")), why: "the WASM build is missing", required: REQUIRE_NATIVE };
function available(t, w) {
  if (w.ready()) return true;
  if (w.required) assert.fail(`${w.why} (required)`);
  t.skip(`${w.why}: NOT run`);
  return false;
}

let n = 0;
function run(args, env = {}) {
  const report = path.join(TMP, `report-${++n}.json`);
  const r = spawnSync(process.execPath, [CLI, "--report", report, "--catalog", "delegation", ...args], { encoding: "utf8", env: { ...process.env, ...env }, timeout: 600000, maxBuffer: 1 << 26 });
  return { code: r.status, report: JSON.parse(fs.readFileSync(report, "utf8")), stderr: r.stderr };
}
// One direct call of a wrapper, asynchronously: stdin is written and closed with end(), and an external deadline kills a
// process that does not finish. spawnSync with `input` sometimes left a native wrapper waiting for EOF on stdin until
// its timeout (seen with the Go and Rust wrappers on macOS); the runner itself always used an async pipe.
function call(argv, cases, env = {}) {
  return new Promise((resolve) => {
    const child = spawn(argv[0], argv.slice(1), { env: { ...process.env, ...env }, stdio: ["pipe", "pipe", "pipe"] });
    const out = [];
    const err = [];
    child.stdout.on("data", (d) => out.push(d));
    child.stderr.on("data", (d) => err.push(d));
    const deadline = setTimeout(() => child.kill("SIGKILL"), 120000);
    child.on("error", (e) => { clearTimeout(deadline); resolve({ code: null, json: null, why: `spawn error ${e.code}` }); });
    child.on("close", (code, signal) => {
      clearTimeout(deadline);
      let json = null;
      try { json = JSON.parse(Buffer.concat(out).toString("utf8")); } catch { /* checked by the caller */ }
      resolve({ code, json, why: `exit ${code}, signal ${signal}, stderr ${Buffer.concat(err).toString("utf8").slice(0, 200)}` });
    });
    child.stdin.on("error", () => { /* EPIPE: the wrapper stopped reading; its exit code decides */ });
    child.stdin.end(JSON.stringify({ contract: DELEGATION_CONTRACT, run_id: "r", nonce: "n", cases }));
  });
}
const cases = (report) => report.suites.flatMap((s) => s.cases);

const PLAN = loadDelegationPlan();
const planCase = (id) => PLAN.suites.flatMap((s) => s.cases).find((c) => c.id === id);
const DEPTH_1 = planCase("external.delegation.chain.depth_1");
const chainCase = (over = {}) => ({ id: "c", op: "verify_mandate_chain", ...DEPTH_1.request, ...over });
// The window every mandate of depth_1 shares, read from the chain: before it, inside it (the corpus time), after it.
const chain = JSON.parse(Buffer.from(DEPTH_1.request.chain_b64, "base64").toString("utf8"));
const from = Math.max(...chain.map((m) => Date.parse(m.valid_from)));
const until = Math.min(...chain.map((m) => Date.parse(m.valid_until)));
const BEFORE = new Date(from - 1).toISOString();
const AFTER = new Date(until + 1).toISOString();
const b64 = (s) => Buffer.from(s, "utf8").toString("base64");

for (const [name, w] of Object.entries(WRAPPERS)) {
  test(`${name}: 87/87 normative delegation cases through the real SDK, the 10 informative agree`, (t) => {
    if (!available(t, w)) return;
    const r = run(["--", ...w.argv]);
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(r.report.totals, { cases: 87, executed: 87, pass: 87, fail: 0, error: 0 });
    assert.deepEqual(r.report.informative_totals, { requested: 10, completed: 10, agrees: 10, differs: 0, error: 0 });
    assert.equal(r.report.kit.contract, DELEGATION_CONTRACT);
  });

  // What is measured: the wrapper hands the request's verification_time to the SDK. One chain at three explicit
  // instants must give rejected, accepted, rejected; a clock that ignored them, whatever its instant, gives one verdict.
  test(`${name}: the clock is the request's verification_time (before, inside and after the window)`, async (t) => {
    if (!available(t, w)) return;
    const r = await call(w.argv, [chainCase({ id: "before", verification_time: BEFORE }), chainCase({ id: "inside" }), chainCase({ id: "after", verification_time: AFTER })]);
    assert.equal(r.code, 0, r.why);
    assert.deepEqual(r.json.results.map((x) => [x.id, x.status, x.valid]), [["before", "ok", false], ["inside", "ok", true], ["after", "ok", false]]);
  });

  test(`${name}: a malformed request exits with 2 before the SDK is called`, async (t) => {
    if (!available(t, w)) return;
    const { verification_time: _t, ...missing } = chainCase();
    for (const [what, c] of [
      ["a missing field", missing],
      ["an extra field", { ...chainCase(), extra: 1 }],
      ["base64 that is not canonical", chainCase({ chain_b64: DEPTH_1.request.chain_b64.replace(/=*$/, "") })],
      ["a chain that is not an array", chainCase({ chain_b64: b64("{}") })],
      ["keys that are not an object", chainCase({ keys_b64: b64("[]") })],
      ["a chain that is not JSON", chainCase({ chain_b64: b64("[") })],
      ["a revoked id that is not a string", chainCase({ revoked_mandate_ids: [1] })],
      ["a revoked id that is null", chainCase({ revoked_mandate_ids: [null] })],
      ["a time without an offset", chainCase({ verification_time: "2026-10-22T12:00:00" })],
      ["a time that is not a time", chainCase({ verification_time: "now" })],
    ]) {
      const r = await call(w.argv, [c]);
      assert.equal(r.code, 2, `${what}: ${r.why}`);
    }
  });

  test(`${name}: an injected failure is an error, never a verdict`, (t) => {
    if (!available(t, w)) return;
    for (const [fault, kind] of Object.entries(w.faults)) {
      const r = run(["--suite", "external.delegation.domains", "--", ...w.argv], { DCP_CONFORMANCE_WRAPPER_FAULT: fault });
      assert.equal(r.code, 3, fault);
      assert.equal(r.report.totals.pass, 0, fault);
      if (kind === "implementation") assert.ok(cases(r.report).every((c) => c.status === "error" && (c.kind === "implementation" || c.kind === "control_failed")), fault);
      else assert.ok(cases(r.report).every((c) => c.status === "error" && c.kind === "process"), fault);
    }
  });
}

test("an implementation that cannot start is an error for every case", () => {
  const r = run(["--", path.join(TMP, "no-such-wrapper")]);
  assert.equal(r.code, 3);
  assert.ok(cases(r.report).every((c) => c.status === "error" && c.kind === "spawn"));
});

// ── WASM: no delegation API, no emulation ───────────────────────────

test("wasm: the WASM wrapper refuses contract /4 (exit 2) and the runner never passes it", async (t) => {
  if (!available(t, WASM)) return;
  assert.equal((await call(WASM.argv, [chainCase()])).code, 2);
  const r = run(["--", ...WASM.argv]);
  assert.equal(r.code, 3);
  assert.ok(cases(r.report).every((c) => c.status === "error"));
});

// ── Altered SDKs are caught through the real TypeScript SDK ─────────

// What is measured: the catalog's sensitivity to an implementation that ignores the revoked ids, or verifies at a
// clock of its own instead of the verification time, with every other answer from the real SDK.
test("ts: an SDK that ignores revocation, or uses a clock of its own, fails exactly the cases that show it", (t) => {
  if (!available(t, WRAPPERS.ts)) return;
  const real = pathToFileURL(TS_SDK).href;
  const shim = (file, body) => {
    const p = path.join(TMP, file);
    fs.writeFileSync(p, `export * from ${JSON.stringify(real)};\nimport * as real from ${JSON.stringify(real)};\n${body}\n`);
    return p;
  };
  const failing = (sdk) => {
    const r = run(["--", process.execPath, TS_WRAPPER, "--sdk", sdk]);
    assert.notEqual(r.code, 0);
    return cases(r.report).filter((c) => c.status === "fail").map((c) => c.id).sort();
  };
  const noRevocation = shim("no-revocation.mjs", "export const verifyMandateChain = (registry, chain, _revoked, keys, now) => real.verifyMandateChain(registry, chain, new Set(), keys, now);");
  assert.deepEqual(failing(noRevocation), ["external.delegation.chain.revoked_intermediate", "external.delegation.chain.revoked_root"]);
  // A clock of its own: the shim ignores the request's time and verifies at a fixed, wrong instant (not the real
  // calendar), so the cases it fails are the same on any day.
  const ownClock = shim("own-clock.mjs", `export const verifyMandateChain = (registry, chain, revoked, keys) => real.verifyMandateChain(registry, chain, revoked, keys, Date.parse("2026-11-05T12:00:00Z"));`);
  assert.deepEqual(failing(ownClock), [
    "external.delegation.chain.expired_at_verification_time",
    "external.delegation.chain.not_yet_valid_at_verification_time",
    "external.delegation.chain_time.every_signer_key_expires_at_the_verification_time",
    "external.delegation.chain_time.sub_not_yet_valid_by_one_millisecond",
  ]);
});
