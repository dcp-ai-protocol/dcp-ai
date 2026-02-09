#!/usr/bin/env node
/**
 * DCP Revocation Service
 *
 * Publishes and queries revocation records for DCP agents.
 * Serves revocations in .well-known/dcp-revocations.json format.
 *
 * Environment:
 *   PORT — HTTP port (default 3003)
 */

import http from "http";

const PORT = Number(process.env.PORT) || 3003;

// ── In-memory revocation store ──
const revocations = new Map(); // agent_id -> revocation record

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

const server = http.createServer(async (req, res) => {
  // Health
  if (req.method === "GET" && (req.url === "/" || req.url === "/health")) {
    send(res, 200, {
      ok: true,
      service: "dcp-revocation",
      total_revocations: revocations.size,
    });
    return;
  }

  // Publish revocation
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

  // List all revocations
  if (req.method === "GET" && req.url === "/list") {
    const list = Array.from(revocations.values());
    send(res, 200, { revocations: list, total: list.length });
    return;
  }

  // .well-known format
  if (req.method === "GET" && req.url === "/.well-known/dcp-revocations.json") {
    const list = Array.from(revocations.values());
    send(res, 200, {
      dcp_version: "1.0",
      updated_at: new Date().toISOString(),
      revocations: list,
    });
    return;
  }

  // Check specific agent
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
  console.log("  POST /revoke                           — publish revocation");
  console.log("  GET  /list                             — list all revocations");
  console.log("  GET  /check/:agent_id                  — check agent status");
  console.log("  GET  /.well-known/dcp-revocations.json — standard format");
});
