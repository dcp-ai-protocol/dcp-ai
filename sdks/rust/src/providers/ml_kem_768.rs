use base64::Engine;
use base64::engine::general_purpose::STANDARD as BASE64;
use fips203::ml_kem_768;
use fips203::traits::{Decaps, Encaps, SerDes, KeyGen};
use zeroize::Zeroize;

use crate::v2::crypto_provider::{CryptoError, GeneratedKeypair, KemProvider, derive_kid};

pub struct MlKem768Provider;

impl KemProvider for MlKem768Provider {
    fn alg(&self) -> &str {
        "ml-kem-768"
    }

    fn pk_size(&self) -> usize {
        1184
    }

    fn sk_size(&self) -> usize {
        2400
    }

    fn ct_size(&self) -> usize {
        1088
    }

    fn ss_size(&self) -> usize {
        32
    }

    fn generate_keypair(&self) -> Result<GeneratedKeypair, CryptoError> {
        let (ek, dk) = ml_kem_768::KG::try_keygen()
            .map_err(|e| CryptoError::KeyError(format!("ML-KEM-768 keygen failed: {:?}", e)))?;
        let ek_bytes = ek.into_bytes();
        let mut dk_bytes = dk.into_bytes();
        let kid = derive_kid(self.alg(), &ek_bytes);

        let result = GeneratedKeypair {
            kid,
            public_key_b64: BASE64.encode(&ek_bytes),
            secret_key_b64: BASE64.encode(&dk_bytes),
        };

        dk_bytes.zeroize();
        Ok(result)
    }

    fn encapsulate(&self, public_key_b64: &str) -> Result<(Vec<u8>, Vec<u8>), CryptoError> {
        let ek_bytes = BASE64.decode(public_key_b64)
            .map_err(|e| CryptoError::KeyError(format!("base64 decode: {}", e)))?;
        let ek = ml_kem_768::EncapsKey::try_from_bytes(ek_bytes.as_slice().try_into()
            .map_err(|_| CryptoError::KeyError("invalid encapsulation key length".to_string()))?)
            .map_err(|e| CryptoError::KeyError(format!("invalid ML-KEM-768 encaps key: {:?}", e)))?;

        let (ss, ct) = ek.try_encaps()
            .map_err(|e| CryptoError::SignatureError(format!("ML-KEM-768 encaps failed: {:?}", e)))?;

        Ok((ss.into_bytes().to_vec(), ct.into_bytes().to_vec()))
    }

    fn decapsulate(&self, ciphertext: &[u8], secret_key_b64: &str) -> Result<Vec<u8>, CryptoError> {
        let mut dk_bytes = BASE64.decode(secret_key_b64)
            .map_err(|e| CryptoError::KeyError(format!("base64 decode: {}", e)))?;
        let dk = ml_kem_768::DecapsKey::try_from_bytes(dk_bytes.as_slice().try_into()
            .map_err(|_| CryptoError::KeyError("invalid decapsulation key length".to_string()))?)
            .map_err(|e| CryptoError::KeyError(format!("invalid ML-KEM-768 decaps key: {:?}", e)))?;
        dk_bytes.zeroize();

        let ct = ml_kem_768::CipherText::try_from_bytes(ciphertext.try_into()
            .map_err(|_| CryptoError::SignatureError("invalid ciphertext length".to_string()))?)
            .map_err(|e| CryptoError::SignatureError(format!("invalid ML-KEM-768 ciphertext: {:?}", e)))?;

        let ss = dk.try_decaps(&ct)
            .map_err(|e| CryptoError::SignatureError(format!("ML-KEM-768 decaps failed: {:?}", e)))?;

        Ok(ss.into_bytes().to_vec())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_keypair_generation() {
        let provider = MlKem768Provider;
        let kp = provider.generate_keypair().unwrap();
        assert_eq!(kp.kid.len(), 32);
        assert!(!kp.public_key_b64.is_empty());
        assert!(!kp.secret_key_b64.is_empty());
    }

    #[test]
    fn test_encaps_decaps_round_trip() {
        let provider = MlKem768Provider;
        let kp = provider.generate_keypair().unwrap();

        let (ss_enc, ct) = provider.encapsulate(&kp.public_key_b64).unwrap();
        let ss_dec = provider.decapsulate(&ct, &kp.secret_key_b64).unwrap();

        assert_eq!(ss_enc, ss_dec);
        assert_eq!(ss_enc.len(), 32);
    }

    #[test]
    fn test_deterministic_kid() {
        let provider = MlKem768Provider;
        let kp = provider.generate_keypair().unwrap();
        let pk_bytes = BASE64.decode(&kp.public_key_b64).unwrap();
        let recomputed = derive_kid("ml-kem-768", &pk_bytes);
        assert_eq!(kp.kid, recomputed);
    }
}
