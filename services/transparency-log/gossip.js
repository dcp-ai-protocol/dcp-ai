/**
 * DCP Transparency Log — Gossip Protocol Manager
 *
 * Implements cross-log Signed Tree Head (STH) verification to detect
 * split-view attacks. Periodically polls peer logs and compares roots
 * for consistency.
 *
 * A divergence (different root for the same tree size) indicates a
 * split-view attack — the operator is presenting different views to
 * different clients.
 */

import crypto from "crypto";
import { signObject, verifyObject } from "../../tools/crypto.js";

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
  }

  /**
   * @param publicKey - the peer's pinned Ed25519 public key (base64). Without it
   *   the peer's tree heads cannot be verified and are ignored.
   */
  addPeer(peerId, endpoint, publicKey = null) {
    this.peers.set(peerId, { endpoint, publicKey, lastSeen: null, lastSTH: null });
  }

  removePeer(peerId) {
    this.peers.delete(peerId);
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
   * Fetch and verify STH from a single peer. Detect split-view if roots differ
   * for the same tree size.
   */
  async pollPeer(peerId) {
    const peer = this.peers.get(peerId);
    if (!peer) return;

    try {
      const resp = await fetch(`${peer.endpoint}/root/signed`);
      if (!resp.ok) {
        console.error(`[gossip] Failed to fetch STH from ${peerId}: HTTP ${resp.status}`);
        return;
      }

      const peerSTH = await resp.json();
      if (!peer.publicKey || !isWellFormedSTH(peerSTH) || !this.verifySignedTreeHead(peerSTH, peer.publicKey).valid) {
        console.error(`[gossip] Ignoring tree head from ${peerId}: no pinned key, malformed or bad signature`);
        return;
      }
      peer.lastSeen = new Date().toISOString();
      peer.lastSTH = peerSTH;

      const localSTH = this.getLocalSTH();

      if (peerSTH.size === localSTH.size && peerSTH.root !== localSTH.root) {
        const alert = {
          type: "split_view_detected",
          peer_id: peerId,
          local_root: localSTH.root,
          peer_root: peerSTH.root,
          tree_size: peerSTH.size,
          detected_at: new Date().toISOString(),
        };
        console.error(`[SECURITY ALERT] Split-view detected with peer ${peerId}!`, alert);
        this.onInconsistency(alert);
        return alert;
      }

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
    this._pollInterval = setInterval(() => this.pollAllPeers(), intervalMs);
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

    let alert = null;
    if (peerSTH.size === localSTH.size && peerSTH.root !== localSTH.root) {
      alert = {
        type: "split_view_detected",
        peer_id: peerId,
        peer_log_id: peerSTH.log_id,
        local_root: localSTH.root,
        peer_root: peerSTH.root,
        tree_size: peerSTH.size,
        detected_at: new Date().toISOString(),
      };
      console.error(`[SECURITY ALERT] Split-view detected in exchange!`, alert);
      this.onInconsistency(alert);
    }

    return { sth: signedLocalSTH, alert };
  }

  _defaultInconsistencyHandler(alert) {
    console.error(`[gossip] INCONSISTENCY: ${JSON.stringify(alert)}`);
  }
}
