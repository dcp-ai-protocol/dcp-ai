/**
 * DCP v2.0 Lazy PQ Checkpoint model.
 *
 * Each audit event is signed with Ed25519 only (microsecond-scale). Every N
 * events, a PQ checkpoint is produced: a composite signature over the Merkle
 * root of the batch. This gives real-time classical security with periodic
 * PQ assurance, reducing PQ signature count by the checkpoint interval factor.
 */

import { randomUUID } from 'crypto';
import type { PQCheckpoint, AuditEventV2 } from '../types/v2.js';
import type { CompositeKeyPair } from './composite-ops.js';
import { compositeSign } from './composite-ops.js';
import { AlgorithmRegistry } from './crypto-registry.js';
import { DCP_CONTEXTS } from './domain-separation.js';
import { sha256Hex } from './dual-hash.js';
import { canonicalizeV2 } from './canonicalize.js';
import type { SecurityTier } from './security-tier.js';
import { tierToCheckpointInterval } from './security-tier.js';

/**
 * Compute a Merkle root from audit event payloads (SHA-256).
 * Each leaf is sha256(canonicalize(event)).
 */
export function auditEventsMerkleRoot(events: AuditEventV2[]): string {
  if (events.length === 0) {
    throw new Error('Cannot compute Merkle root of empty event list');
  }

  let leaves = events.map((e) => {
    const canonical = canonicalizeV2(e);
    return sha256Hex(Buffer.from(canonical, 'utf8'));
  });

  while (leaves.length > 1) {
    if (leaves.length % 2 === 1) leaves.push(leaves[leaves.length - 1]);
    const next: string[] = [];
    for (let i = 0; i < leaves.length; i += 2) {
      const combined = Buffer.concat([
        Buffer.from(leaves[i], 'hex'),
        Buffer.from(leaves[i + 1], 'hex'),
      ]);
      next.push(sha256Hex(combined));
    }
    leaves = next;
  }

  return leaves[0];
}

/**
 * Create a PQ checkpoint for a batch of audit events.
 *
 * @param registry - Algorithm registry with registered providers
 * @param events - The batch of audit events to checkpoint
 * @param sessionNonce - The session nonce shared by all events
 * @param keys - Classical + PQ keypair for composite signing
 * @returns A signed PQCheckpoint
 */
export async function createPQCheckpoint(
  registry: AlgorithmRegistry,
  events: AuditEventV2[],
  sessionNonce: string,
  keys: CompositeKeyPair,
): Promise<PQCheckpoint> {
  if (events.length === 0) {
    throw new Error('Cannot create checkpoint for empty event list');
  }

  const merkleRoot = auditEventsMerkleRoot(events);
  const checkpointId = `ckpt-${randomUUID()}`;

  const checkpointPayload = {
    checkpoint_id: checkpointId,
    session_nonce: sessionNonce,
    event_range: {
      from_audit_id: events[0].audit_id,
      to_audit_id: events[events.length - 1].audit_id,
      count: events.length,
    },
    merkle_root: `sha256:${merkleRoot}`,
  };

  const canonical = canonicalizeV2(checkpointPayload);
  const payloadBytes = new TextEncoder().encode(canonical);

  const compositeSig = await compositeSign(
    registry,
    DCP_CONTEXTS.AuditEvent,
    payloadBytes,
    keys,
  );

  return {
    ...checkpointPayload,
    composite_sig: compositeSig,
  };
}

/**
 * Manager for tracking audit events and producing PQ checkpoints at
 * configurable intervals.
 *
 * The interval can be set explicitly or derived from a {@link SecurityTier}.
 * When a tier is provided without an explicit interval, the interval is
 * computed via {@link tierToCheckpointInterval}.
 */
export class PQCheckpointManager {
  private pendingEvents: AuditEventV2[] = [];
  private checkpoints: PQCheckpoint[] = [];
  private _interval: number;
  private _tier: SecurityTier | undefined;

  constructor(
    interval: number,
    private readonly registry: AlgorithmRegistry,
    private readonly sessionNonce: string,
    private readonly keys: CompositeKeyPair,
    tier?: SecurityTier,
  ) {
    if (tier !== undefined) {
      this._tier = tier;
      this._interval = tierToCheckpointInterval(tier);
    } else {
      this._interval = interval;
    }
    if (this._interval < 1) throw new Error('Checkpoint interval must be >= 1');
  }

  /** Current checkpoint interval. */
  get interval(): number {
    return this._interval;
  }

  /** Current security tier (undefined if constructed with explicit interval). */
  get tier(): SecurityTier | undefined {
    return this._tier;
  }

  /**
   * Update the security tier at runtime, recalculating the checkpoint interval.
   * Pending events are not flushed — call {@link flush} first if needed.
   */
  setTier(tier: SecurityTier): void {
    this._tier = tier;
    this._interval = tierToCheckpointInterval(tier);
  }

  /**
   * Record an audit event. If the pending count reaches the checkpoint
   * interval, a PQ checkpoint is automatically produced and returned.
   */
  async recordEvent(event: AuditEventV2): Promise<PQCheckpoint | null> {
    this.pendingEvents.push(event);
    if (this.pendingEvents.length >= this._interval) {
      return this.flush();
    }
    return null;
  }

  /**
   * Force a PQ checkpoint over all pending events (e.g. at session end).
   * Returns null if no events are pending.
   */
  async flush(): Promise<PQCheckpoint | null> {
    if (this.pendingEvents.length === 0) return null;

    const checkpoint = await createPQCheckpoint(
      this.registry,
      this.pendingEvents,
      this.sessionNonce,
      this.keys,
    );

    this.checkpoints.push(checkpoint);
    this.pendingEvents = [];
    return checkpoint;
  }

  /** Get all checkpoints produced so far. */
  getCheckpoints(): PQCheckpoint[] {
    return [...this.checkpoints];
  }

  /** Get the count of pending (un-checkpointed) events. */
  getPendingCount(): number {
    return this.pendingEvents.length;
  }
}
