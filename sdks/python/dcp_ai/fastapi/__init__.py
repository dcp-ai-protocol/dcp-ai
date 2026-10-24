"""
dcp-ai FastAPI integration — V2 middleware and dependency injection for DCP verification.

Supports both V1 and V2 bundles. A V2 bundle is accepted only when
`verify_signed_bundle_v2` from `dcp_ai.v2` accepts it under the middleware's
verifier policy (`verifier_policy` over `DEFAULT_VERIFIER_POLICY`): composite
hybrid signatures, session binding, manifest integrity, audit chain, key validity.
A V1 bundle (one Ed25519 signature) is accepted only when no risk tier of the
policy requires a post-quantum signature.

Admission (spec/profiles/admission): with `trusted_principals` the middleware also
requires the bundle to be signed for a principal of the operator's trust set, with
keys that trust set lists, and with `profile` (strict-v1) the profile's fixed
requirements and a fresh revocation status from `revocation_source`. A request
reaches the route only when the bundle is admitted.

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

import asyncio
import inspect
import json
import logging
import math
import time
from dataclasses import dataclass, field
from typing import Any, Callable

from fastapi import Request, HTTPException, Depends
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

# The registry, the verifier policy and the V1 rule are shared with the LangChain
# and OpenAI bridges (dcp_ai._verify_any).
from dcp_ai._verify_any import (
    _REGISTRY,
    bounded_result as _bounded_result,
    detect_version as _detect_version,
    resolve_verifier_policy as _resolve_verifier_policy,
    v1_refusal as _v1_refusal,
)
from dcp_ai.v2.admission import (
    AdmissionConfigError,
    PrincipalTrustStore,
    create_principal_trust_store,
    evaluate_admission_v2,
    resolve_strict_v1_profile,
    revocation_subjects,
)
from dcp_ai.v2.models import VerifierPolicy
# Re-exported for the middleware's revocation_source argument.
from dcp_ai.v2.revocation_source import RevocationSourceError, deny_list_revocation_source  # noqa: F401
from dcp_ai.v2.verify import verify_signed_bundle_v2
from dcp_ai.verify import verify_signed_bundle

_logger = logging.getLogger("dcp_ai.fastapi")


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
    # Admission (spec/profiles/admission § 5.2). Set only by a middleware configured with
    # trusted_principals (and optionally profile); otherwise admitted stays False.
    admitted: bool = False
    principal_trust: str = "not_evaluated"
    profile: str | None = None
    profile_compliance: str = "not_evaluated"
    recorded_decision: str | None = None
    trust_set_version: str | None = None
    action_authorized: bool = False  # always False: admission does not authorize an action


_SIGNED_ARTIFACTS = ("responsible_principal_record", "agent_passport", "intent", "policy_decision")


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
    if bundle.get("pq_checkpoints") is not None and not isinstance(bundle["pq_checkpoints"], list):
        errors.append("Invalid pq_checkpoints")

    cs = signature.get("composite_sig") if isinstance(signature, dict) else None
    if not isinstance(cs, dict) or not cs:
        errors.append("Missing composite_sig in signature")
    elif cs.get("binding") == "pq_over_classical" and not cs.get("pq"):
        errors.append("Binding is pq_over_classical but PQ signature missing")
    return errors


def _v2_agent_context(signed_bundle: dict[str, Any], details: dict[str, Any], warnings: list[str]) -> DCPAgentContext:
    """The context of a verified V2 bundle."""
    bundle = signed_bundle["bundle"]
    passport_payload = bundle["agent_passport"]["payload"]
    rpr_payload = bundle["responsible_principal_record"]["payload"]
    return DCPAgentContext(
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
        warnings=warnings,
    )


def _system_clock_ms() -> int:
    return time.time_ns() // 1_000_000


def _no_tenant(request: Request) -> str:
    return ""


def _optional_callable(value: Any, name: str) -> Callable[..., Any] | None:
    if value is not None and not callable(value):
        raise AdmissionConfigError("CONFIG_INVALID_VALUE", f"{name} must be a callable")
    return value


def _trust_source(value: Any) -> PrincipalTrustStore | Callable[..., Any] | None:
    """A trust set (validated now) or a callable of the tenant that returns one."""
    if value is None or callable(value):
        return value
    if isinstance(value, (dict, PrincipalTrustStore)):
        return create_principal_trust_store(value)
    raise AdmissionConfigError(
        "CONFIG_INVALID_VALUE", "trusted_principals must be a trust set or a callable of the tenant that returns one"
    )


def _positive_seconds(value: Any, name: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value <= 0:
        raise AdmissionConfigError("CONFIG_INVALID_VALUE", f"{name} must be a positive number of seconds")
    return float(value)


def _is_async_callable(fn: Any) -> bool:
    return inspect.iscoroutinefunction(fn) or inspect.iscoroutinefunction(getattr(fn, "__call__", None))


def _failed_verification(error: str) -> dict[str, Any]:
    return {"verified": False, "errors": [error], "warnings": [], "details": {}}


def _admission_refusal(result: dict[str, Any]) -> dict[str, Any]:
    """The 403 body of a bundle that is not admitted: codes, and bounded messages."""
    messages = [f"{e['code']}: {e['message']}" for e in result["errors"]]
    return {
        "verified": result["verified"],
        "admitted": False,
        "principal_trust": result["principal_trust"],
        "profile": result["profile"],
        "profile_compliance": result["profile_compliance"],
        "codes": sorted({e["code"] for e in result["errors"]}),
        "errors": _bounded_result({"errors": messages})["errors"],
    }


class DCPVerifyMiddleware(BaseHTTPMiddleware):
    """
    FastAPI middleware that verifies DCP signed bundles (V1 and V2).
    Extracts bundle from X-DCP-Bundle header or request body.

    `verifier_policy` (a dict of VerifierPolicy fields set over
    DEFAULT_VERIFIER_POLICY, or a full VerifierPolicy) is passed to
    verify_signed_bundle_v2 and also decides whether V1 bundles are accepted.
    `dcp_version` is stored but not enforced: whether V1 bundles are accepted
    is up to the policy (allow_v1_bundles and the V1 rule of _v1_refusal), and
    require_dcp_v2 restricts a route to V2.

    Admission (spec/profiles/admission), keyword arguments only; without them the
    middleware behaves as above:

    - `trusted_principals`: the operator's trust set (a dict, validated here), or a
      callable `(tenant) -> trust set` (sync or async), called on every admission and
      validated with create_principal_trust_store. A synchronous one runs on the
      event loop. It needs `require_bundle=True`: otherwise a caller whose bundle
      would be refused could just omit it.
    - `profile`: a strict-v1 configuration, loaded here with resolve_strict_v1_profile.
      It needs `trusted_principals`, `revocation_source` and `require_bundle=True`,
      and sets the verifier policy itself, so `verifier_policy` must not be given.
    - `revocation_source`: required with `profile`; a callable `(subjects, tenant) ->
      revocation snapshot | None` (sync, run in a worker thread, or async), called on
      every admission of a verified bundle with revocation_subjects(...), under
      `revocation_timeout` seconds (default 5). A timeout, an exception or None is
      REVOCATION_UNAVAILABLE; an exception whose `code` is REVOCATION_INVALID is
      REVOCATION_INVALID. A failure is never taken as not revoked.
      deny_list_revocation_source(url) builds one over a deny list.
    - `tenant`: a callable `(request) -> str` of the operator's, for instance reading
      an authenticated principal its own middleware set on request.state; default
      always "". It is passed to the trust and revocation callables.
    - `clock`: a callable returning the time in milliseconds since the epoch, for
      tests; default the system clock.

    The trust set, profile, policy, revocation source and tenant come only from these
    arguments, never from a request header, query or body. With `trusted_principals`
    a request reaches the route only when its bundle is admitted (spec A1): V1
    bundles never are (they carry no principal signature to anchor), and a V2 bundle
    is verified at the clock's time under the profile's policy (or `verifier_policy`)
    and then evaluated with evaluate_admission_v2. A refused request gets 403 with
    {"verified", "admitted": false, "principal_trust", "profile",
    "profile_compliance", "codes", "errors"}; when the tenant or the trust set cannot
    be resolved, 503. An admitted one gets request.state.dcp_agent with the
    admission fields set.

    Contradictions (`trusted_principals` or `profile` without `require_bundle=True`,
    a profile without `trusted_principals` or `revocation_source`, or with
    `verifier_policy`) raise AdmissionConfigError (CONFIG_PROFILE_CONTRADICTION), and
    wrongly typed arguments AdmissionConfigError (CONFIG_INVALID_VALUE), when the
    middleware is built.
    """

    def __init__(
        self,
        app: Any,
        require_bundle: bool = False,
        header_name: str = "x-dcp-bundle",
        dcp_version: str = "2.0",
        verifier_policy: dict[str, Any] | VerifierPolicy | None = None,
        *,
        trusted_principals: Any = None,
        profile: Any = None,
        revocation_source: Callable[..., Any] | None = None,
        revocation_timeout: float = 5.0,
        tenant: Callable[[Request], str] | None = None,
        clock: Callable[[], int] | None = None,
    ) -> None:
        super().__init__(app)
        self.require_bundle = require_bundle
        self.header_name = header_name
        self.dcp_version = dcp_version
        self.verifier_policy = _resolve_verifier_policy(verifier_policy)

        self._profile = None if profile is None else resolve_strict_v1_profile(profile)
        self._trusted_principals = _trust_source(trusted_principals)
        self._revocation_source = _optional_callable(revocation_source, "revocation_source")
        self._revocation_timeout = _positive_seconds(revocation_timeout, "revocation_timeout")
        self._tenant = _optional_callable(tenant, "tenant") or _no_tenant
        self._given_clock = _optional_callable(clock, "clock")
        self._clock = self._given_clock or _system_clock_ms
        if self._profile is not None:
            if self._trusted_principals is None:
                raise AdmissionConfigError("CONFIG_PROFILE_CONTRADICTION", "strict-v1 requires trusted_principals")
            if self._revocation_source is None:
                raise AdmissionConfigError("CONFIG_PROFILE_CONTRADICTION", "strict-v1 requires a revocation_source")
            if verifier_policy is not None:
                raise AdmissionConfigError(
                    "CONFIG_PROFILE_CONTRADICTION",
                    "strict-v1 sets its own verifier policy; do not pass verifier_policy",
                )
            if not require_bundle:
                raise AdmissionConfigError(
                    "CONFIG_PROFILE_CONTRADICTION",
                    "strict-v1 requires require_bundle=True: a request without a bundle must not reach the route",
                )
        elif self._revocation_source is not None:
            raise AdmissionConfigError("CONFIG_INVALID_VALUE", "revocation_source is evaluated under a profile only")
        if self._trusted_principals is not None and not require_bundle:
            # Otherwise a caller whose bundle would be refused just omits it.
            raise AdmissionConfigError(
                "CONFIG_PROFILE_CONTRADICTION",
                "trusted_principals requires require_bundle=True: a request without a bundle must not reach the route",
            )

    async def dispatch(self, request: Request, call_next: Any) -> Any:
        signed_bundle = None

        header_value = request.headers.get(self.header_name)
        if header_value:
            try:
                signed_bundle = json.loads(header_value)
            except (ValueError, TypeError, RecursionError):
                # Not JSON, an integer over Python's 4300-digit limit, or nesting too deep.
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

        if self._trusted_principals is not None:
            refusal = await self._admit(request, signed_bundle)
            if refusal is not None:
                return refusal
            return await call_next(request)

        clock = self._given_clock
        version = _detect_version(signed_bundle)

        if version == "2.0":
            errors = _v2_shape_errors(signed_bundle)
            if errors:
                result = {"verified": False, "errors": errors, "warnings": [], "details": {}}
            else:
                try:
                    if clock is None:
                        result = await verify_signed_bundle_v2(signed_bundle, _REGISTRY, self.verifier_policy)
                    else:
                        result = await verify_signed_bundle_v2(
                            signed_bundle, _REGISTRY, self.verifier_policy, now_ms=clock()
                        )
                except RecursionError:
                    result = {"verified": False, "errors": ["Signed bundle is nested too deeply"], "warnings": []}
            # Errors and warnings carry bundle text: bounded and escaped, as the bridges return them.
            bounded = _bounded_result(result)
            if not result["verified"]:
                return JSONResponse(
                    status_code=403,
                    content={
                        "verified": False,
                        "dcp_version": "2.0",
                        "errors": bounded["errors"],
                        "warnings": bounded["warnings"],
                    },
                )

            request.state.dcp_agent = _v2_agent_context(signed_bundle, result["details"], bounded["warnings"])
        elif version == "1.0":
            refusal = _v1_refusal(self.verifier_policy, signed_bundle.get("bundle"))
            if refusal:
                result = {"verified": False, "errors": [refusal]}
            else:
                try:
                    result = verify_signed_bundle(signed_bundle)
                except RecursionError:
                    result = {"verified": False, "errors": ["Signed bundle is nested too deeply"]}
            if not result["verified"]:
                return JSONResponse(
                    status_code=403,
                    content={"verified": False, "errors": _bounded_result(result)["errors"]},
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

    # ── Admission (spec/profiles/admission § 5, § 6) ──

    async def _admit(self, request: Request, signed_bundle: Any) -> JSONResponse | None:
        """None when the bundle is admitted (and request.state.dcp_agent set), else the refusal."""
        now = self._clock()
        try:
            tenant = self._tenant(request)
            if not isinstance(tenant, str):
                raise TypeError("the tenant callable did not return a string")
            trust = await self._load_trust(tenant)
        except Exception as exc:  # the operator's tenant or trust source failed: fail closed
            _logger.error("DCP admission refused a request: the tenant or trust set could not be resolved (%s)",
                          getattr(exc, "code", type(exc).__name__))
            return JSONResponse(
                status_code=503,
                content={"verified": False, "admitted": False, "errors": ["The principal trust set is unavailable"]},
            )

        profile = self._profile
        bundle = signed_bundle.get("bundle") if isinstance(signed_bundle, dict) else None
        if profile is not None and not (isinstance(bundle, dict) and bundle.get("dcp_bundle_version") == "2.0"):
            verification = _failed_verification("strict-v1 admits V2 bundles only")  # P1: not verified at all
        else:
            verification = await self._verify_for_admission(signed_bundle, now)
        revocation = None
        if profile is not None and verification.get("verified") is True:
            revocation = await self._revocation_snapshot(revocation_subjects(signed_bundle, verification), tenant)
        result = evaluate_admission_v2(
            signed_bundle, verification, profile=profile, trust=trust, revocation=revocation, now_ms=now
        )
        if not result["admitted"]:
            return JSONResponse(status_code=403, content=_admission_refusal(result))

        context = _v2_agent_context(signed_bundle, verification["details"], _bounded_result(verification)["warnings"])
        context.admitted = True
        context.principal_trust = result["principal_trust"]
        context.profile = result["profile"]
        context.profile_compliance = result["profile_compliance"]
        context.recorded_decision = result["recorded_decision"]
        context.trust_set_version = result["trust_set_version"]
        context.action_authorized = False
        request.state.dcp_agent = context
        return None

    async def _load_trust(self, tenant: str) -> PrincipalTrustStore:
        source = self._trusted_principals
        if isinstance(source, PrincipalTrustStore):
            return source
        trust_set = source(tenant)  # type: ignore[operator]
        if inspect.isawaitable(trust_set):
            trust_set = await trust_set
        return create_principal_trust_store(trust_set)

    async def _verify_for_admission(self, signed_bundle: Any, now: int) -> dict[str, Any]:
        if not isinstance(signed_bundle, dict):
            return _failed_verification("Signed bundle is not an object")
        if _detect_version(signed_bundle) == "1.0":
            return _failed_verification(
                "V1 bundles are not admitted: they carry no principal signature to anchor in a trust set"
            )
        errors = _v2_shape_errors(signed_bundle)
        if errors:
            return {"verified": False, "errors": errors, "warnings": [], "details": {}}
        policy = self._profile.policy if self._profile is not None else self.verifier_policy
        try:
            return await verify_signed_bundle_v2(signed_bundle, _REGISTRY, policy, now_ms=now)
        except RecursionError:
            return _failed_verification("Signed bundle is nested too deeply")

    async def _revocation_snapshot(self, subjects: dict[str, list[str]], tenant: str) -> Any:
        """The source's snapshot; None when it cannot answer (never "not revoked")."""
        try:
            return await asyncio.wait_for(self._ask_revocation_source(subjects, tenant), self._revocation_timeout)
        except Exception as exc:  # a timeout or the source's own failure
            if getattr(exc, "code", None) == "REVOCATION_INVALID":
                return {"source_error": "invalid"}
            _logger.warning("DCP admission: the revocation source did not answer (%s)",
                            getattr(exc, "code", type(exc).__name__))
            return None

    async def _ask_revocation_source(self, subjects: dict[str, list[str]], tenant: str) -> Any:
        source = self._revocation_source
        if _is_async_callable(source):
            snapshot = source(subjects, tenant)  # type: ignore[misc]
        else:
            snapshot = await asyncio.to_thread(source, subjects, tenant)  # type: ignore[arg-type]
        if inspect.isawaitable(snapshot):
            snapshot = await snapshot
        return snapshot


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
