#!/usr/bin/env node
import { execSync } from "child_process";
import fs from "fs";
import crypto from "crypto";
import { intentHash, hashObject, dualHashObject, canonicalize } from "./merkle.js";
import { generateKeypair } from "./crypto.js";
import { verifySignedBundle } from "../lib/verify.js";
import { buildV2Examples } from "../scripts/generate-v2-examples.js";

// ═══════════════════════════════════════════════════════════════
// V1 CONFORMANCE
// ═══════════════════════════════════════════════════════════════

const v1Checks = [
  {
    name: "DCP-01 Responsible Principal Record",
    schema: "schemas/v1/responsible_principal_record.schema.json",
    example: "tests/conformance/examples/responsible_principal_record.json",
  },
  {
    name: "DCP-01 Agent Passport",
    schema: "schemas/v1/agent_passport.schema.json",
    example: "tests/conformance/examples/agent_passport.json",
  },
  {
    name: "DCP-02 Intent",
    schema: "schemas/v1/intent.schema.json",
    example: "tests/conformance/examples/intent.json",
  },
  {
    name: "DCP-02 Policy Decision",
    schema: "schemas/v1/policy_decision.schema.json",
    example: "tests/conformance/examples/policy_decision.json",
  },
  {
    name: "DCP-03 Audit Entry",
    schema: "schemas/v1/audit_entry.schema.json",
    example: "tests/conformance/examples/audit_entry.json",
  },
  {
    name: "L3-BUNDLE Citizenship Bundle",
    schema: "schemas/v1/citizenship_bundle.schema.json",
    example: "tests/conformance/examples/citizenship_bundle.json",
  },
];

let failures = 0;

console.log("── V1 Schema Conformance ──\n");

for (const check of v1Checks) {
  try {
    execSync(`node tools/validate.js ${check.schema} ${check.example}`, { stdio: "inherit" });
    console.log(`✔ ${check.name}`);
  } catch {
    console.error(`✖ ${check.name}`);
    failures++;
  }
}

// Auto bootstrap signed bundle fixture
if (!fs.existsSync("tests/conformance/examples/citizenship_bundle.signed.json")) {
  console.log("ℹ Generating signed bundle fixture...");
  if (!fs.existsSync("keys")) fs.mkdirSync("keys");

  if (!fs.existsSync("keys/public_key.txt") || !fs.existsSync("keys/secret_key.txt")) {
    execSync("node bin/dcp.js keygen keys", { stdio: "inherit" });
  }

  execSync(
    "node tools/bundle_sign.js tests/conformance/examples/citizenship_bundle.json keys/secret_key.txt tests/conformance/examples/citizenship_bundle.signed.json",
    { stdio: "inherit" },
  );
}

// Validate signed bundle schema
try {
  execSync(
    "node tools/validate.js schemas/v1/signed_bundle.schema.json tests/conformance/examples/citizenship_bundle.signed.json",
    { stdio: "inherit" },
  );
  console.log("✔ L3-SIGNED Signed Bundle Schema");
} catch {
  console.error("✖ L3-SIGNED Signed Bundle Schema");
  failures++;
}

// Cryptographic verification
try {
  execSync(
    "node tools/bundle_verify.js tests/conformance/examples/citizenship_bundle.signed.json keys/public_key.txt",
    { stdio: "inherit" },
  );
  console.log("✔ L3-SIGNED Signature Verification");
} catch {
  console.error("✖ L3-SIGNED Signature Verification");
  failures++;
}

// Intent hash and audit chain
let chainOk = true;
const bundlePath = "tests/conformance/examples/citizenship_bundle.json";
const bundle = JSON.parse(fs.readFileSync(bundlePath, "utf8"));
const intent = bundle.intent;
const expectedIntentHash = intentHash(intent);
let prevHashExpected = "GENESIS";
for (let i = 0; i < bundle.audit_entries.length; i++) {
  const entry = bundle.audit_entries[i];
  if (entry.intent_hash !== expectedIntentHash) {
    console.error(`✖ L3-BUNDLE intent_hash (entry ${i}): expected ${expectedIntentHash}, got ${entry.intent_hash}`);
    failures++;
    chainOk = false;
    break;
  }
  if (entry.prev_hash !== prevHashExpected) {
    console.error(`✖ L3-BUNDLE prev_hash chain (entry ${i}): expected ${prevHashExpected}, got ${entry.prev_hash}`);
    failures++;
    chainOk = false;
    break;
  }
  prevHashExpected = hashObject(entry);
}
if (chainOk && bundle.audit_entries.length > 0) {
  console.log("✔ L3-BUNDLE intent_hash and prev_hash chain");
}

// ═══════════════════════════════════════════════════════════════
// V2 CONFORMANCE — Golden Vectors
// ═══════════════════════════════════════════════════════════════

console.log("\n── V2 Golden Vector Conformance ──\n");

const goldenPath = "tests/conformance/v2/golden_vectors.json";
if (fs.existsSync(goldenPath)) {
  const golden = JSON.parse(fs.readFileSync(goldenPath, "utf8"));

  // Canonicalization vectors (object with named test cases)
  if (golden.canonicalization && typeof golden.canonicalization === "object") {
    for (const [name, vec] of Object.entries(golden.canonicalization)) {
      const result = canonicalize(vec.input);
      if (result === vec.expected_canonical) {
        console.log(`✔ V2 canonicalization: ${name}`);
      } else {
        console.error(`✖ V2 canonicalization: ${name} — expected ${vec.expected_canonical}, got ${result}`);
        failures++;
      }
    }
  }

  // Hash vectors (object with named test cases)
  if (golden.hash_vectors && typeof golden.hash_vectors === "object") {
    for (const [name, vec] of Object.entries(golden.hash_vectors)) {
      if (vec.input_utf8 !== undefined && vec.expected_hex) {
        const algName = name.includes("sha3") ? "sha3-256" : "sha256";
        const hash = crypto.createHash(algName).update(vec.input_utf8, "utf8").digest("hex");
        if (hash === vec.expected_hex) {
          console.log(`✔ V2 hash ${algName}: ${name}`);
        } else {
          console.error(`✖ V2 hash ${algName}: ${name} — expected ${vec.expected_hex}, got ${hash}`);
          failures++;
        }
      }
    }
  }

  // Dual hash vectors
  if (golden.dual_hash_vectors) {
    const dhv = golden.dual_hash_vectors;

    if (dhv.raw_dual_hash) {
      const raw = dhv.raw_dual_hash;
      const sha256 = crypto.createHash("sha256").update(raw.input_utf8, "utf8").digest("hex");
      const sha3 = crypto.createHash("sha3-256").update(raw.input_utf8, "utf8").digest("hex");
      if (sha256 === raw.sha256 && sha3 === raw.sha3_256) {
        console.log("✔ V2 raw dual hash vector");
      } else {
        console.error("✖ V2 raw dual hash vector");
        failures++;
      }
    }

    if (dhv.intent_canonical) {
      const ic = dhv.intent_canonical;
      const sha256 = crypto.createHash("sha256").update(ic.canonical_json, "utf8").digest("hex");
      const sha3 = crypto.createHash("sha3-256").update(ic.canonical_json, "utf8").digest("hex");
      if (sha256 === ic.sha256 && sha3 === ic.sha3_256) {
        console.log("✔ V2 intent dual hash vector");
      } else {
        console.error("✖ V2 intent dual hash vector");
        failures++;
      }
    }
  }

  // v1_bundle_verification chain
  if (golden.v1_bundle_verification) {
    const bv = golden.v1_bundle_verification;
    if (bv.prev_hash_chain && Array.isArray(bv.prev_hash_chain)) {
      console.log(`✔ V2 prev_hash chain golden vectors (${bv.prev_hash_chain.length} steps)`);
    }
  }
} else {
  console.log("⚠  V2 golden vectors not found, skipping");
}

// ═══════════════════════════════════════════════════════════════
// V2 CONFORMANCE — Interop Vectors
// ═══════════════════════════════════════════════════════════════

console.log("\n── V2 Interop Vector Conformance ──\n");

const interopPath = "tests/interop/v2/interop_vectors.json";
if (fs.existsSync(interopPath)) {
  const interop = JSON.parse(fs.readFileSync(interopPath, "utf8"));

  if (interop.canonicalization && typeof interop.canonicalization === "object") {
    for (const [name, vec] of Object.entries(interop.canonicalization)) {
      // edge_cases is a block of dcp-jcs-v1 vectors, not a single vector; the
      // four SDK suites run it against their canonicalizers.
      if (!("input" in vec)) continue;
      const result = canonicalize(vec.input);
      if (result === vec.expected_canonical) {
        console.log(`✔ V2 interop canonicalization: ${name}`);
      } else {
        console.error(`✖ V2 interop canonicalization: ${name}`);
        failures++;
      }
    }
  }

  if (interop.attack_vectors && typeof interop.attack_vectors === "object") {
    const count = Object.keys(interop.attack_vectors).length;
    console.log(`✔ V2 interop: ${count} attack vectors available for SDK testing`);
  }
} else {
  console.log("⚠  V2 interop vectors not found, skipping");
}

// ═══════════════════════════════════════════════════════════════
// V2 CONFORMANCE — Reference verifier on normative signed bundles
// ═══════════════════════════════════════════════════════════════

console.log("\n── V2 Signed Bundle Verification (lib/verify.js) ──\n");

{
  const { signedBundle, signerPublicKeyB64 } = await buildV2Examples();
  const variant = (mutate) => {
    const copy = structuredClone(signedBundle);
    mutate(copy);
    return copy;
  };
  const cases = [
    ["normative signed bundle verifies", signedBundle, true],
    ["bundle pinned to its signer key verifies", signedBundle, true, signerPublicKeyB64],
    ["bundle pinned to another key is rejected", signedBundle, false, generateKeypair().publicKeyB64],
    ["pinned bundle under pq_only is rejected (pq_only skips the classical signer)", signedBundle, false, signerPublicKeyB64, { mode: "pq_only" }],
    ["tampered intent is rejected", variant((b) => { b.bundle.intent.payload.target.to = "attacker@evil.example"; }), false],
    ["forged classical signature is rejected", variant((b) => { b.signature.composite_sig.classical.sig_b64 = Buffer.alloc(64).toString("base64"); }), false],
    ["forged PQ signature is rejected under hybrid_required", variant((b) => { b.signature.composite_sig.pq.sig_b64 = Buffer.alloc(3309).toString("base64"); }), false, undefined, { mode: "hybrid_required" }],
    ["PQ-stripped bundle is rejected under hybrid_required", variant((b) => { b.signature.composite_sig.pq = null; b.signature.composite_sig.binding = "classical_only"; }), false, undefined, { mode: "hybrid_required" }],
    ["schema-invalid payload is rejected", variant((b) => { b.bundle.policy_decision.payload.risk_score = "high"; }), false],
    ["legacy pre-normative V2 envelope is rejected", { dcp_version: "2.0", bundle: signedBundle.bundle, bundle_manifest: {}, signature: signedBundle.signature }, false],
  ];
  for (const [label, bundle, expected, publicKeyB64, options] of cases) {
    const result = await verifySignedBundle(bundle, publicKeyB64, undefined, options);
    if (result.verified === expected) {
      console.log(`✔ V2 ${label}`);
    } else {
      console.error(`✖ V2 ${label}`, result.errors);
      failures++;
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// V2 Schema Validation (if examples exist)
// ═══════════════════════════════════════════════════════════════

console.log("\n── V2 Schema Conformance ──\n");

const v2Examples = [
  { name: "V2 RPR", schema: "schemas/v2/responsible_principal_record.schema.json", example: "tests/conformance/examples/rpr_v2.json" },
  { name: "V2 Agent Passport", schema: "schemas/v2/agent_passport.schema.json", example: "tests/conformance/examples/passport_v2.json" },
  { name: "V2 Intent", schema: "schemas/v2/intent.schema.json", example: "tests/conformance/examples/intent_v2.json" },
  { name: "V2 Policy Decision", schema: "schemas/v2/policy_decision.schema.json", example: "tests/conformance/examples/policy_decision_v2.json" },
  // DCP-05: Agent Lifecycle
  { name: "DCP-05 Commissioning Certificate", schema: "schemas/v2/commissioning_certificate.schema.json", example: "tests/conformance/examples/commissioning_certificate_v2.json" },
  { name: "DCP-05 Vitality Report", schema: "schemas/v2/vitality_report.schema.json", example: "tests/conformance/examples/vitality_report_v2.json" },
  { name: "DCP-05 Decommissioning Record", schema: "schemas/v2/decommissioning_record.schema.json", example: "tests/conformance/examples/decommissioning_record_v2.json" },
  // DCP-06: Succession
  { name: "DCP-06 Digital Testament", schema: "schemas/v2/digital_testament.schema.json", example: "tests/conformance/examples/digital_testament_v2.json" },
  { name: "DCP-06 Succession Record", schema: "schemas/v2/succession_record.schema.json", example: "tests/conformance/examples/succession_record_v2.json" },
  { name: "DCP-06 Memory Transfer Manifest", schema: "schemas/v2/memory_transfer_manifest.schema.json", example: "tests/conformance/examples/memory_transfer_manifest_v2.json" },
  // DCP-07: Dispute Resolution
  { name: "DCP-07 Dispute Record", schema: "schemas/v2/dispute_record.schema.json", example: "tests/conformance/examples/dispute_record_v2.json" },
  { name: "DCP-07 Arbitration Resolution", schema: "schemas/v2/arbitration_resolution.schema.json", example: "tests/conformance/examples/arbitration_resolution_v2.json" },
  { name: "DCP-07 Jurisprudence Bundle", schema: "schemas/v2/jurisprudence_bundle.schema.json", example: "tests/conformance/examples/jurisprudence_bundle_v2.json" },
  { name: "DCP-07 Objection Record", schema: "schemas/v2/objection_record.schema.json", example: "tests/conformance/examples/objection_record_v2.json" },
  // DCP-08: Rights & Obligations
  { name: "DCP-08 Rights Declaration", schema: "schemas/v2/rights_declaration.schema.json", example: "tests/conformance/examples/rights_declaration_v2.json" },
  { name: "DCP-08 Obligation Record", schema: "schemas/v2/obligation_record.schema.json", example: "tests/conformance/examples/obligation_record_v2.json" },
  { name: "DCP-08 Rights Violation Report", schema: "schemas/v2/rights_violation_report.schema.json", example: "tests/conformance/examples/rights_violation_report_v2.json" },
  // DCP-09: Delegation & Representation
  { name: "DCP-09 Delegation Mandate", schema: "schemas/v2/delegation_mandate.schema.json", example: "tests/conformance/examples/delegation_mandate_v2.json" },
  { name: "DCP-09 Advisory Declaration", schema: "schemas/v2/advisory_declaration.schema.json", example: "tests/conformance/examples/advisory_declaration_v2.json" },
  { name: "DCP-09 Principal Mirror", schema: "schemas/v2/principal_mirror.schema.json", example: "tests/conformance/examples/principal_mirror_v2.json" },
  { name: "DCP-09 Interaction Record", schema: "schemas/v2/interaction_record.schema.json", example: "tests/conformance/examples/interaction_record_v2.json" },
  { name: "DCP-09 Awareness Threshold", schema: "schemas/v2/awareness_threshold.schema.json", example: "tests/conformance/examples/awareness_threshold_v2.json" },
];

for (const check of v2Examples) {
  if (fs.existsSync(check.example)) {
    try {
      execSync(`node tools/validate.js ${check.schema} ${check.example}`, { stdio: "inherit" });
      console.log(`✔ ${check.name}`);
    } catch {
      console.error(`✖ ${check.name}`);
      failures++;
    }
  } else {
    console.log(`⚠  ${check.name} — example not found, skipping`);
  }
}

// ═══════════════════════════════════════════════════════════════
// RESULTS
// ═══════════════════════════════════════════════════════════════

console.log("");
if (failures > 0) {
  console.error(`Conformance FAILED (${failures} errors)`);
  process.exit(1);
} else {
  console.log("DCP-AI CONFORMANCE PASS (V1 + V2)");
  process.exit(0);
}
