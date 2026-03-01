#!/usr/bin/env node
/**
 * Generate V2 conformance examples with composite signatures, dual hashes,
 * session binding, and bundle manifests.
 * Run from repo root: node scripts/generate-v2-examples.js
 */
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { generateKeypair, signComposite, computeKid, generateHybridKeypair } from "../tools/crypto.js";
import { intentHash, hashObject, dualHashObject, generateBundleManifest } from "../tools/merkle.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const examplesDir = path.join(root, "tests", "conformance", "examples");

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

ensureDir(examplesDir);

const sessionNonce = crypto.randomBytes(32).toString("hex");
const hybrid = generateHybridKeypair();
const edKid = hybrid.classical.kid;
const pqKid = hybrid.pq.kid;

const now = "2026-03-01T00:00:00Z";

// --- V2 RPR ---
const rpr = {
  dcp_version: "2.0",
  human_id: "human:alice-v2-001",
  session_nonce: sessionNonce,
  legal_name: "Alice V2 Example",
  entity_type: "natural_person",
  jurisdiction: "US-CA",
  liability_mode: "owner_responsible",
  override_rights: true,
  issued_at: now,
  expires_at: "2027-03-01T00:00:00Z",
  binding_keys: [
    {
      kid: edKid.padEnd(32, "0").slice(0, 32),
      alg: "ed25519",
      public_key_b64: hybrid.classical.publicKeyB64,
      created_at: now,
      expires_at: "2027-03-01T00:00:00Z",
      status: "active",
    },
    {
      kid: pqKid.padEnd(32, "0").slice(0, 32),
      alg: "ml-dsa-65",
      public_key_b64: hybrid.pq.publicKeyB64,
      created_at: now,
      expires_at: "2027-03-01T00:00:00Z",
      status: "active",
    },
  ],
};

// --- V2 Passport ---
const passport = {
  dcp_version: "2.0",
  agent_id: "agent:research-bot-v2-gen",
  session_nonce: sessionNonce,
  keys: rpr.binding_keys.map(k => ({ ...k })),
  principal_binding_reference: rpr.human_id,
  capabilities: ["browse", "api_call"],
  risk_tier: "medium",
  created_at: now,
  status: "active",
  emergency_revocation_token: `sha256:${crypto.randomBytes(32).toString("hex")}`,
};

// --- V2 Intent ---
const intent = {
  dcp_version: "2.0",
  intent_id: "intent:v2-email-gen-001",
  session_nonce: sessionNonce,
  agent_id: passport.agent_id,
  human_id: rpr.human_id,
  timestamp: "2026-03-01T12:00:00Z",
  action_type: "send_email",
  target: { channel: "email", to: "bob@example.com", domain: "example.com" },
  data_classes: ["contact_info"],
  estimated_impact: "low",
  requires_consent: false,
  security_tier: "standard",
};

const intentHashHex = intentHash(intent);
const dualIntent = dualHashObject(intent);

// --- V2 Policy Decision ---
const policyDecision = {
  dcp_version: "2.0",
  intent_id: intent.intent_id,
  session_nonce: sessionNonce,
  decision: "approve",
  risk_score: 150,
  reasons: ["Low-risk action", "Known recipient domain"],
  required_confirmation: null,
  applied_policy_hash: `sha256:${crypto.createHash("sha256").update("default-policy").digest("hex")}`,
  timestamp: "2026-03-01T12:00:01Z",
  resolved_tier: "standard",
};

// --- V2 Audit Entries ---
const audit1 = {
  dcp_version: "2.0",
  audit_id: "audit:v2-gen-001",
  session_nonce: sessionNonce,
  prev_hash: "GENESIS",
  hash_alg: "sha256+sha3-256",
  timestamp: "2026-03-01T12:01:00Z",
  agent_id: passport.agent_id,
  human_id: rpr.human_id,
  intent_id: intent.intent_id,
  intent_hash: `sha256:${intentHashHex}`,
  intent_hash_secondary: `sha3-256:${dualIntent["sha3-256"]}`,
  policy_decision: "approved",
  outcome: "policy_approved",
  evidence: { tool: "policy_engine", result_ref: null, evidence_hash: null },
  pq_checkpoint_ref: null,
};

const audit1Hash = hashObject(audit1);

const audit2 = {
  dcp_version: "2.0",
  audit_id: "audit:v2-gen-002",
  session_nonce: sessionNonce,
  prev_hash: `sha256:${audit1Hash}`,
  prev_hash_secondary: `sha3-256:${dualHashObject(audit1)["sha3-256"]}`,
  hash_alg: "sha256+sha3-256",
  timestamp: "2026-03-01T12:02:00Z",
  agent_id: passport.agent_id,
  human_id: rpr.human_id,
  intent_id: intent.intent_id,
  intent_hash: `sha256:${intentHashHex}`,
  intent_hash_secondary: `sha3-256:${dualIntent["sha3-256"]}`,
  policy_decision: "approved",
  outcome: "email_sent",
  evidence: { tool: "smtp", result_ref: "msg-v2-001", evidence_hash: null },
  pq_checkpoint_ref: null,
};

// --- V2 Bundle ---
const bundle = {
  responsible_principal_record: rpr,
  agent_passport: passport,
  intent,
  policy_decision: policyDecision,
  audit_entries: [audit1, audit2],
};

// --- Write V2 examples ---
fs.writeFileSync(path.join(examplesDir, "rpr_v2.json"), JSON.stringify(rpr, null, 2));
fs.writeFileSync(path.join(examplesDir, "passport_v2.json"), JSON.stringify(passport, null, 2));
fs.writeFileSync(path.join(examplesDir, "intent_v2.json"), JSON.stringify(intent, null, 2));
fs.writeFileSync(path.join(examplesDir, "policy_decision_v2.json"), JSON.stringify(policyDecision, null, 2));

// --- Generate signed V2 bundle ---
const manifest = generateBundleManifest(bundle);
const compositeSig = signComposite(bundle, hybrid.classical.secretKeyB64, hybrid.pq.secretKeyB64, "bundle");

const signedBundle = {
  dcp_version: "2.0",
  bundle,
  bundle_manifest: manifest,
  signature: {
    ...compositeSig,
    created_at: new Date().toISOString(),
    signer: {
      type: "natural_person",
      id: rpr.human_id,
      keys: [
        { kid: rpr.binding_keys[0].kid, algorithm: "Ed25519", public_key_b64: hybrid.classical.publicKeyB64 },
        { kid: rpr.binding_keys[1].kid, algorithm: "ML-DSA-65", public_key_b64: hybrid.pq.publicKeyB64, simulated: true },
      ],
    },
  },
  session_nonce: sessionNonce,
};

fs.writeFileSync(path.join(examplesDir, "signed_bundle_v2.json"), JSON.stringify(signedBundle, null, 2));

console.log("V2 production examples written to tests/conformance/examples/");
console.log(`  session_nonce: ${sessionNonce.slice(0, 16)}...`);
console.log(`  intent_hash: ${intentHashHex}`);
console.log(`  dual hashes: sha256 + sha3-256`);
console.log(`  composite signature: Ed25519 + ML-DSA-65 (simulated)`);
