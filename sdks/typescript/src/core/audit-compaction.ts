/**
 * DCP v2.0 Audit Trail Compaction.
 *
 * For long-running agents (thousands of events), the audit chain grows
 * unboundedly. Compaction produces signed checkpoints that summarise a
 * range of events. Compacted events may be archived to cold storage;
 * the next audit event chains from the compaction checkpoint instead
 * of the last individual event.
 */

import { randomUUID } from 'crypto';
import type { AuditEventV2, AuditCompaction } from '../types/v2.js';
import type { CompositeKeyPair } from './composite-ops.js';
import { compositeSign } from './composite-ops.js';
import { AlgorithmRegistry } from './crypto-registry.js';
import { DCP_CONTEXTS } from './domain-separation.js';
import { sha256Hex } from './dual-hash.js';
import { canonicalizeV2 } from './canonicalize.js';
import { auditEventsMerkleRoot } from './pq-checkpoint.js';

export interface CompactionResult {
  compaction: AuditCompaction;
  archivedEventIds: string[];
  nextPrevHash: string;
}

/**
 * Create a compaction checkpoint for a range of audit events.
 *
 * After compaction, the compacted events can be archived. The next
 * audit event's prev_hash should reference the compaction's own hash
 * (returned as `nextPrevHash`).
 */
export async function createAuditCompaction(
  registry: AlgorithmRegistry,
  events: AuditEventV2[],
  sessionNonce: string,
  keys: CompositeKeyPair,
): Promise<CompactionResult> {
  if (events.length === 0) {
    throw new Error('Cannot compact an empty event list');
  }

  const merkleRoot = auditEventsMerkleRoot(events);
  const lastEvent = events[events.length - 1];
  const lastEventCanonical = canonicalizeV2(lastEvent);
  const lastEventHash = `sha256:${sha256Hex(Buffer.from(lastEventCanonical, 'utf8'))}`;

  const compactionPayload = {
    type: 'audit_compaction' as const,
    session_nonce: sessionNonce,
    range: {
      from: events[0].audit_id,
      to: lastEvent.audit_id,
      count: events.length,
    },
    merkle_root: `sha256:${merkleRoot}`,
    prev_hash: lastEventHash,
    timestamp: new Date().toISOString(),
  };

  const canonical = canonicalizeV2(compactionPayload);
  const payloadBytes = new TextEncoder().encode(canonical);

  const compositeSig = await compositeSign(
    registry,
    DCP_CONTEXTS.AuditEvent,
    payloadBytes,
    keys,
  );

  const compaction: AuditCompaction = {
    ...compactionPayload,
    composite_sig: compositeSig,
  };

  const compactionCanonical = canonicalizeV2(compaction);
  const nextPrevHash = `sha256:${sha256Hex(Buffer.from(compactionCanonical, 'utf8'))}`;

  return {
    compaction,
    archivedEventIds: events.map((e) => e.audit_id),
    nextPrevHash,
  };
}

/**
 * Manager for automatic audit trail compaction at configurable intervals.
 */
export class AuditCompactionManager {
  private activeEvents: AuditEventV2[] = [];
  private compactions: AuditCompaction[] = [];
  private _nextPrevHash: string | null = null;

  constructor(
    private readonly compactionThreshold: number,
    private readonly registry: AlgorithmRegistry,
    private readonly sessionNonce: string,
    private readonly keys: CompositeKeyPair,
  ) {
    if (compactionThreshold < 2) {
      throw new Error('Compaction threshold must be >= 2');
    }
  }

  /**
   * Record an audit event. If the event count reaches the compaction
   * threshold, a compaction checkpoint is automatically produced.
   *
   * Returns the compaction result if one was produced, null otherwise.
   */
  async recordEvent(event: AuditEventV2): Promise<CompactionResult | null> {
    this.activeEvents.push(event);
    if (this.activeEvents.length >= this.compactionThreshold) {
      return this.compact();
    }
    return null;
  }

  /**
   * Force compaction of all active events. Returns null if fewer than 2
   * events are pending (compaction of a single event is wasteful).
   */
  async compact(): Promise<CompactionResult | null> {
    if (this.activeEvents.length < 2) return null;

    const result = await createAuditCompaction(
      this.registry,
      this.activeEvents,
      this.sessionNonce,
      this.keys,
    );

    this.compactions.push(result.compaction);
    this._nextPrevHash = result.nextPrevHash;
    this.activeEvents = [];
    return result;
  }

  /**
   * The prev_hash that the next audit event should use after compaction.
   * Returns null if no compaction has occurred yet.
   */
  getNextPrevHash(): string | null {
    return this._nextPrevHash;
  }

  getCompactions(): AuditCompaction[] {
    return [...this.compactions];
  }

  getActiveEventCount(): number {
    return this.activeEvents.length;
  }
}
