"""
DCP v2.0 Multi-Party Authorization (Gap #5).

Critical operations require M-of-N composite signatures from authorized
parties. This module provides models and verification logic.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


MultiPartyOperation = Literal[
    "revoke_agent",
    "rotate_org_key",
    "change_jurisdiction",
    "modify_recovery_config",
]

AuthorizationRole = Literal["owner", "org_admin", "recovery_contact"]


class PartyAuthorization(BaseModel):
    party_id: str
    role: AuthorizationRole
    composite_sig: dict[str, Any]


class MultiPartyAuthorization(BaseModel):
    type: Literal["multi_party_authorization"] = "multi_party_authorization"
    operation: MultiPartyOperation
    operation_payload: dict[str, Any]
    required_parties: int = 2
    authorizations: list[PartyAuthorization]


class MultiPartyPolicy(BaseModel):
    required_parties: int = 2
    allowed_roles: list[AuthorizationRole] = Field(
        default_factory=lambda: ["owner", "org_admin", "recovery_contact"]
    )
    require_owner: bool = True


DEFAULT_POLICIES: dict[str, MultiPartyPolicy] = {
    "revoke_agent": MultiPartyPolicy(
        required_parties=2,
        allowed_roles=["owner", "org_admin", "recovery_contact"],
        require_owner=True,
    ),
    "rotate_org_key": MultiPartyPolicy(
        required_parties=2,
        allowed_roles=["owner", "org_admin"],
        require_owner=True,
    ),
    "change_jurisdiction": MultiPartyPolicy(
        required_parties=2,
        allowed_roles=["owner", "org_admin"],
        require_owner=True,
    ),
    "modify_recovery_config": MultiPartyPolicy(
        required_parties=2,
        allowed_roles=["owner", "org_admin", "recovery_contact"],
        require_owner=True,
    ),
}


def verify_multi_party_authorization(
    mpa: MultiPartyAuthorization,
    policy: MultiPartyPolicy | None = None,
) -> dict[str, Any]:
    """Structurally verify a multi-party authorization meets the policy threshold.

    Cryptographic signature verification of each party's composite_sig
    requires the algorithm registry and party public keys, which is done
    at the gateway level. This function validates the structural requirements.
    """
    errors: list[str] = []
    effective_policy = policy or DEFAULT_POLICIES.get(mpa.operation)

    if effective_policy is None:
        return {
            "valid": False,
            "errors": [f"No policy defined for operation: {mpa.operation}"],
        }

    if len(mpa.authorizations) < effective_policy.required_parties:
        errors.append(
            f"Insufficient authorizations: {len(mpa.authorizations)} < {effective_policy.required_parties}"
        )

    if effective_policy.require_owner:
        has_owner = any(a.role == "owner" for a in mpa.authorizations)
        if not has_owner:
            errors.append("Owner authorization required but not present")

    for auth in mpa.authorizations:
        if auth.role not in effective_policy.allowed_roles:
            errors.append(
                f"Role {auth.role} not allowed for operation {mpa.operation}"
            )
        if not auth.composite_sig:
            errors.append(f"Missing composite_sig for party {auth.party_id}")

    return {"valid": len(errors) == 0, "errors": errors}
