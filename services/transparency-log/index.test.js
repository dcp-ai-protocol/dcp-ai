import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import { fileURLToPath } from "node:url";
import nacl from "tweetnacl";
import { post as postTo, sha256Hex, startService } from "../../tests/helpers.js";
import { signObject, verifyObject } from "../../tools/crypto.js";
import { GossipManager } from "./gossip.js";

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

// ── Gossip helpers: real Ed25519 signatures, real loopback HTTP ──

const asOperator = { authorization: `Bearer ${env.OPERATOR_TOKEN}` };
/** A tree head of log `log_id` signed by `kp`: the four signed fields and the signature, nothing else. */
const signHead = (kp, log_id, root, size, timestamp = new Date().toISOString()) => {
  const sth = { log_id, root, size, timestamp };
  return { ...sth, signature: signObject(sth, b64(kp.secretKey)) };
};
const verifiesUnder = ({ log_id, root, size, timestamp, signature }, key) =>
  verifyObject({ log_id, root, size, timestamp }, signature, key);
const root = (label) => sha256Hex(`root-${label}`);
// The same signature with S + L: Ed25519 (RFC 8032 §5.1.7) requires S < L.
const L = 2n ** 252n + 27742317777372353535851937790883648493n;
const plusL = (sigB64) => {
  const sig = Buffer.from(sigB64, "base64");
  const s = BigInt("0x" + Buffer.from(sig.subarray(32)).reverse().toString("hex")) + L;
  return Buffer.concat([sig.subarray(0, 32), Buffer.from(s.toString(16).padStart(64, "0"), "hex").reverse()]).toString("base64");
};
// Another base64 spelling of the same 32 key bytes: the last character before "=" has two unused bits.
const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const respell = (key) => key.slice(0, 42) + B64[B64.indexOf(key[42]) ^ 1] + key.slice(43);

/** A transparency log under test, with its own state: `{ base, post, get, exchange, alerts, peers }`. */
async function startLog(extra) {
  const service = await startService(TLOG, { OPERATOR_TOKEN: env.OPERATOR_TOKEN, GOSSIP_INTERVAL_MS: "3600000", ...extra });
  procs.push(service.proc);
  const at = {
    base: service.base,
    post: (path, body, headers) => postTo(service.base, path, body, headers),
    get: async (path) => (await fetch(service.base + path)).json(),
  };
  at.exchange = (sth) => at.post("/gossip/exchange", { sth });
  at.alerts = async () => (await at.get("/gossip/alerts")).alerts;
  at.peers = async () => (await at.get("/gossip/peers")).peers;
  at.add = (label) => at.post("/add", { bundle_hash: `sha256:${sha256Hex(label)}` });
  return at;
}

/** A peer log on loopback: GET /root/signed answers with `serve()` (an object, or a raw string body). */
async function fakePeer(serve) {
  let requests = 0;
  const server = http.createServer((req, res) => {
    requests++;
    const body = serve();
    res.setHeader("Content-Type", "application/json");
    res.end(typeof body === "string" ? body : JSON.stringify(body));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    requests: () => requests,
    close: () => { server.closeAllConnections(); server.close(); },
  };
}

async function waitFor(check, what, ms = 8000) {
  const end = Date.now() + ms;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
}
/** Until the peer has answered `n` more polls than now: a whole poll ran on what it serves now. */
const morePolls = async (fake, n = 2) => {
  const target = fake.requests() + n;
  await waitFor(() => fake.requests() >= target, `${n} more polls`);
  await new Promise((resolve) => setTimeout(resolve, 60));
};

/**
 * The required members and the property names of a component schema of api/openapi.yaml, read as text:
 * a structural check of the lines this suite relies on, not a YAML parse or an OpenAPI validation.
 */
const openapi = fs.readFileSync(new URL("../../api/openapi.yaml", import.meta.url), "utf8").split("\n");
function schemaOf(name) {
  const start = openapi.indexOf(`    ${name}:`);
  assert.notEqual(start, -1, `${name} is in api/openapi.yaml`);
  const block = [];
  for (const line of openapi.slice(start + 1)) {
    if (/^ {0,4}\S/.test(line)) break;
    block.push(line);
  }
  const required = block.find((l) => /^ {6}required: \[/.test(l)).match(/\[(.*)\]/)[1].split(",").map((s) => s.trim());
  const properties = block.filter((l) => /^ {8}[a-z_]+:$/.test(l)).map((l) => l.trim().slice(0, -1));
  return { required, properties, text: block.join("\n") };
}

/** The checks every split-view alert passes: two heads the pinned key signed, one log, one size, two roots. */
function assertEquivocation(alert, { key, logId, size, observed, conflicting, source }) {
  assert.equal(alert.type, "split_view_detected");
  assert.equal(alert.peer_public_key, key);
  assert.equal(alert.peer_log_id, logId);
  assert.equal(alert.tree_size, size);
  assert.equal(alert.observed_root, observed);
  assert.equal(alert.local_root, observed, "local_root is the legacy name of observed_root");
  assert.equal(alert.peer_root, conflicting);
  assert.equal(alert.source, source);
  const { observed: a, conflicting: b } = alert.evidence;
  for (const head of [a, b]) {
    assert.deepEqual(Object.keys(head).sort(), ["log_id", "root", "signature", "size", "timestamp"]);
    assert.equal(verifiesUnder(head, key), true, "the evidence verifies under the pinned key");
    assert.equal(verifiesUnder(head, b64(nacl.sign.keyPair().publicKey)), false);
  }
  assert.deepEqual([a.log_id, a.size, a.root], [logId, size, observed]);
  assert.deepEqual([b.log_id, b.size, b.root], [logId, size, conflicting]);
  assert.notEqual(a.root, b.root);
}

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

  assert.equal((await post("/gossip/peers", { peer_id: "peer-y", endpoint: "file:///etc/passwd" }, asOperator)).status, 400);
  assert.equal((await post("/gossip/peers", { peer_id: "peer-z", endpoint: "https://log-b.example" }, asOperator)).status, 200);
});

test("gossip exchange only takes well-formed tree heads signed by a pinned peer; one log with two roots for a size is a split view", async () => {
  const log = await startLog({ GOSSIP_PEERS: env.GOSSIP_PEERS });
  const size = 5;
  const [rootA, rootB, other] = [root("A"), root("B"), root("other")];

  // Refused, and never recorded: had any of them been, the first valid head below would conflict with it.
  assert.equal((await log.exchange(peerSth(other, size, nacl.sign.keyPair().secretKey))).status, 403);
  assert.equal((await log.exchange({ ...peerSth(other, size), root: root("tampered") })).status, 403);
  const sPlusL = peerSth(root("s-plus-l"), size);
  assert.equal((await log.exchange({ ...sPlusL, signature: plusL(sPlusL.signature) })).status, 403);
  assert.equal((await log.exchange({ ...peerSth(other, size), root: "x".repeat(1000) })).status, 400);
  assert.equal((await log.exchange({ ...peerSth(other, size), padding: "x".repeat(50_000) })).status, 400);
  assert.equal((await log.alerts()).length, 0);

  // Another log's head is no split view: it is this peer log's first head of that size.
  assert.equal((await log.exchange(peerSth(rootA, size))).body.alert, null);
  // The same log signing another root for that size is.
  const split = await log.exchange(peerSth(rootB, size));
  assert.equal(split.status, 200);
  assertEquivocation(split.body.alert, { key: b64(peer.publicKey), logId: "log-peer", size, observed: rootA, conflicting: rootB, source: "exchange" });

  // Replaying signed tree heads adds nothing, so it cannot push older alerts out; the first one still matches.
  for (let i = 0; i < 5; i++) await log.exchange(peerSth(rootB, size));
  assert.equal((await log.exchange(peerSth(rootA, size))).body.alert, null);
  assert.equal((await log.alerts()).length, 1);

  for (let i = 0; i < 110; i++) await log.exchange(peerSth(sha256Hex(`root-${i}`), size));
  assert.equal((await log.alerts()).length, 100);
});

test("gossip never compares another log with the local tree: identity is the pinned key and the exact log_id", async () => {
  const log = await startLog({ GOSSIP_PEERS: env.GOSSIP_PEERS, LOG_ID: "log-under-test" });
  await log.add("local entry");
  const local = await log.get("/root");
  assert.equal(local.size, 1);
  const quiet = async (sth) => assert.equal((await log.exchange(sth)).body.alert, null, JSON.stringify(sth));
  const as = (log_id, rootHex, size = 1) => signHead(peer, log_id, rootHex, size);

  await quiet(as("log-peer", root("peer")));            // the reproduced finding: same size, another log
  await quiet(as("log-under-test", root("claims")));    // a pinned peer signing our LOG_ID is still not us
  await quiet(as("log-peer-2", root("other log")));     // same key, another log
  await quiet(as("LOG-PEER", root("case")));            // log_id compared exactly
  await quiet(as("log-peer", root("peer")));            // same head again, new timestamp
  await quiet(as("log-peer", root("bigger"), 2));       // another size: no conclusion
  assert.equal((await log.alerts()).length, 0);
});

test("polled heads: one log with two roots for a size is a split view, across poll and exchange; bad heads poison nothing", async () => {
  const k = nacl.sign.keyPair();
  const key = b64(k.publicKey);
  let serving = null;
  const fake = await fakePeer(() => serving);
  const log = await startLog({ GOSSIP_PEERS: `${fake.url}#${key}`, GOSSIP_INTERVAL_MS: "100" });
  const lastSth = async () => (await log.peers())[0].last_sth;
  const head = (label, size = 3) => signHead(k, "log-polled", root(label), size);
  try {
    // Ignored on the poll route as on the exchange route: bad signature, S + L, more than 16 KB.
    serving = { ...head("signed"), root: root("tampered") };
    await morePolls(fake);
    const sPlusL = head("s-plus-l");
    serving = { ...sPlusL, signature: plusL(sPlusL.signature) };
    await morePolls(fake);
    serving = JSON.stringify({ ...head("big"), padding: "x".repeat(20_000) });
    await morePolls(fake);
    assert.equal(await lastSth(), null);

    serving = head("A");
    await waitFor(async () => (await lastSth())?.root === root("A"), "the poll to see A");
    assert.equal((await log.alerts()).length, 0, "nothing the bad heads said was recorded");

    serving = head("B");
    const [alert] = await waitFor(async () => { const a = await log.alerts(); return a.length > 0 && a; }, "the split view");
    assertEquivocation(alert, { key, logId: "log-polled", size: 3, observed: root("A"), conflicting: root("B"), source: "poll" });

    // A view seen by polling and another one handed to the exchange.
    serving = head("C", 4);
    await waitFor(async () => (await lastSth())?.size === 4, "the poll to see size 4");
    assert.equal((await log.exchange(head("C", 4))).body.alert, null);
    const viaExchange = (await log.exchange(head("D", 4))).body.alert;
    assertEquivocation(viaExchange, { key, logId: "log-polled", size: 4, observed: root("C"), conflicting: root("D"), source: "exchange" });
    // The exchange route keeps its own refusals.
    assert.equal((await log.exchange({ ...head("E", 5), root: root("tampered") })).status, 403);
    assert.equal((await log.exchange({ ...head("E", 5), padding: "x".repeat(50_000) })).status, 400);
    assert.equal((await log.alerts()).length, 2);
  } finally {
    fake.close();
  }
});

test("two aliases of one log showing different roots are a split view; other logs of the same key are not", async () => {
  const k = nacl.sign.keyPair();
  const key = b64(k.publicKey);
  const serve = (log_id, label) => fakePeer(() => signHead(k, log_id, root(label), 1));
  const fakes = [await serve("log-mirror", "A"), await serve("log-mirror", "B"), await serve("log-x1", "C"), await serve("log-x2", "D")];
  // The log under test has size 1 too: none of these heads is about its own tree.
  const log = await startLog({
    GOSSIP_PEERS: fakes.map((f, i) => `${f.url}#${i === 1 ? respell(key) : key}`).join(","),
    GOSSIP_INTERVAL_MS: "100",
  });
  await log.add("local entry");
  try {
    await waitFor(async () => (await log.peers()).every((p) => p.last_sth), "every alias polled");
    await Promise.all(fakes.map((f) => morePolls(f)));
    const alerts = await log.alerts();
    assert.equal(alerts.length, 1, JSON.stringify(alerts));
    assert.equal(alerts[0].peer_log_id, "log-mirror");
    assert.equal(alerts[0].peer_public_key, key, "the respelled pin is the same key");
    assert.deepEqual(new Set([alerts[0].observed_root, alerts[0].peer_root]), new Set([root("A"), root("B")]));
  } finally {
    fakes.forEach((f) => f.close());
  }
});

test("two independent logs that pin each other and poll for real never report a split view", async () => {
  const [seedA, seedB] = [crypto.randomBytes(32), crypto.randomBytes(32)];
  const pub = (seed) => b64(nacl.sign.keyPair.fromSeed(seed).publicKey);
  // log-b polls from start (an initial peer), so the peer added below is polled too.
  const logB = await startLog({
    OPERATOR_KEY: seedB.toString("hex"), LOG_ID: "log-b", GOSSIP_INTERVAL_MS: "100",
    GOSSIP_PEERS: `http://127.0.0.1:9#${b64(nacl.sign.keyPair().publicKey)}`,
  });
  const logA = await startLog({
    OPERATOR_KEY: seedA.toString("hex"), LOG_ID: "log-a", GOSSIP_INTERVAL_MS: "100",
    GOSSIP_PEERS: `${logB.base}#${pub(seedB)}`,
  });
  assert.equal((await logB.post("/gossip/peers", { peer_id: "log-a", endpoint: logA.base, public_key: pub(seedA) }, asOperator)).status, 200);
  await logA.add("an entry only log-a has");
  await logB.add("an entry only log-b has");
  assert.notEqual((await logA.get("/root")).root, (await logB.get("/root")).root);

  const sawSize1 = async (log, peerId) => (await log.peers()).find((p) => p.peer_id === peerId)?.last_sth?.size === 1;
  await waitFor(() => sawSize1(logA, "peer-0"), "log-a to poll log-b at size 1");
  await waitFor(() => sawSize1(logB, "log-a"), "log-b to poll log-a at size 1");
  assert.equal((await logA.exchange(await logB.get("/root/signed"))).body.alert, null);
  assert.equal((await logB.exchange(await logA.get("/root/signed"))).body.alert, null);
  assert.deepEqual([(await logA.alerts()).length, (await logB.alerts()).length], [0, 0]);
});

test("history is bounded: 256 sizes per log, the smallest leave first, and 8 logs per pinned key", async () => {
  const [k, many] = [nacl.sign.keyPair(), nacl.sign.keyPair()];
  const log = await startLog({ GOSSIP_PEERS: [k, many].map((kp) => `http://127.0.0.1:9#${b64(kp.publicKey)}`).join(",") });
  const send = async (kp, log_id, label, size) => (await log.exchange(signHead(kp, log_id, root(label), size))).body.alert;

  // Largest first, so the first heads observed are not the smallest ones.
  for (let size = 256; size >= 1; size--) assert.equal(await send(k, "log-h", `A${size}`, size), null);
  assert.equal(await send(k, "log-h", "A257", 257), null);
  assert.equal(await send(k, "log-h", "B1", 1), null, "size 1, the smallest, left the history");
  assert.equal(await send(k, "log-h", "A1", 1), null, "an old head does not come back in nor push another out");
  assert.notEqual(await send(k, "log-h", "B2", 2), null, "size 2 is still recorded");
  assert.notEqual(await send(k, "log-h", "B256", 256), null, "and so is the first one observed");
  assert.notEqual(await send(k, "log-h", "B257", 257), null, "and the largest");

  for (let i = 1; i <= 9; i++) assert.equal(await send(many, `log-k${i}`, "A", 1), null);
  assert.equal(await send(many, "log-k9", "B", 1), null, "a ninth log of one key is not tracked");
  assert.notEqual(await send(many, "log-k8", "B", 1), null, "the first eight are");
  assert.notEqual(await send(many, "log-k1", "B", 1), null);
});

test("history follows the pinned key, not the alias: kept while any alias pins it, dropped when none does", async () => {
  const [k1, k2, k3] = [nacl.sign.keyPair(), nacl.sign.keyPair(), nacl.sign.keyPair()];
  const key1 = b64(k1.publicKey);
  const log = await startLog({ GOSSIP_PEERS: `http://127.0.0.1:9#${key1}` });
  const pin = async (peer_id, publicKey, endpoint = "http://127.0.0.1:9") =>
    assert.equal((await log.post("/gossip/peers", { peer_id, endpoint, public_key: publicKey }, asOperator)).status, 200);
  const send = (label) => log.exchange(signHead(k1, "log-re", root(label), 7));
  assert.notEqual(respell(key1), key1);
  assert.ok(Buffer.from(respell(key1), "base64").equals(Buffer.from(key1, "base64")));

  assert.equal((await send("A")).body.alert, null);
  await pin("alias-2", respell(key1));                     // the same key, spelled otherwise
  await pin("peer-0", b64(k2.publicKey));                  // the first alias is re-keyed
  const kept = (await send("B")).body.alert;               // alias-2 still pins key1: A is still recorded
  assertEquivocation(kept, { key: key1, logId: "log-re", size: 7, observed: root("A"), conflicting: root("B"), source: "exchange" });
  assert.equal(kept.peer_id, "alias-2");

  await pin("alias-2", key1, "http://127.0.0.1:10");       // same key, new endpoint: nothing dropped
  assert.equal((await send("C")).body.alert?.observed_root, root("A"));

  await pin("alias-2", b64(k3.publicKey));                 // no alias pins key1 any more
  assert.equal((await send("A")).status, 403);
  await pin("alias-3", key1);                              // pinned again: a new, empty history
  assert.equal((await send("B")).body.alert, null);
  assert.equal((await send("A")).body.alert?.observed_root, root("B"));
});

test("a poll answered after its peer was removed, re-keyed or moved does not count", async () => {
  const k = nacl.sign.keyPair();
  const own = nacl.sign.keyPair();
  const held = [];
  const server = http.createServer((req, res) => held.push(res)); // answers when the test says so
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const head = (label, size) => signHead(k, "log-flight", root(label), size);
  const changes = {
    none: null,
    removed: (g) => g.removePeer("p"),
    rekeyed: (g) => g.addPeer("p", url, b64(nacl.sign.keyPair().publicKey)),
    moved: (g) => g.addPeer("p", `http://localhost:${server.address().port}`, b64(k.publicKey)),
  };
  try {
    for (const [name, change] of Object.entries(changes)) {
      const alerts = [];
      const g = new GossipManager({
        operatorKeyPair: { publicKey: b64(own.publicKey), secretKey: b64(own.secretKey) },
        logId: "log-local",
        getLocalSTH: () => ({ root: null, size: 0 }),
        onInconsistency: (a) => alerts.push(a),
      });
      g.addPeer("p", url, b64(k.publicKey));
      const poll = g.pollPeer("p");
      await waitFor(() => held.length === 1, "the poll to reach the peer");
      change?.(g);
      const res = held.shift();
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(head("polled", 4))); // a new size: recorded only if the answer counts
      await poll;
      const lastSth = g.getPeers().find((p) => p.peer_id === "p")?.last_sth ?? null;
      if (name === "none") {
        assert.equal(lastSth.root, root("polled"));
        assert.notEqual(g.handleExchange(head("other", 4), "p").alert, null, "the probe sees a recorded answer");
      } else {
        assert.equal(lastSth, null, name);
        assert.equal(alerts.length, 0, name);
        if (name === "moved") assert.equal(g.handleExchange(head("other", 4), "p").alert, null, "nothing was recorded");
      }
    }
  } finally {
    server.closeAllConnections();
    server.close();
  }
});

test("the local tree is only compared with this log's own heads, at its current size", async () => {
  const seed = crypto.randomBytes(32);
  const own = nacl.sign.keyPair.fromSeed(seed);
  const ownKey = b64(own.publicKey);
  // The operator pins the log's own key, as for a second endpoint of the same log.
  const log = await startLog({ OPERATOR_KEY: seed.toString("hex"), LOG_ID: "log-self", GOSSIP_PEERS: `http://127.0.0.1:9#${ownKey}` });
  await log.add("local entry");
  const local = await log.get("/root");

  assert.equal((await log.exchange(signHead(own, "log-other", root("X"), 1))).body.alert, null, "another log of the same key");
  assert.equal((await log.exchange(signHead(own, "log-self", root("later"), 2))).body.alert, null, "a size the tree does not have");
  // Nothing of size 1 was observed before: the conflict is with the tree itself.
  const alert = (await log.exchange(signHead(own, "log-self", root("X"), 1))).body.alert;
  assertEquivocation(alert, { key: ownKey, logId: "log-self", size: 1, observed: local.root, conflicting: root("X"), source: "exchange" });
  assert.equal((await log.exchange(signHead(own, "log-self", local.root, 1))).body.alert, null);
});

test("alert evidence is a snapshot of the signed fields, never the sender's object, its extras or its public_key", () => {
  const k = nacl.sign.keyPair();
  const own = nacl.sign.keyPair();
  const g = new GossipManager({
    operatorKeyPair: { publicKey: b64(own.publicKey), secretKey: b64(own.secretKey) },
    logId: "log-local",
    getLocalSTH: () => ({ root: null, size: 0 }),
    onInconsistency: () => {},
  });
  g.addPeer("p", "http://127.0.0.1:9", b64(k.publicKey));
  const first = { ...signHead(k, "log-ev", root("A"), 2), public_key: b64(nacl.sign.keyPair().publicKey), extra: "x" };
  const { public_key: _key, extra: _extra, ...signedFirst } = first;
  const signedFirstCopy = structuredClone(signedFirst);
  assert.equal(g.handleExchange(first, "p").alert, null);
  Object.assign(first, { root: root("mutated"), signature: "mutated", log_id: "log-mutated" }); // the caller's object changes

  const second = { ...signHead(k, "log-ev", root("B"), 2), public_key: "carried" };
  const { alert } = g.handleExchange(second, "p");
  assert.deepEqual(alert.evidence.observed, signedFirstCopy);
  const { public_key: _carried, ...signedSecond } = second;
  assert.deepEqual(alert.evidence.conflicting, signedSecond);
  assertEquivocation(alert, { key: b64(k.publicKey), logId: "log-ev", size: 2, observed: root("A"), conflicting: root("B"), source: "exchange" });

  // Changing an alert, or the object a head came from, changes nothing the log recorded.
  alert.evidence.observed.root = root("edited");
  second.root = root("edited");
  const again = g.handleExchange(signHead(k, "log-ev", root("B"), 2), "p").alert;
  assert.deepEqual(again.evidence.observed, signedFirstCopy);
  assert.notEqual(again.evidence.observed, alert.evidence.observed);
});

test("alerts keep the documented shape: every OpenAPI field, local_root as a deprecated alias, evidence without public_key", async () => {
  const log = await startLog({ GOSSIP_PEERS: env.GOSSIP_PEERS });
  await log.exchange(peerSth(root("A"), 9));
  await log.exchange(peerSth(root("B"), 9));
  const [alert] = await log.alerts();
  const schema = schemaOf("SplitViewAlert");
  const evidence = schemaOf("SignedTreeHeadEvidence");

  for (const field of schema.required) assert.ok(field in alert, `required ${field}`);
  for (const field of Object.keys(alert)) assert.ok(schema.properties.includes(field), `documented ${field}`);
  assert.ok(schema.required.includes("local_root") && schema.required.includes("peer_root"), "existing clients keep their fields");
  assert.match(schema.text, /local_root:\n(?: {10}.*\n)*? {10}deprecated: true/);
  assert.match(schema.text, /\$ref: "#\/components\/schemas\/SignedTreeHeadEvidence"/);
  assert.doesNotMatch(schema.text, /\$ref: "#\/components\/schemas\/SignedTreeHead"/);
  for (const head of [alert.evidence.observed, alert.evidence.conflicting]) {
    assert.deepEqual(Object.keys(head).sort(), [...evidence.required].sort());
    assert.deepEqual([...evidence.properties].sort(), [...evidence.required].sort());
  }
  assert.ok(!evidence.properties.includes("public_key"));
  const sth = schemaOf("SignedTreeHead").text;
  assert.doesNotMatch(sth, /HMAC|SHA-256 hash of the operator key/);
  assert.match(sth, /Ed25519/);

  // A root may be null (an empty tree): the schemas say so in OpenAPI 3.1 terms, not with `nullable`.
  const nullable = (text, field) => assert.match(text, new RegExp(`\\n {8}${field}:\\n {10}type: \\[string, "null"\\]`), field);
  for (const field of ["observed_root", "local_root", "peer_root"]) nullable(`\n${schema.text}`, field);
  nullable(`\n${evidence.text}`, "root");
  nullable(`\n${sth}`, "root");
  for (const text of [schema.text, evidence.text, sth]) assert.doesNotMatch(text, /nullable:/);
});

test("a null root against a hex root at size 0 is a split view, and its evidence verifies", async () => {
  const log = await startLog({ GOSSIP_PEERS: env.GOSSIP_PEERS });
  assert.equal((await log.exchange(peerSth(null, 0))).body.alert, null);
  const { alert } = (await log.exchange(peerSth(root("not empty"), 0))).body;
  assertEquivocation(alert, { key: b64(peer.publicKey), logId: "log-peer", size: 0, observed: null, conflicting: root("not empty"), source: "exchange" });
  assert.equal(alert.local_root, null);
  await log.exchange(peerSth(root("not empty"), 0)); // a replay: still one alert
  const [stored] = await log.alerts();
  assert.equal((await log.alerts()).length, 1);
  assert.equal(stored.evidence.observed.root, null);
  assert.equal(verifiesUnder(stored.evidence.observed, b64(peer.publicKey)), true);
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

test("gossip polls never overlap, and a peer that does not answer is given up on", async () => {
  let active = 0;
  let peak = 0;
  let total = 0;
  const hanging = http.createServer((req) => {
    total++;
    peak = Math.max(peak, ++active);
    req.on("close", () => active--);
  });
  await new Promise((resolve) => hanging.listen(0, "127.0.0.1", resolve));
  const poller = await startService(TLOG, {
    GOSSIP_PEERS: `http://127.0.0.1:${hanging.address().port}#${b64(peer.publicKey)}`,
    GOSSIP_INTERVAL_MS: "100",
  });
  procs.push(poller.proc);
  await new Promise((resolve) => setTimeout(resolve, 1200));
  poller.proc.kill();
  hanging.closeAllConnections();
  hanging.close();

  // The server can see an aborted poll's connection close just after the next poll
  // opens, hence 2; stacked polls grew with every interval (11 here before the fix).
  assert.ok(peak <= 2, `${peak} concurrent polls`);
  assert.ok(total >= 3, `only ${total} polls: a hung one blocked the rest`);
});
