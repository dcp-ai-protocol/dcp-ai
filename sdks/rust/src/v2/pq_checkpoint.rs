//! DCP v2.0 Lazy PQ Checkpoint — Rust port.

use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use crate::v2::canonicalize::canonicalize_v2;
use crate::v2::composite_ops::{composite_sign, CompositeKeyInfo};
use crate::v2::crypto_provider::{CryptoError, CryptoProvider};
use crate::v2::domain_separation::CTX_AUDIT_EVENT;
use crate::v2::security_tier::{tier_to_checkpoint_interval, SecurityTier};

/// Compute a SHA-256 Merkle root over canonicalised audit-event payloads.
/// Returns a 64-char lowercase hex string (no `sha256:` prefix).
pub fn audit_events_merkle_root(events: &[Value]) -> Result<String, String> {
    if events.is_empty() {
        return Err("Cannot compute Merkle root of empty event list".into());
    }
    let mut leaves: Vec<String> = events
        .iter()
        .map(|e| {
            let canonical = canonicalize_v2(e)?;
            let mut hasher = Sha256::new();
            hasher.update(canonical.as_bytes());
            Ok(hex::encode(hasher.finalize()))
        })
        .collect::<Result<_, String>>()?;

    while leaves.len() > 1 {
        if leaves.len() % 2 == 1 {
            leaves.push(leaves.last().unwrap().clone());
        }
        let mut next = Vec::with_capacity(leaves.len() / 2);
        let mut i = 0;
        while i < leaves.len() {
            let l = hex::decode(&leaves[i]).map_err(|e| e.to_string())?;
            let r = hex::decode(&leaves[i + 1]).map_err(|e| e.to_string())?;
            let mut combined = Vec::with_capacity(l.len() + r.len());
            combined.extend_from_slice(&l);
            combined.extend_from_slice(&r);
            let mut hasher = Sha256::new();
            hasher.update(&combined);
            next.push(hex::encode(hasher.finalize()));
            i += 2;
        }
        leaves = next;
    }
    Ok(leaves.remove(0))
}

/// Build + sign a PQ checkpoint for a batch of audit events.
pub fn create_pq_checkpoint(
    classical_provider: &dyn CryptoProvider,
    pq_provider: &dyn CryptoProvider,
    classical_key: &CompositeKeyInfo,
    pq_key: &CompositeKeyInfo,
    events: &[Value],
    session_nonce: &str,
) -> Result<Value, CryptoError> {
    if events.is_empty() {
        return Err(CryptoError::SignatureError(
            "Cannot create checkpoint for empty event list".into(),
        ));
    }
    let merkle = audit_events_merkle_root(events).map_err(CryptoError::SignatureError)?;
    let checkpoint_id = format!("ckpt-{}", generate_uuidv4());

    let from_id = events
        .first()
        .and_then(|e| e.get("audit_id"))
        .and_then(Value::as_str)
        .unwrap_or("");
    let to_id = events
        .last()
        .and_then(|e| e.get("audit_id"))
        .and_then(Value::as_str)
        .unwrap_or("");

    let payload = json!({
        "checkpoint_id": checkpoint_id,
        "session_nonce": session_nonce,
        "event_range": {
            "from_audit_id": from_id,
            "to_audit_id": to_id,
            "count": events.len(),
        },
        "merkle_root": format!("sha256:{}", merkle),
    });
    let canonical = canonicalize_v2(&payload).map_err(CryptoError::SignatureError)?;
    let composite = composite_sign(
        classical_provider,
        pq_provider,
        CTX_AUDIT_EVENT,
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

fn generate_uuidv4() -> String {
    // Minimal UUIDv4 without a dep: 16 random bytes, set variant + version.
    use rand::RngCore;
    let mut bytes = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
    bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant RFC 4122
    format!(
        "{:02x}{:02x}{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}",
        bytes[0], bytes[1], bytes[2], bytes[3],
        bytes[4], bytes[5],
        bytes[6], bytes[7],
        bytes[8], bytes[9],
        bytes[10], bytes[11], bytes[12], bytes[13], bytes[14], bytes[15],
    )
}

/// Stateful manager that batches audit events and emits a checkpoint when the
/// pending count reaches the interval.
pub struct PQCheckpointManager {
    interval: u32,
    tier: Option<SecurityTier>,
    session_nonce: String,
    pending: Vec<Value>,
    checkpoints: Vec<Value>,
}

impl PQCheckpointManager {
    pub fn new(interval: u32, session_nonce: impl Into<String>) -> Result<Self, String> {
        if interval < 1 {
            return Err("Checkpoint interval must be >= 1".into());
        }
        Ok(Self {
            interval,
            tier: None,
            session_nonce: session_nonce.into(),
            pending: Vec::new(),
            checkpoints: Vec::new(),
        })
    }

    pub fn with_tier(tier: SecurityTier, session_nonce: impl Into<String>) -> Self {
        Self {
            interval: tier_to_checkpoint_interval(tier),
            tier: Some(tier),
            session_nonce: session_nonce.into(),
            pending: Vec::new(),
            checkpoints: Vec::new(),
        }
    }

    pub fn interval(&self) -> u32 {
        self.interval
    }
    pub fn tier(&self) -> Option<SecurityTier> {
        self.tier
    }
    pub fn set_tier(&mut self, tier: SecurityTier) {
        self.tier = Some(tier);
        self.interval = tier_to_checkpoint_interval(tier);
    }
    pub fn pending_count(&self) -> usize {
        self.pending.len()
    }
    pub fn checkpoints(&self) -> &[Value] {
        &self.checkpoints
    }

    /// Record an event and emit a checkpoint if the interval is hit.
    pub fn record_event(
        &mut self,
        classical_provider: &dyn CryptoProvider,
        pq_provider: &dyn CryptoProvider,
        classical_key: &CompositeKeyInfo,
        pq_key: &CompositeKeyInfo,
        event: Value,
    ) -> Result<Option<Value>, CryptoError> {
        self.pending.push(event);
        if self.pending.len() as u32 >= self.interval {
            return self.flush(classical_provider, pq_provider, classical_key, pq_key);
        }
        Ok(None)
    }

    /// Force a checkpoint over all pending events.
    pub fn flush(
        &mut self,
        classical_provider: &dyn CryptoProvider,
        pq_provider: &dyn CryptoProvider,
        classical_key: &CompositeKeyInfo,
        pq_key: &CompositeKeyInfo,
    ) -> Result<Option<Value>, CryptoError> {
        if self.pending.is_empty() {
            return Ok(None);
        }
        let checkpoint = create_pq_checkpoint(
            classical_provider,
            pq_provider,
            classical_key,
            pq_key,
            &self.pending,
            &self.session_nonce,
        )?;
        self.checkpoints.push(checkpoint.clone());
        self.pending.clear();
        Ok(Some(checkpoint))
    }
}
