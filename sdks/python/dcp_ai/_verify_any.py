"""
Signed bundle verification shared by the framework bridges (dcp_ai.fastapi,
dcp_ai.langchain, dcp_ai.openai): one registry, one verifier policy, one V1 rule.

A V2 bundle is verified by verify_signed_bundle_v2 from dcp_ai.v2 under a verifier
policy (a dict of VerifierPolicy fields set over DEFAULT_VERIFIER_POLICY, or a full
VerifierPolicy), with one registry of the providers it needs (Ed25519, ML-DSA-65,
SLH-DSA-192f). A V1 bundle (one Ed25519 signature) goes to dcp_ai.verify only where
VERIFICATION.md V2-10 would accept a classical-only bundle. Nothing here reports a V2
bundle verified on its own.
"""

from __future__ import annotations

import asyncio
import math
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Awaitable, Callable, TypeVar

from dcp_ai.providers import Ed25519Provider, MlDsa65Provider, SlhDsa192fProvider
from dcp_ai.v2.crypto_registry import AlgorithmRegistry
from dcp_ai.v2.models import VerifierPolicy
from dcp_ai.v2.security_tier import compute_security_tier, effective_verification_mode
from dcp_ai.v2.verify import DEFAULT_VERIFIER_POLICY, verify_signed_bundle_v2
from dcp_ai.verify import verify_signed_bundle

_RISK_TIERS = ("low", "medium", "high")
_VERIFICATION_MODES = ("classical_only", "hybrid_preferred", "hybrid_required", "pq_only")

# Built once: the providers the V2 verifier needs (Ed25519, ML-DSA-65, SLH-DSA-192f).
_REGISTRY = AlgorithmRegistry()
for _provider in (Ed25519Provider(), MlDsa65Provider(), SlhDsa192fProvider()):
    _REGISTRY.register_signer(_provider)

T = TypeVar("T")


def resolve_verifier_policy(verifier_policy: dict[str, Any] | VerifierPolicy | None) -> dict[str, Any]:
    """`verifier_policy` over DEFAULT_VERIFIER_POLICY, validated as a VerifierPolicy.

    A VerifierPolicy instance is used as is (its risk_overrides=None means its
    default_mode for every tier). A dict sets fields over the default policy: a
    default_mode given without risk_overrides applies to every risk tier, a
    risk_overrides dict sets its tiers over the others, and risk_overrides=None
    keeps the default tiers. Unknown fields (pydantic.ValidationError), unknown
    risk tiers and unknown verification modes (ValueError) raise.
    """
    if isinstance(verifier_policy, VerifierPolicy):
        policy = verifier_policy.model_dump()
        if policy["risk_overrides"] is None:
            policy["risk_overrides"] = dict.fromkeys(_RISK_TIERS, policy["default_mode"])
    else:
        if verifier_policy is not None and not isinstance(verifier_policy, dict):
            raise TypeError("verifier_policy must be a dict or a VerifierPolicy")
        configured = dict(verifier_policy or {})
        overrides = configured.pop("risk_overrides", None)
        merged = {**DEFAULT_VERIFIER_POLICY, **configured}
        if overrides is not None and not isinstance(overrides, dict):
            merged["risk_overrides"] = overrides  # VerifierPolicy rejects it
        else:
            base = (
                dict.fromkeys(_RISK_TIERS, configured["default_mode"])
                if "default_mode" in configured
                else DEFAULT_VERIFIER_POLICY["risk_overrides"]
            )
            merged["risk_overrides"] = {**base, **(overrides or {})}
        policy = VerifierPolicy.model_validate(merged).model_dump()
    unknown_tiers = set(policy["risk_overrides"]) - set(_RISK_TIERS)
    if unknown_tiers:
        raise ValueError(f"Unknown risk tier in verifier_policy risk_overrides: {sorted(unknown_tiers)[0]}")
    for mode in [policy["default_mode"], *policy["risk_overrides"].values()]:
        if mode not in _VERIFICATION_MODES:
            raise ValueError(f"Unknown verification mode in verifier_policy: {mode}")
    return policy


def _printable(value: Any) -> str:
    """A short printable form of an untrusted value (never recurses into it)."""
    return repr(value[:80]) if isinstance(value, str) else type(value).__name__


def v1_refusal(policy: dict[str, Any], bundle: Any) -> str | None:
    """Why a V1 bundle is refused under `policy`, or None.

    A V1 bundle has one Ed25519 signature and no post-quantum one, so it passes
    only where VERIFICATION.md V2-10 would accept a classical-only bundle:
    allow_v1_bundles is true, and the stricter of the policy mode for the
    passport's risk_tier (default_mode when it has none) and the mode of the
    security tier of the V1 intent and policy decision is classical_only or
    hybrid_preferred. V1 risk_score is 0 to 1: it is scaled by 1000 and rounded,
    and a missing or invalid one fails closed to elevated.
    """
    if not policy.get("allow_v1_bundles"):
        return "V1 bundles are not accepted: verifier policy allow_v1_bundles is false"
    b = bundle if isinstance(bundle, dict) else {}
    passport = b.get("agent_passport") if isinstance(b.get("agent_passport"), dict) else {}
    if "risk_tier" not in passport:
        policy_mode = policy["default_mode"]
    else:
        risk_tier = passport["risk_tier"]
        if not (isinstance(risk_tier, str) and risk_tier in _RISK_TIERS and risk_tier in policy["risk_overrides"]):
            return f"V1 bundles are not accepted: agent_passport risk_tier {_printable(risk_tier)} is not low, medium or high"
        policy_mode = policy["risk_overrides"][risk_tier]
    decision = b.get("policy_decision") if isinstance(b.get("policy_decision"), dict) else {}
    score = decision.get("risk_score")
    known = isinstance(score, (int, float)) and not isinstance(score, bool) and 0 <= score <= 1
    risk_score = math.floor(score * 1000 + 0.5) if known else None
    intent = b.get("intent") if isinstance(b.get("intent"), dict) else {}
    tier = compute_security_tier(intent, {"risk_score": risk_score})
    mode = effective_verification_mode(policy_mode, tier)
    if mode in ("classical_only", "hybrid_preferred"):
        return None
    return (
        f"V1 bundles are not accepted here: the policy requires {mode} for this bundle "
        f"(security tier {tier}), and a V1 bundle has no post-quantum signature"
    )


def detect_version(signed_bundle: Any) -> str | None:
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


def _refused(dcp_version: str | None, error: str) -> dict[str, Any]:
    return {"verified": False, "dcp_version": dcp_version, "errors": [error], "warnings": []}


async def verify_any_signed_bundle(signed_bundle: Any, policy: dict[str, Any]) -> dict[str, Any]:
    """Verify a V1 or V2 signed bundle under a policy from resolve_verifier_policy.

    Returns {"verified", "dcp_version", "errors", "warnings"} and, for V2, the
    verifier's "details". A V2 bundle is verified only by verify_signed_bundle_v2.
    """
    version = detect_version(signed_bundle)
    if version == "2.0":
        try:
            result = await verify_signed_bundle_v2(signed_bundle, _REGISTRY, policy)
        except RecursionError:
            return _refused(version, "Signed bundle is nested too deeply")
        return {"dcp_version": version, **result}
    if version == "1.0":
        refusal = v1_refusal(policy, signed_bundle.get("bundle"))
        if refusal:
            return _refused(version, refusal)
        try:
            result = verify_signed_bundle(signed_bundle)
        except RecursionError:
            return _refused(version, "Signed bundle is nested too deeply")
        except Exception as exc:  # a malformed V1 bundle fails verification
            return _refused(version, f"Malformed signed bundle: {exc!r}")
        return {"dcp_version": version, "errors": [], "warnings": [], **result}
    return _refused(
        None,
        'Unrecognized DCP bundle version: expected bundle.dcp_bundle_version "2.0" '
        'or bundle.responsible_principal_record.dcp_version "1.0"',
    )


def run_sync(make_coroutine: Callable[[], Awaitable[T]]) -> T:
    """Run a coroutine to completion from synchronous code.

    With no running event loop, asyncio.run. Inside one (a sync call from async
    code), the coroutine runs on its own loop in a worker thread, since the
    running loop cannot be re-entered; the caller's thread waits for it.
    """
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(make_coroutine())  # type: ignore[arg-type]
    with ThreadPoolExecutor(max_workers=1, thread_name_prefix="dcp-verify") as pool:
        return pool.submit(lambda: asyncio.run(make_coroutine())).result()  # type: ignore[arg-type]
