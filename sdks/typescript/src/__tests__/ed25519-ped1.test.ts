/**
 * P-ED-1 (MP-02 F5b): the frozen vectors of tests/interop/v2/ed25519_ped1_vectors.json through the public paths of
 * the TypeScript SDK. Every expectation comes from the corpus, the predicates of an independent review model; none
 * from the SDK. Design: docs/reviews/mp02-ed25519-implementation-design.md v0.2.3, §§ 4–6.
 *
 * - historical (26) and signatures (41): Ed25519Provider.verify, the V2 provider. A length case expects TweetNaCl's
 *   error (§ 4), never false;
 * - encodings (52): the helper, isCanonicalEncoding and isSmallOrderEncoding;
 * - objects (4): verifyObject, the V1 path, after checking that canonicalize gives the corpus bytes;
 * - composite (2): compositeSign over the exact DSM, with a classical test provider that returns the corpus signature
 *   only for those bytes and a real ML-DSA-65 key, then compositeVerify with the real providers.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { createHash } from 'crypto';
import { resolve } from 'path';
import nacl from 'tweetnacl';

import { Ed25519Provider } from '../providers/ed25519.js';
import { MlDsa65Provider } from '../providers/ml-dsa-65.js';
import { canonicalize, verifyObject } from '../core/crypto.js';
import { AlgorithmRegistry } from '../core/crypto-registry.js';
import { compositeSign, compositeVerify } from '../core/composite-ops.js';
import { domainSeparatedMessage } from '../core/domain-separation.js';
import { isCanonicalEncoding, isSmallOrderEncoding, SMALL_ORDER_ENCODINGS_HEX } from '../core/ed25519-point.js';
import { scalarBelowL, verifyDetached } from '../core/ed25519-scalar.js';
import type { CryptoProvider } from '../core/crypto-provider.js';

const ROOT = resolve(__dirname, '../../../..');
const RAW = readFileSync(resolve(ROOT, 'tests/interop/v2/ed25519_ped1_vectors.json'));
const FROZEN = 'f5990f8fcc8709c2c3b52e775c8210f0dcb32219c3e7cd36c527e44f49d1e396';
const V = JSON.parse(RAW.toString('utf8'));

interface Case {
  id: string;
  public_key_hex: string;
  signature_hex: string;
  message_hex: string;
  accept: boolean;
  kind: string;
  failing: string[];
}
const hex = (h: string) => new Uint8Array(Buffer.from(h, 'hex'));
const toHex = (u: Uint8Array) => Buffer.from(u).toString('hex');
const b64 = (u: Uint8Array) => Buffer.from(u).toString('base64');
const L = 2n ** 252n + 27742317777372353535851937790883648493n;
const withScalar = (sig: Uint8Array, s: bigint) =>
  new Uint8Array([...sig.subarray(0, 32), ...Buffer.from(s.toString(16).padStart(64, '0'), 'hex').reverse()]);
const scalarOf = (sig: Uint8Array) => BigInt('0x' + Buffer.from(sig.subarray(32)).reverse().toString('hex'));
const caseNamed = (id: string): Case =>
  [...V.historical, ...V.signatures, ...V.objects.cases, ...V.composite.cases].find((c: Case) => c.id === id);
const ed = new Ed25519Provider();

describe('the frozen corpus', () => {
  it('is f5990f8f…, with its five sections', () => {
    expect(createHash('sha256').update(RAW).digest('hex')).toBe(FROZEN);
    expect([V.historical.length, V.encodings.length, V.signatures.length, V.objects.cases.length,
      V.composite.cases.length]).toEqual([26, 52, 41, 4, 2]);
  });
});

describe('the V2 provider: historical and signatures', () => {
  const cases: Case[] = [...V.historical, ...V.signatures];
  it('runs 67 cases', () => expect(cases.length).toBe(67));
  for (const c of cases) {
    const pk = hex(c.public_key_hex);
    const sig = hex(c.signature_hex);
    const msg = hex(c.message_hex);
    if (c.kind === 'length') {
      // TweetNaCl checks the signature size first, then the key size (§ 4): an error, not a rejection.
      const error = sig.length !== 64 ? 'bad signature size' : 'bad public key size';
      it(`${c.id}: ${error}`, async () => {
        expect(c.accept).toBe(false);
        await expect(ed.verify(msg, sig, b64(pk))).rejects.toThrow(error);
      });
    } else {
      it(`${c.id} (${c.kind}${c.failing.length ? ': ' + c.failing.join(', ') : ''}): ${c.accept}`, async () => {
        expect(await ed.verify(msg, sig, b64(pk))).toBe(c.accept);
      });
    }
  }
});

describe('mixed-order points are accepted: P-ED-1 does not require torsion-free points', () => {
  for (const id of ['signature/public-key-mixed-order-k-multiple-of-8', 'signature/ped1-mixed-a-and-r-cancel-reduced']) {
    it(`${id}: accepted`, async () => {
      const c = caseNamed(id);
      expect(c.accept).toBe(true);
      expect(await ed.verify(hex(c.message_hex), hex(c.signature_hex), b64(hex(c.public_key_hex)))).toBe(true);
    });
  }
});

describe('the helper: the 52 encodings', () => {
  it('its table is the 8 encodings of E[8] of the corpus', () => {
    expect([...SMALL_ORDER_ENCODINGS_HEX]).toEqual(V.constants.small_order_encodings_hex);
  });
  for (const e of V.encodings) {
    // The corpus small_order is about the decoded point; the helper compares bytes after the canonical check, so a
    // non-canonical encoding of a point of E[8] is not in its table.
    const inTable = e.canonical_rule === true && e.small_order === true;
    it(`${e.id}: canonical ${e.canonical_rule}, in the E[8] table ${inTable}`, () => {
      const b = hex(e.encoding_hex);
      expect(isCanonicalEncoding(b)).toBe(e.canonical_rule);
      expect(isSmallOrderEncoding(b)).toBe(inTable);
    });
  }
  it('rejects a length other than 32 bytes', () => {
    for (const n of [0, 31, 33]) {
      expect(isCanonicalEncoding(new Uint8Array(n))).toBe(false);
      expect(isSmallOrderEncoding(new Uint8Array(n))).toBe(false);
    }
  });
});

describe('S < L alone, on every byte (scalarBelowL)', () => {
  const sig = (s: bigint) => withScalar(new Uint8Array(64), s);
  it('S = 0 and S = L - 1 are below L; S = L, L + 1, L + 2^248 and 2^256 - 1 are not', () => {
    expect(scalarBelowL(sig(0n))).toBe(true);
    expect(scalarBelowL(sig(L - 1n))).toBe(true);
    for (const s of [L, L + 1n, L + 2n ** 248n, 2n ** 256n - 1n]) expect(scalarBelowL(sig(s))).toBe(false);
  });
});

describe('the V1 path: verifyObject over the corpus objects', () => {
  it('canonicalize gives the corpus bytes', () => {
    expect(Buffer.from(canonicalize(V.objects.object), 'utf8').toString('hex')).toBe(V.objects.canonical_hex);
  });
  for (const c of V.objects.cases as Case[]) {
    it(`${c.id}: ${c.accept}`, () => {
      expect(c.message_hex).toBe(V.objects.canonical_hex);
      expect(verifyObject(V.objects.object, b64(hex(c.signature_hex)), b64(hex(c.public_key_hex)))).toBe(c.accept);
    });
  }
});

describe('composite: the exact DSM, a real ML-DSA-65 key', () => {
  const context: string = V.composite.context;
  const payload = new TextEncoder().encode(V.composite.payload_canonical);

  it('domainSeparatedMessage gives the corpus DSM', () => {
    expect(toHex(domainSeparatedMessage(context, payload))).toBe(V.composite.dsm_hex);
  });

  for (const c of V.composite.cases as Case[]) {
    it(`${c.id}: valid ${c.accept}, classical ${c.accept}, pq true`, async () => {
      const calls: string[] = [];
      // Returns the corpus signature only for exactly the corpus DSM, so the classical component is over those bytes.
      const fixed: CryptoProvider = {
        alg: 'ed25519', keySize: 32, sigSize: 64, isConstantTime: true,
        generateKeypair: async () => { throw new Error('not used'); },
        sign: async (message: Uint8Array) => {
          calls.push(toHex(message));
          if (toHex(message) !== V.composite.dsm_hex) throw new Error('not the corpus DSM');
          return hex(c.signature_hex);
        },
        verify: async () => { throw new Error('not used'); },
      };
      const mldsa = new MlDsa65Provider();
      const pq = await mldsa.generateKeypair();
      const signing = new AlgorithmRegistry();
      signing.registerSigner(fixed);
      signing.registerSigner(mldsa);
      const cs = await compositeSign(signing, context, payload, {
        classical: { kid: 'ped1-corpus', alg: 'ed25519', secretKeyB64: 'unused', publicKeyB64: b64(hex(c.public_key_hex)) },
        pq: { kid: pq.kid, alg: 'ml-dsa-65', secretKeyB64: pq.secretKeyB64, publicKeyB64: pq.publicKeyB64 },
      });
      expect(calls).toEqual([V.composite.dsm_hex]);
      expect(toHex(new Uint8Array(Buffer.from(cs.classical.sig_b64, 'base64')))).toBe(c.signature_hex);

      const verifying = new AlgorithmRegistry();
      verifying.registerSigner(new Ed25519Provider());
      verifying.registerSigner(mldsa);
      const r = await compositeVerify(verifying, context, payload, cs, b64(hex(c.public_key_hex)), pq.publicKeyB64);
      // The PQ component is real and valid; the corpus says the equation and the byte comparison hold on this DSM,
      // so for the negative the only reason left is P-ED-1.
      expect(r).toEqual({ valid: c.accept, classical_valid: c.accept, pq_valid: true });
    });
  }
});

describe('combined defects: TweetNaCl errors come first, then P-ED-1 is a rejection', () => {
  const weak = caseNamed('signature/a-small-order/order-8-26e8958f-05');
  const nc = caseNamed('signature/a-non-canonical-small-order/y-p');
  const msg = hex(weak.message_hex);
  const sig = hex(weak.signature_hex);
  const pk = hex(weak.public_key_hex);

  it('a small-order A with a 63- or 65-byte signature: bad signature size', async () => {
    await expect(ed.verify(msg, sig.subarray(0, 63), b64(pk))).rejects.toThrow('bad signature size');
    await expect(ed.verify(msg, new Uint8Array([...sig, 0]), b64(pk))).rejects.toThrow('bad signature size');
  });
  it('a small-order A of 33 bytes: bad public key size', async () => {
    await expect(ed.verify(msg, sig, b64(new Uint8Array([...pk, 0])))).rejects.toThrow('bad public key size');
  });
  it('a non-canonical A with a 65-byte signature: bad signature size', async () => {
    const s = hex(nc.signature_hex);
    await expect(ed.verify(hex(nc.message_hex), new Uint8Array([...s, 0]), b64(hex(nc.public_key_hex)))).rejects.toThrow(
      'bad signature size',
    );
  });
  it('a small-order A as invalid base64: invalid encoding', async () => {
    await expect(ed.verify(msg, sig, '!' + b64(pk))).rejects.toThrow('invalid encoding');
  });
  it('a message that is not a Uint8Array, with a small-order A: TypeError', async () => {
    await expect(ed.verify([] as unknown as Uint8Array, sig, b64(pk))).rejects.toThrow(
      new TypeError('unexpected type, use Uint8Array'),
    );
  });
  it('a small-order A and S + L: rejected, without an error', async () => {
    expect(await ed.verify(msg, withScalar(sig, scalarOf(sig) + L), b64(pk))).toBe(false);
  });
  it('a Buffer is a Uint8Array for TweetNaCl: a small-order A as a Buffer is rejected', async () => {
    expect(await ed.verify(Buffer.from(msg), Buffer.from(sig), b64(pk))).toBe(false);
  });
});

describe('the inputs are only read', () => {
  const ids = ['signature/normal-key', 'signature/a-small-order/order-8-26e8958f-05',
    'signature/r-small-order/order-8-26e8958f-05', 'signature/r-non-canonical-small-order/y-p',
    'signature/normal-key-s-plus-l'];
  for (const id of ids) {
    it(`${id}: message, signature and key unchanged by verifyDetached and by the provider`, async () => {
      const c = caseNamed(id);
      const msg = hex(c.message_hex);
      const sig = hex(c.signature_hex);
      const pk = hex(c.public_key_hex);
      expect(verifyDetached(msg, sig, pk)).toBe(c.accept);
      expect(await ed.verify(msg, sig, b64(pk))).toBe(c.accept);
      expect([toHex(msg), toHex(sig), toHex(pk)]).toEqual([c.message_hex, c.signature_hex, c.public_key_hex]);
    });
  }
});

describe('raw TweetNaCl, the baseline: the isolated negatives verify before P-ED-1', () => {
  // Where the corpus says the byte comparison holds, raw TweetNaCl (S < L aside) accepts: P-ED-1 is the only reason.
  const negatives: Case[] = V.signatures.filter((c: Case) => c.kind === 'isolated' && !c.failing.includes('equation'));
  it('covers the 17 isolated negatives (S + L, 8 weak A, 8 weak R)', () => expect(negatives.length).toBe(17));
  for (const c of negatives) {
    it(`${c.id}: raw TweetNaCl true, DCP provider false`, async () => {
      const [msg, sig, pk] = [hex(c.message_hex), hex(c.signature_hex), hex(c.public_key_hex)];
      expect(nacl.sign.detached.verify(msg, sig, pk)).toBe(true);
      expect(await ed.verify(msg, sig, b64(pk))).toBe(false);
    });
  }
});
