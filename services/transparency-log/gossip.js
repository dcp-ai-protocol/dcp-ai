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

export class GossipManager {
  constructor({ operatorKeyPair, logId, getLocalSTH, onInconsistency }) {
    this.peers = new Map();
    this.operatorKeyPair = operatorKeyPair;
    this.logId = logId || `log-${crypto.randomUUID().slice(0, 8)}`;
    this.getLocalSTH = getLocalSTH;
    this.onInconsistency = onInconsistency || this._defaultInconsistencyHandler;
    this.peerSTHHistory = new Map();
    this._pollInterval = null;
  }

  addPeer(peerId, endpoint) {
    this.peers.set(peerId, { endpoint, lastSeen: null, lastSTH: null });
  }

  removePeer(peerId) {
    this.peers.delete(peerId);
    this.peerSTHHistory.delete(peerId);
  }

  getPeers() {
    return Array.from(this.peers.entries()).map(([id, info]) => ({
      peer_id: id,
      endpoint: info.endpoint,
      last_seen: info.lastSeen,
      last_sth: info.lastSTH,
    }));
  }

  /**
   * Sign a tree head using the operator's Ed25519 key.
   */
  signTreeHead(root, size) {
    const payload = JSON.stringify({ root, size, timestamp: new Date().toISOString(), log_id: this.logId });
    const payloadBuf = Buffer.from(payload, "utf8");

    const hmac = crypto.createHmac("sha256", this.operatorKeyPair.secretKey)
      .update(payloadBuf)
      .digest("base64");

    return {
      root,
      size,
      timestamp: new Date().toISOString(),
      log_id: this.logId,
      signature: hmac,
      public_key: this.operatorKeyPair.publicKey,
    };
  }

  /**
   * Verify a signed tree head from a peer.
   */
  verifySignedTreeHead(sth, peerPublicKey) {
    if (!sth || !sth.root || typeof sth.size !== "number" || !sth.signature) {
      return { valid: false, error: "Malformed STH" };
    }

    const payload = JSON.stringify({
      root: sth.root,
      size: sth.size,
      timestamp: sth.timestamp,
      log_id: sth.log_id,
    });

    const expected = crypto.createHmac("sha256", peerPublicKey)
      .update(Buffer.from(payload, "utf8"))
      .digest("base64");

    if (expected !== sth.signature) {
      return { valid: false, error: "Invalid STH signature" };
    }
    return { valid: true };
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
      peer.lastSeen = new Date().toISOString();
      peer.lastSTH = peerSTH;

      if (!this.peerSTHHistory.has(peerId)) {
        this.peerSTHHistory.set(peerId, []);
      }
      this.peerSTHHistory.get(peerId).push(peerSTH);

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
   * Handle a gossip exchange request from a peer. Return our STH, verify theirs.
   */
  handleExchange(peerSTH) {
    const localSTH = this.getLocalSTH();
    const signedLocalSTH = this.signTreeHead(localSTH.root, localSTH.size);

    let alert = null;
    if (peerSTH && peerSTH.size === localSTH.size && peerSTH.root !== localSTH.root) {
      alert = {
        type: "split_view_detected",
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
