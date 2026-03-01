/**
 * DCP v2.0 Proof of Possession (PoP) for key registration and rotation.
 *
 * PoP for key rotation:
 *   1. New key signs a challenge containing old_kid + new_kid + timestamp
 *      with context "DCP-AI.v2.KeyRotation"
 *   2. Old key counter-signs to authorize the rotation
 *
 * PoP for initial registration:
 *   New key signs a challenge containing kid + agent_id + timestamp
 *   with context "DCP-AI.v2.ProofOfPossession"
 */

import type { CryptoProvider } from './crypto-provider.js';
import type { SignatureEntry } from './composite-sig.js';
import { DCP_CONTEXTS } from './domain-separation.js';
import { domainSeparatedMessage } from './domain-separation.js';
import { canonicalizeV2 } from './canonicalize.js';
import { AlgorithmRegistry } from './crypto-registry.js';

export interface KeyRotationRecord {
  type: 'key_rotation';
  old_kid: string;
  new_kid: string;
  new_key: {
    kid: string;
    alg: string;
    public_key_b64: string;
    created_at: string;
    expires_at: string | null;
    status: 'active';
  };
  timestamp: string;
  proof_of_possession: SignatureEntry;
  authorization_sig: SignatureEntry;
}

export interface PopChallenge {
  kid: string;
  agent_id: string;
  timestamp: string;
  nonce: string;
}

/**
 * Generate a proof-of-possession for initial key registration.
 *
 * The key signs a challenge payload containing its own kid + agent_id + timestamp
 * under the ProofOfPossession context.
 */
export async function generateRegistrationPoP(
  registry: AlgorithmRegistry,
  challenge: PopChallenge,
  alg: string,
  secretKeyB64: string,
): Promise<SignatureEntry> {
  const provider = registry.getSigner(alg);
  const canonical = canonicalizeV2(challenge);
  const payloadBytes = new TextEncoder().encode(canonical);
  const dsm = domainSeparatedMessage(
    DCP_CONTEXTS.ProofOfPossession,
    payloadBytes,
  );
  const sig = await provider.sign(dsm, secretKeyB64);

  return {
    alg,
    kid: challenge.kid,
    sig_b64: Buffer.from(sig).toString('base64'),
  };
}

/**
 * Verify a proof-of-possession for key registration.
 */
export async function verifyRegistrationPoP(
  registry: AlgorithmRegistry,
  challenge: PopChallenge,
  pop: SignatureEntry,
  publicKeyB64: string,
): Promise<boolean> {
  const provider = registry.getSigner(pop.alg);
  const canonical = canonicalizeV2(challenge);
  const payloadBytes = new TextEncoder().encode(canonical);
  const dsm = domainSeparatedMessage(
    DCP_CONTEXTS.ProofOfPossession,
    payloadBytes,
  );
  const sig = new Uint8Array(Buffer.from(pop.sig_b64, 'base64'));
  return provider.verify(dsm, sig, publicKeyB64);
}

/**
 * Create a key rotation record with proof-of-possession.
 *
 * The new key signs (old_kid + new_kid + timestamp) under KeyRotation context.
 * The old key counter-signs the same payload to authorize the rotation.
 */
export async function createKeyRotation(
  registry: AlgorithmRegistry,
  params: {
    oldKid: string;
    oldAlg: string;
    oldSecretKeyB64: string;
    newKid: string;
    newAlg: string;
    newSecretKeyB64: string;
    newPublicKeyB64: string;
    timestamp: string;
    expiresAt: string | null;
  },
): Promise<KeyRotationRecord> {
  const rotationPayload = {
    old_kid: params.oldKid,
    new_kid: params.newKid,
    timestamp: params.timestamp,
  };
  const canonical = canonicalizeV2(rotationPayload);
  const payloadBytes = new TextEncoder().encode(canonical);
  const dsm = domainSeparatedMessage(
    DCP_CONTEXTS.KeyRotation,
    payloadBytes,
  );

  const newProvider = registry.getSigner(params.newAlg);
  const oldProvider = registry.getSigner(params.oldAlg);

  const [popSig, authSig] = await Promise.all([
    newProvider.sign(dsm, params.newSecretKeyB64),
    oldProvider.sign(dsm, params.oldSecretKeyB64),
  ]);

  return {
    type: 'key_rotation',
    old_kid: params.oldKid,
    new_kid: params.newKid,
    new_key: {
      kid: params.newKid,
      alg: params.newAlg,
      public_key_b64: params.newPublicKeyB64,
      created_at: params.timestamp,
      expires_at: params.expiresAt,
      status: 'active',
    },
    timestamp: params.timestamp,
    proof_of_possession: {
      alg: params.newAlg,
      kid: params.newKid,
      sig_b64: Buffer.from(popSig).toString('base64'),
    },
    authorization_sig: {
      alg: params.oldAlg,
      kid: params.oldKid,
      sig_b64: Buffer.from(authSig).toString('base64'),
    },
  };
}

/**
 * Verify a key rotation record.
 *
 * Checks both the PoP (new key) and authorization (old key) signatures.
 */
export async function verifyKeyRotation(
  registry: AlgorithmRegistry,
  record: KeyRotationRecord,
  oldPublicKeyB64: string,
  newPublicKeyB64: string,
): Promise<{ valid: boolean; pop_valid: boolean; auth_valid: boolean }> {
  const rotationPayload = {
    old_kid: record.old_kid,
    new_kid: record.new_kid,
    timestamp: record.timestamp,
  };
  const canonical = canonicalizeV2(rotationPayload);
  const payloadBytes = new TextEncoder().encode(canonical);
  const dsm = domainSeparatedMessage(
    DCP_CONTEXTS.KeyRotation,
    payloadBytes,
  );

  const newProvider = registry.getSigner(record.proof_of_possession.alg);
  const oldProvider = registry.getSigner(record.authorization_sig.alg);

  const popSig = new Uint8Array(
    Buffer.from(record.proof_of_possession.sig_b64, 'base64'),
  );
  const authSig = new Uint8Array(
    Buffer.from(record.authorization_sig.sig_b64, 'base64'),
  );

  const [popValid, authValid] = await Promise.all([
    newProvider.verify(dsm, popSig, newPublicKeyB64),
    oldProvider.verify(dsm, authSig, oldPublicKeyB64),
  ]);

  return {
    valid: popValid && authValid,
    pop_valid: popValid,
    auth_valid: authValid,
  };
}
