import fs from "fs";
import crypto from "crypto";
import nacl from "tweetnacl";
import naclUtil from "tweetnacl-util";
import { signObject } from "./crypto.js";
import { canonicalize, merkleRootForAuditEntries } from "./merkle.js";

const { encodeBase64, decodeBase64 } = naclUtil;

const bundlePath = process.argv[2];
const secretKeyPath = process.argv[3];
const outPath = process.argv[4] || "citizenship_bundle.signed.json";

if (!bundlePath || !secretKeyPath) {
  console.error("Usage: node tools/bundle_sign.js <bundle.json> <secret_key.txt> [out.json]");
  process.exit(2);
}

const bundle = JSON.parse(fs.readFileSync(bundlePath, "utf8"));
const secretKeyB64 = fs.readFileSync(secretKeyPath, "utf8").trim();
const secretKey = decodeBase64(secretKeyB64);
const keyPair = nacl.sign.keyPair.fromSecretKey(secretKey);
const publicKeyB64 = encodeBase64(keyPair.publicKey);

// Deterministic bundle hash
const bundleHashHex = crypto
  .createHash("sha256")
  .update(canonicalize(bundle), "utf8")
  .digest("hex");

// Optional Merkle root for multiple audit entries
const merkleHex = Array.isArray(bundle.audit_entries)
  ? merkleRootForAuditEntries(bundle.audit_entries)
  : null;

// Signature over canonicalized bundle (detached)
const sigB64 = signObject(bundle, secretKeyB64);

const signed = {
  bundle,
  signature: {
    alg: "ed25519",
    created_at: new Date().toISOString(),
    signer: {
      type: "human",
      id: bundle.human_binding_record?.human_id || null,
      public_key_b64: publicKeyB64
    },
    bundle_hash: `sha256:${bundleHashHex}`,
    merkle_root: merkleHex ? `sha256:${merkleHex}` : null,
    sig_b64: sigB64
  }
};

fs.writeFileSync(outPath, JSON.stringify(signed, null, 2));
console.log(`✅ Signed bundle written to ${outPath}`);
