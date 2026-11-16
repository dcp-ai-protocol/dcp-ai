// Shared by the server/ and services/ node:test suites.
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import net from "node:net";
import {
  AlgorithmRegistry,
  DCP_CONTEXTS,
  Ed25519Provider,
  MlDsa65Provider,
  canonicalizeV2,
  classicalOnlySign,
  compositeSign,
  preparePayload,
} from "@dcp-ai/sdk";

export const registry = new AlgorithmRegistry();
registry.registerSigner(new Ed25519Provider());
registry.registerSigner(new MlDsa65Provider());

/** Spawn a service on a port the OS reports free and wait until it is listening. */
export async function startService(script, env = {}) {
  return startServiceWithin(script, env, { attempts: 3, deadlineMs: 30_000 });
}

/**
 * startService with its limits explicit (the harness's own test uses short ones). Another process
 * may take the port between the probe and the service's own listen: only that, the service exiting
 * with EADDRINUSE before it is ready, is retried on a new port, at most `attempts` times in all and
 * never once `deadlineMs` (monotonic) is spent. Any other exit, a spawn error or the deadline
 * rejects, and only after the process is gone: past the deadline it gets SIGTERM, then SIGKILL after
 * a short grace. Its stderr is passed through as before, and its first Error line is in the error.
 */
export async function startServiceWithin(script, env, { attempts, deadlineMs }) {
  const deadline = performance.now() + deadlineMs;
  let lost; // the last attempt that lost its port
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const port = await freePort();
    if (performance.now() >= deadline) break; // never launch with the budget spent
    const outcome = await launch(script, { ...process.env, PORT: String(port), ...env }, deadline);
    if (outcome.proc) return { base: `http://127.0.0.1:${port}`, proc: outcome.proc };
    if (!outcome.addressInUse) throw outcome.error;
    lost = outcome.error;
    lost.message += ` (port taken on attempt ${attempt} of ${attempts})`;
  }
  throw lost ?? new Error(`${script} was not launched: the startup deadline was already spent`);
}

/** A port the OS reports free now, on the addresses the services listen on (all interfaces). */
async function freePort() {
  const probe = net.createServer();
  await new Promise((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(0, resolve);
  });
  const { port } = probe.address();
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

const KILL_GRACE_MS = 2_000;
const KEPT_OUTPUT = 64 * 1024;

/** One start: { proc } once it prints "listening", else { error, addressInUse } once it is gone. */
function launch(script, env, deadline) {
  return new Promise((resolve) => {
    const proc = spawn(process.execPath, [script], { env, stdio: ["ignore", "pipe", "pipe"] });
    proc.stdout.setEncoding("utf8");
    proc.stderr.setEncoding("utf8");
    let stdout = "";
    let stderr = "";
    let late = false;
    let grace;
    const finish = (outcome) => {
      clearTimeout(timer);
      clearTimeout(grace);
      proc.stdout.off("data", onStdout);
      proc.off("close", onClose);
      proc.off("error", onError);
      if (outcome.proc) proc.stdout.resume(); // keep draining what the service prints
      resolve(outcome);
    };
    // Accumulated (bounded): "listening" may arrive split across chunks.
    const onStdout = (data) => {
      stdout = (stdout + data).slice(-KEPT_OUTPUT);
      if (!late && /listening/i.test(stdout)) finish({ proc });
    };
    // "close", not "exit": the process is gone and its stdio complete, so an EADDRINUSE it printed is there.
    const onClose = (code, signal) => {
      const cause = stderr.match(/^\w*Error\b.*$/m)?.[0]; // e.g. "Error: listen EADDRINUSE: …"
      finish({
        addressInUse: !late && /\bEADDRINUSE\b/.test(stderr),
        error: late
          ? new Error(`${script} did not report listening before the startup deadline`)
          : new Error(`${script} exited (${code ?? signal})${cause ? `: ${cause}` : ""}`),
      });
    };
    // The spawn itself failed: there is no process to wait for, and it is never retried.
    const onError = (error) => proc.pid === undefined && finish({ error });
    const timer = setTimeout(() => {
      late = true;
      proc.kill("SIGTERM");
      grace = setTimeout(() => proc.kill("SIGKILL"), KILL_GRACE_MS);
    }, Math.max(deadline - performance.now(), 0));
    proc.stdout.on("data", onStdout);
    proc.stderr.on("data", (data) => {
      process.stderr.write(data); // the diagnostics stay visible, as with "inherit"
      if (stderr.length < KEPT_OUTPUT) stderr += data;
    });
    proc.once("close", onClose);
    proc.on("error", onError);
  });
}

export const post = async (base, path, body, headers = {}) => {
  const res = await fetch(base + path, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
};

export const sha256Hex = (data) => crypto.createHash("sha256").update(data).digest("hex");

/** Composite signature over canonical(payload); classical-only when `keys.pq` is absent. */
export const sign = async (context, payload, keys) => {
  const bytes = new TextEncoder().encode(canonicalizeV2(payload));
  return keys.pq
    ? compositeSign(registry, context, bytes, keys)
    : classicalOnlySign(registry, context, bytes, keys.classical);
};

/** An ISO timestamp `seconds` after `iso`, e.g. a newer passport `created_at`. */
export const later = (iso, seconds = 60) =>
  new Date(Date.parse(iso) + seconds * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");

/**
 * A fresh agent: composite keys (with secrets), its passport and the
 * self-signed passport (`{ payload, payload_hash, composite_sig }`).
 * Returns the emergency revocation secret when the passport carries a token.
 */
export async function newAgent(agentId, { emergencyToken = true } = {}) {
  const keys = {};
  for (const [role, provider] of [["classical", new Ed25519Provider()], ["pq", new MlDsa65Provider()]]) {
    const kp = await provider.generateKeypair();
    keys[role] = { kid: kp.kid, alg: provider.alg, publicKeyB64: kp.publicKeyB64, secretKeyB64: kp.secretKeyB64 };
  }
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const revocationSecret = crypto.randomBytes(32).toString("hex");
  const passport = {
    dcp_version: "2.0",
    agent_id: agentId,
    session_nonce: crypto.randomBytes(32).toString("hex"),
    keys: Object.values(keys).map((k) => ({
      kid: k.kid, alg: k.alg, public_key_b64: k.publicKeyB64, created_at: now, expires_at: null, status: "active",
    })),
    principal_binding_reference: "human:test-owner",
    capabilities: ["browse"],
    risk_tier: "low",
    created_at: now,
    status: "active",
    ...(emergencyToken && { emergency_revocation_token: `sha256:${sha256Hex(Buffer.from(revocationSecret, "hex"))}` }),
  };
  const signedPassport = await signPassport(passport, keys);
  return { keys, passport, signedPassport, revocationSecret };
}

export async function signPassport(passport, keys) {
  return {
    payload: passport,
    payload_hash: preparePayload(passport).payloadHash,
    composite_sig: await sign(DCP_CONTEXTS.AgentPassport, passport, keys),
  };
}
