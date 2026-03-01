#!/usr/bin/env node
/**
 * DCP Transparency Log Service
 *
 * Certificate Transparency-style append-only log for DCP bundle hashes.
 * Provides Merkle inclusion proofs for any entry.
 * Supports gossip protocol for cross-log split-view detection.
 *
 * Environment:
 *   PORT          — HTTP port (default 3002)
 *   LOG_ID        — Unique identifier for this log instance
 *   OPERATOR_KEY  — Hex-encoded operator secret for signing STHs
 *   GOSSIP_PEERS  — Comma-separated list of peer endpoints (e.g. "http://log-b:3002,http://log-c:3002")
 *   GOSSIP_INTERVAL_MS — Gossip polling interval in ms (default 30000)
 */

import http from "http";
import crypto from "crypto";
import { GossipManager } from "./gossip.js";

const PORT = Number(process.env.PORT) || 3002;
const LOG_ID = process.env.LOG_ID || `log-${crypto.randomUUID().slice(0, 8)}`;

const operatorSecret = process.env.OPERATOR_KEY || crypto.randomBytes(32).toString("hex");
const operatorKeyPair = {
  secretKey: operatorSecret,
  publicKey: crypto.createHash("sha256").update(operatorSecret).digest("hex"),
};

// ── Append-only log ──
const log = [];
let treeHashes = [];
const alerts = [];

function sha256Hex(data) {
  return crypto.createHash("sha256").update(data).digest("hex");
}

function computeMerkleRoot(leaves) {
  if (!leaves || leaves.length === 0) return null;
  let layer = leaves.slice();
  while (layer.length > 1) {
    if (layer.length % 2 === 1) layer.push(layer[layer.length - 1]);
    const next = [];
    for (let i = 0; i < layer.length; i += 2) {
      const left = Buffer.from(layer[i], "hex");
      const right = Buffer.from(layer[i + 1], "hex");
      next.push(sha256Hex(Buffer.concat([left, right])));
    }
    layer = next;
  }
  return layer[0];
}

function computeInclusionProof(index, leaves) {
  if (index < 0 || index >= leaves.length) return null;

  const proof = [];
  let layer = leaves.slice();
  let idx = index;

  while (layer.length > 1) {
    if (layer.length % 2 === 1) layer.push(layer[layer.length - 1]);

    if (idx % 2 === 0) {
      proof.push({ hash: layer[idx + 1], direction: "right" });
    } else {
      proof.push({ hash: layer[idx - 1], direction: "left" });
    }

    const next = [];
    for (let i = 0; i < layer.length; i += 2) {
      const left = Buffer.from(layer[i], "hex");
      const right = Buffer.from(layer[i + 1], "hex");
      next.push(sha256Hex(Buffer.concat([left, right])));
    }
    layer = next;
    idx = Math.floor(idx / 2);
  }

  return proof;
}

function getLocalSTH() {
  return { root: computeMerkleRoot(treeHashes), size: log.length };
}

// ── Gossip Manager ──
const gossipManager = new GossipManager({
  operatorKeyPair,
  logId: LOG_ID,
  getLocalSTH,
  onInconsistency: (alert) => {
    alerts.push(alert);
  },
});

if (process.env.GOSSIP_PEERS) {
  const peers = process.env.GOSSIP_PEERS.split(",").map(s => s.trim()).filter(Boolean);
  peers.forEach((endpoint, i) => {
    gossipManager.addPeer(`peer-${i}`, endpoint);
  });
}

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
      service: "dcp-transparency-log",
      log_id: LOG_ID,
      size: log.length,
      gossip_peers: gossipManager.getPeers().length,
      alerts: alerts.length,
    });
    return;
  }

  // Add entry
  if (req.method === "POST" && req.url === "/add") {
    let body;
    try { body = await parseBody(req); }
    catch { return send(res, 400, { error: "Invalid JSON" }); }

    const bundleHash = body.bundle_hash;
    if (!bundleHash) {
      return send(res, 400, { error: "Missing bundle_hash" });
    }

    const index = log.length;
    const leafHash = sha256Hex(Buffer.from(bundleHash, "utf8"));
    const entry = {
      hash: bundleHash,
      leaf_hash: leafHash,
      timestamp: new Date().toISOString(),
      index,
    };
    log.push(entry);
    treeHashes.push(leafHash);

    const root = computeMerkleRoot(treeHashes);
    send(res, 200, { index, leaf_hash: leafHash, root, size: log.length });
    return;
  }

  // Get root
  if (req.method === "GET" && req.url === "/root") {
    const root = computeMerkleRoot(treeHashes);
    send(res, 200, { root, size: log.length });
    return;
  }

  // Get signed root (Signed Tree Head)
  if (req.method === "GET" && req.url === "/root/signed") {
    const root = computeMerkleRoot(treeHashes);
    const sth = gossipManager.signTreeHead(root, log.length);
    send(res, 200, sth);
    return;
  }

  // Get proof
  const proofMatch = req.url?.match(/^\/proof\/(\d+)$/);
  if (req.method === "GET" && proofMatch) {
    const index = parseInt(proofMatch[1], 10);
    if (index < 0 || index >= log.length) {
      return send(res, 404, { error: `Index ${index} not found (log size: ${log.length})` });
    }

    const proof = computeInclusionProof(index, treeHashes);
    const root = computeMerkleRoot(treeHashes);
    send(res, 200, {
      index,
      leaf_hash: treeHashes[index],
      entry: log[index],
      root,
      proof,
    });
    return;
  }

  // List entries
  if (req.method === "GET" && req.url === "/entries") {
    send(res, 200, { entries: log, size: log.length });
    return;
  }

  // ── Gossip endpoints ──

  // List gossip peers
  if (req.method === "GET" && req.url === "/gossip/peers") {
    send(res, 200, {
      log_id: LOG_ID,
      peers: gossipManager.getPeers(),
      alerts: alerts.slice(-20),
    });
    return;
  }

  // Gossip exchange — receive peer's STH, return ours, detect split-view
  if (req.method === "POST" && req.url === "/gossip/exchange") {
    let body;
    try { body = await parseBody(req); }
    catch { return send(res, 400, { error: "Invalid JSON" }); }

    const result = gossipManager.handleExchange(body.sth);
    send(res, 200, result);
    return;
  }

  // Add gossip peer dynamically
  if (req.method === "POST" && req.url === "/gossip/peers") {
    let body;
    try { body = await parseBody(req); }
    catch { return send(res, 400, { error: "Invalid JSON" }); }

    if (!body.peer_id || !body.endpoint) {
      return send(res, 400, { error: "Missing peer_id or endpoint" });
    }

    gossipManager.addPeer(body.peer_id, body.endpoint);
    send(res, 200, { added: body.peer_id, peers: gossipManager.getPeers().length });
    return;
  }

  // Security alerts
  if (req.method === "GET" && req.url === "/gossip/alerts") {
    send(res, 200, { alerts, count: alerts.length });
    return;
  }

  send(res, 404, { error: "Not found" });
});

server.listen(PORT, () => {
  console.log(`DCP Transparency Log [${LOG_ID}] listening on port ${PORT}`);
  console.log("  POST /add              — add bundle_hash to log");
  console.log("  GET  /root             — current Merkle root");
  console.log("  GET  /root/signed      — signed tree head (STH)");
  console.log("  GET  /proof/:index     — Merkle inclusion proof");
  console.log("  GET  /entries          — list all entries");
  console.log("  GET  /gossip/peers     — list gossip peers");
  console.log("  POST /gossip/exchange  — gossip STH exchange");
  console.log("  POST /gossip/peers     — add gossip peer");
  console.log("  GET  /gossip/alerts    — split-view security alerts");

  const pollInterval = Number(process.env.GOSSIP_INTERVAL_MS) || 30_000;
  if (gossipManager.getPeers().length > 0) {
    gossipManager.startPolling(pollInterval);
  }
});
