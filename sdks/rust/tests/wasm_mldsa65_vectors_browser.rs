//! Same vectors as tests/wasm_mldsa65_vectors.rs, run in a browser (local sample).
#![cfg(target_arch = "wasm32")]

use wasm_bindgen_test::*;

mod mldsa65_vectors;

wasm_bindgen_test_configure!(run_in_browser);

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
