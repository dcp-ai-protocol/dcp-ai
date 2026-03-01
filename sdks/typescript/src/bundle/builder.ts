/**
 * Builder pattern for constructing DCP Citizenship Bundles.
 */
import type {
  CitizenshipBundle,
  ResponsiblePrincipalRecord,
  AgentPassport,
  Intent,
  PolicyDecision,
  AuditEntry,
} from '../types/index.js';
import { hashObject, intentHash } from '../core/merkle.js';

export class BundleBuilder {
  private _rpr?: ResponsiblePrincipalRecord;
  private _passport?: AgentPassport;
  private _intent?: Intent;
  private _policy?: PolicyDecision;
  private _auditEntries: AuditEntry[] = [];

  /** Set the Responsible Principal Record (DCP-01). */
  responsiblePrincipalRecord(rpr: ResponsiblePrincipalRecord): this {
    this._rpr = rpr;
    return this;
  }

  /** Set the Agent Passport (DCP-01). */
  agentPassport(passport: AgentPassport): this {
    this._passport = passport;
    return this;
  }

  /** Set the Intent declaration (DCP-02). */
  intent(intent: Intent): this {
    this._intent = intent;
    return this;
  }

  /** Set the Policy Decision (DCP-02). */
  policyDecision(policy: PolicyDecision): this {
    this._policy = policy;
    return this;
  }

  /** Add a pre-built audit entry. */
  addAuditEntry(entry: AuditEntry): this {
    this._auditEntries.push(entry);
    return this;
  }

  /**
   * Create a new audit entry with correct intent_hash and prev_hash chaining.
   * Automatically computes intent_hash from the intent and prev_hash from the chain.
   */
  createAuditEntry(
    fields: Omit<AuditEntry, 'intent_hash' | 'prev_hash'>,
  ): this {
    if (!this._intent) throw new Error('Intent must be set before creating audit entries');

    const iHash = intentHash(this._intent);
    const prevHash =
      this._auditEntries.length === 0
        ? 'GENESIS'
        : hashObject(this._auditEntries[this._auditEntries.length - 1]);

    this._auditEntries.push({
      ...fields,
      intent_hash: iHash,
      prev_hash: prevHash,
    });
    return this;
  }

  /** Build the Citizenship Bundle. Throws if any required artifact is missing. */
  build(): CitizenshipBundle {
    if (!this._rpr) throw new Error('Missing responsible_principal_record');
    if (!this._passport) throw new Error('Missing agent_passport');
    if (!this._intent) throw new Error('Missing intent');
    if (!this._policy) throw new Error('Missing policy_decision');
    if (this._auditEntries.length === 0) throw new Error('At least one audit entry is required');

    return {
      responsible_principal_record: this._rpr,
      agent_passport: this._passport,
      intent: this._intent,
      policy_decision: this._policy,
      audit_entries: this._auditEntries,
    };
  }
}
