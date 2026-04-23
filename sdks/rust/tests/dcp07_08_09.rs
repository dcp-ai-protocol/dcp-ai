//! Smoke tests for DCP-07 (dispute + arbitration), DCP-08 (rights), DCP-09
//! (delegation + awareness + mirror) — Rust ports at v2.3.

use std::collections::HashSet;

use serde_json::{json, Value};

use dcp_ai::providers::ed25519::Ed25519Provider;
use dcp_ai::providers::ml_dsa_65::MlDsa65Provider;
use dcp_ai::v2::arbitration::{
    build_jurisprudence_bundle, create_arbitration_panel, lookup_precedent, submit_resolution,
    JurisprudenceParams, SubmitResolutionParams,
};
use dcp_ai::v2::awareness_threshold::{
    create_advisory_declaration, create_awareness_threshold, evaluate_significance,
    should_notify_human, AdvisoryDeclarationParams, AwarenessThresholdParams,
    SignificanceContext,
};
use dcp_ai::v2::composite_ops::CompositeKeyInfo;
use dcp_ai::v2::conflict_resolution::{
    create_dispute, create_objection, escalate_dispute, resolve_dispute, DisputeParams,
    ObjectionParams,
};
use dcp_ai::v2::crypto_provider::CryptoProvider;
use dcp_ai::v2::delegation::{
    create_delegation_mandate, generate_interaction_record, revoke_delegation,
    verify_mandate_validity, DelegationMandateParams, InteractionParams,
};
use dcp_ai::v2::principal_mirror::{generate_mirror, MirrorParams};
use dcp_ai::v2::rights::{
    check_rights_compliance, declare_rights, record_obligation, report_violation,
    DeclareRightsParams, ObligationParams, ViolationParams,
};

fn make_keys() -> (
    Ed25519Provider,
    MlDsa65Provider,
    CompositeKeyInfo,
    CompositeKeyInfo,
) {
    let ed = Ed25519Provider;
    let pq = MlDsa65Provider;
    let ed_kp = ed.generate_keypair().unwrap();
    let pq_kp = pq.generate_keypair().unwrap();
    (
        ed,
        pq,
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

#[test]
fn dispute_lifecycle_escalate_resolve() {
    let (ed, pq, ck, pqk) = make_keys();

    let dispute = create_dispute(
        &ed,
        &pq,
        &ck,
        &pqk,
        DisputeParams {
            dispute_id: "disp_001",
            session_nonce: &"a".repeat(64),
            initiator_agent_id: "agent_A",
            respondent_agent_id: "agent_B",
            dispute_type: "authority_conflict",
            evidence_hashes: vec!["sha256:0".into()],
        },
    )
    .unwrap();
    assert_eq!(dispute["escalation_level"], "direct_negotiation");
    assert_eq!(dispute["status"], "open");

    let escalated = escalate_dispute(&ed, &pq, &ck, &pqk, &dispute, &"b".repeat(64)).unwrap();
    assert_eq!(escalated["escalation_level"], "contextual_arbitration");
    assert_eq!(escalated["status"], "in_negotiation");

    let final_ = escalate_dispute(&ed, &pq, &ck, &pqk, &escalated, &"c".repeat(64)).unwrap();
    assert_eq!(final_["escalation_level"], "human_appeal");

    assert!(escalate_dispute(&ed, &pq, &ck, &pqk, &final_, &"d".repeat(64)).is_err());

    let resolved = resolve_dispute(&ed, &pq, &ck, &pqk, &final_, &"e".repeat(64)).unwrap();
    assert_eq!(resolved["status"], "resolved");
    assert_eq!(resolved["escalation_level"], "human_appeal");
}

#[test]
fn objection_shape() {
    let (ed, pq, ck, pqk) = make_keys();
    let obj = create_objection(
        &ed,
        &pq,
        &ck,
        &pqk,
        ObjectionParams {
            objection_id: "obj_001",
            session_nonce: &"a".repeat(64),
            agent_id: "agent_A",
            directive_hash: "sha256:0",
            objection_type: "ethical_concern",
            reasoning: "Directive would cause disproportionate harm",
            proposed_alternative: Some("Narrow scope"),
            human_escalation_required: true,
        },
    )
    .unwrap();
    assert_eq!(obj["objection_type"], "ethical_concern");
    assert_eq!(obj["human_escalation_required"], true);
}

#[test]
fn arbitration_panel_and_precedent_lookup() {
    let panel = create_arbitration_panel(
        vec!["arb_1".into(), "arb_2".into(), "arb_3".into()],
        2,
    )
    .unwrap();
    assert_eq!(panel.threshold, 2);
    assert_eq!(panel.arbitrator_ids.len(), 3);

    assert!(create_arbitration_panel(vec!["arb_1".into()], 3).is_err());
    assert!(create_arbitration_panel(vec!["arb_1".into(), "arb_2".into()], 0).is_err());

    let js: Vec<Value> = vec![
        json!({"category": "privacy", "applicable_contexts": ["healthcare", "finance"]}),
        json!({"category": "privacy", "applicable_contexts": ["retail"]}),
        json!({"category": "safety", "applicable_contexts": ["healthcare"]}),
    ];
    assert_eq!(lookup_precedent(&js, "privacy", None).len(), 2);
    assert_eq!(lookup_precedent(&js, "privacy", Some("healthcare")).len(), 1);
    assert_eq!(lookup_precedent(&js, "nonexistent", None).len(), 0);
}

#[test]
fn arbitration_signs_resolution_and_bundle() {
    let (ed, pq, ck, pqk) = make_keys();
    let res = submit_resolution(
        &ed,
        &pq,
        &ck,
        &pqk,
        SubmitResolutionParams {
            dispute_id: "disp_001",
            session_nonce: &"a".repeat(64),
            arbitrator_ids: vec!["arb_1".into(), "arb_2".into()],
            resolution: "Respondent to cease action X",
            binding: true,
            precedent_references: Some(vec!["juris_prev_001".into()]),
        },
    )
    .unwrap();
    assert_eq!(res["binding"], true);
    assert_eq!(res["composite_sig"]["binding"], "pq_over_classical");

    let jb = build_jurisprudence_bundle(
        &ed,
        &pq,
        &ck,
        &pqk,
        JurisprudenceParams {
            jurisprudence_id: "juris_001",
            session_nonce: &"a".repeat(64),
            dispute_id: "disp_001",
            resolution_id: "res_001",
            category: "privacy",
            precedent_summary: "Agent may not disclose PII without explicit consent",
            applicable_contexts: vec!["healthcare".into(), "finance".into()],
            authority_level: "advisory",
        },
    )
    .unwrap();
    assert_eq!(jb["category"], "privacy");
}

#[test]
fn rights_declare_and_compliance() {
    let (ed, pq, ck, pqk) = make_keys();
    let decl = declare_rights(
        &ed,
        &pq,
        &ck,
        &pqk,
        DeclareRightsParams {
            declaration_id: "decl_001",
            session_nonce: &"a".repeat(64),
            agent_id: "agent_A",
            rights: vec![json!({"right_type": "data_access", "scope": "public"})],
            jurisdiction: "US-CA",
        },
    )
    .unwrap();
    assert_eq!(decl["jurisdiction"], "US-CA");

    let _ob = record_obligation(
        &ed,
        &pq,
        &ck,
        &pqk,
        ObligationParams {
            obligation_id: "obl_001",
            session_nonce: &"a".repeat(64),
            agent_id: "agent_A",
            human_id: "h1",
            obligation_type: "retention",
            compliance_status: "compliant",
            evidence_hashes: vec!["sha256:0".into()],
        },
    )
    .unwrap();

    let _v = report_violation(
        &ed,
        &pq,
        &ck,
        &pqk,
        ViolationParams {
            violation_id: "viol_001",
            session_nonce: &"a".repeat(64),
            agent_id: "agent_A",
            violated_right: "privacy",
            evidence_hashes: vec!["sha256:0".into()],
            dispute_id: None,
        },
    )
    .unwrap();

    let obligations = vec![
        json!({"obligation_id": "o1", "obligation_type": "retention", "compliance_status": "compliant"}),
        json!({"obligation_id": "o2", "obligation_type": "deletion", "compliance_status": "non_compliant"}),
    ];
    let report = check_rights_compliance(&decl, &obligations);
    assert!(!report.compliant);
    assert_eq!(report.violations.len(), 1);
}

#[test]
fn delegation_mandate_lifecycle() {
    let (ed, pq, ck, pqk) = make_keys();
    let mandate = create_delegation_mandate(
        &ed,
        &pq,
        &ck,
        &pqk,
        DelegationMandateParams {
            mandate_id: "mand_001",
            session_nonce: &"a".repeat(64),
            human_id: "human_1",
            agent_id: "agent_A",
            authority_scope: vec![json!({"domain": "email", "actions": ["read"], "constraints": {}})],
            // Pick valid_from way in the past, valid_until way in the future.
            valid_from: "2020-01-01T00:00:00.000Z",
            valid_until: "2100-01-01T00:00:00.000Z",
            revocable: true,
        },
    )
    .unwrap();
    assert!(mandate.get("human_composite_sig").is_some());
    assert!(mandate.get("composite_sig").is_none());

    let mut revoked: HashSet<String> = HashSet::new();
    let v = verify_mandate_validity(&mandate, &revoked);
    assert!(v.valid);

    let rev = revoke_delegation(&mandate, &mut revoked);
    assert!(rev.revoked);
    assert!(revoked.contains("mand_001"));

    let after = verify_mandate_validity(&mandate, &revoked);
    assert!(!after.valid);
    assert!(after.reason.unwrap().to_lowercase().contains("revoked"));
}

#[test]
fn non_revocable_mandate_cannot_be_revoked() {
    let (ed, pq, ck, pqk) = make_keys();
    let mandate = create_delegation_mandate(
        &ed,
        &pq,
        &ck,
        &pqk,
        DelegationMandateParams {
            mandate_id: "mand_fixed",
            session_nonce: &"a".repeat(64),
            human_id: "human_1",
            agent_id: "agent_A",
            authority_scope: vec![],
            valid_from: "2020-01-01T00:00:00.000Z",
            valid_until: "2100-01-01T00:00:00.000Z",
            revocable: false,
        },
    )
    .unwrap();
    let mut revoked: HashSet<String> = HashSet::new();
    let rev = revoke_delegation(&mandate, &mut revoked);
    assert!(!rev.revoked);
    assert!(revoked.is_empty());
}

#[test]
fn generate_interaction_record_has_composite_sig() {
    let (ed, pq, ck, pqk) = make_keys();
    let rec = generate_interaction_record(
        &ed,
        &pq,
        &ck,
        &pqk,
        InteractionParams {
            interaction_id: "int_001",
            session_nonce: &"a".repeat(64),
            agent_id: "agent_A",
            counterparty_agent_id: "agent_B",
            public_layer: json!({"terms": "t", "decisions": "d", "commitments": "c"}),
            private_layer_hash: "sha256:0",
            mandate_id: "mand_001",
        },
    )
    .unwrap();
    assert_eq!(rec["composite_sig"]["binding"], "pq_over_classical");
}

#[test]
fn significance_scoring_bounds() {
    let low = evaluate_significance(&SignificanceContext::default());
    assert_eq!(low, 0);
    let high = evaluate_significance(&SignificanceContext {
        financial_impact: Some(1.0),
        data_sensitivity: Some(1.0),
        relationship_impact: Some(1.0),
        irreversibility: Some(1.0),
        precedent_setting: Some(1.0),
    });
    assert_eq!(high, 1000);
}

#[test]
fn should_notify_human_rules() {
    let rule = json!({"dimension": "significance", "operator": "gt", "value": 500, "action_if_triggered": "notify"});
    let trigger = should_notify_human(600.0, &[rule.clone()]);
    assert!(trigger.notify);
    assert_eq!(trigger.actions, vec!["notify"]);

    let miss = should_notify_human(100.0, &[rule]);
    assert!(!miss.notify);
}

#[test]
fn awareness_threshold_artifacts_sign() {
    let (ed, pq, ck, pqk) = make_keys();
    let th = create_awareness_threshold(
        &ed,
        &pq,
        &ck,
        &pqk,
        AwarenessThresholdParams {
            threshold_id: "th_001",
            session_nonce: &"a".repeat(64),
            agent_id: "agent_A",
            human_id: "h1",
            threshold_rules: vec![json!({"dimension": "significance", "operator": "gt", "value": 500, "action_if_triggered": "notify"})],
        },
    )
    .unwrap();
    assert_eq!(th["composite_sig"]["binding"], "pq_over_classical");

    let adv = create_advisory_declaration(
        &ed,
        &pq,
        &ck,
        &pqk,
        AdvisoryDeclarationParams {
            declaration_id: "adv_001",
            session_nonce: &"a".repeat(64),
            agent_id: "agent_A",
            human_id: "h1",
            significance_score: 650,
            action_summary: "Proposed outbound payment over threshold",
            recommended_response: "Require explicit human confirmation",
            response_deadline: "2026-04-30T00:00:00Z",
        },
    )
    .unwrap();
    assert_eq!(adv["significance_score"], 650);
    assert!(adv["human_response"].is_null());
    assert_eq!(adv["proceeded_without_response"], false);
}

#[test]
fn principal_mirror_hashes_audit_chain() {
    let (ed, pq, ck, pqk) = make_keys();
    let entries = vec![
        json!({"event": "start"}),
        json!({"event": "step"}),
        json!({"event": "end"}),
    ];
    let mirror = generate_mirror(
        &ed,
        &pq,
        &ck,
        &pqk,
        MirrorParams {
            mirror_id: "mir_001",
            session_nonce: &"a".repeat(64),
            agent_id: "agent_A",
            human_id: "human_1",
            period: json!({"from": "2026-04-01", "to": "2026-04-22"}),
            audit_entries: entries,
            narrative: "Agent completed 3 tasks.",
            decision_summary: "All within policy.",
        },
    )
    .unwrap();
    assert_eq!(mirror["action_count"], 3);
    assert!(mirror["audit_chain_hash"]
        .as_str()
        .unwrap()
        .starts_with("sha256:"));
}
