#!/usr/bin/env node
/**
 * Generate V2 conformance examples: the raw V2 artifacts plus a normative
 * signed bundle (SignedPayloads, manifest, composite Ed25519 + ML-DSA-65
 * signature over "DCP-AI.v2.Bundle"). The bundle is built with @dcp-ai/sdk
 * so it matches what every SDK emits and verifies.
 * Run from repo root: node scripts/generate-v2-examples.js
 */
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import {
  AlgorithmRegistry,
  BundleBuilderV2,
  DCP_CONTEXTS,
  Ed25519Provider,
  MlDsa65Provider,
  canonicalizeV2,
  compositeSign,
  generateSessionNonce,
  preparePayload,
  signBundleV2,
} from "@dcp-ai/sdk";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const examplesDir = path.join(__dirname, "..", "tests", "conformance", "examples");

const digest = (alg, obj) => crypto.createHash(alg).update(canonicalizeV2(obj), "utf8").digest("hex");
const isoSeconds = (date) => date.toISOString().replace(/\.\d{3}Z$/, "Z");

export async function buildV2Examples() {
  const registry = new AlgorithmRegistry();
  const ed25519 = new Ed25519Provider();
  const mlDsa65 = new MlDsa65Provider();
  registry.registerSigner(ed25519);
  registry.registerSigner(mlDsa65);

  const classical = await ed25519.generateKeypair();
  const pq = await mlDsa65.generateKeypair();
  const keys = {
    classical: { kid: classical.kid, alg: "ed25519", secretKeyB64: classical.secretKeyB64, publicKeyB64: classical.publicKeyB64 },
    pq: { kid: pq.kid, alg: "ml-dsa-65", secretKeyB64: pq.secretKeyB64, publicKeyB64: pq.publicKeyB64 },
  };

  const sessionNonce = generateSessionNonce();
  // Verifiers reject expired keys, so the validity window follows the run
  // instead of a hard-coded date that would eventually break conformance.
  const validFrom = isoSeconds(new Date());
  const validUntil = isoSeconds(new Date(Date.now() + 365 * 86_400_000));
  const keyEntry = (k) => ({
    kid: k.kid,
    alg: k.alg,
    public_key_b64: k.publicKeyB64,
    created_at: validFrom,
    expires_at: validUntil,
    status: "active",
  });

  // --- V2 RPR ---
  const rpr = {
    dcp_version: "2.0",
    human_id: "rpr:v2-example-001",
    session_nonce: sessionNonce,
    legal_name: "Alice V2 Example",
    entity_type: "natural_person",
    jurisdiction: "US-CA",
    liability_mode: "owner_responsible",
    override_rights: true,
    issued_at: validFrom,
    expires_at: validUntil,
    binding_keys: [keyEntry(keys.classical), keyEntry(keys.pq)],
    pii_salt: crypto.randomBytes(32).toString("hex"),
  };

  // --- V2 Passport ---
  const passport = {
    dcp_version: "2.0",
    agent_id: "agent:research-bot-v2-gen",
    session_nonce: sessionNonce,
    keys: rpr.binding_keys.map((k) => ({ ...k })),
    principal_binding_reference: rpr.human_id,
    capabilities: ["browse", "api_call"],
    risk_tier: "medium",
    created_at: validFrom,
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

  // --- V2 Audit Entries (prev_hash = sha256 of the dcp-jcs-v1 bytes) ---
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
    intent_hash: `sha256:${digest("sha256", intent)}`,
    intent_hash_secondary: `sha3-256:${digest("sha3-256", intent)}`,
    policy_decision: "approved",
    outcome: "policy_approved",
    evidence: { tool: "policy_engine", result_ref: null, evidence_hash: null },
    pq_checkpoint_ref: null,
  };

  const audit2 = {
    ...audit1,
    audit_id: "audit:v2-gen-002",
    prev_hash: `sha256:${digest("sha256", audit1)}`,
    prev_hash_secondary: `sha3-256:${digest("sha3-256", audit1)}`,
    timestamp: "2026-03-01T12:02:00Z",
    outcome: "email_sent",
    evidence: { tool: "smtp", result_ref: "msg-v2-001", evidence_hash: null },
  };

  const signed = async (payload, context) => {
    const { canonicalBytes, payloadHash } = preparePayload(payload);
    const composite_sig = await compositeSign(registry, context, canonicalBytes, keys);
    return { payload, payload_hash: payloadHash, composite_sig };
  };

  const bundle = new BundleBuilderV2(sessionNonce)
    .responsiblePrincipalRecord(await signed(rpr, DCP_CONTEXTS.ResponsiblePrincipal))
    .agentPassport(await signed(passport, DCP_CONTEXTS.AgentPassport))
    .intent(await signed(intent, DCP_CONTEXTS.Intent))
    .policyDecision(await signed(policyDecision, DCP_CONTEXTS.PolicyDecision))
    .addAuditEntries([audit1, audit2])
    .build();

  const signedBundle = await signBundleV2(bundle, {
    registry,
    signerType: "human",
    signerId: rpr.human_id,
    keys,
  });

  return { rpr, passport, intent, policyDecision, signedBundle, signerPublicKeyB64: keys.classical.publicKeyB64 };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { rpr, passport, intent, policyDecision, signedBundle } = await buildV2Examples();
  fs.mkdirSync(examplesDir, { recursive: true });
  const write = (name, obj) => fs.writeFileSync(path.join(examplesDir, name), JSON.stringify(obj, null, 2));
  write("rpr_v2.json", rpr);
  write("passport_v2.json", passport);
  write("intent_v2.json", intent);
  write("policy_decision_v2.json", policyDecision);
  write("signed_bundle_v2.json", signedBundle);

  console.log("V2 production examples written to tests/conformance/examples/");
  console.log(`  session_nonce: ${signedBundle.bundle.manifest.session_nonce.slice(0, 16)}...`);
  console.log(`  composite signature: Ed25519 + ML-DSA-65 (${signedBundle.signature.composite_sig.binding})`);
}
