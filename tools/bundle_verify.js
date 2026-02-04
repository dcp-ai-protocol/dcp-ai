import fs from "fs";
import crypto from "crypto";
import { verifyObject } from "./crypto.js";
import { canonicalize, merkleRootForAuditEntries } from "./merkle.js";

const signedPath = process.argv[2];
const publicKeyPath = process.argv[3];

if (!signedPath || !publicKeyPath) {
  console.error("Usage: node tools/bundle_verify.js <bundle.signed.json> <public_key.txt>");
  process.exit(2);
}

const signed = JSON.parse(fs.readFileSync(signedPath, "utf8"));
const publicKeyB64 = fs.readFileSync(publicKeyPath, "utf8").trim();

if (!signed.bundle || !signed.signature?.sig_b64) {
  console.error("Invalid signed bundle format.");
  process.exit(2);
}

// 1) Verify cryptographic signature over canonicalized bundle
const okSig = verifyObject(signed.bundle, signed.signature.sig_b64, publicKeyB64);
if (!okSig) {
  console.error("❌ SIGNATURE INVALID");
  console.error("Hint: Check that the public key (e.g. public_key.txt) is the one that signed this bundle.");
  process.exit(1);
}

// 2) Optional: verify bundle_hash matches canonical hash
if (typeof signed.signature.bundle_hash === "string" && signed.signature.bundle_hash.startsWith("sha256:")) {
  const expectedHex = crypto
    .createHash("sha256")
    .update(canonicalize(signed.bundle), "utf8")
    .digest("hex");

  const got = signed.signature.bundle_hash.slice("sha256:".length);
  if (got !== expectedHex) {
    console.error("❌ BUNDLE HASH MISMATCH");
    console.error("Hint: The bundle may have been modified after signing. Re-sign with dcp sign-bundle.");
    process.exit(1);
  }
}

// 3) Optional: verify merkle_root if present
if (typeof signed.signature.merkle_root === "string" && signed.signature.merkle_root.startsWith("sha256:")) {
  const expectedMerkle = Array.isArray(signed.bundle.audit_entries)
    ? merkleRootForAuditEntries(signed.bundle.audit_entries)
    : null;

  const gotMerkle = signed.signature.merkle_root.slice("sha256:".length);
  if (!expectedMerkle || gotMerkle !== expectedMerkle) {
    console.error("❌ MERKLE ROOT MISMATCH");
    console.error("Hint: audit_entries may have been reordered or modified after signing.");
    process.exit(1);
  }
}

console.log("✅ SIGNATURE VALID");
console.log("✅ BUNDLE INTEGRITY VALID");
process.exit(0);
