import fs from "fs";
import crypto from "crypto";
import { verifyObject, verifyComposite } from "./crypto.js";
import {
  canonicalize,
  merkleRootForAuditEntries,
  dualHashObject,
  dualMerkleRootForAuditEntries,
} from "./merkle.js";

const signedPath = process.argv[2];
const publicKeyPath = process.argv[3];
const pqPublicKeyPath = process.argv[4];

if (!signedPath || !publicKeyPath) {
  console.error("Usage: node tools/bundle_verify.js <bundle.signed.json> <public_key.txt> [pq_public_key.txt]");
  process.exit(2);
}

const signed = JSON.parse(fs.readFileSync(signedPath, "utf8"));
const publicKeyB64 = fs.readFileSync(publicKeyPath, "utf8").trim();
const pqPublicKeyB64 = pqPublicKeyPath ? fs.readFileSync(pqPublicKeyPath, "utf8").trim() : null;

const isV2 = signed.dcp_version === "2.0" || signed.signature?.binding === "pq_over_classical";

if (isV2) {
  verifyV2(signed, publicKeyB64, pqPublicKeyB64);
} else {
  verifyV1(signed, publicKeyB64);
}

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

function verifyV2(signed, publicKeyB64, pqPublicKeyB64) {
  if (!signed.bundle || !signed.signature) {
    console.error("Invalid V2 signed bundle format.");
    process.exit(2);
  }

  const compositeSig = signed.signature;
  if (!compositeSig.classical?.value) {
    console.error("❌ V2 bundle missing classical signature component");
    process.exit(2);
  }

  const signerPqKey = pqPublicKeyB64 ||
    signed.signature?.signer?.keys?.find(k => k.algorithm === "ML-DSA-65")?.public_key_b64;

  const result = verifyComposite(signed.bundle, compositeSig, publicKeyB64, signerPqKey, "bundle");
  if (!result.classicalValid) {
    console.error("❌ V2 CLASSICAL SIGNATURE INVALID");
    process.exit(1);
  }
  console.log("✅ V2 classical signature VALID");

  if (result.pqValid === true) {
    console.log("✅ V2 PQ signature VALID (ML-DSA-65)");
  } else if (result.pqValid === false) {
    console.error("❌ V2 PQ SIGNATURE INVALID");
    process.exit(1);
  } else if (result.pqValid === "missing") {
    console.log("⚠️  V2 PQ signature not present (classical-only mode)");
  }

  if (signed.bundle_manifest) {
    const manifest = signed.bundle_manifest;
    const computed = dualHashObject(signed.bundle);

    if (manifest.bundle_hash?.sha256 && manifest.bundle_hash.sha256 !== computed.sha256) {
      console.error("❌ V2 BUNDLE MANIFEST SHA-256 MISMATCH");
      process.exit(1);
    }
    if (manifest.bundle_hash?.["sha3-256"] && manifest.bundle_hash["sha3-256"] !== computed["sha3-256"]) {
      console.error("❌ V2 BUNDLE MANIFEST SHA3-256 MISMATCH");
      process.exit(1);
    }
    console.log("✅ V2 bundle_manifest hashes VALID");

    if (manifest.merkle_root && Array.isArray(signed.bundle.audit_entries)) {
      const dualMerkle = dualMerkleRootForAuditEntries(signed.bundle.audit_entries);
      if (manifest.merkle_root.sha256 && manifest.merkle_root.sha256 !== dualMerkle.sha256) {
        console.error("❌ V2 MERKLE ROOT SHA-256 MISMATCH");
        process.exit(1);
      }
      console.log("✅ V2 dual Merkle root VALID");
    }
  }

  if (signed.session_nonce) {
    console.log(`✅ V2 session_nonce present: ${signed.session_nonce}`);
  }

  console.log("✅ V2 BUNDLE INTEGRITY VALID");
  process.exit(0);
}
