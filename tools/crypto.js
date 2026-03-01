import crypto from "crypto";
import nacl from "tweetnacl";
import naclUtil from "tweetnacl-util";
const { decodeUTF8, encodeBase64, decodeBase64 } = naclUtil;
import stringify from "json-stable-stringify";

// --- V1 + V2 shared ---

export function canonicalize(obj) {
  return stringify(obj);
}

// --- V1: Ed25519 ---

export function generateKeypair() {
  const kp = nacl.sign.keyPair();
  return {
    publicKeyB64: encodeBase64(kp.publicKey),
    secretKeyB64: encodeBase64(kp.secretKey)
  };
}

export function signObject(obj, secretKeyB64) {
  const msg = decodeUTF8(canonicalize(obj));
  const sk = decodeBase64(secretKeyB64);
  const sig = nacl.sign.detached(msg, sk);
  return encodeBase64(sig);
}

export function verifyObject(obj, signatureB64, publicKeyB64) {
  const msg = decodeUTF8(canonicalize(obj));
  const sig = decodeBase64(signatureB64);
  const pk = decodeBase64(publicKeyB64);
  return nacl.sign.detached.verify(msg, sig, pk);
}

// --- V2: Deterministic Key ID (kid) ---

export function computeKid(publicKeyB64) {
  const raw = decodeBase64(publicKeyB64);
  const hash = crypto.createHash("sha256").update(raw).digest();
  return hash.toString("base64url").slice(0, 16);
}

// --- V2: Domain Separation ---

const DOMAIN_TAGS = {
  bundle: "DCP-BUNDLE-SIG-v2",
  intent: "DCP-INTENT-SIG-v2",
  passport: "DCP-PASSPORT-SIG-v2",
  revocation: "DCP-REVOKE-SIG-v2",
  governance: "DCP-GOVERN-SIG-v2",
};

export function domainSeparatedMessage(domain, obj) {
  const tag = DOMAIN_TAGS[domain] || `DCP-${domain.toUpperCase()}-v2`;
  const canon = canonicalize(obj);
  return `${tag}|${canon}`;
}

// --- V2: Hybrid Keypair Generation (Ed25519 + ML-DSA-65 placeholder) ---

export function generateHybridKeypair() {
  const ed = nacl.sign.keyPair();
  const pqPublic = crypto.randomBytes(1952);
  const pqSecret = crypto.randomBytes(4032);

  return {
    classical: {
      algorithm: "Ed25519",
      publicKeyB64: encodeBase64(ed.publicKey),
      secretKeyB64: encodeBase64(ed.secretKey),
      kid: computeKid(encodeBase64(ed.publicKey)),
    },
    pq: {
      algorithm: "ML-DSA-65",
      publicKeyB64: encodeBase64(pqPublic),
      secretKeyB64: encodeBase64(pqSecret),
      kid: computeKid(encodeBase64(pqPublic)),
      note: "Simulated — real ML-DSA-65 requires FIPS 204 library",
    },
  };
}

// --- V2: Composite Signature (Ed25519 + ML-DSA-65 placeholder) ---

export function signComposite(obj, edSecretKeyB64, pqSecretKeyB64, domain = "bundle") {
  const msg = domainSeparatedMessage(domain, obj);
  const msgBytes = decodeUTF8(msg);

  const edSk = decodeBase64(edSecretKeyB64);
  const classicalSig = encodeBase64(nacl.sign.detached(msgBytes, edSk));

  const pqSk = decodeBase64(pqSecretKeyB64);
  const pqSimulated = encodeBase64(
    crypto.createHmac("sha256", pqSk.slice(0, 64)).update(msgBytes).digest()
  );

  return {
    classical: { algorithm: "Ed25519", value: classicalSig },
    pq: { algorithm: "ML-DSA-65", value: pqSimulated, simulated: true },
    binding: "composite",
    domain_sep: DOMAIN_TAGS[domain] || `DCP-${domain.toUpperCase()}-v2`,
  };
}

export function verifyComposite(obj, compositeSig, edPublicKeyB64, domain = "bundle") {
  const msg = domainSeparatedMessage(domain, obj);
  const msgBytes = decodeUTF8(msg);

  const edSig = decodeBase64(compositeSig.classical.value);
  const edPk = decodeBase64(edPublicKeyB64);
  const classicalOk = nacl.sign.detached.verify(msgBytes, edSig, edPk);

  if (compositeSig.pq?.simulated) {
    return { valid: classicalOk, classicalValid: classicalOk, pqValid: "skipped-simulated" };
  }

  return { valid: classicalOk, classicalValid: classicalOk, pqValid: "not-implemented" };
}
