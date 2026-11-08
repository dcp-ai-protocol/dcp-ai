//! P-ED-1, the Ed25519 acceptance criterion of DCP (docs/reviews/mp02-ed25519-implementation-design.md).
//!
//! Internal: used by `crypto::verify_object` (V1) and by the Ed25519 provider (V2), after
//! `VerifyingKey::from_bytes` (a key that does not decode keeps its error) and before ed25519-dalek's `verify`.
//! A signature is rejected when S >= L, when A or R is not a canonical encoding, or when A or R is one of the 8
//! points of order dividing 8 (the identity included). ed25519-dalek then checks the equation [S]B = R + [k]A with
//! k = SHA-512(R || A || M) mod L, without cofactor, comparing the compressed computed R with the bytes of R.
//!
//! S < L is checked here so that it does not depend on ed25519-dalek's `legacy_compatibility` feature, which another
//! crate could enable on the same dependency. The checks compare bytes with constants, with no curve arithmetic.
//! Mixed-order points are not rejected: P-ED-1 does not require torsion-free points.

/// L = 2^252 + 27742317777372353535851937790883648493, little-endian.
const L: [u8; 32] = [
    0xed, 0xd3, 0xf5, 0x5c, 0x1a, 0x63, 0x12, 0x58, 0xd6, 0x9c, 0xf7, 0xa2, 0xde, 0xf9, 0xde, 0x14, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x10,
];

/// The canonical encodings of the 8 points of E[8], derived by the independent review model
/// (.claude/mp02-20261107/claude-f5-design/small-order-points.json) and equal to the constants of
/// tests/interop/v2/ed25519_ped1_vectors.json.
pub(crate) const SMALL_ORDER_ENCODINGS_HEX: [&str; 8] = [
    "0000000000000000000000000000000000000000000000000000000000000000", // order 4
    "0000000000000000000000000000000000000000000000000000000000000080", // order 4
    "0100000000000000000000000000000000000000000000000000000000000000", // order 1, the identity
    "26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc05", // order 8
    "26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc85", // order 8
    "c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac037a", // order 8
    "c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac03fa", // order 8
    "ecffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f", // order 2
];

const fn nibble(c: u8) -> u8 {
    match c {
        b'0'..=b'9' => c - b'0',
        b'a'..=b'f' => c - b'a' + 10,
        _ => panic!("ed25519_ped1: not lowercase hex"),
    }
}

/// Decoded at compile time: a malformed entry does not build.
const fn decode32(s: &str) -> [u8; 32] {
    let b = s.as_bytes();
    assert!(b.len() == 64, "ed25519_ped1: an entry is not 32 bytes");
    let mut out = [0u8; 32];
    let mut i = 0;
    while i < 32 {
        out[i] = nibble(b[2 * i]) << 4 | nibble(b[2 * i + 1]);
        i += 1;
    }
    out
}

const SMALL_ORDER: [[u8; 32]; 8] = [
    decode32(SMALL_ORDER_ENCODINGS_HEX[0]),
    decode32(SMALL_ORDER_ENCODINGS_HEX[1]),
    decode32(SMALL_ORDER_ENCODINGS_HEX[2]),
    decode32(SMALL_ORDER_ENCODINGS_HEX[3]),
    decode32(SMALL_ORDER_ENCODINGS_HEX[4]),
    decode32(SMALL_ORDER_ENCODINGS_HEX[5]),
    decode32(SMALL_ORDER_ENCODINGS_HEX[6]),
    decode32(SMALL_ORDER_ENCODINGS_HEX[7]),
];

/// Whether S, the second half of a 64-byte signature, is below L.
pub(crate) fn scalar_below_l(sig: &[u8; 64]) -> bool {
    for i in (0..32).rev() {
        if sig[32 + i] != L[i] {
            return sig[32 + i] < L[i];
        }
    }
    false // S = L
}

/// Whether 32 bytes have y < p (y little-endian, bit 255 cleared) and no sign bit when x = 0, that is when y = 1 or
/// y = p - 1. Whether the point is on the curve is left to ed25519-dalek, which rejects a key that does not decompress,
/// and to its byte comparison of R.
pub(crate) fn is_canonical_encoding(b: &[u8]) -> bool {
    if b.len() != 32 {
        return false;
    }
    let top = b[31] & 0x7f;
    let middle_all_ff = b[1..31].iter().all(|&x| x == 0xff);
    let middle_all_zero = b[1..31].iter().all(|&x| x == 0);
    // p = 2^255 - 19 is ed ff .. ff 7f: y >= p only with the same middle and top, and a low byte >= 0xed.
    if top == 0x7f && middle_all_ff && b[0] >= 0xed {
        return false;
    }
    if b[31] & 0x80 != 0 {
        let y_is_one = b[0] == 1 && middle_all_zero && top == 0;
        let y_is_p_minus_one = b[0] == 0xec && middle_all_ff && top == 0x7f;
        if y_is_one || y_is_p_minus_one {
            return false;
        }
    }
    true
}

/// Whether 32 bytes are one of the 8 encodings of E[8]; meant for an encoding already found canonical.
pub(crate) fn is_small_order_encoding(b: &[u8]) -> bool {
    b.len() == 32 && SMALL_ORDER.iter().any(|t| t[..] == b[..])
}

/// Whether P-ED-1 rejects a signature before ed25519-dalek. The inputs are only read.
pub(crate) fn rejects(sig: &[u8; 64], pk: &[u8; 32]) -> bool {
    let r = &sig[..32];
    !scalar_below_l(sig)
        || !is_canonical_encoding(pk)
        || is_small_order_encoding(pk)
        || !is_canonical_encoding(r)
        || is_small_order_encoding(r)
}

#[cfg(test)]
mod tests {
    //! What needs the module's internals: the helper over the 52 corpus encodings, S < L alone, and rejects() over
    //! the 67 historical and signature cases (byte predicates only; decoding is ed25519-dalek's).
    use super::*;
    use serde_json::Value;
    use sha2::{Digest, Sha256};

    fn corpus() -> Value {
        let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../tests/interop/v2/ed25519_ped1_vectors.json");
        let raw = std::fs::read(path).expect("corpus");
        assert_eq!(
            hex::encode(Sha256::digest(&raw)),
            "f5990f8fcc8709c2c3b52e775c8210f0dcb32219c3e7cd36c527e44f49d1e396",
            "the corpus is not the frozen one"
        );
        serde_json::from_slice(&raw).expect("json")
    }

    fn bytes(v: &Value) -> Vec<u8> {
        hex::decode(v.as_str().unwrap()).unwrap()
    }

    #[test]
    fn the_table_is_the_corpus_e8() {
        let v = corpus();
        let got: Vec<&str> = SMALL_ORDER_ENCODINGS_HEX.to_vec();
        let want: Vec<&str> = v["constants"]["small_order_encodings_hex"].as_array().unwrap().iter().map(|x| x.as_str().unwrap()).collect();
        assert_eq!(got, want);
    }

    #[test]
    fn the_52_encodings() {
        let v = corpus();
        let encodings = v["encodings"].as_array().unwrap();
        assert_eq!(encodings.len(), 52);
        for e in encodings {
            let b = bytes(&e["encoding_hex"]);
            let canonical = e["canonical_rule"].as_bool().unwrap();
            // The corpus small_order is about the decoded point; the helper compares bytes after the canonical check.
            let in_table = canonical && e["small_order"].as_bool() == Some(true);
            assert_eq!(is_canonical_encoding(&b), canonical, "{}", e["id"]);
            assert_eq!(is_small_order_encoding(&b), in_table, "{}", e["id"]);
        }
        for n in [0, 31, 33] {
            assert!(!is_canonical_encoding(&vec![0u8; n]) && !is_small_order_encoding(&vec![0u8; n]), "{n} bytes");
        }
    }

    #[test]
    fn s_below_l_alone() {
        let sig = |s: [u8; 32]| {
            let mut out = [0u8; 64];
            out[32..].copy_from_slice(&s);
            out
        };
        let mut l_minus_1 = L;
        l_minus_1[0] -= 1;
        let mut l_plus_1 = L;
        l_plus_1[0] += 1;
        let mut l_plus_2_248 = L;
        l_plus_2_248[31] += 1;
        assert!(scalar_below_l(&sig([0; 32])) && scalar_below_l(&sig(l_minus_1)));
        for s in [L, l_plus_1, l_plus_2_248, [0xff; 32]] {
            assert!(!scalar_below_l(&sig(s)));
        }
    }

    #[test]
    fn rejects_on_the_67_cases() {
        let v = corpus();
        let mut n = 0;
        for c in v["historical"].as_array().unwrap().iter().chain(v["signatures"].as_array().unwrap()) {
            n += 1;
            if c["kind"] == "length" {
                continue; // rejects() takes 64- and 32-byte arrays; the lengths are the callers' errors
            }
            let sig: [u8; 64] = bytes(&c["signature_hex"]).try_into().unwrap();
            let pk: [u8; 32] = bytes(&c["public_key_hex"]).try_into().unwrap();
            let p = |k: &str| c[k].as_bool().unwrap();
            let want = !p("s_below_l") || !p("a_canonical") || !p("r_canonical") || p("a_small_order") || p("r_small_order");
            assert_eq!(rejects(&sig, &pk), want, "{}", c["id"]);
        }
        assert_eq!(n, 67);
    }
}
