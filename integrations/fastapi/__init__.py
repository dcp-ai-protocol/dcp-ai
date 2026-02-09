"""
dcp-ai FastAPI integration — Middleware and dependency injection for DCP verification.

Usage:
    from dcp_ai.fastapi import DCPVerifyMiddleware, require_dcp

    app = FastAPI()
    app.add_middleware(DCPVerifyMiddleware)

    @app.post("/agent/action")
    async def agent_action(request: Request, agent=Depends(require_dcp)):
        # agent.passport, agent.hbr, agent.intent available
        ...
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any, Optional

from fastapi import Request, HTTPException, Depends
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse


@dataclass
class DCPAgentContext:
    """Verified DCP agent context injected into requests."""
    agent_id: str = ""
    human_id: str = ""
    public_key: str = ""
    capabilities: list[str] = field(default_factory=list)
    risk_tier: str = "medium"
    status: str = "active"
    passport: dict[str, Any] = field(default_factory=dict)
    hbr: dict[str, Any] = field(default_factory=dict)
    intent: dict[str, Any] = field(default_factory=dict)


class DCPVerifyMiddleware(BaseHTTPMiddleware):
    """
    FastAPI middleware that verifies DCP signed bundles.
    Extracts bundle from X-DCP-Bundle header or request body.
    """

    def __init__(
        self,
        app: Any,
        require_bundle: bool = False,
        header_name: str = "x-dcp-bundle",
    ) -> None:
        super().__init__(app)
        self.require_bundle = require_bundle
        self.header_name = header_name

    async def dispatch(self, request: Request, call_next: Any) -> Any:
        from dcp_ai.verify import verify_signed_bundle

        signed_bundle = None

        # Try header
        header_value = request.headers.get(self.header_name)
        if header_value:
            try:
                signed_bundle = json.loads(header_value)
            except (json.JSONDecodeError, TypeError):
                pass

        # Try body
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

        # Verify
        result = verify_signed_bundle(signed_bundle)

        if not result["verified"]:
            return JSONResponse(
                status_code=403,
                content={"verified": False, "errors": result.get("errors", [])},
            )

        # Inject context
        bundle = signed_bundle.get("bundle", {})
        passport = bundle.get("agent_passport", {})
        hbr = bundle.get("human_binding_record", {})

        request.state.dcp_agent = DCPAgentContext(
            agent_id=passport.get("agent_id", ""),
            human_id=hbr.get("human_id", ""),
            public_key=passport.get("public_key", ""),
            capabilities=passport.get("capabilities", []),
            risk_tier=passport.get("risk_tier", "medium"),
            status=passport.get("status", "active"),
            passport=passport,
            hbr=hbr,
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
