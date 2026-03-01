/**
 * DCP v2.0 Bundle Presentation Modes.
 *
 * Controls how much of a signed bundle is transmitted over the wire.
 * Lower tiers can use compact/reference modes to reduce bandwidth,
 * while elevated tiers always send the full bundle.
 *
 *  - **full**        — Complete bundle with all signatures (first contact / Tier 2-3)
 *  - **incremental** — Only delta since last verified bundle (established session)
 *  - **reference**   — Hash + verification endpoint only (pre-established trust)
 *  - **compact**     — Bundle with PQ signature omitted, reference to PQ checkpoint (Tier 0-1)
 */

import type { SignedBundleV2, BundleSignatureV2 } from '../types/v2.js';
import type { SecurityTier } from './security-tier.js';
import { sha256Hex } from './dual-hash.js';
import { canonicalizeV2 } from './canonicalize.js';

export type PresentationMode = 'full' | 'incremental' | 'reference' | 'compact';

// ── Presented bundle variants ──

export interface FullPresentation {
  mode: 'full';
  bundle: SignedBundleV2;
}

export interface IncrementalPresentation {
  mode: 'incremental';
  base_bundle_hash: string;
  delta: IncrementalDelta;
}

export interface IncrementalDelta {
  new_audit_entries: SignedBundleV2['bundle']['audit_entries'];
  new_pq_checkpoints?: SignedBundleV2['bundle']['pq_checkpoints'];
  updated_manifest: SignedBundleV2['bundle']['manifest'];
  signature: BundleSignatureV2;
}

export interface ReferencePresentation {
  mode: 'reference';
  bundle_hash: string;
  verification_endpoint: string;
  session_nonce: string;
}

export interface CompactPresentation {
  mode: 'compact';
  bundle: SignedBundleV2;
  pq_checkpoint_ref: string | null;
}

export type BundlePresentation =
  | FullPresentation
  | IncrementalPresentation
  | ReferencePresentation
  | CompactPresentation;

/**
 * Suggested presentation mode for a given security tier and session state.
 */
export function suggestPresentationMode(
  tier: SecurityTier,
  opts: { isFirstContact: boolean; hasTrustRelationship: boolean },
): PresentationMode {
  if (opts.isFirstContact) return 'full';

  if (tier === 'elevated' || tier === 'maximum') return 'full';

  if (opts.hasTrustRelationship && (tier === 'routine' || tier === 'standard')) {
    return 'reference';
  }

  if (tier === 'routine' || tier === 'standard') return 'compact';

  return 'full';
}

/**
 * Compute a deterministic hash of a signed bundle for use as reference.
 */
export function computeBundleHash(bundle: SignedBundleV2): string {
  const canonical = canonicalizeV2(bundle);
  return `sha256:${sha256Hex(Buffer.from(canonical, 'utf8'))}`;
}

/**
 * Present a signed bundle in **full** mode — no transformation.
 */
export function presentFull(bundle: SignedBundleV2): FullPresentation {
  return { mode: 'full', bundle };
}

/**
 * Present a signed bundle in **compact** mode — strips the PQ signature
 * from the bundle's composite signature and stores a reference to the
 * nearest PQ checkpoint instead.
 */
export function presentCompact(
  bundle: SignedBundleV2,
  pqCheckpointRef: string | null,
): CompactPresentation {
  const compactSig: BundleSignatureV2 = {
    ...bundle.signature,
    composite_sig: {
      classical: bundle.signature.composite_sig.classical,
      pq: null,
      binding: 'classical_only',
    },
  };

  return {
    mode: 'compact',
    bundle: { bundle: bundle.bundle, signature: compactSig },
    pq_checkpoint_ref: pqCheckpointRef,
  };
}

/**
 * Present a signed bundle as a **reference** — only the hash and an endpoint
 * where the full bundle can be verified or retrieved.
 */
export function presentReference(
  bundle: SignedBundleV2,
  verificationEndpoint: string,
): ReferencePresentation {
  return {
    mode: 'reference',
    bundle_hash: computeBundleHash(bundle),
    verification_endpoint: verificationEndpoint,
    session_nonce: bundle.bundle.manifest.session_nonce,
  };
}

/**
 * Present an **incremental** update relative to a previously verified
 * base bundle. Includes only new audit entries, new PQ checkpoints,
 * the updated manifest, and a fresh signature over it.
 */
export function presentIncremental(
  baseBundle: SignedBundleV2,
  updatedBundle: SignedBundleV2,
  baseAuditCount: number,
): IncrementalPresentation {
  const baseBundleHash = computeBundleHash(baseBundle);
  const allAudit = updatedBundle.bundle.audit_entries;
  const newAuditEntries = allAudit.slice(baseAuditCount);

  return {
    mode: 'incremental',
    base_bundle_hash: baseBundleHash,
    delta: {
      new_audit_entries: newAuditEntries,
      new_pq_checkpoints: updatedBundle.bundle.pq_checkpoints,
      updated_manifest: updatedBundle.bundle.manifest,
      signature: updatedBundle.signature,
    },
  };
}
