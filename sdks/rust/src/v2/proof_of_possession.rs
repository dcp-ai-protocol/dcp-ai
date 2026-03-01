use base64::Engine;
use base64::engine::general_purpose::STANDARD as BASE64;
use serde::{Deserialize, Serialize};

use crate::v2::composite_sig::SignatureEntry;
use crate::v2::crypto_provider::{CryptoError, CryptoProvider};
use crate::v2::domain_separation::{
    domain_separated_message, CTX_KEY_ROTATION, CTX_PROOF_OF_POSSESSION,
};
use crate::v2::canonicalize::canonicalize_v2;

#[derive(Debug, Serialize, Deserialize)]
pub struct PopChallenge {
    pub kid: String,
    pub agent_id: String,
    pub timestamp: String,
    pub nonce: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct KeyRotationRecord {
    #[serde(rename = "type")]
    pub record_type: String,
    pub old_kid: String,
    pub new_kid: String,
    pub new_key: KeyRotationNewKey,
    pub timestamp: String,
    pub proof_of_possession: SignatureEntry,
    pub authorization_sig: SignatureEntry,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct KeyRotationNewKey {
    pub kid: String,
    pub alg: String,
    pub public_key_b64: String,
    pub created_at: String,
    pub expires_at: Option<String>,
    pub status: String,
}

/// Generate a proof-of-possession for initial key registration.
pub fn generate_registration_pop(
    provider: &dyn CryptoProvider,
    challenge: &PopChallenge,
    secret_key_b64: &str,
) -> Result<SignatureEntry, CryptoError> {
    let canonical = canonicalize_v2(&serde_json::to_value(challenge)
        .map_err(|e| CryptoError::SignatureError(format!("serialize: {}", e)))?)
        .map_err(|e| CryptoError::SignatureError(e))?;
    let dsm = domain_separated_message(CTX_PROOF_OF_POSSESSION, canonical.as_bytes())
        .map_err(|e| CryptoError::SignatureError(e))?;
    let sig = provider.sign(&dsm, secret_key_b64)?;

    Ok(SignatureEntry {
        alg: provider.alg().to_string(),
        kid: challenge.kid.clone(),
        sig_b64: BASE64.encode(&sig),
    })
}

/// Verify a proof-of-possession for key registration.
pub fn verify_registration_pop(
    provider: &dyn CryptoProvider,
    challenge: &PopChallenge,
    pop: &SignatureEntry,
    public_key_b64: &str,
) -> Result<bool, CryptoError> {
    let canonical = canonicalize_v2(&serde_json::to_value(challenge)
        .map_err(|e| CryptoError::SignatureError(format!("serialize: {}", e)))?)
        .map_err(|e| CryptoError::SignatureError(e))?;
    let dsm = domain_separated_message(CTX_PROOF_OF_POSSESSION, canonical.as_bytes())
        .map_err(|e| CryptoError::SignatureError(e))?;
    let sig_bytes = BASE64.decode(&pop.sig_b64)
        .map_err(|e| CryptoError::SignatureError(format!("base64 decode: {}", e)))?;
    provider.verify(&dsm, &sig_bytes, public_key_b64)
}

/// Rotation payload used for signing.
#[derive(Serialize)]
struct RotationPayload {
    new_kid: String,
    old_kid: String,
    timestamp: String,
}

/// Create a key rotation record with proof-of-possession.
pub fn create_key_rotation(
    old_provider: &dyn CryptoProvider,
    new_provider: &dyn CryptoProvider,
    old_kid: &str,
    old_secret_key_b64: &str,
    new_kid: &str,
    new_secret_key_b64: &str,
    new_public_key_b64: &str,
    new_alg: &str,
    timestamp: &str,
    expires_at: Option<&str>,
) -> Result<KeyRotationRecord, CryptoError> {
    let payload = RotationPayload {
        old_kid: old_kid.to_string(),
        new_kid: new_kid.to_string(),
        timestamp: timestamp.to_string(),
    };
    let canonical = canonicalize_v2(&serde_json::to_value(&payload)
        .map_err(|e| CryptoError::SignatureError(format!("serialize: {}", e)))?)
        .map_err(|e| CryptoError::SignatureError(e))?;
    let dsm = domain_separated_message(CTX_KEY_ROTATION, canonical.as_bytes())
        .map_err(|e| CryptoError::SignatureError(e))?;

    let pop_sig = new_provider.sign(&dsm, new_secret_key_b64)?;
    let auth_sig = old_provider.sign(&dsm, old_secret_key_b64)?;

    Ok(KeyRotationRecord {
        record_type: "key_rotation".to_string(),
        old_kid: old_kid.to_string(),
        new_kid: new_kid.to_string(),
        new_key: KeyRotationNewKey {
            kid: new_kid.to_string(),
            alg: new_alg.to_string(),
            public_key_b64: new_public_key_b64.to_string(),
            created_at: timestamp.to_string(),
            expires_at: expires_at.map(|s| s.to_string()),
            status: "active".to_string(),
        },
        timestamp: timestamp.to_string(),
        proof_of_possession: SignatureEntry {
            alg: new_provider.alg().to_string(),
            kid: new_kid.to_string(),
            sig_b64: BASE64.encode(&pop_sig),
        },
        authorization_sig: SignatureEntry {
            alg: old_provider.alg().to_string(),
            kid: old_kid.to_string(),
            sig_b64: BASE64.encode(&auth_sig),
        },
    })
}

/// Verify a key rotation record (both PoP and authorization signatures).
pub fn verify_key_rotation(
    old_provider: &dyn CryptoProvider,
    new_provider: &dyn CryptoProvider,
    record: &KeyRotationRecord,
    old_public_key_b64: &str,
    new_public_key_b64: &str,
) -> Result<(bool, bool, bool), CryptoError> {
    let payload = RotationPayload {
        old_kid: record.old_kid.clone(),
        new_kid: record.new_kid.clone(),
        timestamp: record.timestamp.clone(),
    };
    let canonical = canonicalize_v2(&serde_json::to_value(&payload)
        .map_err(|e| CryptoError::SignatureError(format!("serialize: {}", e)))?)
        .map_err(|e| CryptoError::SignatureError(e))?;
    let dsm = domain_separated_message(CTX_KEY_ROTATION, canonical.as_bytes())
        .map_err(|e| CryptoError::SignatureError(e))?;

    let pop_sig = BASE64.decode(&record.proof_of_possession.sig_b64)
        .map_err(|e| CryptoError::SignatureError(format!("base64 decode: {}", e)))?;
    let auth_sig = BASE64.decode(&record.authorization_sig.sig_b64)
        .map_err(|e| CryptoError::SignatureError(format!("base64 decode: {}", e)))?;

    let pop_valid = new_provider.verify(&dsm, &pop_sig, new_public_key_b64)?;
    let auth_valid = old_provider.verify(&dsm, &auth_sig, old_public_key_b64)?;

    Ok((pop_valid && auth_valid, pop_valid, auth_valid))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::providers::ed25519::Ed25519Provider;

    #[test]
    fn test_registration_pop_round_trip() {
        let provider = Ed25519Provider;
        let kp = provider.generate_keypair().unwrap();
        let challenge = PopChallenge {
            kid: kp.kid.clone(),
            agent_id: "agent-123".to_string(),
            timestamp: "2026-02-25T00:00:00Z".to_string(),
            nonce: "deadbeef".to_string(),
        };
        let pop = generate_registration_pop(&provider, &challenge, &kp.secret_key_b64).unwrap();
        let valid = verify_registration_pop(&provider, &challenge, &pop, &kp.public_key_b64).unwrap();
        assert!(valid);
    }

    #[test]
    fn test_key_rotation_round_trip() {
        let provider = Ed25519Provider;
        let old_kp = provider.generate_keypair().unwrap();
        let new_kp = provider.generate_keypair().unwrap();

        let record = create_key_rotation(
            &provider,
            &provider,
            &old_kp.kid,
            &old_kp.secret_key_b64,
            &new_kp.kid,
            &new_kp.secret_key_b64,
            &new_kp.public_key_b64,
            "ed25519",
            "2026-06-01T00:00:00Z",
            None,
        )
        .unwrap();

        let (valid, pop_valid, auth_valid) = verify_key_rotation(
            &provider,
            &provider,
            &record,
            &old_kp.public_key_b64,
            &new_kp.public_key_b64,
        )
        .unwrap();

        assert!(valid);
        assert!(pop_valid);
        assert!(auth_valid);
    }
}
