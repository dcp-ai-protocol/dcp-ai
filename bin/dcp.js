#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { execSync } from "child_process";

function printHelp() {
  console.log(`
DCP CLI (genesis)

Usage:
  dcp help
  dcp version
  dcp init
  dcp validate <schemaPath> <jsonPath>
  dcp validate-bundle <bundle.json>
  dcp conformance
  dcp keygen [out_dir]
  dcp sign-bundle <bundle.json> <secret_key.txt> [out.json]
  dcp verify-bundle <bundle.signed.json> <public_key.txt>
  dcp bundle-hash <bundle.json>
  dcp merkle-root <bundle.json>
  dcp intent-hash <intent.json>
`);
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function writeFileIfMissing(filePath, contents) {
  if (fs.existsSync(filePath)) return;
  fs.writeFileSync(filePath, contents, "utf8");
}

const cmd = (process.argv[2] || "help").toLowerCase();

if (cmd === "help" || cmd === "--help" || cmd === "-h") {
  printHelp();
  process.exit(0);
}

if (cmd === "version" || cmd === "--version" || cmd === "-v") {
  console.log("0.1.0-genesis");
  process.exit(0);
}

if (cmd === "init") {
  ensureDir("spec");
  ensureDir("schemas/v1");
  ensureDir("tools");
  ensureDir("tests/conformance/examples");
  ensureDir("bin");
  writeFileIfMissing("spec/README.md", "# Specs\n\nPlace DCP specs here.\n");
  writeFileIfMissing("schemas/v1/README.md", "# Schemas v1\n\nPlace JSON Schemas here.\n");
  writeFileIfMissing("tests/conformance/README.md", "# Conformance\n\nPut fixtures under tests/conformance/examples.\nRun: npm run conformance\n");
  console.log("✅ DCP scaffolding created (non-destructive).");
  process.exit(0);
}

if (cmd === "validate") {
  const schemaPath = process.argv[3];
  const jsonPath = process.argv[4];
  if (!schemaPath || !jsonPath) {
    console.error("Usage: dcp validate <schemaPath> <jsonPath>");
    process.exit(2);
  }
  execSync(`node tools/validate.js ${schemaPath} ${jsonPath}`, { stdio: "inherit" });
  process.exit(0);
}

if (cmd === "validate-bundle") {
  const bundlePath = process.argv[3];
  if (!bundlePath) {
    console.error("Usage: dcp validate-bundle <bundle.json>");
    process.exit(2);
  }

  const bundle = JSON.parse(fs.readFileSync(bundlePath, "utf8"));
  const artifactNames = ["human_binding_record", "agent_passport", "intent", "policy_decision"];
  for (const name of artifactNames) console.log(`Validating ${name}...`);
  if (Array.isArray(bundle.audit_entries)) {
    for (let i = 0; i < bundle.audit_entries.length; i++) console.log(`Validating audit_entries[${i}]...`);
  }

  const { validateBundle } = await import("../lib/verify.js");
  const result = validateBundle(bundle);
  if (result.valid) {
    console.log("\n✅ BUNDLE VALID (DCP-01/02/03)");
    process.exit(0);
  }
  for (const e of result.errors || []) console.error(`- ${e}`);
  const artifact = result.errors?.[0]?.includes(": ") ? result.errors[0].split(": ")[0] : "bundle";
  console.error(`\nBundle invalid: ${artifact} failed. Fix the errors above and run dcp validate-bundle again.`);
  process.exit(1);
}

if (cmd === "conformance") {
  try {
    execSync("node tools/conformance.js", { stdio: "inherit" });
    process.exit(0);
  } catch {
    process.exit(1);
  }
}

if (cmd === "keygen") {
  const outDir = process.argv[3] || "keys";
  ensureDir(outDir);
  const { generateKeypair } = await import("../tools/crypto.js");
  const kp = generateKeypair();
  fs.writeFileSync(path.join(outDir, "public_key.txt"), kp.publicKeyB64 + "\n");
  fs.writeFileSync(path.join(outDir, "secret_key.txt"), kp.secretKeyB64 + "\n");
  console.log(`✅ Keypair written to ${outDir}/public_key.txt and ${outDir}/secret_key.txt`);
  process.exit(0);
}

if (cmd === "sign-bundle") {
  const bundlePath = process.argv[3];
  const secretKeyPath = process.argv[4];
  const outPath = process.argv[5] || "citizenship_bundle.signed.json";
  if (!bundlePath || !secretKeyPath) {
    console.error("Usage: dcp sign-bundle <bundle.json> <secret_key.txt> [out.json]");
    process.exit(2);
  }
  execSync(`node tools/bundle_sign.js ${bundlePath} ${secretKeyPath} ${outPath}`, { stdio: "inherit" });
  process.exit(0);
}

if (cmd === "verify-bundle") {
  const signedPath = process.argv[3];
  const publicKeyPath = process.argv[4];
  if (!signedPath || !publicKeyPath) {
    console.error("Usage: dcp verify-bundle <bundle.signed.json> <public_key.txt>");
    process.exit(2);
  }

  const signedBundle = JSON.parse(fs.readFileSync(signedPath, "utf8"));
  const publicKeyB64 = fs.readFileSync(publicKeyPath, "utf8").trim();
  const { verifySignedBundle } = await import("../lib/verify.js");
  const result = verifySignedBundle(signedBundle, publicKeyB64);
  if (result.verified) {
    console.log("✅ SIGNATURE VALID");
    console.log("✅ BUNDLE INTEGRITY VALID");
    console.log("\n✅ VERIFIED (SCHEMA + SIGNATURE)");
    process.exit(0);
  }
  for (const e of result.errors || []) console.error(e);
  console.error("\nVerification failed. See spec/VERIFICATION.md for the full checklist.");
  process.exit(1);
}

if (cmd === "bundle-hash") {
  const bundlePath = process.argv[3];
  if (!bundlePath) {
    console.error("Usage: dcp bundle-hash <bundle.json>");
    process.exit(2);
  }
  const { canonicalize } = await import("../tools/merkle.js");
  const crypto = await import("crypto");
  const bundle = JSON.parse(fs.readFileSync(bundlePath, "utf8"));
  const hex = crypto.createHash("sha256").update(canonicalize(bundle), "utf8").digest("hex");
  console.log(`sha256:${hex}`);
  process.exit(0);
}

if (cmd === "merkle-root") {
  const bundlePath = process.argv[3];
  if (!bundlePath) {
    console.error("Usage: dcp merkle-root <bundle.json>");
    process.exit(2);
  }
  const { merkleRootForAuditEntries } = await import("../tools/merkle.js");
  const bundle = JSON.parse(fs.readFileSync(bundlePath, "utf8"));
  if (!Array.isArray(bundle.audit_entries) || bundle.audit_entries.length === 0) {
    console.error("audit_entries must be a non-empty array");
    process.exit(2);
  }
  const hex = merkleRootForAuditEntries(bundle.audit_entries);
  console.log(hex ? `sha256:${hex}` : "null");
  process.exit(0);
}

if (cmd === "intent-hash") {
  const intentPath = process.argv[3];
  if (!intentPath) {
    console.error("Usage: dcp intent-hash <intent.json>");
    process.exit(2);
  }
  const { intentHash } = await import("../tools/merkle.js");
  const intent = JSON.parse(fs.readFileSync(intentPath, "utf8"));
  console.log(intentHash(intent));
  process.exit(0);
}

console.error(`Unknown command: ${cmd}`);
printHelp();
process.exit(2);
