// Self-tests of the Go, Rust and WASM conformance wrappers (tools/conformance/wrappers): the 38 cases
// through the runner, transport and type errors, rejection classification, the WASM export's in-band
// errors, fake SDKs that accept fractions or fail internally, and missing artifacts. The wrappers are
// built first with `node tools/conformance/wrappers/build.mjs all`; fakes are built in temporary
// directories (offline, from the dependency caches that build filled). No source file in the checkout is
// written; builds go only to the ignored tools/conformance/wrappers/.build directory.
//
//   node --test tools/conformance/external-native.test.mjs                 # skips, with a reason, what is not built
//   DCP_EXTERNAL_REQUIRE_NATIVE=1 node --test tools/conformance/external-native.test.mjs   # a missing artifact or tool fails
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";
import { fileURLToPath, pathToFileURL } from "url";
import { ARTIFACTS, BUILD } from "./wrappers/build.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");
const CLI = path.join(REPO, "tools", "conformance-external.js");
const WASM_WRAPPER = path.join(HERE, "wrappers", "wasm.mjs");
const REQUIRE = process.env.DCP_EXTERNAL_REQUIRE_NATIVE === "1";
const FRACTIONS = ["non_integer_float_rejected", "fractional_rejected", "scientific_fractional_rejected"].map((n) => `external.dcp-jcs-v1.canonicalize.edge.${n}`);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "dcp-native-"));
process.on("exit", () => fs.rmSync(TMP, { recursive: true, force: true }));

const WRAPPERS = {
  go: { argv: [ARTIFACTS.go], built: () => fs.existsSync(ARTIFACTS.go) },
  rust: { argv: [ARTIFACTS.rust], built: () => fs.existsSync(ARTIFACTS.rust) },
  wasm: { argv: [process.execPath, WASM_WRAPPER], built: () => fs.existsSync(path.join(ARTIFACTS.wasm, "dcp_ai_bg.wasm")) },
};

/** True when `ok`; otherwise fails under DCP_EXTERNAL_REQUIRE_NATIVE=1 and skips, with the reason, without it. */
function available(t, ok, why) {
  if (ok) return true;
  if (REQUIRE) assert.fail(`${why} (DCP_EXTERNAL_REQUIRE_NATIVE=1)`);
  t.skip(`${why}: NOT run`);
  return false;
}
const hasTool = (cmd, args = ["--version"]) => !spawnSync(cmd, args, { stdio: "ignore" }).error;

let n = 0;
function runner(argv, env = {}) {
  const report = path.join(TMP, `report-${++n}.json`);
  const r = spawnSync(process.execPath, [CLI, "--report", report, "--", ...argv], { encoding: "utf8", env: { ...process.env, ...env }, timeout: 120000 });
  return { code: r.status, report: JSON.parse(fs.readFileSync(report, "utf8")), stderr: r.stderr };
}
function call(argv, input, env = {}) {
  const r = spawnSync(argv[0], argv.slice(1), { input, env: { ...process.env, ...env }, timeout: 60000 });
  let json = null;
  try { json = JSON.parse(r.stdout.toString("utf8")); } catch { /* checked by the caller */ }
  return { code: r.status, json, stderr: r.stderr.toString("utf8") };
}
const CONTRACT = "dcp-ai-conformance-external/1";
const request = (cases) => JSON.stringify({ contract: CONTRACT, run_id: "r", nonce: "n", cases });
const b64 = (s) => Buffer.from(s).toString("base64");
const canon = (input, id = "c") => ({ id, op: "canonicalize", profile: "dcp-jcs-v1", input_b64: Buffer.isBuffer(input) ? input.toString("base64") : b64(input) });
const cases = (report) => report.suites.flatMap((s) => s.cases);

// ── The 38 cases ────────────────────────────────────────────────

for (const [name, w] of Object.entries(WRAPPERS)) {
  test(`${name}: 38/38 through the runner, with the provenance it loaded`, (t) => {
    if (!available(t, w.built(), `${name} wrapper is not built (node tools/conformance/wrappers/build.mjs ${name})`)) return;
    const r = runner(w.argv);
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(r.report.totals, { cases: 38, executed: 38, pass: 38, fail: 0, error: 0 });
    const who = r.report.implementation.self_declared;
    assert.ok(who.version && who.resolved_from && who.runtime, JSON.stringify(who));
    if (name === "wasm") assert.match(who.resolved_from, /dcp_ai_bg\.wasm \(sha256 [0-9a-f]{64}\)$/);
  });
}

// ── Transport and types: an invalid request is exit 2, never a result ──

const INVALID = [
  ["a request that is not UTF-8", Buffer.from([0x7b, 0xff, 0x7d])],
  ["a null request", "null"],
  ["an unknown top-level field", JSON.stringify({ contract: CONTRACT, run_id: "r", nonce: "n", cases: [], x: 1 })],
  ["another contract", JSON.stringify({ contract: "other/1", run_id: "r", nonce: "n", cases: [] })],
  ["a run_id that is not a string", JSON.stringify({ contract: CONTRACT, run_id: 5, nonce: "n", cases: [] })],
  ["cases null", JSON.stringify({ contract: CONTRACT, run_id: "r", nonce: "n", cases: null })],
  ["a case that is null", request([null])],
  ["a case without id", request([{ op: "digest", alg: "sha256", input_b64: "" }])],
  ["an op that is a number", request([{ id: "c", op: 5, input_b64: "" }])],
  ["input_b64 17", request([{ id: "c", op: "digest", alg: "sha256", input_b64: 17 }])],
  ["input_b64 null", request([{ id: "c", op: "digest", alg: "sha256", input_b64: null }])],
  ["alg null", request([{ id: "c", op: "digest", alg: null, input_b64: "" }])],
  ["profile as a number", request([{ id: "c", op: "canonicalize", profile: 1, input_b64: "" }])],
  ["base64 without padding", request([{ id: "c", op: "digest", alg: "sha256", input_b64: "YQ" }])],
  ["non-canonical base64 bits", request([{ id: "c", op: "digest", alg: "sha256", input_b64: "YR==" }])],
  ["base64 with a line break", request([{ id: "c", op: "digest", alg: "sha256", input_b64: "YWJj\n" }])],
  ["an unknown field in a case", request([{ id: "c", op: "digest", alg: "sha256", input_b64: "", x: 1 }])],
];
for (const [name, w] of Object.entries(WRAPPERS)) {
  test(`${name}: invalid requests and wrong types exit 2`, (t) => {
    if (!available(t, w.built(), `${name} wrapper is not built`)) return;
    for (const [label, input] of INVALID) {
      const r = call(w.argv, input);
      assert.equal(r.code, 2, `${label}: exit ${r.code}, stdout ${JSON.stringify(r.json)}`);
      assert.equal(r.json, null, label);
    }
  });
}

// ── Per-case results of the real APIs ───────────────────────────

const EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const EMPTY_SHA3 = "a7ffc6f8bf1ed76651c14756a061d662f580ff4de43b49fa82d80a4b80f8434a";
const OUTCOMES = [
  ["sha256 of zero bytes", { id: "c", op: "digest", alg: "sha256", input_b64: "" }, { status: "ok", hex: EMPTY_SHA256 }],
  ["sha3-256 of zero bytes", { id: "c", op: "digest", alg: "sha3-256", input_b64: "" }, { status: "ok", hex: EMPTY_SHA3 }],
  ["an unknown alg string", { id: "c", op: "digest", alg: "md5", input_b64: "" }, { status: "unsupported" }],
  ["an unknown op string", { id: "c", op: "merkle", input_b64: "" }, { status: "unsupported" }],
  ["an unknown profile string", { id: "c", op: "canonicalize", profile: "dcp-jcs-v2", input_b64: b64("{}") }, { status: "unsupported" }],
  ["input that is not UTF-8", canon(Buffer.from([0x7b, 0x22, 0xff, 0x22, 0x3a, 0x31, 0x7d])), { status: "rejected", code: "parse" }],
  ["input that is not JSON", canon("{\"a\":"), { status: "rejected", code: "parse" }],
  ["a NaN literal", canon("{\"n\":NaN}"), { status: "rejected", code: "parse" }],
  ["a top-level fraction", canon("{\"n\":0.5}"), { status: "rejected", code: "profile" }],
  ["a fraction behind a key and an array index", canon("{\"a\":{\"b\":[1,2.5]}}"), { status: "rejected", code: "profile" }],
  ["a fraction under a key with quotes and colons", canon("{\"k\\\": x\":0.25}"), { status: "rejected", code: "profile" }],
  ["an accepted value", canon("{\"b\":1,\"a\":[true,null]}"), { status: "ok", output_b64: b64("{\"a\":[true,null],\"b\":1}") }],
];
for (const [name, w] of Object.entries(WRAPPERS)) {
  test(`${name}: results of the real API, one per case`, (t) => {
    if (!available(t, w.built(), `${name} wrapper is not built`)) return;
    for (const [label, c, expected] of OUTCOMES) {
      const r = call(w.argv, request([c]));
      assert.equal(r.code, 0, `${label}: ${r.stderr}`);
      assert.deepEqual(r.json.results, [{ id: "c", ...expected }], label);
    }
    const bytes = call(w.argv, request([{ id: "c", op: "digest", alg: "sha256", input_b64: Buffer.from([0xff]).toString("base64") }]));
    if (name === "wasm") {
      assert.equal(bytes.json.results[0].status, "error", "the WASM digest exports take text: non-UTF-8 bytes are an error, never substituted");
    } else {
      assert.deepEqual(bytes.json.results[0], { id: "c", status: "ok", hex: "a8100ae6aa1940d0b663bb31cd466142ebbdbd5187131b92d93818987832eb89" });
    }
  });
}

// ── The WASM export's in-band {"error": …} results ──────────────

// [input, WASM result, Go/Rust result]. A legitimate single-key {"error": …} input, even with a message
// identical to a documented error, is an ambiguous error through WASM (never a false rejection) and the
// canonical bytes through Go and Rust; the WASM result is never ok with other bytes.
const okOf = (s) => ({ status: "ok", output_b64: b64(s) });
const AMBIGUOUS = { status: "error", ambiguous: true };
const IN_BAND = [
  ["{\"error\":\"foo\"}", AMBIGUOUS, okOf("{\"error\":\"foo\"}")],
  ["{\"error\":\"JSON parse: unexpected error\"}", AMBIGUOUS, okOf("{\"error\":\"JSON parse: unexpected error\"}")],
  ["{\"error\":\"Non-integer number in V2 canonical form: 0.5\"}", AMBIGUOUS, okOf("{\"error\":\"Non-integer number in V2 canonical form: 0.5\"}")],
  ["{\"error\":\"key 'n': Non-finite number in V2 canonical form: NaN\"}", AMBIGUOUS, okOf("{\"error\":\"key 'n': Non-finite number in V2 canonical form: NaN\"}")],
  [" {\"error\" : \"x\", \"error\":\"JSON parse: y\"} ", AMBIGUOUS, okOf("{\"error\":\"JSON parse: y\"}")],
  ["{\"error\":0.5}", AMBIGUOUS, { status: "rejected", code: "profile" }],
  ["{\"error\":\"x\",\"y\":1}", okOf("{\"error\":\"x\",\"y\":1}"), okOf("{\"error\":\"x\",\"y\":1}")],
  ["{\"error\":5}", okOf("{\"error\":5}"), okOf("{\"error\":5}")],
  ["{\"error\":\"x\"", { status: "rejected", code: "parse" }, { status: "rejected", code: "parse" }],
  ["{\"n\":0.5}", { status: "rejected", code: "profile" }, { status: "rejected", code: "profile" }],
];
function checkInBand(argv, column) {
  for (const row of IN_BAND) {
    const [input, expected] = [row[0], row[column]];
    const got = call(argv, request([canon(input)])).json.results[0];
    if (expected.ambiguous) {
      assert.equal(got.status, "error", `${input}: must be an ambiguous error, got ${JSON.stringify(got)}`);
      assert.match(got.message, /^ambiguous/, input);
    } else {
      assert.deepEqual(got, { id: "c", ...expected }, input);
    }
  }
}
test("wasm: single-key {\"error\": …} inputs are ambiguous errors, never false rejections", (t) => {
  if (!available(t, WRAPPERS.wasm.built(), "wasm wrapper is not built")) return;
  checkInBand(WRAPPERS.wasm.argv, 1);
});
for (const name of ["go", "rust"]) {
  test(`${name}: the same {"error": …} inputs are plain values (no in-band channel)`, (t) => {
    if (!available(t, WRAPPERS[name].built(), `${name} wrapper is not built`)) return;
    checkInBand(WRAPPERS[name].argv, 2);
  });
}

// ── Fake SDKs: a wrapper must not hide accepted fractions or internal errors ──

function expectFractionsAccepted(r) {
  assert.equal(r.code, 1, r.stderr);
  const failed = cases(r.report).filter((c) => c.status === "fail").map((c) => c.id);
  for (const id of FRACTIONS) assert.ok(failed.includes(id), `${id} must be a discrepancy`);
  assert.ok(cases(r.report).filter((c) => FRACTIONS.includes(c.id)).every((c) => c.status === "fail"));
}
function expectInternalErrors(r) {
  assert.equal(r.code, 3, r.stderr);
  const canonCases = r.report.suites.find((s) => s.id === "external.dcp-jcs-v1.canonicalize").cases;
  assert.ok(canonCases.every((c) => c.status === "error" && c.kind === "implementation"), JSON.stringify(canonCases.map((c) => [c.status, c.kind])));
}

test("go: a fake SDK that accepts fractions or fails internally is not hidden", (t) => {
  if (!available(t, hasTool("go", ["version"]), "the go toolchain is not available")) return;
  const fake = path.join(TMP, "go-fake");
  const pkg = path.join(fake, "dcp", "v2");
  fs.mkdirSync(pkg, { recursive: true });
  fs.writeFileSync(path.join(fake, "go.mod"), "module github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2\n\ngo 1.25.0\n");
  const real = fs.readFileSync(path.join(REPO, "sdks", "go", "dcp", "v2", "canonicalize.go"), "utf8");
  const check = "if err := AssertNoFloats(raw); err != nil {";
  assert.equal(real.split(check).length, 2, "the fake patches one known line of canonicalize.go");
  fs.writeFileSync(path.join(pkg, "canonicalize.go"), real.replace(check, "if err := fakeCheck(raw); err != nil {"));
  fs.writeFileSync(path.join(pkg, "fake.go"), `package v2

import (
	"crypto/sha256"
	"crypto/sha3"
	"encoding/hex"
	"errors"
	"os"
)

func fakeCheck(raw interface{}) error {
	switch os.Getenv("FAKE_MODE") {
	case "accept-fractions":
		return nil
	case "internal-error":
		return errors.New("internal failure")
	}
	return AssertNoFloats(raw)
}

func SHA256Hex(b []byte) string  { h := sha256.Sum256(b); return hex.EncodeToString(h[:]) }
func SHA3256Hex(b []byte) string { h := sha3.Sum256(b); return hex.EncodeToString(h[:]) }
`);
  const modfile = path.join(TMP, "go-fake-wrapper.mod");
  fs.writeFileSync(modfile, `module github.com/dcp-ai-protocol/dcp-ai/tools/conformance/wrappers/go\n\ngo 1.25.0\n\nrequire github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2 v2.0.0\n\nreplace github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2 => ${fake}\n`);
  fs.writeFileSync(modfile.replace(/\.mod$/, ".sum"), "");
  const bin = path.join(TMP, "go-fake-wrapper");
  const b = spawnSync("go", ["build", `-modfile=${modfile}`, "-o", bin, "."], { cwd: path.join(HERE, "wrappers", "go"), encoding: "utf8", env: { ...process.env, GOFLAGS: "-mod=mod", GOPROXY: "off" } });
  assert.equal(b.status, 0, b.stderr);
  expectFractionsAccepted(runner([bin], { FAKE_MODE: "accept-fractions" }));
  expectInternalErrors(runner([bin], { FAKE_MODE: "internal-error" }));
  assert.equal(runner([bin]).code, 0, "the fake in its default mode is the real canonicalizer");
});

test("rust: a fake SDK that accepts fractions or fails internally is not hidden", (t) => {
  if (!available(t, hasTool("cargo") && WRAPPERS.rust.built(), "cargo or the Rust wrapper build (for the dependency cache) is not available")) return;
  const fake = path.join(TMP, "rust-fake-sdk");
  fs.mkdirSync(path.join(fake, "src"), { recursive: true });
  fs.writeFileSync(path.join(fake, "Cargo.toml"), `[package]\nname = "dcp-ai"\nversion = "0.0.0-fake"\nedition = "2021"\npublish = false\n\n[dependencies]\nserde_json = "1.0"\nsha2 = "0.10"\nsha3 = "0.10"\nhex = "0.4"\n`);
  fs.writeFileSync(path.join(fake, "src", "lib.rs"), `pub mod observability { pub const DCP_SDK_VERSION: &str = "0.0.0-fake"; }
pub mod v2 {
    #[path = ${JSON.stringify(path.join(REPO, "sdks", "rust", "src", "v2", "canonicalize.rs"))}]
    mod real;
    pub mod canonicalize {
        use serde_json::Value;
        pub fn canonicalize_v2(value: &Value) -> Result<String, String> {
            match std::env::var("FAKE_MODE").as_deref() {
                Ok("internal-error") => Err("internal failure".to_string()),
                Ok("accept-fractions") => super::real::canonicalize_v2(value).or_else(|_| Ok(serde_json::to_string(value).unwrap())),
                _ => super::real::canonicalize_v2(value),
            }
        }
    }
    pub mod dual_hash {
        use sha2::Digest;
        pub fn sha256_hex(b: &[u8]) -> String { hex::encode(sha2::Sha256::digest(b)) }
        pub fn sha3_256_hex(b: &[u8]) -> String { hex::encode(sha3::Sha3_256::digest(b)) }
    }
}
`);
  const wrapper = path.join(TMP, "rust-fake-wrapper");
  fs.mkdirSync(wrapper, { recursive: true });
  fs.writeFileSync(path.join(wrapper, "Cargo.toml"), `[package]\nname = "dcp-ai-conformance-wrapper"\nversion = "0.0.0"\nedition = "2021"\npublish = false\n\n[[bin]]\nname = "dcp-ai-conformance-wrapper"\npath = ${JSON.stringify(path.join(HERE, "wrappers", "rust", "src", "main.rs"))}\n\n[dependencies]\ndcp-ai = { path = ${JSON.stringify(fake)} }\nserde_json = "1.0"\nbase64 = "0.22"\n\n[workspace]\n`);
  fs.copyFileSync(path.join(HERE, "wrappers", "rust", "Cargo.lock"), path.join(wrapper, "Cargo.lock"));
  const target = path.join(BUILD, "fake-rust-target");
  const b = spawnSync("cargo", ["build", "--offline", "--manifest-path", path.join(wrapper, "Cargo.toml")], { encoding: "utf8", env: { ...process.env, CARGO_TARGET_DIR: target } });
  assert.equal(b.status, 0, b.stderr);
  const bin = path.join(target, "debug", `dcp-ai-conformance-wrapper${process.platform === "win32" ? ".exe" : ""}`);
  expectFractionsAccepted(runner([bin], { FAKE_MODE: "accept-fractions" }));
  expectInternalErrors(runner([bin], { FAKE_MODE: "internal-error" }));
  assert.equal(runner([bin]).code, 0, "the fake in its default mode is the real canonicalizer");
});

test("wasm: a fake export that accepts fractions, fails in band or throws is not hidden", (t) => {
  if (!available(t, WRAPPERS.wasm.built(), "wasm wrapper is not built")) return;
  const pkg = path.join(TMP, "wasm-fake-pkg");
  fs.mkdirSync(pkg, { recursive: true });
  fs.copyFileSync(path.join(ARTIFACTS.wasm, "dcp_ai_bg.wasm"), path.join(pkg, "dcp_ai_bg.wasm"));
  fs.writeFileSync(path.join(pkg, "package.json"), JSON.stringify({ name: "fake-wasm", version: "0.0.0" }));
  fs.writeFileSync(path.join(pkg, "dcp_ai.js"), `import * as real from ${JSON.stringify(pathToFileURL(path.join(ARTIFACTS.wasm, "dcp_ai.js")).href)};
export default real.default;
export const wasm_dual_hash = real.wasm_dual_hash, wasm_sha3_256 = real.wasm_sha3_256;
export function wasm_canonicalize_v2(text) {
  const mode = process.env.FAKE_MODE;
  if (mode === "internal-error") return '{"error":"RuntimeError: unreachable executed"}';
  if (mode === "throws") throw new WebAssembly.RuntimeError("unreachable");
  const out = real.wasm_canonicalize_v2(text);
  return mode === "accept-fractions" && out.startsWith('{"error":') ? JSON.stringify(JSON.parse(text)) : out;
}
`);
  const argv = [process.execPath, WASM_WRAPPER, "--pkg", pkg];
  expectFractionsAccepted(runner(argv, { FAKE_MODE: "accept-fractions" }));
  expectInternalErrors(runner(argv, { FAKE_MODE: "internal-error" }));
  expectInternalErrors(runner(argv, { FAKE_MODE: "throws" }));
  const plain = runner(argv);
  assert.equal(plain.code, 0);
  assert.match(plain.report.implementation.self_declared.version, /^unknown \(package fake-wasm\)$/);
});

// ── Missing artifacts never pass ────────────────────────────────

test("missing artifacts are errors, never a pass", () => {
  const noPkg = runner([process.execPath, WASM_WRAPPER, "--pkg", path.join(TMP, "no-such-pkg")]);
  assert.equal(noPkg.code, 3);
  assert.equal(noPkg.report.status, "error");
  assert.match(noPkg.report.implementation.observed.stderr_excerpt, /no WASM build/);
  for (const bin of [path.join(TMP, "no-go-wrapper"), path.join(TMP, "no-rust-wrapper")]) {
    const r = runner([bin]);
    assert.equal(r.code, 3);
    assert.ok(cases(r.report).every((c) => c.kind === "spawn"));
  }
});
