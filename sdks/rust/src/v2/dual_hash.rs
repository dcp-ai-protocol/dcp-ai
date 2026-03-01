use serde::{Deserialize, Serialize};
use sha2::{Sha256, Digest};
use sha3::Sha3_256;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DualHash {
    pub sha256: String,
    pub sha3_256: String,
}

pub fn sha256_hex(data: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(data);
    hex::encode(hasher.finalize())
}

pub fn sha3_256_hex(data: &[u8]) -> String {
    let mut hasher = Sha3_256::new();
    hasher.update(data);
    hex::encode(hasher.finalize())
}

pub fn dual_hash(data: &[u8]) -> DualHash {
    DualHash {
        sha256: sha256_hex(data),
        sha3_256: sha3_256_hex(data),
    }
}

pub fn dual_hash_canonical(canonical_json: &str) -> DualHash {
    dual_hash(canonical_json.as_bytes())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sha256_hex_known() {
        let hash = sha256_hex(b"hello");
        assert_eq!(hash, "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
    }

    #[test]
    fn test_sha3_256_hex_known() {
        let hash = sha3_256_hex(b"hello");
        assert_eq!(hash.len(), 64);
    }

    #[test]
    fn test_dual_hash_produces_both() {
        let dh = dual_hash(b"test");
        assert_eq!(dh.sha256.len(), 64);
        assert_eq!(dh.sha3_256.len(), 64);
        assert_ne!(dh.sha256, dh.sha3_256);
    }
}
