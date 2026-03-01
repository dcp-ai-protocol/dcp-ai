use base64::Engine;
use base64::engine::general_purpose::STANDARD as BASE64;
use ed25519_dalek::{Signer, SigningKey, Verifier, VerifyingKey, Signature};

use crate::v2::crypto_provider::{CryptoError, CryptoProvider, GeneratedKeypair, derive_kid};

pub struct Ed25519Provider;

impl CryptoProvider for Ed25519Provider {
    fn alg(&self) -> &str {
        "ed25519"
    }

    fn key_size(&self) -> usize {
        32
    }

    fn sig_size(&self) -> usize {
        64
    }

    fn is_constant_time(&self) -> bool {
        true
    }

    fn generate_keypair(&self) -> Result<GeneratedKeypair, CryptoError> {
        let mut rng = rand::thread_rng();
        let signing_key = SigningKey::generate(&mut rng);
        let verifying_key = signing_key.verifying_key();
        let pub_bytes = verifying_key.to_bytes();
        let kid = derive_kid(self.alg(), &pub_bytes);
        Ok(GeneratedKeypair {
            kid,
            public_key_b64: BASE64.encode(pub_bytes),
            secret_key_b64: BASE64.encode(signing_key.to_keypair_bytes()),
        })
    }

    fn sign(&self, message: &[u8], secret_key_b64: &str) -> Result<Vec<u8>, CryptoError> {
        let sk_bytes = BASE64.decode(secret_key_b64)
            .map_err(|e| CryptoError::KeyError(format!("base64 decode: {}", e)))?;
        let key_bytes: [u8; 32] = sk_bytes[..32]
            .try_into()
            .map_err(|_| CryptoError::KeyError("invalid secret key length".into()))?;
        let signing_key = SigningKey::from_bytes(&key_bytes);
        let sig = signing_key.sign(message);
        Ok(sig.to_bytes().to_vec())
    }

    fn verify(&self, message: &[u8], signature: &[u8], public_key_b64: &str) -> Result<bool, CryptoError> {
        let pk_bytes = BASE64.decode(public_key_b64)
            .map_err(|e| CryptoError::KeyError(format!("base64 decode: {}", e)))?;
        let pk_array: [u8; 32] = pk_bytes
            .try_into()
            .map_err(|_| CryptoError::KeyError("invalid public key length (expected 32 bytes)".into()))?;
        let sig_array: [u8; 64] = signature
            .try_into()
            .map_err(|_| CryptoError::SignatureError("invalid signature length (expected 64 bytes)".into()))?;
        let verifying_key = VerifyingKey::from_bytes(&pk_array)
            .map_err(|e| CryptoError::KeyError(e.to_string()))?;
        let sig = Signature::from_bytes(&sig_array);
        Ok(verifying_key.verify(message, &sig).is_ok())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_keypair_generation() {
        let provider = Ed25519Provider;
        let kp = provider.generate_keypair().unwrap();
        assert_eq!(kp.kid.len(), 32);
        assert!(!kp.public_key_b64.is_empty());
        assert!(!kp.secret_key_b64.is_empty());
    }

    #[test]
    fn test_sign_and_verify() {
        let provider = Ed25519Provider;
        let kp = provider.generate_keypair().unwrap();
        let message = b"hello world";
        let sig = provider.sign(message, &kp.secret_key_b64).unwrap();
        assert_eq!(sig.len(), 64);
        let valid = provider.verify(message, &sig, &kp.public_key_b64).unwrap();
        assert!(valid);
    }

    #[test]
    fn test_verify_wrong_message() {
        let provider = Ed25519Provider;
        let kp = provider.generate_keypair().unwrap();
        let sig = provider.sign(b"correct", &kp.secret_key_b64).unwrap();
        let valid = provider.verify(b"wrong", &sig, &kp.public_key_b64).unwrap();
        assert!(!valid);
    }
}
