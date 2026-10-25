pub mod crypto_provider;
pub mod domain_separation;
pub mod canonicalize;
/// EXPERIMENTAL, opt-in: ingress of one unit under the inactive candidate dcp-jcs-v2 (phase 1).
pub mod experimental_candidate_ingress;
pub mod dual_hash;
pub mod composite_sig;
pub mod composite_ops;
pub mod signed_payload;
pub mod bundle;
pub mod proof_of_possession;
pub mod types;
pub mod lifecycle;
pub mod succession;
pub mod conflict_resolution;
pub mod arbitration;
pub mod rights;
pub mod delegation;
pub mod awareness_threshold;
pub mod principal_mirror;
pub mod session_nonce;
pub mod security_tier;
pub mod emergency_revocation;
pub mod pq_checkpoint;
pub mod a2a;
pub mod advisory;
pub mod blinded_rpr;
pub mod multi_party_auth;
pub mod error_codes;
pub mod verify_bundle;
pub mod admission;

// Verification at a given instant and admission (spec/profiles/admission § 8).
pub use admission::{
    admit_signed_bundle_v2, evaluate_admission_v2, resolve_strict_v1_profile, revocation_subjects,
    AdmissionConfigError, AdmissionError, AdmissionOptions, AdmissionResult, AdmitOptions, PrincipalTrust,
    PrincipalTrustStore, ProfileCompliance, RevocationSubjects, StrictV1Profile, STRICT_V1, STRICT_V1_MAX_SECONDS,
};
pub use verify_bundle::{
    verify_signed_bundle_v2, verify_signed_bundle_v2_at, verify_signed_bundle_v2_with_policy, SignerKeyUse,
    V2VerificationDetails, V2VerificationResult,
};
