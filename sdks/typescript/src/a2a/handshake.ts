import { createHash, randomBytes } from 'crypto';

export type A2AMessageType =
  | 'A2A_HELLO'
  | 'A2A_WELCOME'
  | 'A2A_CONFIRM'
  | 'A2A_ESTABLISHED'
  | 'A2A_MESSAGE'
  | 'A2A_REKEY'
  | 'A2A_CLOSE'
  | 'A2A_RESUME'
  | 'A2A_RESUMED'
  | 'A2A_RESUME_REJECTED';

export interface A2AHello {
  type: 'A2A_HELLO';
  protocol_version: '2.0';
  initiator_bundle: Record<string, unknown>;
  ephemeral_kem_public_key: {
    alg: string;
    public_key_b64: string;
  };
  nonce: string;
  supported_algorithms: {
    signing: string[];
    kem: string[];
    cipher: string[];
  };
  requested_capabilities: string[];
  security_tier: string;
  timestamp: string;
  /** DCP-09: Optional delegation mandate reference for mutual verification */
  mandate_id?: string;
  /** DCP-09: Hash of the delegation mandate for integrity binding */
  mandate_hash?: string;
}

export interface A2AWelcome {
  type: 'A2A_WELCOME';
  protocol_version: '2.0';
  responder_bundle: Record<string, unknown>;
  ephemeral_kem_public_key: {
    alg: string;
    public_key_b64: string;
  };
  nonce: string;
  kem_ciphertext: {
    alg: string;
    ciphertext_b64: string;
  };
  selected_algorithms: {
    signing: string;
    kem: string;
    cipher: string;
  };
  resolved_security_tier: string;
  timestamp: string;
  /** DCP-09: Optional delegation mandate reference for mutual verification */
  mandate_id?: string;
  /** DCP-09: Hash of the delegation mandate for integrity binding */
  mandate_hash?: string;
}

export interface A2AConfirm {
  type: 'A2A_CONFIRM';
  kem_ciphertext: {
    alg: string;
    ciphertext_b64: string;
  };
  encrypted_confirm: string;
  timestamp: string;
}

export interface A2AEstablished {
  type: 'A2A_ESTABLISHED';
  session_id: string;
  encrypted_ack: string;
  timestamp: string;
}

export interface A2AClose {
  type: 'A2A_CLOSE';
  session_id: string;
  reason: 'complete' | 'timeout' | 'error' | 'revocation' | 'policy_violation';
  final_sequence: number;
  audit_summary_hash: string;
  timestamp: string;
}

export interface A2AResume {
  type: 'A2A_RESUME';
  session_id: string;
  last_seen_sequence: number;
  resume_proof: string;
}

export function generateNonce(): string {
  return randomBytes(32).toString('hex');
}

export function createHello(
  initiatorBundle: Record<string, unknown>,
  kemPublicKeyB64: string,
  requestedCapabilities: string[],
  securityTier: string,
): A2AHello {
  return {
    type: 'A2A_HELLO',
    protocol_version: '2.0',
    initiator_bundle: initiatorBundle,
    ephemeral_kem_public_key: {
      alg: 'x25519-ml-kem-768',
      public_key_b64: kemPublicKeyB64,
    },
    nonce: generateNonce(),
    supported_algorithms: {
      signing: ['ed25519', 'ml-dsa-65'],
      kem: ['x25519-ml-kem-768'],
      cipher: ['aes-256-gcm'],
    },
    requested_capabilities: requestedCapabilities,
    security_tier: securityTier,
    timestamp: new Date().toISOString(),
  };
}

export function createWelcome(
  responderBundle: Record<string, unknown>,
  kemPublicKeyB64: string,
  kemCiphertextB64: string,
  resolvedTier: string,
): A2AWelcome {
  return {
    type: 'A2A_WELCOME',
    protocol_version: '2.0',
    responder_bundle: responderBundle,
    ephemeral_kem_public_key: {
      alg: 'x25519-ml-kem-768',
      public_key_b64: kemPublicKeyB64,
    },
    nonce: generateNonce(),
    kem_ciphertext: {
      alg: 'x25519-ml-kem-768',
      ciphertext_b64: kemCiphertextB64,
    },
    selected_algorithms: {
      signing: 'ed25519',
      kem: 'x25519-ml-kem-768',
      cipher: 'aes-256-gcm',
    },
    resolved_security_tier: resolvedTier,
    timestamp: new Date().toISOString(),
  };
}

export function deriveSessionId(
  agentIdA: string,
  agentIdB: string,
  nonceA: string,
  nonceB: string,
  sessionKey: Uint8Array,
): string {
  const sep = Buffer.from([0x00]);
  const input = Buffer.concat([
    Buffer.from('DCP-AI.v2.A2A.Session'),
    sep,
    Buffer.from(agentIdA),
    sep,
    Buffer.from(agentIdB),
    sep,
    Buffer.from(nonceA, 'hex'),
    Buffer.from(nonceB, 'hex'),
    Buffer.from(sessionKey),
  ]);
  return createHash('sha256').update(input).digest('hex').slice(0, 64);
}

export function createCloseMessage(
  sessionId: string,
  reason: A2AClose['reason'],
  finalSequence: number,
  auditSummaryHash: string,
): A2AClose {
  return {
    type: 'A2A_CLOSE',
    session_id: sessionId,
    reason,
    final_sequence: finalSequence,
    audit_summary_hash: auditSummaryHash,
    timestamp: new Date().toISOString(),
  };
}
