/**
 * Programmatic API for DCP verification.
 * Use from CLI (bin/dcp.js) or from a verification service (server/).
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";
import Ajv from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { verifyObject } from "../tools/crypto.js";
import {
  canonicalize,
  merkleRootForAuditEntries,
  intentHash,
  hashObject
} from "../tools/merkle.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultBaseDir = path.join(__dirname, "..");

function loadJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function createAjv(baseDir) {
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  const schemasDir = path.join(baseDir, "schemas", "v1");
  if (!fs.existsSync(schemasDir)) return ajv;
  const files = fs.readdirSync(schemasDir).filter((f) => f.endsWith(".json"));
  for (const f of files) {
    const full = path.join(schemasDir, f);
    const schema = loadJson(full);
    if (schema.$id) ajv.addSchema(schema, schema.$id);
    else ajv.addSchema(schema);
  }
  return ajv;
}

function formatErrors(validate) {
  return (validate.errors || []).map(
    (e) => `${e.instancePath || "/"} ${e.message}`
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

const BUNDLE_ARTIFACTS = [
  ["schemas/v1/human_binding_record.schema.json", (b) => b.human_binding_record, "human_binding_record"],
  ["schemas/v1/agent_passport.schema.json", (b) => b.agent_passport, "agent_passport"],
  ["schemas/v1/intent.schema.json", (b) => b.intent, "intent"],
  ["schemas/v1/policy_decision.schema.json", (b) => b.policy_decision, "policy_decision"]
];

/**
 * Validate a Citizenship Bundle (schema for each artifact + audit_entries).
 * @param {object} bundle - Inner bundle (human_binding_record, agent_passport, intent, policy_decision, audit_entries)
 * @param {string} [baseDir]
 * @returns {{ valid: boolean, errors?: string[] }}
 */
export function validateBundle(bundle, baseDir = defaultBaseDir) {
  const errors = [];
  for (const [schemaPath, getter, name] of BUNDLE_ARTIFACTS) {
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
        baseDir
      );
      if (!result.valid) {
        result.errors.forEach((e) => errors.push(`audit_entries[${i}]: ${e}`));
      }
    }
  }
  if (errors.length > 0) return { valid: false, errors };
  return { valid: true };
}

/**
 * Verify a Signed Bundle: schema (signed + inner bundle), signature, bundle_hash, merkle_root, intent_hash chain, prev_hash chain.
 * @param {object} signedBundle - { bundle, signature }
 * @param {string} publicKeyB64 - Ed25519 public key (base64)
 * @param {string} [baseDir]
 * @returns {{ verified: boolean, errors?: string[] }}
 */
export function verifySignedBundle(
  signedBundle,
  publicKeyB64,
  baseDir = defaultBaseDir
) {
  const errors = [];
  if (!signedBundle?.bundle || !signedBundle?.signature?.sig_b64) {
    return { verified: false, errors: ["Invalid signed bundle format."] };
  }
  const publicKey = publicKeyB64 || signedBundle.signature?.signer?.public_key_b64;
  if (!publicKey) {
    return { verified: false, errors: ["Missing public key (provide public_key_b64 or bundle must include signer.public_key_b64)."] };
  }

  // 1) Schema: signed_bundle
  const schemaResult = validateOne(
    "schemas/v1/signed_bundle.schema.json",
    signedBundle,
    baseDir
  );
  if (!schemaResult.valid) {
    schemaResult.errors.forEach((e) => errors.push(`signed_bundle: ${e}`));
    return { verified: false, errors };
  }

  // 2) Schema: inner bundle
  const bundleResult = validateBundle(signedBundle.bundle, baseDir);
  if (!bundleResult.valid) {
    bundleResult.errors.forEach((e) => errors.push(e));
    return { verified: false, errors };
  }

  // 3) Signature
  if (!verifyObject(signedBundle.bundle, signedBundle.signature.sig_b64, publicKey)) {
    errors.push("SIGNATURE INVALID");
    errors.push("Hint: Check that the public key (e.g. public_key.txt) is the one that signed this bundle.");
    return { verified: false, errors };
  }

  // 4) bundle_hash
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
      errors.push("Hint: The bundle may have been modified after signing. Re-sign with dcp sign-bundle.");
      return { verified: false, errors };
    }
  }

  // 5) merkle_root
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
      errors.push("Hint: audit_entries may have been reordered or modified after signing.");
      return { verified: false, errors };
    }
  }

  // 6) intent_hash and prev_hash chain
  const bundle = signedBundle.bundle;
  const intent = bundle.intent;
  const expectedIntentHash = intentHash(intent);
  let prevHashExpected = "GENESIS";
  for (let i = 0; i < bundle.audit_entries.length; i++) {
    const entry = bundle.audit_entries[i];
    if (entry.intent_hash !== expectedIntentHash) {
      errors.push(
        `intent_hash (entry ${i}): expected ${expectedIntentHash}, got ${entry.intent_hash}`
      );
      return { verified: false, errors };
    }
    if (entry.prev_hash !== prevHashExpected) {
      errors.push(
        `prev_hash chain (entry ${i}): expected ${prevHashExpected}, got ${entry.prev_hash}`
      );
      return { verified: false, errors };
    }
    prevHashExpected = hashObject(entry);
  }

  return { verified: true };
}
