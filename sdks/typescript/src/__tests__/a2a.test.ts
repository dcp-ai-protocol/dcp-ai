import { describe, it, expect } from 'vitest';
import { randomBytes } from 'crypto';

import {
  createAgentDirectory,
  findAgentByCapability,
  findAgentById,
  validateDirectoryEntry,
  type AgentDirectoryEntry,
  type AgentDirectory,
} from '../a2a/discovery.js';

import {
  generateNonce,
  createHello,
  createWelcome,
  deriveSessionId,
  createCloseMessage,
  type A2AHello,
  type A2AWelcome,
  type A2AClose,
} from '../a2a/handshake.js';

import {
  createSession,
  encryptMessage,
  decryptMessage,
  needsRekeying,
  generateResumeProof,
  verifyResumeProof,
  deriveRekeyedSessionKey,
  type A2ASession,
  type EncryptedMessage,
} from '../a2a/session.js';

function makeEntry(overrides: Partial<AgentDirectoryEntry> = {}): AgentDirectoryEntry {
  return {
    agent_id: 'agent-001',
    agent_name: 'Test Agent',
    capabilities: ['data-analysis', 'text-generation'],
    bundle_endpoint: 'https://example.com/bundle',
    a2a_endpoint: 'wss://example.com/a2a',
    a2a_transports: ['websocket'],
    security_tier_minimum: 'standard',
    supported_algorithms: {
      signing: ['ed25519'],
      kem: ['x25519-ml-kem-768'],
    },
    status: 'active',
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function makeSessionKey(): Uint8Array {
  return new Uint8Array(randomBytes(32));
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

describe('Agent Discovery', () => {
  describe('createAgentDirectory', () => {
    it('creates a directory with version 2.0', () => {
      const dir = createAgentDirectory('Acme Corp', []);
      expect(dir.dcp_version).toBe('2.0');
      expect(dir.organization).toBe('Acme Corp');
      expect(dir.agents).toEqual([]);
    });

    it('includes provided agents', () => {
      const entry = makeEntry();
      const dir = createAgentDirectory('Org', [entry]);
      expect(dir.agents).toHaveLength(1);
      expect(dir.agents[0].agent_id).toBe('agent-001');
    });
  });

  describe('findAgentByCapability', () => {
    it('finds an agent matching all required capabilities', () => {
      const dir = createAgentDirectory('Org', [
        makeEntry({ agent_id: 'a1', capabilities: ['cap-a'] }),
        makeEntry({ agent_id: 'a2', capabilities: ['cap-a', 'cap-b', 'cap-c'] }),
      ]);
      const result = findAgentByCapability(dir, ['cap-a', 'cap-b']);
      expect(result).not.toBeNull();
      expect(result!.agent_id).toBe('a2');
    });

    it('returns null when no agent matches', () => {
      const dir = createAgentDirectory('Org', [
        makeEntry({ capabilities: ['cap-a'] }),
      ]);
      expect(findAgentByCapability(dir, ['cap-z'])).toBeNull();
    });

    it('skips suspended agents', () => {
      const dir = createAgentDirectory('Org', [
        makeEntry({ agent_id: 'suspended', capabilities: ['cap-a'], status: 'suspended' }),
      ]);
      expect(findAgentByCapability(dir, ['cap-a'])).toBeNull();
    });

    it('skips revoked agents', () => {
      const dir = createAgentDirectory('Org', [
        makeEntry({ agent_id: 'revoked', capabilities: ['cap-a'], status: 'revoked' }),
      ]);
      expect(findAgentByCapability(dir, ['cap-a'])).toBeNull();
    });
  });

  describe('findAgentById', () => {
    it('finds an active agent by ID', () => {
      const dir = createAgentDirectory('Org', [
        makeEntry({ agent_id: 'target' }),
      ]);
      const found = findAgentById(dir, 'target');
      expect(found).not.toBeNull();
      expect(found!.agent_id).toBe('target');
    });

    it('returns null for non-existent ID', () => {
      const dir = createAgentDirectory('Org', [makeEntry()]);
      expect(findAgentById(dir, 'does-not-exist')).toBeNull();
    });

    it('returns null for suspended agent', () => {
      const dir = createAgentDirectory('Org', [
        makeEntry({ agent_id: 'x', status: 'suspended' }),
      ]);
      expect(findAgentById(dir, 'x')).toBeNull();
    });
  });

  describe('validateDirectoryEntry', () => {
    it('returns no errors for a valid entry', () => {
      expect(validateDirectoryEntry(makeEntry())).toEqual([]);
    });

    it('reports missing agent_id', () => {
      const errors = validateDirectoryEntry(makeEntry({ agent_id: '' }));
      expect(errors).toContain('Missing agent_id');
    });

    it('reports missing agent_name', () => {
      const errors = validateDirectoryEntry(makeEntry({ agent_name: '' }));
      expect(errors).toContain('Missing agent_name');
    });

    it('reports empty capabilities', () => {
      const errors = validateDirectoryEntry(makeEntry({ capabilities: [] }));
      expect(errors).toContain('capabilities must be non-empty array');
    });

    it('reports missing endpoints', () => {
      const errors = validateDirectoryEntry(
        makeEntry({ bundle_endpoint: '', a2a_endpoint: '' }),
      );
      expect(errors).toContain('Missing bundle_endpoint');
      expect(errors).toContain('Missing a2a_endpoint');
    });

    it('reports invalid status', () => {
      const errors = validateDirectoryEntry(
        makeEntry({ status: 'unknown' as AgentDirectoryEntry['status'] }),
      );
      expect(errors).toContain('Invalid status');
    });
  });
});

// ---------------------------------------------------------------------------
// Handshake
// ---------------------------------------------------------------------------

describe('A2A Handshake', () => {
  describe('generateNonce', () => {
    it('produces a 64-char hex string (32 bytes)', () => {
      const nonce = generateNonce();
      expect(nonce).toHaveLength(64);
      expect(/^[0-9a-f]{64}$/.test(nonce)).toBe(true);
    });

    it('produces unique nonces', () => {
      const a = generateNonce();
      const b = generateNonce();
      expect(a).not.toBe(b);
    });
  });

  describe('createHello', () => {
    it('creates a well-formed A2A_HELLO message', () => {
      const hello = createHello(
        { agent_id: 'initiator' },
        'cHVibGljLWtleQ==',
        ['data-analysis'],
        'elevated',
      );
      expect(hello.type).toBe('A2A_HELLO');
      expect(hello.protocol_version).toBe('2.0');
      expect(hello.initiator_bundle).toEqual({ agent_id: 'initiator' });
      expect(hello.ephemeral_kem_public_key.alg).toBe('x25519-ml-kem-768');
      expect(hello.ephemeral_kem_public_key.public_key_b64).toBe('cHVibGljLWtleQ==');
      expect(hello.nonce).toHaveLength(64);
      expect(hello.supported_algorithms.signing).toContain('ed25519');
      expect(hello.supported_algorithms.kem).toContain('x25519-ml-kem-768');
      expect(hello.supported_algorithms.cipher).toContain('aes-256-gcm');
      expect(hello.requested_capabilities).toEqual(['data-analysis']);
      expect(hello.security_tier).toBe('elevated');
      expect(hello.timestamp).toBeTruthy();
    });
  });

  describe('createWelcome', () => {
    it('creates a well-formed A2A_WELCOME message', () => {
      const welcome = createWelcome(
        { agent_id: 'responder' },
        'cmVzcG9uZGVyLXB1YmxpYy1rZXk=',
        'Y2lwaGVydGV4dA==',
        'elevated',
      );
      expect(welcome.type).toBe('A2A_WELCOME');
      expect(welcome.protocol_version).toBe('2.0');
      expect(welcome.responder_bundle).toEqual({ agent_id: 'responder' });
      expect(welcome.kem_ciphertext.ciphertext_b64).toBe('Y2lwaGVydGV4dA==');
      expect(welcome.selected_algorithms.signing).toBe('ed25519');
      expect(welcome.resolved_security_tier).toBe('elevated');
    });
  });

  describe('deriveSessionId', () => {
    it('returns a 64-char hex string', () => {
      const key = makeSessionKey();
      const nonceA = generateNonce();
      const nonceB = generateNonce();
      const sid = deriveSessionId('agent-a', 'agent-b', nonceA, nonceB, key);
      expect(sid).toHaveLength(64);
      expect(/^[0-9a-f]{64}$/.test(sid)).toBe(true);
    });

    it('is deterministic for same inputs', () => {
      const key = makeSessionKey();
      const nonceA = generateNonce();
      const nonceB = generateNonce();
      const sid1 = deriveSessionId('a', 'b', nonceA, nonceB, key);
      const sid2 = deriveSessionId('a', 'b', nonceA, nonceB, key);
      expect(sid1).toBe(sid2);
    });

    it('differs when any input changes', () => {
      const key = makeSessionKey();
      const nonceA = generateNonce();
      const nonceB = generateNonce();
      const sid1 = deriveSessionId('a', 'b', nonceA, nonceB, key);
      const sid2 = deriveSessionId('b', 'a', nonceA, nonceB, key);
      expect(sid1).not.toBe(sid2);
    });
  });

  describe('createCloseMessage', () => {
    it('creates a well-formed A2A_CLOSE', () => {
      const close = createCloseMessage('session-123', 'complete', 42, 'abc123');
      expect(close.type).toBe('A2A_CLOSE');
      expect(close.session_id).toBe('session-123');
      expect(close.reason).toBe('complete');
      expect(close.final_sequence).toBe(42);
      expect(close.audit_summary_hash).toBe('abc123');
      expect(close.timestamp).toBeTruthy();
    });

    it('supports all close reasons', () => {
      const reasons = ['complete', 'timeout', 'error', 'revocation', 'policy_violation'] as const;
      for (const reason of reasons) {
        const msg = createCloseMessage('s', reason, 0, '');
        expect(msg.reason).toBe(reason);
      }
    });
  });
});

// ---------------------------------------------------------------------------
// Session Management
// ---------------------------------------------------------------------------

describe('A2A Session', () => {
  const sessionKey = makeSessionKey();
  const sessionId = 'test-session-id';

  function makePair() {
    const key = makeSessionKey();
    const sender = createSession(sessionId, key, 'alice', 'bob', 'standard');
    const receiver = createSession(sessionId, key, 'bob', 'alice', 'standard');
    return { sender, receiver, key };
  }

  describe('createSession', () => {
    it('initialises counters to zero', () => {
      const s = createSession(sessionId, sessionKey, 'a', 'b', 'standard');
      expect(s.message_counter_send).toBe(0);
      expect(s.message_counter_recv).toBe(0);
    });

    it('sets status to active', () => {
      const s = createSession(sessionId, sessionKey, 'a', 'b', 'standard');
      expect(s.status).toBe('active');
    });

    it('uses default rekeying interval of 1000', () => {
      const s = createSession(sessionId, sessionKey, 'a', 'b', 'standard');
      expect(s.rekeying_interval).toBe(1000);
    });

    it('accepts custom rekeying interval', () => {
      const s = createSession(sessionId, sessionKey, 'a', 'b', 'standard', 500);
      expect(s.rekeying_interval).toBe(500);
    });
  });

  describe('encrypt / decrypt round-trip', () => {
    it('encrypts and decrypts a payload correctly', () => {
      const { sender, receiver } = makePair();
      const payload = { action: 'greet', data: { text: 'hello' } };
      const encrypted = encryptMessage(sender, payload);
      expect(encrypted.type).toBe('A2A_MESSAGE');
      expect(encrypted.sequence).toBe(0);
      expect(encrypted.sender_agent_id).toBe('alice');

      const decrypted = decryptMessage(receiver, encrypted);
      expect(decrypted).toEqual(payload);
    });

    it('increments sequence numbers', () => {
      const { sender, receiver } = makePair();
      const m1 = encryptMessage(sender, { seq: 1 });
      const m2 = encryptMessage(sender, { seq: 2 });
      expect(m1.sequence).toBe(0);
      expect(m2.sequence).toBe(1);
      expect(sender.message_counter_send).toBe(2);

      decryptMessage(receiver, m1);
      expect(receiver.message_counter_recv).toBe(1);
      decryptMessage(receiver, m2);
      expect(receiver.message_counter_recv).toBe(2);
    });

    it('handles multiple distinct payloads', () => {
      const { sender, receiver } = makePair();
      const payloads = [
        { type: 'request', id: 1 },
        { type: 'response', id: 2 },
        { type: 'ack', id: 3 },
      ];
      const encrypted = payloads.map(p => encryptMessage(sender, p));
      encrypted.forEach((msg, i) => {
        const decrypted = decryptMessage(receiver, msg);
        expect(decrypted).toEqual(payloads[i]);
      });
    });

    it('updates last_activity on send and receive', () => {
      const { sender, receiver } = makePair();
      const beforeSend = sender.last_activity;
      const msg = encryptMessage(sender, { x: 1 });
      expect(sender.last_activity).toBeTruthy();

      const beforeRecv = receiver.last_activity;
      decryptMessage(receiver, msg);
      expect(receiver.last_activity).toBe(msg.timestamp);
    });
  });

  describe('error cases', () => {
    it('throws on session ID mismatch', () => {
      const { sender } = makePair();
      const other = createSession('different-session', makeSessionKey(), 'bob', 'alice', 'standard');
      const msg = encryptMessage(sender, { x: 1 });
      expect(() => decryptMessage(other, msg)).toThrow('Session ID mismatch');
    });

    it('throws on unexpected sender', () => {
      const key = makeSessionKey();
      const sender = createSession(sessionId, key, 'alice', 'bob', 'standard');
      const wrongReceiver = createSession(sessionId, key, 'charlie', 'dave', 'standard');
      const msg = encryptMessage(sender, { x: 1 });
      expect(() => decryptMessage(wrongReceiver, msg)).toThrow('Unexpected sender');
    });

    it('throws when sending on a closed session', () => {
      const { sender } = makePair();
      sender.status = 'closed';
      expect(() => encryptMessage(sender, { x: 1 })).toThrow('Cannot send on closed session');
    });

    it('throws when sending on a rekeying session', () => {
      const { sender } = makePair();
      sender.status = 'rekeying';
      expect(() => encryptMessage(sender, { x: 1 })).toThrow('Cannot send on rekeying session');
    });

    it('rejects tampered ciphertext', () => {
      const { sender, receiver } = makePair();
      const msg = encryptMessage(sender, { secret: 'data' });
      const tampered = { ...msg, encrypted_payload: Buffer.from('tampered').toString('base64') };
      expect(() => decryptMessage(receiver, tampered)).toThrow();
    });

    it('rejects tampered IV', () => {
      const { sender, receiver } = makePair();
      const msg = encryptMessage(sender, { x: 1 });
      const tampered = { ...msg, iv: randomBytes(12).toString('base64') };
      expect(() => decryptMessage(receiver, tampered)).toThrow();
    });

    it('rejects tampered auth tag', () => {
      const { sender, receiver } = makePair();
      const msg = encryptMessage(sender, { x: 1 });
      const tampered = { ...msg, tag: randomBytes(16).toString('base64') };
      expect(() => decryptMessage(receiver, tampered)).toThrow();
    });
  });

  describe('needsRekeying', () => {
    it('returns false below rekeying interval', () => {
      const s = createSession(sessionId, sessionKey, 'a', 'b', 'standard', 100);
      s.message_counter_send = 99;
      expect(needsRekeying(s)).toBe(false);
    });

    it('returns true at rekeying interval', () => {
      const s = createSession(sessionId, sessionKey, 'a', 'b', 'standard', 100);
      s.message_counter_send = 100;
      expect(needsRekeying(s)).toBe(true);
    });

    it('returns true above rekeying interval', () => {
      const s = createSession(sessionId, sessionKey, 'a', 'b', 'standard', 100);
      s.message_counter_send = 150;
      expect(needsRekeying(s)).toBe(true);
    });
  });

  describe('resume proof', () => {
    it('generates and verifies a valid proof', () => {
      const s = createSession(sessionId, sessionKey, 'a', 'b', 'standard');
      const proof = generateResumeProof(s, 42);
      expect(typeof proof).toBe('string');
      expect(proof.length).toBeGreaterThan(0);
      expect(verifyResumeProof(s, 42, proof)).toBe(true);
    });

    it('rejects proof for wrong sequence', () => {
      const s = createSession(sessionId, sessionKey, 'a', 'b', 'standard');
      const proof = generateResumeProof(s, 42);
      expect(verifyResumeProof(s, 43, proof)).toBe(false);
    });

    it('rejects forged proof', () => {
      const s = createSession(sessionId, sessionKey, 'a', 'b', 'standard');
      expect(verifyResumeProof(s, 42, 'forged-proof')).toBe(false);
    });

    it('different sessions produce different proofs', () => {
      const s1 = createSession(sessionId, makeSessionKey(), 'a', 'b', 'standard');
      const s2 = createSession(sessionId, makeSessionKey(), 'a', 'b', 'standard');
      const p1 = generateResumeProof(s1, 10);
      const p2 = generateResumeProof(s2, 10);
      expect(p1).not.toBe(p2);
    });
  });

  describe('deriveRekeyedSessionKey', () => {
    it('produces a 32-byte key', () => {
      const oldKey = makeSessionKey();
      const newSecret = new Uint8Array(randomBytes(32));
      const derived = deriveRekeyedSessionKey(oldKey, newSecret, sessionId);
      expect(derived).toBeInstanceOf(Uint8Array);
      expect(derived.length).toBe(32);
    });

    it('is deterministic', () => {
      const oldKey = makeSessionKey();
      const newSecret = new Uint8Array(randomBytes(32));
      const a = deriveRekeyedSessionKey(oldKey, newSecret, sessionId);
      const b = deriveRekeyedSessionKey(oldKey, newSecret, sessionId);
      expect(Buffer.from(a).toString('hex')).toBe(Buffer.from(b).toString('hex'));
    });

    it('differs with different old keys', () => {
      const newSecret = new Uint8Array(randomBytes(32));
      const a = deriveRekeyedSessionKey(makeSessionKey(), newSecret, sessionId);
      const b = deriveRekeyedSessionKey(makeSessionKey(), newSecret, sessionId);
      expect(Buffer.from(a).toString('hex')).not.toBe(Buffer.from(b).toString('hex'));
    });

    it('differs with different shared secrets', () => {
      const oldKey = makeSessionKey();
      const a = deriveRekeyedSessionKey(oldKey, new Uint8Array(randomBytes(32)), sessionId);
      const b = deriveRekeyedSessionKey(oldKey, new Uint8Array(randomBytes(32)), sessionId);
      expect(Buffer.from(a).toString('hex')).not.toBe(Buffer.from(b).toString('hex'));
    });

    it('rekeyed key works for encrypt/decrypt', () => {
      const { sender, receiver, key } = makePair();
      const newSecret = new Uint8Array(randomBytes(32));
      const newKey = deriveRekeyedSessionKey(key, newSecret, sessionId);

      const newSender = createSession(sessionId, newKey, 'alice', 'bob', 'standard');
      const newReceiver = createSession(sessionId, newKey, 'bob', 'alice', 'standard');

      const payload = { rekeyed: true };
      const msg = encryptMessage(newSender, payload);
      const decrypted = decryptMessage(newReceiver, msg);
      expect(decrypted).toEqual(payload);
    });
  });
});
