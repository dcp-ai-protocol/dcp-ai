import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import nacl from "tweetnacl";
import { post as postTo, sha256Hex, startService } from "../../tests/helpers.js";
import { signObject, verifyObject } from "../../tools/crypto.js";

const TLOG = fileURLToPath(new URL("./index.js", import.meta.url));
const b64 = (bytes) => Buffer.from(bytes).toString("base64");
// A peer log this test signs tree heads for; the log under test pins its public key.
const peer = nacl.sign.keyPair();
const peerSth = (root, size, secretKey = peer.secretKey) => {
  const sth = { log_id: "log-peer", root, size, timestamp: new Date().toISOString() };
  return { ...sth, signature: signObject(sth, b64(secretKey)) };
};
const env = {
  OPERATOR_KEY: crypto.randomBytes(32).toString("hex"),
  OPERATOR_TOKEN: "test-operator-token",
  GOSSIP_PEERS: `http://127.0.0.1:9#${b64(peer.publicKey)}`,
  GOSSIP_INTERVAL_MS: "3600000",
};
let base;
const procs = [];

before(async () => {
  const service = await startService(TLOG, env);
  base = service.base;
  procs.push(service.proc);
});

after(() => procs.forEach((p) => p.kill()));

const post = (path, body, headers) => postTo(base, path, body, headers);
const get = async (path) => (await fetch(base + path)).json();
// SHA-256(prefix || parts...): 0x00 for leaves, 0x01 for interior nodes (RFC 6962).
const h = (prefix, ...hexOrText) =>
  crypto.createHash("sha256").update(Buffer.concat([Buffer.from([prefix]), ...hexOrText])).digest("hex");
const hex = (s) => Buffer.from(s, "hex");

test("Merkle tree uses RFC 6962 leaf/node prefixes and inclusion proofs verify", async () => {
  assert.equal((await post("/add", { bundle_hash: 1 })).status, 400);

  const leaves = [];
  for (let i = 0; i < 7; i++) {
    const bundleHash = `sha256:${sha256Hex(`bundle-${i}`)}`;
    leaves.push(h(0x00, Buffer.from(bundleHash, "utf8")));
    assert.equal((await post("/add", { bundle_hash: bundleHash })).body.leaf_hash, leaves[i]);
    if (i === 2) {
      // Size 3 splits as [l0 l1] [l2]: no duplicated last node.
      assert.equal((await get("/root")).root, h(0x01, hex(h(0x01, hex(leaves[0]), hex(leaves[1]))), hex(leaves[2])));
    }
  }

  const { root, size } = await get("/root");
  assert.equal(size, 7);
  for (let i = 0; i < size; i++) {
    const { leaf_hash, proof } = await get(`/proof/${i}`);
    const computed = proof.reduce((acc, { hash, direction }) =>
      direction === "left" ? h(0x01, hex(hash), hex(acc)) : h(0x01, hex(acc), hex(hash)), leaf_hash);
    assert.equal(computed, root, `inclusion proof for index ${i}`);
  }
});

test("signed tree heads verify with the published Ed25519 key, which survives restarts", async () => {
  const { log_id, root, size, timestamp, signature } = await get("/root/signed");
  const { public_key } = await get("/health");
  assert.equal(verifyObject({ log_id, root, size, timestamp }, signature, public_key), true);
  assert.equal(verifyObject({ log_id, root, size: size + 1, timestamp }, signature, public_key), false);

  const restarted = await startService(TLOG, env);
  procs.push(restarted.proc);
  assert.equal((await (await fetch(`${restarted.base}/health`)).json()).public_key, public_key);

  // A passphrase (like the old compose placeholders) would make the key guessable.
  const passphrase = { OPERATOR_KEY: "alpha-operator-secret-replace-in-production" };
  await assert.rejects(startService(TLOG, passphrase).then(({ proc }) => proc.kill()));
});

test("POST /gossip/peers needs the operator token and an http(s) endpoint", async () => {
  const metadata = { peer_id: "peer-x", endpoint: "http://169.254.169.254/latest/meta-data" };
  assert.equal((await post("/gossip/peers", metadata)).status, 401);

  const asOperator = { authorization: `Bearer ${env.OPERATOR_TOKEN}` };
  assert.equal((await post("/gossip/peers", { peer_id: "peer-y", endpoint: "file:///etc/passwd" }, asOperator)).status, 400);
  assert.equal((await post("/gossip/peers", { peer_id: "peer-z", endpoint: "https://log-b.example" }, asOperator)).status, 200);
});

test("gossip exchange only takes well-formed tree heads signed by a pinned peer", async () => {
  const exchange = (sth) => post("/gossip/exchange", { sth });
  const { size } = await get("/root");
  const otherRoot = "ab".repeat(32);

  assert.equal((await exchange(peerSth(otherRoot, size, nacl.sign.keyPair().secretKey))).status, 403);
  assert.equal((await exchange({ ...peerSth(otherRoot, size), root: "x".repeat(1000) })).status, 400);
  assert.equal((await exchange({ ...peerSth(otherRoot, size), padding: "x".repeat(50_000) })).status, 400);
  assert.equal((await get("/gossip/alerts")).count, 0);

  // A pinned peer showing another root for the same size is a split view.
  const split = await exchange(peerSth(otherRoot, size));
  assert.equal(split.status, 200);
  assert.equal(split.body.alert.type, "split_view_detected");

  for (let i = 0; i < 110; i++) await exchange(peerSth(otherRoot, size));
  assert.equal((await get("/gossip/alerts")).count, 100);
});

test("polled peer tree heads are only trusted with the peer's pinned key", async () => {
  const peerLog = await startService(TLOG, { OPERATOR_KEY: crypto.randomBytes(32).toString("hex") });
  procs.push(peerLog.proc);
  const { public_key } = await (await fetch(`${peerLog.base}/health`)).json();
  const pinned = await startService(TLOG, { GOSSIP_PEERS: `${peerLog.base}#${public_key}`, GOSSIP_INTERVAL_MS: "100" });
  const mispinned = await startService(TLOG, {
    GOSSIP_PEERS: `${peerLog.base}#${b64(nacl.sign.keyPair().publicKey)}`,
    GOSSIP_INTERVAL_MS: "100",
  });
  procs.push(pinned.proc, mispinned.proc);
  await new Promise((resolve) => setTimeout(resolve, 1000));

  const lastSth = async ({ base: url }) => (await (await fetch(`${url}/gossip/peers`)).json()).peers[0].last_sth;
  assert.equal((await lastSth(pinned)).log_id, (await (await fetch(`${peerLog.base}/health`)).json()).log_id);
  assert.equal(await lastSth(mispinned), null);
});
