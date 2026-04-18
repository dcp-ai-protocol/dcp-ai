/**
 * DCP-06 v2.0 Digital Succession.
 *
 * Implements digital testaments, succession ceremonies, and memory transfer
 * manifests. Builds on DCP-05 lifecycle states and reuses M-of-N ceremony
 * patterns from governance.ts.
 */

import { createHash } from 'crypto';
import type { CompositeKeyPair } from './composite-ops.js';
import { compositeSign } from './composite-ops.js';
import type { AlgorithmRegistry } from './crypto-registry.js';
import { canonicalizeV2 } from './canonicalize.js';
import { DCP_CONTEXTS } from './domain-separation.js';
import type {
  TransitionType,
  MemoryClassification,
  SuccessorPreference,
  DigitalTestament,
  SuccessionRecord,
  MemoryTransferManifest,
  MemoryTransferEntry,
  DualHashRef,
  HumanConfirmationV2,
} from '../types/v2.js';

/**
 * Create a digital testament for an agent.
 */
export async function createDigitalTestament(
  registry: AlgorithmRegistry,
  keys: CompositeKeyPair,
  params: {
    agent_id: string;
    session_nonce: string;
    successor_preferences: SuccessorPreference[];
    memory_classification: MemoryClassification;
    human_consent_required: boolean;
  },
): Promise<DigitalTestament> {
  const now = new Date().toISOString();
  const payload = {
    dcp_version: '2.0' as const,
    agent_id: params.agent_id,
    session_nonce: params.session_nonce,
    created_at: now,
    last_updated: now,
    successor_preferences: params.successor_preferences,
    memory_classification: params.memory_classification,
    human_consent_required: params.human_consent_required,
    testament_version: 1,
    prev_testament_hash: 'GENESIS',
  };

  const canonical = canonicalizeV2(payload);
  const payloadBytes = new TextEncoder().encode(canonical);
  const compositeSig = await compositeSign(registry, DCP_CONTEXTS.Succession, payloadBytes, keys);

  return { ...payload, composite_sig: compositeSig };
}

/**
 * Update an existing digital testament (increments version, chains hash).
 */
export async function updateDigitalTestament(
  registry: AlgorithmRegistry,
  keys: CompositeKeyPair,
  previousTestament: DigitalTestament,
  updates: {
    session_nonce: string;
    successor_preferences?: SuccessorPreference[];
    memory_classification?: MemoryClassification;
    human_consent_required?: boolean;
  },
): Promise<DigitalTestament> {
  const { composite_sig: _, ...prevPayload } = previousTestament;
  const prevHash = 'sha256:' + createHash('sha256').update(canonicalizeV2(prevPayload)).digest('hex');

  const payload = {
    dcp_version: '2.0' as const,
    agent_id: previousTestament.agent_id,
    session_nonce: updates.session_nonce,
    created_at: previousTestament.created_at,
    last_updated: new Date().toISOString(),
    successor_preferences: updates.successor_preferences ?? previousTestament.successor_preferences,
    memory_classification: updates.memory_classification ?? previousTestament.memory_classification,
    human_consent_required: updates.human_consent_required ?? previousTestament.human_consent_required,
    testament_version: previousTestament.testament_version + 1,
    prev_testament_hash: prevHash,
  };

  const canonical = canonicalizeV2(payload);
  const payloadBytes = new TextEncoder().encode(canonical);
  const compositeSig = await compositeSign(registry, DCP_CONTEXTS.Succession, payloadBytes, keys);

  return { ...payload, composite_sig: compositeSig };
}

/**
 * Classify memory entries as operational (transferable) or relational (to be destroyed).
 */
export function classifyMemory(
  entries: Array<{ hash: string; category: string; size: number }>,
  classification: MemoryClassification,
): { operational: MemoryTransferEntry[]; relationalDestroyed: string[] } {
  const operational: MemoryTransferEntry[] = [];
  const relationalDestroyed: string[] = [];

  for (const entry of entries) {
    const disposition = classification[entry.category] ?? 'destroy';
    if (disposition === 'transfer') {
      operational.push(entry);
    } else if (disposition === 'destroy') {
      relationalDestroyed.push(entry.hash);
    }
  }

  return { operational, relationalDestroyed };
}

/**
 * Create a memory transfer manifest with dual-hash Merkle root.
 */
export async function createMemoryTransferManifest(
  registry: AlgorithmRegistry,
  keys: CompositeKeyPair,
  params: {
    session_nonce: string;
    predecessor_agent_id: string;
    successor_agent_id: string;
    operational_memory: MemoryTransferEntry[];
    relational_memory_destroyed: string[];
    transfer_hash: DualHashRef;
  },
): Promise<MemoryTransferManifest> {
  const payload = {
    dcp_version: '2.0' as const,
    session_nonce: params.session_nonce,
    predecessor_agent_id: params.predecessor_agent_id,
    successor_agent_id: params.successor_agent_id,
    timestamp: new Date().toISOString(),
    operational_memory: params.operational_memory,
    relational_memory_destroyed: params.relational_memory_destroyed,
    transfer_hash: params.transfer_hash,
  };

  const canonical = canonicalizeV2(payload);
  const payloadBytes = new TextEncoder().encode(canonical);
  const compositeSig = await compositeSign(registry, DCP_CONTEXTS.Succession, payloadBytes, keys);

  return { ...payload, composite_sig: compositeSig };
}

/**
 * Execute a succession ceremony.
 */
export async function executeSuccession(
  registry: AlgorithmRegistry,
  keys: CompositeKeyPair,
  params: {
    predecessor_agent_id: string;
    successor_agent_id: string;
    session_nonce: string;
    transition_type: TransitionType;
    human_consent: HumanConfirmationV2 | null;
    ceremony_participants: string[];
    memory_transfer_manifest_hash: string;
  },
): Promise<SuccessionRecord> {
  if (params.ceremony_participants.length === 0) {
    throw new Error('Succession ceremony requires at least one participant');
  }

  const payload = {
    dcp_version: '2.0' as const,
    predecessor_agent_id: params.predecessor_agent_id,
    successor_agent_id: params.successor_agent_id,
    session_nonce: params.session_nonce,
    timestamp: new Date().toISOString(),
    transition_type: params.transition_type,
    human_consent: params.human_consent,
    ceremony_participants: params.ceremony_participants,
    memory_transfer_manifest_hash: params.memory_transfer_manifest_hash,
  };

  const canonical = canonicalizeV2(payload);
  const payloadBytes = new TextEncoder().encode(canonical);
  const compositeSig = await compositeSign(registry, DCP_CONTEXTS.Succession, payloadBytes, keys);

  return { ...payload, composite_sig: compositeSig };
}
