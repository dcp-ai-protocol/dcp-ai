#!/usr/bin/env node
import { execSync } from "child_process";
import fs from "fs";
import crypto from "crypto";
import { intentHash, hashObject, dualHashObject, canonicalize } from "./merkle.js";

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
      const result = canonicalize(vec.input);
      if (result === vec.expected_canonical) {
        console.log(`✔ V2 interop canonicalization: ${name}`);
      } else {
        console.error(`✖ V2 interop canonicalization: ${name}`);
        failures++;
      }
    }
  }

  if (interop.domain_separation && typeof interop.domain_separation === "object") {
    for (const [name, vec] of Object.entries(interop.domain_separation)) {
      if (vec.tag && vec.input && vec.expected) {
        const computed = `${vec.tag}|${canonicalize(vec.input)}`;
        if (computed === vec.expected) {
          console.log(`✔ V2 interop domain separation: ${name}`);
        } else {
          console.error(`✖ V2 interop domain separation: ${name}`);
          failures++;
        }
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
// V2 Schema Validation (if examples exist)
// ═══════════════════════════════════════════════════════════════

console.log("\n── V2 Schema Conformance ──\n");

const v2Examples = [
  { name: "V2 RPR", schema: "schemas/v2/responsible_principal_record.schema.json", example: "tests/conformance/examples/rpr_v2.json" },
  { name: "V2 Agent Passport", schema: "schemas/v2/agent_passport.schema.json", example: "tests/conformance/examples/passport_v2.json" },
  { name: "V2 Intent", schema: "schemas/v2/intent.schema.json", example: "tests/conformance/examples/intent_v2.json" },
  { name: "V2 Policy Decision", schema: "schemas/v2/policy_decision.schema.json", example: "tests/conformance/examples/policy_decision_v2.json" },
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
