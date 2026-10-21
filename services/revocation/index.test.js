import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const PORT = 40000 + Math.floor(Math.random() * 10000);
const base = `http://127.0.0.1:${PORT}`;
let proc;

before(async () => {
  proc = spawn(process.execPath, [fileURLToPath(new URL("./index.js", import.meta.url))], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: ["ignore", "pipe", "inherit"],
  });
  await new Promise((resolve, reject) => {
    proc.stdout.on("data", (d) => d.toString().includes("listening") && resolve());
    proc.on("exit", (code) => reject(new Error(`revocation service exited (${code})`)));
  });
});

after(() => proc.kill());

const post = (path, body) =>
  fetch(base + path, { method: "POST", body: JSON.stringify(body) }).then((r) => r.json());
const get = (path) => fetch(base + path);

test("emergency revocation only marks kids of the revoked agent", async () => {
  const secret = crypto.randomBytes(32).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(Buffer.from(secret, "hex")).digest("hex");
  await post("/v2/register-emergency-token", { agent_id: "agent-a", emergency_revocation_token: tokenHash });
  assert.equal((await post("/v2/emergency-revoke", { agent_id: "agent-a", revocation_secret: secret })).ok, true);

  const other = await (await get("/v2/check/kid/kid-of-agent-b")).json();
  assert.equal(other.revoked, false);
  const own = await (await get("/v2/check/kid/kid-of-agent-a?agent_id=agent-a")).json();
  assert.equal(own.revoked, true);
});

test("malformed percent-encoding returns 400 instead of crashing the service", async () => {
  assert.equal((await get("/v2/check/kid/%E0")).status, 400);
  assert.equal((await get("/check/%E0")).status, 400);
  assert.equal((await get("/health")).status, 200);
});
