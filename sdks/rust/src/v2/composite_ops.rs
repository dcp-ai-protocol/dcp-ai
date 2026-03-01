use base64::Engine;
use base64::engine::general_purpose::STANDARD as BASE64;

use crate::v2::composite_sig::{CompositeSignature, SignatureEntry};
use crate::v2::crypto_provider::{CryptoError, CryptoProvider};
use crate::v2::domain_separation::domain_separated_message;

/// Key material needed for composite signing.
pub struct CompositeKeyInfo {
    pub kid: String,
    pub alg: String,
    pub secret_key_b64: String,
    pub public_key_b64: String,
}

/// Result of composite signature verification.
#[derive(Debug)]
pub struct CompositeVerifyResult {
    pub valid: bool,
    pub classical_valid: bool,
    pub pq_valid: bool,
}

/// Produce a composite-bound hybrid signature (PQ over classical binding).
///
/// Protocol:
///   1. classical_sig = classical.sign(context || 0x00 || payload)
///   2. pq_sig = pq.sign(context || 0x00 || payload || classical_sig)
pub fn composite_sign(
    classical_provider: &dyn CryptoProvider,
    pq_provider: &dyn CryptoProvider,
    context: &str,
    canonical_payload: &[u8],
    classical_key: &CompositeKeyInfo,
    pq_key: &CompositeKeyInfo,
) -> Result<CompositeSignature, CryptoError> {
    let dsm = domain_separated_message(context, canonical_payload)
        .map_err(|e| CryptoError::SignatureError(e))?;

    let classical_sig = classical_provider.sign(&dsm, &classical_key.secret_key_b64)?;

    let mut composite_message = Vec::with_capacity(dsm.len() + classical_sig.len());
    composite_message.extend_from_slice(&dsm);
    composite_message.extend_from_slice(&classical_sig);

    let pq_sig = pq_provider.sign(&composite_message, &pq_key.secret_key_b64)?;

    Ok(CompositeSignature::pq_over_classical(
        SignatureEntry {
            alg: classical_key.alg.clone(),
            kid: classical_key.kid.clone(),
            sig_b64: BASE64.encode(&classical_sig),
        },
        SignatureEntry {
            alg: pq_key.alg.clone(),
            kid: pq_key.kid.clone(),
            sig_b64: BASE64.encode(&pq_sig),
        },
    ))
}

/// Produce a classical-only composite signature (transition mode).
pub fn classical_only_sign(
    classical_provider: &dyn CryptoProvider,
    context: &str,
    canonical_payload: &[u8],
    key: &CompositeKeyInfo,
) -> Result<CompositeSignature, CryptoError> {
    let dsm = domain_separated_message(context, canonical_payload)
        .map_err(|e| CryptoError::SignatureError(e))?;

    let sig = classical_provider.sign(&dsm, &key.secret_key_b64)?;

    Ok(CompositeSignature::classical_only(SignatureEntry {
        alg: key.alg.clone(),
        kid: key.kid.clone(),
        sig_b64: BASE64.encode(&sig),
    }))
}

/// Verify a composite-bound hybrid signature.
///
/// For `pq_over_classical`:
///   1. Verify PQ sig over (dsm || classical_sig)
///   2. Verify classical sig over dsm
pub fn composite_verify(
    classical_provider: &dyn CryptoProvider,
    pq_provider: Option<&dyn CryptoProvider>,
    context: &str,
    canonical_payload: &[u8],
    composite_sig: &CompositeSignature,
    classical_pubkey_b64: &str,
    pq_pubkey_b64: Option<&str>,
) -> Result<CompositeVerifyResult, CryptoError> {
    let dsm = domain_separated_message(context, canonical_payload)
        .map_err(|e| CryptoError::SignatureError(e))?;

    if composite_sig.binding == "classical_only" {
        if composite_sig.pq.is_some() {
            return Ok(CompositeVerifyResult {
                valid: false,
                classical_valid: false,
                pq_valid: false,
            });
        }
        let classical_sig_bytes = BASE64.decode(&composite_sig.classical.sig_b64)
            .map_err(|e| CryptoError::SignatureError(format!("base64 decode: {}", e)))?;
        let classical_valid = classical_provider.verify(
            &dsm,
            &classical_sig_bytes,
            classical_pubkey_b64,
        )?;
        return Ok(CompositeVerifyResult {
            valid: classical_valid,
            classical_valid,
            pq_valid: false,
        });
    }

    if composite_sig.binding != "pq_over_classical" {
        return Ok(CompositeVerifyResult {
            valid: false,
            classical_valid: false,
            pq_valid: false,
        });
    }

    let pq_entry = composite_sig.pq.as_ref().ok_or_else(|| {
        CryptoError::SignatureError("pq_over_classical binding requires PQ signature".into())
    })?;
    let pq_prov = pq_provider.ok_or_else(|| {
        CryptoError::UnknownAlgorithm(pq_entry.alg.clone())
    })?;
    let pq_pk = pq_pubkey_b64.ok_or_else(|| {
        CryptoError::KeyError("PQ public key required for pq_over_classical verification".into())
    })?;

    let classical_sig_bytes = BASE64.decode(&composite_sig.classical.sig_b64)
        .map_err(|e| CryptoError::SignatureError(format!("base64 decode: {}", e)))?;
    let pq_sig_bytes = BASE64.decode(&pq_entry.sig_b64)
        .map_err(|e| CryptoError::SignatureError(format!("base64 decode: {}", e)))?;

    let mut composite_message = Vec::with_capacity(dsm.len() + classical_sig_bytes.len());
    composite_message.extend_from_slice(&dsm);
    composite_message.extend_from_slice(&classical_sig_bytes);

    let classical_valid = classical_provider.verify(&dsm, &classical_sig_bytes, classical_pubkey_b64)?;
    let pq_valid = pq_prov.verify(&composite_message, &pq_sig_bytes, pq_pk)?;

    Ok(CompositeVerifyResult {
        valid: classical_valid && pq_valid,
        classical_valid,
        pq_valid,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::providers::ed25519::Ed25519Provider;
    use crate::v2::domain_separation::CTX_AGENT_PASSPORT;

    #[test]
    fn test_classical_only_sign_verify() {
        let ed = Ed25519Provider;
        let kp = ed.generate_keypair().unwrap();
        let key = CompositeKeyInfo {
            kid: kp.kid.clone(),
            alg: "ed25519".into(),
            secret_key_b64: kp.secret_key_b64.clone(),
            public_key_b64: kp.public_key_b64.clone(),
        };
        let payload = b"test payload";
        let sig = classical_only_sign(&ed, CTX_AGENT_PASSPORT, payload, &key).unwrap();
        assert_eq!(sig.binding, "classical_only");
        assert!(sig.pq.is_none());

        let result = composite_verify(
            &ed,
            None,
            CTX_AGENT_PASSPORT,
            payload,
            &sig,
            &kp.public_key_b64,
            None,
        )
        .unwrap();
        assert!(result.valid);
        assert!(result.classical_valid);
    }
}
