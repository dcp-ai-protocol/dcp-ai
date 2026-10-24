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
