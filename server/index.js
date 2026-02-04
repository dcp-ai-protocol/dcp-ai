#!/usr/bin/env node
/**
 * Reference verification service: POST /verify (and optional POST /anchor stub).
 * Stateless; no database. Run from repo root: node server/index.js
 */
import http from "http";
import { verifySignedBundle } from "../lib/verify.js";

const PORT = Number(process.env.PORT) || 3000;

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
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === "GET" && (req.url === "/" || req.url === "/health")) {
    send(res, 200, { ok: true, service: "dcp-verification" });
    return;
  }

  if (req.method === "POST" && req.url === "/verify") {
    let body;
    try {
      body = await parseBody(req);
    } catch {
      send(res, 400, { verified: false, errors: ["Invalid JSON body"] });
      return;
    }
    const signedBundle = body.signed_bundle;
    const publicKeyB64 = body.public_key_b64 || signedBundle?.signature?.signer?.public_key_b64;
    if (!signedBundle) {
      send(res, 400, { verified: false, errors: ["Missing signed_bundle in body"] });
      return;
    }
    const result = verifySignedBundle(signedBundle, publicKeyB64);
    if (result.verified) {
      send(res, 200, { verified: true });
    } else {
      send(res, 200, { verified: false, errors: result.errors || [] });
    }
    return;
  }

  if (req.method === "POST" && req.url === "/anchor") {
    // Stub: anchoring is operator-specific (Bitcoin OP_RETURN, Ethereum event, etc.).
    // Configure via ANCHOR_CHAIN_RPC, wallet, etc. and implement per chain.
    send(res, 501, {
      error: "Anchor not implemented in reference server",
      hint: "Configure your own anchor (Bitcoin, Ethereum, or transparency log) per docs/OPERATOR_GUIDE.md and docs/STORAGE_AND_ANCHORING.md"
    });
    return;
  }

  send(res, 404, { error: "Not found" });
});

server.listen(PORT, () => {
  console.log(`DCP verification service listening on port ${PORT}`);
  console.log("  POST /verify — verify a signed bundle");
  console.log("  POST /anchor — stub (501); implement per operator");
});
