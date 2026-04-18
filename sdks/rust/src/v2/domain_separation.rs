pub const CTX_AGENT_PASSPORT: &str = "DCP-AI.v2.AgentPassport";
pub const CTX_RESPONSIBLE_PRINCIPAL: &str = "DCP-AI.v2.ResponsiblePrincipal";
pub const CTX_INTENT: &str = "DCP-AI.v2.Intent";
pub const CTX_POLICY_DECISION: &str = "DCP-AI.v2.PolicyDecision";
pub const CTX_AUDIT_EVENT: &str = "DCP-AI.v2.AuditEvent";
pub const CTX_BUNDLE: &str = "DCP-AI.v2.Bundle";
pub const CTX_REVOCATION: &str = "DCP-AI.v2.Revocation";
pub const CTX_KEY_ROTATION: &str = "DCP-AI.v2.KeyRotation";
pub const CTX_PROOF_OF_POSSESSION: &str = "DCP-AI.v2.ProofOfPossession";
pub const CTX_JURISDICTION_ATTESTATION: &str = "DCP-AI.v2.JurisdictionAttestation";
pub const CTX_HUMAN_CONFIRMATION: &str = "DCP-AI.v2.HumanConfirmation";
pub const CTX_MULTI_PARTY_AUTH: &str = "DCP-AI.v2.MultiPartyAuth";
pub const CTX_LIFECYCLE: &str = "DCP-AI.v2.Lifecycle";
pub const CTX_SUCCESSION: &str = "DCP-AI.v2.Succession";
pub const CTX_DISPUTE: &str = "DCP-AI.v2.Dispute";
pub const CTX_RIGHTS: &str = "DCP-AI.v2.Rights";
pub const CTX_DELEGATION: &str = "DCP-AI.v2.Delegation";
pub const CTX_AWARENESS: &str = "DCP-AI.v2.Awareness";

const VALID_CONTEXTS: &[&str] = &[
    CTX_AGENT_PASSPORT,
    CTX_RESPONSIBLE_PRINCIPAL,
    CTX_INTENT,
    CTX_POLICY_DECISION,
    CTX_AUDIT_EVENT,
    CTX_BUNDLE,
    CTX_REVOCATION,
    CTX_KEY_ROTATION,
    CTX_PROOF_OF_POSSESSION,
    CTX_JURISDICTION_ATTESTATION,
    CTX_HUMAN_CONFIRMATION,
    CTX_MULTI_PARTY_AUTH,
    CTX_LIFECYCLE,
    CTX_SUCCESSION,
    CTX_DISPUTE,
    CTX_RIGHTS,
    CTX_DELEGATION,
    CTX_AWARENESS,
];

pub fn is_valid_context(ctx: &str) -> bool {
    VALID_CONTEXTS.contains(&ctx)
}

/// Build a domain-separated message: UTF8(context) || 0x00 || canonical_payload_bytes
pub fn domain_separated_message(context: &str, canonical_payload: &[u8]) -> Result<Vec<u8>, String> {
    if !is_valid_context(context) {
        return Err(format!("Invalid domain separation context: {}", context));
    }
    let mut msg = Vec::with_capacity(context.len() + 1 + canonical_payload.len());
    msg.extend_from_slice(context.as_bytes());
    msg.push(0x00);
    msg.extend_from_slice(canonical_payload);
    Ok(msg)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_valid_context() {
        assert!(is_valid_context(CTX_AGENT_PASSPORT));
        assert!(!is_valid_context("DCP-AI.v2.Invalid"));
    }

    #[test]
    fn test_domain_separated_message() {
        let payload = b"test";
        let msg = domain_separated_message(CTX_INTENT, payload).unwrap();
        let expected_prefix = CTX_INTENT.as_bytes();
        assert_eq!(&msg[..expected_prefix.len()], expected_prefix);
        assert_eq!(msg[expected_prefix.len()], 0x00);
        assert_eq!(&msg[expected_prefix.len() + 1..], payload);
    }

    #[test]
    fn test_invalid_context_rejected() {
        let result = domain_separated_message("bad.context", b"data");
        assert!(result.is_err());
    }
}
