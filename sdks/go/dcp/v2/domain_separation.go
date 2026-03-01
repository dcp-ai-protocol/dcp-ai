package v2

import "fmt"

// Domain separation context constants for DCP v2.0.
const (
	CtxAgentPassport           = "DCP-AI.v2.AgentPassport"
	CtxResponsiblePrincipal            = "DCP-AI.v2.ResponsiblePrincipal"
	CtxIntent                  = "DCP-AI.v2.Intent"
	CtxPolicyDecision          = "DCP-AI.v2.PolicyDecision"
	CtxAuditEvent              = "DCP-AI.v2.AuditEvent"
	CtxBundle                  = "DCP-AI.v2.Bundle"
	CtxRevocation              = "DCP-AI.v2.Revocation"
	CtxKeyRotation             = "DCP-AI.v2.KeyRotation"
	CtxProofOfPossession       = "DCP-AI.v2.ProofOfPossession"
	CtxJurisdictionAttestation = "DCP-AI.v2.JurisdictionAttestation"
	CtxHumanConfirmation       = "DCP-AI.v2.HumanConfirmation"
)

var validContexts = map[string]bool{
	CtxAgentPassport:           true,
	CtxResponsiblePrincipal:            true,
	CtxIntent:                  true,
	CtxPolicyDecision:          true,
	CtxAuditEvent:              true,
	CtxBundle:                  true,
	CtxRevocation:              true,
	CtxKeyRotation:             true,
	CtxProofOfPossession:       true,
	CtxJurisdictionAttestation: true,
	CtxHumanConfirmation:       true,
}

// DomainSeparatedMessage produces: UTF8(context) || 0x00 || canonicalPayloadBytes.
// Returns an error if the context string is not a recognized DCP v2 context.
func DomainSeparatedMessage(context string, canonicalPayload []byte) ([]byte, error) {
	if !validContexts[context] {
		return nil, fmt.Errorf("invalid domain separation context: %q", context)
	}
	ctxBytes := []byte(context)
	msg := make([]byte, 0, len(ctxBytes)+1+len(canonicalPayload))
	msg = append(msg, ctxBytes...)
	msg = append(msg, 0x00)
	msg = append(msg, canonicalPayload...)
	return msg, nil
}
