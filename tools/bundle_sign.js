import fs from "fs";
import crypto from "crypto";
import nacl from "tweetnacl";
import naclUtil from "tweetnacl-util";
import { signObject } from "./crypto.js";
import { canonicalize, merkleRootForAuditEntries } from "./merkle.js";

const { encodeBase64, decodeBase64 } = naclUtil;

const args = process.argv.slice(2);
if (args.includes("--v2") || args.includes("--composite")) {
  console.error("V2 bundles are signed with `dcp sign-bundle --composite` (normative SignedBundleV2 via @dcp-ai/sdk).");
  process.exit(2);
}

const [bundlePath, secretKeyPath, outPath = "citizenship_bundle.signed.json"] = args;

if (!bundlePath || !secretKeyPath) {
  console.error("Usage: node tools/bundle_sign.js <bundle.json> <secret_key.txt> [out.json]");
  process.exit(2);
}

const bundle = JSON.parse(fs.readFileSync(bundlePath, "utf8"));
const secretKeyB64 = fs.readFileSync(secretKeyPath, "utf8").trim();
const secretKey = decodeBase64(secretKeyB64);
const keyPair = nacl.sign.keyPair.fromSecretKey(secretKey);
const publicKeyB64 = encodeBase64(keyPair.publicKey);

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

// A new file renamed over the output: a symlink or hard link at outPath is replaced, not written through.
const tmp = `${outPath}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`;
const fd = fs.openSync(tmp, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW ?? 0), 0o644);
try {
  fs.writeFileSync(fd, JSON.stringify(signed, null, 2));
} finally {
  fs.closeSync(fd);
}
try {
  fs.renameSync(tmp, outPath);
} catch (err) {
  fs.rmSync(tmp, { force: true });
  console.error(`Cannot write ${outPath}: ${err.message}`);
  process.exit(1);
}
console.log(`✅ Signed bundle written to ${outPath}`);
