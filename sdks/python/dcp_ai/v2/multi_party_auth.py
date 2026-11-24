"""
Multi-party authorization: the opt-in mpa-v1 profile (spec/profiles/multi-party).

Three layers, each with its own answer:

- structure: check_multi_party_authorization_structure. Is the record well formed? It
  verifies no signature.
- verification: which parties signed exactly this request, with the keys the operator
  trusts for them.
- authorization: whether those parties are enough for this operation on this target,
  for this verifier, now.

evaluate_multi_party_authorization gives the last two; only it produces ``authorized``.

Each party signs {operation, operation_payload, party_id, role} under
DCP-AI.v2.MultiPartyAuth, as in v2.0. Under mpa-v1 the operation_payload is
{request, parameters}, so the target, the audience and the validity window are signed
too. Who the parties of a target are, their roles and the threshold come from the
operator's policy set; their keys come from the operator's principal trust set. Nothing
in the record stands for either.

Deterministic and offline. It keeps no state: evaluating a request does not consume it
(single use is the executor's, which must consume request_id and execute atomically). It
decides on a copy of the record taken when it is called: the caller's object is not read
again.
"""

from __future__ import annotations

import base64
import re
import secrets
import warnings
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from types import MappingProxyType
from typing import Any, Literal, Mapping, NoReturn

from pydantic import BaseModel, Field

from dcp_ai.v2.admission import (
    PrincipalTrustStore,
    TrustedKey,
    _is_integer,
    _printable,
    create_principal_trust_store,
)
from dcp_ai.v2.canonicalize import canonicalize_v2
from dcp_ai.v2.composite_ops import CompositeKeyInfo, composite_sign, composite_verify
from dcp_ai.v2.crypto_registry import AlgorithmRegistry
from dcp_ai.v2.domain_separation import DCP_CONTEXTS
from dcp_ai.v2.session_nonce import rfc3339_epoch_ms
from dcp_ai.v2.verify import DEFAULT_VERIFIER_POLICY, SESSION_CLOCK_SKEW_MS, _canonical_b64_bytes

MultiPartyOperation = Literal[
    "revoke_agent",
    "rotate_org_key",
    "change_jurisdiction",
    "modify_recovery_config",
]

AuthorizationRole = Literal["owner", "org_admin", "recovery_contact"]

MPA_V1 = "mpa-v1"
# The most authorizations a record may carry under the profile.
MPA_V1_MAX_AUTHORIZATIONS = 16
# The longest validity window an operator may allow, in seconds.
MPA_V1_MAX_VALIDITY_SECONDS = 86_400

_MAX_REQUEST_ID = 128
_MAX_IDENTIFIER = 256
_MAX_MESSAGE = 300
_OPERATIONS = ("revoke_agent", "rotate_org_key", "change_jurisdiction", "modify_recovery_config")
_ROLES = ("owner", "org_admin", "recovery_contact")
_CONTEXT = DCP_CONTEXTS["MultiPartyAuth"]


class PartyAuthorization(BaseModel):
    party_id: str
    role: AuthorizationRole
    composite_sig: dict[str, Any]


class MultiPartyAuthorization(BaseModel):
    type: Literal["multi_party_authorization"] = "multi_party_authorization"
    operation: MultiPartyOperation
    operation_payload: dict[str, Any]
    required_parties: int = 2
    authorizations: list[PartyAuthorization]


class MultiPartyPolicy(BaseModel):
    """The shape policy of check_multi_party_authorization_structure. Not the operator's
    policy set: that is create_multi_party_policy_store."""

    required_parties: int = 2
    allowed_roles: list[AuthorizationRole] = Field(
        default_factory=lambda: ["owner", "org_admin", "recovery_contact"]
    )
    require_owner: bool = True


DEFAULT_POLICIES: dict[str, MultiPartyPolicy] = {
    "revoke_agent": MultiPartyPolicy(
        required_parties=2,
        allowed_roles=["owner", "org_admin", "recovery_contact"],
        require_owner=True,
    ),
    "rotate_org_key": MultiPartyPolicy(
        required_parties=2,
        allowed_roles=["owner", "org_admin"],
        require_owner=True,
    ),
    "change_jurisdiction": MultiPartyPolicy(
        required_parties=2,
        allowed_roles=["owner", "org_admin"],
        require_owner=True,
    ),
    "modify_recovery_config": MultiPartyPolicy(
        required_parties=2,
        allowed_roles=["owner", "org_admin", "recovery_contact"],
        require_owner=True,
    ),
}


# ── Structure: the shape, and nothing else ──


def check_multi_party_authorization_structure(
    mpa: MultiPartyAuthorization,
    policy: MultiPartyPolicy | None = None,
) -> dict[str, Any]:
    """Check the shape of a record: how many authorizations it lists, with which roles,
    and that each carries a composite_sig.

    It verifies no signature, knows no party and reads no operator policy, so ``valid``
    says nothing about who signed or whether the operation is authorized: for that,
    evaluate_multi_party_authorization.
    """
    errors: list[str] = []
    effective_policy = policy or DEFAULT_POLICIES.get(mpa.operation)

    if effective_policy is None:
        return {
            "valid": False,
            "errors": [f"No policy defined for operation: {mpa.operation}"],
        }

    if len(mpa.authorizations) < effective_policy.required_parties:
        errors.append(
            f"Insufficient authorizations: {len(mpa.authorizations)} < {effective_policy.required_parties}"
        )

    if effective_policy.require_owner:
        has_owner = any(a.role == "owner" for a in mpa.authorizations)
        if not has_owner:
            errors.append("Owner authorization required but not present")

    for auth in mpa.authorizations:
        if auth.role not in effective_policy.allowed_roles:
            errors.append(
                f"Role {auth.role} not allowed for operation {mpa.operation}"
            )
        if not auth.composite_sig:
            errors.append(f"Missing composite_sig for party {auth.party_id}")

    return {"valid": len(errors) == 0, "errors": errors}


def verify_multi_party_authorization(
    mpa: MultiPartyAuthorization,
    policy: MultiPartyPolicy | None = None,
) -> dict[str, Any]:
    """Deprecated name of check_multi_party_authorization_structure, with the same result.

    Despite its name it verifies no signature and authorizes nothing: it checks the
    shape of the record. Use check_multi_party_authorization_structure for that, and
    evaluate_multi_party_authorization to decide whether an operation is authorized.
    """
    warnings.warn(
        "verify_multi_party_authorization checks the shape of a record only: it verifies no signature and "
        "authorizes nothing. Use check_multi_party_authorization_structure for the shape and "
        "evaluate_multi_party_authorization for the decision.",
        DeprecationWarning,
        stacklevel=2,
    )
    return check_multi_party_authorization_structure(mpa, policy)


# ── Configuration errors and small helpers ──


class MultiPartyConfigError(ValueError):
    """A policy set, or what the executor states, that cannot be used. `code` is one of
    spec/profiles/multi-party § 5.3 (CONFIG_*)."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(f"{code}: {message}")
        self.code = code


def _fail(code: str, message: str) -> NoReturn:
    raise MultiPartyConfigError(code, message)


def _bounded(value: Any, maximum: int) -> bool:
    """A string of 1 to `maximum` Unicode code points."""
    return isinstance(value, str) and 1 <= len(value) <= maximum


_LARGEST_INTEGER = 2**53 - 1
_RANGE = "-(2^53 - 1) to 2^53 - 1"


def _is_profile_data(value: Any) -> bool:
    """Whether the numbers of `value` are numbers of the profile (§ 3): the integers from
    -(2^53 - 1) to 2^53 - 1. dcp-jcs-v1 takes larger ones, and what it makes of them is not one
    thing: this SDK writes every digit, others write the nearest binary64, which is also what
    most parsers read. Two numbers would be signed, compared and verified as one. What is not
    JSON at all is left for the canonicalization to refuse."""
    if isinstance(value, bool):
        return True
    if isinstance(value, int):
        return -_LARGEST_INTEGER <= value <= _LARGEST_INTEGER
    if isinstance(value, float):
        return value.is_integer() and abs(value) <= _LARGEST_INTEGER
    if isinstance(value, dict):
        return all(_is_profile_data(member) for member in value.values())
    if isinstance(value, (list, tuple)):
        return all(_is_profile_data(member) for member in value)
    return True


def _canonical(value: Any) -> str | None:
    """The dcp-jcs-v1 form, or None when the value is not data of the profile or is not
    representable."""
    try:
        return canonicalize_v2(value) if _is_profile_data(value) else None
    except Exception:
        return None


def _snapshot(value: Any) -> Any:
    """`value` with dicts, lists and tuples of its own: the JSON it is, read once. Anything
    else is kept as it is."""
    if isinstance(value, dict):
        return {key: _snapshot(member) for key, member in value.items()}
    if isinstance(value, (list, tuple)):
        members = [_snapshot(member) for member in value]
        return members if isinstance(value, list) else tuple(members)
    return value


def _unknown_field(value: dict[Any, Any], allowed: tuple[str, ...], where: str) -> None:
    for key in value:
        if key not in allowed:
            _fail("CONFIG_UNKNOWN_FIELD", f"{where}: unknown field {_printable(key)}")


# ── Operator policy (§ 2.3) ──

_LOADER = object()


@dataclass(frozen=True)
class MultiPartyOperationRule:
    """What the operator asks of one operation on one target."""

    required_parties: int
    allowed_roles: tuple[str, ...]
    required_roles: tuple[str, ...]


@dataclass(frozen=True)
class MultiPartySubject:
    """A target: `parties` maps each party_id to the role the operator gives it."""

    parties: Mapping[str, str]
    operations: Mapping[str, MultiPartyOperationRule]


class MultiPartyPolicyStore:
    """A validated policy set: create it with create_multi_party_policy_store.

    `version` is the policy_set_version; `subjects` maps each target to its parties and
    the operations they may authorize. Immutable.
    """

    __slots__ = ("version", "audience", "max_validity_seconds", "subjects")
    version: str
    audience: str
    max_validity_seconds: int
    subjects: Mapping[str, MultiPartySubject]

    def __init__(self, loader: object, version: str, audience: str, max_validity_seconds: int, subjects: Mapping[str, MultiPartySubject]) -> None:
        if loader is not _LOADER:
            raise TypeError("create a MultiPartyPolicyStore with create_multi_party_policy_store")
        object.__setattr__(self, "version", version)
        object.__setattr__(self, "audience", audience)
        object.__setattr__(self, "max_validity_seconds", max_validity_seconds)
        object.__setattr__(self, "subjects", subjects)

    def __setattr__(self, name: str, value: Any) -> None:
        raise AttributeError("a MultiPartyPolicyStore is immutable")

    def __delattr__(self, name: str) -> None:
        raise AttributeError("a MultiPartyPolicyStore is immutable")

    def __repr__(self) -> str:
        return f"MultiPartyPolicyStore(version={self.version!r}, subjects={len(self.subjects)})"


def _role_list(value: Any, where: str) -> tuple[str, ...]:
    if not isinstance(value, list) or any(not isinstance(r, str) or r not in _ROLES for r in value) or len(set(value)) != len(value):
        _fail("CONFIG_INVALID_VALUE", f"{where} must list roles, each once")
    return tuple(value)


def create_multi_party_policy_store(policy_set: Any) -> MultiPartyPolicyStore:
    """Validate a policy set (schemas/v2/multi_party_policy_set.schema.json,
    spec/profiles/multi-party § 2.3) and return it as a store.

    Raises MultiPartyConfigError on the first problem found. There are no defaults: an
    operation the operator does not list for a target is not authorized.
    """
    if isinstance(policy_set, MultiPartyPolicyStore):
        return policy_set
    if not isinstance(policy_set, dict):
        _fail("CONFIG_INVALID_VALUE", "the policy set must be an object")
    _unknown_field(policy_set, ("policy_set_version", "profile", "audience", "max_validity_seconds", "subjects"), "policy set")
    version = policy_set.get("policy_set_version")
    if not isinstance(version, str) or version == "":
        _fail("CONFIG_INVALID_VALUE", "policy_set_version must be a non-empty string")
    if policy_set.get("profile") != MPA_V1:
        _fail("CONFIG_INVALID_VALUE", f"profile must be {MPA_V1}")
    audience = policy_set.get("audience")
    if not _bounded(audience, _MAX_IDENTIFIER):
        _fail("CONFIG_INVALID_VALUE", "audience must be a string of 1 to 256 characters")
    seconds = policy_set.get("max_validity_seconds")
    if not _is_integer(seconds) or not 1 <= seconds <= MPA_V1_MAX_VALIDITY_SECONDS:
        _fail("CONFIG_INVALID_VALUE", f"max_validity_seconds must be an integer from 1 to {MPA_V1_MAX_VALIDITY_SECONDS}")
    if not isinstance(policy_set.get("subjects"), list):
        _fail("CONFIG_INVALID_VALUE", "subjects must be an array")

    subjects: dict[str, MultiPartySubject] = {}
    for i, subject in enumerate(policy_set["subjects"]):
        where = f"subjects[{i}]"
        if not isinstance(subject, dict):
            _fail("CONFIG_INVALID_VALUE", f"{where} must be an object")
        _unknown_field(subject, ("target", "parties", "operations"), where)
        target = subject.get("target")
        if not _bounded(target, _MAX_IDENTIFIER):
            _fail("CONFIG_INVALID_VALUE", f"{where}.target must be a string of 1 to 256 characters")
        if target in subjects:
            _fail("CONFIG_MPA_DUPLICATE", f"{where}: target {_printable(target)} is listed twice")
        if not isinstance(subject.get("parties"), list) or len(subject["parties"]) == 0:
            _fail("CONFIG_INVALID_VALUE", f"{where}.parties must be a non-empty array")

        parties: dict[str, str] = {}
        for j, party in enumerate(subject["parties"]):
            at = f"{where}.parties[{j}]"
            if not isinstance(party, dict):
                _fail("CONFIG_INVALID_VALUE", f"{at} must be an object")
            _unknown_field(party, ("party_id", "role"), at)
            party_id, role = party.get("party_id"), party.get("role")
            if not isinstance(party_id, str) or party_id == "":
                _fail("CONFIG_INVALID_VALUE", f"{at}.party_id must be a non-empty string")
            if not isinstance(role, str) or role not in _ROLES:
                _fail("CONFIG_INVALID_VALUE", f"{at}.role {_printable(role)} is not a role")
            if party_id in parties:
                _fail("CONFIG_MPA_DUPLICATE", f"{at}: party {_printable(party_id)} is listed twice for the target")
            parties[party_id] = role

        if not isinstance(subject.get("operations"), dict):
            _fail("CONFIG_INVALID_VALUE", f"{where}.operations must be an object")
        operations: dict[str, MultiPartyOperationRule] = {}
        for operation, rule in subject["operations"].items():
            at = f"{where}.operations.{_printable(operation)}"
            if operation not in _OPERATIONS:
                _fail("CONFIG_INVALID_VALUE", f"{at} is not an operation")
            if not isinstance(rule, dict):
                _fail("CONFIG_INVALID_VALUE", f"{at} must be an object")
            _unknown_field(rule, ("required_parties", "allowed_roles", "required_roles"), at)
            required = rule.get("required_parties")
            if not _is_integer(required) or required < 2:
                _fail("CONFIG_INVALID_VALUE", f"{at}.required_parties must be an integer of at least 2")
            allowed = _role_list(rule.get("allowed_roles"), f"{at}.allowed_roles")
            required_roles = _role_list(rule.get("required_roles"), f"{at}.required_roles")
            if not allowed:
                _fail("CONFIG_INVALID_VALUE", f"{at}.allowed_roles must not be empty")
            if any(r not in allowed for r in required_roles):
                _fail("CONFIG_INVALID_VALUE", f"{at}.required_roles must be among allowed_roles")
            eligible = [role for role in parties.values() if role in allowed]
            if required > len(eligible):
                _fail("CONFIG_MPA_UNSATISFIABLE", f"{at}: {int(required)} parties are required and {len(eligible)} have an allowed role")
            if any(r not in eligible for r in required_roles):
                _fail("CONFIG_MPA_UNSATISFIABLE", f"{at}: no party holds a required role")
            operations[operation] = MultiPartyOperationRule(int(required), allowed, required_roles)
        subjects[target] = MultiPartySubject(MappingProxyType(parties), MappingProxyType(operations))

    return MultiPartyPolicyStore(_LOADER, version, audience, int(seconds), MappingProxyType(subjects))


# ── The request and the signing side (§ 2.2) ──

_EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)


def _instant(millis: int) -> str:
    """An epoch-millisecond instant as RFC 3339 in UTC, with milliseconds."""
    t = _EPOCH + timedelta(milliseconds=millis)
    return f"{t.strftime('%Y-%m-%dT%H:%M:%S')}.{t.microsecond // 1000:03d}Z"


def create_multi_party_request(
    *,
    target: str,
    audience: str,
    validity_seconds: int,
    parameters: dict[str, Any] | None = None,
    issued_at_ms: int | None = None,
    request_id: str | None = None,
) -> dict[str, Any]:
    """Build the operation_payload every party signs: {request, parameters}.

    `target` is the object of the operation, as the operator's policy set names it;
    `audience` is the verifier that may act on the authorization; `validity_seconds` is
    1 to 86400 (the operator may allow less). `issued_at_ms` defaults to the system
    clock and `request_id` to 16 random bytes. Raises MultiPartyConfigError on a request
    the profile would refuse.
    """
    parameters = {} if parameters is None else parameters
    if issued_at_ms is None:
        issued_at_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
    if request_id is None:
        request_id = f"mpa:{secrets.token_hex(16)}"
    if not _bounded(target, _MAX_IDENTIFIER):
        _fail("CONFIG_INVALID_VALUE", "target must be a string of 1 to 256 characters")
    if not _bounded(audience, _MAX_IDENTIFIER):
        _fail("CONFIG_INVALID_VALUE", "audience must be a string of 1 to 256 characters")
    if not _bounded(request_id, _MAX_REQUEST_ID):
        _fail("CONFIG_INVALID_VALUE", "request_id must be a string of 1 to 128 characters")
    if not _is_integer(validity_seconds) or not 1 <= validity_seconds <= MPA_V1_MAX_VALIDITY_SECONDS:
        _fail("CONFIG_INVALID_VALUE", f"validity_seconds must be an integer from 1 to {MPA_V1_MAX_VALIDITY_SECONDS}")
    if not _is_integer(issued_at_ms):
        _fail("CONFIG_INVALID_VALUE", "issued_at_ms must be an integer number of milliseconds")
    if not isinstance(parameters, dict) or _canonical(parameters) is None:
        _fail("CONFIG_INVALID_VALUE", f"parameters must be an object of JSON data with integers within {_RANGE}")
    issued = int(issued_at_ms)
    return {
        "request": {
            "profile": MPA_V1,
            "request_id": request_id,
            "target": target,
            "audience": audience,
            "issued_at": _instant(issued),
            "expires_at": _instant(issued + int(validity_seconds) * 1000),
        },
        "parameters": parameters,
    }


def _signed_bytes(operation: Any, operation_payload: Any, party_id: Any, role: Any) -> bytes:
    return canonicalize_v2(
        {"operation": operation, "operation_payload": operation_payload, "party_id": party_id, "role": role}
    ).encode("utf-8")


async def create_party_authorization(
    registry: AlgorithmRegistry,
    operation: str,
    operation_payload: dict[str, Any],
    party_id: str,
    role: str,
    classical_key: CompositeKeyInfo,
    pq_key: CompositeKeyInfo,
) -> dict[str, Any]:
    """One party's authorization: its composite signature over
    {operation, operation_payload, party_id, role}."""
    sig = await composite_sign(registry, _CONTEXT, _signed_bytes(operation, operation_payload, party_id, role), classical_key, pq_key)
    return {"party_id": party_id, "role": role, "composite_sig": dict(sig)}


def build_multi_party_authorization(
    operation: str,
    operation_payload: dict[str, Any],
    authorizations: list[dict[str, Any]],
    required_parties: int = 2,
) -> dict[str, Any]:
    """Put the parties' authorizations in one record. `required_parties` fills the
    schema's field: it is not signed and no evaluation reads it."""
    return {
        "type": "multi_party_authorization",
        "operation": operation,
        "operation_payload": operation_payload,
        "required_parties": required_parties,
        "authorizations": authorizations,
    }


# ── Evaluation: verification and authorization (§ 4) ──

_KID = re.compile(r"[0-9a-f]{32}")
_SIG_B64 = re.compile(r"[A-Za-z0-9+/]+={0,2}")
_TOP = {"type", "operation", "operation_payload", "required_parties", "authorizations"}
_REQUEST = {"profile", "request_id", "target", "audience", "issued_at", "expires_at"}


def _is_signature_part(value: Any) -> bool:
    return (
        isinstance(value, dict)
        and set(value) == {"alg", "kid", "sig_b64"}
        and isinstance(value["alg"], str)
        and isinstance(value["kid"], str)
        and _KID.fullmatch(value["kid"]) is not None
        and isinstance(value["sig_b64"], str)
        and 8 <= len(value["sig_b64"]) <= 66476
        and _SIG_B64.fullmatch(value["sig_b64"]) is not None
    )


def _conforms_to_schema(record: Any) -> bool:
    """schemas/v2/multi_party_authorization.schema.json, by hand."""
    if not isinstance(record, dict) or set(record) != _TOP:
        return False
    if record["type"] != "multi_party_authorization" or not isinstance(record["operation"], str) or record["operation"] not in _OPERATIONS:
        return False
    if not isinstance(record["operation_payload"], dict):
        return False
    if not _is_integer(record["required_parties"]) or record["required_parties"] < 2:
        return False
    if not isinstance(record["authorizations"], list) or len(record["authorizations"]) == 0:
        return False
    for auth in record["authorizations"]:
        if not isinstance(auth, dict) or set(auth) != {"party_id", "role", "composite_sig"}:
            return False
        sig = auth["composite_sig"]
        if not isinstance(auth["party_id"], str) or not isinstance(auth["role"], str) or auth["role"] not in _ROLES:
            return False
        if not isinstance(sig, dict) or set(sig) != {"classical", "pq", "binding"}:
            return False
        if not _is_signature_part(sig["classical"]) or not (sig["pq"] is None or _is_signature_part(sig["pq"])):
            return False
        if not isinstance(sig["binding"], str) or sig["binding"] not in ("pq_over_classical", "classical_only"):
            return False
    return True


def _conforms_to_request(payload: dict[str, Any]) -> bool:
    """schemas/v2/multi_party_request.schema.json, by hand, with the instants parsed as
    everywhere else."""
    request = payload.get("request")
    return (
        set(payload) == {"request", "parameters"}
        and isinstance(payload["parameters"], dict)
        and isinstance(request, dict)
        and set(request) == _REQUEST
        and request["profile"] == MPA_V1
        and _bounded(request["request_id"], _MAX_REQUEST_ID)
        and _bounded(request["target"], _MAX_IDENTIFIER)
        and _bounded(request["audience"], _MAX_IDENTIFIER)
        and rfc3339_epoch_ms(request["issued_at"]) is not None
        and rfc3339_epoch_ms(request["expires_at"]) is not None
    )


def _structure_code(record: Any) -> str | None:
    """The first structural problem of a record, in the order of § 4, or None."""
    if not _conforms_to_schema(record):
        return "MPA_SCHEMA_INVALID"
    payload = record["operation_payload"]
    if "request" not in payload:
        return "MPA_REQUEST_MISSING"
    if not _conforms_to_request(payload):
        return "MPA_REQUEST_INVALID"
    if _canonical(payload) is None:
        return "MPA_NOT_REPRESENTABLE"
    if len(record["authorizations"]) > MPA_V1_MAX_AUTHORIZATIONS:
        return "MPA_TOO_MANY_AUTHORIZATIONS"
    return None


def _valid_expected(expected: Any) -> tuple[str, str, str]:
    """What the executor states must itself be well formed: a mistake here is the
    caller's, not a verdict on the record."""
    if not isinstance(expected, dict) or any(k not in ("operation", "target", "parameters") for k in expected):
        _fail("CONFIG_INVALID_VALUE", "expected must be {operation, target, parameters}")
    operation, target = expected.get("operation"), expected.get("target")
    if not isinstance(operation, str) or operation not in _OPERATIONS:
        _fail("CONFIG_INVALID_VALUE", f"expected.operation {_printable(operation)} is not an operation")
    if not _bounded(target, _MAX_IDENTIFIER):
        _fail("CONFIG_INVALID_VALUE", "expected.target must be a string of 1 to 256 characters")
    parameters = _canonical(expected.get("parameters")) if isinstance(expected.get("parameters"), dict) else None
    if parameters is None:
        _fail("CONFIG_INVALID_VALUE", f"expected.parameters must be an object of JSON data with integers within {_RANGE}")
    return operation, target, parameters


def _key_code(key: TrustedKey | None, alg: str, now: int) -> str | None:
    """Why a trusted key cannot count at `now`, the first that applies, or None."""
    if key is None or key.alg != alg:
        return "MPA_KEY_NOT_ANCHORED"
    if key.status == "revoked":
        return "MPA_KEY_REVOKED"
    if key.status == "expired" or (key.expires_at is not None and key.expires_at < now):
        return "MPA_KEY_EXPIRED"
    if key.not_before is not None and key.not_before > now:
        return "MPA_KEY_NOT_YET_VALID"
    return None


async def evaluate_multi_party_authorization(
    record: Any,
    registry: AlgorithmRegistry,
    *,
    policy: Any,
    trust: Any,
    expected: Any,
    now_ms: int | None = None,
) -> dict[str, Any]:
    """Decide whether a multi-party authorization authorizes what the executor is about
    to do (spec/profiles/multi-party § 4).

    `record` is the parsed JSON of the record. `policy` is the operator's policy set and
    `trust` the operator's principal trust set, each as JSON or loaded; neither is ever
    taken from the record or the request. `expected` is {operation, target, parameters}:
    what the executor is about to do. `now_ms` defaults to the system clock.

    Strict: any authorization that fails refuses the record. A phase that adds a code
    stops the next ones, so no signature of a malformed, foreign or expired request is
    verified. Raises AdmissionConfigError or MultiPartyConfigError when the operator's
    configuration or `expected` is unusable.
    """
    policy_store = create_multi_party_policy_store(policy)
    trust_store: PrincipalTrustStore = create_principal_trust_store(trust)
    expected_operation, expected_target, expected_parameters = _valid_expected(expected)
    if now_ms is None:
        now_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
    if not _is_integer(now_ms):
        _fail("CONFIG_INVALID_VALUE", "now_ms must be an integer number of milliseconds")
    now = int(now_ms)

    errors: list[dict[str, str]] = []
    result: dict[str, Any] = {
        "profile": MPA_V1,
        "structure": "valid",
        "verification": "not_evaluated",
        "authorized": False,
        "operation": None,
        "target": None,
        "request_id": None,
        "expires_at": None,
        "parties": [],
        "parties_counted": None,
        "required_parties": None,
        "policy_set_version": policy_store.version,
        "trust_set_version": trust_store.version,
        "errors": errors,
    }

    def add(code: str, message: str) -> None:
        # Bounded: an identifier from the record is quoted in it, and escaping can make it long.
        errors.append({"code": code, "message": message if len(message) <= _MAX_MESSAGE else f"{message[: _MAX_MESSAGE - 1]}…"})

    # 1. Structure: the first failure, and nothing else is read. From here on `record` is the
    # evaluation's own copy: it waits on the signatures, and what the caller does to its
    # object meanwhile must not count.
    try:
        record = _snapshot(record)
    except RecursionError:  # nested too deeply to copy
        malformed = _structure_code(record) or "MPA_NOT_REPRESENTABLE"
    else:
        malformed = _structure_code(record)
    if malformed is not None:
        result["structure"] = "invalid"
        add(malformed, "the record is not a well-formed mpa-v1 multi-party authorization")
        return result
    operation = record["operation"]
    payload = record["operation_payload"]
    request, parameters = payload["request"], payload["parameters"]
    authorizations = record["authorizations"]
    result.update(
        operation=operation,
        target=request["target"],
        request_id=request["request_id"],
        expires_at=request["expires_at"],
        parties=[{"party_id": a["party_id"], "role": a["role"], "verified": None} for a in authorizations],
    )

    # 2. Binding: this operation, on this target, with these parameters, for this verifier, now.
    if operation != expected_operation:
        add("MPA_OPERATION_MISMATCH", f"the record authorizes {operation}, not {expected_operation}")
    if request["target"] != expected_target:
        add("MPA_TARGET_MISMATCH", f"the request is for target {_printable(request['target'])}")
    if _canonical(parameters) != expected_parameters:
        add("MPA_PARAMETERS_MISMATCH", "the signed parameters are not the ones about to be used")
    if request["audience"] != policy_store.audience:
        add("MPA_AUDIENCE_MISMATCH", f"the request is for audience {_printable(request['audience'])}")
    issued, expires = rfc3339_epoch_ms(request["issued_at"]), rfc3339_epoch_ms(request["expires_at"])
    assert issued is not None and expires is not None  # the structure phase parsed them
    if issued > now + SESSION_CLOCK_SKEW_MS:
        add("MPA_NOT_YET_VALID", "issued_at is in the future")
    if expires <= now:
        add("MPA_EXPIRED", "expires_at has passed")
    if expires <= issued or expires - issued > policy_store.max_validity_seconds * 1000:
        add("MPA_VALIDITY_INVALID", f"the validity window must be positive and at most {policy_store.max_validity_seconds} seconds")
    subject = policy_store.subjects.get(request["target"])
    rule = subject.operations.get(operation) if subject is not None else None
    if subject is None:
        add("MPA_TARGET_UNKNOWN", f"the operator has no parties for target {_printable(request['target'])}")
    elif rule is None:
        add("MPA_OPERATION_NOT_ALLOWED", f"the operator does not list {operation} for the target")
    if rule is not None:
        result["required_parties"] = rule.required_parties
    if errors or subject is None or rule is None:
        return result

    # 3. Parties: distinct parties of the target, each with the role the operator gives it.
    seen: set[str] = set()
    for auth in authorizations:
        party_id = auth["party_id"]
        role = subject.parties.get(party_id)
        if role is None:
            add("MPA_PARTY_UNKNOWN", f"{_printable(party_id)} is not a party of the target")
            continue
        if party_id in seen:
            add("MPA_PARTY_DUPLICATE", f"{_printable(party_id)} is listed more than once")
        seen.add(party_id)
        if auth["role"] != role:
            add("MPA_ROLE_MISMATCH", f"{_printable(party_id)} signed as {auth['role']}; the operator has it as {role}")
        if role not in rule.allowed_roles:
            add("MPA_ROLE_NOT_ALLOWED", f"the role {role} may not authorize {operation}")
    if errors:
        return result

    # 4. Verification: every authorization is a hybrid signature, by the party's trusted keys, over this request.
    classical_algs = DEFAULT_VERIFIER_POLICY["accepted_classical_algs"]
    pq_algs = DEFAULT_VERIFIER_POLICY["accepted_pq_algs"]
    counted = 0
    for i, auth in enumerate(authorizations):
        before = len(errors)
        party_id, sig = auth["party_id"], auth["composite_sig"]
        classical, pq = sig["classical"], sig["pq"]
        if sig["binding"] != "pq_over_classical" or pq is None or classical["alg"] not in classical_algs or pq["alg"] not in pq_algs:
            add("MPA_HYBRID_REQUIRED", f"{_printable(party_id)}: a classical and a post-quantum signature are both required")
        else:
            trusted = trust_store.principals.get(party_id) or {}
            classical_key, pq_key = trusted.get(classical["kid"]), trusted.get(pq["kid"])
            for part, key in ((classical, classical_key), (pq, pq_key)):
                code = _key_code(key, part["alg"], now)
                if code is not None:
                    add(code, f"{_printable(party_id)}: key {part['kid']} cannot count")
            if len(errors) == before:
                assert classical_key is not None and pq_key is not None
                valid = False
                try:
                    valid = (
                        _canonical_b64_bytes(classical["sig_b64"]) is not None
                        and _canonical_b64_bytes(pq["sig_b64"]) is not None
                        and (
                            await composite_verify(
                                registry,
                                _CONTEXT,
                                _signed_bytes(operation, payload, party_id, auth["role"]),
                                sig,
                                base64.b64encode(classical_key.key_bytes).decode("ascii"),
                                base64.b64encode(pq_key.key_bytes).decode("ascii"),
                            )
                        ).valid
                    )
                except Exception:
                    valid = False  # an algorithm the registry cannot verify, or a malformed signature
                if not valid:
                    add("MPA_SIGNATURE_INVALID", f"{_printable(party_id)}: the signature does not verify")
        verified = len(errors) == before
        result["parties"][i]["verified"] = verified
        if verified:
            counted += 1
    result["parties_counted"] = counted
    if errors:
        result["verification"] = "failed"
        return result
    result["verification"] = "verified"

    # 5. Decision: enough parties, and the roles the operator requires.
    if counted < rule.required_parties:
        add("MPA_THRESHOLD_NOT_MET", f"{counted} parties authorized; the operator requires {rule.required_parties}")
    roles = {subject.parties.get(a["party_id"]) for a in authorizations}
    for role in rule.required_roles:
        if role not in roles:
            add("MPA_REQUIRED_ROLE_MISSING", f"no {role} authorized the operation")
    result["authorized"] = not errors
    return result
