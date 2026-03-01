export interface KeypairResult {
  alg: string;
  kid?: string;
  public_key_b64: string;
  secret_key_b64: string;
}

export interface HybridKeypairResult {
  classical: KeypairResult;
  pq: KeypairResult;
}

export interface CompositeSignature {
  classical: SignatureEntry;
  pq: SignatureEntry | null;
  binding: string;
}

export interface SignatureEntry {
  alg: string;
  kid: string;
  sig_b64: string;
}

export interface SignedPayload {
  payload: unknown;
  payload_hash: string;
  composite_sig: CompositeSignature;
}

export interface CompositeVerifyResult {
  valid: boolean;
  classical_valid: boolean;
  pq_valid: boolean;
}

export interface DualHash {
  sha256: string;
  sha3_256: string;
}

export interface SecurityTierResult {
  tier: 'routine' | 'standard' | 'elevated' | 'maximum';
  verification_mode: 'classical_only' | 'hybrid_preferred' | 'hybrid_required';
  checkpoint_interval: number;
}

export interface PreparedPayload {
  canonical: string;
  payload_hash: string;
}

export interface SessionBindingResult {
  valid: boolean;
  nonce?: string | null;
  error?: string;
}

export interface V2VerificationResult {
  verified: boolean;
  dcp_version: string;
  errors: string[];
  warnings: string[];
  classical_valid: boolean;
  pq_valid: boolean;
  session_binding_valid: boolean;
  manifest_valid: boolean;
}

export interface KemKeypairResult {
  alg: string;
  kid: string;
  public_key_b64: string;
  secret_key_b64: string;
}

export interface KemEncapsulateResult {
  shared_secret_hex: string;
  ciphertext_b64: string;
}

export interface PopResult {
  valid: boolean;
}

export interface BundleManifest {
  session_nonce: string;
  rpr_hash: string;
  passport_hash: string;
  intent_hash: string;
  policy_hash: string;
  audit_merkle_root: string;
  audit_merkle_root_secondary: string;
  audit_count: number;
}

export interface CitizenshipBundleV2 {
  dcp_bundle_version: string;
  manifest: BundleManifest;
  responsible_principal_record: { payload: unknown; payload_hash: string };
  agent_passport: { payload: unknown; payload_hash: string };
  intent: { payload: unknown; payload_hash: string };
  policy_decision: { payload: unknown; payload_hash: string };
  audit_entries: unknown[];
}

export interface SignedBundleV2 {
  bundle: CitizenshipBundleV2;
  signature: {
    hash_alg: string;
    created_at: string;
    signer: { type: string; kids: string[] };
    manifest_hash: string;
    composite_sig: CompositeSignature;
  };
}

export interface BuildBundleOptions {
  rpr: unknown;
  passport: unknown;
  intent: unknown;
  policy: unknown;
  auditEntries: unknown[];
  sessionNonce?: string;
}
