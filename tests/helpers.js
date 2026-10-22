// Shared by the server/ and services/ node:test suites.
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import {
  AlgorithmRegistry,
  DCP_CONTEXTS,
  Ed25519Provider,
  MlDsa65Provider,
  canonicalizeV2,
  compositeSign,
  preparePayload,
} from "@dcp-ai/sdk";

export const registry = new AlgorithmRegistry();
registry.registerSigner(new Ed25519Provider());
registry.registerSigner(new MlDsa65Provider());

let nextPort = 40000 + Math.floor(Math.random() * 10000);

/** Spawn a service on a free-ish port and wait until it is listening. */
export async function startService(script, env = {}) {
  const port = nextPort++;
  const proc = spawn(process.execPath, [script], {
    env: { ...process.env, PORT: String(port), ...env },
    stdio: ["ignore", "pipe", "inherit"],
  });
  await new Promise((resolve, reject) => {
    proc.stdout.on("data", (d) => /listening/i.test(d.toString()) && resolve());
    proc.on("exit", (code) => reject(new Error(`${script} exited (${code})`)));
  });
  return { base: `http://127.0.0.1:${port}`, proc };
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

/** Composite Ed25519 + ML-DSA-65 signature over canonical(payload). */
export const sign = async (context, payload, keys) =>
  compositeSign(registry, context, new TextEncoder().encode(canonicalizeV2(payload)), keys);

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
