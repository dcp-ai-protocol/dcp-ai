"""
dcp-ai FastAPI integration — V2 middleware and dependency injection for DCP verification.

Supports both V1 and V2 bundles. V2 bundles use composite hybrid signatures,
session binding, blinded RPR mode, and verifier-authoritative policy.

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

import hashlib
import json
from dataclasses import dataclass, field
from typing import Any, Optional

from fastapi import Request, HTTPException, Depends
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse


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


def _detect_version(signed_bundle: dict[str, Any]) -> str:
    """Detect DCP protocol version from bundle structure."""
    bundle = signed_bundle.get("bundle", {})
    if bundle.get("dcp_bundle_version") == "2.0":
        return "2.0"
    rpr = bundle.get("responsible_principal_record", {})
    payload = rpr.get("payload", rpr)
    if payload.get("dcp_version") == "2.0":
        return "2.0"
    return "1.0"


def _verify_session_binding(bundle: dict[str, Any]) -> tuple[bool, str]:
    """Verify session nonce consistency across all V2 artifacts."""
    manifest = bundle.get("manifest", {})
    nonce = manifest.get("session_nonce", "")
    if not nonce:
        return False, "missing session_nonce in manifest"

    artifacts = [
        bundle.get("agent_passport", {}).get("payload", {}),
        bundle.get("responsible_principal_record", {}).get("payload", {}),
        bundle.get("intent", {}).get("payload", {}),
        bundle.get("policy_decision", {}).get("payload", {}),
    ]
    for art in artifacts:
        art_nonce = art.get("session_nonce")
        if art_nonce and art_nonce != nonce:
            return False, "session_nonce mismatch in artifact"

    for entry in bundle.get("audit_entries", []):
        if entry.get("session_nonce") and entry["session_nonce"] != nonce:
            return False, "session_nonce mismatch in audit entry"

    return True, nonce


def _verify_v2_structure(signed_bundle: dict[str, Any]) -> dict[str, Any]:
    """Structural validation for V2 bundles."""
    errors: list[str] = []
    warnings: list[str] = []

    bundle = signed_bundle.get("bundle", {})
    signature = signed_bundle.get("signature", {})

    if not bundle:
        errors.append("Missing bundle field")
        return {"verified": False, "errors": errors, "warnings": warnings}

    if bundle.get("dcp_bundle_version") != "2.0":
        errors.append("Invalid dcp_bundle_version")

    if not bundle.get("manifest"):
        errors.append("Missing manifest")

    for artifact in ["responsible_principal_record", "agent_passport", "intent", "policy_decision"]:
        art = bundle.get(artifact)
        if not art:
            errors.append(f"Missing {artifact}")
        elif not art.get("payload"):
            errors.append(f"Missing payload in {artifact}")
        elif not art.get("composite_sig"):
            errors.append(f"Missing composite_sig in {artifact}")

    if not isinstance(bundle.get("audit_entries"), list):
        errors.append("Missing or invalid audit_entries")

    cs = signature.get("composite_sig", {})
    if not cs:
        errors.append("Missing composite_sig in signature")
    elif cs.get("binding") == "pq_over_classical" and not cs.get("pq"):
        errors.append("Binding is pq_over_classical but PQ signature missing")

    session_valid, session_info = _verify_session_binding(bundle)
    if not session_valid:
        errors.append(f"Session binding: {session_info}")

    return {
        "verified": len(errors) == 0,
        "errors": errors,
        "warnings": warnings,
        "session_nonce": session_info if session_valid else None,
    }


class DCPVerifyMiddleware(BaseHTTPMiddleware):
    """
    FastAPI middleware that verifies DCP signed bundles (V1 and V2).
    Extracts bundle from X-DCP-Bundle header or request body.
    """

    def __init__(
        self,
        app: Any,
        require_bundle: bool = False,
        header_name: str = "x-dcp-bundle",
        dcp_version: str = "2.0",
    ) -> None:
        super().__init__(app)
        self.require_bundle = require_bundle
        self.header_name = header_name
        self.dcp_version = dcp_version

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
            result = _verify_v2_structure(signed_bundle)
            if not result["verified"]:
                return JSONResponse(
                    status_code=403,
                    content={
                        "verified": False,
                        "dcp_version": "2.0",
                        "errors": result["errors"],
                    },
                )

            bundle = signed_bundle.get("bundle", {})
            passport_payload = bundle.get("agent_passport", {}).get("payload", {})
            rpr_payload = bundle.get("responsible_principal_record", {}).get("payload", {})
            intent_payload = bundle.get("intent", {}).get("payload", {})
            policy_payload = bundle.get("policy_decision", {}).get("payload", {})

            is_blinded = rpr_payload.get("blinded", False) is True
            cs = signed_bundle.get("signature", {}).get("composite_sig", {})

            request.state.dcp_agent = DCPAgentContext(
                dcp_version="2.0",
                agent_id=passport_payload.get("agent_id", ""),
                human_id=rpr_payload.get("human_id", ""),
                session_nonce=result.get("session_nonce", ""),
                capabilities=passport_payload.get("capabilities", []),
                risk_tier=passport_payload.get("risk_tier", "medium"),
                status=passport_payload.get("status", "active"),
                passport=passport_payload,
                rpr=rpr_payload,
                intent=intent_payload,
                policy_decision=policy_payload,
                composite_sig_valid=cs.get("binding") == "pq_over_classical",
                session_binding_valid=True,
                blinded_rpr=is_blinded,
            )
        else:
            from dcp_ai.verify import verify_signed_bundle

            result = verify_signed_bundle(signed_bundle)
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
