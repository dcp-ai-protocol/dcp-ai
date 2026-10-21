import fs from "fs";
import crypto from "crypto";
import { verifyObject } from "./crypto.js";
import { canonicalize, merkleRootForAuditEntries } from "./merkle.js";
import { isV2Bundle, verifySignedBundle } from "../lib/verify.js";

const signedPath = process.argv[2];
const publicKeyPath = process.argv[3];

if (!signedPath || !publicKeyPath) {
  console.error("Usage: node tools/bundle_verify.js <bundle.signed.json> <public_key.txt>");
  process.exit(2);
}

const signed = JSON.parse(fs.readFileSync(signedPath, "utf8"));
const publicKeyB64 = fs.readFileSync(publicKeyPath, "utf8").trim();

if (isV2Bundle(signed)) {
  // V2 goes through the reference verifier; the key pins the classical signer.
  const result = await verifySignedBundle(signed, publicKeyB64);
  for (const w of result.warnings || []) console.log(`⚠️  ${w}`);
  if (!result.verified) {
    for (const e of result.errors) console.error(`❌ ${e}`);
    process.exit(1);
  }
  console.log("✅ V2 BUNDLE VERIFIED");
  process.exit(0);
}

verifyV1(signed, publicKeyB64);

function verifyV1(signed, publicKeyB64) {
  if (!signed.bundle || !signed.signature?.sig_b64) {
    console.error("Invalid signed bundle format.");
    process.exit(2);
  }

  const okSig = verifyObject(signed.bundle, signed.signature.sig_b64, publicKeyB64);
  if (!okSig) {
    console.error("❌ SIGNATURE INVALID");
    process.exit(1);
  }

  if (typeof signed.signature.bundle_hash === "string" && signed.signature.bundle_hash.startsWith("sha256:")) {
    const expectedHex = crypto
      .createHash("sha256")
      .update(canonicalize(signed.bundle), "utf8")
      .digest("hex");

    const got = signed.signature.bundle_hash.slice("sha256:".length);
    if (got !== expectedHex) {
      console.error("❌ BUNDLE HASH MISMATCH");
      process.exit(1);
    }
  }

  if (typeof signed.signature.merkle_root === "string" && signed.signature.merkle_root.startsWith("sha256:")) {
    const expectedMerkle = Array.isArray(signed.bundle.audit_entries)
      ? merkleRootForAuditEntries(signed.bundle.audit_entries)
      : null;

    const gotMerkle = signed.signature.merkle_root.slice("sha256:".length);
    if (!expectedMerkle || gotMerkle !== expectedMerkle) {
      console.error("❌ MERKLE ROOT MISMATCH");
      process.exit(1);
    }
  }

  console.log("✅ V1 SIGNATURE VALID");
  console.log("✅ V1 BUNDLE INTEGRITY VALID");
  process.exit(0);
}
