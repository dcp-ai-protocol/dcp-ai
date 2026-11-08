//! Admission from bytes (opt-in, MP-02 F3): a V2 signed bundle admitted from the bytes of one JSON text,
//! under `dcp-jcs-v1`. Rust port of the TypeScript SDK's core/v1-ingress.ts; design:
//! docs/reviews/mp02-security-composition-design.md § 3.
//!
//! One route, in this order, over the caller's `&[u8]`: a shared borrow, so nothing can change those bytes
//! during the call and no copy is needed.
//! 1. the candidate scanner, unchanged: its rejections keep their class and offset;
//! 2. the portable integer domain: every number literal outside strings is a plain integer, with no
//!    fraction, no exponent and no `-0` (`NUMBER_NOT_PORTABLE`, at the literal's first byte);
//! 3. `serde_json::from_slice` into a [`Value`], canonicalized with `dcp-jcs-v1` and compared byte for byte
//!    with the scanner's canonical bytes: a difference or a parser failure is a local fault,
//!    `INGRESS_PARSER_MISMATCH`;
//! 4. [`admit_signed_bundle_v2`] over that same [`Value`].
//!
//! Nothing else changes: `dcp-jcs-v1`, the candidate `dcp-jcs-v2`, the scanner, the profiles, the defaults
//! and `admit_signed_bundle_v2` keep their behavior. A transport that rewrites `100` as `100.0` is rejected
//! here even when the signature still verifies over the parsed value.

use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};

use super::admission::{admit_signed_bundle_v2, AdmissionConfigError, AdmissionResult, AdmitOptions};
use super::canonicalize::canonicalize_v2;
use super::experimental_candidate_ingress::{
    experimental_candidate_ingress, CandidateIngressInternalError, CandidateIngressOutcome,
};

/// The ingress verdict of [`admit_signed_bundle_v2_from_bytes`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct IngressOutcome {
    pub accepted: bool,
    /// The step that rejected: `scanner`, `domain` or `parser`; None when accepted.
    pub layer: Option<String>,
    pub class: Option<String>,
    /// Byte offset in the input; None when accepted and for a parser fault.
    pub offset: Option<usize>,
    /// SHA-256 of the input bytes.
    pub unit_sha256: String,
    /// SHA-256 of the canonical bytes; None when rejected.
    pub canonical_sha256: Option<String>,
}

/// The result of [`admit_signed_bundle_v2_from_bytes`]. `admission` is None and `value` null when the
/// ingress rejects, as nothing was verified.
#[derive(Debug, Clone, Serialize)]
pub struct IngressAdmissionResult {
    pub ingress: IngressOutcome,
    pub admission: Option<AdmissionResult>,
    /// The parsed value admission received.
    pub value: Value,
}

/// A broken scanner invariant or a configuration error of [`admit_signed_bundle_v2`]; never a rejection of
/// the data.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum IngressError {
    #[error(transparent)]
    Internal(#[from] CandidateIngressInternalError),
    #[error(transparent)]
    Config(#[from] AdmissionConfigError),
}

/// `-?(0|[1-9][0-9]*)`, and not `-0`.
fn is_portable_integer(literal: &[u8]) -> bool {
    let digits = literal.strip_prefix(b"-").unwrap_or(literal);
    let well_formed = match digits {
        [b'0'] => true,
        [b'1'..=b'9', rest @ ..] => rest.iter().all(u8::is_ascii_digit),
        _ => false,
    };
    well_formed && literal != b"-0"
}

/// The offset of the first number literal outside strings that is not a plain integer. Only for a unit the
/// scanner accepted, so the text is well-formed JSON and every string is closed.
fn first_non_portable_number(b: &[u8]) -> Option<usize> {
    let mut in_string = false;
    let mut i = 0;
    while i < b.len() {
        let c = b[i];
        if in_string {
            if c == b'\\' {
                i += 2; // the escaped byte cannot end the string
                continue;
            }
            if c == b'"' {
                in_string = false;
            }
            i += 1;
        } else if c == b'"' {
            in_string = true;
            i += 1;
        } else if c == b'-' || c.is_ascii_digit() {
            let mut j = i + 1;
            while j < b.len() && matches!(b[j], b'0'..=b'9' | b'.' | b'e' | b'E' | b'+' | b'-') {
                j += 1;
            }
            if !is_portable_integer(&b[i..j]) {
                return Some(i);
            }
            i = j;
        } else {
            i += 1;
        }
    }
    None
}

/// Admits a V2 signed bundle from the bytes of one JSON text (see the module documentation). A rejected
/// ingress is an `Ok` result with `admission: None`.
pub fn admit_signed_bundle_v2_from_bytes(
    bytes: &[u8],
    options: &AdmitOptions<'_>,
) -> Result<IngressAdmissionResult, IngressError> {
    admit_with_parser(|unit| serde_json::from_slice(unit).map_err(|e| e.to_string()), bytes, options)
}

/// The same route with another parser. Private: only the unit tests below pass another one, to show that a
/// parser fault is caught; no request or option selects it.
fn admit_with_parser(
    parse: impl Fn(&[u8]) -> Result<Value, String>,
    bytes: &[u8],
    options: &AdmitOptions<'_>,
) -> Result<IngressAdmissionResult, IngressError> {
    let unit_sha256 = hex::encode(Sha256::digest(bytes));
    let reject = |layer: &str, class: &str, offset: Option<usize>| IngressAdmissionResult {
        ingress: IngressOutcome {
            accepted: false,
            layer: Some(layer.into()),
            class: Some(class.into()),
            offset,
            unit_sha256: unit_sha256.clone(),
            canonical_sha256: None,
        },
        admission: None,
        value: Value::Null,
    };

    let (canonical, canonical_sha256) = match experimental_candidate_ingress(bytes)? {
        CandidateIngressOutcome::Reject { class, offset } => return Ok(reject("scanner", class.as_str(), Some(offset))),
        CandidateIngressOutcome::Accept { canonical, canonical_sha256, .. } => (canonical, canonical_sha256),
    };
    if let Some(at) = first_non_portable_number(bytes) {
        return Ok(reject("domain", "NUMBER_NOT_PORTABLE", Some(at)));
    }
    let value = match parse(bytes) {
        Ok(value) if canonicalize_v2(&value).is_ok_and(|c| c.as_bytes() == canonical.as_slice()) => value,
        _ => return Ok(reject("parser", "INGRESS_PARSER_MISMATCH", None)),
    };

    let admission = admit_signed_bundle_v2(&value, options)?;
    Ok(IngressAdmissionResult {
        ingress: IngressOutcome {
            accepted: true,
            layer: None,
            class: None,
            offset: None,
            unit_sha256,
            canonical_sha256: Some(canonical_sha256),
        },
        admission: Some(admission),
        value,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::v2::admission::{resolve_strict_v1_profile, PrincipalTrustStore};
    use crate::v2::session_nonce::parse_rfc3339_millis;
    use serde_json::json;

    fn vectors() -> Value {
        let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../tests/interop/v2/delegated_admission_vectors.json");
        serde_json::from_str(&std::fs::read_to_string(path).expect("vectors")).expect("json")
    }

    fn parse(unit: &[u8]) -> Result<Value, String> {
        serde_json::from_slice(unit).map_err(|e| e.to_string())
    }

    fn fault(unit: &[u8]) -> IngressOutcome {
        IngressOutcome {
            accepted: false,
            layer: Some("parser".into()),
            class: Some("INGRESS_PARSER_MISMATCH".into()),
            offset: None,
            unit_sha256: hex::encode(Sha256::digest(unit)),
            canonical_sha256: None,
        }
    }

    #[test]
    fn a_parser_fault_is_caught_before_admission() {
        let v = vectors();
        let profile = resolve_strict_v1_profile(&v["profiles"]["strict"]).unwrap();
        let store = PrincipalTrustStore::from_json(&v["trust_sets"]["base"]).unwrap();
        let options = AdmitOptions {
            profile: Some(&profile),
            trust: Some(&store),
            revocation: Some(&v["revocations"]["all_not_revoked"]),
            now_ms: Some(parse_rfc3339_millis(v["now"].as_str().unwrap()).unwrap()),
            ..Default::default()
        };
        let unit = serde_json::to_vec(&v["signed_bundles"]["orch"]).unwrap();

        let correct = admit_with_parser(parse, &unit, &options).unwrap();
        assert!(correct.ingress.accepted && correct.admission.as_ref().unwrap().admitted, "the correct parser admits");

        let altered = admit_with_parser(
            |u| {
                let mut value = parse(u)?;
                value["extra"] = json!(1);
                Ok(value)
            },
            &unit,
            &options,
        )
        .unwrap();
        assert_eq!(altered.ingress, fault(&unit), "a parser that returns another value");
        assert!(altered.admission.is_none() && altered.value.is_null());

        let failing = admit_with_parser(|_| Err("broken parser".into()), &unit, &options).unwrap();
        assert_eq!(failing.ingress, fault(&unit), "a parser that fails");
        assert!(failing.admission.is_none() && failing.value.is_null());

        let small = br#"{"n":1}"#;
        let float = admit_with_parser(|_| Ok(json!({ "n": 1.5 })), small, &AdmitOptions::default()).unwrap();
        assert_eq!(float.ingress, fault(small), "a parser that changes a number to a non-integer");
    }

    #[test]
    fn portable_integer_literals() {
        for ok in ["0", "-1", "10", "9007199254740991", "-9007199254740991"] {
            assert!(is_portable_integer(ok.as_bytes()), "{ok}");
        }
        for not in ["-0", "01", "-01", "1.0", "1e2", "1E+2", "-", "", "--1", "+1"] {
            assert!(!is_portable_integer(not.as_bytes()), "{not}");
        }
    }
}
