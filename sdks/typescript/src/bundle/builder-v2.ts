/**
 * DCP v2.0 Bundle Builder — constructs CitizenshipBundleV2 with manifest.
 *
 * The manifest cryptographically binds all artifact hashes. The bundle-level
 * composite signature signs the manifest, not the entire bundle.
 */

import type {
  AgentPassportV2,
  ResponsiblePrincipalRecordV2,
  BlindedResponsiblePrincipalRecordV2,
  IntentV2,
  PolicyDecisionV2,
  AuditEventV2,
  PQCheckpoint,
  BundleManifest,
  CitizenshipBundleV2,
  SignedPayload,
} from '../types/v2.js';
import { canonicalizeV2 } from '../core/canonicalize.js';
import { sha256Hex, sha3_256Hex } from '../core/dual-hash.js';
import { verifySessionBinding } from '../core/session-nonce.js';

type RprPayload = ResponsiblePrincipalRecordV2 | BlindedResponsiblePrincipalRecordV2;

function payloadHash(payload: unknown): string {
  const canonical = canonicalizeV2(payload);
  return `sha256:${sha256Hex(Buffer.from(canonical, 'utf8'))}`;
}

function auditMerkleRoot(entries: AuditEventV2[], hashFn: (data: string | Buffer) => string): string {
  let leaves = entries.map((e) => {
    const canonical = canonicalizeV2(e);
    return hashFn(Buffer.from(canonical, 'utf8'));
  });

  while (leaves.length > 1) {
    if (leaves.length % 2 === 1) leaves.push(leaves[leaves.length - 1]);
    const next: string[] = [];
    for (let i = 0; i < leaves.length; i += 2) {
      next.push(hashFn(Buffer.concat([
        Buffer.from(leaves[i], 'hex'),
        Buffer.from(leaves[i + 1], 'hex'),
      ])));
    }
    leaves = next;
  }

  return leaves[0];
}

/**
 * Fluent builder for V2 Citizenship Bundles.
 *
 * Usage:
 *   const bundle = new BundleBuilderV2(sessionNonce)
 *     .responsiblePrincipalRecord(signedRpr)
 *     .agentPassport(signedPassport)
 *     .intent(signedIntent)
 *     .policyDecision(signedPolicy)
 *     .addAuditEntries(events)
 *     .addPQCheckpoints(checkpoints)
 *     .build();
 */
export class BundleBuilderV2 {
  private _rpr?: SignedPayload<RprPayload>;
  private _passport?: SignedPayload<AgentPassportV2>;
  private _intent?: SignedPayload<IntentV2>;
  private _policy?: SignedPayload<PolicyDecisionV2>;
  private _auditEntries: AuditEventV2[] = [];
  private _pqCheckpoints: PQCheckpoint[] = [];
  private _dualHash = false;

  constructor(private readonly sessionNonce: string) {}

  responsiblePrincipalRecord(rpr: SignedPayload<RprPayload>): this {
    this._rpr = rpr;
    return this;
  }

  agentPassport(passport: SignedPayload<AgentPassportV2>): this {
    this._passport = passport;
    return this;
  }

  intent(intent: SignedPayload<IntentV2>): this {
    this._intent = intent;
    return this;
  }

  policyDecision(policy: SignedPayload<PolicyDecisionV2>): this {
    this._policy = policy;
    return this;
  }

  addAuditEntry(entry: AuditEventV2): this {
    this._auditEntries.push(entry);
    return this;
  }

  addAuditEntries(entries: AuditEventV2[]): this {
    this._auditEntries.push(...entries);
    return this;
  }

  addPQCheckpoint(checkpoint: PQCheckpoint): this {
    this._pqCheckpoints.push(checkpoint);
    return this;
  }

  addPQCheckpoints(checkpoints: PQCheckpoint[]): this {
    this._pqCheckpoints.push(...checkpoints);
    return this;
  }

  enableDualHash(): this {
    this._dualHash = true;
    return this;
  }

  /**
   * Build the CitizenshipBundleV2 with computed manifest.
   * Validates session nonce consistency across all artifacts.
   */
  build(): CitizenshipBundleV2 {
    if (!this._rpr) throw new Error('Missing responsible_principal_record');
    if (!this._passport) throw new Error('Missing agent_passport');
    if (!this._intent) throw new Error('Missing intent');
    if (!this._policy) throw new Error('Missing policy_decision');
    if (this._auditEntries.length === 0) throw new Error('At least one audit entry is required');

    this.validateSessionNonces();

    const manifest = this.computeManifest();

    const bundle: CitizenshipBundleV2 = {
      dcp_bundle_version: '2.0',
      manifest,
      responsible_principal_record: this._rpr,
      agent_passport: this._passport,
      intent: this._intent,
      policy_decision: this._policy,
      audit_entries: this._auditEntries,
    };

    if (this._pqCheckpoints.length > 0) {
      bundle.pq_checkpoints = this._pqCheckpoints;
    }

    return bundle;
  }

  private validateSessionNonces(): void {
    const artifacts: Array<{ session_nonce?: string }> = [];

    const rprPayload = this._rpr!.payload;
    artifacts.push(rprPayload);
    artifacts.push(this._passport!.payload);
    artifacts.push(this._intent!.payload);
    artifacts.push(this._policy!.payload);

    for (const entry of this._auditEntries) {
      artifacts.push(entry);
    }
    for (const ckpt of this._pqCheckpoints) {
      artifacts.push(ckpt);
    }

    const result = verifySessionBinding(artifacts);
    if (!result.valid) {
      throw new Error(`Session nonce validation failed: ${result.error}`);
    }
    if (result.nonce !== this.sessionNonce) {
      throw new Error(
        `Session nonce mismatch: builder=${this.sessionNonce}, artifacts=${result.nonce}`,
      );
    }
  }

  private computeManifest(): BundleManifest {
    const rprHash = payloadHash(this._rpr!.payload);
    const passportHash = payloadHash(this._passport!.payload);
    const intentHash = payloadHash(this._intent!.payload);
    const policyHash = payloadHash(this._policy!.payload);

    const sha256Root = auditMerkleRoot(this._auditEntries, sha256Hex);

    const manifest: BundleManifest = {
      session_nonce: this.sessionNonce,
      rpr_hash: rprHash,
      passport_hash: passportHash,
      intent_hash: intentHash,
      policy_hash: policyHash,
      audit_merkle_root: `sha256:${sha256Root}`,
      audit_count: this._auditEntries.length,
    };

    if (this._dualHash) {
      const sha3Root = auditMerkleRoot(this._auditEntries, sha3_256Hex);
      manifest.audit_merkle_root_secondary = `sha3-256:${sha3Root}`;
    }

    if (this._pqCheckpoints.length > 0) {
      manifest.pq_checkpoints = this._pqCheckpoints.map((c) => c.checkpoint_id);
    }

    return manifest;
  }
}
