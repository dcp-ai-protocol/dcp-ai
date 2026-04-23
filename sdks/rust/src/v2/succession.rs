//! DCP-06 v2.0 Digital Succession — Rust port.
//!
//! Implements digital testaments, succession ceremonies, and memory transfer
//! manifests. Mirrors `sdks/typescript/src/core/succession.ts` semantics.

use std::collections::BTreeMap;

use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use crate::v2::canonicalize::canonicalize_v2;
use crate::v2::composite_ops::{composite_sign, CompositeKeyInfo};
use crate::v2::crypto_provider::{CryptoError, CryptoProvider};
use crate::v2::domain_separation::CTX_SUCCESSION;
use crate::v2::lifecycle::{self};

/// A single memory entry to partition.
#[derive(Debug, Clone)]
pub struct MemoryEntry {
    pub hash: String,
    pub category: String,
    pub size: u64,
}

/// Result of partitioning memory by disposition.
#[derive(Debug, Default)]
pub struct ClassifiedMemory {
    pub operational: Vec<MemoryEntry>,
    pub relational_destroyed: Vec<String>,
}

/// Partition memory entries into operational (transfer) and relational
/// (destroyed). The default disposition for unknown categories is `destroy`.
pub fn classify_memory(
    entries: &[MemoryEntry],
    classification: &BTreeMap<String, String>,
) -> ClassifiedMemory {
    let mut out = ClassifiedMemory::default();
    for entry in entries {
        let disposition = classification
            .get(&entry.category)
            .map(String::as_str)
            .unwrap_or("destroy");
        match disposition {
            "transfer" => out.operational.push(entry.clone()),
            "destroy" => out.relational_destroyed.push(entry.hash.clone()),
            _ => {}
        }
    }
    out
}

// ── Digital testament ──

/// Parameters for creating a fresh digital testament.
pub struct DigitalTestamentParams {
    pub agent_id: String,
    pub session_nonce: String,
    /// Each preference is a caller-supplied JSON object (agent_id, priority, optional conditions).
    pub successor_preferences: Vec<Value>,
    /// Map from memory category to disposition ("transfer" | "retain" | "destroy").
    pub memory_classification: BTreeMap<String, String>,
    pub human_consent_required: bool,
}

/// Create a first-version digital testament (`prev_testament_hash = "GENESIS"`).
pub fn create_digital_testament(
    classical_provider: &dyn CryptoProvider,
    pq_provider: &dyn CryptoProvider,
    classical_key: &CompositeKeyInfo,
    pq_key: &CompositeKeyInfo,
    params: DigitalTestamentParams,
) -> Result<Value, CryptoError> {
    let now = lifecycle_utc_now_iso();
    let payload = json!({
        "dcp_version": "2.0",
        "agent_id": params.agent_id,
        "session_nonce": params.session_nonce,
        "created_at": now,
        "last_updated": now,
        "successor_preferences": params.successor_preferences,
        "memory_classification": params.memory_classification,
        "human_consent_required": params.human_consent_required,
        "testament_version": 1,
        "prev_testament_hash": "GENESIS",
    });

    finalize_succession_payload(
        classical_provider,
        pq_provider,
        classical_key,
        pq_key,
        payload,
    )
}

/// Optional updates that replace individual testament fields.
#[derive(Default)]
pub struct TestamentUpdates {
    pub session_nonce: String,
    pub successor_preferences: Option<Vec<Value>>,
    pub memory_classification: Option<BTreeMap<String, String>>,
    pub human_consent_required: Option<bool>,
}

/// Update an existing testament. Increments version and chains the hash.
pub fn update_digital_testament(
    classical_provider: &dyn CryptoProvider,
    pq_provider: &dyn CryptoProvider,
    classical_key: &CompositeKeyInfo,
    pq_key: &CompositeKeyInfo,
    previous: &Value,
    updates: TestamentUpdates,
) -> Result<Value, CryptoError> {
    let mut prev_payload = previous.clone();
    if let Some(obj) = prev_payload.as_object_mut() {
        obj.remove("composite_sig");
    }
    let prev_canonical =
        canonicalize_v2(&prev_payload).map_err(CryptoError::SignatureError)?;
    let mut hasher = Sha256::new();
    hasher.update(prev_canonical.as_bytes());
    let prev_hash = format!("sha256:{}", hex::encode(hasher.finalize()));

    let previous_obj = previous.as_object().ok_or_else(|| {
        CryptoError::SignatureError("previous testament is not an object".into())
    })?;

    let successor_preferences = updates
        .successor_preferences
        .map(Value::from_iter)
        .unwrap_or_else(|| {
            previous_obj
                .get("successor_preferences")
                .cloned()
                .unwrap_or_else(|| Value::Array(vec![]))
        });
    let memory_classification = match updates.memory_classification {
        Some(map) => {
            let mut o = serde_json::Map::new();
            for (k, v) in map {
                o.insert(k, Value::String(v));
            }
            Value::Object(o)
        }
        None => previous_obj
            .get("memory_classification")
            .cloned()
            .unwrap_or_else(|| Value::Object(Default::default())),
    };
    let human_consent_required = updates
        .human_consent_required
        .map(Value::Bool)
        .unwrap_or_else(|| {
            previous_obj
                .get("human_consent_required")
                .cloned()
                .unwrap_or(Value::Bool(true))
        });
    let created_at = previous_obj
        .get("created_at")
        .cloned()
        .unwrap_or_else(|| Value::String(lifecycle_utc_now_iso()));
    let prev_version = previous_obj
        .get("testament_version")
        .and_then(Value::as_u64)
        .unwrap_or(0) as u64;

    let payload = json!({
        "dcp_version": "2.0",
        "agent_id": previous_obj.get("agent_id").cloned().unwrap_or(Value::Null),
        "session_nonce": updates.session_nonce,
        "created_at": created_at,
        "last_updated": lifecycle_utc_now_iso(),
        "successor_preferences": successor_preferences,
        "memory_classification": memory_classification,
        "human_consent_required": human_consent_required,
        "testament_version": prev_version + 1,
        "prev_testament_hash": prev_hash,
    });

    finalize_succession_payload(
        classical_provider,
        pq_provider,
        classical_key,
        pq_key,
        payload,
    )
}

// ── Memory transfer ──

pub struct MemoryTransferManifestParams {
    pub session_nonce: String,
    pub predecessor_agent_id: String,
    pub successor_agent_id: String,
    pub operational_memory: Vec<Value>,
    pub relational_memory_destroyed: Vec<String>,
    /// Dual-hash reference: `{"sha256": "...", "sha3_256": "..."}`.
    pub transfer_hash: Value,
}

pub fn create_memory_transfer_manifest(
    classical_provider: &dyn CryptoProvider,
    pq_provider: &dyn CryptoProvider,
    classical_key: &CompositeKeyInfo,
    pq_key: &CompositeKeyInfo,
    params: MemoryTransferManifestParams,
) -> Result<Value, CryptoError> {
    let payload = json!({
        "dcp_version": "2.0",
        "session_nonce": params.session_nonce,
        "predecessor_agent_id": params.predecessor_agent_id,
        "successor_agent_id": params.successor_agent_id,
        "timestamp": lifecycle_utc_now_iso(),
        "operational_memory": params.operational_memory,
        "relational_memory_destroyed": params.relational_memory_destroyed,
        "transfer_hash": params.transfer_hash,
    });

    finalize_succession_payload(
        classical_provider,
        pq_provider,
        classical_key,
        pq_key,
        payload,
    )
}

// ── Succession execution ──

pub struct SuccessionParams<'a> {
    pub predecessor_agent_id: &'a str,
    pub successor_agent_id: &'a str,
    pub session_nonce: &'a str,
    pub transition_type: &'a str,
    pub human_consent: Option<Value>,
    pub ceremony_participants: Vec<String>,
    pub memory_transfer_manifest_hash: &'a str,
}

pub fn execute_succession(
    classical_provider: &dyn CryptoProvider,
    pq_provider: &dyn CryptoProvider,
    classical_key: &CompositeKeyInfo,
    pq_key: &CompositeKeyInfo,
    params: SuccessionParams<'_>,
) -> Result<Value, CryptoError> {
    if params.ceremony_participants.is_empty() {
        return Err(CryptoError::SignatureError(
            "Succession ceremony requires at least one participant".into(),
        ));
    }

    let payload = json!({
        "dcp_version": "2.0",
        "predecessor_agent_id": params.predecessor_agent_id,
        "successor_agent_id": params.successor_agent_id,
        "session_nonce": params.session_nonce,
        "timestamp": lifecycle_utc_now_iso(),
        "transition_type": params.transition_type,
        "human_consent": params.human_consent.unwrap_or(Value::Null),
        "ceremony_participants": params.ceremony_participants,
        "memory_transfer_manifest_hash": params.memory_transfer_manifest_hash,
    });

    finalize_succession_payload(
        classical_provider,
        pq_provider,
        classical_key,
        pq_key,
        payload,
    )
}

// ── Helpers ──

fn finalize_succession_payload(
    classical_provider: &dyn CryptoProvider,
    pq_provider: &dyn CryptoProvider,
    classical_key: &CompositeKeyInfo,
    pq_key: &CompositeKeyInfo,
    payload: Value,
) -> Result<Value, CryptoError> {
    let canonical = canonicalize_v2(&payload).map_err(CryptoError::SignatureError)?;
    let composite = composite_sign(
        classical_provider,
        pq_provider,
        CTX_SUCCESSION,
        canonical.as_bytes(),
        classical_key,
        pq_key,
    )?;
    let mut out = payload;
    if let Some(obj) = out.as_object_mut() {
        obj.insert(
            "composite_sig".into(),
            serde_json::to_value(&composite)
                .map_err(|e| CryptoError::SignatureError(e.to_string()))?,
        );
    }
    Ok(out)
}

/// Wrap `lifecycle::utc_now_iso` so succession shares the same timestamp format.
fn lifecycle_utc_now_iso() -> String {
    // lifecycle::utc_now_iso is module-private; reproduce logic via lifecycle wrapper.
    lifecycle::utc_now_iso_pub()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::providers::ed25519::Ed25519Provider;
    use crate::providers::ml_dsa_65::MlDsa65Provider;

    fn make_keys() -> (CompositeKeyInfo, CompositeKeyInfo) {
        let ed = Ed25519Provider;
        let pq = MlDsa65Provider;
        let ed_kp = ed.generate_keypair().unwrap();
        let pq_kp = pq.generate_keypair().unwrap();
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

    #[test]
    fn classify_memory_partitions_correctly() {
        let entries = vec![
            MemoryEntry {
                hash: "hA".into(),
                category: "operational".into(),
                size: 100,
            },
            MemoryEntry {
                hash: "hB".into(),
                category: "relational".into(),
                size: 50,
            },
            MemoryEntry {
                hash: "hC".into(),
                category: "secrets".into(),
                size: 30,
            },
        ];
        let mut classification = BTreeMap::new();
        classification.insert("operational".into(), "transfer".into());
        classification.insert("relational".into(), "destroy".into());
        classification.insert("secrets".into(), "destroy".into());

        let out = classify_memory(&entries, &classification);
        assert_eq!(out.operational.len(), 1);
        assert_eq!(out.operational[0].hash, "hA");
        assert_eq!(out.relational_destroyed, vec!["hB", "hC"]);
    }

    #[test]
    fn classify_memory_unknown_defaults_to_destroy() {
        let entries = vec![MemoryEntry {
            hash: "hX".into(),
            category: "unknown".into(),
            size: 1,
        }];
        let out = classify_memory(&entries, &BTreeMap::new());
        assert_eq!(out.relational_destroyed, vec!["hX"]);
        assert!(out.operational.is_empty());
    }

    #[test]
    fn first_testament_is_genesis() {
        let ed = Ed25519Provider;
        let pq = MlDsa65Provider;
        let (ck, pqk) = make_keys();
        let mut classification = BTreeMap::new();
        classification.insert("operational".into(), "transfer".into());

        let testament = create_digital_testament(
            &ed,
            &pq,
            &ck,
            &pqk,
            DigitalTestamentParams {
                agent_id: "agent_123".into(),
                session_nonce: "a".repeat(64),
                successor_preferences: vec![json!({"agent_id": "agent_succ", "priority": 1})],
                memory_classification: classification,
                human_consent_required: true,
            },
        )
        .unwrap();

        assert_eq!(testament["testament_version"], 1);
        assert_eq!(testament["prev_testament_hash"], "GENESIS");
    }

    #[test]
    fn execute_succession_requires_participants() {
        let ed = Ed25519Provider;
        let pq = MlDsa65Provider;
        let (ck, pqk) = make_keys();
        let err = execute_succession(
            &ed,
            &pq,
            &ck,
            &pqk,
            SuccessionParams {
                predecessor_agent_id: "agent_pred",
                successor_agent_id: "agent_succ",
                session_nonce: &"a".repeat(64),
                transition_type: "planned",
                human_consent: None,
                ceremony_participants: vec![],
                memory_transfer_manifest_hash: "sha256:0000",
            },
        );
        assert!(err.is_err());
    }

    #[test]
    fn execute_succession_happy_path() {
        let ed = Ed25519Provider;
        let pq = MlDsa65Provider;
        let (ck, pqk) = make_keys();
        let record = execute_succession(
            &ed,
            &pq,
            &ck,
            &pqk,
            SuccessionParams {
                predecessor_agent_id: "agent_pred",
                successor_agent_id: "agent_succ",
                session_nonce: &"a".repeat(64),
                transition_type: "planned",
                human_consent: Some(json!({"human_id": "h1", "decision": "approved"})),
                ceremony_participants: vec!["p1".into(), "p2".into()],
                memory_transfer_manifest_hash: "sha256:0000",
            },
        )
        .unwrap();
        assert_eq!(record["transition_type"], "planned");
        assert_eq!(record["ceremony_participants"].as_array().unwrap().len(), 2);
        assert_eq!(record["composite_sig"]["binding"], "pq_over_classical");
    }
}
