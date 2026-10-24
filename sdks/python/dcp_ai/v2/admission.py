"""
Admission of V2 signed bundles: principal trust and the strict-v1 profile
(spec/profiles/admission). Python port of the TypeScript SDK's core/admission.ts.

Deterministic and offline: the caller supplies the trust set, the revocation
snapshot and the clock. Verification itself is verify_signed_bundle_v2's;
admission only reads its result, including details["signer_keys"].

    store = create_principal_trust_store(trust_set)          # AdmissionConfigError
    profile = resolve_strict_v1_profile({"profile": "strict-v1", "verifier_id": "api.example"})
    verification = await verify_signed_bundle_v2(signed, registry, profile.policy, now_ms=now)
    snapshot = my_revocation_source(revocation_subjects(signed, verification))
    result = evaluate_admission_v2(signed, verification, profile=profile, trust=store,
                                   revocation=snapshot, now_ms=now)
    if result["admitted"]: ...

or, with the revocation snapshot already in hand, admit_signed_bundle_v2.
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass
from types import MappingProxyType
from typing import Any, Callable, Mapping, NoReturn

from dcp_ai.v2.crypto_provider import derive_kid
from dcp_ai.v2.crypto_registry import AlgorithmRegistry
from dcp_ai.v2.session_nonce import rfc3339_epoch_ms
from dcp_ai.v2.verify import (
    DEFAULT_VERIFIER_POLICY,
    SESSION_CLOCK_SKEW_MS,
    _canonical_b64_bytes,
    _now_ms,
    _seconds,
    verify_signed_bundle_v2,
)

STRICT_V1 = "strict-v1"

# The longest session and the oldest revocation snapshot strict-v1 accepts, in seconds.
STRICT_V1_MAX_SECONDS = 300


class AdmissionConfigError(ValueError):
    """A trust set or profile that cannot be loaded, or a contradictory admission
    configuration. `code` is one of spec/profiles/admission § 5.3 (CONFIG_*)."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(f"{code}: {message}")
        self.code = code


def _fail(code: str, message: str) -> NoReturn:
    raise AdmissionConfigError(code, message)


def _is_integer(value: Any) -> bool:
    """A JSON number with an integer value: an int (not a bool) or an integral float."""
    if isinstance(value, bool):
        return False
    return isinstance(value, int) or (isinstance(value, float) and value.is_integer())


def _is_string_list(value: Any) -> bool:
    return isinstance(value, list) and all(isinstance(s, str) for s in value)


def _printable(value: Any) -> str:
    """A short printable form of an untrusted value (JSON-quoted and escaped when a string)."""
    if isinstance(value, str):
        return json.dumps(value if len(value) <= 80 else f"{value[:80]}…")
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int):
        return str(value) if value.bit_length() <= 128 else "a large integer"
    if isinstance(value, float):
        return repr(value)
    if isinstance(value, list):
        return "an array"
    if isinstance(value, dict):
        return "an object"
    return f"a {type(value).__name__}"


def _name(value: Any) -> str:
    """An identifier the verifier reported (a kid, a component, a mode), as is when it is
    a short printable string, else _printable."""
    if isinstance(value, str) and len(value) <= 80 and value.isprintable():
        return value
    return _printable(value)


def _reject_unknown_fields(value: dict[Any, Any], allowed: tuple[str, ...], where: str) -> None:
    for key in value:
        if key not in allowed:
            _fail("CONFIG_UNKNOWN_FIELD", f"{where}: unknown field {_printable(key)}")


# ── Trust set (§ 2.2) ──

_KEY_BYTES = {"ed25519": 32, "ml-dsa-65": 1952, "slh-dsa-192f": 48}
_KEY_STATUSES = ("active", "revoked", "expired")
_TRUST_KEY_FIELDS = ("kid", "alg", "public_key_b64", "status", "not_before", "expires_at")

# Only the loaders below build the immutable objects they return.
_LOADER = object()


@dataclass(frozen=True)
class TrustedKey:
    """A key of the trust set, validated: status and validity window, times in epoch ms."""

    alg: str
    key_bytes: bytes
    status: str
    not_before: int | None
    expires_at: int | None


class PrincipalTrustStore:
    """A validated trust set: create it with create_principal_trust_store.

    `version` is the trust_set_version; `principals` maps each human_id to its keys
    by kid. Immutable.
    """

    __slots__ = ("version", "principals")
    version: str
    principals: Mapping[str, Mapping[str, TrustedKey]]

    def __init__(self, loader: object, version: str, principals: Mapping[str, Mapping[str, TrustedKey]]) -> None:
        if loader is not _LOADER:
            raise TypeError("create a PrincipalTrustStore with create_principal_trust_store")
        object.__setattr__(self, "version", version)
        object.__setattr__(self, "principals", principals)

    def __setattr__(self, name: str, value: Any) -> None:
        raise AttributeError("a PrincipalTrustStore is immutable")

    def __delattr__(self, name: str) -> None:
        raise AttributeError("a PrincipalTrustStore is immutable")

    def __repr__(self) -> str:
        return f"PrincipalTrustStore(version={self.version!r}, principals={len(self.principals)})"


def _optional_instant(value: Any, where: str) -> int | None:
    """An optional RFC 3339 instant: None when absent or null; raises on anything else."""
    if value is None:
        return None
    instant = rfc3339_epoch_ms(value)
    if instant is None:
        _fail("CONFIG_INVALID_VALUE", f"{where} is not an RFC 3339 timestamp")
    return instant


def create_principal_trust_store(trust_set: Any) -> PrincipalTrustStore:
    """Validate a trust set (schemas/v2/principal_trust_set.schema.json, spec/profiles/admission
    § 2.2) and return it as a store; a store is returned as is. Raises AdmissionConfigError on
    the first problem found."""
    if type(trust_set) is PrincipalTrustStore:
        return trust_set
    if not isinstance(trust_set, dict):
        _fail("CONFIG_INVALID_VALUE", "the trust set must be an object")
    _reject_unknown_fields(trust_set, ("trust_set_version", "principals"), "trust set")
    version = trust_set.get("trust_set_version")
    if not isinstance(version, str) or version == "":
        _fail("CONFIG_INVALID_VALUE", "trust_set_version must be a non-empty string")
    entries = trust_set.get("principals")
    if not isinstance(entries, list):
        _fail("CONFIG_INVALID_VALUE", "principals must be an array")

    principals: dict[str, Mapping[str, TrustedKey]] = {}
    kids: set[str] = set()
    for i, principal in enumerate(entries):
        where = f"principals[{i}]"
        if not isinstance(principal, dict):
            _fail("CONFIG_INVALID_VALUE", f"{where} must be an object")
        _reject_unknown_fields(principal, ("human_id", "keys"), where)
        human_id = principal.get("human_id")
        if not isinstance(human_id, str) or human_id == "":
            _fail("CONFIG_TRUST_EMPTY_ID", f"{where}.human_id must be a non-empty string")
        if human_id in principals:
            _fail("CONFIG_TRUST_DUPLICATE", f"{where}: human_id {_printable(human_id)} is listed twice")
        key_entries = principal.get("keys")
        if not isinstance(key_entries, list) or not key_entries:
            _fail("CONFIG_INVALID_VALUE", f"{where}.keys must be a non-empty array")

        keys: dict[str, TrustedKey] = {}
        for j, key in enumerate(key_entries):
            at = f"{where}.keys[{j}]"
            if not isinstance(key, dict):
                _fail("CONFIG_INVALID_VALUE", f"{at} must be an object")
            _reject_unknown_fields(key, _TRUST_KEY_FIELDS, at)
            alg = key.get("alg")
            if not isinstance(alg, str) or alg not in _KEY_BYTES:
                _fail("CONFIG_TRUST_MALFORMED_KEY", f"{at}.alg {_printable(alg)} is not ed25519, ml-dsa-65 or slh-dsa-192f")
            raw = _canonical_b64_bytes(key.get("public_key_b64"))
            if raw is None or len(raw) != _KEY_BYTES[alg]:
                _fail("CONFIG_TRUST_MALFORMED_KEY", f"{at}.public_key_b64 is not a canonical base64 {alg} public key")
            kid = key.get("kid")
            if not isinstance(kid, str) or derive_kid(alg, raw) != kid:
                _fail("CONFIG_TRUST_KID_NOT_DERIVED", f"{at}.kid {_printable(kid)} is not derived from its key")
            if kid in kids:
                _fail("CONFIG_TRUST_DUPLICATE", f"{at}: kid {kid} is listed twice in the trust set")
            status = key.get("status")
            if not (isinstance(status, str) and status in _KEY_STATUSES):
                _fail("CONFIG_INVALID_VALUE", f"{at}.status must be active, revoked or expired")
            kids.add(kid)
            keys[kid] = TrustedKey(
                alg=alg,
                key_bytes=raw,
                status=status,
                not_before=_optional_instant(key.get("not_before"), f"{at}.not_before"),
                expires_at=_optional_instant(key.get("expires_at"), f"{at}.expires_at"),
            )
        principals[human_id] = MappingProxyType(keys)

    return PrincipalTrustStore(_LOADER, version, MappingProxyType(principals))


# ── strict-v1 profile (§ 4.1) ──

_PROFILE_FIELDS = (
    "profile",
    "verifier_id",
    "max_session_duration_seconds",
    "max_revocation_age_seconds",
    "verifier_policy",
)
_MODES = ("classical_only", "hybrid_preferred", "hybrid_required", "pq_only")
_RISK_TIERS = ("low", "medium", "high")
# The algorithm lists verifier_policy may narrow to a non-empty subset.
_ALG_SUBSETS = {
    "accepted_classical_algs": ("ed25519",),
    "accepted_pq_algs": ("ml-dsa-65", "slh-dsa-192f"),
}
_FIXED_HASH_ALGS = ("sha256", "sha384")


def _freeze(value: Any) -> Any:
    """A read-only copy: dicts as mappingproxy, lists as tuples, at every depth."""
    if isinstance(value, dict):
        return MappingProxyType({k: _freeze(v) for k, v in value.items()})
    if isinstance(value, list):
        return tuple(_freeze(v) for v in value)
    return value


class StrictV1Profile:
    """A validated strict-v1 profile: create it with resolve_strict_v1_profile.

    `policy` is the verifier policy the profile verifies with (a read-only mapping that
    verify_signed_bundle_v2 takes as is). Immutable.
    """

    __slots__ = (
        "profile",
        "verifier_id",
        "max_session_duration_seconds",
        "max_revocation_age_seconds",
        "policy",
    )
    profile: str
    verifier_id: str
    max_session_duration_seconds: int
    max_revocation_age_seconds: int
    policy: Mapping[str, Any]

    def __init__(
        self,
        loader: object,
        verifier_id: str,
        max_session_duration_seconds: int,
        max_revocation_age_seconds: int,
        policy: Mapping[str, Any],
    ) -> None:
        if loader is not _LOADER:
            raise TypeError("create a StrictV1Profile with resolve_strict_v1_profile")
        for name, value in (
            ("profile", STRICT_V1),
            ("verifier_id", verifier_id),
            ("max_session_duration_seconds", max_session_duration_seconds),
            ("max_revocation_age_seconds", max_revocation_age_seconds),
            ("policy", policy),
        ):
            object.__setattr__(self, name, value)

    def __setattr__(self, name: str, value: Any) -> None:
        raise AttributeError("a StrictV1Profile is immutable")

    def __delattr__(self, name: str) -> None:
        raise AttributeError("a StrictV1Profile is immutable")

    def __repr__(self) -> str:
        return (
            f"StrictV1Profile(verifier_id={self.verifier_id!r}, "
            f"max_session_duration_seconds={self.max_session_duration_seconds}, "
            f"max_revocation_age_seconds={self.max_revocation_age_seconds})"
        )


def _profile_seconds(config: dict[str, Any], field: str, maximum: int) -> int:
    """A strict-v1 limit in seconds: an integer from 1 to `maximum`, default `maximum`."""
    if field not in config:
        return maximum
    value = config[field]
    if not _is_integer(value):
        _fail("CONFIG_INVALID_VALUE", f"{field} must be an integer")
    if value < 1 or value > maximum:
        _fail("CONFIG_PROFILE_CONTRADICTION", f"{field} must be from 1 to {maximum} under strict-v1")
    return int(value)


def _fixed_boolean(value: Any, field: str, fixed: bool) -> None:
    """A boolean policy field that only `fixed` keeps the profile's guarantee."""
    if not isinstance(value, bool):
        _fail("CONFIG_INVALID_VALUE", f"verifier_policy.{field} must be a boolean")
    if value is not fixed:
        _fail("CONFIG_PROFILE_CONTRADICTION", f"strict-v1 requires verifier_policy.{field} to be {str(fixed).lower()}")


def _hybrid_required(value: Any, field: str) -> None:
    if not (isinstance(value, str) and value in _MODES):
        _fail("CONFIG_INVALID_VALUE", f"{field} must be a verification mode")
    if value != "hybrid_required":
        _fail(
            "CONFIG_PROFILE_CONTRADICTION",
            f"strict-v1 requires {field} to be hybrid_required (pq_only drops the classical signature)",
        )


def resolve_strict_v1_profile(config: Any) -> StrictV1Profile:
    """Validate a strict-v1 configuration (schemas/v2/admission_profile.schema.json,
    spec/profiles/admission § 4.1) and return the profile with the verifier policy it
    enforces; a profile is returned as is. Raises AdmissionConfigError."""
    if type(config) is StrictV1Profile:
        return config
    if not isinstance(config, dict):
        _fail("CONFIG_INVALID_VALUE", "the profile configuration must be an object")
    _reject_unknown_fields(config, _PROFILE_FIELDS, "profile")
    profile = config.get("profile")
    if not (isinstance(profile, str) and profile == STRICT_V1):
        _fail("CONFIG_INVALID_VALUE", f'profile {_printable(profile)} is not "strict-v1"')
    verifier_id = config.get("verifier_id")
    if verifier_id is None:
        _fail("CONFIG_PROFILE_CONTRADICTION", "strict-v1 requires verifier_id")
    if not isinstance(verifier_id, str):
        _fail("CONFIG_INVALID_VALUE", "verifier_id must be a string")
    if verifier_id == "":
        _fail("CONFIG_PROFILE_CONTRADICTION", "strict-v1 requires a non-empty verifier_id")
    max_session = _profile_seconds(config, "max_session_duration_seconds", STRICT_V1_MAX_SECONDS)
    max_revocation = _profile_seconds(config, "max_revocation_age_seconds", STRICT_V1_MAX_SECONDS)

    policy: dict[str, Any] = {
        **DEFAULT_VERIFIER_POLICY,
        "default_mode": "hybrid_required",
        "risk_overrides": dict.fromkeys(_RISK_TIERS, "hybrid_required"),
        "min_classical": 1,
        "min_pq": 1,
        "accepted_classical_algs": list(_ALG_SUBSETS["accepted_classical_algs"]),
        "accepted_pq_algs": list(_ALG_SUBSETS["accepted_pq_algs"]),
        "accepted_hash_algs": list(_FIXED_HASH_ALGS),
        "max_key_age_days": 365,
        "require_session_binding": True,
        "require_composite_binding": True,
        "allow_v1_bundles": False,
        "allow_classical_fallback_disable": False,
        "warn_classical_only_deprecated": False,
        "advisory_rejected_algs": [],
        "require_session_expiry": True,
        "require_audience_binding": True,
        "verifier_id": verifier_id,
    }

    if "verifier_policy" in config:
        overrides = config["verifier_policy"]
        if not isinstance(overrides, dict):
            _fail("CONFIG_INVALID_VALUE", "verifier_policy must be an object")
        for field, value in overrides.items():
            if field in ("require_session_binding", "require_composite_binding", "require_session_expiry",
                         "require_audience_binding"):
                _fixed_boolean(value, field, True)
            elif field in ("allow_v1_bundles", "allow_classical_fallback_disable"):
                _fixed_boolean(value, field, False)
            elif field == "default_mode":
                _hybrid_required(value, "verifier_policy.default_mode")
            elif field == "risk_overrides":
                if not isinstance(value, dict):
                    _fail("CONFIG_INVALID_VALUE", "verifier_policy.risk_overrides must be an object")
                _reject_unknown_fields(value, _RISK_TIERS, "verifier_policy.risk_overrides")
                for tier, mode in value.items():
                    _hybrid_required(mode, f"verifier_policy.risk_overrides.{tier}")
            # Fields the profile fixes: a composite signature has one classical and one PQ
            # component, verifiers check the bundle hash_alg by V2-4 and only warn on key age,
            # so another value would be either weaker or not enforced by any verifier.
            elif field in ("min_classical", "min_pq", "max_key_age_days"):
                if not _is_integer(value):
                    _fail("CONFIG_INVALID_VALUE", f"verifier_policy.{field} must be an integer")
                if value != policy[field]:
                    _fail("CONFIG_PROFILE_CONTRADICTION", f"strict-v1 fixes verifier_policy.{field} at {policy[field]}")
            elif field == "accepted_hash_algs":
                if not _is_string_list(value):
                    _fail("CONFIG_INVALID_VALUE", "verifier_policy.accepted_hash_algs must be a list of strings")
                fixed = _FIXED_HASH_ALGS
                if len(set(value)) != len(value) or len(value) != len(fixed) or any(alg not in value for alg in fixed):
                    _fail("CONFIG_PROFILE_CONTRADICTION", f"strict-v1 fixes verifier_policy.accepted_hash_algs at {', '.join(fixed)}")
            elif field in _ALG_SUBSETS:
                if not _is_string_list(value):
                    _fail("CONFIG_INVALID_VALUE", f"verifier_policy.{field} must be a list of strings")
                allowed = _ALG_SUBSETS[field]
                if not value or any(alg not in allowed for alg in value):
                    _fail(
                        "CONFIG_PROFILE_CONTRADICTION",
                        f"strict-v1 requires verifier_policy.{field} to be a non-empty subset of {', '.join(allowed)}",
                    )
                policy[field] = list(value)
            elif field == "advisory_rejected_algs":
                if not _is_string_list(value):
                    _fail("CONFIG_INVALID_VALUE", "verifier_policy.advisory_rejected_algs must be a list of strings")
                policy[field] = list(value)
            elif field == "warn_classical_only_deprecated":
                if not isinstance(value, bool):
                    _fail("CONFIG_INVALID_VALUE", "verifier_policy.warn_classical_only_deprecated must be a boolean")
                policy[field] = value
            elif field == "max_session_duration_seconds":
                if not _is_integer(value):
                    _fail("CONFIG_INVALID_VALUE", "verifier_policy.max_session_duration_seconds must be an integer")
                if value < 1 or value > max_session:
                    _fail(
                        "CONFIG_PROFILE_CONTRADICTION",
                        f"verifier_policy.max_session_duration_seconds must be from 1 to {max_session} under strict-v1",
                    )
                max_session = int(value)
            elif field == "verifier_id":
                if not isinstance(value, str):
                    _fail("CONFIG_INVALID_VALUE", "verifier_policy.verifier_id must be a string")
                if value != verifier_id:
                    _fail("CONFIG_PROFILE_CONTRADICTION", "verifier_policy.verifier_id differs from the profile verifier_id")
            else:
                _fail("CONFIG_UNKNOWN_FIELD", f"verifier_policy: unknown field {_printable(field)}")
    policy["max_session_duration_seconds"] = max_session

    return StrictV1Profile(_LOADER, verifier_id, max_session, max_revocation, _freeze(policy))


# ── Revocation (§ 2.4, § 4.3) ──

_PRINCIPAL_SIGNATURES = ("bundle", "responsible_principal_record")
_REVOCATION_STATUSES = ("revoked", "not_revoked", "unknown")
_SNAPSHOT_FIELDS = ("checked_at", "agents", "keys")


def _signer_keys_of(verification: Any) -> list[dict[str, Any]]:
    details = verification.get("details") if isinstance(verification, dict) else None
    keys = details.get("signer_keys") if isinstance(details, dict) else None
    return [k for k in keys if isinstance(k, dict)] if isinstance(keys, list) else []


def _payload_of(bundle: Any, artifact: str) -> dict[str, Any]:
    signed = bundle.get(artifact) if isinstance(bundle, dict) else None
    payload = signed.get("payload") if isinstance(signed, dict) else None
    return payload if isinstance(payload, dict) else {}


def _bundle_of(signed_bundle: Any) -> dict[str, Any] | None:
    bundle = signed_bundle.get("bundle") if isinstance(signed_bundle, dict) else None
    return bundle if isinstance(bundle, dict) else None


def revocation_subjects(signed_bundle: Any, verification: Any) -> dict[str, list[str]]:
    """What a revocation source must answer for (§ 2.4): the passport agent_id and the kid
    of every signer key that verified, sorted. {"agent_ids": [...], "kids": [...]}."""
    agent_id = _payload_of(_bundle_of(signed_bundle), "agent_passport").get("agent_id")
    kids = {
        k["kid"] for k in _signer_keys_of(verification)
        if k.get("verified") is True and isinstance(k.get("kid"), str)
    }
    return {"agent_ids": [agent_id] if isinstance(agent_id, str) else [], "kids": sorted(kids)}


class RevocationSourceError(Exception):
    """A revocation source that could not answer (code REVOCATION_UNAVAILABLE) or answered
    with something that is not a revocation list (code REVOCATION_INVALID). An adapter
    turns the first into no snapshot and the second into an invalid one; neither is ever
    taken as not revoked."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(f"{code}: {message}")
        self.code = code


class RevocationListError(RevocationSourceError):
    """A revocation list that cannot be read: admission reports REVOCATION_INVALID for it."""

    def __init__(self, message: str) -> None:
        super().__init__("REVOCATION_INVALID", message)


def _listed(document: dict[str, Any], field: str, key: str) -> frozenset[str]:
    items = document.get(field)
    items = [] if items is None else items
    if not isinstance(items, list) or not all(isinstance(i, dict) and isinstance(i.get(key), str) for i in items):
        raise RevocationListError(f"revocation list: {field} is not a list of objects with a {key}")
    return frozenset(i[key] for i in items)


def _subject_ids(subjects: Any, key: str) -> list[str]:
    ids = subjects.get(key) if isinstance(subjects, dict) else None
    return [i for i in ids if isinstance(i, str)] if isinstance(ids, list) else []


def revocation_snapshot_from_deny_list(document: Any, subjects: dict[str, list[str]]) -> dict[str, Any]:
    """The revocation snapshot of `subjects` (revocation_subjects) from a complete deny list in
    the format of the reference revocation service's /.well-known/dcp-revocations.json:
    `updated_at` (RFC 3339), `revocations` (objects with an `agent_id`) and `kid_revocations`
    (objects with a `revoked_kid`), a missing list counting as empty. A listed agent or kid is
    revoked, every other subject not_revoked, as of `updated_at`. Raises RevocationListError
    (code REVOCATION_INVALID) for a document of another shape."""
    if not isinstance(document, dict) or rfc3339_epoch_ms(document.get("updated_at")) is None:
        raise RevocationListError("revocation list: updated_at is not an RFC 3339 timestamp")
    agents = _listed(document, "revocations", "agent_id")
    kids = _listed(document, "kid_revocations", "revoked_kid")
    return {
        "checked_at": document["updated_at"],
        "agents": {a: "revoked" if a in agents else "not_revoked" for a in _subject_ids(subjects, "agent_ids")},
        "keys": {k: "revoked" if k in kids else "not_revoked" for k in _subject_ids(subjects, "kids")},
    }


def _revocation_snapshot(value: Any) -> tuple[int, dict[str, str], dict[str, str]] | None:
    """A snapshot within schemas/v2/revocation_snapshot.schema.json as (checked_at in epoch
    ms, agents, keys), the maps copied into plain dicts; None for anything else."""
    if not isinstance(value, dict) or any(k not in _SNAPSHOT_FIELDS for k in value):
        return None
    checked_at = rfc3339_epoch_ms(value.get("checked_at"))
    if checked_at is None:
        return None
    maps: list[dict[str, str]] = []
    for field in ("agents", "keys"):
        statuses = value.get(field)
        if not isinstance(statuses, dict):
            return None
        plain: dict[str, str] = {}
        for subject, status in statuses.items():
            if not isinstance(subject, str) or not (isinstance(status, str) and status in _REVOCATION_STATUSES):
                return None
            plain[subject] = status
        maps.append(plain)
    return checked_at, maps[0], maps[1]


# ── Admission (§ 5) ──

_MAX_MESSAGE = 500

_AddError = Callable[[str, str], None]


def _bounded(message: str) -> str:
    """At most 500 characters, the ellipsis included."""
    return message if len(message) <= _MAX_MESSAGE else f"{message[:_MAX_MESSAGE - 1]}…"


def _session_checks(manifest: dict[str, Any], profile: StrictV1Profile, now: float, add: _AddError) -> None:
    """P2 and P3."""
    audience = manifest.get("intended_verifier")
    if not isinstance(audience, str) or audience == "":
        add("PROFILE_AUDIENCE_MISSING", "the signed manifest has no intended_verifier")
    elif audience != profile.verifier_id:
        add("PROFILE_AUDIENCE_MISMATCH", f"the bundle is intended for verifier {_printable(audience)}, not this one")

    issued_raw = manifest.get("session_issued_at")
    expires_raw = manifest.get("session_expires_at")
    if issued_raw is None:
        add("PROFILE_SESSION_START_MISSING", "the signed manifest has no session_issued_at")
    if expires_raw is None:
        add("PROFILE_SESSION_EXPIRY_MISSING", "the signed manifest has no session_expires_at")
    issued = None if issued_raw is None else rfc3339_epoch_ms(issued_raw)
    expires = None if expires_raw is None else rfc3339_epoch_ms(expires_raw)
    if (issued_raw is not None and issued is None) or (expires_raw is not None and expires is None):
        add("PROFILE_SESSION_TIME_INVALID", "session_issued_at or session_expires_at is not an RFC 3339 timestamp")
        return
    if issued is None or expires is None:
        return
    if issued > expires:
        add("PROFILE_SESSION_TIME_INVALID", "session_issued_at is after session_expires_at")
        return
    if issued > now + SESSION_CLOCK_SKEW_MS:
        add("PROFILE_SESSION_NOT_STARTED", "session_issued_at is in the future")
    if expires < now:
        add("PROFILE_SESSION_EXPIRED", "the session has expired")
    if expires - issued > profile.max_session_duration_seconds * 1000:
        add(
            "PROFILE_SESSION_TOO_LONG",
            f"the session lasts {_seconds(expires - issued)} s, more than {profile.max_session_duration_seconds} s",
        )


def _hybrid_declared(signed_bundle: dict[str, Any], bundle: dict[str, Any], add: _AddError) -> None:
    """P4, structural part: both principal signatures declare a hybrid signature."""
    signature = signed_bundle.get("signature")
    rpr = bundle.get("responsible_principal_record")
    for name, sig in (
        ("bundle", signature.get("composite_sig") if isinstance(signature, dict) else None),
        ("responsible_principal_record", rpr.get("composite_sig") if isinstance(rpr, dict) else None),
    ):
        if not isinstance(sig, dict) or sig.get("binding") != "pq_over_classical" or not isinstance(sig.get("pq"), dict):
            add("PROFILE_HYBRID_REQUIRED", f"the {name} signature is not a hybrid (pq_over_classical) signature")


def _hybrid_verified(verification: dict[str, Any], add: _AddError) -> None:
    """P4, after verification: both components of both principal signatures verified, in
    hybrid_required."""
    details = verification.get("details")
    mode = details.get("verification_mode") if isinstance(details, dict) else None
    if mode != "hybrid_required":
        add("PROFILE_HYBRID_REQUIRED", f"the bundle was verified in {_name(mode)}, not hybrid_required")
    keys = _signer_keys_of(verification)
    for signature in _PRINCIPAL_SIGNATURES:
        for component in ("classical", "pq"):
            if not any(
                k.get("signature") == signature and k.get("component") == component and k.get("verified") is True
                for k in keys
            ):
                add("PROFILE_HYBRID_REQUIRED", f"the {signature} signature has no verified {component} component")


def _principal_trust(
    bundle: dict[str, Any],
    verification: dict[str, Any],
    store: PrincipalTrustStore,
    now: float,
    add: _AddError,
) -> bool:
    """§ 3: whether every verified component of the principal signatures is a trusted key
    of the principal (T1, then T2 for each component)."""
    human_id = _payload_of(bundle, "responsible_principal_record").get("human_id")
    trusted = store.principals.get(human_id) if isinstance(human_id, str) else None
    if trusted is None:
        add(
            "TRUST_PRINCIPAL_UNKNOWN",
            f"principal {_printable(human_id)} is not in trust set {_printable(store.version)}",
        )
        return False
    ok = True

    def reject(code: str, message: str) -> None:
        nonlocal ok
        add(code, message)
        ok = False

    uses = [
        k for k in _signer_keys_of(verification)
        if k.get("signature") in _PRINCIPAL_SIGNATURES and k.get("verified") is True
    ]
    if not uses:
        reject("TRUST_KEY_NOT_ANCHORED", "no principal signature component verified")
    for use in uses:
        kid = use.get("kid")
        where = f"{use['signature']} {_name(use.get('component'))} key {_name(kid)}"
        key = trusted.get(kid) if isinstance(kid, str) else None
        raw = _canonical_b64_bytes(use.get("public_key_b64"))
        if key is None or key.alg != use.get("alg") or raw is None or raw != key.key_bytes:
            reject("TRUST_KEY_NOT_ANCHORED", f"{where} is not a trusted key of the principal")
        elif key.status == "revoked":
            reject("TRUST_KEY_REVOKED", f"{where} is revoked in the trust set")
        elif key.status == "expired" or (key.expires_at is not None and key.expires_at < now):
            reject("TRUST_KEY_EXPIRED", f"{where} has expired in the trust set")
        elif key.not_before is not None and key.not_before > now:
            reject("TRUST_KEY_NOT_YET_VALID", f"{where} is not valid yet in the trust set")
    return ok


def _revocation_checks(
    subjects: dict[str, list[str]],
    snapshot: Any,
    profile: StrictV1Profile,
    now: float,
    add: _AddError,
) -> None:
    """§ 4.3, R1 to R5."""
    if snapshot is None:
        add("REVOCATION_UNAVAILABLE", "no revocation status could be obtained")
        return
    loaded = _revocation_snapshot(snapshot)
    if loaded is None:
        add("REVOCATION_INVALID", "the revocation snapshot is malformed")
        return
    checked_at, agents, keys = loaded
    if checked_at > now + SESSION_CLOCK_SKEW_MS:
        add("REVOCATION_INVALID", "the revocation snapshot is dated in the future")
        return
    if now - checked_at > profile.max_revocation_age_seconds * 1000:
        add("REVOCATION_STALE", f"the revocation snapshot is older than {profile.max_revocation_age_seconds} s")
    for kind, ids, statuses in (("agent", subjects["agent_ids"], agents), ("key", subjects["kids"], keys)):
        for subject in ids:
            status = statuses.get(subject)
            if status == "revoked":
                add("REVOCATION_REVOKED", f"{kind} {_printable(subject)} is revoked")
            elif status != "not_revoked":
                add("REVOCATION_UNKNOWN", f"the revocation status of {kind} {_printable(subject)} is unknown")


def _check_now(now_ms: Any) -> None:
    if isinstance(now_ms, bool) or not isinstance(now_ms, (int, float)) or not math.isfinite(now_ms):
        _fail("CONFIG_INVALID_VALUE", "now_ms must be a finite number of milliseconds")


def evaluate_admission_v2(
    signed_bundle: Any,
    verification: dict[str, Any],
    *,
    profile: StrictV1Profile | dict[str, Any] | None = None,
    trust: PrincipalTrustStore | dict[str, Any] | None = None,
    revocation: dict[str, Any] | None = None,
    now_ms: int | float,
) -> dict[str, Any]:
    """§ 5: admit a bundle given verify_signed_bundle_v2's result for it at `now_ms`
    (under the profile's policy when there is one). No cryptography and no I/O.

    `profile` and `trust` are loaded objects or raw configurations (loaded here);
    `revocation` is a snapshot, or None when the source could not answer (evaluated
    under a profile only). Raises AdmissionConfigError for an invalid profile or trust
    set, or a profile without a trust set.

    Returns {"verified", "verification", "principal_trust", "profile",
    "profile_compliance", "admitted", "action_authorized", "recorded_decision",
    "trust_set_version", "errors"}; errors are {"code", "message"}, in the order of
    § 5.1, with messages of at most 500 characters (and an ellipsis).
    """
    _check_now(now_ms)
    now = now_ms
    loaded_profile = None if profile is None else resolve_strict_v1_profile(profile)
    store = None if trust is None else create_principal_trust_store(trust)
    if loaded_profile is not None and store is None:
        _fail("CONFIG_PROFILE_CONTRADICTION", "strict-v1 requires a trust set")

    errors: list[dict[str, str]] = []

    def add(code: str, message: str) -> None:
        errors.append({"code": code, "message": _bounded(message)})

    def result(verified: bool, principal_trust: str, compliance: str, admitted: bool, decision: Any) -> dict[str, Any]:
        return {
            "verified": verified,
            "verification": verification,
            "principal_trust": principal_trust,
            "profile": STRICT_V1 if loaded_profile is not None else None,
            "profile_compliance": compliance,
            "admitted": admitted,
            "action_authorized": False,
            "recorded_decision": decision,
            "trust_set_version": store.version if store is not None else None,
            "errors": errors,
        }

    sb = signed_bundle if isinstance(signed_bundle, dict) else {}
    bundle = _bundle_of(sb)
    if loaded_profile is not None and (bundle is None or bundle.get("dcp_bundle_version") != "2.0"):
        add("PROFILE_V2_REQUIRED", "strict-v1 admits V2 bundles only")
        return result(False, "not_evaluated", "non_compliant", False, None)

    b = bundle if bundle is not None else {}
    if loaded_profile is not None:
        manifest = b.get("manifest")
        _session_checks(manifest if isinstance(manifest, dict) else {}, loaded_profile, now, add)
        _hybrid_declared(sb, b, add)
    verified = isinstance(verification, dict) and verification.get("verified") is True
    if not verified:
        reported = verification.get("errors") if isinstance(verification, dict) else None
        reasons = (
            "; ".join(e[:_MAX_MESSAGE] if isinstance(e, str) else _printable(e) for e in reported[:3])
            if isinstance(reported, list)
            else ""
        )
        add("VERIFICATION_FAILED", f"the bundle did not verify{f': {reasons}' if reasons else ''}")
    principal_trust = "not_evaluated"
    if store is not None and verified:
        principal_trust = "trusted" if _principal_trust(b, verification, store, now, add) else "untrusted"
    if loaded_profile is not None and verified:
        _hybrid_verified(verification, add)
        _revocation_checks(revocation_subjects(sb, verification), revocation, loaded_profile, now, add)

    profile_failed = any(e["code"].startswith(("PROFILE_", "REVOCATION_")) for e in errors)
    if loaded_profile is None:
        compliance = "not_evaluated"
    else:
        compliance = "compliant" if verified and not profile_failed else "non_compliant"
    decision = _payload_of(b, "policy_decision").get("decision")
    admitted = (
        verified
        and (store is None or principal_trust == "trusted")
        and (loaded_profile is None or compliance == "compliant")
    )
    return result(
        verified,
        principal_trust,
        compliance,
        admitted,
        decision if verified and isinstance(decision, str) else None,
    )


async def admit_signed_bundle_v2(
    signed_bundle: Any,
    registry: AlgorithmRegistry,
    *,
    profile: StrictV1Profile | dict[str, Any] | None = None,
    policy: Any = None,
    trust: PrincipalTrustStore | dict[str, Any] | None = None,
    revocation: dict[str, Any] | None = None,
    now_ms: int | float | None = None,
) -> dict[str, Any]:
    """Verify a signed bundle at `now_ms` (default the system clock) and evaluate its
    admission (§ 5.1). Under a profile the bundle is verified with the profile's policy,
    and passing `policy` too raises AdmissionConfigError (CONFIG_PROFILE_CONTRADICTION);
    without one, with `policy` (default DEFAULT_VERIFIER_POLICY). A non-V2 bundle under a
    profile is not verified at all (P1)."""
    now = _now_ms() if now_ms is None else now_ms
    loaded_profile = None if profile is None else resolve_strict_v1_profile(profile)
    if loaded_profile is not None and policy is not None:
        _fail("CONFIG_PROFILE_CONTRADICTION", "a strict-v1 profile sets its own verifier policy; do not pass one")
    bundle = _bundle_of(signed_bundle)
    if loaded_profile is not None and (bundle is None or bundle.get("dcp_bundle_version") != "2.0"):
        verification: dict[str, Any] = {
            "verified": False,
            "errors": ["strict-v1 admits V2 bundles only"],
            "warnings": [],
            "details": {},
        }
    else:
        verification = await verify_signed_bundle_v2(
            signed_bundle,
            registry,
            loaded_profile.policy if loaded_profile is not None else policy,
            now_ms=now,
        )
    return evaluate_admission_v2(
        signed_bundle,
        verification,
        profile=loaded_profile,
        trust=trust,
        revocation=revocation,
        now_ms=now,
    )
