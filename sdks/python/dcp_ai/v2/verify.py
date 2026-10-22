"""
DCP v2.0 signed bundle verification — Python port of the TypeScript SDK's
core/verify-v2.ts.

Pipeline: payload hashes, session nonce binding and expiry, audience binding,
manifest integrity, the verification mode, the bundle composite signature over
the manifest, each artifact's own composite signature (VERIFICATION.md V2-8),
the audit prev_hash chain and key validity. The policy is verifier-authoritative:
the bundle has no say in it, and the mode is the stricter of the policy mode and
the security tier's mode (spec §14.3), so the agent's own risk_tier and intent
can raise it but never lower it.

A PQ signature that is present (pq_over_classical) must verify in every mode;
only an absent one (classical_only) may be tolerated, by hybrid_preferred and
classical_only (VERIFICATION.md V2-7).

Not verified, as in the TypeScript SDK: PQ checkpoint contents and signatures
(VERIFICATION.md V2-12; only their IDs are bound to the manifest) and the
manifest's audit_merkle_root_secondary. Do not rely on either after verification.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from dcp_ai.v2.canonicalize import canonicalize_v2
from dcp_ai.v2.composite_ops import composite_verify
from dcp_ai.v2.crypto_registry import AlgorithmRegistry
from dcp_ai.v2.domain_separation import DCP_CONTEXTS
from dcp_ai.v2.models import VerifierPolicy
from dcp_ai.v2.pq_checkpoint import audit_events_merkle_root
from dcp_ai.v2.security_tier import compute_security_tier, effective_verification_mode
from dcp_ai.v2.session_nonce import is_session_expired, verify_session_binding
from dcp_ai.v2.signed_payload import prepare_payload, verify_payload_hash

# Transition-period default, identical to the TypeScript SDK. The risk tier comes
# from the agent-signed passport, and both "low" and "medium" accept classical-only
# signatures, so a stolen Ed25519 key is enough to pass this policy for routine and
# standard intents (the security tier raises the others to hybrid_required).
# Verifiers that need post-quantum assurance must pass hybrid_required (or pq_only)
# for every tier.
DEFAULT_VERIFIER_POLICY: dict[str, Any] = {
    "default_mode": "hybrid_preferred",
    "risk_overrides": {
        "low": "classical_only",
        "medium": "hybrid_preferred",
        "high": "hybrid_required",
    },
    "min_classical": 1,
    "min_pq": 1,
    "accepted_classical_algs": ["ed25519"],
    "accepted_pq_algs": ["ml-dsa-65", "slh-dsa-192f"],
    "accepted_hash_algs": ["sha256", "sha384"],
    "require_session_binding": True,
    "require_composite_binding": True,
    "max_key_age_days": 365,
    "allow_v1_bundles": True,
    "allow_classical_fallback_disable": False,
    "warn_classical_only_deprecated": False,
    "advisory_rejected_algs": [],
}

# Phase 3 PQ-only preset: classical signatures are accepted but not required.
PQ_ONLY_VERIFIER_POLICY: dict[str, Any] = {
    "default_mode": "pq_only",
    "risk_overrides": {"low": "pq_only", "medium": "pq_only", "high": "pq_only"},
    "min_classical": 0,
    "min_pq": 1,
    "accepted_classical_algs": ["ed25519"],
    "accepted_pq_algs": ["ml-dsa-65", "slh-dsa-192f"],
    "accepted_hash_algs": ["sha256", "sha384"],
    "require_session_binding": True,
    "require_composite_binding": False,
    "max_key_age_days": 365,
    "allow_v1_bundles": False,
    "allow_classical_fallback_disable": True,
    "warn_classical_only_deprecated": True,
    "advisory_rejected_algs": [],
}

_ARTIFACTS = ("responsible_principal_record", "agent_passport", "intent", "policy_decision")
_VERIFICATION_MODES = ("classical_only", "hybrid_preferred", "hybrid_required", "pq_only")
# The algorithms each composite signature slot may hold.
_CLASSICAL_ALGS = ("ed25519",)
_PQ_ALGS = ("ml-dsa-65", "slh-dsa-192f")
_MANIFEST_HASH_FIELDS = dict(zip(_ARTIFACTS, ("rpr_hash", "passport_hash", "intent_hash", "policy_hash")))


def _parse_time(value: str) -> datetime:
    t = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return t if t.tzinfo else t.replace(tzinfo=timezone.utc)


def _find_key(keys: list[dict[str, Any]], kid: str) -> dict[str, Any] | None:
    return next((k for k in keys if k.get("kid") == kid), None)


async def _check_composite_sig(
    registry: AlgorithmRegistry,
    policy: dict[str, Any],
    mode: str,
    context: str,
    payload: Any,
    sig: dict[str, Any],
    keys: list[dict[str, Any]],
    keys_label: str,
) -> tuple[bool, list[str], list[str]]:
    """Steps V2-6, V2-7 and V2-10 for one composite signature over `payload`.

    Returns (valid, errors, warnings); signer keys are looked up by kid in `keys`.
    """
    errors: list[str] = []
    warnings: list[str] = []
    rejected = policy.get("advisory_rejected_algs") or []
    classical, pq, binding = sig["classical"], sig.get("pq"), sig.get("binding")

    def fail(error: str) -> tuple[bool, list[str], list[str]]:
        return False, [*errors, error], warnings

    # In every mode: Ed25519 cannot stand in for the PQ signature, nor ML-DSA for the classical one.
    if classical["alg"] not in _CLASSICAL_ALGS:
        return fail(f"Classical slot holds {classical['alg']}, which is not a classical algorithm")
    if pq and pq["alg"] not in _PQ_ALGS:
        return fail(f"PQ slot holds {pq['alg']}, which is not a PQ algorithm")

    if mode != "pq_only":
        if classical["alg"] not in policy["accepted_classical_algs"]:
            errors.append(f"Classical algorithm {classical['alg']} not accepted by verifier policy")
        if classical["alg"] in rejected:
            errors.append(f"Classical algorithm {classical['alg']} rejected by active advisory")
    if pq and pq["alg"] not in policy["accepted_pq_algs"]:
        errors.append(f"PQ algorithm {pq['alg']} not accepted by verifier policy")
    if pq and pq["alg"] in rejected:
        errors.append(f"PQ algorithm {pq['alg']} rejected by active advisory")
    if policy.get("require_composite_binding") and binding != "pq_over_classical" and mode == "hybrid_required":
        errors.append("Verifier policy requires composite binding (pq_over_classical)")
    if policy.get("warn_classical_only_deprecated") and binding == "classical_only":
        warnings.append("DEPRECATION: classical-only signatures are deprecated. Migrate to hybrid or pq_only.")

    if mode == "pq_only" and binding == "classical_only":
        return fail("pq_only mode requires PQ signature, but binding is classical_only")
    # In pq_only mode the classical key is optional.
    signer_key = _find_key(keys, classical["kid"])
    if signer_key is None and mode != "pq_only":
        return fail(f"Classical signer key kid={classical['kid']} not found in {keys_label}")
    if signer_key is not None and signer_key.get("alg") != classical["alg"]:
        return fail(f"Classical signer key kid={classical['kid']} is {signer_key.get('alg')}, not {classical['alg']}")
    pq_key = _find_key(keys, pq["kid"]) if pq else None
    if pq and pq_key is None:
        return fail(f"PQ signer key kid={pq['kid']} not found in {keys_label}")
    if pq and pq_key.get("alg") != pq["alg"]:
        return fail(f"PQ signer key kid={pq['kid']} is {pq_key.get('alg')}, not {pq['alg']}")
    if mode == "pq_only" and pq_key is None:
        return fail("pq_only mode requires PQ key, but no PQ key found")

    try:
        result = await composite_verify(
            registry,
            context,
            canonicalize_v2(payload).encode("utf-8"),
            sig,  # type: ignore[arg-type]
            signer_key["public_key_b64"] if signer_key else "",
            pq_key["public_key_b64"] if pq_key else None,
        )
    except Exception as exc:  # unknown algorithm, malformed key or signature
        return fail(f"Signature verification error: {exc}")

    if mode == "hybrid_required":
        if not result.classical_valid:
            errors.append("Classical signature invalid (hybrid_required)")
        if not result.pq_valid:
            errors.append("PQ signature invalid or missing (hybrid_required)")
    elif mode in ("hybrid_preferred", "classical_only"):
        if not result.classical_valid:
            errors.append(f"Classical signature invalid ({mode})")
        if binding == "pq_over_classical" and not result.pq_valid:
            errors.append(f"PQ signature invalid ({mode})")
        elif mode == "hybrid_preferred" and not result.pq_valid:
            warnings.append("PQ signature missing (hybrid_preferred: accepted with warning)")
    elif mode == "pq_only":
        if not result.pq_valid:
            errors.append("PQ signature invalid or missing (pq_only)")
        if not result.classical_valid and not policy.get("allow_classical_fallback_disable"):
            warnings.append("Classical signature not verified in pq_only mode (fallback not disabled)")
    else:
        # ponytail: TS has no default branch here; fail closed on a misconfigured policy.
        errors.append(f"Unknown verification mode: {mode}")

    return result.valid, errors, warnings


def _resolve_policy(policy: Any) -> dict[str, Any]:
    """None means DEFAULT_VERIFIER_POLICY; anything else is validated as a VerifierPolicy.

    Unknown keys raise, and fields left out take the model's defaults
    (hybrid_required for every risk tier), never the default policy's
    low -> classical_only override. risk_overrides=None applies default_mode to
    every tier.
    """
    if policy is None:
        return dict(DEFAULT_VERIFIER_POLICY)
    return VerifierPolicy.model_validate(policy).model_dump()


async def verify_signed_bundle_v2(
    signed_bundle: dict[str, Any],
    registry: AlgorithmRegistry,
    policy: Any = None,
) -> dict[str, Any]:
    """Full V2 signed bundle verification.

    `policy` is a VerifierPolicy, a dict validated as one (see _resolve_policy;
    pydantic.ValidationError on unknown keys), or None for DEFAULT_VERIFIER_POLICY.
    Returns {"verified", "errors", "warnings", "details"}. A structurally
    malformed bundle fails verification instead of raising.
    """
    resolved = _resolve_policy(policy)
    result: dict[str, Any] = {"verified": False, "errors": [], "warnings": [], "details": {}}
    try:
        await _verify(signed_bundle, registry, resolved, result)
    except (KeyError, TypeError, AttributeError, ValueError, IndexError) as exc:
        result["errors"].append(f"Malformed signed bundle: {exc!r}")
    result["verified"] = not result["errors"]
    return result


async def _verify(
    signed_bundle: dict[str, Any],
    registry: AlgorithmRegistry,
    policy: dict[str, Any],
    result: dict[str, Any],
) -> None:
    errors: list[str] = result["errors"]
    warnings: list[str] = result["warnings"]
    details: dict[str, Any] = result["details"]
    bundle, signature = signed_bundle["bundle"], signed_bundle["signature"]

    # 1. Basic structure
    if bundle.get("dcp_bundle_version") != "2.0":
        errors.append(f"Unsupported bundle version: {bundle.get('dcp_bundle_version')}")
        return
    manifest = bundle["manifest"]
    audit_entries = bundle["audit_entries"]

    # 2. Payload hash of every signed artifact
    for name in _ARTIFACTS:
        signed = bundle.get(name)
        if not isinstance(signed, dict) or not isinstance(signed.get("payload"), dict):
            errors.append(f"{name}: not a SignedPayload object")
        elif not verify_payload_hash(signed):
            errors.append(f"{name}: payload_hash mismatch")
    if errors:
        return

    # 3. Session nonce consistency
    if policy.get("require_session_binding"):
        artifacts = [bundle[name]["payload"] for name in _ARTIFACTS]
        artifacts += audit_entries + (bundle.get("pq_checkpoints") or [])
        session = verify_session_binding(artifacts)
        if not session["valid"]:
            errors.append(f"Session binding failed: {session['error']}")
            return
        if session["nonce"] != manifest["session_nonce"]:
            errors.append("Session nonce in manifest does not match artifacts")
            return
        details["session_nonce"] = session["nonce"]

    # 3a. Session expiry
    expires_at = manifest.get("session_expires_at")
    if expires_at:
        details["session_expires_at"] = expires_at
        if is_session_expired(expires_at):
            errors.append(f"Session expired at {expires_at}")
            return
    elif policy.get("require_session_expiry"):
        errors.append("Policy requires session_expires_at but manifest does not include it")
        return

    max_duration = policy.get("max_session_duration_seconds") or 0
    if max_duration > 0 and expires_at:
        # signature.created_at sits outside the signed manifest. Clamping it to now
        # keeps honest bundles' verdict (same as TS), but a rewritten value can still
        # shrink the check down to the session's remaining lifetime (not to zero).
        # Closing that needs a signed session start in the manifest.
        now = datetime.now(timezone.utc)
        created_at = signature.get("created_at")
        created = min(_parse_time(created_at), now) if created_at else now
        duration = (_parse_time(expires_at) - created).total_seconds()
        if duration > max_duration:
            errors.append(f"Session duration {duration:g}s exceeds policy max of {max_duration}s")

    # 3b. Audience binding
    if manifest.get("intended_verifier"):
        details["intended_verifier"] = manifest["intended_verifier"]
    if policy.get("require_audience_binding"):
        if not manifest.get("intended_verifier"):
            errors.append("Policy requires audience binding but manifest does not include intended_verifier")
            return
        if policy.get("verifier_id") and manifest["intended_verifier"] != policy["verifier_id"]:
            errors.append(
                f"Bundle intended for verifier '{manifest['intended_verifier']}', not '{policy['verifier_id']}'"
            )
            return

    # 4. Manifest integrity. Per spec/CANONICALIZATION_PROFILE.md § 4 a missing
    # canonicalization_profile means dcp-jcs-v1; any other value is rejected.
    if "canonicalization_profile" in manifest and manifest["canonicalization_profile"] != "dcp-jcs-v1":
        errors.append(f"Unknown canonicalization_profile: {manifest['canonicalization_profile']}")
    for name, field in _MANIFEST_HASH_FIELDS.items():
        expected = prepare_payload(bundle[name]["payload"])[1]
        if manifest.get(field) != expected:
            errors.append(f"Manifest {field} mismatch: expected {expected}")
    checkpoint_ids = [c["checkpoint_id"] for c in bundle.get("pq_checkpoints") or []]
    if (manifest.get("pq_checkpoints") or []) != checkpoint_ids:
        errors.append("Manifest pq_checkpoints do not match the bundle's checkpoints")
    if audit_entries and manifest.get("audit_merkle_root") != f"sha256:{audit_events_merkle_root(audit_entries)}":
        errors.append("Manifest audit_merkle_root mismatch")
    if manifest.get("audit_count") != len(audit_entries):
        errors.append(
            f"Manifest audit_count={manifest.get('audit_count')} but bundle has {len(audit_entries)} entries"
        )
    details["manifest_valid"] = not errors
    if errors:
        return

    # 5. Verification mode: the stricter of the policy mode for the agent's
    # risk tier and the security tier's mode (spec §14.3).
    passport = bundle["agent_passport"]["payload"]
    risk_tier = passport.get("risk_tier")
    overrides = policy.get("risk_overrides") or {}
    policy_mode = overrides[risk_tier] if risk_tier and risk_tier in overrides else policy["default_mode"]
    if policy_mode not in _VERIFICATION_MODES:
        errors.append("Unknown verification mode in verifier policy")
        return
    tier = compute_security_tier(bundle["intent"]["payload"], bundle["policy_decision"]["payload"])
    mode = effective_verification_mode(policy_mode, tier)
    details["resolved_tier"] = tier
    details["verification_mode"] = mode
    if policy.get("advisory_rejected_algs"):
        details["advisory_rejected_algs"] = policy["advisory_rejected_algs"]
    if mode == "classical_only" and policy.get("warn_classical_only_deprecated"):
        warnings.append("DEPRECATION: classical_only mode is deprecated in Phase 3")

    # 6. Bundle composite signature over the manifest (V2-6, V2-7, V2-10)
    passport_keys = passport.get("keys") or []
    rpr_keys = bundle["responsible_principal_record"]["payload"].get("binding_keys") or []
    valid, errs, warns = await _check_composite_sig(
        registry, policy, mode, DCP_CONTEXTS["Bundle"], manifest, signature["composite_sig"],
        passport_keys + rpr_keys, "passport or RPR",
    )
    errors.extend(f"bundle: {e}" for e in errs)
    warnings.extend(f"bundle: {w}" for w in warns)
    details["signature_valid"] = valid

    # 7. Per-artifact composite signatures (V2-8). The principal signs the RPR
    # with its binding_keys; the agent signs the rest with its passport keys.
    for name, context, keys, keys_label in (
        ("responsible_principal_record", "ResponsiblePrincipal", rpr_keys, "RPR binding_keys"),
        ("agent_passport", "AgentPassport", passport_keys, "passport keys"),
        ("intent", "Intent", passport_keys, "passport keys"),
        ("policy_decision", "PolicyDecision", passport_keys, "passport keys"),
    ):
        signed = bundle[name]
        _, errs, warns = await _check_composite_sig(
            registry, policy, mode, DCP_CONTEXTS[context], signed["payload"], signed["composite_sig"],
            keys, keys_label,
        )
        errors.extend(f"{name}: {e}" for e in errs)
        warnings.extend(f"{name}: {w}" for w in warns)

    details["policy_satisfied"] = not errors
    if errors:
        return

    # 8. Audit hash chain (prev_hash)
    prev_hash = "GENESIS"
    for i, entry in enumerate(audit_entries):
        if entry.get("prev_hash") != prev_hash:
            errors.append(
                f"prev_hash chain break at entry[{i}]: expected {prev_hash}, got {entry.get('prev_hash')}"
            )
            break
        prev_hash = prepare_payload(entry)[1]
    details["hash_chain_valid"] = not errors

    # 9. Key validity of every key that can sign: the passport keys and the RPR
    # binding_keys (V2-13)
    now = datetime.now(timezone.utc)
    max_age_days = policy.get("max_key_age_days") or 0
    for key in passport_keys + rpr_keys:
        if key.get("status") == "revoked":
            errors.append(f"Key {key['kid']} is revoked")
        if key.get("expires_at") and _parse_time(key["expires_at"]) < now:
            errors.append(f"Key {key['kid']} has expired")
        if max_age_days > 0 and (now - _parse_time(key["created_at"])).total_seconds() / 86400 > max_age_days:
            warnings.append(f"Key {key['kid']} exceeds max age of {max_age_days} days")
