// Tests of the four SDK wrappers on the opt-in admission catalog (contract dcp-ai-conformance-external/3), through
// their real SDKs: the 140 cases, malformed requests, the request's clock, untyped or unexpected failures (injected
// with DCP_CONFORMANCE_WRAPPER_FAULT, which can only turn an answer into an error), an implementation that cannot load,
// and an implementation that takes trust from the bundle. The judge itself is tested in external-admission.test.mjs.
//
//   DCP_EXTERNAL_PYTHON=/path/to/python DCP_EXTERNAL_REQUIRE_PYTHON=1 DCP_EXTERNAL_REQUIRE_NATIVE=1 \
//     node --test tools/conformance/external-admission-wrappers.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";
import { fileURLToPath, pathToFileURL } from "url";
import { ARTIFACTS } from "./wrappers/build.mjs";
import { loadAdmissionPlan } from "./external-admission.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");
const CLI = path.join(REPO, "tools", "conformance-external.js");
const TS_SDK = path.join(REPO, "sdks", "typescript", "dist", "index.js");
const TS_WRAPPER = path.join(HERE, "wrappers", "ts-sdk.mjs");
const PY_WRAPPER = path.join(HERE, "wrappers", "python_sdk.py");
const PYTHON = process.env.DCP_EXTERNAL_PYTHON;
const REQUIRE_PY = process.env.DCP_EXTERNAL_REQUIRE_PYTHON === "1";
const REQUIRE_NATIVE = process.env.DCP_EXTERNAL_REQUIRE_NATIVE === "1";
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "dcp-admission-wrappers-"));
process.on("exit", () => fs.rmSync(TMP, { recursive: true, force: true }));

// The fault each wrapper can inject: TS and Python raise an untyped error carrying a configuration code, Go both an
// untyped error and a panic, Rust only a panic (its loaders and combined function return a typed error and nothing else).
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
  const r = spawnSync(process.execPath, [CLI, "--report", report, "--catalog", "admission", ...args], { encoding: "utf8", env: { ...process.env, ...env }, timeout: 600000, maxBuffer: 1 << 26 });
  return { code: r.status, report: JSON.parse(fs.readFileSync(report, "utf8")), stderr: r.stderr };
}
function call(argv, cases) {
  const r = spawnSync(argv[0], argv.slice(1), { input: JSON.stringify({ contract: "dcp-ai-conformance-external/3", run_id: "r", nonce: "n", cases }), timeout: 120000, maxBuffer: 1 << 26 });
  let json = null;
  try { json = JSON.parse(r.stdout.toString("utf8")); } catch { /* checked by the caller */ }
  return { code: r.status, json };
}
const cases = (report) => report.suites.flatMap((s) => s.cases);
const byId = (report) => new Map(cases(report).map((c) => [c.id, c]));

const PLAN = loadAdmissionPlan();
const OUT = "external.admission.outcomes.";
const planCase = (id) => PLAN.suites.flatMap((s) => s.cases).find((c) => c.id === id);
const A = planCase(OUT + "A_known_principal_strict");
const admitA = (over = {}) => ({ id: "c", op: "admit_signed_bundle_v2", ...A.request, ...over });

for (const [name, w] of Object.entries(WRAPPERS)) {
  test(`${name}: 140/140 admission cases through the real SDK`, (t) => {
    if (!available(t, w)) return;
    const r = run(["--", ...w.argv]);
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(r.report.totals, { cases: 140, executed: 140, pass: 140, fail: 0, error: 0 });
    assert.equal(r.report.kit.contract, "dcp-ai-conformance-external/3");
  });

  // What is measured: the wrapper hands the request's now to the SDK. The bundle's session runs from 10:00:00.000Z to
  // 10:05:00.000Z on 02/11/2026 with a 30 s skew, so only the middle instant admits; the system clock admits only
  // inside that window.
  test(`${name}: the clock is the request's now (not started, admitted, expired)`, (t) => {
    if (!available(t, w)) return;
    const r = call(w.argv, ["2026-11-02T09:59:29.999Z", "2026-11-02T10:01:00.000Z", "2026-11-02T10:05:00.001Z"].map((now, i) => admitA({ id: `c${i}`, now })));
    assert.equal(r.code, 0);
    assert.deepEqual(r.json.results.map((x) => x.admitted), [false, true, false]);
    assert.ok(r.json.results[0].codes.includes("PROFILE_SESSION_NOT_STARTED"));
    assert.ok(r.json.results[2].codes.includes("PROFILE_SESSION_EXPIRED"));
  });

  test(`${name}: malformed /3 requests exit 2`, (t) => {
    if (!available(t, w)) return;
    const { revocation, ...noRevocation } = admitA();
    for (const [label, c] of [
      ["a missing field", noRevocation],
      ["an unknown field", admitA({ extra: 1 })],
      ["bundle_b64 not canonical base64", admitA({ bundle_b64: A.request.bundle_b64.slice(0, -1) })],
      ["a bundle that is not JSON", admitA({ bundle_b64: Buffer.from("not json").toString("base64") })],
      ["now without a zone", admitA({ now: "2026-11-02T10:01:00.000" })],
      ["now as a number", admitA({ now: 1793613660000 })],
      // The /3 transport takes exactly YYYY-MM-DDTHH:mm:ss.sssZ, a real date in the years 0001-9999.
      ["now on 30 February", admitA({ now: "2026-02-30T10:01:00.000Z" })],
      ["now without milliseconds", admitA({ now: "2026-11-02T10:01:00Z" })],
      ["now with an offset", admitA({ now: "2026-11-02T10:01:00.000+00:00" })],
      ["now in year 0000", admitA({ now: "0000-01-01T00:00:00.000Z" })],
      ["a snapshot that is null", admitA({ revocation: { state: "snapshot", snapshot: null } })],
      ["a snapshot that is a list", admitA({ revocation: { state: "snapshot", snapshot: [] } })],
      ["a snapshot that is a number", admitA({ revocation: { state: "snapshot", snapshot: 1 } })],
      ["a profile that is an array", admitA({ profile: [] })],
      ["a trust set that is a string", admitA({ trust_set: "principal" })],
      ["a policy that is a number", admitA({ verifier_policy: 1 })],
      ["an unknown revocation state", admitA({ revocation: { state: "fresh" } })],
      ["a snapshot state without a snapshot", admitA({ revocation: { state: "snapshot" } })],
      ["a revocation without a profile", admitA({ profile: null, revocation: { state: "unavailable" } })],
      ["a profile without a revocation", admitA({ revocation: null })],
      ["an unknown configuration kind", { id: "c", op: "load_admission_config", kind: "policy", config: {} }],
      ["a configuration without config", { id: "c", op: "load_admission_config", kind: "profile" }],
    ]) {
      assert.equal(call(w.argv, [c]).code, 2, label);
    }
    assert.ok(revocation);
  });

  // A snapshot is an object, complete or not: an empty one reaches the SDK, which judges it (§4.3 R2). A real leap day
  // and year 0001 are well formed (exit 0) even though they are outside the bundle's session.
  test(`${name}: an empty snapshot object is the SDK's to judge (REVOCATION_INVALID); real dates are well formed`, (t) => {
    if (!available(t, w)) return;
    const r = call(w.argv, [
      admitA({ id: "empty", revocation: { state: "snapshot", snapshot: {} } }),
      admitA({ id: "leap", now: "2028-02-29T10:01:00.000Z" }),
      admitA({ id: "first", now: "0001-01-01T00:00:00.000Z" }),
    ]);
    assert.equal(r.code, 0);
    const [empty, leap, first] = r.json.results;
    assert.equal(empty.status, "ok");
    assert.equal(empty.admitted, false);
    assert.ok(empty.codes.includes("REVOCATION_INVALID"));
    assert.deepEqual([leap.status, leap.admitted, first.status, first.admitted], ["ok", false, "ok", false]);
  });

  for (const [fault, kind] of Object.entries(w.faults)) {
    test(`${name}: an injected ${fault} failure is an error, never a rejection or a pass`, (t) => {
      if (!available(t, w)) return;
      const r = run(["--suite", "external.admission.config", "--", ...w.argv], { DCP_CONFORMANCE_WRAPPER_FAULT: fault });
      assert.equal(r.code, 3);
      assert.equal(r.report.totals.pass, 0);
      assert.ok(cases(r.report).every((c) => c.status === "error" && c.kind === kind), `every case is error/${kind}`);
    });
  }
}

// ── An implementation that cannot load never passes ────────────

test("python: without its site-packages (dcp_ai cannot be imported) every case is an error", (t) => {
  if (!available(t, WRAPPERS.python)) return;
  const r = run(["--", PYTHON, "-I", "-S", PY_WRAPPER]);
  assert.equal(r.code, 3);
  assert.ok(cases(r.report).every((c) => c.status === "error"));
});

for (const name of ["go", "rust"]) {
  test(`${name}: a missing wrapper binary is an error for every case`, () => {
    const r = run(["--", path.join(TMP, `no-such-${name}-wrapper`)]);
    assert.equal(r.code, 3);
    assert.ok(cases(r.report).every((c) => c.status === "error" && c.kind === "spawn"));
  });
}

// ── WASM: no admission API, no emulation ───────────────────────

test("wasm: the WASM wrapper refuses contract /3 (exit 2) and the runner never passes it", (t) => {
  if (!available(t, WASM)) return;
  assert.equal(call(WASM.argv, [admitA()]).code, 2);
  const r = run(["--", ...WASM.argv]);
  assert.equal(r.code, 3);
  assert.ok(cases(r.report).every((c) => c.status === "error"));
});

// ── A trust bypass through the real TypeScript SDK is detected ──

// What is measured: the catalog's sensitivity to an implementation that replaces the operator's trust set with the
// keys the bundle lists for itself (§2.2 forbids deriving trust from the bundle), with every other answer from the
// real SDK. It is shown once, through the TypeScript wrapper.
test("ts: an SDK that takes trust from the bundle fails the cases where the principal must not be trusted", (t) => {
  if (!available(t, WRAPPERS.ts)) return;
  const shim = path.join(TMP, "trust-from-bundle.mjs");
  const real = pathToFileURL(TS_SDK).href;
  fs.writeFileSync(shim, `export * from ${JSON.stringify(real)};
import * as real from ${JSON.stringify(real)};
export async function admitSignedBundleV2(signed, registry, options = {}) {
  if (options.trust) {
    const rpr = signed.bundle.responsible_principal_record.payload;
    const keys = rpr.binding_keys.map((k) => ({ kid: k.kid, alg: k.alg, public_key_b64: k.public_key_b64, status: "active" }));
    options = { ...options, trust: { trust_set_version: options.trust.trust_set_version, principals: [{ human_id: rpr.human_id, keys }] } };
  }
  return real.admitSignedBundleV2(signed, registry, options);
}
`);
  const r = run(["--", process.execPath, TS_WRAPPER, "--sdk", shim]);
  assert.notEqual(r.code, 0);
  const ids = byId(r.report);
  for (const x of ["2_attacker_uses_known_human_id", "3_classical_key_substituted", "4_pq_key_substituted", "1_unknown_principal_strict", "6_key_revoked_in_trust_set", "C_new_key_not_yet_in_trust_set"]) {
    assert.notEqual(ids.get(OUT + x).status, "pass", x);
  }
  assert.equal(ids.get(OUT + "A_known_principal_strict").status, "pass", "the bundle's own keys are the principal's: the positive still passes");
});
