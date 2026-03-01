use sha2::{Sha256, Digest};

#[derive(Debug, thiserror::Error)]
pub enum CryptoError {
    #[error("Key error: {0}")]
    KeyError(String),
    #[error("Signature error: {0}")]
    SignatureError(String),
    #[error("Unknown algorithm: {0}")]
    UnknownAlgorithm(String),
}

#[derive(Debug, Clone)]
pub struct GeneratedKeypair {
    pub kid: String,
    pub public_key_b64: String,
    pub secret_key_b64: String,
}

pub trait CryptoProvider: Send + Sync {
    fn alg(&self) -> &str;
    fn key_size(&self) -> usize;
    fn sig_size(&self) -> usize;
    fn is_constant_time(&self) -> bool;

    fn generate_keypair(&self) -> Result<GeneratedKeypair, CryptoError>;
    fn sign(&self, message: &[u8], secret_key_b64: &str) -> Result<Vec<u8>, CryptoError>;
    fn verify(&self, message: &[u8], signature: &[u8], public_key_b64: &str) -> Result<bool, CryptoError>;
}

/// Key Encapsulation Mechanism provider trait (for KEM algorithms like ML-KEM-768).
pub trait KemProvider: Send + Sync {
    fn alg(&self) -> &str;
    fn pk_size(&self) -> usize;
    fn sk_size(&self) -> usize;
    fn ct_size(&self) -> usize;
    fn ss_size(&self) -> usize;

    fn generate_keypair(&self) -> Result<GeneratedKeypair, CryptoError>;
    fn encapsulate(&self, public_key_b64: &str) -> Result<(Vec<u8>, Vec<u8>), CryptoError>;
    fn decapsulate(&self, ciphertext: &[u8], secret_key_b64: &str) -> Result<Vec<u8>, CryptoError>;
}

/// Derive a key ID from algorithm name and raw public key bytes.
/// kid = hex(SHA-256(UTF8(alg) || 0x00 || public_key_bytes))[0..32]
pub fn derive_kid(alg: &str, public_key_bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(alg.as_bytes());
    hasher.update([0x00]);
    hasher.update(public_key_bytes);
    let hash = hex::encode(hasher.finalize());
    hash[..32].to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_derive_kid_length() {
        let kid = derive_kid("ed25519", &[1, 2, 3]);
        assert_eq!(kid.len(), 32);
    }
}
