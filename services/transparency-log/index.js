#!/usr/bin/env node
/**
 * DCP Transparency Log Service
 *
 * Certificate Transparency-style append-only log for DCP bundle hashes.
 * Provides Merkle inclusion proofs for any entry.
 *
 * Environment:
 *   PORT — HTTP port (default 3002)
 */

import http from "http";
import crypto from "crypto";

const PORT = Number(process.env.PORT) || 3002;

// ── Append-only log ──
const log = []; // Array of { hash, timestamp, index }
let treeHashes = []; // Leaf hashes for Merkle tree

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
      size: log.length,
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

  // Get signed root (placeholder — in production, sign with operator key)
  if (req.method === "GET" && req.url === "/root/signed") {
    const root = computeMerkleRoot(treeHashes);
    send(res, 200, {
      root,
      size: log.length,
      timestamp: new Date().toISOString(),
      signature: "placeholder-implement-operator-signing",
    });
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

  send(res, 404, { error: "Not found" });
});

server.listen(PORT, () => {
  console.log(`DCP Transparency Log listening on port ${PORT}`);
  console.log("  POST /add           — add bundle_hash to log");
  console.log("  GET  /root          — current Merkle root");
  console.log("  GET  /root/signed   — signed Merkle root");
  console.log("  GET  /proof/:index  — Merkle inclusion proof");
  console.log("  GET  /entries       — list all entries");
});
