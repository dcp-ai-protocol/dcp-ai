use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SignatureEntry {
    pub alg: String,
    pub kid: String,
    pub sig_b64: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompositeSignature {
    pub classical: SignatureEntry,
    pub pq: Option<SignatureEntry>,
    pub binding: String,
}

impl CompositeSignature {
    pub fn classical_only(entry: SignatureEntry) -> Self {
        Self {
            classical: entry,
            pq: None,
            binding: "classical_only".to_string(),
        }
    }

    pub fn pq_over_classical(classical: SignatureEntry, pq: SignatureEntry) -> Self {
        Self {
            classical,
            pq: Some(pq),
            binding: "pq_over_classical".to_string(),
        }
    }
}
