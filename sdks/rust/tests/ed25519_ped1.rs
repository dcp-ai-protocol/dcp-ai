//! P-ED-1 (MP-02 F5c): the frozen vectors of tests/interop/v2/ed25519_ped1_vectors.json through the public paths of
//! the Rust SDK. Every expectation comes from the corpus, the predicates of an independent review model; none from the
//! SDK. Design: docs/reviews/mp02-ed25519-implementation-design.md v0.2.4, §§ 4–6. The helper and rejects() are
//! tested inside the crate (src/ed25519_ped1.rs).
//!
//! - historical (26) and signatures (41): `Ed25519Provider::verify`, the V2 provider, with the exact result or error
//!   (§ 4): a wrong key or signature length, and a key that does not decompress, are errors, not `Ok(false)`;
//! - objects (4): `verify_object`, the V1 path, after checking that `canonicalize` gives the corpus bytes;
//! - composite (2): `composite_sign` over the exact DSM, with a classical test provider that returns the corpus
//!   signature only for those bytes and a fresh ML-DSA-65 key, then `composite_verify` with the real providers.
//! The inputs are shared borrows: they cannot change during a call.

use std::sync::Mutex;

use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use dcp_ai::providers::ed25519::Ed25519Provider;
use dcp_ai::providers::ml_dsa_65::MlDsa65Provider;
use dcp_ai::v2::composite_ops::{composite_sign, composite_verify, CompositeKeyInfo};
use dcp_ai::v2::crypto_provider::{CryptoError, CryptoProvider, GeneratedKeypair};
use dcp_ai::v2::domain_separation::domain_separated_message;
use dcp_ai::v2::dual_hash::sha256_hex;
use dcp_ai::{canonicalize, verify_object};
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use serde_json::Value;

const FROZEN: &str = "f5990f8fcc8709c2c3b52e775c8210f0dcb32219c3e7cd36c527e44f49d1e396";

fn corpus() -> Value {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../tests/interop/v2/ed25519_ped1_vectors.json");
    let raw = std::fs::read(path).expect("corpus");
    assert_eq!(sha256_hex(&raw), FROZEN, "the corpus is not the frozen one");
    serde_json::from_slice(&raw).expect("json")
}

fn bytes(v: &Value) -> Vec<u8> {
    hex::decode(v.as_str().unwrap()).unwrap()
}

fn parts(c: &Value) -> (Vec<u8>, Vec<u8>, Vec<u8>) {
    (bytes(&c["message_hex"]), bytes(&c["signature_hex"]), bytes(&c["public_key_hex"]))
}

fn b64(b: &[u8]) -> String {
    STANDARD.encode(b)
}

fn named<'a>(v: &'a Value, id: &str) -> &'a Value {
    ["historical", "signatures"]
        .iter()
        .flat_map(|s| v[*s].as_array().unwrap())
        .chain(v["objects"]["cases"].as_array().unwrap())
        .chain(v["composite"]["cases"].as_array().unwrap())
        .find(|c| c["id"] == id)
        .unwrap_or_else(|| panic!("no case {id}"))
}

/// S + L, little-endian, for a signature whose S + L fits in 32 bytes.
fn s_plus_l(sig: &[u8]) -> Vec<u8> {
    const L: [u8; 32] = [
        0xed, 0xd3, 0xf5, 0x5c, 0x1a, 0x63, 0x12, 0x58, 0xd6, 0x9c, 0xf7, 0xa2, 0xde, 0xf9, 0xde, 0x14, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x10,
    ];
    let mut out = sig[..32].to_vec();
    let mut carry = 0u16;
    for i in 0..32 {
        let t = sig[32 + i] as u16 + L[i] as u16 + carry;
        out.push(t as u8);
        carry = t >> 8;
    }
    assert_eq!(carry, 0);
    out
}

#[test]
fn the_frozen_corpus() {
    let v = corpus();
    let counts: Vec<usize> = ["historical", "encodings", "signatures"].iter().map(|s| v[*s].as_array().unwrap().len()).collect();
    assert_eq!(counts, [26, 52, 41]);
    assert_eq!((v["objects"]["cases"].as_array().unwrap().len(), v["composite"]["cases"].as_array().unwrap().len()), (4, 2));
}

#[test]
fn the_v2_provider_on_the_67_cases() {
    let v = corpus();
    let cases: Vec<&Value> = v["historical"].as_array().unwrap().iter().chain(v["signatures"].as_array().unwrap()).collect();
    assert_eq!(cases.len(), 67);
    let mut failures = Vec::new();
    for c in cases {
        let (msg, sig, pk) = parts(c);
        let got = Ed25519Provider.verify(&msg, &sig, &b64(&pk));
        let id = c["id"].as_str().unwrap();
        let accept = c["accept"].as_bool().unwrap();
        // The order of the provider: key length, signature length, key decompression, then P-ED-1 and the equation.
        let ok = if pk.len() != 32 {
            matches!(&got, Err(CryptoError::KeyError(m)) if m == "invalid public key length (expected 32 bytes)")
        } else if sig.len() != 64 {
            matches!(&got, Err(CryptoError::SignatureError(m)) if m == "invalid signature length (expected 64 bytes)")
        } else if c["a_decodes"] == false {
            matches!(&got, Err(CryptoError::KeyError(_))) // kept as an error, not Ok(false)
        } else {
            matches!(got, Ok(b) if b == accept)
        };
        if !ok {
            failures.push(format!("{id}: got {got:?}, corpus accept {accept}, kind {}", c["kind"]));
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}

#[test]
fn mixed_order_points_are_accepted() {
    let v = corpus();
    for id in ["signature/public-key-mixed-order-k-multiple-of-8", "signature/ped1-mixed-a-and-r-cancel-reduced"] {
        let c = named(&v, id);
        let (msg, sig, pk) = parts(c);
        assert_eq!(c["accept"], true);
        assert!(matches!(Ed25519Provider.verify(&msg, &sig, &b64(&pk)), Ok(true)), "{id}: P-ED-1 does not require torsion-free points");
    }
}

#[test]
fn the_v1_path_on_the_4_objects() {
    let v = corpus();
    let obj = &v["objects"]["object"];
    assert_eq!(hex::encode(canonicalize(obj)), v["objects"]["canonical_hex"].as_str().unwrap());
    for c in v["objects"]["cases"].as_array().unwrap() {
        assert_eq!(c["message_hex"], v["objects"]["canonical_hex"]);
        let (_, sig, pk) = parts(c);
        assert_eq!(verify_object(obj, &b64(&sig), &b64(&pk)), Ok(c["accept"].as_bool().unwrap()), "{}", c["id"]);
    }
}

/// Returns the corpus signature, only for exactly the corpus DSM.
struct FixedClassical {
    dsm: Vec<u8>,
    sig: Vec<u8>,
    calls: Mutex<Vec<Vec<u8>>>,
}

impl CryptoProvider for FixedClassical {
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
        Err(CryptoError::KeyError("not used".into()))
    }
    fn sign(&self, message: &[u8], _: &str) -> Result<Vec<u8>, CryptoError> {
        self.calls.lock().unwrap().push(message.to_vec());
        if message != self.dsm.as_slice() {
            return Err(CryptoError::SignatureError("not the corpus DSM".into()));
        }
        Ok(self.sig.clone())
    }
    fn verify(&self, _: &[u8], _: &[u8], _: &str) -> Result<bool, CryptoError> {
        Err(CryptoError::SignatureError("not used".into()))
    }
}

#[test]
fn composite_over_the_exact_dsm_with_a_real_ml_dsa_key() {
    let v = corpus();
    let context = v["composite"]["context"].as_str().unwrap();
    let payload = v["composite"]["payload_canonical"].as_str().unwrap().as_bytes();
    let dsm = domain_separated_message(context, payload).unwrap();
    assert_eq!(hex::encode(&dsm), v["composite"]["dsm_hex"].as_str().unwrap());
    for c in v["composite"]["cases"].as_array().unwrap() {
        let (_, sig, pk) = parts(c);
        let accept = c["accept"].as_bool().unwrap();
        let fixed = FixedClassical { dsm: dsm.clone(), sig: sig.clone(), calls: Mutex::new(Vec::new()) };
        let pq = MlDsa65Provider.generate_keypair().unwrap();
        let classical_key = CompositeKeyInfo { kid: "ped1-corpus".into(), alg: "ed25519".into(), secret_key_b64: "unused".into(), public_key_b64: b64(&pk) };
        let pq_key = CompositeKeyInfo { kid: pq.kid.clone(), alg: "ml-dsa-65".into(), secret_key_b64: pq.secret_key_b64.clone(), public_key_b64: pq.public_key_b64.clone() };
        let cs = composite_sign(&fixed, &MlDsa65Provider, context, payload, &classical_key, &pq_key).unwrap();
        assert_eq!(*fixed.calls.lock().unwrap(), vec![dsm.clone()]);
        assert_eq!(cs.classical.sig_b64, b64(&sig));
        let r = composite_verify(&Ed25519Provider, Some(&MlDsa65Provider), context, payload, &cs, &b64(&pk), Some(&pq.public_key_b64)).unwrap();
        // The PQ component is real and valid; the corpus says the equation and the byte comparison hold on this DSM, so
        // for the negative the only reason left is P-ED-1.
        assert_eq!((r.valid, r.classical_valid, r.pq_valid), (accept, accept, true), "{}", c["id"]);
    }
}

#[test]
fn combined_defects_keep_the_earlier_error() {
    let v = corpus();
    let (msg, sig, pk) = parts(named(&v, "signature/a-small-order/order-8-26e8958f-05"));
    for bad in [&sig[..63], &[sig.as_slice(), &[0]].concat()[..]] {
        assert!(
            matches!(Ed25519Provider.verify(&msg, bad, &b64(&pk)), Err(CryptoError::SignatureError(m)) if m == "invalid signature length (expected 64 bytes)"),
            "a small-order A with a {}-byte signature",
            bad.len()
        );
    }
    let long_key = [pk.as_slice(), &[0]].concat();
    assert!(matches!(Ed25519Provider.verify(&msg, &sig, &b64(&long_key)), Err(CryptoError::KeyError(m)) if m == "invalid public key length (expected 32 bytes)"));
    assert!(matches!(Ed25519Provider.verify(&msg, &sig[..63], &b64(&long_key)), Err(CryptoError::KeyError(_))), "the key length comes first");
    assert!(matches!(Ed25519Provider.verify(&msg, &sig, &format!("!{}", b64(&pk))), Err(CryptoError::KeyError(m)) if m.starts_with("base64 decode")));
    let (nmsg, nsig, npk) = parts(named(&v, "signature/a-non-canonical-small-order/y-p"));
    assert!(matches!(Ed25519Provider.verify(&nmsg, &[nsig.as_slice(), &[0]].concat(), &b64(&npk)), Err(CryptoError::SignatureError(_))));
    assert!(matches!(Ed25519Provider.verify(&msg, &s_plus_l(&sig), &b64(&pk)), Ok(false)), "a small-order A and S + L: rejected, not an error");
    // A key that does not decompress keeps its error even with S + L.
    let (cmsg, csig, cpk) = parts(named(&v, "public-key-not-on-curve"));
    assert!(matches!(Ed25519Provider.verify(&cmsg, &s_plus_l(&csig), &b64(&cpk)), Err(CryptoError::KeyError(_))));
    // V1: the key length first, then the signature length, as errors.
    let obj = &v["objects"]["object"];
    let o = named(&v, "object/a-small-order");
    let (_, osig, opk) = parts(o);
    assert_eq!(verify_object(obj, &b64(&osig[..63]), &b64(&opk)), Err("invalid signature length".to_string()));
    assert_eq!(verify_object(obj, &b64(&osig), &b64(&opk[..31])), Err("invalid public key length".to_string()));
    assert_eq!(verify_object(obj, &b64(&osig[..63]), &b64(&opk[..31])), Err("invalid public key length".to_string()));
    // V1 with a key that does not decompress: the decompression error is kept, even with S + L; a 63-byte signature
    // is still the signature length error, which comes before the decompression.
    assert_eq!(
        verify_object(obj, &b64(&s_plus_l(&csig)), &b64(&cpk)),
        Err("signature error: Cannot decompress Edwards point".to_string())
    );
    assert_eq!(verify_object(obj, &b64(&csig[..63]), &b64(&cpk)), Err("invalid signature length".to_string()));
}

/// The baseline: ed25519-dalek's verify alone accepts the 16 isolated weak-point negatives. It checks S < L (without
/// `legacy_compatibility`) and R's canonicity through its byte comparison, but neither A's canonicity nor small order;
/// so P-ED-1 is the only reason the provider rejects them. S + L it already rejects.
#[test]
fn the_dalek_baseline() {
    let v = corpus();
    let mut n = 0;
    for c in v["signatures"].as_array().unwrap() {
        let failing: Vec<&str> = c["failing"].as_array().unwrap().iter().map(|x| x.as_str().unwrap()).collect();
        if c["kind"] != "isolated" || failing == ["equation"] {
            continue;
        }
        n += 1;
        let (msg, sig, pk) = parts(c);
        let key = VerifyingKey::from_bytes(&pk.clone().try_into().unwrap()).unwrap();
        let raw = key.verify(&msg, &Signature::from_bytes(&sig.clone().try_into().unwrap())).is_ok();
        assert_eq!(raw, failing != ["s_range"], "{}: ed25519-dalek alone", c["id"]);
        assert!(matches!(Ed25519Provider.verify(&msg, &sig, &b64(&pk)), Ok(false)), "{}: the provider", c["id"]);
    }
    assert_eq!(n, 17);
}
