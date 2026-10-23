"""
dcp-ai FastAPI integration — V2 middleware and dependency injection for DCP verification.

Supports both V1 and V2 bundles. A V2 bundle is accepted only when
`verify_signed_bundle_v2` from `dcp_ai.v2` accepts it under the middleware's
verifier policy (`verifier_policy` over `DEFAULT_VERIFIER_POLICY`): composite
hybrid signatures, session binding, manifest integrity, audit chain, key validity.
A V1 bundle (one Ed25519 signature) is accepted only when no risk tier of the
policy requires a post-quantum signature.

Usage:
    from dcp_ai.fastapi import DCPVerifyMiddleware, require_dcp

    app = FastAPI()
    app.add_middleware(DCPVerifyMiddleware, require_bundle=True, dcp_version="2.0")

    @app.post("/agent/action")
    async def agent_action(request: Request, agent=Depends(require_dcp)):
        # agent.passport, agent.rpr, agent.intent, agent.session_nonce available
        ...
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any, Optional

from fastapi import Request, HTTPException, Depends
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

from dcp_ai.providers import Ed25519Provider, MlDsa65Provider, SlhDsa192fProvider
from dcp_ai.v2.crypto_registry import AlgorithmRegistry
from dcp_ai.v2.models import VerifierPolicy
from dcp_ai.v2.verify import DEFAULT_VERIFIER_POLICY, verify_signed_bundle_v2
from dcp_ai.verify import verify_signed_bundle


@dataclass
class DCPAgentContext:
    """Verified DCP agent context injected into requests."""
    dcp_version: str = "1.0"
    agent_id: str = ""
    human_id: str = ""
    session_nonce: str = ""
    public_key: str = ""
    capabilities: list[str] = field(default_factory=list)
    risk_tier: str = "medium"
    status: str = "active"
    passport: dict[str, Any] = field(default_factory=dict)
    rpr: dict[str, Any] = field(default_factory=dict)
    intent: dict[str, Any] = field(default_factory=dict)
    policy_decision: dict[str, Any] = field(default_factory=dict)
    composite_sig_valid: bool = False
    session_binding_valid: bool = False
    blinded_rpr: bool = False
    lifecycle_state: str = "active"
    mandate_id: str = ""
    mandate_valid: bool = False
    warnings: list[str] = field(default_factory=list)


_RISK_TIERS = ("low", "medium", "high")
_VERIFICATION_MODES = ("classical_only", "hybrid_preferred", "hybrid_required", "pq_only")
_SIGNED_ARTIFACTS = ("responsible_principal_record", "agent_passport", "intent", "policy_decision")

# Built once: the providers the V2 verifier needs (Ed25519, ML-DSA-65, SLH-DSA-192f).
_REGISTRY = AlgorithmRegistry()
for _provider in (Ed25519Provider(), MlDsa65Provider(), SlhDsa192fProvider()):
    _REGISTRY.register_signer(_provider)


def _resolve_verifier_policy(verifier_policy: dict[str, Any] | VerifierPolicy | None) -> dict[str, Any]:
    """`verifier_policy` over DEFAULT_VERIFIER_POLICY, validated as a VerifierPolicy.

    A VerifierPolicy instance is used as is. A dict sets fields over the default
    policy; a default_mode given without risk_overrides applies to every risk
    tier, and a risk_overrides dict sets tiers over the others. Unknown fields
    (pydantic.ValidationError) and unknown verification modes (ValueError) raise.
    """
    if isinstance(verifier_policy, VerifierPolicy):
        policy = verifier_policy.model_dump()
    else:
        configured = dict(verifier_policy or {})
        merged = {**DEFAULT_VERIFIER_POLICY, **configured}
        overrides = configured.get("risk_overrides", ...)
        if overrides is ... or isinstance(overrides, dict):
            base = (
                dict.fromkeys(_RISK_TIERS, configured["default_mode"])
                if "default_mode" in configured
                else DEFAULT_VERIFIER_POLICY["risk_overrides"]
            )
            merged["risk_overrides"] = {**base, **({} if overrides is ... else overrides)}
        policy = VerifierPolicy.model_validate(merged).model_dump()
    for mode in [policy["default_mode"], *(policy["risk_overrides"] or {}).values()]:
        if mode not in _VERIFICATION_MODES:
            raise ValueError(f"Unknown verification mode in verifier_policy: {mode}")
    return policy


def _v1_refusal(policy: dict[str, Any]) -> str | None:
    """Why a V1 bundle (no post-quantum signature) is refused under `policy`, or None.

    A V1 passport's risk tier is self-declared, so V1 is refused as soon as any
    tier requires a post-quantum signature; DEFAULT_VERIFIER_POLICY does for "high".
    """
    if not policy.get("allow_v1_bundles"):
        return "V1 bundles are not accepted: verifier policy allow_v1_bundles is false"
    modes = [policy["default_mode"], *(policy.get("risk_overrides") or {}).values()]
    strict = next((m for m in modes if m in ("hybrid_required", "pq_only")), None)
    if strict:
        return (
            f"V1 bundles are not accepted: the verifier policy requires {strict} for a risk tier, "
            "and a V1 bundle has no post-quantum signature"
        )
    return None


def _detect_version(signed_bundle: Any) -> Optional[str]:
    """DCP protocol version of a signed bundle: "2.0", "1.0", or None when undetectable."""
    bundle = signed_bundle.get("bundle") if isinstance(signed_bundle, dict) else None
    if not isinstance(bundle, dict):
        return None
    if bundle.get("dcp_bundle_version") == "2.0":
        return "2.0"
    rpr = bundle.get("responsible_principal_record")
    if not isinstance(rpr, dict):
        return None
    if isinstance(rpr.get("payload"), dict):
        return "2.0" if rpr["payload"].get("dcp_version") == "2.0" else None
    return "1.0" if rpr.get("dcp_version") == "1.0" else None


def _v2_shape_errors(signed_bundle: dict[str, Any]) -> list[str]:
    """Shape checks with clearer errors than the verifier's. Never a verdict:
    an empty list only means the bundle can go to verify_signed_bundle_v2."""
    bundle = signed_bundle.get("bundle")
    signature = signed_bundle.get("signature")
    if not isinstance(bundle, dict) or not bundle:
        return ["Missing bundle field"]

    errors: list[str] = []
    if not isinstance(bundle.get("manifest"), dict):
        errors.append("Missing manifest")
    for artifact in _SIGNED_ARTIFACTS:
        art = bundle.get(artifact)
        if not isinstance(art, dict) or not art:
            errors.append(f"Missing {artifact}")
        elif not isinstance(art.get("payload"), dict):
            errors.append(f"Missing payload in {artifact}")
        elif not isinstance(art.get("composite_sig"), dict):
            errors.append(f"Missing composite_sig in {artifact}")
    if not isinstance(bundle.get("audit_entries"), list):
        errors.append("Missing or invalid audit_entries")

    cs = signature.get("composite_sig") if isinstance(signature, dict) else None
    if not isinstance(cs, dict) or not cs:
        errors.append("Missing composite_sig in signature")
    elif cs.get("binding") == "pq_over_classical" and not cs.get("pq"):
        errors.append("Binding is pq_over_classical but PQ signature missing")
    return errors


class DCPVerifyMiddleware(BaseHTTPMiddleware):
    """
    FastAPI middleware that verifies DCP signed bundles (V1 and V2).
    Extracts bundle from X-DCP-Bundle header or request body.

    `verifier_policy` (a dict of VerifierPolicy fields set over
    DEFAULT_VERIFIER_POLICY, or a full VerifierPolicy) is passed to
    verify_signed_bundle_v2 and also decides whether V1 bundles are accepted.
    """

    def __init__(
        self,
        app: Any,
        require_bundle: bool = False,
        header_name: str = "x-dcp-bundle",
        dcp_version: str = "2.0",
        verifier_policy: dict[str, Any] | VerifierPolicy | None = None,
    ) -> None:
        super().__init__(app)
        self.require_bundle = require_bundle
        self.header_name = header_name
        self.dcp_version = dcp_version
        self.verifier_policy = _resolve_verifier_policy(verifier_policy)
        self._v1_refusal = _v1_refusal(self.verifier_policy)

    async def dispatch(self, request: Request, call_next: Any) -> Any:
        signed_bundle = None

        header_value = request.headers.get(self.header_name)
        if header_value:
            try:
                signed_bundle = json.loads(header_value)
            except (json.JSONDecodeError, TypeError):
                pass

        if not signed_bundle:
            try:
                body = await request.json()
                signed_bundle = body.get("signed_bundle") if isinstance(body, dict) else None
            except Exception:
                pass

        if not signed_bundle:
            if self.require_bundle:
                return JSONResponse(
                    status_code=403,
                    content={"verified": False, "errors": ["Missing DCP signed bundle"]},
                )
            return await call_next(request)

        version = _detect_version(signed_bundle)

        if version == "2.0":
            errors = _v2_shape_errors(signed_bundle)
            if errors:
                result = {"verified": False, "errors": errors, "warnings": [], "details": {}}
            else:
                result = await verify_signed_bundle_v2(signed_bundle, _REGISTRY, self.verifier_policy)
            if not result["verified"]:
                return JSONResponse(
                    status_code=403,
                    content={
                        "verified": False,
                        "dcp_version": "2.0",
                        "errors": result["errors"],
                        "warnings": result["warnings"],
                    },
                )

            details = result["details"]
            bundle = signed_bundle["bundle"]
            passport_payload = bundle["agent_passport"]["payload"]
            rpr_payload = bundle["responsible_principal_record"]["payload"]

            request.state.dcp_agent = DCPAgentContext(
                dcp_version="2.0",
                agent_id=passport_payload.get("agent_id", ""),
                human_id=rpr_payload.get("human_id", ""),
                session_nonce=details.get("session_nonce") or "",
                capabilities=passport_payload.get("capabilities", []),
                risk_tier=passport_payload.get("risk_tier", "medium"),
                status=passport_payload.get("status", "active"),
                passport=passport_payload,
                rpr=rpr_payload,
                intent=bundle["intent"]["payload"],
                policy_decision=bundle["policy_decision"]["payload"],
                composite_sig_valid=details.get("signature_valid") is True,
                session_binding_valid=bool(details.get("session_nonce")),
                blinded_rpr=rpr_payload.get("blinded", False) is True,
                lifecycle_state=passport_payload.get("status", "active"),
                warnings=list(result["warnings"]),
            )
        elif version == "1.0":
            result = (
                {"verified": False, "errors": [self._v1_refusal]}
                if self._v1_refusal
                else verify_signed_bundle(signed_bundle)
            )
            if not result["verified"]:
                return JSONResponse(
                    status_code=403,
                    content={"verified": False, "errors": result.get("errors", [])},
                )

            bundle = signed_bundle.get("bundle", {})
            passport = bundle.get("agent_passport", {})
            rpr = bundle.get("responsible_principal_record", {})

            request.state.dcp_agent = DCPAgentContext(
                dcp_version="1.0",
                agent_id=passport.get("agent_id", ""),
                human_id=rpr.get("human_id", ""),
                public_key=passport.get("public_key", ""),
                capabilities=passport.get("capabilities", []),
                risk_tier=passport.get("risk_tier", "medium"),
                status=passport.get("status", "active"),
                passport=passport,
                rpr=rpr,
                intent=bundle.get("intent", {}),
            )
        else:
            return JSONResponse(
                status_code=403,
                content={
                    "verified": False,
                    "errors": [
                        'Unrecognized DCP bundle version: expected bundle.dcp_bundle_version "2.0" '
                        'or bundle.responsible_principal_record.dcp_version "1.0"'
                    ],
                },
            )

        return await call_next(request)


async def require_dcp(request: Request) -> DCPAgentContext:
    """
    FastAPI dependency that requires a verified DCP agent context.
    Use with Depends(require_dcp).
    """
    agent = getattr(request.state, "dcp_agent", None)
    if agent is None:
        raise HTTPException(
            status_code=403,
            detail="DCP agent verification required. Include signed bundle in X-DCP-Bundle header.",
        )
    return agent


async def require_dcp_commissioned(request: Request) -> DCPAgentContext:
    """
    FastAPI dependency that requires a commissioned (non-decommissioned) DCP agent.
    Rejects agents with lifecycle_state == "decommissioned" (DCP-05 §5.1).
    """
    agent = await require_dcp(request)
    if agent.lifecycle_state == "decommissioned":
        raise HTTPException(
            status_code=403,
            detail="Agent is decommissioned (DCP-05 §5.1). Decommissioned agents cannot perform actions.",
        )
    return agent


async def require_dcp_mandated(request: Request) -> DCPAgentContext:
    """
    FastAPI dependency that requires a valid delegation mandate (DCP-09 §3.1).
    """
    agent = await require_dcp(request)
    if not agent.mandate_id:
        raise HTTPException(
            status_code=403,
            detail="Delegation mandate required (DCP-09 §3.1). No mandate_id present.",
        )
    return agent


async def require_dcp_v2(request: Request) -> DCPAgentContext:
    """
    FastAPI dependency that requires a verified DCP V2 agent context.
    Rejects V1 bundles.
    """
    agent = await require_dcp(request)
    if agent.dcp_version != "2.0":
        raise HTTPException(
            status_code=403,
            detail="DCP v2.0 bundle required. V1 bundles not accepted on this endpoint.",
        )
    if not agent.session_nonce:
        raise HTTPException(
            status_code=403,
            detail="DCP v2.0 session binding required.",
        )
    return agent
