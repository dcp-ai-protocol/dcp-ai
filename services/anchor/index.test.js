import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { post as postTo, sha256Hex, startService } from "../../tests/helpers.js";

const OPERATOR_TOKEN = "test-operator-token";
let base;
let proc;

before(async () => {
  ({ base, proc } = await startService(fileURLToPath(new URL("./index.js", import.meta.url)), {
    ANCHOR_MODE: "individual",
    OPERATOR_TOKEN,
  }));
});

after(() => proc.kill());

const post = (path, body, headers) => postTo(base, path, body, headers);

test("anchor records never carry a fabricated tx_hash", async () => {
  const res = await post("/anchor", { bundle_hash: `sha256:${sha256Hex("bundle-1")}` });
  assert.equal(res.status, 200);
  assert.equal(res.body.tx_hash, null);
  assert.equal(res.body.onchain, false);
});

test("oversized or malformed input is rejected without crashing the service", async () => {
  assert.equal((await post("/anchor", { bundle_hash: "a".repeat(2 * 1024 * 1024) })).status, 400);
  assert.equal((await post("/anchor", { bundle_hash: 123 })).status, 400);
  assert.equal((await fetch(`${base}/status/%E0`)).status, 400);
  assert.equal((await fetch(`${base}/health`)).status, 200);
});

test("POST /flush needs the operator token", async () => {
  assert.equal((await post("/flush", {})).status, 401);
  assert.equal((await post("/flush", {}, { authorization: `Bearer ${OPERATOR_TOKEN}` })).status, 200);
});
