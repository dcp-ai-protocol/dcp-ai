/**
 * @dcp-ai/sdk — TypeScript SDK for the Digital Citizenship Protocol
 *
 * Public API:
 *  - V1 Types for all DCP artifacts
 *  - V2 Types for post-quantum upgraded artifacts
 *  - Crypto: keypair generation, signing, verification
 *  - CryptoProvider: algorithm-agile signing interface
 *  - Merkle: hashing, Merkle trees, intent/prev hash
 *  - Schema: validation against DCP JSON Schemas
 *  - Verify: full signed bundle verification
 *  - Builder: fluent bundle construction
 *  - Signer: bundle signing
 */

// ── V1 Types ──
export type {
  ResponsiblePrincipalRecord,
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

// ── V2 Types ──
export type {
  AgentPassportV2,
  ResponsiblePrincipalRecordV2,
  BlindedResponsiblePrincipalRecordV2,
  IntentV2,
  IntentTargetV2,
  PolicyDecisionV2,
  AuditEventV2,
  AuditEvidenceV2,
  PQCheckpoint,
  BundleManifest,
  BundleSignerV2,
  BundleSignatureV2,
  CitizenshipBundleV2,
  SignedBundleV2,
  VerifierPolicy,
  DcpCapabilities,
  VerificationMode,
  SignedPayload,
  CompositeSignature,
  SignatureEntry,
  BindingMode,
  KeyEntry,
  DualHash,
  // Gap #3: Jurisdiction Attestation & Human Confirmation
  JurisdictionAttestationV2,
  HumanConfirmationV2,
  // V2 Revocation
  RevocationRecordV2,
  // Gap #13: Emergency Revocation
  EmergencyRevocation,
  // Gap #1: Key Recovery
  RecoveryConfig,
  RecoveryShareHolder,
  // Audit Compaction
  AuditCompaction,
  // Gap #5: Multi-Party Authorization
  MultiPartyAuthorization,
  PartyAuthorization,
  MultiPartyOperation,
  AuthorizationRole,
  // Gap #4: Algorithm Advisory
  AlgorithmAdvisory,
  AdvisorySeverity,
  AdvisoryAction,
  // Adaptive Security Tiers
  SecurityTier,
  // DCP-05: Agent Lifecycle
  LifecycleState,
  TerminationMode,
  DataDisposition,
  VitalityMetrics,
  CommissioningCertificate,
  VitalityReport,
  DecommissioningRecord,
  // DCP-06: Succession
  TransitionType,
  MemoryDisposition,
  MemoryClassification,
  SuccessorPreference,
  DigitalTestament,
  SuccessionRecord,
  MemoryTransferEntry,
  DualHashRef,
  MemoryTransferManifest,
  // DCP-07: Dispute Resolution
  DisputeType,
  EscalationLevel,
  DisputeStatus,
  ObjectionType,
  AuthorityLevel,
  DisputeRecord,
  ArbitrationResolution,
  JurisprudenceBundle,
  ObjectionRecord,
  // DCP-08: Rights & Obligations
  RightType,
  ComplianceStatus,
  RightEntry,
  RightsDeclaration,
  ObligationRecord,
  RightsViolationReport,
  // DCP-09: Delegation & Representation
  ThresholdOperator,
  ThresholdAction,
  AuthorityScopeEntry,
  DelegationMandate,
  AdvisoryDeclaration,
  PrincipalMirror,
  InteractionRecord,
  ThresholdRule,
  AwarenessThreshold,
} from './types/v2.js';

// ── V1 Crypto ──
export {
  canonicalize,
  generateKeypair,
  publicKeyFromSecret,
  signObject,
  verifyObject,
} from './core/crypto.js';

// ── V2 Crypto Provider ──
export type { CryptoProvider, KemProvider, CompositeOps, KeyStatus } from './core/crypto-provider.js';
export { deriveKid } from './core/crypto-provider.js';
export { AlgorithmRegistry, getDefaultRegistry } from './core/crypto-registry.js';
export { Ed25519Provider } from './providers/ed25519.js';
export { MlDsa65Provider } from './providers/ml-dsa-65.js';
export { SlhDsa192fProvider } from './providers/slh-dsa-192f.js';

// ── V2 Composite Signature Operations ──
export {
  compositeSign,
  compositeVerify,
  classicalOnlySign,
} from './core/composite-ops.js';
export type {
  CompositeKeyInfo,
  CompositeKeyPair,
  CompositeVerifyResult,
} from './core/composite-ops.js';

// ── V2 Proof of Possession ──
export {
  generateRegistrationPoP,
  verifyRegistrationPoP,
  createKeyRotation,
  verifyKeyRotation,
} from './core/proof-of-possession.js';
export type {
  KeyRotationRecord,
  PopChallenge,
} from './core/proof-of-possession.js';

// ── V2 Secure Memory ──
export { secureZero, SecureKeyGuard } from './core/secure-memory.js';

// ── V2 Default Provider Registration ──
export { registerDefaultProviders } from './core/register-providers.js';

// ── V2 Domain Separation ──
export { DCP_CONTEXTS, domainSeparatedMessage } from './core/domain-separation.js';
export type { DcpContext } from './core/domain-separation.js';

// ── V2 Canonicalization ──
export { canonicalizeV2, assertNoFloats } from './core/canonicalize.js';

// ── V2 Signed Payload ──
export { preparePayload, verifyPayloadHash } from './core/signed-payload.js';

// ── V2 Session Nonce ──
export {
  generateSessionNonce,
  isValidSessionNonce,
  verifySessionBinding,
  generateSessionExpiry,
  isSessionExpired,
} from './core/session-nonce.js';

// ── V2 Emergency Revocation (Gap #13) ──
export {
  generateEmergencyRevocationToken,
  verifyEmergencyRevocationSecret,
  buildEmergencyRevocation,
} from './core/emergency-revocation.js';
export type { EmergencyRevocationTokenPair } from './core/emergency-revocation.js';

// ── V2 Key Recovery — Shamir (Gap #1) ──
export {
  shamirSplit,
  shamirReconstruct,
  setupKeyRecovery,
} from './core/key-recovery.js';
export type { ShamirShare, RecoverySetup } from './core/key-recovery.js';

// ── V2 Security Tier Engine ──
export {
  computeSecurityTier,
  maxTier,
  tierToVerificationMode,
  tierToCheckpointInterval,
} from './core/security-tier.js';

// ── V2 Bundle Presentation ──
export {
  suggestPresentationMode,
  computeBundleHash,
  presentFull,
  presentCompact,
  presentReference,
  presentIncremental,
} from './core/bundle-presentation.js';
export type {
  PresentationMode,
  BundlePresentation,
  FullPresentation,
  IncrementalPresentation,
  ReferencePresentation,
  CompactPresentation,
  IncrementalDelta,
} from './core/bundle-presentation.js';

// ── V2 Verification Cache ──
export { VerificationCache } from './core/verification-cache.js';
export type {
  CacheEntry,
  VerificationCacheOptions,
} from './core/verification-cache.js';

// ── V2 PQ Checkpoints ──
export {
  auditEventsMerkleRoot,
  createPQCheckpoint,
  PQCheckpointManager,
} from './core/pq-checkpoint.js';

// ── V2 Dual Hash ──
export { sha256Hex, sha3_256Hex, dualHash, dualHashCanonical, dualMerkleRoot } from './core/dual-hash.js';

// ── Merkle / Hashing ──
export {
  hashObject,
  merkleRootFromHexLeaves,
  merkleRootForAuditEntries,
  intentHash,
  prevHashForEntry,
} from './core/merkle.js';

// ── Schema Validation ──
export { validateSchema, validateBundle } from './core/schema.js';

// ── Verification ──
export { verifySignedBundle } from './core/verify.js';

// ── Bundle Builder ──
export { BundleBuilder } from './bundle/builder.js';
export { BundleBuilderV2 } from './bundle/builder-v2.js';

// ── Bundle Signer ──
export { signBundle } from './bundle/signer.js';
export type { SignOptions } from './bundle/signer.js';
export { signBundleV2, signBundleV2ClassicalOnly } from './bundle/signer-v2.js';
export type { SignBundleV2Options, SignBundleV2ClassicalOnlyOptions } from './bundle/signer-v2.js';

// ── V2 Verification ──
export { verifySignedBundleV2, DEFAULT_VERIFIER_POLICY } from './core/verify-v2.js';
export type { VerifyV2Result } from './core/verify-v2.js';

// ── CBOR Wire Format ──
export {
  CborEncoder,
  CborDecoder,
  cborEncode,
  cborDecode,
  jsonToCborPayload,
  cborPayloadToJson,
  detectWireFormat,
} from './wire/cbor.js';

// ── Version Detection ──

/**
 * Detect the DCP version of an artifact or bundle.
 * Returns '1.0', '2.0', or null if unrecognized.
 */
export function detectDcpVersion(
  artifact: Record<string, unknown>,
): '1.0' | '2.0' | null {
  if ('dcp_version' in artifact) {
    const v = artifact.dcp_version;
    if (v === '1.0') return '1.0';
    if (v === '2.0') return '2.0';
  }
  if ('dcp_bundle_version' in artifact) {
    const v = artifact.dcp_bundle_version;
    if (v === '2.0') return '2.0';
  }
  if ('bundle' in artifact) {
    const bundle = artifact.bundle as Record<string, unknown>;
    if (bundle?.dcp_bundle_version === '2.0') return '2.0';
    const inner = bundle?.responsible_principal_record as Record<string, unknown> | undefined;
    if (inner?.dcp_version === '1.0') return '1.0';
  }
  return null;
}

// ── Observability ──
export {
  dcpTelemetry,
  type DcpTelemetryConfig,
  type DcpSpan,
  type DcpMetrics,
  type MetricsSummary,
  type PercentileStats,
  type TelemetryEvent,
  type SpanAttributes,
} from './observability/index.js';

// ── A2A Protocol (DCP-04) ──
export {
  type AgentDirectory,
  type AgentDirectoryEntry,
  createAgentDirectory,
  findAgentByCapability,
  findAgentById,
  validateDirectoryEntry,
  type A2AHello,
  type A2AWelcome,
  type A2AConfirm,
  type A2AEstablished,
  type A2AClose,
  type A2AResume,
  type A2AMessageType,
  generateNonce,
  createHello,
  createWelcome,
  deriveSessionId,
  createCloseMessage,
  type A2ASession,
  type EncryptedMessage,
  createSession,
  encryptMessage,
  decryptMessage,
  needsRekeying,
  generateResumeProof,
  verifyResumeProof,
  deriveRekeyedSessionKey,
} from './a2a/index.js';

// ── DCP-05: Agent Lifecycle ──
export {
  validateStateTransition,
  computeVitalityScore,
  createCommissioningCertificate,
  createVitalityReport,
  hashVitalityReport,
  createDecommissioningRecord,
} from './core/lifecycle.js';

// ── DCP-06: Succession ──
export {
  createDigitalTestament,
  updateDigitalTestament,
  classifyMemory,
  createMemoryTransferManifest,
  executeSuccession,
} from './core/succession.js';

// ── DCP-07: Dispute Resolution ──
export {
  createDispute,
  escalateDispute,
  resolveDispute,
  createObjection,
} from './core/conflict-resolution.js';

export {
  createArbitrationPanel,
  submitResolution,
  buildJurisprudenceBundle,
  lookupPrecedent,
} from './core/arbitration.js';
export type { ArbitrationPanel } from './core/arbitration.js';

// ── DCP-08: Rights & Obligations ──
export {
  declareRights,
  recordObligation,
  reportViolation,
  checkRightsCompliance,
} from './core/rights.js';

// ── DCP-09: Delegation & Representation ──
export {
  createDelegationMandate,
  verifyMandateValidity,
  revokeDelegation,
  generateInteractionRecord,
} from './core/delegation.js';

export {
  evaluateSignificance,
  shouldNotifyHuman,
  createAwarenessThreshold,
  createAdvisoryDeclaration,
} from './core/awareness-threshold.js';
export type { SignificanceContext } from './core/awareness-threshold.js';

export { generateMirror } from './core/principal-mirror.js';

// ── Error Codes ──
export {
  DcpErrorCode,
  DcpProtocolError,
  createDcpError,
  isDcpError,
  type DcpError,
} from './core/error-codes.js';

// ── Rate Limiting ──
export {
  RateLimiter,
  AdaptiveRateLimiter,
  type RateLimiterConfig,
  type RateLimitContext,
} from './core/rate-limiter.js';

// ── Circuit Breaker ──
export {
  CircuitBreaker,
  type CircuitBreakerConfig,
  type CircuitState,
} from './core/circuit-breaker.js';

// ── Retry ──
export {
  withRetry,
  type RetryConfig,
} from './core/retry.js';
