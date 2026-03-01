import crypto from "crypto";
import nacl from "tweetnacl";
import naclUtil from "tweetnacl-util";
const { decodeUTF8, encodeBase64, decodeBase64 } = naclUtil;
import stringify from "json-stable-stringify";
import { ml_dsa65 } from "@noble/post-quantum/ml-dsa";

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

// --- V2: ML-DSA-65 Real Keygen ---

export function generateMlDsa65Keypair() {
  const keys = ml_dsa65.keygen();
  return {
    publicKey: keys.publicKey,
    secretKey: keys.secretKey,
    publicKeyB64: Buffer.from(keys.publicKey).toString("base64"),
    secretKeyB64: Buffer.from(keys.secretKey).toString("base64"),
  };
}

// --- V2: Hybrid Keypair Generation (Ed25519 + ML-DSA-65) ---

export function generateHybridKeypair() {
  const ed = nacl.sign.keyPair();
  const pq = generateMlDsa65Keypair();

  return {
    classical: {
      algorithm: "Ed25519",
      publicKeyB64: encodeBase64(ed.publicKey),
      secretKeyB64: encodeBase64(ed.secretKey),
      kid: computeKid(encodeBase64(ed.publicKey)),
    },
    pq: {
      algorithm: "ML-DSA-65",
      publicKeyB64: pq.publicKeyB64,
      secretKeyB64: pq.secretKeyB64,
      kid: computeKid(pq.publicKeyB64),
    },
  };
}

// --- V2: Composite Signature (Ed25519 + ML-DSA-65) ---

export function signComposite(obj, edSecretKeyB64, pqSecretKeyB64, domain = "bundle") {
  const msg = domainSeparatedMessage(domain, obj);
  const msgBytes = decodeUTF8(msg);

  const edSk = decodeBase64(edSecretKeyB64);
  const classicalSig = encodeBase64(nacl.sign.detached(msgBytes, edSk));

  const pqSk = Buffer.from(pqSecretKeyB64, "base64");
  const bindingInput = Buffer.concat([
    Buffer.from(msgBytes),
    Buffer.from(classicalSig, "base64"),
  ]);
  const pqSig = ml_dsa65.sign(pqSk, bindingInput);
  const pqSigB64 = Buffer.from(pqSig).toString("base64");

  return {
    classical: { algorithm: "Ed25519", value: classicalSig },
    pq: { algorithm: "ML-DSA-65", value: pqSigB64 },
    binding: "pq_over_classical",
    domain_sep: DOMAIN_TAGS[domain] || `DCP-${domain.toUpperCase()}-v2`,
  };
}

export function verifyComposite(obj, compositeSig, edPublicKeyB64, pqPublicKeyB64, domain = "bundle") {
  const msg = domainSeparatedMessage(domain, obj);
  const msgBytes = decodeUTF8(msg);

  const edSig = decodeBase64(compositeSig.classical.value);
  const edPk = decodeBase64(edPublicKeyB64);
  const classicalOk = nacl.sign.detached.verify(msgBytes, edSig, edPk);

  if (!classicalOk) {
    return { valid: false, classicalValid: false, pqValid: false };
  }

  if (!compositeSig.pq?.value || !pqPublicKeyB64) {
    return { valid: classicalOk, classicalValid: classicalOk, pqValid: "missing" };
  }

  const pqPk = Buffer.from(pqPublicKeyB64, "base64");
  const pqSig = Buffer.from(compositeSig.pq.value, "base64");
  const bindingInput = Buffer.concat([
    Buffer.from(msgBytes),
    Buffer.from(compositeSig.classical.value, "base64"),
  ]);

  let pqOk = false;
  try {
    pqOk = ml_dsa65.verify(pqPk, bindingInput, pqSig);
  } catch {
    pqOk = false;
  }

  return { valid: classicalOk && pqOk, classicalValid: classicalOk, pqValid: pqOk };
}
