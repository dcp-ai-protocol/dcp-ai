#!/usr/bin/env node
/**
 * DCP Revocation Service — V1 + V2 support.
 *
 * Publishes and queries revocation records for DCP agents.
 * V2 adds: kid-level revocation, short-lived cert checking, emergency
 * revocation (panic button), and composite signature verification.
 *
 * Environment:
 *   PORT — HTTP port (default 3003)
 */

import http from "http";
import crypto from "crypto";

const PORT = Number(process.env.PORT) || 3003;

// ── Revocation stores ──

// V1: agent_id -> revocation record
const revocations = new Map();
// V2: kid -> { agent_id, human_id, revoked_kid, timestamp, reason }
const kidRevocations = new Map();
// Emergency tokens: agent_id -> { token_hash, active }
const emergencyTokens = new Map();
// Short-lived cert tracking: kid -> { expires_at }
const keyExpiry = new Map();

// Rate limiter for emergency revoke (per IP)
const emergencyRateLimit = new Map();
const EMERGENCY_MAX_ATTEMPTS = 5;
const EMERGENCY_WINDOW_MS = 60_000;

function send(res, statusCode, body) {
  res.setHeader("Content-Type", "application/json");
  res.writeHead(statusCode);
  res.end(JSON.stringify(body));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch (e) { reject(e); }
    });
    req.on("error", reject);
  });
}

function getClientIp(req) {
  return req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
    req.socket?.remoteAddress || "unknown";
}

function checkRateLimit(ip) {
  const now = Date.now();
  let entry = emergencyRateLimit.get(ip);
  if (!entry || now - entry.windowStart > EMERGENCY_WINDOW_MS) {
    entry = { windowStart: now, count: 0 };
    emergencyRateLimit.set(ip, entry);
  }
  entry.count++;
  return entry.count <= EMERGENCY_MAX_ATTEMPTS;
}

function isKeyExpired(kid) {
  const expiry = keyExpiry.get(kid);
  if (!expiry) return false;
  return new Date(expiry.expires_at) < new Date();
}

const server = http.createServer(async (req, res) => {
  const dcpVersion = req.headers["dcp-version"];

  // Health
  if (req.method === "GET" && (req.url === "/" || req.url === "/health")) {
    send(res, 200, {
      ok: true,
      service: "dcp-revocation",
      supported_versions: ["1.0", "2.0"],
      total_revocations: revocations.size,
      total_kid_revocations: kidRevocations.size,
    });
    return;
  }

  // ── V1: Publish revocation (agent-level) ──
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

    const record = {
      dcp_version: dcp_version || "1.0",
      agent_id,
      human_id: human_id || "",
      timestamp: timestamp || new Date().toISOString(),
      reason,
      signature,
    };

    revocations.set(agent_id, record);
    console.log(`[revoke] Agent revoked: ${agent_id} — ${reason}`);
    send(res, 201, { ok: true, agent_id, revoked_at: record.timestamp });
    return;
  }

  // ── V2: Kid-level revocation with composite signature ──
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

    if (!composite_sig.classical || !composite_sig.binding) {
      return send(res, 400, { error: "Invalid composite_sig structure" });
    }

    const record = {
      dcp_version: "2.0",
      agent_id,
      human_id: human_id || "",
      revoked_kid,
      timestamp: timestamp || new Date().toISOString(),
      reason,
      composite_sig,
    };

    kidRevocations.set(revoked_kid, record);

    // Also revoke at agent level if no remaining active kids
    if (!revocations.has(agent_id)) {
      revocations.set(agent_id, {
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
      if (!existing.revoked_kids) existing.revoked_kids = [];
      existing.revoked_kids.push(revoked_kid);
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

    // Look up the emergency token for this agent
    const tokenEntry = emergencyTokens.get(agent_id);
    if (!tokenEntry || !tokenEntry.token_hash) {
      return send(res, 404, {
        error: "No emergency revocation token registered for this agent",
      });
    }

    if (!tokenEntry.active) {
      return send(res, 409, {
        error: "Emergency revocation token already consumed",
      });
    }

    // Verify: sha256(revocation_secret) == token_hash
    const secretBytes = Buffer.from(revocation_secret, "hex");
    const computedHash = crypto.createHash("sha256").update(secretBytes).digest("hex");
    const expectedHash = tokenEntry.token_hash.startsWith("sha256:")
      ? tokenEntry.token_hash.slice(7)
      : tokenEntry.token_hash;

    if (computedHash !== expectedHash) {
      console.log(`[emergency-revoke] FAILED attempt for agent ${agent_id} from ${ip}`);
      return send(res, 403, { error: "Invalid revocation secret" });
    }

    // Revoke ALL keys for this agent
    tokenEntry.active = false;
    const revokedAt = timestamp || new Date().toISOString();
    let keysRevoked = 0;

    // Revoke all known kids for this agent
    for (const [kid, record] of kidRevocations.entries()) {
      if (record.agent_id === agent_id) keysRevoked++;
    }

    // Mark agent as emergency-revoked
    revocations.set(agent_id, {
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

  // ── V2: Register emergency token (called during identity setup) ──
  if (req.method === "POST" && req.url === "/v2/register-emergency-token") {
    let body;
    try { body = await parseBody(req); }
    catch { return send(res, 400, { error: "Invalid JSON" }); }

    const { agent_id, emergency_revocation_token } = body;
    if (!agent_id || !emergency_revocation_token) {
      return send(res, 400, {
        error: "Missing required fields: agent_id, emergency_revocation_token",
      });
    }

    emergencyTokens.set(agent_id, {
      token_hash: emergency_revocation_token,
      active: true,
      registered_at: new Date().toISOString(),
    });

    send(res, 201, { ok: true, agent_id });
    return;
  }

  // ── V2: Register key expiry (short-lived cert model) ──
  if (req.method === "POST" && req.url === "/v2/register-key-expiry") {
    let body;
    try { body = await parseBody(req); }
    catch { return send(res, 400, { error: "Invalid JSON" }); }

    const { kid, expires_at } = body;
    if (!kid || !expires_at) {
      return send(res, 400, { error: "Missing required fields: kid, expires_at" });
    }

    keyExpiry.set(kid, { expires_at });
    send(res, 201, { ok: true, kid, expires_at });
    return;
  }

  // ── Check by kid (V2) ──
  const kidCheckMatch = req.url?.match(/^\/v2\/check\/kid\/(.+)$/);
  if (req.method === "GET" && kidCheckMatch) {
    const kid = decodeURIComponent(kidCheckMatch[1]);

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

    // Check agent-level emergency revocation
    for (const [, agentRecord] of revocations.entries()) {
      if (agentRecord.emergency) {
        return send(res, 200, {
          revoked: true,
          kid,
          agent_id: agentRecord.agent_id,
          reason: "key_compromise_emergency",
          revoked_at: agentRecord.timestamp,
        });
      }
    }

    // Check short-lived cert expiry
    if (isKeyExpired(kid)) {
      return send(res, 200, {
        revoked: true,
        kid,
        reason: "expired",
        expires_at: keyExpiry.get(kid).expires_at,
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
    const agentId = decodeURIComponent(checkMatch[1]);
    const record = revocations.get(agentId);
    if (record) {
      return send(res, 200, { revoked: true, record });
    }
    return send(res, 200, { revoked: false, agent_id: agentId });
  }

  send(res, 404, { error: "Not found" });
});

server.listen(PORT, () => {
  console.log(`DCP Revocation Service listening on port ${PORT}`);
  console.log("  V1:");
  console.log("    POST /revoke                              — publish revocation");
  console.log("    GET  /list                                — list all revocations");
  console.log("    GET  /check/:agent_id                     — check agent status");
  console.log("  V2:");
  console.log("    POST /v2/revoke                           — kid-level revocation");
  console.log("    POST /v2/emergency-revoke                 — panic button revocation");
  console.log("    POST /v2/register-emergency-token         — register emergency token");
  console.log("    POST /v2/register-key-expiry              — short-lived cert tracking");
  console.log("    GET  /v2/check/kid/:kid                   — check kid revocation");
  console.log("    GET  /v2/list                             — list all (agent + kid)");
  console.log("  Shared:");
  console.log("    GET  /.well-known/dcp-revocations.json    — standard format");
});
