//! DCP-04 A2A tests — discovery + handshake scaffolding (Rust).

use serde_json::{json, Value};

use dcp_ai::v2::a2a::{
    create_agent_directory, create_close_message, create_hello, create_welcome,
    derive_session_id, find_agent_by_capability, find_agent_by_id, generate_nonce,
    validate_directory_entry,
};

fn mk_agent(id: &str, caps: &[&str], status: &str) -> Value {
    json!({
        "agent_id": id,
        "agent_name": id,
        "capabilities": caps,
        "bundle_endpoint": format!("https://example.com/{}/bundle", id),
        "a2a_endpoint": format!("wss://example.com/{}/a2a", id),
        "a2a_transports": ["websocket"],
        "security_tier_minimum": "standard",
        "supported_algorithms": {"signing": ["ed25519"], "kem": ["x25519-ml-kem-768"]},
        "status": status,
        "updated_at": "2026-04-01T00:00:00Z",
    })
}

#[test]
fn directory_basic() {
    let dir = create_agent_directory("Example Org", vec![mk_agent("a1", &["read"], "active")]);
    assert_eq!(dir["dcp_version"], "2.0");
    assert_eq!(dir["organization"], "Example Org");
}

#[test]
fn find_agent_by_capability_and_id() {
    let dir = create_agent_directory(
        "",
        vec![
            mk_agent("agent_A", &["read", "write"], "active"),
            mk_agent("agent_B", &["admin"], "active"),
            mk_agent("agent_C", &["read"], "revoked"),
        ],
    );
    assert_eq!(
        find_agent_by_capability(&dir, &["read"]).unwrap()["agent_id"],
        "agent_A"
    );
    assert_eq!(
        find_agent_by_capability(&dir, &["admin"]).unwrap()["agent_id"],
        "agent_B"
    );
    assert!(find_agent_by_capability(&dir, &["missing"]).is_none());
    assert_eq!(find_agent_by_id(&dir, "agent_A").unwrap()["agent_id"], "agent_A");
    // Revoked agent is skipped.
    assert!(find_agent_by_id(&dir, "agent_C").is_none());
}

#[test]
fn validate_directory_entry_errors() {
    let bad = json!({"agent_id": "", "capabilities": [], "status": "bogus"});
    let errs = validate_directory_entry(&bad);
    assert!(errs.iter().any(|e| e.contains("agent_id")));
    assert!(errs.iter().any(|e| e.contains("capabilities")));
    assert!(errs.iter().any(|e| e.contains("Invalid status")));
}

#[test]
fn generate_nonce_is_64_lowercase_hex() {
    let n = generate_nonce();
    assert_eq!(n.len(), 64);
    assert!(n.chars().all(|c| matches!(c, '0'..='9' | 'a'..='f')));
}

#[test]
fn create_hello_and_welcome() {
    let h = create_hello(json!({"bundle": "stub"}), "pub_b64", vec!["read".into()], "standard");
    assert_eq!(h["type"], "A2A_HELLO");
    assert_eq!(h["protocol_version"], "2.0");
    assert_eq!(h["security_tier"], "standard");
    assert_eq!(h["nonce"].as_str().unwrap().len(), 64);

    let w = create_welcome(json!({"bundle": "stub"}), "respkem", "ctb64", "elevated");
    assert_eq!(w["type"], "A2A_WELCOME");
    assert_eq!(w["resolved_security_tier"], "elevated");
    assert_eq!(w["kem_ciphertext"]["ciphertext_b64"], "ctb64");
}

#[test]
fn derive_session_id_is_stable_and_64_hex() {
    let key = vec![1u8; 32];
    let a = "a".repeat(64);
    let b = "b".repeat(64);
    let s1 = derive_session_id("agent_L", "agent_R", &a, &b, &key).unwrap();
    let s2 = derive_session_id("agent_L", "agent_R", &a, &b, &key).unwrap();
    assert_eq!(s1, s2);
    assert_eq!(s1.len(), 64);
}

#[test]
fn close_message_shape() {
    let c = create_close_message("sess_001", "complete", 42, "sha256:0");
    assert_eq!(c["type"], "A2A_CLOSE");
    assert_eq!(c["reason"], "complete");
    assert_eq!(c["final_sequence"], 42);
}
