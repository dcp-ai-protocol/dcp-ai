/**
 * DCP Transparency Log — Gossip Protocol Manager
 *
 * Witnesses the Signed Tree Heads (STHs) of pinned peer logs, polled or handed
 * to the exchange, to detect split views: one log, identified by its pinned
 * key and its exact log_id, signing two different roots for the same tree
 * size. Each alert carries both signed heads, which anyone holding that key can
 * check. Heads of different logs are never compared, and heads of different
 * sizes prove nothing here (there are no consistency proofs).
 */

import crypto from "crypto";
import { signObject, verifyObject } from "../../tools/crypto.js";

const MAX_PEER_STH_BYTES = 16_384; // a tree head is a few hundred bytes
// What a log keeps of each peer log, in memory: the first head of each size, for the
// 256 largest sizes seen, so replaying old (small) heads cannot push recent ones out.
const MAX_HEADS_PER_LOG = 256;
// ponytail: logs beyond 8 per pinned key are not tracked, so a key signing more logs, plus
// replays, can keep one untracked; learn log_ids from polls only if keys sign many logs.
const MAX_LOGS_PER_KEY = 8;

// The 32 key bytes in canonical base64: two spellings of one key are one identity.
const canonicalKey = (key) => Buffer.from(key, "base64").toString("base64");
// A copy of what the signature covers, plus the signature: never the sender's object or its extras.
const signedFields = ({ log_id, root, size, timestamp, signature }) => ({ log_id, root, size, timestamp, signature });

// Reads at most `max` bytes of a peer's response, so a peer cannot make us buffer more.
async function readJsonLimited(resp, max) {
  const reader = resp.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) {
      await reader.cancel();
      throw new Error(`response over ${max} bytes`);
    }
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

// Tree heads come from other logs, so only well-formed ones are compared or kept.
export function isWellFormedSTH(sth) {
  return typeof sth === "object" && sth !== null &&
    (sth.root === null || /^[0-9a-f]{64}$/.test(sth.root)) &&
    Number.isSafeInteger(sth.size) && sth.size >= 0 &&
    typeof sth.log_id === "string" && sth.log_id.length <= 128 &&
    typeof sth.timestamp === "string" && sth.timestamp.length <= 64 &&
    typeof sth.signature === "string" && sth.signature.length <= 128;
}

export class GossipManager {
  constructor({ operatorKeyPair, logId, getLocalSTH, onInconsistency }) {
    this.peers = new Map();
    this.operatorKeyPair = operatorKeyPair;
    this.logId = logId || `log-${crypto.randomUUID().slice(0, 8)}`;
    this.getLocalSTH = getLocalSTH;
    this.onInconsistency = onInconsistency || this._defaultInconsistencyHandler;
    this._pollInterval = null;
    this._pollTimeoutMs = 10_000;
    // canonical pinned key → log_id → tree size → the first head observed (signed fields only)
    this.observed = new Map();
  }

  /**
   * @param publicKey - the peer's pinned Ed25519 public key (base64). Without it
   *   the peer's tree heads cannot be verified and are ignored.
   */
  addPeer(peerId, endpoint, publicKey = null) {
    this.peers.set(peerId, { endpoint, publicKey, lastSeen: null, lastSTH: null });
    this._forgetUnpinned();
  }

  removePeer(peerId) {
    this.peers.delete(peerId);
    this._forgetUnpinned();
  }

  // What was observed under a key no alias pins any more is dropped (raised alerts keep their evidence).
  _forgetUnpinned() {
    const pinned = new Set([...this.peers.values()].filter((p) => p.publicKey).map((p) => canonicalKey(p.publicKey)));
    for (const key of this.observed.keys()) if (!pinned.has(key)) this.observed.delete(key);
  }

  getPeers() {
    return Array.from(this.peers.entries()).map(([id, info]) => ({
      peer_id: id,
      endpoint: info.endpoint,
      public_key: info.publicKey,
      last_seen: info.lastSeen,
      last_sth: info.lastSTH,
    }));
  }

  /** The id of the pinned peer whose key signed this (well-formed) STH, or null. */
  findSigner(sth) {
    for (const [peerId, peer] of this.peers) {
      if (peer.publicKey && this.verifySignedTreeHead(sth, peer.publicKey).valid) return peerId;
    }
    return null;
  }

  /**
   * Sign a tree head with the operator's Ed25519 key: the signature covers the
   * canonical JSON of { log_id, root, size, timestamp }.
   */
  signTreeHead(root, size) {
    const sth = { log_id: this.logId, root, size, timestamp: new Date().toISOString() };
    return {
      ...sth,
      signature: signObject(sth, this.operatorKeyPair.secretKey),
      public_key: this.operatorKeyPair.publicKey,
    };
  }

  /**
   * Verify a signed tree head against the peer's pinned Ed25519 public key
   * (base64), never against the key the STH carries.
   */
  verifySignedTreeHead(sth, peerPublicKey) {
    if (!sth || typeof sth.size !== "number" || !sth.signature) {
      return { valid: false, error: "Malformed STH" };
    }

    const { log_id, root, size, timestamp } = sth;
    try {
      if (verifyObject({ log_id, root, size, timestamp }, sth.signature, peerPublicKey)) return { valid: true };
    } catch { /* malformed signature or key */ }
    return { valid: false, error: "Invalid STH signature" };
  }

  /**
   * Record a verified head of a pinned key and say whether it shows a split view:
   * the same log (key and exact log_id) with another root for a size already seen.
   * The local tree is only compared with this log's own heads (its key and LOG_ID),
   * at its current size, where an append-only tree has one root.
   */
  _observe(sth, publicKey, peerId, source) {
    const head = signedFields(sth);
    const key = canonicalKey(publicKey);
    if (this.operatorKeyPair && key === canonicalKey(this.operatorKeyPair.publicKey) && head.log_id === this.logId) {
      const local = this.getLocalSTH();
      if (head.size === local.size && head.root !== local.root) {
        return this._alert(signedFields(this.signTreeHead(local.root, local.size)), head, key, peerId, source);
      }
    }

    let logs = this.observed.get(key);
    if (!logs) this.observed.set(key, (logs = new Map()));
    let heads = logs.get(head.log_id);
    if (!heads) {
      if (logs.size >= MAX_LOGS_PER_KEY) return null;
      logs.set(head.log_id, (heads = new Map()));
    }
    const seen = heads.get(head.size);
    if (seen) return seen.root === head.root ? null : this._alert(seen, head, key, peerId, source);
    if (heads.size >= MAX_HEADS_PER_LOG) {
      const smallest = Math.min(...heads.keys());
      if (head.size < smallest) return null; // older than all we keep: no conclusion
      heads.delete(smallest);
    }
    heads.set(head.size, head);
    return null;
  }

  _alert(observed, conflicting, key, peerId, source) {
    const alert = {
      type: "split_view_detected",
      peer_id: peerId, // the alias the conflicting head came through
      peer_log_id: conflicting.log_id,
      peer_public_key: key,
      tree_size: conflicting.size,
      observed_root: observed.root,
      local_root: observed.root, // deprecated name of observed_root, kept for existing clients
      peer_root: conflicting.root,
      source,
      evidence: { observed: { ...observed }, conflicting: { ...conflicting } },
      detected_at: new Date().toISOString(),
    };
    // A static message: log_id and the alias come from other logs, so they stay inside the logged object.
    console.error("[SECURITY ALERT] Split view detected", alert);
    this.onInconsistency(alert);
    return alert;
  }

  /**
   * Fetch and verify the STH of a single peer, and check it against what this
   * log has observed of the same log.
   */
  async pollPeer(peerId) {
    const peer = this.peers.get(peerId);
    if (!peer) return;

    try {
      const resp = await fetch(`${peer.endpoint}/root/signed`, { signal: AbortSignal.timeout(this._pollTimeoutMs) });
      if (!resp.ok) {
        console.error(`[gossip] Failed to fetch STH from ${peerId}: HTTP ${resp.status}`);
        return;
      }

      const peerSTH = await readJsonLimited(resp, MAX_PEER_STH_BYTES);
      // Removed or reconfigured while this poll was in flight: its answer no longer counts.
      if (this.peers.get(peerId) !== peer) return;
      if (!peer.publicKey || !isWellFormedSTH(peerSTH) || !this.verifySignedTreeHead(peerSTH, peer.publicKey).valid) {
        console.error(`[gossip] Ignoring tree head from ${peerId}: no pinned key, malformed or bad signature`);
        return;
      }
      peer.lastSeen = new Date().toISOString();
      peer.lastSTH = peerSTH;
      return this._observe(peerSTH, peer.publicKey, peerId, "poll") ?? undefined;
    } catch (err) {
      console.error(`[gossip] Error polling peer ${peerId}: ${err.message}`);
    }
  }

  /**
   * Poll all peers once.
   */
  async pollAllPeers() {
    const results = [];
    for (const [peerId] of this.peers) {
      const result = await this.pollPeer(peerId);
      if (result) results.push(result);
    }
    return results;
  }

  /**
   * Start periodic gossip polling.
   * @param intervalMs — polling interval in milliseconds (default: 30 seconds)
   */
  startPolling(intervalMs = 30_000) {
    if (this._pollInterval) return;
    // A poll gives up after one interval (10 s at most), and a slow peer cannot stack them.
    this._pollTimeoutMs = Math.min(intervalMs, 10_000);
    let polling = false;
    this._pollInterval = setInterval(async () => {
      if (polling) return;
      polling = true;
      try { await this.pollAllPeers(); } finally { polling = false; }
    }, intervalMs);
    console.log(`[gossip] Started polling ${this.peers.size} peers every ${intervalMs}ms`);
  }

  stopPolling() {
    if (this._pollInterval) {
      clearInterval(this._pollInterval);
      this._pollInterval = null;
      console.log("[gossip] Stopped polling");
    }
  }

  /**
   * Handle a gossip exchange from a pinned peer, whose STH the caller has
   * validated and verified (isWellFormedSTH, findSigner). Return our STH.
   */
  handleExchange(peerSTH, peerId) {
    const localSTH = this.getLocalSTH();
    const signedLocalSTH = this.signTreeHead(localSTH.root, localSTH.size);
    const alert = this._observe(peerSTH, this.peers.get(peerId).publicKey, peerId, "exchange");
    return { sth: signedLocalSTH, alert };
  }

  _defaultInconsistencyHandler(alert) {
    console.error(`[gossip] INCONSISTENCY: ${JSON.stringify(alert)}`);
  }
}
