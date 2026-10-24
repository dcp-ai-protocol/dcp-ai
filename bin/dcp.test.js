// The reference CLI confines every path it reads or writes to the working directory.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CLI = fileURLToPath(new URL("./dcp.js", import.meta.url));
const run = (cwd, ...args) => spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8" });

function sandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dcp-cli-"));
  const work = path.join(root, "work");
  const outside = path.join(root, "outside");
  fs.mkdirSync(work);
  fs.mkdirSync(outside);
  return { root, work, outside };
}

test("a symlink inside the working directory cannot read a file outside it", () => {
  const { work, outside } = sandbox();
  fs.writeFileSync(path.join(outside, "secret.json"), JSON.stringify({ intent_id: "outside" }));
  fs.symlinkSync(path.join(outside, "secret.json"), path.join(work, "intent.json"));
  const r = run(work, "intent-hash", "intent.json");
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stderr, /outside the allowed working directory/);
});

test("a symlinked directory inside the working directory cannot reach outside it", () => {
  const { work, outside } = sandbox();
  fs.writeFileSync(path.join(outside, "intent.json"), JSON.stringify({ intent_id: "outside" }));
  fs.symlinkSync(outside, path.join(work, "linked"));
  const r = run(work, "intent-hash", "linked/intent.json");
  assert.equal(r.status, 2, r.stdout + r.stderr);
});

test("keys cannot be written through a dangling symlink to a file outside", () => {
  const { work, outside } = sandbox();
  const target = path.join(outside, "planted");
  fs.mkdirSync(path.join(work, "keys"));
  fs.symlinkSync(target, path.join(work, "keys", "secret_key.txt"));
  const r = run(work, "keygen", "keys");
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.equal(fs.existsSync(target), false);
});

test("ordinary paths inside the working directory still work", () => {
  const { work } = sandbox();
  fs.writeFileSync(path.join(work, "intent.json"), JSON.stringify({ intent_id: "inside" }));
  assert.equal(run(work, "intent-hash", "intent.json").status, 0);
  const keygen = run(work, "keygen", "keys");
  assert.equal(keygen.status, 0, keygen.stdout + keygen.stderr);
  assert.ok(fs.existsSync(path.join(work, "keys", "secret_key.txt")));
});

test("key rotation and advisory signing cannot read key directories outside", () => {
  const { work, outside } = sandbox();
  fs.writeFileSync(path.join(outside, "kid.txt"), "outside-kid\n");
  fs.writeFileSync(path.join(outside, "participant.json"), JSON.stringify({ participant_id: "p" }));
  fs.writeFileSync(path.join(work, "advisory.json"), JSON.stringify({ advisory_id: "a" }));
  for (const args of [
    ["keys", "rotate", "--key-dir", outside],
    ["governance", "sign-advisory", "advisory.json", "--key-dir", outside],
  ]) {
    const r = run(work, ...args);
    assert.equal(r.status, 2, `${args.join(" ")}: ${r.stdout}${r.stderr}`);
    assert.doesNotMatch(r.stdout, /outside-kid/);
  }
  fs.mkdirSync(path.join(work, "keys"));
  fs.symlinkSync(path.join(outside, "kid.txt"), path.join(work, "keys", "kid.txt"));
  const rotate = run(work, "keys", "rotate", "--key-dir", "keys");
  assert.equal(rotate.status, 2, rotate.stdout + rotate.stderr);
  assert.doesNotMatch(rotate.stdout, /outside-kid/);
});

test("advisory verification cannot read signatures outside", () => {
  const { work, outside } = sandbox();
  fs.writeFileSync(path.join(outside, "sig.json"), "{}");
  fs.writeFileSync(path.join(work, "advisory.json"), JSON.stringify({ advisory_id: "a" }));
  fs.writeFileSync(path.join(work, "keys.json"), JSON.stringify({ participants: [] }));
  const r = run(work, "governance", "verify-advisory", "advisory.json", "--keys", "keys.json", "--sigs", path.join(outside, "sig.json"));
  assert.equal(r.status, 2, r.stdout + r.stderr);
});

test("a secret key replaces a hard link instead of writing through it, and gets mode 0600", () => {
  const { work, outside } = sandbox();
  const loot = path.join(outside, "loot");
  fs.writeFileSync(loot, "untouched");
  fs.chmodSync(loot, 0o666);
  fs.mkdirSync(path.join(work, "keys"));
  fs.linkSync(loot, path.join(work, "keys", "secret_key.txt"));
  const r = run(work, "keygen", "keys");
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(fs.readFileSync(loot, "utf8"), "untouched");
  if (process.platform !== "win32") {
    assert.equal(fs.statSync(path.join(work, "keys", "secret_key.txt")).mode & 0o777, 0o600);
  }
});

test("an existing secret key file with a wider mode ends up 0600", { skip: process.platform === "win32" }, () => {
  const { work } = sandbox();
  fs.mkdirSync(path.join(work, "keys"));
  fs.writeFileSync(path.join(work, "keys", "secret_key.txt"), "old");
  fs.chmodSync(path.join(work, "keys", "secret_key.txt"), 0o644);
  assert.equal(run(work, "keygen", "keys").status, 0);
  assert.equal(fs.statSync(path.join(work, "keys", "secret_key.txt")).mode & 0o777, 0o600);
});

test("the CLI runs its own tools, not a tools/ directory planted in the working directory", () => {
  const { work } = sandbox();
  const marker = path.join(work, "planted-ran");
  fs.mkdirSync(path.join(work, "tools"));
  fs.writeFileSync(path.join(work, "tools", "validate.js"), `require("fs").writeFileSync(${JSON.stringify(marker)}, "x");`);
  const repo = path.dirname(path.dirname(CLI));
  fs.copyFileSync(path.join(repo, "schemas", "v1", "intent.schema.json"), path.join(work, "intent.schema.json"));
  fs.copyFileSync(path.join(repo, "tests", "conformance", "examples", "intent.json"), path.join(work, "intent.json"));
  run(work, "validate", "intent.schema.json", "intent.json");
  assert.equal(fs.existsSync(marker), false);
});

test("the working directory or another directory is not a file to write", () => {
  const { root, work } = sandbox();
  fs.mkdirSync(path.join(work, "kk"));
  assert.equal(run(work, "keygen", "kk").status, 0);
  fs.writeFileSync(path.join(work, "b.json"), "{}");
  fs.writeFileSync(path.join(work, "advisory.json"), JSON.stringify({ advisory_id: "a" }));
  for (const args of [
    ["sign-bundle", "b.json", "kk/secret_key.txt", "."],
    ["sign-bundle", "b.json", "kk/secret_key.txt", "kk"],
  ]) {
    const r = run(work, ...args);
    assert.equal(r.status, 2, `${args.join(" ")}: ${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /is a directory/);
  }
  assert.deepEqual(fs.readdirSync(root).sort(), ["outside", "work"]);
});
