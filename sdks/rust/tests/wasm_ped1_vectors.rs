//! P-ED-1 at the provider level on wasm32 (Node): the frozen tests/interop/v2/ed25519_ped1_vectors.json through the
//! Ed25519 provider, the V1 `verify_object` and `composite_verify`, compiled to wasm32-unknown-unknown with the `wasm`
//! feature. Test-only, apart from the npm package: it does not go through `DcpWasm` or the wasm-bindgen exports (the
//! browser harness covers the public composite path). Expectations come from the corpus, as in the native
//! tests/ed25519_ped1.rs, whose checks these repeat on this target; the corpus is embedded, so no file is read.
//!
//!   wasm-pack test --node . --locked --features wasm --test wasm_ped1_vectors
#![cfg(target_arch = "wasm32")]

use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use dcp_ai::providers::ed25519::Ed25519Provider;
use dcp_ai::providers::ml_dsa_65::MlDsa65Provider;
use dcp_ai::v2::composite_ops::{composite_sign, composite_verify, CompositeKeyInfo};
use dcp_ai::v2::crypto_provider::{CryptoError, CryptoProvider, GeneratedKeypair};
use dcp_ai::v2::domain_separation::domain_separated_message;
use dcp_ai::v2::dual_hash::sha256_hex;
use dcp_ai::{canonicalize, verify_object};
use serde_json::Value;
use wasm_bindgen_test::*;

const CORPUS: &[u8] = include_bytes!("../../../tests/interop/v2/ed25519_ped1_vectors.json");
const FROZEN: &str = "f5990f8fcc8709c2c3b52e775c8210f0dcb32219c3e7cd36c527e44f49d1e396";

fn corpus() -> Value {
    assert_eq!(sha256_hex(CORPUS), FROZEN, "the corpus is not the frozen one");
    serde_json::from_slice(CORPUS).expect("json")
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

#[wasm_bindgen_test]
fn the_provider_on_the_67_cases() {
    let v = corpus();
    let cases: Vec<&Value> = v["historical"].as_array().unwrap().iter().chain(v["signatures"].as_array().unwrap()).collect();
    assert_eq!(cases.len(), 67);
    let (mut accepted, mut rejected, mut errors) = (0, 0, 0);
    let mut failures = Vec::new();
    for c in cases {
        let (msg, sig, pk) = parts(c);
        let got = Ed25519Provider.verify(&msg, &sig, &b64(&pk));
        let accept = c["accept"].as_bool().unwrap();
        // Same order as the native test: key length, signature length, key decompression (errors), then P-ED-1 and
        // the equation (a boolean).
        let ok = if pk.len() != 32 {
            matches!(&got, Err(CryptoError::KeyError(m)) if m == "invalid public key length (expected 32 bytes)")
        } else if sig.len() != 64 {
            matches!(&got, Err(CryptoError::SignatureError(m)) if m == "invalid signature length (expected 64 bytes)")
        } else if c["a_decodes"] == false {
            matches!(&got, Err(CryptoError::KeyError(_)))
        } else {
            matches!(got, Ok(b) if b == accept)
        };
        match got {
            Ok(true) => accepted += 1,
            Ok(false) => rejected += 1,
            Err(_) => errors += 1,
        }
        if !ok {
            failures.push(format!("{}: got {got:?}, corpus accept {accept}", c["id"]));
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
    console_log!("provider: 67 cases, {accepted} accepted, {rejected} rejected, {errors} errors (each as the corpus requires)");
}

#[wasm_bindgen_test]
fn the_v1_path_on_the_4_objects() {
    let v = corpus();
    let obj = &v["objects"]["object"];
    assert_eq!(hex::encode(canonicalize(obj)), v["objects"]["canonical_hex"].as_str().unwrap());
    for c in v["objects"]["cases"].as_array().unwrap() {
        let (_, sig, pk) = parts(c);
        assert_eq!(verify_object(obj, &b64(&sig), &b64(&pk)), Ok(c["accept"].as_bool().unwrap()), "{}", c["id"]);
    }
}

/// Returns the corpus signature, only for exactly the corpus DSM.
struct FixedClassical {
    dsm: Vec<u8>,
    sig: Vec<u8>,
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
        if message != self.dsm.as_slice() {
            return Err(CryptoError::SignatureError("not the corpus DSM".into()));
        }
        Ok(self.sig.clone())
    }
    fn verify(&self, _: &[u8], _: &[u8], _: &str) -> Result<bool, CryptoError> {
        Err(CryptoError::SignatureError("not used".into()))
    }
}

#[wasm_bindgen_test]
fn composite_over_the_exact_dsm_with_a_real_ml_dsa_key() {
    let v = corpus();
    let context = v["composite"]["context"].as_str().unwrap();
    let payload = v["composite"]["payload_canonical"].as_str().unwrap().as_bytes();
    let dsm = domain_separated_message(context, payload).unwrap();
    assert_eq!(hex::encode(&dsm), v["composite"]["dsm_hex"].as_str().unwrap());
    for c in v["composite"]["cases"].as_array().unwrap() {
        let (_, sig, pk) = parts(c);
        let accept = c["accept"].as_bool().unwrap();
        let fixed = FixedClassical { dsm: dsm.clone(), sig: sig.clone() };
        let pq = MlDsa65Provider.generate_keypair().unwrap();
        let classical_key = CompositeKeyInfo { kid: "ped1-corpus".into(), alg: "ed25519".into(), secret_key_b64: "unused".into(), public_key_b64: b64(&pk) };
        let pq_key = CompositeKeyInfo { kid: pq.kid.clone(), alg: "ml-dsa-65".into(), secret_key_b64: pq.secret_key_b64.clone(), public_key_b64: pq.public_key_b64.clone() };
        let cs = composite_sign(&fixed, &MlDsa65Provider, context, payload, &classical_key, &pq_key).unwrap();
        assert_eq!(cs.classical.sig_b64, b64(&sig));
        let r = composite_verify(&Ed25519Provider, Some(&MlDsa65Provider), context, payload, &cs, &b64(&pk), Some(&pq.public_key_b64)).unwrap();
        assert_eq!((r.valid, r.classical_valid, r.pq_valid), (accept, accept, true), "{}", c["id"]);
    }
}
