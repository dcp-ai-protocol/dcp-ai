//! ML-DSA-65 independent verification vectors on wasm32 (Node): the Rust provider compiled to
//! wasm32-unknown-unknown with the `wasm` feature. Test-only; the npm package exposes no raw
//! ML-DSA verification, so these vectors do not go through its exports.
#![cfg(target_arch = "wasm32")]

use wasm_bindgen_test::*;

mod mldsa65_vectors;

#[wasm_bindgen_test]
fn ml_dsa_65_vector_corpus_integrity() {
    mldsa65_vectors::check_corpus_integrity();
}

#[wasm_bindgen_test]
fn ml_dsa_65_vector_provider_is_sdk_provider() {
    mldsa65_vectors::check_provider_identity();
}

#[wasm_bindgen_test]
fn ml_dsa_65_vector_verdicts() {
    let errored = mldsa65_vectors::check_verdicts();
    console_log!("executed 204, rejected by error {:?}", errored);
}
