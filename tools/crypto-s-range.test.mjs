// Ed25519 S range (RFC 8032 §5.1.7) in the reference verifier: tools/crypto.js verifyObject and
// the V1 paths built on it (lib/verify.js, the transparency-log gossip), plus lib/verify.js V2
// through its installed @dcp-ai/sdk. Mirrors sdks/typescript/src/__tests__/ed25519-scalar-range.test.ts.
//
//   node --test tools/crypto-s-range.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import nacl from "tweetnacl";
import { classicalOnlySign, canonicalizeV2, deriveKid } from "@dcp-ai/sdk";
import { signObject, verifyObject } from "./crypto.js";
import { verifySignedBundle, verifyCompositeSig, v2Registry } from "../lib/verify.js";
import { GossipManager } from "../services/transparency-log/gossip.js";

const read = (p) => JSON.parse(fs.readFileSync(new URL(`../${p}`, import.meta.url), "utf8"));
const kat = read("tests/nist-kat/ed25519/vectors.json").test_vectors;
const goldenKey = read("tests/conformance/v2/golden_vectors.json").v1_bundle_verification.public_key_b64;

const L = 2n ** 252n + 27742317777372353535851937790883648493n;
const hex = (h) => new Uint8Array(Buffer.from(h, "hex"));
const b64 = (u) => Buffer.from(u).toString("base64");
const scalarOf = (sig) => BigInt("0x" + Buffer.from(sig.subarray(32)).reverse().toString("hex"));
const withScalar = (sig, s) =>
  new Uint8Array([...sig.subarray(0, 32), ...Buffer.from(s.toString(16).padStart(64, "0"), "hex").reverse()]);
const plusL = (sigB64) => {
  const sig = new Uint8Array(Buffer.from(sigB64, "base64"));
  return b64(withScalar(sig, scalarOf(sig) + L));
};
/** k = 1, 2 and the largest k for which S + k·L still fits in 32 bytes. */
const ks = (sig) => [...new Set([1n, 2n, (2n ** 256n - 1n - scalarOf(sig)) / L])];

for (const [i, t] of kat.entries()) {
  const kp = nacl.sign.keyPair.fromSeed(hex(t.secret_key_hex));
  const pk = b64(kp.publicKey);
  const obj = { probe: "dcp-ed25519-review/s-range", vector: t.name, n: i };
  const sig = new Uint8Array(Buffer.from(signObject(obj, b64(kp.secretKey)), "base64"));

  test(`verifyObject, ${t.name} key: accepted; S = L and S + k·L rejected`, () => {
    assert.equal(verifyObject(obj, b64(sig), pk), true);
    assert.equal(verifyObject(obj, b64(withScalar(sig, L)), pk), false);
    for (const k of ks(sig)) {
      assert.equal(verifyObject(obj, b64(withScalar(sig, scalarOf(sig) + k * L)), pk), false, `k = ${k}`);
    }
  });

  if (i > 0) continue;
  const sPlusL = withScalar(sig, scalarOf(sig) + L);

  test("verifyObject: what TweetNaCl rejects keeps its error", () => {
    for (const n of [31, 33]) {
      const key = n < 32 ? kp.publicKey.subarray(0, n) : new Uint8Array([...kp.publicKey, 0]);
      assert.throws(() => verifyObject(obj, b64(sPlusL), b64(key)), /bad public key size/, `${n}-byte key`);
    }
    for (const n of [63, 65]) {
      const short = n < 64 ? sPlusL.subarray(0, n) : new Uint8Array([...sPlusL, 0]);
      assert.throws(() => verifyObject(obj, b64(short), pk), /bad signature size/, `${n}-byte signature`);
      assert.throws(() => verifyObject(obj, b64(short), b64(new Uint8Array(31))), /bad signature size/);
    }
    assert.throws(() => verifyObject(obj, b64(sPlusL) + "!", pk), /invalid encoding/);
    assert.throws(() => verifyObject(obj, b64(sPlusL), pk + "!"), /invalid encoding/);
  });
}

test("the bound is S < L, compared on every byte", () => {
  // A = the identity (accepted today: weak keys are E4), so [S]B = R for any object.
  const identity = hex("01" + "00".repeat(31));
  const minusB = hex("58" + "66".repeat(30) + "e6");
  const obj = { probe: "dcp-ed25519-review/s-range-boundary" };
  const sig = (r, s) => b64(withScalar(new Uint8Array([...r, ...new Uint8Array(32)]), s));
  assert.equal(verifyObject(obj, sig(minusB, L - 1n), b64(identity)), true, "S = L - 1, R = -B");
  assert.equal(verifyObject(obj, sig(identity, 0n), b64(identity)), true, "S = 0, R = identity");
  for (const k of [1n, 2n, 15n]) {
    assert.equal(verifyObject(obj, sig(identity, k * L), b64(identity)), false, `S = ${k}·L, R = identity`);
  }
});

test("lib/verify.js V1: the conformance example with S + L is SIGNATURE INVALID", async () => {
  const load = () => read("tests/conformance/examples/citizenship_bundle.signed.json");
  assert.deepEqual(await verifySignedBundle(load(), goldenKey), { verified: true, errors: [] });
  for (const key of [goldenKey, undefined]) {
    const sb = load();
    sb.signature.sig_b64 = plusL(sb.signature.sig_b64);
    assert.deepEqual(await verifySignedBundle(sb, key), { verified: false, errors: ["SIGNATURE INVALID"] });
  }
});

test("transparency-log gossip: a tree head signed with S + L is not valid", () => {
  const kp = nacl.sign.keyPair.fromSeed(hex(kat[0].secret_key_hex));
  const sth = { log_id: "log-s-range", root: "ab".repeat(32), size: 1, timestamp: "2026-10-24T00:00:00Z" };
  sth.signature = signObject(sth, b64(kp.secretKey));
  const gossip = new GossipManager({ logId: "log-local" });
  assert.deepEqual(gossip.verifySignedTreeHead(sth, b64(kp.publicKey)), { valid: true });
  assert.deepEqual(gossip.verifySignedTreeHead({ ...sth, signature: plusL(sth.signature) }, b64(kp.publicKey)), {
    valid: false,
    error: "Invalid STH signature",
  });
});

test("lib/verify.js V2: a classical_only signature with S + L is rejected", async () => {
  const c = await v2Registry.getSigner("ed25519").generateKeypair();
  const keys = [{ kid: deriveKid("ed25519", Buffer.from(c.publicKeyB64, "base64")), alg: "ed25519", public_key_b64: c.publicKeyB64 }];
  const payload = { probe: "dcp-ed25519-review/s-range" };
  const bytes = new TextEncoder().encode(canonicalizeV2(payload));
  const cs = await classicalOnlySign(v2Registry, "DCP-AI.v2.Intent", bytes, { kid: keys[0].kid, alg: "ed25519", secretKeyB64: c.secretKeyB64 });
  const opts = { allowClassicalOnly: true };
  assert.equal(await verifyCompositeSig("DCP-AI.v2.Intent", payload, cs, keys, opts), true);
  const malleated = { ...cs, classical: { ...cs.classical, sig_b64: plusL(cs.classical.sig_b64) } };
  assert.equal(await verifyCompositeSig("DCP-AI.v2.Intent", payload, malleated, keys, opts), false);
});
