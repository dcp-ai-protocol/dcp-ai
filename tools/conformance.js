#!/usr/bin/env node
import { execSync } from "child_process";
import fs from "fs";
import { intentHash, hashObject } from "./merkle.js";

const checks = [
  {
    name: "DCP-01 Human Binding Record",
    schema: "schemas/v1/human_binding_record.schema.json",
    example: "tests/conformance/examples/human_binding_record.json"
  },
  {
    name: "DCP-01 Agent Passport",
    schema: "schemas/v1/agent_passport.schema.json",
    example: "tests/conformance/examples/agent_passport.json"
  },
  {
    name: "DCP-02 Intent",
    schema: "schemas/v1/intent.schema.json",
    example: "tests/conformance/examples/intent.json"
  },
  {
    name: "DCP-02 Policy Decision",
    schema: "schemas/v1/policy_decision.schema.json",
    example: "tests/conformance/examples/policy_decision.json"
  },
  {
    name: "DCP-03 Audit Entry",
    schema: "schemas/v1/audit_entry.schema.json",
    example: "tests/conformance/examples/audit_entry.json"
  },
  {
    name: "L3-BUNDLE Citizenship Bundle",
    schema: "schemas/v1/citizenship_bundle.schema.json",
    example: "tests/conformance/examples/citizenship_bundle.json"
  }
];

let failures = 0;

for (const check of checks) {
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
    { stdio: "inherit" }
  );
}

// Validate signed bundle schema
try {
  execSync(
    "node tools/validate.js schemas/v1/signed_bundle.schema.json tests/conformance/examples/citizenship_bundle.signed.json",
    { stdio: "inherit" }
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
    { stdio: "inherit" }
  );
  console.log("✔ L3-SIGNED Signature Verification");
} catch {
  console.error("✖ L3-SIGNED Signature Verification");
  failures++;
}

// Intent hash and audit chain (production example bundle)
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

if (failures > 0) {
  console.error(`\nConformance FAILED (${failures} errors)`);
  process.exit(1);
} else {
  console.log("\nDCP-AI CONFORMANCE PASS (L3-OBJECTS + L3-BUNDLE + L3-SIGNED)");
  process.exit(0);
}
