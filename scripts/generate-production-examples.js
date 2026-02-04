#!/usr/bin/env node
/**
 * Generate production-ready conformance examples: real Ed25519 signatures,
 * real intent_hash (SHA-256 canonical intent), chained prev_hash (GENESIS → hash(entry1)).
 * Uses keys/secret_key.txt (human, signs HBR and bundle) and keys/agent_* (agent, signs AP).
 * Run from repo root: node scripts/generate-production-examples.js
 */
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import { generateKeypair, signObject } from "../tools/crypto.js";
import { intentHash, hashObject } from "../tools/merkle.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const keysDir = path.join(root, "keys");
const examplesDir = path.join(root, "tests", "conformance", "examples");

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

ensureDir(keysDir);
ensureDir(examplesDir);

// Human keypair (signs HBR and bundle)
const humanSecretB64 = fs.readFileSync(path.join(keysDir, "secret_key.txt"), "utf8").trim();
const humanPublicB64 = fs.readFileSync(path.join(keysDir, "public_key.txt"), "utf8").trim();

// Agent keypair (AP.public_key, signs AP)
let agentPublicB64, agentSecretB64;
const agentSecretPath = path.join(keysDir, "agent_secret_key.txt");
const agentPublicPath = path.join(keysDir, "agent_public_key.txt");
if (fs.existsSync(agentSecretPath) && fs.existsSync(agentPublicPath)) {
  agentSecretB64 = fs.readFileSync(agentSecretPath, "utf8").trim();
  agentPublicB64 = fs.readFileSync(agentPublicPath, "utf8").trim();
} else {
  const kp = generateKeypair();
  agentSecretB64 = kp.secretKeyB64;
  agentPublicB64 = kp.publicKeyB64;
  fs.writeFileSync(agentSecretPath, agentSecretB64 + "\n");
  fs.writeFileSync(agentPublicPath, agentPublicB64 + "\n");
  console.log("Generated agent keypair in keys/agent_*.txt");
}

// --- HBR (signed by human) ---
const hbr = {
  dcp_version: "1.0",
  human_id: "did:human:alice123",
  legal_name: "Alice Example",
  entity_type: "natural_person",
  jurisdiction: "US",
  liability_mode: "owner_responsible",
  override_rights: true,
  issued_at: "2026-01-01T00:00:00Z",
  expires_at: null,
  signature: "" // set below
};
hbr.signature = signObject(hbr, humanSecretB64);

// --- AP (signed by agent, public_key = agent) ---
const ap = {
  dcp_version: "1.0",
  agent_id: "did:agent:agent123",
  public_key: agentPublicB64,
  human_binding_reference: "did:human:alice123",
  capabilities: ["browse", "email", "api_call"],
  risk_tier: "medium",
  created_at: "2026-01-01T00:10:00Z",
  status: "active",
  signature: ""
};
ap.signature = signObject(ap, agentSecretB64);

// --- Intent ---
const intent = {
  dcp_version: "1.0",
  intent_id: "intent001",
  agent_id: "did:agent:agent123",
  human_id: "did:human:alice123",
  timestamp: "2026-01-01T01:00:00Z",
  action_type: "send_email",
  target: { channel: "email", to: "bob@example.com" },
  data_classes: ["contact_info"],
  estimated_impact: "medium",
  requires_consent: false
};

const intentHashHex = intentHash(intent);

// --- Policy decision ---
const policyDecision = {
  dcp_version: "1.0",
  intent_id: "intent001",
  decision: "approve",
  risk_score: 0.21,
  reasons: ["low_risk"]
};

// --- Audit entry 1 (prev_hash = GENESIS) ---
const audit1 = {
  dcp_version: "1.0",
  audit_id: "audit001",
  prev_hash: "GENESIS",
  timestamp: "2026-01-01T01:01:00Z",
  agent_id: "did:agent:agent123",
  human_id: "did:human:alice123",
  intent_id: "intent001",
  intent_hash: intentHashHex,
  policy_decision: "approved",
  outcome: "policy_approved",
  evidence: { tool: "policy_engine", result_ref: null }
};

// --- Audit entry 2 (prev_hash = hash(entry1)) ---
const audit2 = {
  dcp_version: "1.0",
  audit_id: "audit002",
  prev_hash: hashObject(audit1),
  timestamp: "2026-01-01T01:02:00Z",
  agent_id: "did:agent:agent123",
  human_id: "did:human:alice123",
  intent_id: "intent001",
  intent_hash: intentHashHex,
  policy_decision: "approved",
  outcome: "email_sent",
  evidence: { tool: "smtp", result_ref: "msg-7788" }
};

// --- Bundle ---
const bundle = {
  human_binding_record: hbr,
  agent_passport: ap,
  intent,
  policy_decision: policyDecision,
  audit_entries: [audit1, audit2]
};

// Write individual fixtures (for dcp validate and conformance)
fs.writeFileSync(path.join(examplesDir, "human_binding_record.json"), JSON.stringify(hbr, null, 2));
fs.writeFileSync(path.join(examplesDir, "agent_passport.json"), JSON.stringify(ap, null, 2));
fs.writeFileSync(path.join(examplesDir, "intent.json"), JSON.stringify(intent, null, 2));
fs.writeFileSync(path.join(examplesDir, "policy_decision.json"), JSON.stringify(policyDecision, null, 2));
fs.writeFileSync(path.join(examplesDir, "audit_entry.json"), JSON.stringify(audit1, null, 2));

fs.writeFileSync(path.join(examplesDir, "citizenship_bundle.json"), JSON.stringify(bundle, null, 2));

// Sign bundle (human key)
const signedPath = path.join(examplesDir, "citizenship_bundle.signed.json");
execSync(
  `node tools/bundle_sign.js tests/conformance/examples/citizenship_bundle.json keys/secret_key.txt tests/conformance/examples/citizenship_bundle.signed.json`,
  { cwd: root, stdio: "inherit" }
);

console.log("✅ Production examples written to tests/conformance/examples/");
console.log("   intent_hash:", intentHashHex);
console.log("   prev_hash(entry2):", hashObject(audit1));
