"""
Delegated admission (opt-in): a leaf bundle admitted together with the DCP-09 mandate chain it acts under
and a bundle of every delegating agent, at one instant, against the operator's trust set, policy and
revocation sources. Python port of the TypeScript SDK's core/delegated-admission.ts; design:
docs/reviews/mp02-security-composition-design.md (v0.2 § 1).

Everything is verified here, from the evidence itself: no verification result, key map or boolean is taken
from the caller. The chain floor (DCP-09 § 3.5.2 rule 6) is fed to the leaf's own tier computation, so it
raises the mode its signatures are verified in. Admission is not authorization: action_authorized is always
False, and activation (the agent's acknowledgment, DCP-09 § 3.3) is not evaluated yet.

Existing APIs are unchanged: verify_mandate_chain, verify_signed_bundle_v2 and admit_signed_bundle_v2 keep
their behavior; the stricter checks below apply to this function only.

    result = await admit_delegated_bundle_v2(
        {"signed_bundle": leaf, "mandate_chain": [root, sub], "delegator_bundles": [orchestrator]},
        registry,
        {"trust": trust_set, "profile": {"profile": "strict-v1", "verifier_id": "api.example"},
         "revocation": snapshot, "mandate_revocation": mandate_snapshot, "now_ms": now},
    )
"""

from __future__ import annotations

import hashlib
import math
import re
import time
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import timedelta
from typing import Any, Callable

from dcp_ai.v2._schema_v2 import is_schema_date_time
from dcp_ai.v2.admission import (
    PrincipalTrustStore,
    StrictV1Profile,
    _fail,
    _printable,
    _trusted_key_error,
    create_principal_trust_store,
    evaluate_admission_v2,
    resolve_strict_v1_profile,
    revocation_subjects,
)
from dcp_ai.v2.canonicalize import canonicalize_v2
from dcp_ai.v2.crypto_provider import derive_kid
from dcp_ai.v2.crypto_registry import AlgorithmRegistry
from dcp_ai.v2.delegation import _EPOCH, _is_int, verify_mandate_chain
from dcp_ai.v2.security_tier import max_tier
from dcp_ai.v2.session_nonce import rfc3339_epoch_ms
from dcp_ai.v2.verify import (
    DEFAULT_VERIFIER_POLICY,
    SESSION_CLOCK_SKEW_MS,
    _canonical_b64_bytes,
    _verify_signed_bundle_v2_with_profile,
)

_MAX_MESSAGE = 500
_MAX_SECONDS = 300
_NONCE = re.compile(r"[0-9a-f]{64}")
_KID = re.compile(r"[0-9a-f]{32}")
_KEY_BYTES = {"ed25519": 32, "ml-dsa-65": 1952, "slh-dsa-192f": 48}
_SIG_BYTES = {"ed25519": 64, "ml-dsa-65": 3309, "slh-dsa-192f": 35664}
_CLASSICAL_ALGS = ("ed25519",)
_PQ_ALGS = ("ml-dsa-65", "slh-dsa-192f")
_TIERS = ("routine", "standard", "elevated", "maximum")
_REVOCATION_STATUSES = ("revoked", "not_revoked", "unknown")
_MODES = ("classical_only", "pq_only", "hybrid_required", "hybrid_preferred")

# The shape of schemas/v2/delegation_mandate.schema.json, checked by the parity test. Internal.
MANDATE_FIELDS = (
    "dcp_version", "mandate_id", "session_nonce", "human_id", "agent_id", "authority_scope", "valid_from",
    "valid_until", "revocable", "timestamp", "parent_mandate_id", "delegation_depth", "sub_delegation",
    "minimum_security_tier", "human_composite_sig", "delegator_composite_sig",
)
MANDATE_REQUIRED = (
    "dcp_version", "mandate_id", "session_nonce", "human_id", "agent_id", "authority_scope", "valid_from",
    "valid_until", "revocable", "timestamp",
)
# authority_scope items: closed, with domain and actions_permitted required; limits is an open object.
SCOPE_FIELDS = ("domain", "actions_permitted", "data_classes", "limits")
SCOPE_REQUIRED = ("domain", "actions_permitted")
# sub_delegation: closed, both members required.
SUB_DELEGATION_FIELDS = ("permitted", "max_depth")

# The members of schemas/v2/verifier_policy.schema.json, checked by the parity test. Internal.
# Each is (type, minimum, min_items); type is "string", "boolean", "integer", "string_array", "mode" or
# "risk_overrides". An integer is a JSON integer: an int or an integral float, never a bool.
POLICY_FIELDS: dict[str, tuple[str, int | None, int | None]] = {
    "default_mode": ("mode", None, None),
    "risk_overrides": ("risk_overrides", None, None),
    "min_classical": ("integer", 0, None),
    "min_pq": ("integer", 0, None),
    "accepted_classical_algs": ("string_array", None, 1),
    "accepted_pq_algs": ("string_array", None, None),
    "accepted_hash_algs": ("string_array", None, 1),
    "require_session_binding": ("boolean", None, None),
    "require_composite_binding": ("boolean", None, None),
    "max_key_age_days": ("integer", 1, None),
    "allow_v1_bundles": ("boolean", None, None),
    "allow_classical_fallback_disable": ("boolean", None, None),
    "warn_classical_only_deprecated": ("boolean", None, None),
    "advisory_rejected_algs": ("string_array", None, None),
    "require_session_expiry": ("boolean", None, None),
    "max_session_duration_seconds": ("integer", 0, None),
    "require_audience_binding": ("boolean", None, None),
    "verifier_id": ("string", None, None),
}
POLICY_REQUIRED = (
    "default_mode", "risk_overrides", "min_classical", "min_pq", "accepted_classical_algs", "accepted_pq_algs",
    "accepted_hash_algs", "require_session_binding", "require_composite_binding", "max_key_age_days",
    "allow_v1_bundles",
)

_Add = Callable[[str, str], None]


def _bounded(message: str) -> str:
    return message if len(message) <= _MAX_MESSAGE else message[: _MAX_MESSAGE - 1] + "…"


# ── Snapshot: JSON data only ──


class _InputError(Exception):
    pass


def _json_copy(value: Any, where: str, ancestors: set[int] | None = None) -> Any:
    """A copy of `value` made of JSON values only: dict (exactly, str keys), list (exactly), str, int, finite
    float, bool and None. Anything else (a tuple, a set, bytes, a MappingProxyType, a dict or list subclass, a
    non-string key, NaN or infinity, any other object) or a cycle raises _InputError; nothing is converted."""
    ancestors = set() if ancestors is None else ancestors
    kind = type(value)
    if value is None or kind is str or kind is bool or kind is int:
        return value
    if kind is float:
        if not math.isfinite(value):
            raise _InputError(f"{where} is not a finite number")
        return value
    if kind is not dict and kind is not list:
        raise _InputError(f"{where} is not a JSON value ({kind.__name__})")
    if id(value) in ancestors:
        raise _InputError(f"{where} contains a cycle")
    ancestors.add(id(value))
    try:
        if kind is list:
            return [_json_copy(v, f"{where}[{i}]", ancestors) for i, v in enumerate(value)]
        out: dict[str, Any] = {}
        for key, v in value.items():
            if type(key) is not str:
                raise _InputError(f"{where} has a key that is not a string")
            out[key] = _json_copy(v, f"{where}.{key}", ancestors)
        return out
    finally:
        ancestors.discard(id(value))


def _copy_or(value: Any, where: str, on_error: Callable[[str], Any]) -> Any:
    try:
        return _json_copy(value, where)
    except _InputError as exc:
        return on_error(str(exc))
    except RecursionError:
        return on_error(f"{where} is nested too deeply")


def _config_copy(value: Any, where: str) -> Any:
    return _copy_or(value, where, lambda message: _fail("CONFIG_INVALID_VALUE", message))


_MALFORMED = object()


def _snapshot_copy(value: Any, where: str) -> Any:
    """A revocation input copied as JSON; None is "could not answer"; anything that is not JSON data reads as
    malformed (REVOCATION_INVALID)."""
    if value is None:
        return None
    return _copy_or(value, where, lambda _message: _MALFORMED)


# ── Verifier policy without a profile ──


def _check_verifier_policy(policy: Any) -> dict[str, Any]:
    """A verifier policy given without a profile, checked against the policy schema: no unknown member
    (CONFIG_UNKNOWN_FIELD), every required member, and each member of its type, enumeration and bounds
    (CONFIG_INVALID_VALUE). Nothing is defaulted or converted."""
    if type(policy) is not dict:
        _fail("CONFIG_INVALID_VALUE", "policy must be an object")
    for key in policy:
        if key not in POLICY_FIELDS:
            _fail("CONFIG_UNKNOWN_FIELD", f"policy: unknown field {_printable(key)}")
    for key in POLICY_REQUIRED:
        if key not in policy:
            _fail("CONFIG_INVALID_VALUE", f"policy.{key} is required")
    for key, value in policy.items():
        kind, minimum, min_items = POLICY_FIELDS[key]

        def bad(what: str) -> None:
            _fail("CONFIG_INVALID_VALUE", f"policy.{key} {what}")

        if kind == "string" and type(value) is not str:
            bad("must be a string")
        elif kind == "boolean" and type(value) is not bool:
            bad("must be a boolean")
        elif kind == "integer":
            if not _is_int(value):
                bad("must be an integer")
            if minimum is not None and value < minimum:
                bad(f"must be at least {minimum}")
        elif kind == "string_array":
            if type(value) is not list or not all(type(s) is str for s in value):
                bad("must be a list of strings")
            if min_items is not None and len(value) < min_items:
                bad(f"must have at least {min_items} item(s)")
        elif kind == "mode" and not (type(value) is str and value in _MODES):
            bad("must be a verification mode")
        elif kind == "risk_overrides":
            if type(value) is not dict:
                bad("must be an object")
            for tier in value:
                if tier not in ("low", "medium", "high"):
                    _fail("CONFIG_UNKNOWN_FIELD", f"policy.risk_overrides: unknown field {_printable(tier)}")
            for tier in ("low", "medium", "high"):
                if not (type(value.get(tier)) is str and value[tier] in _MODES):
                    bad(f".{tier} must be a verification mode")
    _check_policy_contract(policy)
    return policy


# The largest max_session_duration_seconds this API takes: an int32, held by every SDK without overflow. A domain
# of this API's operator parameter, not a protocol limit.
_POLICY_CONTRACT_MAX_SESSION = 2147483647


def _check_policy_contract(p: dict[str, Any]) -> None:
    """The policy contract of the composition (design R4): the members no verifier applies as a control must take
    the values that add none. min_pq 1; min_classical 1, or 0 when every mode is pq_only; require_composite_binding
    True, or False when every mode is pq_only; require_session_binding True; accepted_hash_algs exactly the set
    {sha256, sha384}; max_key_age_days 365 (it changes warnings only, never a verdict); max_session_duration_seconds
    from 0 to 2147483647. Integers are JSON integers, already checked (an integral float is one, a bool is not).
    The other members are applied by every SDK verifier, or have no effect by norm (allow_v1_bundles: admission
    § 5.1 step 2; the warnings of V2-10). Anything else is CONFIG_INVALID_VALUE: a control that would not be
    applied."""
    o = p["risk_overrides"]
    all_pq = p["default_mode"] == "pq_only" and all(o[t] == "pq_only" for t in ("low", "medium", "high"))

    def invalid(what: str) -> None:
        _fail("CONFIG_INVALID_VALUE", f"policy contract: {what}")

    if p["min_pq"] != 1:
        invalid("min_pq must be 1: the effective mode decides whether a PQ component is required")
    if not (p["min_classical"] == 1 or (p["min_classical"] == 0 and all_pq)):
        invalid("min_classical must be 1, or 0 when every mode is pq_only")
    if not (p["require_composite_binding"] is True or all_pq):
        invalid("require_composite_binding must be true, or false when every mode is pq_only")
    if p["require_session_binding"] is not True:
        invalid("require_session_binding must be true (V2-4)")
    hashes = p["accepted_hash_algs"]
    if not (len(hashes) == 2 and "sha256" in hashes and "sha384" in hashes):
        invalid("accepted_hash_algs must be the set sha256, sha384")
    if p["max_key_age_days"] != 365:
        invalid("max_key_age_days must be 365")
    if "max_session_duration_seconds" in p and p["max_session_duration_seconds"] > _POLICY_CONTRACT_MAX_SESSION:
        invalid(f"max_session_duration_seconds must be at most {_POLICY_CONTRACT_MAX_SESSION}")


# ── Mandate preflight (this function only) ──


def _non_empty_string_list(value: Any) -> bool:
    return type(value) is list and all(type(s) is str and s != "" for s in value)


def _signature_slot_error(sig: Any, field: str) -> str | None:
    """Why a composite signature slot is not a well-formed pq_over_classical signature, or None."""
    if type(sig) is not dict:
        return f"{field} is not an object"
    for key in sig:
        if key not in ("classical", "pq", "binding"):
            return f"{field} has unknown member {_printable(key)}"
    if sig.get("binding") != "pq_over_classical":
        return f"{field} binding must be pq_over_classical"
    for component, algs in (("classical", _CLASSICAL_ALGS), ("pq", _PQ_ALGS)):
        entry = sig.get(component)
        at = f"{field}.{component}"
        if type(entry) is not dict:
            return f"{at} is not an object"
        for key in entry:
            if key not in ("alg", "kid", "sig_b64"):
                return f"{at} has unknown member {_printable(key)}"
        alg = entry.get("alg")
        if type(alg) is not str or alg not in algs:
            return f"{at}.alg {_printable(alg)} is not a {component} algorithm"
        kid = entry.get("kid")
        if type(kid) is not str or not _KID.fullmatch(kid):
            return f"{at}.kid is not 32 lowercase hex digits"
        raw = _canonical_b64_bytes(entry.get("sig_b64"))
        if raw is None:
            return f"{at}.sig_b64 is not canonical base64 (V2-5)"
        if len(raw) != _SIG_BYTES[alg]:
            return f"{at}.sig_b64 is {len(raw)} bytes, not a {alg} signature ({_SIG_BYTES[alg]})"
    return None


def _scope_shape_errors(scope: Any) -> list[str]:
    """authority_scope as the schema has it: a non-empty array of closed objects; domain a non-empty string;
    actions_permitted and data_classes lists of non-empty strings (an empty list is allowed); limits an object
    whose members are not constrained here (DCP-09 § 3.5.2 rule 5 reads them; the schema leaves it open)."""
    if type(scope) is not list or not scope:
        return ["authority_scope must be a non-empty array"]
    errors: list[str] = []
    for j, e in enumerate(scope):
        w = f"authority_scope[{j}]"
        if type(e) is not dict:
            errors.append(f"{w} is not an object")
            continue
        errors.extend(f"{w} has unknown member {_printable(k)}" for k in e if k not in SCOPE_FIELDS)
        errors.extend(f"{w} is missing {k}" for k in SCOPE_REQUIRED if k not in e)
        if "domain" in e and not (type(e["domain"]) is str and e["domain"] != ""):
            errors.append(f"{w}.domain must be a non-empty string")
        for key in ("actions_permitted", "data_classes"):
            if key in e and not _non_empty_string_list(e[key]):
                errors.append(f"{w}.{key} must be a list of non-empty strings")
        if "limits" in e and type(e["limits"]) is not dict:
            errors.append(f"{w}.limits must be an object")
    return errors


def _min_length(value: Any, n: int) -> bool:
    return type(value) is str and len(value) >= n  # len counts code points, as the schema's minLength


def _mandate_preflight(m: Any, i: int) -> list[str]:
    """The mandate schema this function requires before the chain verifier runs (depth i)."""

    def at(e: str) -> str:
        return f"mandate[{i}]: {e}"

    if type(m) is not dict:
        return [at("not an object")]
    errors: list[str] = []
    errors.extend(at(f"unknown field {_printable(k)}") for k in m if k not in MANDATE_FIELDS)
    errors.extend(at(f"missing {k}") for k in MANDATE_REQUIRED if k not in m)
    if m.get("dcp_version") != "2.0":
        errors.append(at('dcp_version must be "2.0"'))
    nonce = m.get("session_nonce")
    if type(nonce) is not str or not _NONCE.fullmatch(nonce):
        errors.append(at("session_nonce is not 64 lowercase hex digits"))
    for field in ("mandate_id", "human_id", "agent_id"):
        if not _min_length(m.get(field), 6):
            errors.append(at(f"{field} must be a string of at least 6 characters"))
    if "parent_mandate_id" in m and not _min_length(m["parent_mandate_id"], 6):
        errors.append(at("parent_mandate_id must be a string of at least 6 characters"))
    if type(m.get("revocable")) is not bool:
        errors.append(at("revocable must be a boolean"))
    for field in ("valid_from", "valid_until", "timestamp"):
        v = m.get(field)
        if type(v) is not str or not is_schema_date_time(v) or rfc3339_epoch_ms(v) is None:
            errors.append(at(f"{field} is not an RFC 3339 date-time"))
    depth = m.get("delegation_depth")
    if "delegation_depth" in m and not (_is_int(depth) and depth >= 0):
        errors.append(at("delegation_depth must be an integer >= 0"))
    # The schema's oneOf: a root has no parent and depth 0 or none; a sub-mandate has both, depth >= 1.
    if i == 0:
        if "parent_mandate_id" in m:
            errors.append(at("a root mandate has no parent_mandate_id"))
        if "delegation_depth" in m and not (_is_int(depth) and depth == 0):
            errors.append(at("a root mandate has delegation_depth 0"))
    else:
        if "parent_mandate_id" not in m:
            errors.append(at("missing parent_mandate_id"))
        if "delegation_depth" not in m:
            errors.append(at("missing delegation_depth"))
        elif _is_int(depth) and depth < 1:
            errors.append(at("a sub-mandate has delegation_depth >= 1"))
    errors.extend(at(e) for e in _scope_shape_errors(m.get("authority_scope")))
    if "sub_delegation" in m:
        sd = m["sub_delegation"]
        if type(sd) is not dict:
            errors.append(at("sub_delegation is not an object"))
        else:
            errors.extend(at(f"sub_delegation has unknown member {_printable(k)}") for k in sd if k not in SUB_DELEGATION_FIELDS)
            if type(sd.get("permitted")) is not bool:
                errors.append(at("sub_delegation.permitted must be a boolean"))
            if not (_is_int(sd.get("max_depth")) and sd["max_depth"] >= 0):
                errors.append(at("sub_delegation.max_depth must be an integer >= 0"))
    if "minimum_security_tier" in m and m["minimum_security_tier"] not in _TIERS:
        errors.append(at("minimum_security_tier is not routine, standard, elevated or maximum"))
    # The slot of the mandate's depth, and only that one (the schema's oneOf; DCP-09 § 3.5.1).
    field, other = ("human_composite_sig", "delegator_composite_sig") if i == 0 else ("delegator_composite_sig", "human_composite_sig")
    if field not in m:
        errors.append(at(f"missing {field}"))
    else:
        slot = _signature_slot_error(m[field], field)
        if slot is not None:
            errors.append(at(slot))
    if other in m:
        errors.append(at(f"{other} is not allowed at this depth"))
    return errors


def _provisional_floor(chain: list[dict[str, Any]]) -> str | None:
    """The highest minimum_security_tier of the chain; a name that is not a tier counts as elevated."""
    floor: str | None = None
    for m in chain:
        if "minimum_security_tier" not in m:
            continue
        tier = m["minimum_security_tier"] if m["minimum_security_tier"] in _TIERS else "elevated"
        floor = tier if floor is None else max_tier(floor, tier)
    return floor


# ── Revocation snapshots (§ 4.3 of the admission profile, for any subjects) ──


def _snapshot_checks(
    snapshot: Any, maps: list[tuple[str, str, list[str]]], max_age_seconds: int, now: int, add: _Add
) -> None:
    label = " and ".join(kind for kind, _, _ in maps)
    if snapshot is None:
        add("REVOCATION_UNAVAILABLE", f"no {label} revocation status could be obtained")
        return
    fields = ["checked_at", *(field for _, field, _ in maps)]
    valid = (
        type(snapshot) is dict
        and len(snapshot) == len(fields)
        and all(f in snapshot for f in fields)
        and rfc3339_epoch_ms(snapshot.get("checked_at")) is not None
        and all(
            type(snapshot[field]) is dict
            and all(type(s) is str and s in _REVOCATION_STATUSES for s in snapshot[field].values())
            for _, field, _ in maps
        )
    )
    if not valid:
        add("REVOCATION_INVALID", f"the {label} revocation snapshot is malformed")
        return
    checked_at = rfc3339_epoch_ms(snapshot["checked_at"])
    assert checked_at is not None
    if checked_at > now + SESSION_CLOCK_SKEW_MS:
        add("REVOCATION_INVALID", f"the {label} revocation snapshot is dated in the future")
        return
    if now - checked_at > max_age_seconds * 1000:
        add("REVOCATION_STALE", f"the {label} revocation snapshot is older than {max_age_seconds} s")
    for kind, field, ids in maps:
        statuses = snapshot[field]
        for subject in ids:
            status = statuses.get(subject)
            if status == "revoked":
                add("REVOCATION_REVOKED", f"{kind} {_printable(subject)} is revoked")
            elif status != "not_revoked":
                add("REVOCATION_UNKNOWN", f"the revocation status of {kind} {_printable(subject)} is unknown")


# ── Keys ──


def _used_key_error(key: Any, kid: str, alg: str, where: str) -> str | None:
    """A key entry that can verify `alg` with this `kid`: canonical base64 of the algorithm's size, kid
    derived (V2-13). None when no key has the kid: the chain verifier reports it."""
    if key is None:
        return None
    if key.get("alg") != alg:
        return f"{where}: key {kid} is {_printable(key.get('alg'))}, not {alg}"
    raw = _canonical_b64_bytes(key.get("public_key_b64"))
    if raw is None or len(raw) != _KEY_BYTES[alg]:
        return f"{where}: key {kid} is not a canonical base64 {alg} public key"
    if derive_kid(alg, raw) != kid:
        return f"{where}: kid {kid} is not derived from its key (V2-13)"
    return None


def _payload_field(bundle: Any, artifact: str, field: str) -> Any:
    b = bundle.get("bundle") if type(bundle) is dict else None
    signed = b.get(artifact) if type(b) is dict else None
    payload = signed.get("payload") if type(signed) is dict else None
    return payload.get(field) if type(payload) is dict else None


def _keys_of(bundle: Any, artifact: str, field: str) -> list[Any]:
    keys = _payload_field(bundle, artifact, field)
    return keys if type(keys) is list else []


def _find(keys: list[Any], kid: str) -> dict[str, Any] | None:
    return next((k for k in keys if type(k) is dict and k.get("kid") == kid), None)


# ── Admission ──


@dataclass(frozen=True)
class _DelegatedSnapshot:
    """Everything admit_delegated_bundle_v2 reads from its caller, copied when the coroutine starts (F4 design § 10.1)."""

    now_ms: int
    trust: PrincipalTrustStore
    profile: StrictV1Profile | None
    policy: Any
    max_age: int
    revocation: Any  # a copy, None (the source could not answer) or _MALFORMED
    mandate_revocation: Any
    evidence: tuple[Any, list[Any], list[Any]] | None
    input_error: str | None


def _take_delegated_snapshot(evidence: Any, operator: Any) -> _DelegatedSnapshot:
    """Step 0 of admit_delegated_bundle_v2: the operator configuration, read once, then every copy of the evidence.
    Raises AdmissionConfigError as before and in the same order; evidence that is not JSON data is recorded, not
    raised, and any other exception propagates as before."""
    if not isinstance(operator, Mapping):
        _fail("CONFIG_INVALID_VALUE", "the operator configuration must be an object")
    trust_in = operator.get("trust")
    profile_in = operator.get("profile")
    policy_in = operator.get("policy")
    revocation_in = operator.get("revocation")
    mandate_revocation_in = operator.get("mandate_revocation")
    max_age_in = operator.get("max_revocation_age_seconds")
    now_in = operator.get("now_ms")

    if now_in is None:
        now_ms = time.time_ns() // 1_000_000
    elif isinstance(now_in, bool) or not isinstance(now_in, (int, float)) or not math.isfinite(now_in):
        _fail("CONFIG_INVALID_VALUE", "now_ms must be a finite number of milliseconds")
    else:
        now_ms = math.floor(now_in)

    if trust_in is None:
        _fail("CONFIG_INVALID_VALUE", "delegated admission requires a trust set")
    trust = trust_in if type(trust_in) is PrincipalTrustStore else create_principal_trust_store(_config_copy(trust_in, "trust"))

    profile: StrictV1Profile | None = None
    if profile_in is not None:
        profile = profile_in if type(profile_in) is StrictV1Profile else resolve_strict_v1_profile(_config_copy(profile_in, "profile"))
        if policy_in is not None:
            _fail("CONFIG_PROFILE_CONTRADICTION", "a strict-v1 profile sets its own verifier policy; do not pass one")
        if max_age_in is not None:
            _fail("CONFIG_PROFILE_CONTRADICTION", "a strict-v1 profile sets max_revocation_age_seconds; do not pass one")
    if profile is not None:
        max_age = profile.max_revocation_age_seconds
    else:
        if not (_is_int(max_age_in) and 1 <= max_age_in <= _MAX_SECONDS):
            _fail("CONFIG_INVALID_VALUE", f"without a profile, max_revocation_age_seconds must be an integer from 1 to {_MAX_SECONDS}")
        max_age = int(max_age_in)
    # Without a profile, the operator's policy is checked against the policy schema; a profile's is resolved.
    policy: Any = (
        profile.policy
        if profile is not None
        else _check_verifier_policy(_config_copy(DEFAULT_VERIFIER_POLICY if policy_in is None else policy_in, "policy"))
    )
    revocation = _snapshot_copy(revocation_in, "revocation")
    mandate_revocation = _snapshot_copy(mandate_revocation_in, "mandate_revocation")

    try:
        if type(evidence) is not dict:
            raise _InputError("evidence is not an object")
        if "signed_bundle" not in evidence or "mandate_chain" not in evidence:
            raise _InputError("evidence needs signed_bundle and mandate_chain")
        leaf_bundle = _json_copy(evidence["signed_bundle"], "signed_bundle")
        chain = _json_copy(evidence["mandate_chain"], "mandate_chain")
        if type(chain) is not list:
            raise _InputError("mandate_chain is not an array")
        delegator_bundles = _json_copy(evidence.get("delegator_bundles", []), "delegator_bundles")
        if type(delegator_bundles) is not list:
            raise _InputError("delegator_bundles is not an array")
    except _InputError as exc:
        return _DelegatedSnapshot(now_ms, trust, profile, policy, max_age, revocation, mandate_revocation, None, str(exc))
    except RecursionError:
        return _DelegatedSnapshot(now_ms, trust, profile, policy, max_age, revocation, mandate_revocation, None, "the evidence is nested too deeply")
    return _DelegatedSnapshot(
        now_ms, trust, profile, policy, max_age, revocation, mandate_revocation, (leaf_bundle, chain, delegator_bundles), None
    )


async def admit_delegated_bundle_v2(evidence: Any, registry: AlgorithmRegistry, operator: Any) -> dict[str, Any]:
    """Admit a leaf bundle with the mandate chain it acts under (design § 1.3). Raises AdmissionConfigError for
    an invalid operator configuration; every problem with the evidence is a code in the result.

    `evidence` holds "signed_bundle" (the acting agent's bundle), "mandate_chain" (root first) and optionally
    "delegator_bundles" (one bundle of each delegating agent). `operator` holds "trust" (required: a loaded
    store, used as it is, or a trust set), "profile" or "policy" (excluding each other; without a profile,
    "max_revocation_age_seconds", an integer from 1 to 300, is required), "revocation", "mandate_revocation"
    (None when the source could not answer) and "now_ms" (default the system clock, read once).

    The registry is a capability the operator trusts: it is used as given, not copied, and must not change
    during the call. Every other input is copied when the coroutine starts, before its first await, and only
    the copies are read. Returns {"admitted", "delegation_verified", "activation", "delegation_active",
    "action_authorized", "security_tier", "verification_mode", "chain", "leaf", "delegators", "inputs",
    "errors"}.
    """
    result, _verified = await _compose_delegated(_take_delegated_snapshot(evidence, operator), registry)
    return result


async def _compose_delegated(
    snapshot: _DelegatedSnapshot, registry: AlgorithmRegistry
) -> tuple[dict[str, Any], dict[str, Any] | None]:
    """Steps 1 to 11 of admit_delegated_bundle_v2 over a snapshot, with the same codes, order and early returns.
    The second value is None unless the result is admitted: then the data the composition verified, as
    references to the snapshot's copies (read by the mandate acknowledgment only, never modified)."""
    now_ms, trust, profile, policy = snapshot.now_ms, snapshot.trust, snapshot.profile, snapshot.policy
    max_age, revocation, mandate_revocation = snapshot.max_age, snapshot.revocation, snapshot.mandate_revocation
    errors: list[dict[str, str]] = []

    def add(code: str, message: str) -> None:
        errors.append({"code": code, "message": _bounded(message)})

    def checked_at(s: Any) -> str | None:
        return s["checked_at"] if type(s) is dict and type(s.get("checked_at")) is str else None

    inputs: dict[str, Any] = {
        "now": now_ms,
        "leaf_bundle_sha256": None,
        "trust_set_version": trust.version,
        "revocation_checked_at": checked_at(revocation),
        "mandate_revocation_checked_at": checked_at(mandate_revocation),
    }

    def result(**fields: Any) -> dict[str, Any]:
        return {
            "admitted": False,
            "delegation_verified": False,
            "activation": "not_evaluated",
            "delegation_active": False,
            "action_authorized": False,
            "security_tier": None,
            "verification_mode": None,
            "chain": None,
            "leaf": None,
            "delegators": [],
            "inputs": inputs,
            "errors": errors,
            **fields,
        }

    if snapshot.evidence is None:
        add("DELEGATION_INPUT_INVALID", snapshot.input_error or "")
        return result(), None
    leaf_bundle, chain, delegator_bundles = snapshot.evidence
    try:
        inputs["leaf_bundle_sha256"] = hashlib.sha256(canonicalize_v2(leaf_bundle).encode("utf-8")).hexdigest()
    except (TypeError, ValueError):
        pass  # not canonicalizable: the verifier rejects it below

    # ── 1. Form and preflight ──
    if not chain:
        add("DELEGATION_CHAIN_INVALID", "the mandate chain is empty")
        return result(), None
    for i, m in enumerate(chain):
        for e in _mandate_preflight(m, i):
            add("DELEGATION_CHAIN_INVALID", e)
    if errors:
        return result(), None
    mandates: list[dict[str, Any]] = chain
    mandate_ids = [m["mandate_id"] for m in mandates]
    agent_ids = [m["agent_id"] for m in mandates]
    for kind, ids in (("mandate_id", mandate_ids), ("agent_id", agent_ids)):
        repeated = sorted({x for i, x in enumerate(ids) if ids.index(x) != i})
        for x in repeated:
            add("DELEGATION_REPEATED_ID", f"{kind} {_printable(x)} appears more than once in the chain")
    if errors:
        return result(), None
    human_id = mandates[0]["human_id"]
    leaf_agent = agent_ids[-1]
    delegating_agents = agent_ids[:-1]

    # ── 2. Provisional floor: it can only make the bundle checks stricter ──
    floor = _provisional_floor(mandates)

    # ── 3. Bundles: verified at the same instant with the floor, then admitted ──
    async def admit(bundle: Any) -> dict[str, Any]:
        verification = await _verify_signed_bundle_v2_with_profile(
            bundle, registry, policy, now_ms, "dcp-jcs-v1", tier_floor=floor
        )
        return evaluate_admission_v2(
            bundle,
            verification,
            profile=profile,
            trust=trust,
            revocation={} if revocation is _MALFORMED else revocation,
            now_ms=now_ms,
        )

    leaf = await admit(leaf_bundle)
    delegators = [await admit(b) for b in delegator_bundles]

    # The leaf's own codes, but revocation, which step 10 evaluates once for every subject.
    for e in leaf["errors"]:
        if not e["code"].startswith("REVOCATION_"):
            add(e["code"], f"leaf: {e['message']}")

    # ── 4. Links ──
    delegation_problem = False

    def problem(code: str, message: str) -> None:
        nonlocal delegation_problem
        delegation_problem = True
        add(code, message)

    leaf_id = _payload_field(leaf_bundle, "agent_passport", "agent_id")
    if leaf_id != leaf_agent:
        problem("DELEGATION_LEAF_MISMATCH", f"the leaf bundle's agent {_printable(leaf_id)} is not the last mandate's agent {_printable(leaf_agent)}")
    leaf_principal = _payload_field(leaf_bundle, "responsible_principal_record", "human_id")
    if leaf_principal != human_id:
        problem("DELEGATION_PRINCIPAL_MISMATCH", f"the leaf bundle's principal {_printable(leaf_principal)} is not the chain's {_printable(human_id)}")

    by_agent: dict[str, int] = {}
    for i, bundle in enumerate(delegator_bundles):
        agent = _payload_field(bundle, "agent_passport", "agent_id")
        principal = _payload_field(bundle, "responsible_principal_record", "human_id")
        if principal != human_id:
            problem("DELEGATION_PRINCIPAL_MISMATCH", f"delegator_bundles[{i}]: principal {_printable(principal)} is not the chain's {_printable(human_id)}")
        if type(agent) is not str or agent not in delegating_agents:
            problem("DELEGATION_DELEGATOR_UNEXPECTED", f"delegator_bundles[{i}]: agent {_printable(agent)} delegates nothing in this chain")
        elif agent in by_agent:
            problem("DELEGATION_DELEGATOR_UNEXPECTED", f"delegator_bundles[{i}]: a second bundle of agent {_printable(agent)}")
        else:
            by_agent[agent] = i
        if not delegators[i]["admitted"]:
            codes = ", ".join(e["code"] for e in delegators[i]["errors"])
            problem("DELEGATION_DELEGATOR_NOT_ADMITTED", f"delegator_bundles[{i}] is not admitted: {codes}")
    for agent in delegating_agents:
        if agent not in by_agent:
            problem("DELEGATION_DELEGATOR_MISSING", f"no bundle of delegating agent {_printable(agent)}")

    # ── 5. Keys of every actor: the principal, each delegator and the leaf ──
    # Only from bundles that verified: an unverified bundle's keys are not the agent's keys.
    leaf_verified = leaf["verified"]
    principal_lists: list[list[Any]] = []
    if leaf_verified:
        principal_lists.append(_keys_of(leaf_bundle, "responsible_principal_record", "binding_keys"))
    agent_keys: dict[str, list[Any]] = {}
    actors: list[tuple[str, list[list[Any]]]] = [("principal", principal_lists)]
    for agent, i in by_agent.items():
        if not delegators[i]["verified"]:
            continue
        principal_lists.append(_keys_of(delegator_bundles[i], "responsible_principal_record", "binding_keys"))
        agent_keys[agent] = _keys_of(delegator_bundles[i], "agent_passport", "keys")
        actors.append((f"delegator {agent}", [agent_keys[agent]]))
    if leaf_verified:
        actors.append((f"leaf {leaf_agent}", [_keys_of(leaf_bundle, "agent_passport", "keys")]))

    kid_owner: dict[str, str] = {}
    key_owner: dict[tuple[str, str], str] = {}
    kid_key: dict[str, tuple[str, str]] = {}
    for label, lists in actors:
        for keys in lists:
            seen: set[str] = set()
            for entry in keys:
                if type(entry) is not dict or not all(type(entry.get(f)) is str for f in ("kid", "alg", "public_key_b64")):
                    continue
                kid = entry["kid"]
                identity = (entry["alg"], entry["public_key_b64"])
                if kid in seen:
                    problem("DELEGATION_KEY_AMBIGUOUS", f"{label}: kid {kid} is listed twice in one key list")
                seen.add(kid)
                for owners, key in ((kid_owner, kid), (key_owner, identity)):
                    owner = owners.get(key)  # type: ignore[call-overload]
                    if owner is not None and owner != label:
                        problem("DELEGATION_KEY_AMBIGUOUS", f"kid {kid}: the same key belongs to {owner} and {label}")
                    else:
                        owners[key] = label  # type: ignore[index]
                known = kid_key.get(kid)
                if known is not None and known != identity:
                    problem("DELEGATION_KEY_AMBIGUOUS", f"{label}: kid {kid} names two different keys")
                kid_key[kid] = identity

    # The keys each mandate signature names, with their identity checked here (the chain verifier does not).
    human_keys = _keys_of(leaf_bundle, "responsible_principal_record", "binding_keys") if leaf_verified else []

    def slot_of(i: int) -> dict[str, Any]:
        return mandates[i]["human_composite_sig" if i == 0 else "delegator_composite_sig"]

    def list_of(i: int) -> list[Any]:
        return human_keys if i == 0 else agent_keys.get(agent_ids[i - 1], [])

    used_kids: set[str] = set()
    for i in range(len(mandates)):
        sig = slot_of(i)
        for component in ("classical", "pq"):
            kid, alg = sig[component]["kid"], sig[component]["alg"]
            used_kids.add(kid)
            error = _used_key_error(_find(list_of(i), kid), kid, alg, f"mandate[{i}] {component}")
            if error is not None:
                problem("DELEGATION_CHAIN_INVALID", error)

    # ── 6. The chain, with the history API unchanged ──
    revoked_mandates: set[str] = set()
    if type(mandate_revocation) is dict and type(mandate_revocation.get("mandates")) is dict:
        revoked_mandates = {k for k, v in mandate_revocation["mandates"].items() if v == "revoked"}
    chain_floor: str | None = None
    chain_valid = False
    if leaf_verified:
        verdict = await verify_mandate_chain(
            registry,
            mandates,
            revoked_mandates,
            {"human_keys": human_keys, "agent_keys": agent_keys},
            now=_EPOCH + timedelta(milliseconds=now_ms),
        )
        chain_valid = verdict["valid"] is True
        if not chain_valid:
            for e in verdict["errors"]:
                problem("DELEGATION_CHAIN_INVALID", e)
        elif verdict["effective_tier"] != floor:
            problem(
                "DELEGATION_FLOOR_MISMATCH",
                f"the verified chain floor {verdict['effective_tier']} is not the floor the bundles were verified with ({floor})",
            )
        else:
            chain_floor = verdict["effective_tier"]
    else:
        problem("DELEGATION_CHAIN_INVALID", "the chain is not verified: the leaf bundle, whose RPR holds the principal keys, did not verify")

    # ── 7. Verifier policy on every chain signature component ──
    details = leaf["verification"].get("details") if type(leaf["verification"]) is dict else None
    mode = details.get("verification_mode") if type(details) is dict and details.get("verification_mode") else "hybrid_required"

    def listed(field: str) -> list[Any]:
        value = policy.get(field)
        return list(value) if isinstance(value, (list, tuple)) else []

    for i in range(len(mandates)):
        sig = slot_of(i)
        classical, pq = sig["classical"]["alg"], sig["pq"]["alg"]
        if mode != "pq_only":
            if classical not in listed("accepted_classical_algs"):
                problem("DELEGATION_ALGORITHM_REJECTED", f"mandate[{i}]: classical algorithm {classical} is not accepted by the verifier policy")
            if classical in listed("advisory_rejected_algs"):
                problem("DELEGATION_ALGORITHM_REJECTED", f"mandate[{i}]: classical algorithm {classical} is rejected by an active advisory")
        if pq not in listed("accepted_pq_algs"):
            problem("DELEGATION_ALGORITHM_REJECTED", f"mandate[{i}]: PQ algorithm {pq} is not accepted by the verifier policy")
        if pq in listed("advisory_rejected_algs"):
            problem("DELEGATION_ALGORITHM_REJECTED", f"mandate[{i}]: PQ algorithm {pq} is rejected by an active advisory")

    # ── 8. The root's components, each anchored in the current trust set ──
    trusted = trust.principals.get(human_id)
    if trusted is None:
        problem("TRUST_PRINCIPAL_UNKNOWN", f"mandate[0]: principal {_printable(human_id)} is not in trust set {_printable(trust.version)}")
    else:
        root = slot_of(0)
        for component in ("classical", "pq"):
            kid = root[component]["kid"]
            key = _find(human_keys, kid)
            if key is None:
                continue  # the chain verifier reports it
            error = _trusted_key_error(trusted, kid, key.get("alg"), key.get("public_key_b64"), f"mandate[0] {component} key {kid}", now_ms)
            if error is not None:
                problem(*error)

    # ── 9. session_nonce: the explicit rule ──
    # A mandate's nonce is its issuance session's; each bundle is an action session. No equality is required
    # between a mandate and any bundle, or between mandates; within each bundle V2-4 applies (step 3).

    # ── 10. Revocation of every subject of the composition ──
    kids = set(used_kids)
    for bundle, admission in [(leaf_bundle, leaf), *zip(delegator_bundles, delegators)]:
        kids.update(revocation_subjects(bundle, admission["verification"])["kids"])
    _snapshot_checks(
        {} if revocation is _MALFORMED else revocation,
        [("agent", "agents", agent_ids), ("key", "keys", sorted(kids))],
        max_age,
        now_ms,
        add,
    )
    _snapshot_checks(
        {} if mandate_revocation is _MALFORMED else mandate_revocation,
        [("mandate", "mandates", mandate_ids)],
        max_age,
        now_ms,
        add,
    )

    # ── 11. Result ──
    delegation_verified = chain_valid and chain_floor == floor and not delegation_problem
    admitted = bool(not errors and leaf["admitted"] and all(d["admitted"] for d in delegators) and delegation_verified)
    outcome = result(
        admitted=admitted,
        delegation_verified=delegation_verified,
        security_tier=details.get("resolved_tier") if leaf_verified and type(details) is dict else None,
        verification_mode=details.get("verification_mode") if leaf_verified and type(details) is dict else None,
        chain={
            "depth": len(mandates) - 1,
            "mandate_ids": mandate_ids,
            "effective_floor": chain_floor,
            "leaf_authority_scope": _json_copy(mandates[-1]["authority_scope"], "scope"),
        },
        leaf=leaf,
        delegators=delegators,
    )
    if not admitted:
        return outcome, None
    # Admitted: the leaf and every delegator verified, so each agent's passport keys are its verified keys.
    verified_keys = {agent: agent_keys[agent] for agent in delegating_agents}
    verified_keys[leaf_agent] = _keys_of(leaf_bundle, "agent_passport", "keys")
    return outcome, {
        "now_ms": now_ms,
        "mandates": mandates,
        "agent_ids": agent_ids,
        "agent_keys": verified_keys,
        "policy": policy,
        "mode": mode,
        "revocation": revocation,
        "checked_kids": frozenset(kids),
    }
