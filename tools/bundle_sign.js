import fs from "fs";
import crypto from "crypto";
import nacl from "tweetnacl";
import naclUtil from "tweetnacl-util";
import { signObject, signComposite, computeKid, generateHybridKeypair } from "./crypto.js";
import {
  canonicalize,
  merkleRootForAuditEntries,
  generateBundleManifest,
  dualHashObject,
  dualMerkleRootForAuditEntries,
} from "./merkle.js";

const { encodeBase64, decodeBase64 } = naclUtil;

const args = process.argv.slice(2);
const isV2 = args.includes("--v2") || args.includes("--composite");
const filteredArgs = args.filter(a => !a.startsWith("--"));

const bundlePath = filteredArgs[0];
const secretKeyPath = filteredArgs[1];
const outPath = filteredArgs[2] || (isV2 ? "bundle_v2.signed.json" : "citizenship_bundle.signed.json");

if (!bundlePath || !secretKeyPath) {
  console.error("Usage: node tools/bundle_sign.js <bundle.json> <secret_key.txt> [out.json] [--v2|--composite]");
  process.exit(2);
}

const bundle = JSON.parse(fs.readFileSync(bundlePath, "utf8"));
const secretKeyB64 = fs.readFileSync(secretKeyPath, "utf8").trim();
const secretKey = decodeBase64(secretKeyB64);
const keyPair = nacl.sign.keyPair.fromSecretKey(secretKey);
const publicKeyB64 = encodeBase64(keyPair.publicKey);

if (isV2) {
  const manifest = generateBundleManifest(bundle);
  const kid = computeKid(publicKeyB64);

  const hybrid = generateHybridKeypair();
  const compositeSig = signComposite(bundle, secretKeyB64, hybrid.pq.secretKeyB64, "bundle");

  const signed = {
    dcp_version: "2.0",
    bundle,
    bundle_manifest: manifest,
    signature: {
      ...compositeSig,
      created_at: new Date().toISOString(),
      signer: {
        type: bundle.responsible_principal_record?.entity_type || "human",
        id: bundle.responsible_principal_record?.human_id || null,
        keys: [
          { kid, algorithm: "Ed25519", public_key_b64: publicKeyB64 },
          { kid: hybrid.pq.kid, algorithm: "ML-DSA-65", public_key_b64: hybrid.pq.publicKeyB64, simulated: true },
        ],
      },
    },
    session_nonce: crypto.randomBytes(16).toString("hex"),
  };

  fs.writeFileSync(outPath, JSON.stringify(signed, null, 2));
  console.log(`✅ V2 composite signed bundle written to ${outPath}`);
} else {
  const bundleHashHex = crypto
    .createHash("sha256")
    .update(canonicalize(bundle), "utf8")
    .digest("hex");

  const merkleHex = Array.isArray(bundle.audit_entries)
    ? merkleRootForAuditEntries(bundle.audit_entries)
    : null;

  const sigB64 = signObject(bundle, secretKeyB64);

  const signed = {
    bundle,
    signature: {
      alg: "ed25519",
      created_at: new Date().toISOString(),
      signer: {
        type: "human",
        id: bundle.responsible_principal_record?.human_id || null,
        public_key_b64: publicKeyB64,
      },
      bundle_hash: `sha256:${bundleHashHex}`,
      merkle_root: merkleHex ? `sha256:${merkleHex}` : null,
      sig_b64: sigB64,
    },
  };

  fs.writeFileSync(outPath, JSON.stringify(signed, null, 2));
  console.log(`✅ Signed bundle written to ${outPath}`);
}
