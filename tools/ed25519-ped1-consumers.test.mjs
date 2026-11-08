// P-ED-1 in the verifiers outside the SDKs that compute Ed25519 with TweetNaCl (MP-03 P3): the reference verifier
// (tools/crypto.js verifyObject, and through it lib/verify.js V1, bin/dcp.js V1, the transparency-log gossip and the
// revocation service's Ed25519 path) and the playground (playground/js/core/crypto.js verifyDetached). The CLI has its
// own test (cli/__tests__/verify-ped1.test.mjs). Every expectation comes from the frozen corpus
// tests/interop/v2/ed25519_ped1_vectors.json, never from the code under test. Three levels, kept apart:
//   - the helper copies (tools/, cli/lib/, playground/js/core/ed25519-ped1.js): identical bytes, the corpus's table, the
//     52 encodings, S < L at its edges, and rejectedByPed1 on 62 of the 67 byte cases (the 5 length cases are the
//     callers'): its byte predicates only, no message and no equation;
//   - the public reference API on preimages it really signs: the 4 object cases over canonical(object), KAT keys,
//     mutations, and a universal forgery with the identity over a real tree head through the gossip;
//   - the playground's public verifyDetached on the 2 composite cases over their exact DSM.
// Every weak case now rejected is also shown accepted by TweetNaCl alone on the same bytes: the guard is the reason.
//
//   node --test tools/ed25519-ped1-consumers.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import crypto from "node:crypto";
import nacl from "tweetnacl";
import naclUtil from "tweetnacl-util";
import * as helper from "./ed25519-ped1.js";
import { canonicalize, signObject, verifyObject } from "./crypto.js";
import { GossipManager } from "../services/transparency-log/gossip.js";

const ROOT = new URL("../", import.meta.url);
const read = (p) => fs.readFileSync(new URL(p, ROOT));
const FROZEN = "f5990f8fcc8709c2c3b52e775c8210f0dcb32219c3e7cd36c527e44f49d1e396";
const raw = read("tests/interop/v2/ed25519_ped1_vectors.json");
const V = JSON.parse(raw);
const kat = JSON.parse(read("tests/nist-kat/ed25519/vectors.json")).test_vectors;
const COPIES = ["tools/ed25519-ped1.js", "cli/lib/ed25519-ped1.js", "playground/js/core/ed25519-ped1.js"];

const hex = (h) => new Uint8Array(Buffer.from(h, "hex"));
const b64 = (u) => Buffer.from(u).toString("base64");
const naclAlone = (msg, sig, pk) => nacl.sign.detached.verify(msg, sig, pk);
const L = 2n ** 252n + 27742317777372353535851937790883648493n;
const withScalar = (s) => {
  const sig = new Uint8Array(64);
  sig.set(Buffer.from(s.toString(16).padStart(64, "0"), "hex").reverse(), 32);
  return sig;
};
const IDENTITY = hex("01" + "00".repeat(31));
/** R = A = the identity and S = 0: [0]B = R + [k]A holds for every message, without cofactor. */
const forgery = () => new Uint8Array([...IDENTITY, ...new Uint8Array(32)]);

// ── The helper copies ──

test("the frozen corpus; three byte-identical helper copies whose table is the corpus's", async () => {
  assert.equal(crypto.createHash("sha256").update(raw).digest("hex"), FROZEN);
  const bytes = COPIES.map((p) => read(p).toString("hex"));
  assert.ok(bytes.every((b) => b === bytes[0]), "the three copies are identical");
  for (const p of COPIES) {
    const m = await import(new URL(p, ROOT).href);
    assert.deepEqual([...m.SMALL_ORDER_ENCODINGS_HEX], V.constants.small_order_encodings_hex, p);
  }
});

test("helper: the 52 encodings (canonical rule, and E[8] only for canonical encodings)", () => {
  assert.equal(V.encodings.length, 52);
  for (const e of V.encodings) {
    const b = hex(e.encoding_hex);
    assert.equal(helper.isCanonicalEncoding(b), e.canonical_rule, e.id);
    assert.equal(helper.isSmallOrderEncoding(b), e.canonical_rule && e.small_order === true, e.id);
  }
  for (const n of [0, 31, 33]) assert.ok(!helper.isCanonicalEncoding(new Uint8Array(n)) && !helper.isSmallOrderEncoding(new Uint8Array(n)), `${n} bytes`);
});

test("helper: S < L at its edges, compared on every byte", () => {
  const below = (s) => helper.scalarBelowL(withScalar(s));
  for (const s of [0n, 1n, L - 1n, L - 2n ** 120n, L - 2n ** 248n]) assert.equal(below(s), true, `S = ${s}`);
  for (const s of [L, L + 1n, L + 2n ** 120n, L + 2n ** 248n, 2n ** 256n - 1n]) assert.equal(below(s), false, `S = ${s}`);
});

test("helper: rejectedByPed1 on 62 of the corpus's 67 byte cases: its predicates, not the equation", () => {
  // The 5 length cases are the callers' (a wrong size never reaches the helper). The expectation is the corpus's byte
  // predicates; the equation is TweetNaCl's and is not evaluated here.
  const cases = [...V.historical, ...V.signatures];
  assert.equal(cases.length, 67);
  let n = 0;
  for (const c of cases) {
    if (c.kind === "length") continue;
    n += 1;
    const want = !c.s_below_l || !c.a_canonical || !c.r_canonical || c.a_small_order || c.r_small_order;
    assert.equal(helper.rejectedByPed1(hex(c.signature_hex), hex(c.public_key_hex)), want, c.id);
  }
  assert.equal(n, 62);
});

// ── The reference verifier ──

test("reference verifyObject: the 4 object cases over canonical(object), as the corpus says", () => {
  const obj = V.objects.object;
  assert.equal(Buffer.from(canonicalize(obj)).toString("hex"), V.objects.canonical_hex, "the exact preimage");
  for (const c of V.objects.cases) {
    assert.equal(c.message_hex, V.objects.canonical_hex);
    assert.equal(verifyObject(obj, b64(hex(c.signature_hex)), b64(hex(c.public_key_hex))), c.accept, c.id);
    if (!c.accept) assert.equal(naclAlone(hex(c.message_hex), hex(c.signature_hex), hex(c.public_key_hex)), true, `${c.id}: TweetNaCl alone accepts`);
  }
});

test("reference verifyObject: KAT keys verify; another object, R or key does not", () => {
  for (const [i, t] of kat.entries()) {
    const kp = nacl.sign.keyPair.fromSeed(hex(t.secret_key_hex));
    const obj = { probe: "dcp-mp03-p3/reference", n: i };
    const sig = Buffer.from(signObject(obj, b64(kp.secretKey)), "base64");
    assert.equal(verifyObject(obj, b64(sig), b64(kp.publicKey)), true, t.name);
    assert.equal(verifyObject({ ...obj, n: i + 1 }, b64(sig), b64(kp.publicKey)), false);
    const r = new Uint8Array(sig);
    r[0] ^= 1;
    assert.equal(verifyObject(obj, b64(r), b64(kp.publicKey)), false);
    assert.equal(verifyObject(obj, b64(sig), b64(nacl.sign.keyPair.fromSeed(hex(kat[(i + 1) % kat.length].secret_key_hex)).publicKey)), false);
  }
});

test("reference verifyObject: the identity forgery is rejected, which TweetNaCl alone accepts", () => {
  const obj = { probe: "dcp-mp03-p3/any object" };
  assert.equal(naclAlone(naclUtil.decodeUTF8(canonicalize(obj)), forgery(), IDENTITY), true);
  assert.equal(verifyObject(obj, b64(forgery()), b64(IDENTITY)), false);
});

test("transparency-log gossip: a tree head forged with the identity key is not valid; a real one is", () => {
  const sth = { log_id: "log-ped1", root: "ab".repeat(32), size: 1, timestamp: "2026-11-08T00:00:00Z" };
  const signed = (sig) => ({ ...sth, signature: sig });
  const gossip = new GossipManager({ logId: "log-local" });
  const kp = nacl.sign.keyPair.fromSeed(hex(kat[0].secret_key_hex));
  assert.deepEqual(gossip.verifySignedTreeHead(signed(signObject(sth, b64(kp.secretKey))), b64(kp.publicKey)), { valid: true });
  assert.equal(naclAlone(naclUtil.decodeUTF8(canonicalize(sth)), forgery(), IDENTITY), true, "TweetNaCl alone accepts it");
  assert.deepEqual(gossip.verifySignedTreeHead(signed(b64(forgery())), b64(IDENTITY)), { valid: false, error: "Invalid STH signature" });
});

// ── The playground ──

globalThis.nacl = nacl;
nacl.util = naclUtil;
const playground = await import("../playground/js/core/crypto.js");
const { canonicalize: playgroundCanonicalize } = await import("../playground/js/core/hash.js");

test("playground verifyDetached: the 2 composite cases over their exact DSM, as text and as an object", () => {
  const { context, payload_canonical: text } = V.composite;
  assert.equal(playgroundCanonicalize(JSON.parse(text)), text, "the playground writes the same canonical payload");
  for (const c of V.composite.cases) {
    assert.equal(Buffer.from(`${context}\0${text}`).toString("hex"), c.message_hex, "the exact preimage");
    const sig = hex(c.signature_hex);
    const pk = hex(c.public_key_hex);
    assert.equal(playground.verifyDetached(text, context, sig, pk), c.accept, c.id);
    assert.equal(playground.verifyDetached(JSON.parse(text), context, sig, pk), c.accept, c.id);
    if (!c.accept) assert.equal(naclAlone(hex(c.message_hex), sig, pk), true, `${c.id}: TweetNaCl alone accepts`);
    if (c.accept) {
      assert.equal(playground.verifyDetached(text, "DCP-AI.v2.Bundle", sig, pk), false, "another context");
      assert.equal(playground.verifyDetached('{"dcp_ped1":"other"}', context, sig, pk), false, "another payload");
    }
  }
});

test("playground verifyDetached: the identity forgery over a bundle manifest is rejected", () => {
  const payload = { manifest: { probe: "dcp-mp03-p3/playground" } };
  assert.equal(naclAlone(new TextEncoder().encode(`DCP-AI.v2.Bundle\0${playgroundCanonicalize(payload)}`), forgery(), IDENTITY), true);
  assert.equal(playground.verifyDetached(payload, "DCP-AI.v2.Bundle", forgery(), IDENTITY), false);
});
