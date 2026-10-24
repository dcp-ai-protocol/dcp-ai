/**
 * Ed25519 S range (RFC 8032 §5.1.7): a signature with S >= L is invalid, even when the group
 * equation holds, as it does for S + k·L (§8.4, malleability). TweetNaCl does not check the range.
 *
 * The provider takes raw bytes and a base64 key, so it gets the RFC 8032 §7.1 vectors as they
 * are; verifyObject signs canonical JSON, so it gets objects signed with the same RFC keys.
 * Inputs TweetNaCl itself rejects (types, sizes, base64) must keep its exact errors.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import nacl from 'tweetnacl';

import { Ed25519Provider } from '../providers/ed25519.js';
import { MlDsa65Provider } from '../providers/ml-dsa-65.js';
import { signObject, verifyObject } from '../core/crypto.js';
import { verifySignedBundle } from '../core/verify.js';
import { AlgorithmRegistry } from '../core/crypto-registry.js';
import { compositeSign, compositeVerify, classicalOnlySign } from '../core/composite-ops.js';
import type { CompositeKeyPair } from '../core/composite-ops.js';
import type { SignedBundle } from '../types/index.js';

const ROOT = resolve(__dirname, '../../../..');
const kat: { name: string; secret_key_hex: string; public_key_hex: string; message_hex: string; signature_hex: string }[] =
  JSON.parse(readFileSync(resolve(ROOT, 'tests/nist-kat/ed25519/vectors.json'), 'utf8')).test_vectors;
const golden = JSON.parse(readFileSync(resolve(ROOT, 'tests/conformance/v2/golden_vectors.json'), 'utf8'));
const signedBundlePath = resolve(ROOT, 'tests/conformance/examples/citizenship_bundle.signed.json');

const L = 2n ** 252n + 27742317777372353535851937790883648493n;
const hex = (h: string) => new Uint8Array(Buffer.from(h, 'hex'));
const b64 = (u: Uint8Array) => Buffer.from(u).toString('base64');
const scalarOf = (sig: Uint8Array) => BigInt('0x' + Buffer.from(sig.subarray(32)).reverse().toString('hex'));
const withScalar = (sig: Uint8Array, s: bigint) =>
  new Uint8Array([...sig.subarray(0, 32), ...Buffer.from(s.toString(16).padStart(64, '0'), 'hex').reverse()]);
/** k = 1, 2 and the largest k for which S + k·L still fits in 32 bytes. */
const ks = (sig: Uint8Array) => [...new Set([1n, 2n, (2n ** 256n - 1n - scalarOf(sig)) / L])];

const ed = new Ed25519Provider();

// A = the identity (accepted today: weak keys are E4), so [S]B = R for any message.
const IDENTITY = hex('01' + '00'.repeat(31));
const MINUS_B = hex('58' + '66'.repeat(30) + 'e6');

describe('provider: RFC 8032 vectors as raw bytes', () => {
  for (const t of kat) {
    const sig = hex(t.signature_hex);
    const pk = b64(hex(t.public_key_hex));
    const msg = hex(t.message_hex);

    it(`${t.name}: accepted`, async () => {
      expect(await ed.verify(msg, sig, pk)).toBe(true);
    });

    it(`${t.name}: S = L rejected`, async () => {
      expect(await ed.verify(msg, withScalar(sig, L), pk)).toBe(false);
    });

    for (const k of ks(sig)) {
      it(`${t.name}: S + ${k}·L rejected`, async () => {
        expect(await ed.verify(msg, withScalar(sig, scalarOf(sig) + k * L), pk)).toBe(false);
      });
    }
  }
});

describe('provider: the bound is S < L, compared on every byte', () => {
  const msg = new TextEncoder().encode('dcp-ed25519-review/s-range-boundary');
  const pk = b64(IDENTITY);

  it('S = L - 1 (same top byte as L) with R = -B: accepted', async () => {
    expect(await ed.verify(msg, withScalar(new Uint8Array([...MINUS_B, ...new Uint8Array(32)]), L - 1n), pk)).toBe(true);
  });

  it('S = 0 with R = identity: accepted', async () => {
    expect(await ed.verify(msg, new Uint8Array([...IDENTITY, ...new Uint8Array(32)]), pk)).toBe(true);
  });

  for (const k of [1n, 2n, 15n]) {
    it(`S = ${k}·L with R = identity, where the equation holds: rejected`, async () => {
      expect(await ed.verify(msg, withScalar(new Uint8Array([...IDENTITY, ...new Uint8Array(32)]), k * L), pk)).toBe(false);
    });
  }
});

describe('provider: what TweetNaCl rejects keeps its error', () => {
  const t = kat[0];
  const msg = hex(t.message_hex);
  const sPlusL = withScalar(hex(t.signature_hex), scalarOf(hex(t.signature_hex)) + L);
  const pk = hex(t.public_key_hex);

  for (const n of [31, 33]) {
    it(`a ${n}-byte key with an S + L signature: bad public key size`, async () => {
      const key = b64(n < 32 ? pk.subarray(0, n) : new Uint8Array([...pk, 0]));
      await expect(ed.verify(msg, sPlusL, key)).rejects.toThrow('bad public key size');
    });
  }

  for (const n of [63, 65]) {
    const sig = n < 64 ? sPlusL.subarray(0, n) : new Uint8Array([...sPlusL, 0]);
    it(`a ${n}-byte S + L signature with the right key: bad signature size`, async () => {
      await expect(ed.verify(msg, sig, b64(pk))).rejects.toThrow('bad signature size');
    });
    it(`a ${n}-byte S + L signature with a wrong 32-byte key: bad signature size`, async () => {
      await expect(ed.verify(msg, sig, b64(new Uint8Array(32)))).rejects.toThrow('bad signature size');
    });
    it(`a ${n}-byte S + L signature with a 31-byte key: bad signature size (checked first)`, async () => {
      await expect(ed.verify(msg, sig, b64(pk.subarray(0, 31)))).rejects.toThrow('bad signature size');
    });
  }

  it('an invalid base64 key with an S + L signature: invalid encoding', async () => {
    await expect(ed.verify(msg, sPlusL, '!' + b64(pk))).rejects.toThrow('invalid encoding');
  });

  it('a message that is not a Uint8Array: TypeError', async () => {
    await expect(ed.verify([] as unknown as Uint8Array, sPlusL, b64(pk))).rejects.toThrow(
      new TypeError('unexpected type, use Uint8Array'),
    );
  });

  it('a signature that is not a Uint8Array: TypeError', async () => {
    await expect(ed.verify(msg, Array.from(sPlusL) as unknown as Uint8Array, b64(pk))).rejects.toThrow(
      new TypeError('unexpected type, use Uint8Array'),
    );
  });

  it('a Buffer is a Uint8Array for TweetNaCl, so an S + L Buffer is rejected', async () => {
    expect(await ed.verify(msg, Buffer.from(sPlusL), b64(pk))).toBe(false);
  });
});

describe('provider: decoding and weak keys are unchanged (E3, E4)', () => {
  const cases: [string, string, string, string, boolean][] = [
    // [case, public key, signature, message, verdict today]
    ['public key not on the curve', '02' + '00'.repeat(31), kat[0].signature_hex, '', false],
    ['identity public key with y = p + 1', 'ee' + 'ff'.repeat(30) + '7f', '01' + '00'.repeat(63),
      Buffer.from('dcp-ed25519-review/a-not-reduced').toString('hex'), true],
    ['identity public key with the x sign bit set', '01' + '00'.repeat(30) + '80', '01' + '00'.repeat(63),
      Buffer.from('dcp-ed25519-review/a-sign-bit').toString('hex'), true],
    ['identity R with y = p + 1', '01' + '00'.repeat(31), 'ee' + 'ff'.repeat(30) + '7f' + '00'.repeat(32),
      Buffer.from('dcp-ed25519-review/r-not-reduced').toString('hex'), false],
  ];
  for (const [name, pk, sig, msg, verdict] of cases) {
    it(`${name}: ${verdict ? 'accepted' : 'rejected'}, as today`, async () => {
      expect(await ed.verify(hex(msg), hex(sig), b64(hex(pk)))).toBe(verdict);
    });
  }
});

describe('verifyObject V1: objects signed with the RFC 8032 keys', () => {
  for (const [i, t] of kat.entries()) {
    const kp = nacl.sign.keyPair.fromSeed(hex(t.secret_key_hex));
    const pk = b64(kp.publicKey);
    const obj = { probe: 'dcp-ed25519-review/s-range', vector: t.name, n: i };
    const sig = new Uint8Array(Buffer.from(signObject(obj, b64(kp.secretKey)), 'base64'));

    it(`${t.name}: accepted`, () => {
      expect(verifyObject(obj, b64(sig), pk)).toBe(true);
    });

    it(`${t.name}: S = L rejected`, () => {
      expect(verifyObject(obj, b64(withScalar(sig, L)), pk)).toBe(false);
    });

    for (const k of ks(sig)) {
      it(`${t.name}: S + ${k}·L rejected`, () => {
        expect(verifyObject(obj, b64(withScalar(sig, scalarOf(sig) + k * L)), pk)).toBe(false);
      });
    }

    if (i > 0) continue;
    const sPlusL = withScalar(sig, scalarOf(sig) + L);
    for (const n of [31, 33]) {
      it(`a ${n}-byte key with an S + L signature: bad public key size`, () => {
        const key = n < 32 ? kp.publicKey.subarray(0, n) : new Uint8Array([...kp.publicKey, 0]);
        expect(() => verifyObject(obj, b64(sPlusL), b64(key))).toThrow('bad public key size');
      });
    }
    for (const n of [63, 65]) {
      it(`a ${n}-byte S + L signature: bad signature size`, () => {
        const short = n < 64 ? sPlusL.subarray(0, n) : new Uint8Array([...sPlusL, 0]);
        expect(() => verifyObject(obj, b64(short), pk)).toThrow('bad signature size');
        expect(() => verifyObject(obj, b64(short), b64(new Uint8Array(31)))).toThrow('bad signature size');
      });
    }
    it('invalid base64 in the S + L signature or in the key: invalid encoding', () => {
      expect(() => verifyObject(obj, b64(sPlusL) + '!', pk)).toThrow('invalid encoding');
      expect(() => verifyObject(obj, b64(sPlusL), pk + '!')).toThrow('invalid encoding');
    });
  }
});

describe('verifySignedBundle V1: conformance example', () => {
  const load = (): SignedBundle => JSON.parse(readFileSync(signedBundlePath, 'utf8'));
  const key = golden.v1_bundle_verification.public_key_b64;
  const sPlusL = (sb: SignedBundle) => {
    const sig = new Uint8Array(Buffer.from(sb.signature.sig_b64, 'base64'));
    sb.signature.sig_b64 = b64(withScalar(sig, scalarOf(sig) + L));
    return sb;
  };

  it('the example verifies with the golden key and with its embedded key', () => {
    expect(verifySignedBundle(load(), key)).toEqual({ verified: true });
    expect(verifySignedBundle(load()).verified).toBe(true);
  });

  it('its signature with S + L: SIGNATURE INVALID, with either key', () => {
    expect(verifySignedBundle(sPlusL(load()), key)).toEqual({ verified: false, errors: ['SIGNATURE INVALID'] });
    expect(verifySignedBundle(sPlusL(load()))).toEqual({ verified: false, errors: ['SIGNATURE INVALID'] });
  });
});

describe('composite signatures with a classical S + L', () => {
  const registry = new AlgorithmRegistry();
  let keys: CompositeKeyPair;
  const payload = new TextEncoder().encode('{"probe":"dcp-ed25519-review/s-range"}');
  const malleate = <T extends { classical: { sig_b64: string } }>(cs: T): T => {
    const sig = new Uint8Array(Buffer.from(cs.classical.sig_b64, 'base64'));
    return { ...cs, classical: { ...cs.classical, sig_b64: b64(withScalar(sig, scalarOf(sig) + L)) } };
  };

  beforeAll(async () => {
    const pq = new MlDsa65Provider();
    registry.registerSigner(ed);
    registry.registerSigner(pq);
    const c = await ed.generateKeypair();
    const p = await pq.generateKeypair();
    keys = {
      classical: { kid: c.kid, alg: 'ed25519', secretKeyB64: c.secretKeyB64, publicKeyB64: c.publicKeyB64 },
      pq: { kid: p.kid, alg: 'ml-dsa-65', secretKeyB64: p.secretKeyB64, publicKeyB64: p.publicKeyB64 },
    };
  });

  it('pq_over_classical: the original verifies; with S + L neither component nor the whole does', async () => {
    const cs = await compositeSign(registry, 'DCP-AI.v2.Intent', payload, keys);
    const pkC = keys.classical.publicKeyB64;
    const pkP = keys.pq.publicKeyB64;
    expect((await compositeVerify(registry, 'DCP-AI.v2.Intent', payload, cs, pkC, pkP)).valid).toBe(true);
    const r = await compositeVerify(registry, 'DCP-AI.v2.Intent', payload, malleate(cs), pkC, pkP);
    expect(r).toMatchObject({ valid: false, classical_valid: false, pq_valid: false });
  });

  it('classical_only: the original verifies; with S + L it does not', async () => {
    const cs = await classicalOnlySign(registry, 'DCP-AI.v2.Intent', payload, keys.classical);
    const pkC = keys.classical.publicKeyB64;
    expect((await compositeVerify(registry, 'DCP-AI.v2.Intent', payload, cs, pkC)).valid).toBe(true);
    expect((await compositeVerify(registry, 'DCP-AI.v2.Intent', payload, malleate(cs), pkC)).valid).toBe(false);
  });
});
