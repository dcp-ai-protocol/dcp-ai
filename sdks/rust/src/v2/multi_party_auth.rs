//! DCP v2.0 Multi-Party Authorization — Rust port.

use std::collections::BTreeMap;

use serde_json::Value;

#[derive(Debug, Clone)]
pub struct MultiPartyPolicy {
    pub required_parties: usize,
    pub allowed_roles: Vec<String>,
    pub require_owner: bool,
}

impl MultiPartyPolicy {
    pub fn default_for(op: &str) -> Option<Self> {
        match op {
            "revoke_agent" => Some(Self {
                required_parties: 2,
                allowed_roles: vec!["owner".into(), "org_admin".into(), "recovery_contact".into()],
                require_owner: true,
            }),
            "rotate_org_key" | "change_jurisdiction" => Some(Self {
                required_parties: 2,
                allowed_roles: vec!["owner".into(), "org_admin".into()],
                require_owner: true,
            }),
            "modify_recovery_config" => Some(Self {
                required_parties: 2,
                allowed_roles: vec!["owner".into(), "org_admin".into(), "recovery_contact".into()],
                require_owner: true,
            }),
            _ => None,
        }
    }
}

#[derive(Debug, Clone)]
pub struct MpaCheck {
    pub valid: bool,
    pub errors: Vec<String>,
}

/// Structurally verify a multi-party authorization against a policy.
///
/// This checks: minimum party count, presence of the owner (if required),
/// that every role is allowed, and that each authorisation carries a
/// composite_sig. Cryptographic verification of each party's signature is
/// performed separately at the gateway, which knows each party's public key.
pub fn verify_multi_party_authorization(
    mpa: &Value,
    policy: Option<&MultiPartyPolicy>,
) -> MpaCheck {
    let op = mpa.get("operation").and_then(Value::as_str).unwrap_or("");
    let owned_policy: Option<MultiPartyPolicy>;
    let effective: Option<&MultiPartyPolicy> = match policy {
        Some(p) => Some(p),
        None => {
            owned_policy = MultiPartyPolicy::default_for(op);
            owned_policy.as_ref()
        }
    };
    let Some(p) = effective else {
        return MpaCheck {
            valid: false,
            errors: vec![format!("No policy defined for operation: {op}")],
        };
    };

    let auths = mpa
        .get("authorizations")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    let mut errors = Vec::new();
    if auths.len() < p.required_parties {
        errors.push(format!(
            "Insufficient authorizations: {} < {}",
            auths.len(),
            p.required_parties
        ));
    }
    if p.require_owner {
        let has_owner = auths
            .iter()
            .any(|a| a.get("role").and_then(Value::as_str) == Some("owner"));
        if !has_owner {
            errors.push("Owner authorization required but not present".into());
        }
    }
    let mut role_counts: BTreeMap<String, u32> = BTreeMap::new();
    for auth in &auths {
        let role = auth.get("role").and_then(Value::as_str).unwrap_or("").to_string();
        if !p.allowed_roles.iter().any(|r| r == &role) {
            errors.push(format!("Role {role} not allowed for operation {op}"));
        }
        let party_id = auth
            .get("party_id")
            .and_then(Value::as_str)
            .unwrap_or("<unknown>");
        if auth.get("composite_sig").map(Value::is_null).unwrap_or(true) {
            errors.push(format!("Missing composite_sig for party {party_id}"));
        }
        *role_counts.entry(role).or_insert(0) += 1;
    }

    MpaCheck {
        valid: errors.is_empty(),
        errors,
    }
}
