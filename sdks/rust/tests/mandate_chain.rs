//! DCP-09 §3.5 mandate chains (Rust SDK): the shared vectors every SDK must
//! agree on (tests/interop/v2/mandate_chain_vectors.json), the builders, and
//! the tier floor a verified chain feeds into the security tier.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::PathBuf;

use serde_json::{json, Value};

use dcp_ai::providers::ed25519::Ed25519Provider;
use dcp_ai::providers::ml_dsa_65::MlDsa65Provider;
use dcp_ai::v2::composite_ops::CompositeKeyInfo;
use dcp_ai::v2::crypto_provider::CryptoProvider;
use dcp_ai::v2::delegation::{
    create_delegation_mandate, create_delegation_mandate_with_options, create_sub_mandate,
    verify_mandate_chain, DelegationMandateParams, MandateChainKeys, MandateChainOptions,
    SubDelegationPolicy, SubMandateParams,
};
use dcp_ai::v2::security_tier::{compute_security_tier_with_floor, SecurityTier};
use dcp_ai::v2::session_nonce::{generate_session_nonce, parse_rfc3339_millis};

fn vectors_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .parent()
        .unwrap()
        .join("tests")
        .join("interop")
        .join("v2")
        .join("mandate_chain_vectors.json")
}

fn load_vectors() -> Value {
    let data = fs::read_to_string(vectors_path()).expect("read mandate chain vectors");
    serde_json::from_str(&data).expect("parse mandate chain vectors")
}

fn revoked(case: &Value) -> HashSet<String> {
    case["revoked_mandate_ids"]
        .as_array()
        .map(|ids| {
            ids.iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default()
}

#[test]
fn mandate_chain_vectors() {
    let v = load_vectors();
    let keys: MandateChainKeys = serde_json::from_value(v["keys"].clone()).expect("keys");
    let default_now = parse_rfc3339_millis(v["verification_time"].as_str().unwrap()).unwrap();

    let accept = v["must_accept"].as_array().expect("must_accept");
    assert!(!accept.is_empty());
    for case in accept {
        let chain = case["chain"].as_array().expect("chain");
        let result = verify_mandate_chain(chain, &revoked(case), &keys, Some(default_now));
        assert!(
            result.errors.is_empty(),
            "{}: {:?}",
            case["name"],
            result.errors
        );
        assert!(result.valid, "{}", case["name"]);
        assert_eq!(
            result.depth as u64,
            case["expected"]["depth"].as_u64().unwrap(),
            "{}",
            case["name"]
        );
        assert_eq!(
            result.effective_tier.map(|t| t.as_str()),
            case["expected"]["effective_tier"].as_str(),
            "{}",
            case["name"]
        );
    }

    let reject = v["must_reject"].as_array().expect("must_reject");
    assert!(reject.len() > 10);
    for case in reject {
        let chain = case["chain"].as_array().expect("chain");
        let now = case["verification_time"]
            .as_str()
            .map(|t| parse_rfc3339_millis(t).unwrap())
            .unwrap_or(default_now);
        let result = verify_mandate_chain(chain, &revoked(case), &keys, Some(now));
        assert!(!result.valid, "{} must be rejected", case["name"]);
        let want = case["error_contains"].as_str().unwrap();
        assert!(
            result.errors.join("\n").to_lowercase().contains(want),
            "{}: no error mentions {want}: {:?}",
            case["name"],
            result.errors
        );
    }

    let floor_cases = v["tier_floor"]["cases"].as_array().expect("tier_floor");
    assert!(!floor_cases.is_empty());
    for case in floor_cases {
        let policy = Some(&case["policy_decision"]).filter(|p| !p.is_null());
        let tier = compute_security_tier_with_floor(
            &case["intent"],
            policy,
            case["mandate_chain_tier"].as_str(),
        );
        assert_eq!(
            tier.as_str(),
            case["expected"].as_str().unwrap(),
            "{}",
            case["name"]
        );
    }
}

fn make_keys() -> (CompositeKeyInfo, CompositeKeyInfo) {
    let ed_kp = Ed25519Provider.generate_keypair().unwrap();
    let pq_kp = MlDsa65Provider.generate_keypair().unwrap();
    (
        CompositeKeyInfo {
            kid: ed_kp.kid,
            alg: "ed25519".into(),
            secret_key_b64: ed_kp.secret_key_b64,
            public_key_b64: ed_kp.public_key_b64,
        },
        CompositeKeyInfo {
            kid: pq_kp.kid,
            alg: "ml-dsa-65".into(),
            secret_key_b64: pq_kp.secret_key_b64,
            public_key_b64: pq_kp.public_key_b64,
        },
    )
}

fn key_entries(keys: &(CompositeKeyInfo, CompositeKeyInfo)) -> Vec<Value> {
    [&keys.0, &keys.1]
        .iter()
        .map(|k| {
            json!({
                "kid": k.kid, "alg": k.alg, "public_key_b64": k.public_key_b64,
                "created_at": "2026-10-21T00:00:00Z", "expires_at": null, "status": "active",
            })
        })
        .collect()
}

fn scope() -> Vec<Value> {
    vec![
        json!({"domain": "email", "actions_permitted": ["read", "draft", "send"], "data_classes": ["contact_info"], "limits": {"max_messages_per_day": 100, "region": "EU"}}),
        json!({"domain": "calendar", "actions_permitted": ["read", "create_event"]}),
    ]
}

#[test]
fn mandate_chain_builders() {
    let (ed, pq) = (Ed25519Provider, MlDsa65Provider);
    let (human, orchestrator, subagent, tool) =
        (make_keys(), make_keys(), make_keys(), make_keys());
    let nonce_root = generate_session_nonce();
    fn params(nonce: &str) -> DelegationMandateParams<'_> {
        DelegationMandateParams {
            mandate_id: "mandate:root",
            session_nonce: nonce,
            human_id: "human:alice",
            agent_id: "agent:orchestrator",
            authority_scope: scope(),
            valid_from: "2026-01-01T00:00:00Z",
            valid_until: "2099-01-01T00:00:00Z",
            revocable: true,
        }
    }

    // A root without chain fields is unchanged on the wire.
    let plain =
        create_delegation_mandate(&ed, &pq, &human.0, &human.1, params(&nonce_root)).unwrap();
    let mut keys_of_plain: Vec<&String> = plain.as_object().unwrap().keys().collect();
    keys_of_plain.sort();
    assert_eq!(
        keys_of_plain,
        [
            "agent_id",
            "authority_scope",
            "dcp_version",
            "human_composite_sig",
            "human_id",
            "mandate_id",
            "revocable",
            "session_nonce",
            "timestamp",
            "valid_from",
            "valid_until",
        ]
    );

    let root = create_delegation_mandate_with_options(
        &ed,
        &pq,
        &human.0,
        &human.1,
        params(&nonce_root),
        &MandateChainOptions {
            sub_delegation: Some(SubDelegationPolicy {
                permitted: true,
                max_depth: 2,
            }),
            minimum_security_tier: Some("standard".into()),
        },
    )
    .unwrap();
    let nonce_1 = generate_session_nonce();
    let sub1 = create_sub_mandate(
        &ed,
        &pq,
        &orchestrator.0,
        &orchestrator.1,
        &root,
        SubMandateParams {
            mandate_id: "mandate:sub-1",
            session_nonce: &nonce_1,
            agent_id: "agent:subagent",
            authority_scope: vec![json!({"domain": "email", "actions_permitted": ["read", "draft"], "data_classes": ["contact_info"], "limits": {"max_messages_per_day": 20, "region": "EU", "approval": true}})],
            valid_from: "2026-01-01T00:00:00Z",
            valid_until: "2099-01-01T00:00:00Z",
            revocable: true,
            options: MandateChainOptions {
                sub_delegation: Some(SubDelegationPolicy { permitted: true, max_depth: 2 }),
                minimum_security_tier: Some("elevated".into()),
            },
        },
    )
    .unwrap();
    let nonce_2 = generate_session_nonce();
    let sub2 = create_sub_mandate(
        &ed,
        &pq,
        &subagent.0,
        &subagent.1,
        &sub1,
        SubMandateParams {
            mandate_id: "mandate:sub-2",
            session_nonce: &nonce_2,
            agent_id: "agent:tool",
            authority_scope: vec![json!({"domain": "email", "actions_permitted": ["read"], "data_classes": [], "limits": {"max_messages_per_day": 5, "region": "EU", "approval": true}})],
            valid_from: "2026-01-01T00:00:00Z",
            valid_until: "2099-01-01T00:00:00Z",
            revocable: true,
            options: MandateChainOptions { sub_delegation: None, minimum_security_tier: Some("maximum".into()) },
        },
    )
    .unwrap();
    assert_eq!(sub1["parent_mandate_id"], "mandate:root");
    assert_eq!(sub1["delegation_depth"], 1);
    assert_eq!(sub1["human_id"], "human:alice");
    assert_eq!(sub2["parent_mandate_id"], "mandate:sub-1");
    assert_eq!(sub2["delegation_depth"], 2);
    assert!(sub1.get("human_composite_sig").is_none());

    let keys = MandateChainKeys {
        human_keys: key_entries(&human),
        agent_keys: HashMap::from([
            ("agent:orchestrator".to_string(), key_entries(&orchestrator)),
            ("agent:subagent".to_string(), key_entries(&subagent)),
            ("agent:tool".to_string(), key_entries(&tool)),
        ]),
    };
    let chain = [root.clone(), sub1.clone(), sub2.clone()];
    let ok = verify_mandate_chain(&chain, &HashSet::new(), &keys, None);
    assert!(ok.errors.is_empty(), "{:?}", ok.errors);
    assert!(ok.valid);
    assert_eq!(
        (ok.depth, ok.effective_tier),
        (2, Some(SecurityTier::Maximum))
    );
    let root_only = verify_mandate_chain(&chain[..1], &HashSet::new(), &keys, None);
    assert!(root_only.valid);
    assert_eq!(
        (root_only.depth, root_only.effective_tier),
        (0, Some(SecurityTier::Standard))
    );

    let revoked_root = verify_mandate_chain(
        &chain,
        &HashSet::from(["mandate:root".to_string()]),
        &keys,
        None,
    );
    assert!(!revoked_root.valid);
    assert_eq!(revoked_root.errors, vec!["mandate[0]: revoked".to_string()]);

    // A key that is not active, or a verification time past the window, cannot vouch for a hop.
    let mut revoked_key = keys.clone();
    for k in revoked_key
        .agent_keys
        .get_mut("agent:orchestrator")
        .unwrap()
    {
        k["status"] = json!("revoked");
    }
    let result = verify_mandate_chain(&chain[..2], &HashSet::new(), &revoked_key, None);
    assert!(
        result.errors.join(",").contains("delegator_composite_sig"),
        "{:?}",
        result.errors
    );
    let late = verify_mandate_chain(
        &chain[..2],
        &HashSet::new(),
        &keys,
        parse_rfc3339_millis("2100-01-01T00:00:00Z"),
    );
    assert!(
        late.errors.join(",").contains("expired"),
        "{:?}",
        late.errors
    );

    // A chain out of order, or starting at a sub-mandate, never verifies.
    assert!(
        !verify_mandate_chain(&[sub1.clone(), root.clone()], &HashSet::new(), &keys, None).valid
    );
    assert!(!verify_mandate_chain(&[sub1.clone()], &HashSet::new(), &keys, None).valid);
    assert!(!verify_mandate_chain(&[], &HashSet::new(), &keys, None).valid);
    assert_eq!(
        verify_mandate_chain(&[Value::Null], &HashSet::new(), &keys, None).errors,
        vec!["mandate[0]: not an object".to_string()]
    );
}

/// Integer limits compare exactly: serde_json keeps 2^53 + 1 exact, so the signature over the
/// canonical bytes verifies, and an f64 comparison would take it for equal to a parent of 2^53.
#[test]
fn limits_compare_integers_exactly() {
    let (ed, pq) = (Ed25519Provider, MlDsa65Provider);
    let (human, orchestrator) = (make_keys(), make_keys());
    let nonce_root = generate_session_nonce();
    let root = create_delegation_mandate_with_options(
        &ed,
        &pq,
        &human.0,
        &human.1,
        DelegationMandateParams {
            mandate_id: "mandate:root",
            session_nonce: &nonce_root,
            human_id: "human:alice",
            agent_id: "agent:orchestrator",
            authority_scope: vec![json!({"domain": "api", "actions_permitted": ["call"], "limits": {"n": 9007199254740992u64}})],
            valid_from: "2026-01-01T00:00:00Z",
            valid_until: "2099-01-01T00:00:00Z",
            revocable: true,
        },
        &MandateChainOptions {
            sub_delegation: Some(SubDelegationPolicy { permitted: true, max_depth: 1 }),
            minimum_security_tier: None,
        },
    )
    .unwrap();
    let keys = MandateChainKeys {
        human_keys: key_entries(&human),
        agent_keys: HashMap::from([("agent:orchestrator".to_string(), key_entries(&orchestrator))]),
    };
    let sub_with = |n: u64| {
        let nonce = generate_session_nonce();
        create_sub_mandate(
            &ed,
            &pq,
            &orchestrator.0,
            &orchestrator.1,
            &root,
            SubMandateParams {
                mandate_id: "mandate:sub",
                session_nonce: &nonce,
                agent_id: "agent:subagent",
                authority_scope: vec![json!({"domain": "api", "actions_permitted": ["call"], "limits": {"n": n}})],
                valid_from: "2026-01-01T00:00:00Z",
                valid_until: "2099-01-01T00:00:00Z",
                revocable: true,
                options: MandateChainOptions::default(),
            },
        )
        .unwrap()
    };
    let equal = verify_mandate_chain(&[root.clone(), sub_with(9007199254740992)], &HashSet::new(), &keys, None);
    assert!(equal.valid, "{:?}", equal.errors);
    let looser = verify_mandate_chain(&[root.clone(), sub_with(9007199254740993)], &HashSet::new(), &keys, None);
    assert!(!looser.valid);
    assert!(looser.errors.iter().any(|e| e.contains("limits.n")), "{:?}", looser.errors);
}
