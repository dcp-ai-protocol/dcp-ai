import { createHash, randomBytes, createCipheriv, createDecipheriv, createHmac, timingSafeEqual } from 'crypto';

/** How far behind the highest received sequence a message may still arrive (out of order). */
const RECEIVE_WINDOW = 1000;

export interface A2ASession {
  session_id: string;
  session_key: Uint8Array;
  agent_id_local: string;
  agent_id_remote: string;
  message_counter_send: number;
  message_counter_recv: number;
  created_at: string;
  last_activity: string;
  security_tier: string;
  rekeying_interval: number;
  status: 'active' | 'rekeying' | 'closed';
  /**
   * Sequences accepted within the receive window, so each one is accepted once. A session
   * without it (built before this field existed, or restored without it) counts every sequence
   * of the window below message_counter_recv as already received.
   */
  received_sequences?: number[];
}

export interface EncryptedMessage {
  session_id: string;
  sequence: number;
  type: 'A2A_MESSAGE';
  encrypted_payload: string;
  iv: string;
  tag: string;
  sender_agent_id: string;
  timestamp: string;
}

export function createSession(
  sessionId: string,
  sessionKey: Uint8Array,
  localAgentId: string,
  remoteAgentId: string,
  securityTier: string,
  rekeyingInterval = 1000,
): A2ASession {
  const now = new Date().toISOString();
  return {
    session_id: sessionId,
    session_key: sessionKey,
    agent_id_local: localAgentId,
    agent_id_remote: remoteAgentId,
    message_counter_send: 0,
    message_counter_recv: 0,
    created_at: now,
    last_activity: now,
    security_tier: securityTier,
    rekeying_interval: rekeyingInterval,
    status: 'active',
    received_sequences: [],
  };
}

export function encryptMessage(
  session: A2ASession,
  payload: Record<string, unknown>,
): EncryptedMessage {
  if (session.status !== 'active') {
    throw new Error(`Cannot send on ${session.status} session`);
  }

  const sequence = session.message_counter_send++;
  const timestamp = new Date().toISOString();
  const iv = randomBytes(12);

  const aad = Buffer.concat([
    Buffer.from(session.session_id),
    Buffer.from(String(sequence)),
    Buffer.from(session.agent_id_local),
    Buffer.from(timestamp),
  ]);

  const cipher = createCipheriv('aes-256-gcm', session.session_key, iv, { authTagLength: 16 });
  cipher.setAAD(aad);

  const plaintext = Buffer.from(JSON.stringify(payload), 'utf8');
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  session.last_activity = timestamp;

  return {
    session_id: session.session_id,
    sequence,
    type: 'A2A_MESSAGE',
    encrypted_payload: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    sender_agent_id: session.agent_id_local,
    timestamp,
  };
}

export function decryptMessage(
  session: A2ASession,
  message: EncryptedMessage,
): Record<string, unknown> {
  if (message.session_id !== session.session_id) {
    throw new Error('Session ID mismatch');
  }

  if (message.sender_agent_id !== session.agent_id_remote) {
    throw new Error('Unexpected sender');
  }

  const sequence = message.sequence;
  if (!Number.isSafeInteger(sequence) || sequence < 0) {
    throw new Error('Invalid message sequence');
  }
  const recv = session.message_counter_recv;
  if (sequence < recv - RECEIVE_WINDOW) {
    throw new Error('Message sequence too old (outside window)');
  }
  if (sequence >= recv + RECEIVE_WINDOW) {
    throw new Error('Message sequence too far ahead (outside window)');
  }
  const seen =
    session.received_sequences ??
    Array.from({ length: recv - Math.max(0, recv - RECEIVE_WINDOW) }, (_, i) => Math.max(0, recv - RECEIVE_WINDOW) + i);
  if (seen.includes(sequence)) {
    throw new Error('Message sequence already received');
  }

  const iv = Buffer.from(message.iv, 'base64');
  const tag = Buffer.from(message.tag, 'base64');
  const ciphertext = Buffer.from(message.encrypted_payload, 'base64');

  const aad = Buffer.concat([
    Buffer.from(message.session_id),
    Buffer.from(String(sequence)),
    Buffer.from(message.sender_agent_id),
    Buffer.from(message.timestamp),
  ]);

  const decipher = createDecipheriv('aes-256-gcm', session.session_key, iv, { authTagLength: 16 });
  decipher.setAAD(aad);
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  // Recorded only once the tag verified, so a forged message cannot use up a sequence.
  session.message_counter_recv = Math.max(session.message_counter_recv, sequence + 1);
  const floor = session.message_counter_recv - RECEIVE_WINDOW;
  // ponytail: linear scan over at most RECEIVE_WINDOW numbers; a bitmap if the window grows.
  session.received_sequences = [...seen, sequence].filter((s) => s >= floor);
  session.last_activity = message.timestamp;

  return JSON.parse(decrypted.toString('utf8'));
}

export function needsRekeying(session: A2ASession): boolean {
  return session.message_counter_send >= session.rekeying_interval;
}

export function generateResumeProof(session: A2ASession, lastSeenSequence: number): string {
  const hmac = createHmac('sha256', session.session_key);
  hmac.update(Buffer.from(session.session_id + String(lastSeenSequence)));
  return hmac.digest('hex');
}

export function verifyResumeProof(session: A2ASession, lastSeenSequence: number, proof: string): boolean {
  const expected = Buffer.from(generateResumeProof(session, lastSeenSequence));
  const given = Buffer.from(String(proof));
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export function deriveRekeyedSessionKey(
  oldSessionKey: Uint8Array,
  newSharedSecret: Uint8Array,
  sessionId: string,
): Uint8Array {
  const info = Buffer.from('DCP-AI.v2.A2A.Rekey' + sessionId);
  const hmac = createHmac('sha256', oldSessionKey);
  hmac.update(Buffer.concat([newSharedSecret, info]));
  return new Uint8Array(hmac.digest());
}
