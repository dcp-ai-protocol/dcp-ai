"""
Signed bundle verification shared by the framework bridges (dcp_ai.fastapi,
dcp_ai.langchain, dcp_ai.openai): one registry, one verifier policy, one V1 rule.

A V2 bundle is verified by verify_signed_bundle_v2 from dcp_ai.v2 under a verifier
policy (a dict of VerifierPolicy fields set over DEFAULT_VERIFIER_POLICY, or a full
VerifierPolicy), with one registry of the providers it needs (Ed25519, ML-DSA-65,
SLH-DSA-192f). A V1 bundle (one Ed25519 signature) goes to dcp_ai.verify only where
VERIFICATION.md V2-10 would accept a classical-only bundle and nothing else in the
policy refuses what a V1 bundle has or lacks. Nothing here reports a V2 bundle
verified on its own.

What the bridges hand back to a model (bounded_result, printable) is bounded and
has its control and format characters escaped: it carries text from the bundle.
"""

from __future__ import annotations

import asyncio
import math
import unicodedata
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

    A VerifierPolicy instance is validated again (one built with model_construct
    or changed by assignment was never validated); a tier its risk_overrides
    leaves out, or every tier when it is None, gets its default_mode, as the V2
    verifier (and the TypeScript SDK's resolveMode) resolves such a policy. A dict
    sets fields over the default policy: a
    default_mode given without risk_overrides applies to every risk tier, a
    risk_overrides dict sets its tiers over the others, and risk_overrides=None
    keeps the default tiers. Unknown fields (pydantic.ValidationError), unknown
    risk tiers and unknown verification modes (ValueError) raise.
    """
    if isinstance(verifier_policy, VerifierPolicy):
        policy = VerifierPolicy.model_validate(dict(verifier_policy)).model_dump()
        policy["risk_overrides"] = {
            **dict.fromkeys(_RISK_TIERS, policy["default_mode"]),
            **(policy["risk_overrides"] or {}),
        }
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


_V1_ARTIFACTS = ("responsible_principal_record", "agent_passport", "intent", "policy_decision")


def v1_shape_error(bundle: Any) -> str | None:
    """Why a V1 bundle is not even shaped like one, or None.

    The V1 verifier checks the signature and the hash chains, not the schema, so a
    self-signed bundle whose artifacts are not objects would otherwise verify.
    """
    if not isinstance(bundle, dict):
        return "V1 bundle is not an object"
    for name in _V1_ARTIFACTS:
        if not isinstance(bundle.get(name), dict):
            return f"V1 bundle {name} is not an object"
    entries = bundle.get("audit_entries")
    if not isinstance(entries, list) or not all(isinstance(e, dict) for e in entries):
        return "V1 bundle audit_entries is not a list of objects"
    # What names the agent and the principal goes into an agent context: the
    # schema's types (agent_passport and responsible_principal_record .schema.json).
    passport, rpr = bundle["agent_passport"], bundle["responsible_principal_record"]
    if not isinstance(passport.get("agent_id"), str):
        return "V1 bundle agent_passport agent_id is not a string"
    if not isinstance(rpr.get("human_id"), str):
        return "V1 bundle responsible_principal_record human_id is not a string"
    for key in ("public_key", "status"):
        if key in passport and not isinstance(passport[key], str):
            return f"V1 bundle agent_passport {key} is not a string"
    capabilities = passport.get("capabilities", [])
    if not isinstance(capabilities, list) or not all(isinstance(c, str) for c in capabilities):
        return "V1 bundle agent_passport capabilities is not a list of strings"
    return None


def v1_refusal(policy: dict[str, Any], bundle: Any) -> str | None:
    """Why a V1 bundle is refused under `policy`, or None.

    A V1 bundle has one Ed25519 signature and no post-quantum one, no
    intended_verifier and no session window. It passes only when the policy
    allows V1 bundles and refuses none of that: ed25519 is accepted and not
    rejected by an advisory, and the policy requires no audience binding, no
    session expiry and no maximum session duration. Then, as VERIFICATION.md
    V2-10 accepts a classical-only bundle, the stricter of the policy mode for
    the passport's risk_tier (default_mode when it has none) and the mode of the
    security tier of the V1 intent and policy decision must be classical_only or
    hybrid_preferred. V1 risk_score is 0 to 1: it is scaled by 1000 and rounded,
    and a missing or invalid one fails closed to elevated. A bundle whose
    artifacts are not objects is refused too (v1_shape_error).
    """
    if not policy.get("allow_v1_bundles"):
        return "V1 bundles are not accepted: verifier policy allow_v1_bundles is false"
    if "ed25519" in (policy.get("advisory_rejected_algs") or []):
        return "V1 bundles are not accepted: an active advisory rejects ed25519, their only signature"
    if "ed25519" not in (policy.get("accepted_classical_algs") or []):
        return "V1 bundles are not accepted: verifier policy does not accept ed25519, their only signature"
    if policy.get("require_audience_binding"):
        return (
            "V1 bundles are not accepted: verifier policy requires audience binding, "
            "and a V1 bundle has no intended_verifier"
        )
    if policy.get("require_session_expiry"):
        return (
            "V1 bundles are not accepted: verifier policy requires a session expiry, "
            "and a V1 bundle has no session window"
        )
    if (policy.get("max_session_duration_seconds") or 0) > 0:
        return (
            "V1 bundles are not accepted: verifier policy bounds the session duration, "
            "and a V1 bundle has no session window"
        )
    shape_error = v1_shape_error(bundle)
    if shape_error:
        return shape_error
    b = bundle
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


# What a bridge hands back: at most this many errors and warnings, each at most
# this many characters (before the truncation note).
_MAX_MESSAGES = 20
_MAX_TEXT = 500


def _escape(ch: str) -> str:
    """A control, format or other non-printing character as an escape; any other as is."""
    if not unicodedata.category(ch).startswith("C"):
        return ch
    code = ord(ch)
    return f"\\u{code:04x}" if code <= 0xFFFF else f"\\U{code:08x}"


def printable(value: Any, limit: int = _MAX_TEXT) -> str:
    """Text from a bundle made safe to print: control and format characters (newlines,
    bidi overrides, ...) escaped, at most `limit` characters of it kept."""
    if not isinstance(value, str):
        return f"<{type(value).__name__}>"
    escaped = "".join(_escape(ch) for ch in value[:limit])
    if len(value) <= limit and len(escaped) <= limit:
        return escaped
    return f"{escaped[:limit]}... [{len(value)} characters]"


def _bounded_messages(messages: Any) -> list[str]:
    items = messages if isinstance(messages, list) else []
    out = [printable(m) for m in items[:_MAX_MESSAGES]]
    if len(items) > _MAX_MESSAGES:
        out.append(f"... and {len(items) - _MAX_MESSAGES} more")
    return out


def _bounded_detail(value: Any) -> Any:
    if value is None or isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value if len(repr(value)) <= 40 else type(value).__name__
    if isinstance(value, str):
        return printable(value)
    if isinstance(value, list):
        return _bounded_messages(value)
    return type(value).__name__


def bounded_result(result: dict[str, Any]) -> dict[str, Any]:
    """A verification result as a bridge hands it back: "verified", "dcp_version",
    at most 20 errors and 20 warnings of at most 500 characters each, escaped, and
    the V2 "details" with each value bounded the same way."""
    out: dict[str, Any] = {
        "verified": result.get("verified") is True,
        "dcp_version": result.get("dcp_version"),
        "errors": _bounded_messages(result.get("errors")),
        "warnings": _bounded_messages(result.get("warnings")),
    }
    details = result.get("details")
    if isinstance(details, dict):
        out["details"] = {printable(k, 64): _bounded_detail(v) for k, v in list(details.items())[:_MAX_MESSAGES]}
    return out


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


def _run_on_private_loop(make_coroutine: Callable[[], Awaitable[T]]) -> T:
    """Run a coroutine on a loop of its own, never made the thread's current loop
    (asyncio.run would leave the thread with none)."""
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(make_coroutine())
    finally:
        try:
            loop.run_until_complete(loop.shutdown_asyncgens())
        finally:
            loop.close()


def run_sync(make_coroutine: Callable[[], Awaitable[T]]) -> T:
    """Run a coroutine to completion from synchronous code.

    With no running event loop, on a private loop in this thread. Inside one (a
    sync call from async code), on a private loop in a worker thread, since the
    running loop cannot be re-entered; the caller's thread waits for it. The
    thread's current event loop is left as it was.
    """
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return _run_on_private_loop(make_coroutine)
    with ThreadPoolExecutor(max_workers=1, thread_name_prefix="dcp-verify") as pool:
        return pool.submit(_run_on_private_loop, make_coroutine).result()
