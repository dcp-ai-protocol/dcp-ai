//! Multi-party authorization under the opt-in mpa-v1 profile (spec/profiles/multi-party): the
//! shared vectors in tests/interop/v2/multi_party_vectors.json, through the public API, and what
//! the vectors cannot express. Mirrors sdks/typescript/src/__tests__/multi-party-auth.test.ts.
//! How many signatures an evaluation verifies is tested next to the code, which has the seam.

use std::collections::BTreeSet;
use std::sync::OnceLock;

use dcp_ai::providers::ed25519::Ed25519Provider;
use dcp_ai::providers::ml_dsa_65::MlDsa65Provider;
use dcp_ai::v2::composite_ops::CompositeKeyInfo;
use dcp_ai::v2::crypto_provider::CryptoProvider;
use dcp_ai::v2::multi_party_auth::{
    build_multi_party_authorization, check_multi_party_authorization_structure, create_multi_party_request,
    create_party_authorization, evaluate_multi_party_authorization, MultiPartyConfigError, MultiPartyEvaluation,
    MultiPartyExpected, MultiPartyOptions, MultiPartyPolicy, MultiPartyPolicyStore, MultiPartyRequestInput, MPA_V1,
    MPA_V1_MAX_AUTHORIZATIONS,
};
use dcp_ai::v2::PrincipalTrustStore;
use serde_json::{json, Value};

fn vectors() -> &'static Value {
    static VECTORS: OnceLock<Value> = OnceLock::new();
    VECTORS.get_or_init(|| {
        let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../tests/interop/v2/multi_party_vectors.json");
        serde_json::from_str(&std::fs::read_to_string(path).expect("read multi-party vectors")).expect("parse")
    })
}

fn case(name: &str) -> &'static Value {
    vectors()["cases"].as_array().unwrap().iter().find(|c| c["name"] == name).expect(name)
}

fn text(v: &Value) -> &str {
    v.as_str().expect("a string")
}

/// Evaluate a case of the vectors, on its own record or on another one.
fn evaluate(c: &Value, record: Option<&Value>) -> Result<MultiPartyEvaluation, MultiPartyConfigError> {
    let v = vectors();
    let policy = MultiPartyPolicyStore::from_json(&v["policy_sets"][text(&c["policy_set"])]).expect("policy set");
    let trust = PrincipalTrustStore::from_json(&v["trust_sets"][text(&c["trust_set"])]).expect("trust set");
    let expected = MultiPartyExpected {
        operation: text(&c["expected"]["operation"]),
        target: text(&c["expected"]["target"]),
        parameters: &c["expected"]["parameters"],
    };
    let options = MultiPartyOptions { policy: &policy, trust: &trust, expected, now_ms: c["now_ms"].as_i64().unwrap() };
    evaluate_multi_party_authorization(record.unwrap_or(&v["records"][text(&c["record"])]), &options)
}

fn codes(r: &MultiPartyEvaluation) -> Vec<&'static str> {
    r.errors.iter().map(|e| e.code).collect::<BTreeSet<_>>().into_iter().collect()
}

#[test]
fn multi_party_vectors() {
    let v = vectors();
    assert_eq!(v["profile"], MPA_V1);
    assert_eq!(v["max_authorizations"], MPA_V1_MAX_AUTHORIZATIONS);
    let cases = v["cases"].as_array().expect("cases");
    assert!(cases.len() >= 62, "the vectors lost cases: {}", cases.len());
    let mut failures = Vec::new();
    for c in cases {
        let name = text(&c["name"]);
        let r = evaluate(c, None).expect("a result");
        let got = json!({
            "authorized": r.authorized,
            "structure": r.structure,
            "verification": r.verification,
            "parties_counted": r.parties_counted,
            "required_parties": r.required_parties,
            "codes": codes(&r),
        });
        if got != c["expect"] {
            failures.push(format!("{name} ({}):\n   got {got}\n  want {}", text(&c["rule"]), c["expect"]));
            continue;
        }
        let rec = &v["records"][text(&c["record"])];
        let mut wrong = |what: &str| failures.push(format!("{name}: {what}"));
        if r.profile != "mpa-v1"
            || r.policy_set_version != text(&v["policy_sets"][text(&c["policy_set"])]["policy_set_version"])
            || r.trust_set_version != text(&v["trust_sets"][text(&c["trust_set"])]["trust_set_version"])
        {
            wrong("profile or configuration versions");
        }
        if c["expect"]["structure"] == "valid" {
            let req = &rec["operation_payload"]["request"];
            if r.operation.as_deref() != rec["operation"].as_str()
                || r.target.as_deref() != req["target"].as_str()
                || r.request_id.as_deref() != req["request_id"].as_str()
                || r.expires_at.as_deref() != req["expires_at"].as_str()
            {
                wrong("the signed request is not echoed");
            }
            let authorizations = rec["authorizations"].as_array().unwrap();
            let same = r.parties.len() == authorizations.len()
                && r.parties.iter().zip(authorizations).all(|(p, a)| p.party_id == text(&a["party_id"]) && p.role == text(&a["role"]));
            if !same {
                wrong("the parties are not the authorizations");
            }
            if r.parties.iter().any(|p| p.verified.is_none() != (c["expect"]["verification"] == "not_evaluated")) {
                wrong("verified is set exactly when signatures were read");
            }
            if let Some(counted) = c["expect"]["parties_counted"].as_u64() {
                if r.parties.iter().filter(|p| p.verified == Some(true)).count() as u64 != counted {
                    wrong("the parties verified are not the parties counted");
                }
            }
        } else if r.operation.is_some() || r.target.is_some() || r.request_id.is_some() || r.expires_at.is_some() || !r.parties.is_empty() {
            wrong("a malformed record echoes nothing");
        }
        if r.errors.iter().any(|e| e.message.chars().count() > 300) {
            wrong("a message longer than 300 characters");
        }
        // The JSON form keeps the names of the profile.
        let json = serde_json::to_value(&r).expect("serialize");
        let members: Vec<&str> = json.as_object().unwrap().keys().map(String::as_str).collect::<BTreeSet<_>>().into_iter().collect();
        if members != ["authorized", "errors", "expires_at", "operation", "parties", "parties_counted", "policy_set_version", "profile", "request_id", "required_parties", "structure", "target", "trust_set_version", "verification"] {
            wrong("JSON members");
        }
    }
    assert!(failures.is_empty(), "{} of {} cases:\n{}", failures.len(), cases.len(), failures.join("\n"));
}

#[test]
fn policy_set_configuration() {
    let cases = vectors()["config_cases"].as_array().expect("config cases");
    assert!(cases.len() >= 21);
    for c in cases {
        let loaded = MultiPartyPolicyStore::from_json(&c["policy_set"]);
        match c["expect_code"].as_str() {
            None => assert!(loaded.is_ok(), "{}: {:?}", c["name"], loaded.err()),
            Some(code) => assert_eq!(loaded.err().map(|e| e.code), Some(code), "{}", c["name"]),
        }
    }
    for not_an_object in [json!(null), json!([]), json!("x"), json!(7)] {
        assert_eq!(MultiPartyPolicyStore::from_json(&not_an_object).err().map(|e| e.code), Some("CONFIG_INVALID_VALUE"));
    }
    let store = MultiPartyPolicyStore::from_json(&vectors()["policy_sets"]["base"]).unwrap();
    assert_eq!((store.version(), store.audience(), store.max_validity_seconds()), ("2026-11-18.1", "verifier:acme-gateway", 1800));
}

#[test]
fn a_key_under_two_parties_does_not_load() {
    let cases = vectors()["trust_config_cases"].as_array().expect("trust config cases");
    assert!(!cases.is_empty());
    for c in cases {
        // The evaluation takes a loaded store only, so a trust set that does not load is never evaluated.
        assert_eq!(PrincipalTrustStore::from_json(&c["trust_set"]).err().map(|e| e.code), c["expect_code"].as_str(), "{}", c["name"]);
    }
}

#[test]
fn keeps_no_state() {
    let c = case("two_of_three");
    let threads: Vec<_> = (0..4).map(|_| std::thread::spawn(move || evaluate(c, None).expect("a result").authorized)).collect();
    assert!(threads.into_iter().all(|t| t.join().unwrap()));
    assert!(evaluate(c, None).unwrap().authorized);
}

#[test]
fn a_record_that_is_not_an_object_gets_a_result() {
    let c = case("two_of_three");
    for record in [json!(null), json!([]), json!("record"), json!(7), json!(true), json!(1.5)] {
        let r = evaluate(c, Some(&record)).expect("a result");
        assert!(!r.authorized && r.structure == "invalid" && codes(&r) == ["MPA_SCHEMA_INVALID"], "{record}: {r:?}");
    }
}

#[test]
fn does_not_take_a_role_from_the_record() {
    let c = case("required_role_missing");
    let mut promoted = vectors()["records"][text(&c["record"])].clone();
    promoted["authorizations"][0]["role"] = json!("owner"); // an unsigned change of role
    let r = evaluate(c, Some(&promoted)).unwrap();
    assert!(!r.authorized);
    assert_eq!(codes(&r), ["MPA_ROLE_MISMATCH"]);
}

#[test]
fn what_the_executor_states_wrongly_is_an_error_not_a_decision() {
    let v = vectors();
    let c = case("two_of_three");
    let policy = MultiPartyPolicyStore::from_json(&v["policy_sets"]["base"]).unwrap();
    let trust = PrincipalTrustStore::from_json(&v["trust_sets"]["base"]).unwrap();
    let (parameters, not_an_object, not_representable) = (c["expected"]["parameters"].clone(), json!("none"), json!({ "ratio": 0.5 }));
    let good = MultiPartyExpected { operation: "revoke_agent", target: "agent:acme-bot", parameters: &parameters };
    for expected in [
        MultiPartyExpected { operation: "delete_everything", ..good },
        MultiPartyExpected { target: "", ..good },
        MultiPartyExpected { parameters: &not_an_object, ..good },
        MultiPartyExpected { parameters: &not_representable, ..good },
    ] {
        let options = MultiPartyOptions { policy: &policy, trust: &trust, expected, now_ms: c["now_ms"].as_i64().unwrap() };
        let refused = evaluate_multi_party_authorization(&v["records"][text(&c["record"])], &options);
        assert_eq!(refused.err().map(|e| e.code), Some("CONFIG_INVALID_VALUE"));
    }
}

struct Party {
    id: &'static str,
    classical: CompositeKeyInfo,
    pq: CompositeKeyInfo,
    trusted: Value,
}

fn party(id: &'static str) -> Party {
    let (c, p) = (Ed25519Provider.generate_keypair().unwrap(), MlDsa65Provider.generate_keypair().unwrap());
    let trusted = json!({ "human_id": id, "keys": [
        { "kid": c.kid, "alg": "ed25519", "public_key_b64": c.public_key_b64, "status": "active" },
        { "kid": p.kid, "alg": "ml-dsa-65", "public_key_b64": p.public_key_b64, "status": "active" },
    ] });
    Party {
        id,
        classical: CompositeKeyInfo { kid: c.kid, alg: "ed25519".into(), secret_key_b64: c.secret_key_b64, public_key_b64: c.public_key_b64 },
        pq: CompositeKeyInfo { kid: p.kid, alg: "ml-dsa-65".into(), secret_key_b64: p.secret_key_b64, public_key_b64: p.public_key_b64 },
        trusted,
    }
}

#[test]
fn what_the_sdk_signs_the_sdk_authorizes() {
    let (owner, admin) = (party("human:owner"), party("human:admin"));
    let now = 1_795_003_200_000; // 2026-11-18T12:00:00Z
    let parameters = json!({ "reason": "administrative" });
    let input = MultiPartyRequestInput {
        target: "agent:signed-here",
        audience: "verifier:here",
        parameters: Some(&parameters),
        validity_seconds: 600,
        issued_at_ms: Some(now),
        request_id: None,
    };
    let payload = create_multi_party_request(&input).unwrap();
    let request = &payload["request"];
    assert_eq!(request["profile"], "mpa-v1");
    assert_eq!((text(&request["target"]), text(&request["audience"])), ("agent:signed-here", "verifier:here"));
    assert_eq!((text(&request["issued_at"]), text(&request["expires_at"])), ("2026-11-18T12:00:00.000Z", "2026-11-18T12:10:00.000Z"));
    let id = text(&request["request_id"]).to_string();
    assert!(id.len() == 36 && id.starts_with("mpa:") && id[4..].bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f')), "{id}");
    assert_ne!(create_multi_party_request(&input).unwrap()["request"]["request_id"], json!(id));

    let sign = |p: &Party, role: &str| {
        create_party_authorization(&Ed25519Provider, &MlDsa65Provider, "revoke_agent", &payload, p.id, role, &p.classical, &p.pq).unwrap()
    };
    let record = build_multi_party_authorization("revoke_agent", &payload, vec![sign(&owner, "owner"), sign(&admin, "org_admin")], 0);
    assert_eq!(record["required_parties"], 2);

    let policy = MultiPartyPolicyStore::from_json(&json!({
        "policy_set_version": "here.1", "profile": "mpa-v1", "audience": "verifier:here", "max_validity_seconds": 600,
        "subjects": [{
            "target": "agent:signed-here",
            "parties": [{ "party_id": owner.id, "role": "owner" }, { "party_id": admin.id, "role": "org_admin" }],
            "operations": { "revoke_agent": { "required_parties": 2, "allowed_roles": ["owner", "org_admin"], "required_roles": ["owner"] } },
        }],
    }))
    .unwrap();
    let trust = PrincipalTrustStore::from_json(&json!({ "trust_set_version": "here.1", "principals": [owner.trusted, admin.trusted] })).unwrap();
    let options = MultiPartyOptions {
        policy: &policy,
        trust: &trust,
        expected: MultiPartyExpected { operation: "revoke_agent", target: "agent:signed-here", parameters: &parameters },
        now_ms: now + 1000,
    };
    let r = evaluate_multi_party_authorization(&record, &options).unwrap();
    assert!(r.errors.is_empty(), "{:?}", r.errors);
    assert!(r.authorized);
    assert_eq!((r.parties_counted, r.request_id.as_deref()), (Some(2), Some(id.as_str())));
    // The structure of the same record says nothing about who signed.
    assert!(check_multi_party_authorization_structure(&record, None).valid);
}

#[test]
fn a_request_built_with_no_clock_given_is_issued_now() {
    let (owner, admin) = (party("human:owner"), party("human:admin"));
    let empty = json!({});
    let input = MultiPartyRequestInput {
        target: "agent:signed-here",
        audience: "verifier:here",
        parameters: None,
        validity_seconds: 60,
        issued_at_ms: None,
        request_id: None,
    };
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis() as i64;
    let payload = create_multi_party_request(&input).unwrap();
    let sign = |p: &Party, role: &str| {
        create_party_authorization(&Ed25519Provider, &MlDsa65Provider, "revoke_agent", &payload, p.id, role, &p.classical, &p.pq).unwrap()
    };
    let record = build_multi_party_authorization("revoke_agent", &payload, vec![sign(&owner, "owner"), sign(&admin, "org_admin")], 0);
    let policy = MultiPartyPolicyStore::from_json(&json!({
        "policy_set_version": "here.1", "profile": "mpa-v1", "audience": "verifier:here", "max_validity_seconds": 600,
        "subjects": [{
            "target": "agent:signed-here",
            "parties": [{ "party_id": owner.id, "role": "owner" }, { "party_id": admin.id, "role": "org_admin" }],
            "operations": { "revoke_agent": { "required_parties": 2, "allowed_roles": ["owner", "org_admin"], "required_roles": ["owner"] } },
        }],
    }))
    .unwrap();
    let trust = PrincipalTrustStore::from_json(&json!({ "trust_set_version": "here.1", "principals": [owner.trusted, admin.trusted] })).unwrap();
    let at = |now_ms: i64| {
        let expected = MultiPartyExpected { operation: "revoke_agent", target: "agent:signed-here", parameters: &empty };
        evaluate_multi_party_authorization(&record, &MultiPartyOptions { policy: &policy, trust: &trust, expected, now_ms }).unwrap()
    };
    // The evaluation takes its clock from the caller; the builder read the system's, in milliseconds:
    // in force now, not yet a minute before, over a minute after.
    assert!(at(now).authorized, "{:?}", at(now).errors);
    assert_eq!(codes(&at(now - 60_000)), ["MPA_NOT_YET_VALID"]);
    assert_eq!(codes(&at(now + 61_000)), ["MPA_EXPIRED"]);
}

#[test]
fn takes_the_integers_a_binary64_holds_exactly_and_no_other_number() {
    let (owner, admin) = (party("human:owner"), party("human:admin"));
    let now = 1_795_003_200_000; // 2026-11-18T12:00:00Z
    let policy = MultiPartyPolicyStore::from_json(&json!({
        "policy_set_version": "here.1", "profile": "mpa-v1", "audience": "verifier:here", "max_validity_seconds": 600,
        "subjects": [{
            "target": "agent:signed-here",
            "parties": [{ "party_id": owner.id, "role": "owner" }, { "party_id": admin.id, "role": "org_admin" }],
            "operations": { "revoke_agent": { "required_parties": 2, "allowed_roles": ["owner", "org_admin"], "required_roles": ["owner"] } },
        }],
    }))
    .unwrap();
    let trust = PrincipalTrustStore::from_json(&json!({ "trust_set_version": "here.1", "principals": [owner.trusted, admin.trusted] })).unwrap();
    let request = |parameters: &Value| {
        create_multi_party_request(&MultiPartyRequestInput {
            target: "agent:signed-here",
            audience: "verifier:here",
            parameters: Some(parameters),
            validity_seconds: 600,
            issued_at_ms: Some(now),
            request_id: None,
        })
    };
    // A record whose two parties signed payload, whatever it holds: the signer signs what it is given.
    let signed_over = |payload: &Value| {
        let sign = |p: &Party, role: &str| {
            create_party_authorization(&Ed25519Provider, &MlDsa65Provider, "revoke_agent", payload, p.id, role, &p.classical, &p.pq).unwrap()
        };
        build_multi_party_authorization("revoke_agent", payload, vec![sign(&owner, "owner"), sign(&admin, "org_admin")], 0)
    };
    let evaluate = |record: &Value, parameters: &Value| {
        let expected = MultiPartyExpected { operation: "revoke_agent", target: "agent:signed-here", parameters };
        evaluate_multi_party_authorization(record, &MultiPartyOptions { policy: &policy, trust: &trust, expected, now_ms: now + 1000 })
    };
    let not_representable = |r: &MultiPartyEvaluation| {
        !r.authorized && r.structure == "invalid" && r.verification == "not_evaluated" && codes(r) == ["MPA_NOT_REPRESENTABLE"]
    };

    // The largest integers of the profile are built, signed, stated and authorized.
    const LARGEST: i64 = (1 << 53) - 1;
    let within = json!({ "ceiling": LARGEST, "floor": -LARGEST });
    let at_the_limit = request(&within).unwrap();
    let r = evaluate(&signed_over(&at_the_limit), &within).unwrap();
    assert!(r.authorized && r.errors.is_empty(), "{:?}", r.errors);

    for (name, parameters) in [
        ("2^53", json!({ "amount": LARGEST + 1 })),
        ("-(2^53)", json!({ "amount": -LARGEST - 1 })),
        ("an identifier in u64", json!({ "new_key_id": 1_234_567_890_123_456_789_u64 })),
        ("10^21 as an f64", json!({ "amount": 1e21 })),
        ("2^53 as an f64", json!({ "amount": 9_007_199_254_740_992.0 })),
        ("2^53 inside an array", json!({ "limits": [1, { "amount": LARGEST + 1 }] })),
    ] {
        // One more is not a request the SDK builds...
        assert_eq!(request(&parameters).err().map(|e| e.code), Some("CONFIG_INVALID_VALUE"), "{name}, built");
        // ...nor parameters an executor can state...
        assert_eq!(evaluate(&signed_over(&at_the_limit), &parameters).err().map(|e| e.code), Some("CONFIG_INVALID_VALUE"), "{name}, stated");
        // ...and a record that holds one decides nothing, whoever signed it: 2^53 and 2^53 + 1 are one number
        // to whoever reads JSON numbers as binary64, so a signature over one would stand for the other.
        let over = signed_over(&json!({ "request": at_the_limit["request"], "parameters": parameters }));
        let r = evaluate(&over, &within).unwrap();
        assert!(not_representable(&r), "{name}, in a record: {:?}", r.errors);
    }
    // The digits of the record are what is judged: 2^53 + 1 written where 2^53 - 1 was signed.
    let written = serde_json::to_string(&signed_over(&at_the_limit)).unwrap();
    let rewritten = written.replacen("\"ceiling\":9007199254740991", "\"ceiling\":9007199254740993", 1);
    assert_ne!(written, rewritten, "the record was not rewritten");
    let r = evaluate(&serde_json::from_str(&rewritten).unwrap(), &within).unwrap();
    assert!(not_representable(&r), "a record rewritten to 2^53 + 1: {:?}", r.errors);
}

#[test]
fn refuses_to_build_a_request_the_profile_would_not_accept() {
    let (not_representable, not_an_object) = (json!({ "ratio": 0.5 }), json!("none"));
    let long = "a".repeat(257);
    let base = MultiPartyRequestInput { target: "agent:x", audience: "verifier:y", parameters: None, validity_seconds: 60, issued_at_ms: None, request_id: None };
    assert!(create_multi_party_request(&base).is_ok());
    for input in [
        MultiPartyRequestInput { target: "", ..base },
        MultiPartyRequestInput { audience: &long, ..base },
        MultiPartyRequestInput { validity_seconds: 0, ..base },
        MultiPartyRequestInput { validity_seconds: 86_401, ..base },
        MultiPartyRequestInput { request_id: Some(""), ..base },
        MultiPartyRequestInput { parameters: Some(&not_representable), ..base },
        MultiPartyRequestInput { parameters: Some(&not_an_object), ..base },
    ] {
        assert_eq!(create_multi_party_request(&input).err().map(|e| e.code), Some("CONFIG_INVALID_VALUE"), "{input:?}");
    }
}

#[test]
#[allow(deprecated)] // the old name, on purpose: it must keep giving the same answer
fn the_structural_check_is_not_an_authorization() {
    use dcp_ai::v2::multi_party_auth::verify_multi_party_authorization;
    let unsigned = |id: &str, role: &str| json!({ "party_id": id, "role": role, "composite_sig": { "classical": { "alg": "ed25519", "kid": "0".repeat(32), "sig_b64": "AAAAAAAAAAA=" }, "pq": null, "binding": "classical_only" } });
    let record = |authorizations: Vec<Value>| json!({ "type": "multi_party_authorization", "operation": "revoke_agent", "operation_payload": {}, "required_parties": 2, "authorizations": authorizations });

    // Signed by no one, and it is "valid": the check is about the shape.
    let anyone = record(vec![unsigned("anyone", "owner"), unsigned("anyone", "owner")]);
    let checked = check_multi_party_authorization_structure(&anyone, None);
    assert!(checked.valid && checked.errors.is_empty());
    let old = verify_multi_party_authorization(&anyone, None);
    assert_eq!((old.valid, old.errors), (checked.valid, checked.errors));

    let short = record(vec![unsigned("a", "org_admin")]);
    let (checked, old) = (check_multi_party_authorization_structure(&short, None), verify_multi_party_authorization(&short, None));
    assert_eq!(checked.errors, ["Insufficient authorizations: 1 < 2", "Owner authorization required but not present"]);
    assert_eq!((old.valid, old.errors), (false, checked.errors));

    let admins = MultiPartyPolicy { required_parties: 2, allowed_roles: vec!["org_admin".into()], require_owner: false };
    assert!(check_multi_party_authorization_structure(&record(vec![unsigned("a", "org_admin"), unsigned("b", "org_admin")]), Some(&admins)).valid);
}
