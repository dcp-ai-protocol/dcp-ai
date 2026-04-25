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

/// Reduce a layer of hex-encoded leaf hashes to a single Merkle root using
/// the given hasher. Odd layers are balanced by duplicating the last leaf,
/// matching the Python/TS/WASM behaviour.
fn merkle_root_hex<D: Digest>(leaves: &[String]) -> Option<String> {
    if leaves.is_empty() {
        return None;
    }
    let mut layer: Vec<Vec<u8>> = leaves
        .iter()
        .map(|s| hex::decode(s).unwrap_or_default())
        .collect();
    while layer.len() > 1 {
        if layer.len() % 2 == 1 {
            layer.push(layer.last().cloned().unwrap_or_default());
        }
        let mut next: Vec<Vec<u8>> = Vec::with_capacity(layer.len() / 2);
        for pair in layer.chunks(2) {
            let mut hasher = D::new();
            hasher.update(&pair[0]);
            hasher.update(&pair[1]);
            next.push(hasher.finalize().to_vec());
        }
        layer = next;
    }
    Some(hex::encode(&layer[0]))
}

/// Compute dual Merkle roots from a list of dual-hash leaves.
///
/// Each leaf carries both a SHA-256 and a SHA3-256 commitment; this
/// function reduces the two layers in parallel and returns the pair of
/// roots. Returns `None` when the leaf list is empty. Byte-identical to
/// `dualMerkleRoot` (TypeScript) and `dual_merkle_root` (Python).
pub fn dual_merkle_root(leaves: &[DualHash]) -> Option<DualHash> {
    if leaves.is_empty() {
        return None;
    }
    let sha256_leaves: Vec<String> = leaves.iter().map(|l| l.sha256.clone()).collect();
    let sha3_leaves: Vec<String> = leaves.iter().map(|l| l.sha3_256.clone()).collect();
    let sha256 = merkle_root_hex::<Sha256>(&sha256_leaves)?;
    let sha3_256 = merkle_root_hex::<Sha3_256>(&sha3_leaves)?;
    Some(DualHash { sha256, sha3_256 })
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

    #[test]
    fn test_dual_merkle_root_empty() {
        assert!(dual_merkle_root(&[]).is_none());
    }

    #[test]
    fn test_dual_merkle_root_single_leaf() {
        let leaf = dual_hash(b"leaf-0");
        let root = dual_merkle_root(&[leaf.clone()]).unwrap();
        assert_eq!(root.sha256, leaf.sha256);
        assert_eq!(root.sha3_256, leaf.sha3_256);
    }

    #[test]
    fn test_dual_merkle_root_deterministic_and_non_trivial() {
        let leaves: Vec<DualHash> = (0..4).map(|i| dual_hash(format!("leaf-{i}").as_bytes())).collect();
        let r1 = dual_merkle_root(&leaves).unwrap();
        let r2 = dual_merkle_root(&leaves).unwrap();
        assert_eq!(r1, r2);
        assert_eq!(r1.sha256.len(), 64);
        assert_eq!(r1.sha3_256.len(), 64);
        assert_ne!(r1.sha256, r1.sha3_256);
    }
}
