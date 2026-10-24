// The playground's Ed25519 verification (playground/js/core/crypto.js) and the S range
// (RFC 8032 §5.1.7): S >= L is invalid, even when the group equation holds, as it does for
// S + k·L (§8.4). Runs in Node: the two globals index.html loads from <script> tags, `nacl` and
// `nacl.util`, are set from the installed tweetnacl and tweetnacl-util. No browser, no network.
//
//   node --test tools/playground-s-range.test.mjs
//   DCP_NEGATIVE_CONTROL=1 node --test tools/playground-s-range.test.mjs   # must fail once
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import nacl from "tweetnacl";
import naclUtil from "tweetnacl-util";

globalThis.nacl = nacl;
nacl.util = naclUtil;
const globalsBefore = Object.getOwnPropertyNames(globalThis).sort();
const { signDetached, verifyDetached } = await import("../playground/js/core/crypto.js");
const { canonicalize } = await import("../playground/js/core/hash.js");

const NEGATIVE_CONTROL = process.env.DCP_NEGATIVE_CONTROL === "1";
const kat = JSON.parse(fs.readFileSync(new URL("../tests/nist-kat/ed25519/vectors.json", import.meta.url), "utf8")).test_vectors;

const L = 2n ** 252n + 27742317777372353535851937790883648493n;
const hex = (h) => new Uint8Array(Buffer.from(h, "hex"));
const scalarOf = (sig) => BigInt("0x" + Buffer.from(sig.subarray(32)).reverse().toString("hex"));
const withScalar = (sig, s) =>
  new Uint8Array([...sig.subarray(0, 32), ...Buffer.from(s.toString(16).padStart(64, "0"), "hex").reverse()]);
/** k = 1, 2 and the largest k for which S + k·L still fits in 32 bytes. */
const ks = (sig) => [...new Set([1n, 2n, (2n ** 256n - 1n - scalarOf(sig)) / L])];

// A = the identity, so [S]B = R for any message (weak keys are E4, unchanged).
const IDENTITY = hex("01" + "00".repeat(31));
const MINUS_B = hex("58" + "66".repeat(30) + "e6");
const sigOf = (r, s) => withScalar(new Uint8Array([...r, ...new Uint8Array(32)]), s);

const CONTEXT = "DCP-AI.v2.Bundle";
const payload = { manifest: { probe: "dcp-ed25519-review/playground-s-range", n: 1 } };

for (const [i, t] of kat.entries()) {
  const kp = nacl.sign.keyPair.fromSeed(hex(t.secret_key_hex));
  const sig = signDetached(payload, CONTEXT, kp.secretKey);

  test(`${t.name} key: signDetached output verifies, as an object and as its canonical string`, () => {
    assert.equal(verifyDetached(payload, CONTEXT, sig, kp.publicKey), !(NEGATIVE_CONTROL && i === 0));
    assert.equal(verifyDetached(canonicalize(payload), CONTEXT, sig, kp.publicKey), true);
  });

  test(`${t.name} key: another context, payload, R or key does not verify`, () => {
    assert.equal(verifyDetached(payload, "DCP-AI.v2.Intent", sig, kp.publicKey), false);
    assert.equal(verifyDetached({ ...payload, extra: 1 }, CONTEXT, sig, kp.publicKey), false);
    const r = new Uint8Array(sig);
    r[0] ^= 1;
    assert.equal(verifyDetached(payload, CONTEXT, r, kp.publicKey), false);
    assert.equal(verifyDetached(payload, CONTEXT, sig, hex(kat[(i + 1) % kat.length].public_key_hex)), false);
  });

  test(`${t.name} key: S = L does not verify`, () => {
    assert.equal(verifyDetached(payload, CONTEXT, withScalar(sig, L), kp.publicKey), false);
  });

  for (const k of ks(sig)) {
    test(`${t.name} key: S + ${k}·L does not verify`, () => {
      assert.equal(verifyDetached(payload, CONTEXT, withScalar(sig, scalarOf(sig) + k * L), kp.publicKey), false);
    });
  }
}

test("S = L - 1 with R = -B, A = identity: verifies (same top byte as L)", () => {
  assert.equal(verifyDetached(payload, CONTEXT, sigOf(MINUS_B, L - 1n), IDENTITY), true);
});

test("S = 0 with R = A = identity: verifies", () => {
  assert.equal(verifyDetached(payload, CONTEXT, sigOf(IDENTITY, 0n), IDENTITY), true);
});

for (const k of [1n, 2n, 15n]) {
  test(`S = ${k}·L with R = A = identity, where the equation holds: does not verify`, () => {
    assert.equal(verifyDetached(payload, CONTEXT, sigOf(IDENTITY, k * L), IDENTITY), false);
  });
}

test("what TweetNaCl rejects keeps its error", () => {
  const kp = nacl.sign.keyPair.fromSeed(hex(kat[0].secret_key_hex));
  const sig = signDetached(payload, CONTEXT, kp.secretKey);
  const sPlusL = withScalar(sig, scalarOf(sig) + L);
  const verify = (s, pk) => () => verifyDetached(payload, CONTEXT, s, pk);
  assert.throws(verify(sPlusL, kp.publicKey.subarray(0, 31)), /^Error: bad public key size$/);
  assert.throws(verify(sPlusL, new Uint8Array([...kp.publicKey, 0])), /^Error: bad public key size$/);
  assert.throws(verify(sPlusL.subarray(0, 63), kp.publicKey), /^Error: bad signature size$/);
  assert.throws(verify(new Uint8Array([...sPlusL, 0]), kp.publicKey), /^Error: bad signature size$/);
  assert.throws(verify(sPlusL.subarray(0, 63), kp.publicKey.subarray(0, 31)), /^Error: bad signature size$/);
  const typeError = { name: "TypeError", message: "unexpected type, use Uint8Array" };
  assert.throws(verify(Array.from(sPlusL), kp.publicKey), typeError);
  assert.throws(verify(sPlusL, Array.from(kp.publicKey)), typeError);
  assert.throws(verify(sPlusL, Buffer.from(kp.publicKey).toString("base64")), typeError);
  assert.equal(verifyDetached(payload, CONTEXT, Buffer.from(sPlusL), kp.publicKey), false, "a Buffer is a Uint8Array");
});

test("no side effects: no new globals, inputs left as they were", () => {
  const kp = nacl.sign.keyPair.fromSeed(hex(kat[0].secret_key_hex));
  const sig = signDetached(payload, CONTEXT, kp.secretKey);
  const sPlusL = withScalar(sig, scalarOf(sig) + L);
  const copies = [new Uint8Array(sPlusL), new Uint8Array(kp.publicKey), JSON.stringify(payload)];
  verifyDetached(payload, CONTEXT, sPlusL, kp.publicKey);
  assert.deepEqual([sPlusL, kp.publicKey, JSON.stringify(payload)], copies);
  assert.deepEqual(Object.getOwnPropertyNames(globalThis).sort(), globalsBefore);
});
