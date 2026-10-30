//! RawAuditEventV2 through the shared vectors tests/interop/v2/audit_entry_roundtrip_vectors.json: the
//! hand-written dcp-jcs-v1 text of each entry kept through a decode and encode (P1), the typed struct's current
//! losses (P2: observed behaviour, not a norm), the committed bundle (P3), the typed view (P4), refused shapes (P5),
//! and the no-repair controls on string_evidence_bundle (N0 to N3 required, N4 observed).

use std::collections::BTreeSet;
use std::fs;
use std::path::PathBuf;

use dcp_ai::v2::canonicalize::canonicalize_v2;
use dcp_ai::v2::dual_hash::sha256_hex;
use dcp_ai::v2::session_nonce::parse_rfc3339_millis;
use dcp_ai::v2::types::{AuditEventV2, RawAuditEventV2, VerifierPolicy};
use dcp_ai::v2::verify_bundle::verify_signed_bundle_v2_at;
use serde_json::{json, Value};

fn read(name: &str) -> Value {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../tests/interop/v2").join(name);
    serde_json::from_str(&fs::read_to_string(path).expect("read vectors")).expect("parse vectors")
}

/// The entry text as given: entry_json verbatim, or the entry object written out.
fn entry_text(c: &Value) -> String {
    match c["entry_json"].as_str() {
        Some(text) => text.to_string(),
        None => serde_json::to_string(&c["entry"]).unwrap(),
    }
}

fn raw_roundtrip(v: &Value) -> Value {
    let raw: RawAuditEventV2 = serde_json::from_str(&serde_json::to_string(v).unwrap()).unwrap();
    serde_json::from_str(&serde_json::to_string(&raw).unwrap()).unwrap()
}

fn typed_roundtrip(v: &Value) -> Value {
    let typed: AuditEventV2 = serde_json::from_value(v.clone()).unwrap();
    serde_json::to_value(typed).unwrap()
}

fn with_entries(bundle: &Value, f: fn(&Value) -> Value) -> Value {
    let mut out = bundle.clone();
    for e in out["bundle"]["audit_entries"].as_array_mut().unwrap() {
        *e = f(e);
    }
    out
}

fn mutate(bundle: &Value, m: &Value) -> Value {
    let mut out = bundle.clone();
    let path: Vec<&str> = m["path"].as_array().unwrap().iter().map(|p| p.as_str().unwrap()).collect();
    let mut node = &mut out["bundle"]["audit_entries"][m["entry_index"].as_u64().unwrap() as usize];
    for key in &path[..path.len() - 1] {
        node = &mut node[*key];
    }
    let obj = node.as_object_mut().unwrap();
    match m["op"].as_str().unwrap() {
        "set" => { obj.insert(path[path.len() - 1].to_string(), m["value"].clone()); }
        "delete" => { assert!(obj.remove(path[path.len() - 1]).is_some(), "{}: nothing to delete", m["name"]); }
        op => panic!("unknown op {op}"),
    }
    out
}

fn verify(bundle: &Value, policy: &VerifierPolicy, time: &str) -> (bool, Vec<String>) {
    let r = verify_signed_bundle_v2_at(bundle, policy, parse_rfc3339_millis(time).unwrap());
    (r.result.verified, r.result.errors)
}

#[test]
fn p1_raw_roundtrip_keeps_the_hand_written_canonical_text() {
    let v = read("audit_entry_roundtrip_vectors.json");
    let entries = v["entries"].as_array().unwrap();
    assert_eq!(entries.len(), 14);
    for c in entries {
        let name = c["name"].as_str().unwrap();
        let canonical = c["canonical"].as_str().unwrap();
        assert_eq!(sha256_hex(canonical.as_bytes()), c["canonical_sha256"].as_str().unwrap(), "{name}: committed SHA-256");
        let original: Value = serde_json::from_str(&entry_text(c)).unwrap();
        // The Rust canonicalizer agrees with the hand-written text (cross-SDK contrast).
        assert_eq!(canonicalize_v2(&original).unwrap(), canonical, "{name}: canonicalize_v2");
        let raw: RawAuditEventV2 = serde_json::from_str(&entry_text(c)).unwrap();
        let again: Value = serde_json::from_str(&serde_json::to_string(&raw).unwrap()).unwrap();
        assert_eq!(again, original, "{name}: same value after decode and encode");
        assert_eq!(canonicalize_v2(&again).unwrap(), canonical, "{name}: same dcp-jcs-v1 text");
        assert_eq!(RawAuditEventV2::from_value(original.clone()).unwrap().as_value(), &original, "{name}: from_value keeps it");
    }
}

#[test]
fn p2_typed_struct_losses_are_observed_behaviour_not_a_norm() {
    // Observed behaviour of AuditEventV2 today, pinned so that a change is noticed; the protocol requires nothing here.
    let v = read("audit_entry_roundtrip_vectors.json");
    let changed: BTreeSet<&str> = v["entries"].as_array().unwrap().iter()
        .filter(|c| {
            let original: Value = serde_json::from_str(&entry_text(c)).unwrap();
            canonicalize_v2(&typed_roundtrip(&original)).unwrap() != c["canonical"].as_str().unwrap()
        })
        .map(|c| c["name"].as_str().unwrap())
        .collect();
    let expected: BTreeSet<&str> = [
        "evidence_all_null", "evidence_null_and_absent", "evidence_extra_members", "pq_checkpoint_ref_absent",
        "secondaries_null", "unknown_entry_member", "integers_at_safe_limits", "unicode_key_order_by_code_point",
    ].into_iter().collect();
    assert_eq!(changed, expected);
}

#[test]
fn p3_committed_bundle_verifies_through_raw_entries() {
    let b = read("bundle_vectors.json");
    let policy: VerifierPolicy = serde_json::from_value(b["default_verifier_policy"].clone()).unwrap();
    let time = "2026-10-22T00:00:00Z";
    assert_eq!(verify(&b["signed_bundle"], &policy, time), (true, vec![]));
    assert_eq!(verify(&with_entries(&b["signed_bundle"], raw_roundtrip), &policy, time), (true, vec![]));
    // Observed, not required: the typed struct drops the committed null evidence members, so the chain breaks.
    assert!(!verify(&with_entries(&b["signed_bundle"], typed_roundtrip), &policy, time).0);
}

#[test]
fn p4_typed_view_is_the_typed_decode() {
    let v = read("audit_entry_roundtrip_vectors.json");
    let mut entries: Vec<Value> = v["entries"].as_array().unwrap().iter()
        .map(|c| serde_json::from_str(&entry_text(c)).unwrap()).collect();
    entries.push(json!({ "audit_id": "only" })); // not an AuditEventV2: both fail
    for e in entries {
        let view = RawAuditEventV2::from_value(e.clone()).unwrap().typed();
        let decoded = serde_json::from_value::<AuditEventV2>(e);
        match (view, decoded) {
            (Ok(a), Ok(b)) => assert_eq!(serde_json::to_value(a).unwrap(), serde_json::to_value(b).unwrap()),
            (Err(_), Err(_)) => {}
            (a, b) => panic!("typed() and the typed decode disagree: {:?} / {:?}", a.is_ok(), b.is_ok()),
        }
    }
}

#[test]
fn p5_anything_but_an_object_is_refused() {
    for (value, found) in [(json!([]), "array"), (json!("s"), "string"), (json!(1), "number"), (json!(true), "boolean"), (Value::Null, "null")] {
        let err = RawAuditEventV2::from_value(value.clone()).unwrap_err();
        assert_eq!(err.found(), found);
        assert_eq!(err.to_string(), format!("an audit entry must be a JSON object, found {found}"));
        assert_eq!(RawAuditEventV2::try_from(value.clone()).unwrap_err(), err);
        let de = serde_json::from_value::<RawAuditEventV2>(value).unwrap_err();
        assert!(de.to_string().contains("an audit entry must be a JSON object"), "{de}");
        let _: &dyn std::error::Error = &err;
    }
    // A collection fails as a whole on one bad element; no partial collection.
    assert!(serde_json::from_str::<Vec<RawAuditEventV2>>(r#"[{}, 1]"#).is_err());
    assert_eq!(serde_json::from_str::<Vec<RawAuditEventV2>>(r#"[{}, {"a": null}]"#).unwrap().len(), 2);
    let v: Value = RawAuditEventV2::from_value(json!({ "a": null })).unwrap().into();
    assert_eq!(v, json!({ "a": null }));
}

#[test]
fn n0_to_n4_raw_entries_never_repair_and_keep_errors() {
    let v = read("audit_entry_roundtrip_vectors.json");
    let s = &v["string_evidence_bundle"];
    let policy: VerifierPolicy = serde_json::from_value(s["verifier_policy"].clone()).unwrap();
    let time = s["verification_time"].as_str().unwrap();
    let signed = &s["signed_bundle"];
    // N0: nothing to lose, so the bundle verifies as is and through both types.
    assert_eq!(verify(signed, &policy, time), (true, vec![]));
    assert_eq!(verify(&with_entries(signed, raw_roundtrip), &policy, time), (true, vec![]));
    assert_eq!(verify(&with_entries(signed, typed_roundtrip), &policy, time), (true, vec![]));
    let mut typed_verified = BTreeSet::new();
    let mutations = s["mutations"].as_array().unwrap();
    assert_eq!(mutations.len(), 8);
    for m in mutations {
        let name = m["name"].as_str().unwrap();
        let mutated = mutate(signed, m);
        // N1: every mutation breaks verification before any round trip.
        let before = verify(&mutated, &policy, time);
        assert!(!before.0 && !before.1.is_empty(), "{name}: the mutation alone must fail");
        // N2: through RawAuditEventV2, exactly the same errors, never verified.
        assert_eq!(verify(&with_entries(&mutated, raw_roundtrip), &policy, time), before, "{name}: raw round trip");
        // N4 (observed, not required): the typed struct may restore the signed bytes.
        if verify(&with_entries(&mutated, typed_roundtrip), &policy, time).0 {
            typed_verified.insert(name);
        }
    }
    let observed: BTreeSet<&str> = [
        "prev_hash_secondary_null", "intent_hash_secondary_null", "pq_checkpoint_ref_removed", "unknown_entry_member_added",
        "evidence_member_added", "evidence_member_added_last_entry", "prev_hash_secondary_null_last_entry",
    ].into_iter().collect();
    assert_eq!(typed_verified, observed, "observed typed-struct behaviour changed");
    // N3: a bundle the typed struct broke stays broken, with the same errors, through RawAuditEventV2.
    let b = read("bundle_vectors.json");
    let base_policy: VerifierPolicy = serde_json::from_value(b["default_verifier_policy"].clone()).unwrap();
    let broken = with_entries(&b["signed_bundle"], typed_roundtrip);
    let errors = verify(&broken, &base_policy, "2026-10-22T00:00:00Z");
    assert!(!errors.0);
    assert_eq!(verify(&with_entries(&broken, raw_roundtrip), &base_policy, "2026-10-22T00:00:00Z"), errors);
}
