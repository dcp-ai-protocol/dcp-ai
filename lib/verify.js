/**
 * Programmatic API for DCP verification (V1 + V2).
 * Use from CLI (bin/dcp.js) or from a verification service (server/).
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";
import Ajv from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { verifyObject, verifyComposite } from "../tools/crypto.js";
import {
  canonicalize,
  merkleRootForAuditEntries,
  dualMerkleRootForAuditEntries,
  dualHashObject,
  intentHash,
  hashObject,
} from "../tools/merkle.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultBaseDir = path.join(__dirname, "..");

function loadJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function loadSchemasFromDir(ajv, schemasDir) {
  if (!fs.existsSync(schemasDir)) return;
  const files = fs.readdirSync(schemasDir).filter((f) => f.endsWith(".json"));
  for (const f of files) {
    const full = path.join(schemasDir, f);
    const schema = loadJson(full);
    if (schema.$id) ajv.addSchema(schema, schema.$id);
    else ajv.addSchema(schema);
  }
}

function createAjv(baseDir) {
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  loadSchemasFromDir(ajv, path.join(baseDir, "schemas", "v1"));
  loadSchemasFromDir(ajv, path.join(baseDir, "schemas", "v2"));
  return ajv;
}

function formatErrors(validate) {
  return (validate.errors || []).map(
    (e) => `${e.instancePath || "/"} ${e.message}`,
  );
}

/**
 * Detect whether a signed bundle is V2 format.
 */
export function isV2Bundle(signedBundle) {
  return (
    signedBundle?.dcp_version === "2.0" ||
    signedBundle?.signature?.binding === "composite" ||
    !!signedBundle?.bundle_manifest
  );
}

/**
 * Validate a single JSON object against a schema file.
 * @param {string} schemaPath - Path relative to baseDir (e.g. "schemas/v1/intent.schema.json")
 * @param {object} data - JSON object to validate
 * @param {string} [baseDir] - Repo root; defaults to parent of lib/
 * @returns {{ valid: boolean, errors?: string[] }}
 */
export function validateOne(schemaPath, data, baseDir = defaultBaseDir) {
  const ajv = createAjv(baseDir);
  const fullPath = path.isAbsolute(schemaPath)
    ? schemaPath
    : path.join(baseDir, schemaPath);
  const schema = loadJson(fullPath);
  let validate;
  try {
    validate = schema.$id ? ajv.getSchema(schema.$id) : null;
    if (!validate) validate = ajv.compile(schema);
  } catch (e) {
    return { valid: false, errors: [`Schema compile error: ${e.message}`] };
  }
  const ok = validate(data);
  if (ok) return { valid: true };
  return { valid: false, errors: formatErrors(validate) };
}

// ═══════════════════════════════════════════════════════════
// V1 Bundle Validation & Verification
// ═══════════════════════════════════════════════════════════

const V1_BUNDLE_ARTIFACTS = [
  ["schemas/v1/responsible_principal_record.schema.json", (b) => b.responsible_principal_record, "responsible_principal_record"],
  ["schemas/v1/agent_passport.schema.json", (b) => b.agent_passport, "agent_passport"],
  ["schemas/v1/intent.schema.json", (b) => b.intent, "intent"],
  ["schemas/v1/policy_decision.schema.json", (b) => b.policy_decision, "policy_decision"],
];

export function validateBundle(bundle, baseDir = defaultBaseDir) {
  const errors = [];
  for (const [schemaPath, getter, name] of V1_BUNDLE_ARTIFACTS) {
    const obj = getter(bundle);
    if (obj == null) {
      errors.push(`${name}: missing`);
      continue;
    }
    const result = validateOne(schemaPath, obj, baseDir);
    if (!result.valid) {
      result.errors.forEach((e) => errors.push(`${name}: ${e}`));
    }
  }
  if (!Array.isArray(bundle.audit_entries) || bundle.audit_entries.length === 0) {
    errors.push("audit_entries must be a non-empty array");
  } else {
    for (let i = 0; i < bundle.audit_entries.length; i++) {
      const result = validateOne(
        "schemas/v1/audit_entry.schema.json",
        bundle.audit_entries[i],
        baseDir,
      );
      if (!result.valid) {
        result.errors.forEach((e) => errors.push(`audit_entries[${i}]: ${e}`));
      }
    }
  }
  if (errors.length > 0) return { valid: false, errors };
  return { valid: true };
}

export function verifySignedBundle(
  signedBundle,
  publicKeyB64,
  baseDir = defaultBaseDir,
) {
  if (isV2Bundle(signedBundle)) {
    return verifyV2SignedBundle(signedBundle, publicKeyB64, baseDir);
  }

  const errors = [];
  if (!signedBundle?.bundle || !signedBundle?.signature?.sig_b64) {
    return { verified: false, errors: ["Invalid signed bundle format."] };
  }
  const publicKey = publicKeyB64 || signedBundle.signature?.signer?.public_key_b64;
  if (!publicKey) {
    return { verified: false, errors: ["Missing public key (provide public_key_b64 or bundle must include signer.public_key_b64)."] };
  }

  const schemaResult = validateOne("schemas/v1/signed_bundle.schema.json", signedBundle, baseDir);
  if (!schemaResult.valid) {
    schemaResult.errors.forEach((e) => errors.push(`signed_bundle: ${e}`));
    return { verified: false, errors };
  }

  const bundleResult = validateBundle(signedBundle.bundle, baseDir);
  if (!bundleResult.valid) {
    bundleResult.errors.forEach((e) => errors.push(e));
    return { verified: false, errors };
  }

  if (!verifyObject(signedBundle.bundle, signedBundle.signature.sig_b64, publicKey)) {
    errors.push("SIGNATURE INVALID");
    return { verified: false, errors };
  }

  if (
    typeof signedBundle.signature.bundle_hash === "string" &&
    signedBundle.signature.bundle_hash.startsWith("sha256:")
  ) {
    const expectedHex = crypto
      .createHash("sha256")
      .update(canonicalize(signedBundle.bundle), "utf8")
      .digest("hex");
    const got = signedBundle.signature.bundle_hash.slice("sha256:".length);
    if (got !== expectedHex) {
      errors.push("BUNDLE HASH MISMATCH");
      return { verified: false, errors };
    }
  }

  if (
    typeof signedBundle.signature.merkle_root === "string" &&
    signedBundle.signature.merkle_root.startsWith("sha256:")
  ) {
    const expectedMerkle = Array.isArray(signedBundle.bundle.audit_entries)
      ? merkleRootForAuditEntries(signedBundle.bundle.audit_entries)
      : null;
    const gotMerkle = signedBundle.signature.merkle_root.slice("sha256:".length);
    if (!expectedMerkle || gotMerkle !== expectedMerkle) {
      errors.push("MERKLE ROOT MISMATCH");
      return { verified: false, errors };
    }
  }

  const verifyChainResult = verifyAuditChain(signedBundle.bundle);
  if (!verifyChainResult.valid) {
    return { verified: false, errors: verifyChainResult.errors };
  }

  return { verified: true };
}

// ═══════════════════════════════════════════════════════════
// V2 Bundle Validation & Verification
// ═══════════════════════════════════════════════════════════

const V2_BUNDLE_ARTIFACTS = [
  ["schemas/v2/responsible_principal_record.schema.json", (b) => b.responsible_principal_record, "responsible_principal_record"],
  ["schemas/v2/agent_passport.schema.json", (b) => b.agent_passport, "agent_passport"],
  ["schemas/v2/intent.schema.json", (b) => b.intent, "intent"],
  ["schemas/v2/policy_decision.schema.json", (b) => b.policy_decision, "policy_decision"],
];

export function validateV2Bundle(bundle, baseDir = defaultBaseDir) {
  const errors = [];
  for (const [schemaPath, getter, name] of V2_BUNDLE_ARTIFACTS) {
    const obj = getter(bundle);
    if (obj == null) {
      errors.push(`${name}: missing`);
      continue;
    }
    const result = validateOne(schemaPath, obj, baseDir);
    if (!result.valid) {
      result.errors.forEach((e) => errors.push(`${name}: ${e}`));
    }
  }

  if (!Array.isArray(bundle.audit_entries) || bundle.audit_entries.length === 0) {
    errors.push("audit_entries must be a non-empty array");
  } else {
    for (let i = 0; i < bundle.audit_entries.length; i++) {
      const result = validateOne(
        "schemas/v2/audit_entry.schema.json",
        bundle.audit_entries[i],
        baseDir,
      );
      if (!result.valid) {
        result.errors.forEach((e) => errors.push(`audit_entries[${i}]: ${e}`));
      }
    }
  }

  if (errors.length > 0) return { valid: false, errors };
  return { valid: true };
}

export function verifyV2SignedBundle(
  signedBundle,
  publicKeyB64,
  baseDir = defaultBaseDir,
) {
  const errors = [];

  if (!signedBundle?.bundle || !signedBundle?.signature) {
    return { verified: false, errors: ["Invalid V2 signed bundle format."] };
  }

  const sig = signedBundle.signature;
  const classicalKey =
    publicKeyB64 ||
    sig.signer?.keys?.find((k) => k.algorithm === "Ed25519")?.public_key_b64;

  if (!classicalKey) {
    return { verified: false, errors: ["Missing Ed25519 public key for V2 verification."] };
  }

  // Composite signature verification (classical component)
  if (sig.classical?.value) {
    const result = verifyComposite(signedBundle.bundle, sig, classicalKey, "bundle");
    if (!result.valid) {
      errors.push("V2 COMPOSITE SIGNATURE INVALID (classical component failed)");
      return { verified: false, errors };
    }
  } else if (sig.sig_b64) {
    if (!verifyObject(signedBundle.bundle, sig.sig_b64, classicalKey)) {
      errors.push("V2 SIGNATURE INVALID");
      return { verified: false, errors };
    }
  } else {
    errors.push("V2 bundle missing signature (no classical.value or sig_b64)");
    return { verified: false, errors };
  }

  // Bundle manifest hash verification
  if (signedBundle.bundle_manifest) {
    const manifest = signedBundle.bundle_manifest;
    const computed = dualHashObject(signedBundle.bundle);

    if (manifest.bundle_hash?.sha256 && manifest.bundle_hash.sha256 !== computed.sha256) {
      errors.push("V2 BUNDLE MANIFEST SHA-256 MISMATCH");
      return { verified: false, errors };
    }
    if (manifest.bundle_hash?.["sha3-256"] && manifest.bundle_hash["sha3-256"] !== computed["sha3-256"]) {
      errors.push("V2 BUNDLE MANIFEST SHA3-256 MISMATCH");
      return { verified: false, errors };
    }

    if (manifest.merkle_root && Array.isArray(signedBundle.bundle.audit_entries)) {
      const dualMerkle = dualMerkleRootForAuditEntries(signedBundle.bundle.audit_entries);
      if (manifest.merkle_root.sha256 && manifest.merkle_root.sha256 !== dualMerkle.sha256) {
        errors.push("V2 MERKLE ROOT SHA-256 MISMATCH");
        return { verified: false, errors };
      }
    }
  }

  // Session nonce presence check
  if (!signedBundle.session_nonce) {
    errors.push("V2 WARNING: session_nonce not present (recommended for replay protection)");
  }

  // Audit chain verification
  const chainResult = verifyAuditChain(signedBundle.bundle);
  if (!chainResult.valid) {
    return { verified: false, errors: chainResult.errors };
  }

  return { verified: true, warnings: errors.filter((e) => e.startsWith("V2 WARNING")) };
}

// ═══════════════════════════════════════════════════════════
// Shared: Audit chain verification
// ═══════════════════════════════════════════════════════════

export function verifyAuditChain(bundle) {
  const errors = [];
  if (!bundle.intent || !Array.isArray(bundle.audit_entries)) {
    return { valid: true };
  }

  const expectedIntentHash = intentHash(bundle.intent);
  let prevHashExpected = "GENESIS";

  for (let i = 0; i < bundle.audit_entries.length; i++) {
    const entry = bundle.audit_entries[i];
    if (entry.intent_hash !== expectedIntentHash) {
      errors.push(
        `intent_hash (entry ${i}): expected ${expectedIntentHash}, got ${entry.intent_hash}`,
      );
      return { valid: false, errors };
    }
    if (entry.prev_hash !== prevHashExpected) {
      errors.push(
        `prev_hash chain (entry ${i}): expected ${prevHashExpected}, got ${entry.prev_hash}`,
      );
      return { valid: false, errors };
    }
    prevHashExpected = hashObject(entry);
  }

  return { valid: true };
}
