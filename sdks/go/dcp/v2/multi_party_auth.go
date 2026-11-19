// Package v2 — DCP v2.0 Multi-Party Authorization (Go port): the structural
// check. The decision is EvaluateMultiPartyAuthorization, in
// multi_party_profile.go.

package v2

// MultiPartyPolicy is the shape policy of CheckMultiPartyAuthorizationStructure.
// It is not the operator's policy set: that is NewMultiPartyPolicyStore.
type MultiPartyPolicy struct {
	RequiredParties int
	AllowedRoles    []string
	RequireOwner    bool
}

// DefaultMPAPolicy returns the baseline policy for a given operation, or nil
// if the operation is not one of the well-known types.
func DefaultMPAPolicy(operation string) *MultiPartyPolicy {
	switch operation {
	case "revoke_agent":
		return &MultiPartyPolicy{
			RequiredParties: 2,
			AllowedRoles:    []string{"owner", "org_admin", "recovery_contact"},
			RequireOwner:    true,
		}
	case "rotate_org_key", "change_jurisdiction":
		return &MultiPartyPolicy{
			RequiredParties: 2,
			AllowedRoles:    []string{"owner", "org_admin"},
			RequireOwner:    true,
		}
	case "modify_recovery_config":
		return &MultiPartyPolicy{
			RequiredParties: 2,
			AllowedRoles:    []string{"owner", "org_admin", "recovery_contact"},
			RequireOwner:    true,
		}
	}
	return nil
}

// MpaCheck is the outcome of CheckMultiPartyAuthorizationStructure.
type MpaCheck struct {
	Valid  bool
	Errors []string
}

// CheckMultiPartyAuthorizationStructure checks the shape of a record: how many
// authorizations it lists, with which roles, and that each carries a
// composite_sig.
//
// It verifies no signature, knows no party and reads no operator policy, so
// Valid says nothing about who signed or whether the operation is authorized:
// for that, EvaluateMultiPartyAuthorization.
func CheckMultiPartyAuthorizationStructure(mpa map[string]interface{}, policy *MultiPartyPolicy) MpaCheck {
	op, _ := mpa["operation"].(string)
	if policy == nil {
		policy = DefaultMPAPolicy(op)
	}
	if policy == nil {
		return MpaCheck{Valid: false, Errors: []string{"No policy defined for operation: " + op}}
	}

	auths, _ := mpa["authorizations"].([]map[string]interface{})
	if auths == nil {
		if generic, ok := mpa["authorizations"].([]interface{}); ok {
			for _, a := range generic {
				if am, ok := a.(map[string]interface{}); ok {
					auths = append(auths, am)
				}
			}
		}
	}

	errs := []string{}
	if len(auths) < policy.RequiredParties {
		errs = append(errs, "Insufficient authorizations")
	}
	if policy.RequireOwner {
		hasOwner := false
		for _, a := range auths {
			if a["role"] == "owner" {
				hasOwner = true
				break
			}
		}
		if !hasOwner {
			errs = append(errs, "Owner authorization required but not present")
		}
	}
	for _, a := range auths {
		role, _ := a["role"].(string)
		partyID, _ := a["party_id"].(string)
		if !containsString(policy.AllowedRoles, role) {
			errs = append(errs, "Role "+role+" not allowed for operation "+op)
		}
		if a["composite_sig"] == nil {
			errs = append(errs, "Missing composite_sig for party "+partyID)
		}
	}
	return MpaCheck{Valid: len(errs) == 0, Errors: errs}
}

// VerifyMultiPartyAuthorization is the former name of
// CheckMultiPartyAuthorizationStructure, with the same result.
//
// Deprecated: despite its name it verifies no signature and authorizes nothing:
// it checks the shape of the record. Use CheckMultiPartyAuthorizationStructure
// for that, and EvaluateMultiPartyAuthorization to decide whether an operation
// is authorized.
func VerifyMultiPartyAuthorization(mpa map[string]interface{}, policy *MultiPartyPolicy) MpaCheck {
	return CheckMultiPartyAuthorizationStructure(mpa, policy)
}

func containsString(haystack []string, needle string) bool {
	for _, s := range haystack {
		if s == needle {
			return true
		}
	}
	return false
}
