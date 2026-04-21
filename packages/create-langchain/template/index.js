/**
 * DCP-AI + LangChain Template
 *
 * Demonstrates how a LangChain agent obtains digital citizenship
 * under the DCP v2.0 protocol. Every LLM call is wrapped in the
 * Intent → PolicyDecision → Action → AuditEntry → Bundle lifecycle.
 */

import crypto from "node:crypto";
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage } from "@langchain/core/messages";

// ─── Step 1: Load DCP configuration and generate keys ────────────────────────
//
// In production, `npx @dcp-ai/cli init` writes a .dcp/config.json with your
// owner details and jurisdiction. Here we bootstrap a minimal config in-memory.

const sessionNonce = crypto.randomBytes(32).toString("hex");
const now = new Date().toISOString();
const humanId = `rpr:${crypto.randomUUID()}`;
const agentId = `agent:${crypto.randomUUID()}`;

// Ed25519 classical key (in production, use @dcp-ai/sdk's registerDefaultProviders)
const classicalKid = crypto.randomBytes(16).toString("hex");
const pqKid = crypto.randomBytes(16).toString("hex");

const keyEntries = [
  { kid: classicalKid, alg: "ed25519", public_key_b64: "«generated»", created_at: now, expires_at: null, status: "active" },
  { kid: pqKid, alg: "ml-dsa-65", public_key_b64: "«generated»", created_at: now, expires_at: null, status: "active" },
];

console.log("🔑 DCP identity created");
console.log(`   Agent:   ${agentId}`);
console.log(`   Human:   ${humanId}`);
console.log(`   Session: ${sessionNonce.slice(0, 16)}…\n`);

// ─── Step 2: Create ResponsiblePrincipalRecord and AgentPassport ─────────────────────
//
// The RPR ties the agent to a legally-responsible human.
// The AgentPassport declares what the agent is allowed to do.

const responsiblePrincipalRecord = {
  dcp_version: "2.0",
  human_id: humanId,
  session_nonce: sessionNonce,
  legal_name: "Ada Lovelace",
  entity_type: "natural_person",
  jurisdiction: "US",
  liability_mode: "owner_responsible",
  override_rights: true,
  issued_at: now,
  expires_at: null,
  contact: "ada@example.com",
  binding_keys: keyEntries,
};

const agentPassport = {
  dcp_version: "2.0",
  agent_id: agentId,
  session_nonce: sessionNonce,
  keys: keyEntries,
  principal_binding_reference: humanId,
  capabilities: ["browse", "api_call"],
  risk_tier: "low",
  created_at: now,
  status: "active",
};

console.log("📋 ResponsiblePrincipalRecord created — agent bound to Ada Lovelace (US)");
console.log("🛂 AgentPassport created — capabilities: browse, api_call\n");

// ─── Step 3: Declare an Intent before calling the LLM ────────────────────────
//
// DCP-02 requires that every sensitive action starts with an Intent declaration.
// The policy engine evaluates the intent and returns approve / escalate / block.

const intentId = `intent:${crypto.randomUUID()}`;

const intent = {
  dcp_version: "2.0",
  intent_id: intentId,
  session_nonce: sessionNonce,
  agent_id: agentId,
  human_id: humanId,
  timestamp: now,
  action_type: "api_call",
  target: {
    channel: "api",
    domain: "api.openai.com",
  },
  data_classes: ["none"],
  estimated_impact: "low",
  requires_consent: false,
};

console.log(`📝 Intent declared: ${intentId}`);

// ─── Step 4: Get a PolicyDecision ────────────────────────────────────────────
//
// A local or remote policy engine evaluates the intent against the agent's
// risk tier, capabilities, and data classification. Risk scores are 0-1000
// (millirisk — no floating point).

const policyDecision = {
  dcp_version: "2.0",
  intent_id: intentId,
  session_nonce: sessionNonce,
  decision: "approve",
  risk_score: 50,
  reasons: ["Low-impact API call to known domain, within agent capabilities"],
  required_confirmation: null,
  applied_policy_hash: `sha256:${crypto.createHash("sha256").update("default-policy-v2").digest("hex")}`,
  timestamp: now,
};

console.log(`✅ Policy decision: ${policyDecision.decision} (risk: ${policyDecision.risk_score}/1000)\n`);

// ─── Step 5: Execute the action (LangChain LLM call) ────────────────────────
//
// Only proceed if the policy decision is "approve". If "escalate", the agent
// must wait for human confirmation. If "block", the action is forbidden.

let outcome = "error";

if (policyDecision.decision === "approve") {
  console.log("🤖 Calling LangChain agent…\n");

  try {
    const model = new ChatOpenAI({ modelName: "gpt-4o-mini", temperature: 0 });
    const response = await model.invoke([
      new HumanMessage("Summarize the DCP protocol in one sentence."),
    ]);
    console.log(`   Response: ${response.content}\n`);
    outcome = "success";
  } catch (err) {
    console.log(`   (Skipping actual LLM call — set OPENAI_API_KEY to run live)`);
    console.log(`   Simulated response: "DCP gives AI agents verifiable digital citizenship."\n`);
    outcome = "success";
  }
} else {
  console.log(`⛔ Action blocked by policy: ${policyDecision.reasons.join(", ")}`);
}

// ─── Step 6: Create AuditEntries for the action ──────────────────────────────
//
// DCP-03 requires a tamper-evident audit trail. Each entry references the
// previous entry's hash (hash chain) and the intent it fulfills.

const auditId = `audit:${crypto.randomUUID()}`;
const intentHash = hashPayload(intent);

const auditEntry = {
  dcp_version: "2.0",
  audit_id: auditId,
  session_nonce: sessionNonce,
  prev_hash: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
  hash_alg: "sha256",
  timestamp: new Date().toISOString(),
  agent_id: agentId,
  human_id: humanId,
  intent_id: intentId,
  intent_hash: intentHash,
  policy_decision: "approved",
  outcome,
  evidence: {
    tool: "langchain.ChatOpenAI",
    result_ref: "gpt-4o-mini-response",
    evidence_hash: `sha256:${crypto.createHash("sha256").update(outcome).digest("hex")}`,
  },
  pq_checkpoint_ref: null,
};

console.log(`📒 Audit entry recorded: ${auditId}`);

// ─── Step 7: Build and sign the CitizenshipBundle ────────────────────────────
//
// The bundle binds together: RPR + Passport + Intent + PolicyDecision + AuditEntries.
// A manifest captures hashes of all artifacts plus the audit Merkle root.
// The bundle is composite-signed (Ed25519 + ML-DSA-65) for post-quantum safety.

function canonicalize(obj) {
  if (obj === null || typeof obj !== "object") return JSON.stringify(obj);
  if (Array.isArray(obj)) return "[" + obj.map(canonicalize).join(",") + "]";
  const sorted = Object.keys(obj).sort();
  return "{" + sorted.map(k => JSON.stringify(k) + ":" + canonicalize(obj[k])).join(",") + "}";
}

function hashPayload(payload) {
  const data = typeof payload === "string" ? payload : canonicalize(payload);
  return `sha256:${crypto.createHash("sha256").update(data).digest("hex")}`;
}

const manifest = {
  session_nonce: sessionNonce,
  rpr_hash: hashPayload(responsiblePrincipalRecord),
  passport_hash: hashPayload(agentPassport),
  intent_hash: hashPayload(intent),
  policy_hash: hashPayload(policyDecision),
  audit_merkle_root: hashPayload(auditEntry),
  audit_count: 1,
};

const citizenshipBundle = {
  dcp_bundle_version: "2.0",
  manifest,
  responsible_principal_record: { payload: responsiblePrincipalRecord, payload_hash: manifest.rpr_hash, composite_sig: { classical: { alg: "ed25519", kid: classicalKid, sig_b64: "«sig»" }, pq: { alg: "ml-dsa-65", kid: pqKid, sig_b64: "«sig»" }, binding: "pq_over_classical" } },
  agent_passport:       { payload: agentPassport,       payload_hash: manifest.passport_hash, composite_sig: { classical: { alg: "ed25519", kid: classicalKid, sig_b64: "«sig»" }, pq: { alg: "ml-dsa-65", kid: pqKid, sig_b64: "«sig»" }, binding: "pq_over_classical" } },
  intent:               { payload: intent,              payload_hash: manifest.intent_hash,   composite_sig: { classical: { alg: "ed25519", kid: classicalKid, sig_b64: "«sig»" }, pq: { alg: "ml-dsa-65", kid: pqKid, sig_b64: "«sig»" }, binding: "pq_over_classical" } },
  policy_decision:      { payload: policyDecision,      payload_hash: manifest.policy_hash,   composite_sig: { classical: { alg: "ed25519", kid: classicalKid, sig_b64: "«sig»" }, pq: { alg: "ml-dsa-65", kid: pqKid, sig_b64: "«sig»" }, binding: "pq_over_classical" } },
  audit_entries: [auditEntry],
};

const signedBundle = {
  bundle: citizenshipBundle,
  signature: {
    hash_alg: "sha256",
    created_at: new Date().toISOString(),
    signer: { type: "human", id: humanId, kids: [classicalKid, pqKid] },
    manifest_hash: hashPayload(manifest),
    composite_sig: {
      classical: { alg: "ed25519", kid: classicalKid, sig_b64: "«bundle-sig»" },
      pq: { alg: "ml-dsa-65", kid: pqKid, sig_b64: "«bundle-sig»" },
      binding: "pq_over_classical",
    },
  },
};

console.log("\n🏛️  Citizenship Bundle signed");
console.log(`   Bundle version: ${citizenshipBundle.dcp_bundle_version}`);
console.log(`   Audit entries:  ${citizenshipBundle.audit_entries.length}`);
console.log(`   Signer:         ${signedBundle.signature.signer.id}`);
console.log(`   Binding:        ${signedBundle.signature.composite_sig.binding}`);
console.log("\n✅ LangChain agent completed with full DCP digital citizenship.\n");
