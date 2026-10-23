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
import {
  AlgorithmRegistry,
  DEFAULT_VERIFIER_POLICY,
  Ed25519Provider,
  MlDsa65Provider,
  SlhDsa192fProvider,
  canonicalizeV2,
  compositeVerify,
  deriveKid,
  verifySignedBundleV2,
} from "@dcp-ai/sdk";
import { verifyObject } from "../tools/crypto.js";
import {
  canonicalize,
  merkleRootForAuditEntries,
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

// One Ajv per schema root and one compiled validator per schema file, built on
// first use: loading and compiling every schema on each call cost ~30 ms.
// ponytail: schema files are read once per process; restart to pick up edits.
const ajvByBaseDir = new Map();
const validatorByPath = new Map();

function compiledValidator(fullPath, baseDir) {
  const key = `${baseDir}\0${fullPath}`;
  let validate = validatorByPath.get(key);
  if (!validate) {
    let ajv = ajvByBaseDir.get(baseDir);
    if (!ajv) {
      ajv = createAjv(baseDir);
      ajvByBaseDir.set(baseDir, ajv);
    }
    const schema = loadJson(fullPath);
    validate = (schema.$id && ajv.getSchema(schema.$id)) || ajv.compile(schema);
    validatorByPath.set(key, validate);
  }
  return validate;
}

function formatErrors(validate) {
  return (validate.errors || []).map(
    (e) => `${e.instancePath || "/"} ${e.message}`,
  );
}

/**
 * Detect whether a signed bundle is V2 format (schemas/v2/signed_bundle.schema.json).
 */
export function isV2Bundle(signedBundle) {
  return (
    signedBundle?.bundle?.dcp_bundle_version === "2.0" ||
    signedBundle?.bundle?.manifest !== undefined
  );
}

// Pre-normative V2 envelope (top-level dcp_version / bundle_manifest) that
// earlier versions of this repo produced; no SDK emits or verifies it.
function isLegacyV2Envelope(signedBundle) {
  return (
    signedBundle?.dcp_version === "2.0" ||
    signedBundle?.bundle_manifest !== undefined ||
    signedBundle?.signature?.binding === "composite"
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
  const fullPath = path.isAbsolute(schemaPath)
    ? schemaPath
    : path.join(baseDir, schemaPath);
  let validate;
  try {
    validate = compiledValidator(fullPath, baseDir);
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

/**
 * Verify a V1 or V2 signed bundle. Async because V2 verification is.
 * @param {{ mode?: string }} [options] - V2 only, see verifyV2SignedBundle.
 */
export async function verifySignedBundle(
  signedBundle,
  publicKeyB64,
  baseDir = defaultBaseDir,
  options = {},
) {
  if (isLegacyV2Envelope(signedBundle)) {
    return {
      verified: false,
      errors: [
        "Unsupported pre-normative V2 envelope (top-level dcp_version/bundle_manifest). " +
          "Re-sign with @dcp-ai/sdk signBundleV2 or `dcp sign-bundle --composite`.",
      ],
    };
  }
  if (isV2Bundle(signedBundle)) {
    return verifyV2SignedBundle(signedBundle, publicKeyB64, baseDir, options);
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

  return { verified: true, errors: [] };
}

// ═══════════════════════════════════════════════════════════
// V2 Bundle Validation & Verification
// ═══════════════════════════════════════════════════════════

// The normative V2 pipeline (payload hashes, manifest, composite signature
// over "DCP-AI.v2.Bundle", session binding, audit chain, key validity) lives
// in @dcp-ai/sdk, which is tested against the cross-SDK interop vectors. A
// second implementation here is how this verifier drifted from the wire
// format, so this layer only adds what the SDK skips: JSON Schema validation
// and optional signer-key pinning.

export const v2Registry = new AlgorithmRegistry();
for (const provider of [new Ed25519Provider(), new MlDsa65Provider(), new SlhDsa192fProvider()]) {
  v2Registry.registerSigner(provider);
}

/**
 * Exact sizes of the keys and signatures this registry verifies. Lenient base64
 * decoders skip whitespace and junk, so a padded key still verified and was
 * stored as sent: only the canonical encoding of exactly these bytes passes.
 */
export const KEY_BYTES = { ed25519: 32, "ml-dsa-65": 1952, "slh-dsa-192f": 48 };
export const SIG_BYTES = { ed25519: 64, "ml-dsa-65": 3309, "slh-dsa-192f": 35664 };

export function isCanonicalB64(value, bytes) {
  if (typeof value !== "string" || bytes === undefined || value.length > 4 * Math.ceil(bytes / 3)) return false;
  const decoded = Buffer.from(value, "base64");
  return decoded.length === bytes && decoded.toString("base64") === value;
}

/**
 * Verify a composite signature over canonical(payload) under a DCP context
 * tag. Signer keys are looked up in `keys` (KeyEntry[]) by kid and alg, and a
 * kid only counts when it is the key's derived kid. The PQ half is required
 * unless `allowClassicalOnly`.
 * @returns {Promise<boolean>}
 */
export async function verifyCompositeSig(context, payload, sig, keys, { allowClassicalOnly = false } = {}) {
  try {
    // Each slot needs its own kind of key (distinct algs, hence distinct kids):
    // one key in both slots, or two Ed25519 keys, is not a hybrid signature.
    const { accepted_classical_algs, accepted_pq_algs } = DEFAULT_VERIFIER_POLICY;
    if (!accepted_classical_algs.includes(sig.classical.alg)) return false;
    if (sig.pq && !accepted_pq_algs.includes(sig.pq.alg)) return false;
    if (!isCanonicalB64(sig.classical.sig_b64, SIG_BYTES[sig.classical.alg])) return false;
    if (sig.pq && !isCanonicalB64(sig.pq.sig_b64, SIG_BYTES[sig.pq.alg])) return false;
    const signer = (entry) => entry && keys.find((k) =>
      k.kid === entry.kid && k.alg === entry.alg && isCanonicalB64(k.public_key_b64, KEY_BYTES[k.alg]) &&
      k.kid === deriveKid(k.alg, Buffer.from(k.public_key_b64, "base64")));
    const classical = signer(sig.classical);
    const pq = signer(sig.pq);
    if (!classical || (!pq && !allowClassicalOnly)) return false;
    const bytes = new TextEncoder().encode(canonicalizeV2(payload));
    const result = await compositeVerify(v2Registry, context, bytes, sig, classical.public_key_b64, pq?.public_key_b64);
    return result.valid;
  } catch {
    return false; // malformed signature or key, unknown algorithm, non-canonical payload
  }
}

export const V2_VERIFICATION_MODES = ["classical_only", "hybrid_preferred", "hybrid_required", "pq_only"];

const V2_SIGNED_PAYLOADS = [
  ["schemas/v2/responsible_principal_record.schema.json", "responsible_principal_record"],
  ["schemas/v2/agent_passport.schema.json", "agent_passport"],
  ["schemas/v2/intent.schema.json", "intent"],
  ["schemas/v2/policy_decision.schema.json", "policy_decision"],
];

export function validateV2Bundle(signedBundle, baseDir = defaultBaseDir) {
  const envelope = validateOne("schemas/v2/signed_bundle.schema.json", signedBundle, baseDir);
  if (!envelope.valid) {
    return { valid: false, errors: envelope.errors.map((e) => `signed_bundle: ${e}`) };
  }
  const errors = [];
  for (const [schemaPath, name] of V2_SIGNED_PAYLOADS) {
    const result = validateOne(schemaPath, signedBundle.bundle[name].payload, baseDir);
    if (!result.valid) result.errors.forEach((e) => errors.push(`${name}: ${e}`));
  }
  if (errors.length > 0) return { valid: false, errors };
  return { valid: true };
}

/**
 * @param {string} [publicKeyB64] - If given, the bundle's classical signer key must equal it.
 * @param {{ policy?: object, mode?: string }} [options] - `policy` is a full verifier policy
 *   (defaults to the SDK's DEFAULT_VERIFIER_POLICY); `mode` forces one of
 *   V2_VERIFICATION_MODES for every risk tier on top of it.
 */
export async function verifyV2SignedBundle(
  signedBundle,
  publicKeyB64,
  baseDir = defaultBaseDir,
  { policy = DEFAULT_VERIFIER_POLICY, mode } = {},
) {
  if (mode && !V2_VERIFICATION_MODES.includes(mode)) {
    return { verified: false, errors: [`Unknown verification mode: ${mode}`] };
  }
  const schemaResult = validateV2Bundle(signedBundle, baseDir);
  if (!schemaResult.valid) return { verified: false, errors: schemaResult.errors };

  const { bundle, signature } = signedBundle;
  if (publicKeyB64) {
    // The bundle signer is the principal: its key is in the RPR binding_keys
    // (spec/VERIFICATION.md V2-6). The published SDK this file runs looks the
    // signer up in the passport first and does not derive kids (V2-13), so every
    // entry under the signing kid, in either list, must carry the pinned key,
    // and the kid must be derived from it.
    const kid = signature.composite_sig.classical.kid;
    const rprKeys = bundle.responsible_principal_record.payload.binding_keys || [];
    const listed = [...bundle.agent_passport.payload.keys, ...rprKeys].filter((k) => k.kid === kid);
    const pinned =
      signature.composite_sig.classical.alg === "ed25519" &&
      rprKeys.some((k) => k.kid === kid) &&
      listed.every((k) => k.alg === "ed25519" && k.public_key_b64 === publicKeyB64) &&
      isCanonicalB64(publicKeyB64, KEY_BYTES.ed25519) &&
      kid === deriveKid("ed25519", Buffer.from(publicKeyB64, "base64"));
    if (!pinned) {
      return { verified: false, errors: ["Bundle is not signed by the expected public key."] };
    }
  }

  const effectivePolicy = mode
    ? { ...policy, default_mode: mode, risk_overrides: { low: mode, medium: mode, high: mode } }
    : policy;
  const result = await verifySignedBundleV2(signedBundle, v2Registry, effectivePolicy);
  // pq_only does not require the classical signature, so a pin on the
  // classical key would only prove the key is listed in the bundle.
  if (publicKeyB64 && result.details?.verification_mode === "pq_only") {
    return {
      verified: false,
      errors: ["Key pinning checks the classical signer, which pq_only mode does not verify."],
      warnings: result.warnings,
    };
  }
  return { verified: result.verified, errors: result.errors, warnings: result.warnings };
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
