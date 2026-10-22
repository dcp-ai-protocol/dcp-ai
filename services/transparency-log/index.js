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
 *   OPERATOR_KEY  — Ed25519 seed for signing STHs: 64 hex chars (openssl rand -hex 32)
 *   OPERATOR_TOKEN — Bearer token required by POST /gossip/peers
 *   GOSSIP_PEERS  — Comma-separated peers, each "<endpoint>#<base64 Ed25519 public key>"
 *                   (e.g. "http://log-b:3002#q1w2..."); tree heads from unpinned peers are ignored
 *   GOSSIP_INTERVAL_MS — Gossip polling interval in ms (default 30000)
 */

import http from "http";
import crypto from "crypto";
import nacl from "tweetnacl";
import { GossipManager, isWellFormedSTH } from "./gossip.js";
import { isOperator, parseBody } from "../../lib/http.js";

const PORT = Number(process.env.PORT) || 3002;
const LOG_ID = process.env.LOG_ID || `log-${crypto.randomUUID().slice(0, 8)}`;

// STHs are Ed25519-signed so anyone holding the public key can verify them.
// OPERATOR_KEY is the 32-byte seed itself: a passphrase (like the old compose
// placeholders) would make the signing key guessable. Without it the key is
// ephemeral and changes on every restart.
const { OPERATOR_KEY } = process.env;
if (OPERATOR_KEY && !/^[0-9a-f]{64}$/i.test(OPERATOR_KEY)) {
  throw new Error("OPERATOR_KEY must be 64 hex characters (32 random bytes: openssl rand -hex 32)");
}
if (!OPERATOR_KEY) {
  console.warn("[tlog] OPERATOR_KEY not set: STHs are signed with an ephemeral key");
}
const seed = OPERATOR_KEY ? Buffer.from(OPERATOR_KEY, "hex") : crypto.randomBytes(32);
const { secretKey, publicKey } = nacl.sign.keyPair.fromSeed(seed);
const operatorKeyPair = {
  secretKey: Buffer.from(secretKey).toString("base64"),
  publicKey: Buffer.from(publicKey).toString("base64"),
};

// ── Append-only log ──
const log = [];
let treeHashes = [];
const alerts = [];
const MAX_ALERTS = 100; // the most recent ones

function sha256Hex(data) {
  return crypto.createHash("sha256").update(data).digest("hex");
}

// RFC 6962 §2.1: leaves and interior nodes hash with distinct prefixes, so a
// leaf can never pass for a subtree root.
function leafHash(data) {
  return sha256Hex(Buffer.concat([Buffer.from([0x00]), Buffer.from(data, "utf8")]));
}

function nodeHash(left, right) {
  return sha256Hex(Buffer.concat([Buffer.from([0x01]), Buffer.from(left, "hex"), Buffer.from(right, "hex")]));
}

// Largest power of two below n (n >= 2). Splitting here instead of duplicating
// the last node keeps [a,b,c] and [a,b,c,c] from sharing a root.
function splitPoint(n) {
  let k = 1;
  while (k * 2 < n) k *= 2;
  return k;
}

// ponytail: recomputed per request, O(n); cache subtree roots if the log grows large.
function computeMerkleRoot(leaves, lo = 0, hi = leaves.length) {
  if (hi === lo) return null;
  if (hi - lo === 1) return leaves[lo];
  const k = lo + splitPoint(hi - lo);
  return nodeHash(computeMerkleRoot(leaves, lo, k), computeMerkleRoot(leaves, k, hi));
}

// Audit path, leaf to root; `direction` is the side the sibling hash goes on.
function computeInclusionProof(index, leaves, lo = 0, hi = leaves.length) {
  if (hi - lo === 1) return [];
  const k = lo + splitPoint(hi - lo);
  return index < k
    ? [...computeInclusionProof(index, leaves, lo, k), { hash: computeMerkleRoot(leaves, k, hi), direction: "right" }]
    : [...computeInclusionProof(index, leaves, k, hi), { hash: computeMerkleRoot(leaves, lo, k), direction: "left" }];
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
    // Signed tree heads are public: a replayed one must not push older alerts out.
    if (alerts.some((a) => a.peer_id === alert.peer_id && a.tree_size === alert.tree_size &&
        a.peer_root === alert.peer_root)) return;
    alerts.push(alert);
    if (alerts.length > MAX_ALERTS) alerts.shift();
  },
});

if (process.env.GOSSIP_PEERS) {
  const peers = process.env.GOSSIP_PEERS.split(",").map(s => s.trim()).filter(Boolean);
  peers.forEach((entry, i) => {
    const [endpoint, publicKey] = entry.split("#");
    if (!publicKey) console.warn(`[gossip] ${endpoint} has no pinned public key: its tree heads will be ignored`);
    gossipManager.addPeer(`peer-${i}`, endpoint, publicKey);
  });
}

function send(res, statusCode, body) {
  res.setHeader("Content-Type", "application/json");
  res.writeHead(statusCode);
  res.end(JSON.stringify(body));
}

async function handle(req, res) {
  // Health
  if (req.method === "GET" && (req.url === "/" || req.url === "/health")) {
    send(res, 200, {
      ok: true,
      service: "dcp-transparency-log",
      log_id: LOG_ID,
      public_key: operatorKeyPair.publicKey,
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
    if (typeof bundleHash !== "string" || !/^sha256:[0-9a-f]{64}$/.test(bundleHash)) {
      return send(res, 400, { error: "bundle_hash must be sha256:<64 hex chars>" });
    }

    const index = log.length;
    const leaf = leafHash(bundleHash);
    const entry = {
      hash: bundleHash,
      leaf_hash: leaf,
      timestamp: new Date().toISOString(),
      index,
    };
    log.push(entry);
    treeHashes.push(leaf);

    const root = computeMerkleRoot(treeHashes);
    send(res, 200, { index, leaf_hash: leaf, root, size: log.length });
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

  // Gossip exchange — receive a pinned peer's STH, return ours, detect split-view.
  // Open to anyone, so the STH must be well formed and signed by a pinned peer
  // before it is compared or recorded in an alert.
  if (req.method === "POST" && req.url === "/gossip/exchange") {
    let body;
    try { body = await parseBody(req, 16_384); }
    catch { return send(res, 400, { error: "Invalid JSON or body too large" }); }

    if (!isWellFormedSTH(body.sth)) {
      return send(res, 400, { error: "Malformed STH" });
    }
    const peerId = gossipManager.findSigner(body.sth);
    if (!peerId) {
      return send(res, 403, { error: "STH is not signed by a pinned gossip peer" });
    }

    send(res, 200, gossipManager.handleExchange(body.sth, peerId));
    return;
  }

  // Add gossip peer dynamically. The log fetches peers itself, so an open
  // endpoint would let anyone point it at internal URLs (SSRF).
  if (req.method === "POST" && req.url === "/gossip/peers") {
    if (!isOperator(req)) {
      res.setHeader("WWW-Authenticate", "Bearer");
      return send(res, 401, { error: "Operator token required (Authorization: Bearer <OPERATOR_TOKEN>)" });
    }

    let body;
    try { body = await parseBody(req); }
    catch { return send(res, 400, { error: "Invalid JSON" }); }

    if (!body.peer_id || !/^https?:\/\//.test(body.endpoint)) {
      return send(res, 400, { error: "Missing peer_id or http(s) endpoint" });
    }
    if (body.public_key !== undefined && !(typeof body.public_key === "string" &&
        Buffer.from(body.public_key, "base64").length === 32)) {
      return send(res, 400, { error: "public_key must be a base64 Ed25519 public key" });
    }

    gossipManager.addPeer(body.peer_id, body.endpoint, body.public_key);
    send(res, 200, { added: body.peer_id, peers: gossipManager.getPeers().length });
    return;
  }

  // Security alerts
  if (req.method === "GET" && req.url === "/gossip/alerts") {
    send(res, 200, { alerts, count: alerts.length });
    return;
  }

  send(res, 404, { error: "Not found" });
}

// A throwing handler must not take the in-memory log down with it.
const server = http.createServer((req, res) => {
  handle(req, res).catch((err) => {
    console.error(`[tlog] ${err.stack}`);
    if (!res.headersSent) send(res, 500, { error: "Internal server error" });
  });
});

server.listen(PORT, () => {
  console.log(`DCP Transparency Log [${LOG_ID}] listening on port ${PORT}`);
  console.log(`  STH public key (Ed25519): ${operatorKeyPair.publicKey}`);
  console.log("  POST /add              — add bundle_hash to log");
  console.log("  GET  /root             — current Merkle root");
  console.log("  GET  /root/signed      — signed tree head (STH)");
  console.log("  GET  /proof/:index     — Merkle inclusion proof");
  console.log("  GET  /entries          — list all entries");
  console.log("  GET  /gossip/peers     — list gossip peers");
  console.log("  POST /gossip/exchange  — gossip STH exchange");
  console.log("  POST /gossip/peers     — add gossip peer (operator token)");
  console.log("  GET  /gossip/alerts    — split-view security alerts");

  const pollInterval = Number(process.env.GOSSIP_INTERVAL_MS) || 30_000;
  if (gossipManager.getPeers().length > 0) {
    gossipManager.startPolling(pollInterval);
  }
});
