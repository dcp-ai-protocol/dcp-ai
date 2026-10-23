"""
DCP v2.0 signed bundle verification — Python port of the TypeScript SDK's
core/verify-v2.ts.

Pipeline: payload hashes, session nonce binding, expiry and signed start
(session_issued_at, which a maximum session duration is measured from), audience
binding, manifest integrity, cross-artifact consistency (VERIFICATION.md V2-14),
the verification mode, the bundle composite signature over the manifest (by the
principal: RPR binding_keys only, with a signer block that names them), each
artifact's own composite signature (V2-8), the PQ checkpoints (V2-12), the audit
prev_hash chain and key validity. The unsigned signature.created_at decides
nothing. Every key that verifies a signature has a kid derived from it (V2-13). The
policy is verifier-authoritative: the bundle has no say in it, and the mode is
the stricter of the policy mode and the security tier's mode (spec §14.3), so the
agent's own risk_tier and intent can raise it but never lower it.

A PQ signature that is present (pq_over_classical) must verify in every mode;
only an absent one (classical_only) may be tolerated, by hybrid_preferred and
classical_only (VERIFICATION.md V2-7).

Not verified, as in the TypeScript SDK: the manifest's audit_merkle_root_secondary.
Do not rely on it after verification.
"""

from __future__ import annotations

import base64
import binascii
import re
import time
from typing import Any

from dcp_ai.v2.canonicalize import canonicalize_v2
from dcp_ai.v2.composite_ops import composite_verify
from dcp_ai.v2.crypto_provider import derive_kid
from dcp_ai.v2.crypto_registry import AlgorithmRegistry
from dcp_ai.v2.domain_separation import DCP_CONTEXTS
from dcp_ai.v2.models import VerifierPolicy
from dcp_ai.v2.pq_checkpoint import audit_events_merkle_root
from dcp_ai.v2.security_tier import compute_security_tier, effective_verification_mode
from dcp_ai.v2.session_nonce import rfc3339_epoch_ms, verify_session_binding
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


def _now_ms() -> int:
    """The verification time, in milliseconds since the Unix epoch (V2-4 compares at that precision)."""
    return time.time_ns() // 1_000_000


def _seconds(millis: int) -> str:
    """A duration in milliseconds, as seconds without a rounding that hides the milliseconds."""
    return str(millis // 1000) if millis % 1000 == 0 else str(millis / 1000)


def _find_key(keys: list[dict[str, Any]], kid: str) -> dict[str, Any] | None:
    return next((k for k in keys if k.get("kid") == kid), None)


_BASE64 = re.compile(r"[A-Za-z0-9+/]*={0,2}")


def _canonical_b64_bytes(value: Any) -> bytes | None:
    """The bytes of canonical base64 (RFC 4648 § 4, padded, zero trailing bits), or None."""
    if not isinstance(value, str) or len(value) % 4 != 0 or not _BASE64.fullmatch(value):
        return None
    try:
        raw = base64.b64decode(value, validate=True)
    except binascii.Error:
        return None
    return raw if base64.b64encode(raw).decode("ascii") == value else None


def _key_identity_error(key: dict[str, Any]) -> str | None:
    """V2-13: why a key cannot verify a signature (a public key that is not canonical
    base64, a kid not derived from it), or None."""
    raw = _canonical_b64_bytes(key.get("public_key_b64"))
    if raw is None:
        return f"Key {key.get('kid')} public_key_b64 is not canonical base64 (V2-13)"
    try:
        if derive_kid(key["alg"], raw) == key.get("kid"):
            return None
    except Exception:  # an alg derive_kid cannot take is a kid that is not derived
        pass
    return f"Key {key.get('kid')} is not derived from its public key (V2-13)"


# How far in the future a signed session start may be (V2-4), as DCP-04 allows for timestamps.
_SESSION_CLOCK_SKEW_MS = 30_000

# The hash algorithms a signature block may name (V2-4).
_SIGNATURE_HASH_ALGS = ("sha256", "sha256+sha3-256")

# The audit entry record of each policy decision (V2-14).
_AUDITED_DECISION = {"approve": "approved", "escalate": "escalated", "block": "blocked"}


def _same_id(a: Any, b: Any) -> bool:
    """Two identifiers that are the same string; two missing ones are not the same."""
    return isinstance(a, str) and a == b


async def _check_composite_sig(
    registry: AlgorithmRegistry,
    policy: dict[str, Any],
    mode: str,
    context: str,
    payload: Any,
    sig: Any,
    keys: list[dict[str, Any]],
    keys_label: str,
) -> tuple[bool, list[str], list[str]]:
    """Steps V2-6, V2-7 and V2-10 for one composite signature over `payload`.

    Returns (valid, errors, warnings); signer keys are looked up by kid in `keys`.
    """
    errors: list[str] = []
    warnings: list[str] = []
    rejected = policy.get("advisory_rejected_algs") or []

    def fail(error: str) -> tuple[bool, list[str], list[str]]:
        return False, [*errors, error], warnings

    if not isinstance(sig, dict) or not isinstance(sig.get("classical"), dict):
        return fail("Missing composite signature")
    classical, pq, binding = sig["classical"], sig.get("pq"), sig.get("binding")

    # In every mode: Ed25519 cannot stand in for the PQ signature, nor ML-DSA for the classical one.
    if classical["alg"] not in _CLASSICAL_ALGS:
        return fail(f"Classical slot holds {classical['alg']}, which is not a classical algorithm")
    if pq and pq["alg"] not in _PQ_ALGS:
        return fail(f"PQ slot holds {pq['alg']}, which is not a PQ algorithm")
    # One encoding per signature, the same bytes in every SDK (V2-5).
    if _canonical_b64_bytes(classical.get("sig_b64")) is None:
        return fail("Classical sig_b64 is not canonical base64 (V2-5)")
    if pq and _canonical_b64_bytes(pq.get("sig_b64")) is None:
        return fail("PQ sig_b64 is not canonical base64 (V2-5)")

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
    for key in (signer_key, pq_key):
        identity_error = _key_identity_error(key) if key is not None else None
        if identity_error:
            return fail(identity_error)

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


def _signer_block_errors(signature: dict[str, Any], rpr: dict[str, Any], manifest: dict[str, Any]) -> list[str]:
    """The unsigned signature block must not contradict the signature (V2-4).

    signer.id is the RPR human_id; signer.kids are the composite_sig kids, the
    classical one and then the PQ one when present; manifest_hash is the hash of
    the canonical manifest; hash_alg is sha256 or sha256+sha3-256.
    """
    errors: list[str] = []
    signer = signature.get("signer")
    signer = signer if isinstance(signer, dict) else {}
    sig = signature.get("composite_sig")
    sig = sig if isinstance(sig, dict) else {}
    classical, pq = sig.get("classical"), sig.get("pq")
    signed_kids = [classical.get("kid") if isinstance(classical, dict) else None]
    if pq:
        signed_kids.append(pq.get("kid") if isinstance(pq, dict) else None)
    signer_kids = signer.get("kids")
    if not _same_id(signer.get("id"), rpr.get("human_id")):
        errors.append(f"signature signer id {signer.get('id')} is not the RPR human_id")
    if (
        not isinstance(signer_kids, list)
        or len(signer_kids) != len(signed_kids)
        or not all(_same_id(k, signed) for k, signed in zip(signer_kids, signed_kids))
    ):
        errors.append("signature signer kids do not name the bundle signature keys")
    if signature.get("manifest_hash") != prepare_payload(manifest)[1]:
        errors.append("signature manifest_hash is not the hash of the manifest")
    hash_alg = signature.get("hash_alg")
    if not (isinstance(hash_alg, str) and hash_alg in _SIGNATURE_HASH_ALGS):
        errors.append(f"signature hash_alg {hash_alg} is not sha256 or sha256+sha3-256")
    return errors


def _consistency_errors(bundle: dict[str, Any], intent_hash: str) -> list[str]:
    """V2-14: the artifacts describe one action, by one agent, for one principal.

    The signatures say who signed each artifact; these checks tie them together.
    """
    errors: list[str] = []
    rpr = bundle["responsible_principal_record"]["payload"]
    passport = bundle["agent_passport"]["payload"]
    intent = bundle["intent"]["payload"]
    policy = bundle["policy_decision"]["payload"]

    status = passport.get("status")
    if not (isinstance(status, str) and status in ("active", "declining")):
        errors.append(f"agent_passport status is {status}, not active (DCP-05 § 3.1)")
    rpr_expires_at = rpr.get("expires_at")
    if rpr_expires_at is not None:
        rpr_expires = rfc3339_epoch_ms(rpr_expires_at)
        if rpr_expires is None:
            errors.append(f"responsible_principal_record has an invalid expires_at: {rpr_expires_at}")
        elif rpr_expires < _now_ms():
            errors.append(f"responsible_principal_record expired at {rpr_expires_at}")
    if not _same_id(passport.get("principal_binding_reference"), rpr.get("human_id")):
        errors.append("agent_passport principal_binding_reference is not the RPR human_id")
    if not _same_id(intent.get("agent_id"), passport.get("agent_id")):
        errors.append("intent agent_id is not the passport agent_id")
    if not _same_id(intent.get("human_id"), rpr.get("human_id")):
        errors.append("intent human_id is not the RPR human_id")
    if not _same_id(policy.get("intent_id"), intent.get("intent_id")):
        errors.append("policy_decision intent_id is not the intent intent_id")
    decision = policy.get("decision")
    audited = _AUDITED_DECISION.get(decision) if isinstance(decision, str) else None
    for i, entry in enumerate(bundle["audit_entries"]):
        e = entry if isinstance(entry, dict) else {}
        if not _same_id(e.get("intent_id"), intent.get("intent_id")):
            errors.append(f"audit_entries[{i}] intent_id is not the intent intent_id")
        if not _same_id(e.get("intent_hash"), intent_hash):
            errors.append(f"audit_entries[{i}] intent_hash is not the intent payload hash")
        if not _same_id(e.get("agent_id"), passport.get("agent_id")):
            errors.append(f"audit_entries[{i}] agent_id is not the passport agent_id")
        if not _same_id(e.get("human_id"), rpr.get("human_id")):
            errors.append(f"audit_entries[{i}] human_id is not the RPR human_id")
        if not _same_id(e.get("policy_decision"), audited):
            errors.append(
                f"audit_entries[{i}] policy_decision {e.get('policy_decision')} "
                f"does not record the decision {decision}"
            )
    return errors


def _audit_index(entries: list[Any], audit_id: Any) -> int:
    """Index of the first audit entry whose audit_id is the string `audit_id`, or -1."""
    if not isinstance(audit_id, str):
        return -1
    return next((i for i, e in enumerate(entries) if isinstance(e, dict) and e.get("audit_id") == audit_id), -1)


async def _check_pq_checkpoints(
    registry: AlgorithmRegistry,
    policy: dict[str, Any],
    mode: str,
    bundle: dict[str, Any],
    passport_keys: list[dict[str, Any]],
) -> list[str]:
    """V2-12: the bundle carries exactly the checkpoints its signed manifest lists.

    Each covers a contiguous run of audit entries, with their Merkle root, and is
    signed by the agent with both algorithms (the PQ one alone under pq_only).
    """
    manifest = bundle["manifest"]
    listed = manifest.get("pq_checkpoints")
    carried = bundle.get("pq_checkpoints")
    listed = [] if listed is None else listed
    carried = [] if carried is None else carried
    if not isinstance(listed, list) or not isinstance(carried, list):
        return ["pq_checkpoints: manifest list and bundle checkpoints must be arrays"]

    errors: list[str] = []
    by_id: dict[str, dict[str, Any]] = {}
    for cp in carried:
        cid = cp.get("checkpoint_id") if isinstance(cp, dict) else None
        if not isinstance(cid, str) or cid in by_id:
            errors.append(f"pq_checkpoints: checkpoint {cid} is missing an id or carried twice")
        else:
            by_id[cid] = cp
    listed_ids = [lid for lid in listed if isinstance(lid, str)]
    if len(set(listed_ids)) != len(listed_ids):
        errors.append("pq_checkpoints: the manifest lists a checkpoint twice")
    for lid in listed:
        if not isinstance(lid, str) or lid not in by_id:
            errors.append(f"pq_checkpoints: manifest lists {lid}, which the bundle does not carry")
    for cid in by_id:
        if cid not in listed_ids:
            errors.append(f"pq_checkpoints: {cid} is not listed in the manifest")
    if errors:
        return errors

    entries = bundle["audit_entries"]
    cp_mode = "pq_only" if mode == "pq_only" else "hybrid_required"
    for cid, cp in by_id.items():
        label = f"pq_checkpoints[{cid}]"
        if not _same_id(cp.get("session_nonce"), manifest.get("session_nonce")):
            errors.append(f"{label}: session_nonce is not the manifest's")
            continue
        event_range = cp.get("event_range")
        if not isinstance(event_range, dict):
            event_range = {}
        start = _audit_index(entries, event_range.get("from_audit_id"))
        end = _audit_index(entries, event_range.get("to_audit_id"))
        count = event_range.get("count")
        if start < 0 or end < start or isinstance(count, bool) or count != end - start + 1:
            errors.append(f"{label}: event_range does not match the audit entries")
            continue
        if cp.get("merkle_root") != f"sha256:{audit_events_merkle_root(entries[start:end + 1])}":
            errors.append(f"{label}: merkle_root does not match its audit entries")
            continue
        payload = {k: v for k, v in cp.items() if k != "composite_sig"}
        _, errs, _ = await _check_composite_sig(
            registry, policy, cp_mode, DCP_CONTEXTS["AuditEvent"], payload, cp.get("composite_sig"),
            passport_keys, "passport keys",
        )
        errors.extend(f"{label}: {e}" for e in errs)
    return errors


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

    # 3a. Session expiry: absent or null never expires; anything else must be an
    # RFC 3339 timestamp still in the future.
    expires_at = manifest.get("session_expires_at")
    expires = None
    if expires_at is not None:
        details["session_expires_at"] = expires_at
        expires = rfc3339_epoch_ms(expires_at)
        if expires is None:
            errors.append(f"Invalid session_expires_at: {expires_at}")
            return
        if expires < _now_ms():
            errors.append(f"Session expired at {expires_at}")
            return
    elif policy.get("require_session_expiry"):
        errors.append("Policy requires session_expires_at but manifest does not include it")
        return

    # The session start is the signed session_issued_at, never the unsigned
    # signature.created_at (V2-4). Absent or null means none. Timestamps compare
    # at millisecond precision.
    issued_at = manifest.get("session_issued_at")
    issued = None
    if issued_at is not None:
        issued = rfc3339_epoch_ms(issued_at)
        if issued is None:
            errors.append(f"Invalid session_issued_at: {issued_at}")
            return
        if issued > _now_ms() + _SESSION_CLOCK_SKEW_MS:
            errors.append(f"session_issued_at {issued_at} is in the future")
            return
        if expires is not None and issued > expires:
            errors.append("session_issued_at is after session_expires_at")
            return

    # A maximum session duration needs both ends of the session, signed.
    max_duration = policy.get("max_session_duration_seconds") or 0
    if max_duration > 0:
        if expires is None:
            errors.append("Policy max_session_duration_seconds requires session_expires_at in the manifest")
            return
        if issued is None:
            errors.append("Policy max_session_duration_seconds requires session_issued_at in the manifest")
            return
        if expires - issued > max_duration * 1000:
            errors.append(
                f"Session duration {_seconds(expires - issued)}s exceeds policy max of {max_duration}s"
            )

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
    # The manifest's pq_checkpoints are checked against the carried checkpoints
    # with the checkpoints themselves (V2-12, step 7a).
    # An empty audit trail has the root 64 zeros (VERIFICATION.md V2-3).
    expected_root = audit_events_merkle_root(audit_entries) if audit_entries else "0" * 64
    if manifest.get("audit_merkle_root") != f"sha256:{expected_root}":
        errors.append("Manifest audit_merkle_root mismatch")
    if manifest.get("audit_count") != len(audit_entries):
        errors.append(
            f"Manifest audit_count={manifest.get('audit_count')} but bundle has {len(audit_entries)} entries"
        )
    details["manifest_valid"] = not errors
    if errors:
        return

    # 4a. Cross-artifact consistency (V2-14), against the intent's payload hash,
    # which the manifest's intent_hash now matches.
    errors.extend(_consistency_errors(bundle, manifest["intent_hash"]))
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

    # 6. Bundle composite signature over the manifest (V2-6, V2-7, V2-10). The
    # signer is the principal: only the RPR binding_keys verify it. The agent
    # signs its own passport, so its keys cannot vouch for the principal.
    passport_keys = passport.get("keys") or []
    rpr_keys = bundle["responsible_principal_record"]["payload"].get("binding_keys") or []
    valid, errs, warns = await _check_composite_sig(
        registry, policy, mode, DCP_CONTEXTS["Bundle"], manifest, signature.get("composite_sig"),
        rpr_keys, "RPR binding_keys",
    )
    errs += _signer_block_errors(signature, bundle["responsible_principal_record"]["payload"], manifest)
    valid = valid and not errs
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
            registry, policy, mode, DCP_CONTEXTS[context], signed["payload"], signed.get("composite_sig"),
            keys, keys_label,
        )
        errors.extend(f"{name}: {e}" for e in errs)
        warnings.extend(f"{name}: {w}" for w in warns)

    # 7a. PQ checkpoints (V2-12)
    checkpoint_errors = await _check_pq_checkpoints(registry, policy, mode, bundle, passport_keys)
    errors.extend(checkpoint_errors)
    details["pq_checkpoints_valid"] = not checkpoint_errors

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
    now = _now_ms()
    max_age_days = policy.get("max_key_age_days") or 0
    for key in passport_keys + rpr_keys:
        if key.get("status") in ("revoked", "expired"):
            errors.append(f"Key {key['kid']} is {key['status']}")
        if key.get("expires_at") is not None:
            key_expires = rfc3339_epoch_ms(key["expires_at"])
            if key_expires is None:
                errors.append(f"Key {key['kid']} has an invalid expires_at: {key['expires_at']}")
            elif key_expires < now:
                errors.append(f"Key {key['kid']} has expired")
        # An advisory only: a created_at that is not an RFC 3339 timestamp gives no
        # warning and never fails the bundle.
        created = rfc3339_epoch_ms(key.get("created_at"))
        if max_age_days > 0 and created is not None and (now - created) / 86_400_000 > max_age_days:
            warnings.append(f"Key {key['kid']} exceeds max age of {max_age_days} days")
