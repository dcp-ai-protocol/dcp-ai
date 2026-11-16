#!/usr/bin/env node
// Builds the native and WASM conformance wrappers from this checkout into tools/conformance/wrappers/.build
// (ignored by Git). No DCP package is installed or published and no SDK manifest or lockfile is changed: Go
// builds with -mod=readonly against the wrapper's go.mod/go.sum, Cargo with --locked (the wrapper's Cargo.lock
// for the native wrapper, the SDK's own Cargo.lock for the WASM artifact). Without --offline, Cargo and
// wasm-pack may download build tools and the pinned dependencies into their caches.
//
//   node tools/conformance/wrappers/build.mjs [--offline] go|rust|wasm|all
//
// --offline: GOPROXY=off for Go, --offline for Cargo, and wasm-pack --mode no-install (the toolchains and
// the dependency caches must already hold everything). Prints the artifact paths; exits 1 on any failure.
import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..", "..");
export const BUILD = path.join(HERE, ".build");
const exe = process.platform === "win32" ? ".exe" : "";
export const ARTIFACTS = {
  go: path.join(BUILD, `go-wrapper${exe}`),
  rust: path.join(BUILD, "rust-target", "debug", `dcp-ai-conformance-wrapper${exe}`),
  wasm: path.join(BUILD, "wasm-pkg"),
};

function run(cmd, args, opts) {
  console.log(`$ ${[cmd, ...args].join(" ")}`);
  const r = spawnSync(cmd, args, { stdio: "inherit", ...opts });
  if (r.error) throw new Error(`${cmd}: ${r.error.code ?? r.error.message}`);
  if (r.status !== 0) throw new Error(`${cmd} exited with ${r.status ?? r.signal}`);
}

const BUILDERS = {
  go(offline) {
    run("go", ["build", "-o", ARTIFACTS.go, "."], {
      cwd: path.join(HERE, "go"),
      env: { ...process.env, GOFLAGS: "-mod=readonly", ...(offline ? { GOPROXY: "off" } : {}) },
    });
  },
  rust(offline) {
    run("cargo", ["build", "--locked", ...(offline ? ["--offline"] : []), "--manifest-path", path.join(HERE, "rust", "Cargo.toml")], {
      env: { ...process.env, CARGO_TARGET_DIR: path.join(BUILD, "rust-target") },
    });
  },
  wasm(offline) {
    fs.rmSync(ARTIFACTS.wasm, { recursive: true, force: true });
    run("wasm-pack", ["build", path.join(REPO, "sdks", "rust"), "--target", "web", "--out-dir", ARTIFACTS.wasm,
      "--mode", offline ? "no-install" : "normal", "--", "--features", "wasm", "--locked", ...(offline ? ["--offline"] : [])], {
      env: { ...process.env, CARGO_TARGET_DIR: path.join(BUILD, "wasm-target") },
    });
  },
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const offline = args.includes("--offline");
  const targets = args.filter((a) => a !== "--offline");
  const unknown = targets.filter((t) => t !== "all" && !BUILDERS[t]);
  if (targets.length === 0 || unknown.length) {
    console.error("usage: build.mjs [--offline] go|rust|wasm|all");
    process.exit(2);
  }
  const selected = targets.includes("all") ? Object.keys(BUILDERS) : [...new Set(targets)];
  try {
    fs.mkdirSync(BUILD, { recursive: true });
    for (const t of selected) BUILDERS[t](offline);
  } catch (e) {
    console.error(`build failed: ${e.message}`);
    process.exit(1);
  }
  for (const t of selected) console.log(`${t}: ${ARTIFACTS[t]}`);
}
