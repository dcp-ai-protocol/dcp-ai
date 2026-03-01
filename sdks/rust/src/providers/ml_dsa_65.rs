use base64::Engine;
use base64::engine::general_purpose::STANDARD as BASE64;
use fips204::ml_dsa_65;
use fips204::traits::{KeyGen, SerDes, Signer, Verifier};
use zeroize::Zeroize;

use crate::v2::crypto_provider::{CryptoError, CryptoProvider, GeneratedKeypair, derive_kid};

pub struct MlDsa65Provider;

const SK_LEN: usize = 4032;
const PK_LEN: usize = 1952;
const SIG_LEN: usize = 3309;

impl CryptoProvider for MlDsa65Provider {
    fn alg(&self) -> &str {
        "ml-dsa-65"
    }

    fn key_size(&self) -> usize {
        PK_LEN
    }

    fn sig_size(&self) -> usize {
        SIG_LEN
    }

    fn is_constant_time(&self) -> bool {
        true
    }

    fn generate_keypair(&self) -> Result<GeneratedKeypair, CryptoError> {
        let (pk, sk) = ml_dsa_65::KG::try_keygen()
            .map_err(|e| CryptoError::KeyError(format!("ML-DSA-65 keygen failed: {:?}", e)))?;
        let pk_bytes = pk.into_bytes();
        let mut sk_bytes = sk.into_bytes();
        let kid = derive_kid(self.alg(), &pk_bytes);

        let result = GeneratedKeypair {
            kid,
            public_key_b64: BASE64.encode(&pk_bytes),
            secret_key_b64: BASE64.encode(&sk_bytes),
        };

        sk_bytes.zeroize();
        Ok(result)
    }

    fn sign(&self, message: &[u8], secret_key_b64: &str) -> Result<Vec<u8>, CryptoError> {
        let mut sk_bytes = BASE64.decode(secret_key_b64)
            .map_err(|e| CryptoError::KeyError(format!("base64 decode: {}", e)))?;
        let sk_arr: [u8; SK_LEN] = sk_bytes.as_slice().try_into()
            .map_err(|_| CryptoError::KeyError(format!("invalid ML-DSA-65 secret key length: expected {}", SK_LEN)))?;
        let sk = ml_dsa_65::PrivateKey::try_from_bytes(sk_arr)
            .map_err(|e| CryptoError::KeyError(format!("invalid ML-DSA-65 secret key: {:?}", e)))?;
        sk_bytes.zeroize();

        let sig = sk.try_sign(message, &[])
            .map_err(|e| CryptoError::SignatureError(format!("ML-DSA-65 sign failed: {:?}", e)))?;
        Ok(sig.to_vec())
    }

    fn verify(&self, message: &[u8], signature: &[u8], public_key_b64: &str) -> Result<bool, CryptoError> {
        let pk_bytes = BASE64.decode(public_key_b64)
            .map_err(|e| CryptoError::KeyError(format!("base64 decode: {}", e)))?;
        let pk_arr: [u8; PK_LEN] = pk_bytes.as_slice().try_into()
            .map_err(|_| CryptoError::KeyError(format!("invalid ML-DSA-65 public key length: expected {}", PK_LEN)))?;
        let pk = ml_dsa_65::PublicKey::try_from_bytes(pk_arr)
            .map_err(|e| CryptoError::KeyError(format!("invalid ML-DSA-65 public key: {:?}", e)))?;
        let sig_arr: [u8; SIG_LEN] = signature.try_into()
            .map_err(|_| CryptoError::SignatureError(format!("invalid ML-DSA-65 signature length: expected {}", SIG_LEN)))?;
        Ok(pk.verify(message, &sig_arr, &[]))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_keypair_generation() {
        let provider = MlDsa65Provider;
        let kp = provider.generate_keypair().unwrap();
        assert_eq!(kp.kid.len(), 32);
        assert!(!kp.public_key_b64.is_empty());
        assert!(!kp.secret_key_b64.is_empty());
    }

    #[test]
    fn test_sign_and_verify() {
        let provider = MlDsa65Provider;
        let kp = provider.generate_keypair().unwrap();
        let message = b"hello world";
        let sig = provider.sign(message, &kp.secret_key_b64).unwrap();
        let valid = provider.verify(message, &sig, &kp.public_key_b64).unwrap();
        assert!(valid);
    }

    #[test]
    fn test_verify_wrong_message() {
        let provider = MlDsa65Provider;
        let kp = provider.generate_keypair().unwrap();
        let sig = provider.sign(b"correct", &kp.secret_key_b64).unwrap();
        let valid = provider.verify(b"wrong", &sig, &kp.public_key_b64).unwrap();
        assert!(!valid);
    }

    #[test]
    fn test_deterministic_kid() {
        let provider = MlDsa65Provider;
        let kp = provider.generate_keypair().unwrap();
        let pk_bytes = BASE64.decode(&kp.public_key_b64).unwrap();
        let recomputed = derive_kid("ml-dsa-65", &pk_bytes);
        assert_eq!(kp.kid, recomputed);
    }
}
