import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { buildV2Examples } from "../scripts/generate-v2-examples.js";

const PORT = 40000 + Math.floor(Math.random() * 10000);
const base = `http://127.0.0.1:${PORT}`;
let proc;
let signedBundle;

before(async () => {
  ({ signedBundle } = await buildV2Examples());
  proc = spawn(process.execPath, [fileURLToPath(new URL("./index.js", import.meta.url))], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: ["ignore", "pipe", "inherit"],
  });
  await new Promise((resolve, reject) => {
    proc.stdout.on("data", (d) => /listening|running on/i.test(d.toString()) && resolve());
    proc.on("exit", (code) => reject(new Error(`server exited (${code})`)));
  });
});

after(() => proc.kill());

const post = async (path, body) => {
  const res = await fetch(base + path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
};

test("valid V2 bundle verifies on both endpoints", async () => {
  assert.equal((await post("/verify", { signed_bundle: signedBundle })).body.verified, true);
  assert.equal((await post("/v2/bundle/verify", { signed_bundle: signedBundle })).body.verified, true);
});

test("server policy (hybrid_required) rejects a PQ-stripped bundle", async () => {
  const stripped = structuredClone(signedBundle);
  stripped.signature.composite_sig.pq = null;
  stripped.signature.composite_sig.binding = "classical_only";
  assert.equal((await post("/verify", { signed_bundle: stripped })).body.verified, false);
  assert.equal((await post("/v2/bundle/verify", { signed_bundle: stripped })).body.verified, false);
});

test("V1 bundle on the V2 endpoint is a 400, not a 500", async () => {
  const v1 = JSON.parse(
    fs.readFileSync(new URL("../tests/conformance/examples/citizenship_bundle.signed.json", import.meta.url), "utf8"),
  );
  assert.equal((await post("/v2/bundle/verify", { signed_bundle: v1 })).status, 400);
});
