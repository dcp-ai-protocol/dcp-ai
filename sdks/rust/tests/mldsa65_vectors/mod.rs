//! ML-DSA-65 independent verification vectors (NIST ACVP tc39 + Wycheproof), shared by the
//! native test (`tests/nist_kat.rs`) and the wasm32 tests (`tests/wasm_mldsa65_vectors*.rs`).
//!
//! The provider verifies with the empty FIPS 204 context, so only cases whose context is
//! empty go through it; the others are checked as excluded. The corpus is embedded at
//! compile time, so the wasm32 targets read no file and no environment. Values are copied
//! verbatim from the pinned sources (tests/nist-kat/README.md).

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use dcp_ai::providers::ml_dsa_65::MlDsa65Provider;
use dcp_ai::v2::crypto_provider::{CryptoError, CryptoProvider};
use serde_json::Value;
use sha2::{Digest, Sha256};

pub const WYCHEPROOF: &[u8] =
    include_bytes!("../../../../tests/nist-kat/ml-dsa-65/wycheproof_mldsa_65_verify_test.json");
pub const NIST_TG3: &[u8] = include_bytes!("../../../../tests/nist-kat/ml-dsa-65/acvp_sigver_tg3.json");
pub static VECTOR_PROVIDER: MlDsa65Provider = MlDsa65Provider;

pub struct Case {
    pub source: &'static str,
    pub id: u64,
    pub pk: Vec<u8>,
    pub msg: Vec<u8>,
    pub sig: Vec<u8>,
    pub valid: bool,
}

pub struct Corpus {
    pub wycheproof: Value,
    pub nist: Value,
    pub cases: Vec<Case>,
    pub excluded_wycheproof: Vec<u64>,
    pub excluded_nist: Vec<u64>,
}

fn hex_field(v: &Value, key: &str) -> Vec<u8> {
    hex::decode(v[key].as_str().unwrap_or_else(|| panic!("missing {key}"))).expect("hex")
}

pub fn corpus() -> Corpus {
    let wycheproof: Value = serde_json::from_slice(WYCHEPROOF).expect("parse Wycheproof corpus");
    let nist: Value = serde_json::from_slice(NIST_TG3).expect("parse NIST tg3 corpus");
    let (mut cases, mut excluded_wycheproof, mut excluded_nist) = (Vec::new(), Vec::new(), Vec::new());
    for g in wycheproof["testGroups"].as_array().expect("testGroups") {
        for t in g["tests"].as_array().expect("tests") {
            let id = t["tcId"].as_u64().expect("tcId");
            if t["ctx"].as_str().is_some_and(|c| !c.is_empty()) {
                excluded_wycheproof.push(id);
                continue;
            }
            cases.push(Case {
                source: "wycheproof",
                id,
                pk: hex_field(g, "publicKey"),
                msg: hex_field(t, "msg"),
                sig: hex_field(t, "sig"),
                valid: t["result"] == "valid",
            });
        }
    }
    for t in nist["testGroup"]["tests"].as_array().expect("tests") {
        let id = t["tcId"].as_u64().expect("tcId");
        if t["context"].as_str().is_some_and(|c| !c.is_empty()) {
            excluded_nist.push(id);
            continue;
        }
        cases.push(Case {
            source: "nist",
            id,
            pk: hex_field(t, "pk"),
            msg: hex_field(t, "message"),
            sig: hex_field(t, "signature"),
            valid: t["testPassed"] == true,
        });
    }
    Corpus { wycheproof, nist, cases, excluded_wycheproof, excluded_nist }
}

pub fn check_corpus_integrity() {
    let c = corpus();
    assert_eq!(hex::encode(Sha256::digest(WYCHEPROOF)), "1ca235f61928421a173a171780beb00264ae9155dc33c52a11e1766cc7979034");
    assert_eq!(hex::encode(Sha256::digest(NIST_TG3)), "bacf4ad8e55db0594d8bf2878ca3bd3cb80cfa680aaf05ca8e1788d896f63eb8");
    assert_eq!((c.wycheproof["algorithm"].as_str(), c.wycheproof["numberOfTests"].as_u64()), (Some("ML-DSA-65"), Some(210)));
    let g = &c.nist["testGroup"];
    assert_eq!(
        (g["tgId"].as_u64(), g["parameterSet"].as_str(), g["signatureInterface"].as_str(), g["preHash"].as_str()),
        (Some(3), Some("ML-DSA-65"), Some("external"), Some("pure"))
    );
    assert_eq!(g["tests"].as_array().map(Vec::len), Some(15));
    assert_eq!(c.cases.len(), 204);
    assert_eq!(c.cases.iter().filter(|k| k.valid).count(), 77);
    assert_eq!(c.excluded_wycheproof, [3, 4, 5, 153, 154, 155, 156]);
    assert_eq!(c.excluded_nist, [31, 32, 33, 34, 35, 36, 37, 38, 40, 41, 42, 43, 44, 45]);
    assert_eq!(c.cases.iter().filter(|k| k.source == "nist").map(|k| k.id).collect::<Vec<_>>(), [39]);
}

pub fn check_provider_identity() {
    // The static's type is the SDK provider; its algorithm and sizes are the FIPS 204 ones.
    let p: &MlDsa65Provider = &VECTOR_PROVIDER;
    assert_eq!((p.alg(), p.key_size(), p.sig_size()), ("ml-dsa-65", 1952, 3309));
}

/// Wycheproof cases whose public key is not 1952 bytes or whose signature is not 3309 bytes.
pub const PK_LENGTH_IDS: [u64; 4] = [69, 70, 158, 159];
pub const SIG_LENGTH_IDS: [u64; 3] = [6, 7, 157];

/// Runs the 204 cases through the provider and returns the IDs rejected by an error.
/// An error is a rejection only for those length cases, with the provider's exact length
/// error; any other error, and any panic, fails.
pub fn check_verdicts() -> Vec<u64> {
    let (mut executed, mut errored, mut mismatches) = (0, Vec::new(), Vec::new());
    for k in corpus().cases {
        let observed = VECTOR_PROVIDER.verify(&k.msg, &k.sig, &BASE64.encode(&k.pk));
        executed += 1;
        let wy = k.source == "wycheproof" && !k.valid;
        let pk_size = wy && PK_LENGTH_IDS.contains(&k.id) && k.pk.len() != 1952;
        let sig_size = wy && SIG_LENGTH_IDS.contains(&k.id) && k.pk.len() == 1952 && k.sig.len() != 3309;
        match observed {
            Ok(v) if v == k.valid => {}
            Err(CryptoError::KeyError(m)) if pk_size && m == "invalid ML-DSA-65 public key length: expected 1952" => {
                errored.push(k.id)
            }
            Err(CryptoError::SignatureError(m))
                if sig_size && m == "invalid ML-DSA-65 signature length: expected 3309" =>
            {
                errored.push(k.id)
            }
            other => mismatches.push(format!("{} {}: {} -> {:?}", k.source, k.id, k.valid, other)),
        }
    }
    assert_eq!(mismatches, Vec::<String>::new());
    assert_eq!(executed, 204);
    assert_eq!(errored, [6, 7, 69, 70, 157, 158, 159]);
    errored
}
