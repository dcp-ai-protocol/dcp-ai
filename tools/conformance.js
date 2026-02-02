#!/usr/bin/env node
import { execSync } from "child_process";
import fs from "fs";

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
    execSync("dcp keygen keys", { stdio: "inherit" });
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

if (failures > 0) {
  console.error(`\nConformance FAILED (${failures} errors)`);
  process.exit(1);
} else {
  console.log("\nDCP-AI CONFORMANCE PASS (L3-OBJECTS + L3-BUNDLE + L3-SIGNED)");
  process.exit(0);
}
