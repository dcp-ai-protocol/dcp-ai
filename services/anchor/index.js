#!/usr/bin/env node
/**
 * DCP Anchoring Service
 *
 * Accumulates bundle hashes and anchors them to an EVM L2 chain
 * either individually or as batch Merkle roots.
 *
 * Environment:
 *   PORT              — HTTP port (default 3001)
 *   ANCHOR_RPC_URL    — L2 JSON-RPC endpoint
 *   ANCHOR_PRIVATE_KEY — Wallet private key (for signing txs)
 *   ANCHOR_CONTRACT   — DCPAnchor contract address
 *   ANCHOR_MODE       — 'individual' or 'batch' (default: batch)
 *   BATCH_INTERVAL_MS — Batch flush interval in ms (default: 60000)
 */

import http from "http";
import crypto from "crypto";

const PORT = Number(process.env.PORT) || 3001;
const ANCHOR_MODE = process.env.ANCHOR_MODE || "batch";
const BATCH_INTERVAL = Number(process.env.BATCH_INTERVAL_MS) || 60000;

// ── In-memory batch accumulator ──
let pendingHashes = [];
const anchoredRecords = [];

function sha256Hex(data) {
  return crypto.createHash("sha256").update(data).digest("hex");
}

function merkleRoot(leaves) {
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

async function anchorToChain(hash, count = 1) {
  // Placeholder: In production, use ethers.js to call DCPAnchor contract
  // const provider = new ethers.JsonRpcProvider(process.env.ANCHOR_RPC_URL);
  // const wallet = new ethers.Wallet(process.env.ANCHOR_PRIVATE_KEY, provider);
  // const contract = new ethers.Contract(process.env.ANCHOR_CONTRACT, ABI, wallet);
  // const tx = count > 1
  //   ? await contract.anchorBatch(`0x${hash}`, count)
  //   : await contract.anchorBundle(`0x${hash}`);
  // return { tx_hash: tx.hash };

  const record = {
    hash: `sha256:${hash}`,
    count,
    timestamp: new Date().toISOString(),
    tx_hash: `0x${crypto.randomBytes(32).toString("hex")}`, // simulated
    chain: process.env.ANCHOR_CHAIN || "base",
  };
  anchoredRecords.push(record);
  return record;
}

async function flushBatch() {
  if (pendingHashes.length === 0) return;
  const hashes = pendingHashes.slice();
  pendingHashes = [];

  if (hashes.length === 1) {
    const hex = hashes[0].startsWith("sha256:") ? hashes[0].slice(7) : hashes[0];
    await anchorToChain(hex, 1);
  } else {
    const leaves = hashes.map((h) => (h.startsWith("sha256:") ? h.slice(7) : h));
    const root = merkleRoot(leaves);
    await anchorToChain(root, leaves.length);
  }
  console.log(`[anchor] Flushed batch of ${hashes.length} hashes`);
}

// Periodic batch flush
if (ANCHOR_MODE === "batch") {
  setInterval(flushBatch, BATCH_INTERVAL);
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
      service: "dcp-anchor",
      mode: ANCHOR_MODE,
      pending: pendingHashes.length,
      total_anchored: anchoredRecords.length,
    });
    return;
  }

  // Anchor
  if (req.method === "POST" && req.url === "/anchor") {
    let body;
    try { body = await parseBody(req); }
    catch { return send(res, 400, { error: "Invalid JSON" }); }

    const bundleHash = body.bundle_hash;
    if (!bundleHash) {
      return send(res, 400, { error: "Missing bundle_hash" });
    }

    if (ANCHOR_MODE === "individual") {
      const hex = bundleHash.startsWith("sha256:") ? bundleHash.slice(7) : bundleHash;
      const record = await anchorToChain(hex, 1);
      return send(res, 200, { anchored: true, ...record });
    }

    // Batch mode: accumulate
    pendingHashes.push(bundleHash);
    return send(res, 202, {
      accepted: true,
      bundle_hash: bundleHash,
      position: pendingHashes.length,
      hint: `Will be anchored in next batch (interval: ${BATCH_INTERVAL}ms)`,
    });
  }

  // Check anchor status
  if (req.method === "GET" && req.url?.startsWith("/status/")) {
    const hash = decodeURIComponent(req.url.slice("/status/".length));
    const record = anchoredRecords.find((r) => r.hash === hash);
    if (record) {
      return send(res, 200, { anchored: true, ...record });
    }
    const pending = pendingHashes.includes(hash);
    return send(res, 200, { anchored: false, pending });
  }

  // List anchored
  if (req.method === "GET" && req.url === "/anchored") {
    return send(res, 200, { records: anchoredRecords });
  }

  // Flush batch manually
  if (req.method === "POST" && req.url === "/flush") {
    await flushBatch();
    return send(res, 200, { flushed: true });
  }

  send(res, 404, { error: "Not found" });
});

server.listen(PORT, () => {
  console.log(`DCP Anchoring Service listening on port ${PORT}`);
  console.log(`  Mode: ${ANCHOR_MODE}`);
  console.log(`  POST /anchor   — submit bundle_hash`);
  console.log(`  GET  /status/:hash — check anchor status`);
  console.log(`  GET  /anchored — list all anchored records`);
  console.log(`  POST /flush    — manually flush batch`);
});
