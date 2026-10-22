#!/usr/bin/env node
/**
 * DCP Revocation Service — V1 + V2 support.
 *
 * Publishes and queries revocation records for DCP agents.
 * V2 adds: kid-level revocation, short-lived cert checking, emergency
 * revocation (panic button), and composite signature verification.
 *
 * Agents register by POSTing their self-signed V2 passport to /v2/register.
 * The composite self-signature proves possession of its signer keys, so the
 * service records those kids as the agent's (with their expiry) together with
 * the passport's emergency revocation token. Revocations must be signed by
 * the registered keys.
 *
 * Registering a new agent_id needs the operator token (OPERATOR_TOKEN): a
 * passport is only self-signed, so the operator vouches for who may claim an
 * agent_id. Re-registering stays self-service, signed by the agent's keys.
 *
 * State is in memory and does not survive a restart unless REVOCATION_STATE_PATH
 * names a file to keep it in.
 *
 * Environment:
 *   PORT                   — HTTP port (default 3003)
 *   OPERATOR_TOKEN         — bearer token required to register a new agent_id
 *   REVOCATION_STATE_PATH  — optional append-only state file (default: memory only)
 *   TRUST_PROXY            — "true" behind a proxy that appends X-Forwarded-For
 *   REGISTRATIONS_PER_HOUR — POST /v2/register calls per client and hour (default 20)
 *   MAX_AGENTS             — registered agents before new ones get 507 (default 10000)
 */

import http from "http";
import crypto from "crypto";
import fs from "fs";
import { DCP_CONTEXTS } from "@dcp-ai/sdk";
import { verifyCompositeSig } from "../../lib/verify.js";
import { decodeParam, getClientIp, isOperator, parseBody, rateLimiter } from "../../lib/http.js";
import { verifyObject } from "../../tools/crypto.js";

const PORT = Number(process.env.PORT) || 3003;
const REGISTRATIONS_PER_HOUR = Number(process.env.REGISTRATIONS_PER_HOUR) || 20;
const MAX_AGENTS = Number(process.env.MAX_AGENTS) || 10_000;
const V2_REASONS = ["key_compromise", "key_rotation", "administrative", "key_compromise_emergency"];

// ── Revocation stores ──

// V1: agent_id -> revocation record
const revocations = new Map();
// V2: kid -> { agent_id, human_id, revoked_kid, timestamp, reason }
const kidRevocations = new Map();
// Registered agents: agent_id -> { keys: KeyEntry[], token_hash, registered_at }
const agents = new Map();
// kid -> agent_id, for the keys that proved possession at registration
const kidOwners = new Map();

// Optional file-backed state: each write is appended (and fsynced) as one JSON line,
// and at start the file is replayed, then compacted to one line per entry through a
// temp file and an atomic rename. Without REVOCATION_STATE_PATH, a restart forgets
// every registration and revocation.
const STATE_PATH = process.env.REVOCATION_STATE_PATH;
const MAX_STATE_BYTES = 512 * 1024 * 1024; // refuse to start rather than read an absurd file
const stores = { revocations, kidRevocations, agents, kidOwners };
let stateFd = null;

function persist(entry) {
  if (stateFd === null) return;
  fs.writeSync(stateFd, JSON.stringify(entry) + "\n");
  fs.fsyncSync(stateFd);
}

function put(store, key, value) {
  persist([store, key, value]);
  stores[store].set(key, value);
}

// Records only the changed fields, e.g. a re-registration's new token.
function merge(store, key, fields) {
  persist([store, key, fields, "merge"]);
  stores[store].set(key, { ...stores[store].get(key), ...fields });
}

if (STATE_PATH) {
  if (fs.existsSync(STATE_PATH)) {
    if (fs.statSync(STATE_PATH).size > MAX_STATE_BYTES) {
      throw new Error(`${STATE_PATH} is over ${MAX_STATE_BYTES} bytes; refusing to load it`);
    }
    for (const line of fs.readFileSync(STATE_PATH, "utf8").split("\n").filter(Boolean)) {
      try {
        const [store, key, value, op] = JSON.parse(line);
        stores[store].set(key, op === "merge" ? { ...stores[store].get(key), ...value } : value);
      } catch {
        console.warn("[revocation] Skipping an unreadable state line (a torn last write?)");
      }
    }
  }
  // Also fails fast, at startup, when the path is not writable.
  const tmp = `${STATE_PATH}.tmp`;
  const fd = fs.openSync(tmp, "w");
  for (const [name, store] of Object.entries(stores)) {
    for (const [key, value] of store) fs.writeSync(fd, JSON.stringify([name, key, value]) + "\n");
  }
  fs.fsyncSync(fd);
  fs.closeSync(fd);
  fs.renameSync(tmp, STATE_PATH);
  stateFd = fs.openSync(STATE_PATH, "a");
}

// Per-client rate limiters
const checkRateLimit = rateLimiter(5, 60_000); // emergency revocations
const checkRegistrationRate = rateLimiter(REGISTRATIONS_PER_HOUR, 3_600_000);

// Everything below is kept in memory and published, so client-supplied text stays short.
const tooLong = (...values) => values.some((v) => v !== undefined && (typeof v !== "string" || v.length > 256));
const badDate = (v) => typeof v !== "string" || tooLong(v) || Number.isNaN(Date.parse(v));
const sigEntry = (s) => s && { alg: s.alg, kid: s.kid, sig_b64: s.sig_b64 };

function send(res, statusCode, body) {
  res.setHeader("Content-Type", "application/json");
  res.writeHead(statusCode);
  res.end(JSON.stringify(body));
}

// Keys that can still sign for an agent: registered, not revoked, not expired.
function activeKeys(agentId) {
  const now = new Date();
  return (agents.get(agentId)?.keys ?? []).filter((k) =>
    !kidRevocations.has(k.kid) && !(k.expires_at && new Date(k.expires_at) < now));
}

async function handle(req, res) {
  // Health
  if (req.method === "GET" && (req.url === "/" || req.url === "/health")) {
    send(res, 200, {
      ok: true,
      service: "dcp-revocation",
      supported_versions: ["1.0", "2.0"],
      state: STATE_PATH ? "file" : "memory",
      registered_agents: agents.size,
      total_revocations: revocations.size,
      total_kid_revocations: kidRevocations.size,
    });
    return;
  }

  // ── V2: Register an agent's keys and emergency token ──
  if (req.method === "POST" && req.url === "/v2/register") {
    if (!checkRegistrationRate(getClientIp(req))) {
      return send(res, 429, { error: `Rate limit exceeded. Max ${REGISTRATIONS_PER_HOUR} registrations per hour.` });
    }

    let body;
    try { body = await parseBody(req); }
    catch { return send(res, 400, { error: "Invalid JSON" }); }

    const passport = body.signed_passport?.payload;
    const sig = body.signed_passport?.composite_sig;
    if (passport?.dcp_version !== "2.0" || typeof passport.agent_id !== "string" || tooLong(passport.agent_id) ||
        !Array.isArray(passport.keys) || badDate(passport.created_at)) {
      return send(res, 400, { error: "Missing signed_passport (V2 passport payload with created_at + composite_sig)" });
    }
    const token = passport.emergency_revocation_token;
    if (token !== undefined && !/^sha256:[0-9a-f]{64}$/.test(token)) {
      return send(res, 400, { error: "emergency_revocation_token must be sha256:<64 hex chars>" });
    }

    const agentId = passport.agent_id;
    const existing = agents.get(agentId);
    // The first registration claims the agent_id. A passport (or an RPR) is only
    // self-signed, so anyone could claim a victim's agent_id first, plant a token and
    // revoke it: the operator vouches for new agents instead.
    if (!existing && !isOperator(req)) {
      res.setHeader("WWW-Authenticate", "Bearer");
      return send(res, 401, {
        error: "Registering a new agent_id needs the operator token (Authorization: Bearer <OPERATOR_TOKEN>)",
      });
    }

    if (!(await verifyCompositeSig(DCP_CONTEXTS.AgentPassport, passport, sig, passport.keys))) {
      return send(res, 403, { error: "Passport signature does not verify against the passport's own keys" });
    }

    if (revocations.get(agentId)?.emergency) {
      return send(res, 403, { error: `Agent ${agentId} has been emergency-revoked` });
    }

    const signers = passport.keys.filter((k) => k.kid === sig.classical.kid || k.kid === sig.pq?.kid);
    const active = activeKeys(agentId);
    const isActive = (k) => active.some((a) => a.kid === k.kid);
    // A signer is one of the agent's active keys or a kid nobody has registered.
    const unusable = signers.find((k) => kidOwners.has(k.kid) && !isActive(k));
    if (unusable) {
      return send(res, 409, { error: `Key ${unusable.kid} is revoked, expired or registered to another agent` });
    }
    // Re-registration (e.g. a new token) must be newer than the registered passport (signed
    // passports are public, so an old one can be replayed) and signed by exactly the agent's
    // active classical and PQ keys. An agent that lost either one (expired or kid-revoked)
    // stays locked: its remaining key alone could pair itself with a new partner key and
    // take the agent over. Recovery goes through the emergency token or the operator.
    if (existing) {
      const slotKids = [sig.classical.kid, sig.pq.kid];
      if (!slotKids.every((kid) => active.some((a) => a.kid === kid)) || !active.every((a) => slotKids.includes(a.kid))) {
        return send(res, 409, {
          error: `Agent ${agentId} is already registered; re-registration must be signed by its active classical and PQ keys`,
        });
      }
      if (!(Date.parse(passport.created_at) > Date.parse(existing.created_at))) {
        return send(res, 409, { error: "Re-registration needs a passport newer (created_at) than the registered one" });
      }
    }

    if (signers.some((k) => k.expires_at != null && badDate(k.expires_at))) {
      return send(res, 400, { error: "Key expires_at must be a date-time or null" });
    }
    // A full registry refuses new agents: evicting one would let anyone claim its agent_id.
    if (!existing && agents.size >= MAX_AGENTS) {
      return send(res, 507, { error: "Registry full" });
    }

    const update = {
      // Never cleared: a newer passport without a token keeps the registered one.
      token_hash: passport.emergency_revocation_token ?? existing?.token_hash ?? null,
      created_at: passport.created_at,
      registered_at: new Date().toISOString(),
    };
    if (existing) {
      // The registered key entries stay (a new passport cannot extend expires_at), so
      // only the changed fields are recorded.
      merge("agents", agentId, update);
    } else {
      for (const k of signers) put("kidOwners", k.kid, agentId);
      put("agents", agentId, {
        keys: signers.map(({ kid, alg, public_key_b64, expires_at }) => ({ kid, alg, public_key_b64, expires_at: expires_at ?? null })),
        ...update,
      });
    }

    console.log(`[register] Agent ${agentId} registered (${signers.length} keys)`);
    send(res, 201, { ok: true, agent_id: agentId, registered_kids: signers.map((k) => k.kid) });
    return;
  }

  // ── V1: Publish revocation (agent-level) ──
  // `signature` is Ed25519 over the record without it (V1 canonical JSON),
  // by one of the agent's registered ed25519 keys.
  if (req.method === "POST" && req.url === "/revoke") {
    let body;
    try { body = await parseBody(req); }
    catch { return send(res, 400, { error: "Invalid JSON" }); }

    const { dcp_version, agent_id, human_id, timestamp, reason, signature } = body;
    if (!agent_id || !reason || !signature) {
      return send(res, 400, {
        error: "Missing required fields: agent_id, reason, signature",
      });
    }
    if (tooLong(dcp_version, human_id, timestamp, reason, signature)) {
      return send(res, 400, { error: "Fields must be strings of at most 256 characters" });
    }

    const signed = { dcp_version, agent_id, human_id, timestamp, reason };
    const signedByAgent = activeKeys(agent_id).some((k) => {
      try { return k.alg === "ed25519" && verifyObject(signed, signature, k.public_key_b64); }
      catch { return false; }
    });
    if (!signedByAgent) {
      return send(res, 403, { error: "Signature does not verify against the agent's active ed25519 keys" });
    }

    // Revocations are final: overwriting one could downgrade an emergency revocation.
    if (revocations.has(agent_id)) {
      return send(res, 409, { error: `Agent ${agent_id} is already revoked` });
    }

    const record = {
      dcp_version: dcp_version || "1.0",
      agent_id,
      human_id: human_id || "",
      timestamp: timestamp || new Date().toISOString(),
      reason,
      signature,
    };

    put("revocations", agent_id, record);
    console.log(`[revoke] Agent revoked: ${agent_id} — ${reason}`);
    send(res, 201, { ok: true, agent_id, revoked_at: record.timestamp });
    return;
  }

  // ── V2: Kid-level revocation with composite signature ──
  // composite_sig covers the record without it, under "DCP-AI.v2.Revocation",
  // by the agent's registered keys; revoked_kid must be one of them.
  if (req.method === "POST" && req.url === "/v2/revoke") {
    let body;
    try { body = await parseBody(req); }
    catch { return send(res, 400, { error: "Invalid JSON" }); }

    const { dcp_version, agent_id, human_id, revoked_kid, timestamp, reason, composite_sig } = body;

    if (!agent_id || !revoked_kid || !reason || !composite_sig) {
      return send(res, 400, {
        error: "Missing required fields: agent_id, revoked_kid, reason, composite_sig",
      });
    }

    if (dcp_version !== "2.0") {
      return send(res, 400, { error: "V2 revocation requires dcp_version: 2.0" });
    }

    if (!V2_REASONS.includes(reason) || tooLong(human_id, timestamp)) {
      return send(res, 400, { error: `reason must be one of ${V2_REASONS.join(", ")}; human_id and timestamp at most 256 characters` });
    }

    if (kidOwners.get(revoked_kid) !== agent_id) {
      return send(res, 403, { error: "revoked_kid is not a registered key of agent_id" });
    }

    const signed = { dcp_version, agent_id, human_id, revoked_kid, timestamp, reason };
    if (!(await verifyCompositeSig(DCP_CONTEXTS.Revocation, signed, composite_sig, activeKeys(agent_id)))) {
      return send(res, 403, { error: "composite_sig does not verify against the agent's active keys" });
    }

    const record = {
      dcp_version: "2.0",
      agent_id,
      human_id: human_id || "",
      revoked_kid,
      timestamp: timestamp || new Date().toISOString(),
      reason,
      composite_sig: { classical: sigEntry(composite_sig.classical), pq: sigEntry(composite_sig.pq) ?? null, binding: composite_sig.binding },
    };

    put("kidRevocations", revoked_kid, record);

    // Also revoke at agent level if no remaining active kids
    if (!revocations.has(agent_id)) {
      put("revocations", agent_id, {
        dcp_version: "2.0",
        agent_id,
        human_id: human_id || "",
        timestamp: record.timestamp,
        reason,
        signature: `composite:${revoked_kid}`,
        revoked_kids: [revoked_kid],
      });
    } else {
      const existing = revocations.get(agent_id);
      put("revocations", agent_id, { ...existing, revoked_kids: [...(existing.revoked_kids ?? []), revoked_kid] });
    }

    console.log(`[v2/revoke] Kid revoked: ${revoked_kid} (agent ${agent_id}) — ${reason}`);
    send(res, 201, {
      ok: true,
      agent_id,
      revoked_kid,
      revoked_at: record.timestamp,
    });
    return;
  }

  // ── V2: Emergency revocation (panic button) ──
  if (req.method === "POST" && req.url === "/v2/emergency-revoke") {
    const ip = getClientIp(req);
    if (!checkRateLimit(ip)) {
      return send(res, 429, {
        error: "Rate limit exceeded for emergency revocation. Try again later.",
      });
    }

    let body;
    try { body = await parseBody(req); }
    catch { return send(res, 400, { error: "Invalid JSON" }); }

    const { agent_id, human_id, revocation_secret, timestamp, reason } = body;

    if (!agent_id || !revocation_secret) {
      return send(res, 400, {
        error: "Missing required fields: agent_id, revocation_secret",
      });
    }

    // Validate secret format (must be 64 hex chars)
    if (!/^[0-9a-f]{64}$/.test(revocation_secret)) {
      return send(res, 400, { error: "Invalid revocation_secret format (expected 64 hex chars)" });
    }
    if (tooLong(human_id, timestamp, reason)) {
      return send(res, 400, { error: "Fields must be strings of at most 256 characters" });
    }

    // Look up the emergency token for this agent
    const agent = agents.get(agent_id);
    if (!agent?.token_hash) {
      return send(res, 404, {
        error: "No emergency revocation token registered for this agent",
      });
    }

    if (revocations.get(agent_id)?.emergency) {
      return send(res, 409, {
        error: "Emergency revocation token already consumed",
      });
    }

    // Verify: sha256(revocation_secret) == token_hash
    const secretBytes = Buffer.from(revocation_secret, "hex");
    const computedHash = crypto.createHash("sha256").update(secretBytes).digest("hex");
    const expectedHash = agent.token_hash.startsWith("sha256:")
      ? agent.token_hash.slice(7)
      : agent.token_hash;

    if (computedHash !== expectedHash) {
      console.log(`[emergency-revoke] FAILED attempt for agent ${agent_id} from ${ip}`);
      return send(res, 403, { error: "Invalid revocation secret" });
    }

    // Revoke ALL keys for this agent: /v2/check/kid resolves each kid's owner.
    const revokedAt = timestamp || new Date().toISOString();
    const keysRevoked = agent.keys.length;

    // Mark agent as emergency-revoked
    put("revocations", agent_id, {
      dcp_version: "2.0",
      agent_id,
      human_id: human_id || "",
      timestamp: revokedAt,
      reason: reason || "key_compromise_emergency",
      signature: "emergency_revocation",
      emergency: true,
    });

    console.log(`[emergency-revoke] Agent ${agent_id} emergency-revoked (${keysRevoked} kids affected)`);
    send(res, 200, {
      ok: true,
      agent_id,
      revoked_at: revokedAt,
      keys_revoked: keysRevoked,
    });
    return;
  }

  // ── Check by kid (V2) ──
  const kidCheckMatch = req.url?.match(/^\/v2\/check\/kid\/([^?]+)(?:\?(.*))?$/);
  if (req.method === "GET" && kidCheckMatch) {
    const kid = decodeParam(kidCheckMatch[1]);
    if (kid === null) return send(res, 400, { error: "Malformed kid" });
    // Only registered kids have a known owner. Any other kid gets an explicit unknown, never
    // a verdict borrowed from whichever agent a caller names.
    const owner = kidOwners.get(kid);
    if (!owner) {
      return send(res, 404, { kid, registered: false, error: "Kid not registered here: its revocation status is unknown" });
    }

    // Check explicit revocation
    const record = kidRevocations.get(kid);
    if (record) {
      return send(res, 200, {
        revoked: true,
        kid,
        agent_id: record.agent_id,
        reason: record.reason,
        revoked_at: record.timestamp,
      });
    }

    // Agent-level emergency revocation covers every kid of that agent.
    const agentRecord = revocations.get(owner);
    if (agentRecord?.emergency) {
      return send(res, 200, {
        revoked: true,
        kid,
        agent_id: owner,
        reason: "key_compromise_emergency",
        revoked_at: agentRecord.timestamp,
      });
    }

    // Short-lived cert expiry, from the registered key entry
    const expiresAt = agents.get(kidOwners.get(kid))?.keys.find((k) => k.kid === kid)?.expires_at;
    if (expiresAt && new Date(expiresAt) < new Date()) {
      return send(res, 200, {
        revoked: true,
        kid,
        reason: "expired",
        expires_at: expiresAt,
      });
    }

    return send(res, 200, { revoked: false, kid });
  }

  // ── V1: List all revocations ──
  if (req.method === "GET" && req.url === "/list") {
    const list = Array.from(revocations.values());
    send(res, 200, { revocations: list, total: list.length });
    return;
  }

  // ── V2: List all revocations (includes kid-level) ──
  if (req.method === "GET" && req.url === "/v2/list") {
    const agentList = Array.from(revocations.values());
    const kidList = Array.from(kidRevocations.values());
    send(res, 200, {
      dcp_version: "2.0",
      agent_revocations: agentList,
      kid_revocations: kidList,
      total_agents: agentList.length,
      total_kids: kidList.length,
    });
    return;
  }

  // ── .well-known format (V1 + V2) ──
  if (req.method === "GET" && req.url === "/.well-known/dcp-revocations.json") {
    const agentList = Array.from(revocations.values());
    const kidList = Array.from(kidRevocations.values());
    send(res, 200, {
      dcp_version: "2.0",
      updated_at: new Date().toISOString(),
      revocations: agentList,
      kid_revocations: kidList,
    });
    return;
  }

  // ── V1: Check specific agent ──
  const checkMatch = req.url?.match(/^\/check\/(.+)$/);
  if (req.method === "GET" && checkMatch) {
    const agentId = decodeParam(checkMatch[1]);
    if (agentId === null) return send(res, 400, { error: "Malformed agent_id" });
    const record = revocations.get(agentId);
    if (record) {
      return send(res, 200, { revoked: true, record });
    }
    return send(res, 200, { revoked: false, agent_id: agentId });
  }

  send(res, 404, { error: "Not found" });
}

// A throwing handler must not take the in-memory registry down with it.
const server = http.createServer((req, res) => {
  handle(req, res).catch((err) => {
    console.error(`[revocation] ${err.stack}`);
    if (!res.headersSent) send(res, 500, { error: "Internal server error" });
  });
});

server.listen(PORT, () => {
  console.log(`DCP Revocation Service listening on port ${PORT}`);
  console.log("  V1:");
  console.log("    POST /revoke                              — publish revocation (signed)");
  console.log("    GET  /list                                — list all revocations");
  console.log("    GET  /check/:agent_id                     — check agent status");
  console.log("  V2:");
  console.log("    POST /v2/register                         — register keys + emergency token (signed passport)");
  console.log("    POST /v2/revoke                           — kid-level revocation (signed)");
  console.log("    POST /v2/emergency-revoke                 — panic button revocation");
  console.log("    GET  /v2/check/kid/:kid                   — check kid revocation");
  console.log("    GET  /v2/list                             — list all (agent + kid)");
  console.log("  Shared:");
  console.log("    GET  /.well-known/dcp-revocations.json    — standard format");
});
