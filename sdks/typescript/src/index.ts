/**
 * @dcp-ai/sdk — TypeScript SDK for the Digital Citizenship Protocol
 *
 * Public API:
 *  - Types for all DCP artifacts
 *  - Crypto: keypair generation, signing, verification
 *  - Merkle: hashing, Merkle trees, intent/prev hash
 *  - Schema: validation against DCP JSON Schemas
 *  - Verify: full signed bundle verification
 *  - Builder: fluent bundle construction
 *  - Signer: bundle signing
 */

// Types
export type {
  HumanBindingRecord,
  AgentPassport,
  Intent,
  IntentTarget,
  PolicyDecision,
  AuditEntry,
  AuditEvidence,
  CitizenshipBundle,
  SignedBundle,
  BundleSignature,
  Signer,
  RevocationRecord,
  HumanConfirmation,
  ValidationResult,
  VerificationResult,
  Keypair,
  EntityType,
  LiabilityMode,
  Capability,
  RiskTier,
  AgentStatus,
  ActionType,
  Channel,
  DataClass,
  Impact,
  PolicyDecisionType,
  AuditPolicyDecision,
  SignerType,
  ConfirmationDecision,
} from './types/index.js';

// Crypto
export {
  canonicalize,
  generateKeypair,
  publicKeyFromSecret,
  signObject,
  verifyObject,
} from './core/crypto.js';

// Merkle / Hashing
export {
  hashObject,
  merkleRootFromHexLeaves,
  merkleRootForAuditEntries,
  intentHash,
  prevHashForEntry,
} from './core/merkle.js';

// Schema Validation
export { validateSchema, validateBundle } from './core/schema.js';

// Verification
export { verifySignedBundle } from './core/verify.js';

// Bundle Builder
export { BundleBuilder } from './bundle/builder.js';

// Bundle Signer
export { signBundle } from './bundle/signer.js';
export type { SignOptions } from './bundle/signer.js';
