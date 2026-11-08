"""
Mandate acknowledgment (opt-in, MP-02 F4): DCP-09 § 3.3 steps 4–6. The delegate agent signs a separate, versioned
record (format dcp09-mandate-ack-v1, context DCP-AI.v2.MandateAcknowledgment) that binds one mandate of a chain, the
chain up to it and the agent's awareness threshold. Python port of the TypeScript SDK's core/mandate-acknowledgment.ts;
design: docs/reviews/mp02-acknowledgment-design.md v0.2.

evaluate_delegation_activation_v2 takes one snapshot of the evidence, the acknowledgments, the thresholds and the
configuration, runs the delegated admission (F2) over it at one instant, and evaluates the acknowledgments only when
that composition is admitted, with the agents, keys, policy, mode and revocation snapshot the composition verified.
Nothing is taken from the caller as a result, key or digest. An active delegation authorizes no action:
action_authorized is always False, and neither authority_scope nor threshold_rules is evaluated. A valid signature
shows the agent's signed declaration, not its understanding.

Existing APIs are unchanged: admit_delegated_bundle_v2 still reports activation "not_evaluated".
"""

from __future__ import annotations

import hashlib
import re
import time
from datetime import datetime, timezone
from typing import Any, Callable

from dcp_ai.v2._schema_v2 import is_schema_date_time
from dcp_ai.v2.admission import _printable
from dcp_ai.v2.canonicalize import canonicalize_v2
from dcp_ai.v2.composite_ops import CompositeKeyInfo, composite_sign, composite_verify
from dcp_ai.v2.crypto_registry import AlgorithmRegistry
from dcp_ai.v2.delegated_admission import (
    _bounded,
    _compose_delegated,
    _InputError,
    _json_copy,
    _mandate_preflight,
    _signature_slot_error,
    _take_delegated_snapshot,
    _used_key_error,
)
from dcp_ai.v2.delegation import _signer_key
from dcp_ai.v2.domain_separation import DCP_CONTEXTS, MANDATE_ACKNOWLEDGMENT_CONTEXT
from dcp_ai.v2.session_nonce import rfc3339_epoch_ms
from dcp_ai.v2.verify import SESSION_CLOCK_SKEW_MS

__all__ = [
    "MANDATE_ACKNOWLEDGMENT_CONTEXT",
    "MANDATE_ACKNOWLEDGMENT_FORMAT",
    "create_mandate_acknowledgment",
    "evaluate_delegation_activation_v2",
]

MANDATE_ACKNOWLEDGMENT_FORMAT = "dcp09-mandate-ack-v1"

# ── Form (design § 2 and § 2.1) ──

# The members of schemas/v2/mandate_acknowledgment.schema.json, all required; checked by the parity test.
ACK_FIELDS = (
    "dcp_version", "acknowledgment_format", "acknowledgment_id", "mandate_id", "mandate_hash", "chain_hash",
    "session_nonce", "human_id", "agent_id", "awareness_threshold_id", "awareness_threshold_hash", "acknowledged_at",
    "composite_sig",
)
# The members of schemas/v2/awareness_threshold.schema.json, all required.
THRESHOLD_FIELDS = ("dcp_version", "threshold_id", "session_nonce", "agent_id", "human_id", "threshold_rules", "timestamp", "composite_sig")
RULE_FIELDS = ("dimension", "operator", "value", "action_if_triggered")
RULE_OPERATORS = ("gt", "lt", "gte", "lte", "eq")
RULE_ACTIONS = ("notify", "escalate", "block")

_NONCE = re.compile(r"[0-9a-f]{64}")
_DIGEST = re.compile(r"sha256:[0-9a-f]{64}")
_PQ_ALGS = ("ml-dsa-65", "slh-dsa-192f")
_MAX_SAFE = 2**53 - 1


def _is_scalar_string(s: str) -> bool:
    """A str is code points; Unicode scalar values exclude the surrogates U+D800–U+DFFF (json.loads makes them)."""
    return not any(0xD800 <= ord(c) <= 0xDFFF for c in s)


def _ill_formed_string(v: Any, where: str) -> str | None:
    if type(v) is str:
        return None if _is_scalar_string(v) else where
    if type(v) is list:
        for i, x in enumerate(v):
            bad = _ill_formed_string(x, f"{where}[{i}]")
            if bad:
                return bad
    elif type(v) is dict:
        for k, x in v.items():
            if type(k) is str and not _is_scalar_string(k):
                return f"{where} member name"
            bad = _ill_formed_string(x, f"{where}.{k}")
            if bad:
                return bad
    return None


def _members_error(v: dict[str, Any], fields: tuple[str, ...]) -> str | None:
    for key in v:
        if key not in fields:
            return f"unknown member {_printable(key)}"
    for key in fields:
        if key not in v:
            return f"missing {key}"
    return None


def _is_id(v: Any) -> bool:
    return type(v) is str and len(v) >= 6  # len counts code points, as the schema's minLength


def _is_instant(v: Any) -> bool:
    return type(v) is str and is_schema_date_time(v) and rfc3339_epoch_ms(v) is not None


def _is_safe_integer_value(v: Any) -> bool:
    """design § 2.1: an integer value of ±(2^53 − 1); an integral float is admitted; a bool is not a number."""
    if type(v) is int:
        return -_MAX_SAFE <= v <= _MAX_SAFE
    if type(v) is float:
        return v.is_integer() and abs(v) <= _MAX_SAFE
    return False


def _acknowledgment_fields_error(a: dict[str, Any], fields: tuple[str, ...]) -> str | None:
    members = _members_error(a, fields)
    if members:
        return members
    text = _ill_formed_string(a, "acknowledgment")
    if text:
        return f"{text} is not Unicode scalar values (lone surrogate)"
    if a.get("dcp_version") != "2.0":
        return 'dcp_version must be "2.0"'
    if a.get("acknowledgment_format") != MANDATE_ACKNOWLEDGMENT_FORMAT:
        return f'acknowledgment_format must be "{MANDATE_ACKNOWLEDGMENT_FORMAT}"'
    for f in ("acknowledgment_id", "mandate_id", "human_id", "agent_id", "awareness_threshold_id"):
        if not _is_id(a.get(f)):
            return f"{f} must be a string of at least 6 code points"
    for f in ("mandate_hash", "chain_hash", "awareness_threshold_hash"):
        if type(a.get(f)) is not str or not _DIGEST.fullmatch(a[f]):
            return f"{f} is not sha256: and 64 lowercase hex digits"
    if type(a.get("session_nonce")) is not str or not _NONCE.fullmatch(a["session_nonce"]):
        return "session_nonce is not 64 lowercase hex digits"
    if not _is_instant(a.get("acknowledged_at")):
        return "acknowledged_at is not an RFC 3339 date-time"
    return None


def _acknowledgment_form_error(a: Any) -> str | None:
    """The first defect of an acknowledgment's form, in the fixed order of design § 2, or None."""
    if type(a) is not dict:
        return "not an object"
    return _acknowledgment_fields_error(a, ACK_FIELDS) or _signature_slot_error(a.get("composite_sig"), "composite_sig")


def _threshold_form_error(u: Any) -> str | None:
    """The first defect of an awareness threshold's form, with the domain of design § 2.1, or None."""
    if type(u) is not dict:
        return "not an object"
    members = _members_error(u, THRESHOLD_FIELDS)
    if members:
        return members
    text = _ill_formed_string(u, "threshold")
    if text:
        return f"{text} is not Unicode scalar values (lone surrogate)"
    if u.get("dcp_version") != "2.0":
        return 'dcp_version must be "2.0"'
    for f in ("threshold_id", "agent_id", "human_id"):
        if not _is_id(u.get(f)):
            return f"{f} must be a string of at least 6 code points"
    if type(u.get("session_nonce")) is not str or not _NONCE.fullmatch(u["session_nonce"]):
        return "session_nonce is not 64 lowercase hex digits"
    if not _is_instant(u.get("timestamp")):
        return "timestamp is not an RFC 3339 date-time"
    rules = u.get("threshold_rules")
    if type(rules) is not list or not rules:
        return "threshold_rules must be a non-empty array"
    for i, r in enumerate(rules):
        at = f"threshold_rules[{i}]"
        if type(r) is not dict:
            return f"{at} is not an object"
        m = _members_error(r, RULE_FIELDS)
        if m:
            return f"{at}: {m}"
        if type(r.get("dimension")) is not str or len(r["dimension"]) < 1:
            return f"{at}.dimension must be a non-empty string"
        if r.get("operator") not in RULE_OPERATORS or type(r.get("operator")) is not str:
            return f"{at}.operator is not gt, lt, gte, lte or eq"
        if not _is_safe_integer_value(r.get("value")):
            return f"{at}.value is not an integer of ±(2^53 − 1)"
        if r.get("action_if_triggered") not in RULE_ACTIONS or type(r.get("action_if_triggered")) is not str:
            return f"{at}.action_if_triggered is not notify, escalate or block"
    slot = _signature_slot_error(u.get("composite_sig"), "composite_sig")
    if slot:
        return slot
    try:
        canonicalize_v2(_unsigned(u))
    except (TypeError, ValueError) as exc:
        return f"not canonicalizable under dcp-jcs-v1: {exc}"
    return None


# ── Hashes (design § 2) ──


def _digest(v: Any) -> str:
    return "sha256:" + hashlib.sha256(canonicalize_v2(v).encode("utf-8")).hexdigest()


def _unsigned(record: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in record.items() if k != "composite_sig"}


def _mandate_hash(mandate: dict[str, Any]) -> str:
    """The mandate without human_composite_sig and delegator_composite_sig (DCP-09 § 3.4)."""
    return _digest({k: v for k, v in mandate.items() if k not in ("human_composite_sig", "delegator_composite_sig")})


def _chain_hashes(mandates: list[dict[str, Any]]) -> list[str]:
    """chain_hash of each mandate: the digest of the array of mandate_hash from the root to it."""
    hashes = [_mandate_hash(m) for m in mandates]
    return [_digest(hashes[: i + 1]) for i in range(len(hashes))]


def _threshold_hash(threshold: dict[str, Any]) -> str:
    return _digest(_unsigned(threshold))


def _instant(v: Any) -> int:
    ms = rfc3339_epoch_ms(v)
    assert ms is not None
    return ms


def _utf8(v: Any) -> bytes:
    return canonicalize_v2(v).encode("utf-8")


# ── Creation (design § 3.2) ──


def _copy_key(key: Any, component: str) -> CompositeKeyInfo:
    if not isinstance(key, CompositeKeyInfo) or not all(type(getattr(key, f, None)) is str for f in CompositeKeyInfo._fields):
        raise TypeError(f"create_mandate_acknowledgment: {component}_key must be a CompositeKeyInfo of strings")
    return CompositeKeyInfo(kid=key.kid, alg=key.alg, secret_key_b64=key.secret_key_b64, public_key_b64=key.public_key_b64)


def _copy_or_type_error(value: Any, where: str) -> Any:
    try:
        return _json_copy(value, where)
    except _InputError as exc:
        raise TypeError(f"create_mandate_acknowledgment: {exc}") from None
    except RecursionError:
        raise TypeError(f"create_mandate_acknowledgment: {where} is nested too deeply") from None


async def create_mandate_acknowledgment(
    registry: AlgorithmRegistry,
    classical_key: CompositeKeyInfo,
    pq_key: CompositeKeyInfo,
    *,
    mandate_chain: Any,
    awareness_threshold: Any,
    acknowledgment_id: str,
    acknowledged_at: str | None = None,
) -> dict[str, Any]:
    """Sign the acknowledgment of the last mandate of `mandate_chain`, linked to `awareness_threshold`. Computes
    mandate_hash, chain_hash and awareness_threshold_hash from the inputs; takes no digest from the caller (an
    unknown keyword is a TypeError). The arguments and the keys, secret key strings included, are copied before
    the first await; no input is modified. Raises TypeError for an argument of the wrong type and ValueError for an
    acknowledgment that could never verify. Messages name kids, never a secret."""

    def fail(message: str) -> None:
        raise ValueError(f"create_mandate_acknowledgment: {message}")

    classical = _copy_key(classical_key, "classical")
    pq = _copy_key(pq_key, "pq")
    if classical.alg != "ed25519":
        fail("classical_key must be ed25519")
    if pq.alg not in _PQ_ALGS:
        fail("pq_key must be ml-dsa-65 or slh-dsa-192f")
    # The public metadata the signature slot will carry: a canonical public key of the algorithm's size, and its
    # derived kid (V2-13).
    for component, key in (("classical", classical), ("pq", pq)):
        error = _used_key_error({"kid": key.kid, "alg": key.alg, "public_key_b64": key.public_key_b64}, key.kid, key.alg, f"{component}_key")
        if error:
            fail(error)

    chain = _copy_or_type_error(mandate_chain, "mandate_chain")
    if type(chain) is not list or not chain:
        raise TypeError("create_mandate_acknowledgment: mandate_chain must be a non-empty list")
    for i, m in enumerate(chain):
        errors = _mandate_preflight(m, i)
        if errors:
            fail(errors[0])
        if i > 0 and m.get("parent_mandate_id") != chain[i - 1].get("mandate_id"):
            fail(f"mandate[{i}] does not name mandate[{i - 1}] as its parent")
    u = _copy_or_type_error(awareness_threshold, "awareness_threshold")
    threshold_error = _threshold_form_error(u)
    if threshold_error:
        fail(f"awareness_threshold: {threshold_error}")
    if type(acknowledgment_id) is not str:
        raise TypeError("create_mandate_acknowledgment: acknowledgment_id must be a str")
    if len(acknowledgment_id) < 6 or not _is_scalar_string(acknowledgment_id):
        fail("acknowledgment_id must be at least 6 Unicode scalar values")
    if acknowledged_at is None:
        now = time.time_ns() // 1_000_000
        acknowledged_at = datetime.fromtimestamp(now / 1000, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.") + f"{now % 1000:03d}Z"
    elif type(acknowledged_at) is not str:
        raise TypeError("create_mandate_acknowledgment: acknowledged_at must be a str")
    if not _is_instant(acknowledged_at):
        fail("acknowledged_at is not an RFC 3339 date-time")

    m = chain[-1]
    for f in ("agent_id", "human_id", "session_nonce"):
        if u.get(f) != m.get(f):
            fail(f"the threshold's {f} is not the mandate's")
    at = _instant(acknowledged_at)
    if at < _instant(m["timestamp"]):
        fail("acknowledged_at is before the mandate timestamp")
    if at < _instant(u["timestamp"]):
        fail("acknowledged_at is before the threshold timestamp")
    if at > _instant(m["valid_until"]):
        fail("acknowledged_at is after the mandate valid_until")

    # Every field the acknowledgment copies, checked before anything is hashed or signed: a mandate field copied
    # here must give an acknowledgment of the form design § 2 requires, which the mandate preflight alone does not
    # ensure. The digests are placeholders of the right form until they are computed.
    placeholder = "sha256:" + "0" * 64
    payload = {
        "dcp_version": "2.0",
        "acknowledgment_format": MANDATE_ACKNOWLEDGMENT_FORMAT,
        "acknowledgment_id": acknowledgment_id,
        "mandate_id": m["mandate_id"],
        "mandate_hash": placeholder,
        "chain_hash": placeholder,
        "session_nonce": m["session_nonce"],
        "human_id": m["human_id"],
        "agent_id": m["agent_id"],
        "awareness_threshold_id": u["threshold_id"],
        "awareness_threshold_hash": placeholder,
        "acknowledged_at": acknowledged_at,
    }
    unsigned_fields = tuple(f for f in ACK_FIELDS if f != "composite_sig")
    fields_error = _acknowledgment_fields_error(payload, unsigned_fields)
    if fields_error:
        fail(f"the acknowledgment would not have its form: {fields_error}")
    try:
        payload["mandate_hash"] = _mandate_hash(m)
        payload["chain_hash"] = _chain_hashes(chain)[-1]
        payload["awareness_threshold_hash"] = _threshold_hash(u)
    except (TypeError, ValueError) as exc:  # e.g. a lone surrogate elsewhere in a mandate: not encodable as UTF-8
        fail(f"a mandate of the chain cannot be hashed under dcp-jcs-v1: {type(exc).__name__}")
    fields_error = _acknowledgment_fields_error(payload, unsigned_fields)
    if fields_error:
        fail(f"the acknowledgment would not have its form: {fields_error}")
    signature = await composite_sign(registry, MANDATE_ACKNOWLEDGMENT_CONTEXT, _utf8(payload), classical, pq)
    acknowledgment = {**payload, "composite_sig": _json_copy(dict(signature), "composite_sig")}
    form_error = _acknowledgment_form_error(acknowledgment)
    if form_error:
        fail(f"the signed acknowledgment does not have its form: {form_error}")
    return acknowledgment


# ── Evaluation (design § 4) ──


async def evaluate_delegation_activation_v2(evidence: Any, registry: AlgorithmRegistry, operator: Any) -> dict[str, Any]:
    """Evaluate the activation of a delegation (design § 4): the delegated admission over one snapshot, then the
    acknowledgments of every mandate of its chain. `evidence` holds the keys of admit_delegated_bundle_v2's evidence
    plus "acknowledgments" and "awareness_thresholds"; `operator` is its operator. Raises AdmissionConfigError for
    an invalid operator configuration, as admit_delegated_bundle_v2 does; every problem with the evidence or the
    acknowledgments is a code in the result. Every input but the registry is copied when the coroutine starts.

    Returns {"composition", "activation", "delegation_active", "action_authorized", "acknowledgments", "inputs",
    "errors"}: composition is admit_delegated_bundle_v2's result over the same snapshot; activation is "evaluated"
    if and only if the composition is admitted and both containers are valid input; errors follow design § 7.2."""
    # ── 0–1. F2's snapshot (configuration errors raise), then the two containers ──
    snapshot = _take_delegated_snapshot(evidence, operator)
    errors: list[dict[str, str]] = []

    def add(code: str, message: str) -> None:
        errors.append({"code": code, "message": _bounded(message)})

    def container(field: str) -> list[Any] | None:
        try:
            if type(evidence) is not dict:
                raise _InputError("evidence is not an object")
            if field not in evidence:
                raise _InputError(f"evidence needs {field}")
            v = _json_copy(evidence[field], field)
            if type(v) is not list:
                raise _InputError(f"{field} is not an array")
            return v
        except _InputError as exc:
            add("ACK_INPUT_INVALID", str(exc))
        except RecursionError:
            add("ACK_INPUT_INVALID", f"{field} is nested too deeply")
        return None

    acks = container("acknowledgments")
    thresholds = container("awareness_thresholds")

    # ── 2. The composition, always ──
    composition, verified = await _compose_delegated(snapshot, registry)
    inputs = {
        "now": snapshot.now_ms,
        "acknowledgments": None if acks is None else len(acks),
        "awareness_thresholds": None if thresholds is None else len(thresholds),
    }
    if not composition["admitted"] or verified is None or acks is None or thresholds is None:
        return {"composition": composition, "activation": "not_evaluated", "delegation_active": False,
                "action_authorized": False, "acknowledgments": [], "inputs": inputs, "errors": errors}
    mandates: list[dict[str, Any]] = verified["mandates"]
    entries = [{"mandate_id": m["mandate_id"], "acknowledgment_id": None, "awareness_threshold_id": None, "verified": False} for m in mandates]

    def evaluated() -> dict[str, Any]:
        return {"composition": composition, "activation": "evaluated", "delegation_active": not errors,
                "action_authorized": False, "acknowledgments": entries, "inputs": inputs, "errors": errors}

    # ── 3. Form ──
    for i, a in enumerate(acks):
        e = _acknowledgment_form_error(a)
        if e:
            add("ACK_FORM_INVALID", f"acknowledgments[{i}]: {e}")
    for i, u in enumerate(thresholds):
        e = _threshold_form_error(u)
        if e:
            add("ACK_THRESHOLD_INVALID", f"awareness_thresholds[{i}]: {e}")
    if errors:
        return evaluated()

    # ── 4. Cardinality, in the order of design § 7.2 ──
    ids = [m["mandate_id"] for m in mandates]
    by_mandate = [[a for a in acks if a["mandate_id"] == mid] for mid in ids]
    for mid, lst in zip(ids, by_mandate):
        if not lst:
            add("ACK_MISSING", f"mandate {_printable(mid)} has no acknowledgment")
        elif len(lst) > 1:
            add("ACK_DUPLICATE", f"mandate {_printable(mid)} has {len(lst)} acknowledgments")
    for i, a in enumerate(acks):
        if a["mandate_id"] not in ids:
            add("ACK_UNEXPECTED", f"acknowledgments[{i}] acknowledges {_printable(a['mandate_id'])}, not in the chain")

    def second_occurrences(values: list[str]) -> list[int]:
        seen: dict[str, int] = {}
        out: list[int] = []
        for i, v in enumerate(values):
            seen[v] = seen.get(v, 0) + 1
            if seen[v] == 2:
                out.append(i)
        return out

    for i in second_occurrences([a["acknowledgment_id"] for a in acks]):
        add("ACK_DUPLICATE", f"acknowledgment_id {_printable(acks[i]['acknowledgment_id'])} is repeated")
    for i in second_occurrences([u["threshold_id"] for u in thresholds]):
        add("ACK_THRESHOLD_DUPLICATE", f"threshold_id {_printable(thresholds[i]['threshold_id'])} is repeated")
    threshold_ids = [u["threshold_id"] for u in thresholds]
    for i, a in enumerate(acks):
        if a["awareness_threshold_id"] not in threshold_ids:
            add("ACK_THRESHOLD_MISSING", f"acknowledgments[{i}] names threshold {_printable(a['awareness_threshold_id'])}, which was not given")
    for i in second_occurrences([a["awareness_threshold_id"] for a in acks]):
        add("ACK_THRESHOLD_REUSED", f"threshold {_printable(acks[i]['awareness_threshold_id'])} is named by more than one acknowledgment")
    named = {a["awareness_threshold_id"] for a in acks}
    for i, u in enumerate(thresholds):
        if u["threshold_id"] not in named:
            add("ACK_THRESHOLD_UNEXPECTED", f"awareness_thresholds[{i}] ({_printable(u['threshold_id'])}) is named by no acknowledgment")
    for i, lst in enumerate(by_mandate):
        if len(lst) != 1:
            continue
        entries[i]["acknowledgment_id"] = lst[0]["acknowledgment_id"]
        matching = [u for u in thresholds if u["threshold_id"] == lst[0]["awareness_threshold_id"]]
        if len(matching) == 1:
            entries[i]["awareness_threshold_id"] = matching[0]["threshold_id"]
    if errors:
        return evaluated()

    # ── 5–8. Per mandate, chain order: A bindings, B keys and policy, C signatures, D own time ──
    pairs = [(lst[0], next(u for u in thresholds if u["threshold_id"] == lst[0]["awareness_threshold_id"])) for lst in by_mandate]
    n = len(mandates)
    hashes = [_mandate_hash(m) for m in mandates]
    chains = _chain_hashes(mandates)
    self_valid = [False] * n
    pair_keys: list[list[dict[str, Any]]] = [[] for _ in range(n)]
    for i in range(n):
        keys = await _evaluate_pair(i, pairs[i], verified, hashes[i], chains[i], registry, add)
        if keys is not None:
            self_valid[i] = True
            pair_keys[i] = keys

    # ── 9. T5: the parent acknowledged before the sub-mandate was issued ──
    t5_failed = [False] * n
    for i in range(1, n):
        if not self_valid[i - 1]:
            continue
        if _instant(pairs[i - 1][0]["acknowledged_at"]) > _instant(mandates[i]["timestamp"]):
            add("ACK_TIME_INVALID", f"T5: the acknowledgment of mandate {_printable(ids[i - 1])} is after the issuance of mandate {_printable(ids[i])}")
            t5_failed[i - 1] = True

    # ── 10. Revocation of the keys only acknowledgments and thresholds use, in the composition's snapshot ──
    revoked_pair = [False] * n
    users: dict[str, list[int]] = {}
    for i, keys in enumerate(pair_keys):
        if not self_valid[i]:
            continue
        for key in keys:
            if key["kid"] in verified["checked_kids"]:
                continue
            users.setdefault(key["kid"], []).append(i)
    revocation = verified["revocation"]
    statuses = revocation.get("keys") if type(revocation) is dict and type(revocation.get("keys")) is dict else {}
    for kid in sorted(users):
        status = statuses.get(kid)
        if status == "not_revoked":
            continue
        if status == "revoked":
            add("ACK_KEY_REVOKED", f"key {kid} is revoked")
        else:
            add("ACK_KEY_REVOCATION_UNKNOWN", f"the revocation status of key {kid} is unknown")
        for i in users[kid]:
            revoked_pair[i] = True

    # ── 11. Result ──
    for i in range(n):
        entries[i]["verified"] = self_valid[i] and not t5_failed[i] and not revoked_pair[i]
    return evaluated()


async def _evaluate_pair(
    i: int,
    pair: tuple[dict[str, Any], dict[str, Any]],
    verified: dict[str, Any],
    mandate_hash: str,
    chain_hash: str,
    registry: AlgorithmRegistry,
    add: Callable[[str, str], None],
) -> list[dict[str, Any]] | None:
    """Phases A to D for mandate i (design § 4.2): each phase runs all its checks, and a phase that adds a code skips
    the later phases of this mandate. Returns the four resolved keys when every phase passed, else None."""
    k, u = pair
    m = verified["mandates"][i]
    label = f"mandate {_printable(m['mandate_id'])}"
    failed = False

    def fail(code: str, message: str) -> None:
        nonlocal failed
        failed = True
        add(code, f"{label}: {message}")

    # A. Bindings, in the order of design § 4.4
    if k["mandate_hash"] != mandate_hash:
        fail("ACK_MANDATE_MISMATCH", "mandate_hash is not the hash of the mandate")
    if k["session_nonce"] != m["session_nonce"]:
        fail("ACK_MANDATE_MISMATCH", "session_nonce is not the mandate's")
    if k["human_id"] != m["human_id"]:
        fail("ACK_MANDATE_MISMATCH", "human_id is not the mandate's")
    if k["agent_id"] != m["agent_id"]:
        fail("ACK_MANDATE_MISMATCH", "agent_id is not the mandate's")
    if k["chain_hash"] != chain_hash:
        fail("ACK_CHAIN_MISMATCH", "chain_hash is not the hash of the chain up to the mandate")
    if k["awareness_threshold_hash"] != _threshold_hash(u):
        fail("ACK_THRESHOLD_MISMATCH", "awareness_threshold_hash is not the hash of the threshold")
    if u["agent_id"] != m["agent_id"]:
        fail("ACK_THRESHOLD_MISMATCH", "the threshold's agent_id is not the mandate's")
    if u["human_id"] != m["human_id"]:
        fail("ACK_THRESHOLD_MISMATCH", "the threshold's human_id is not the mandate's")
    if u["session_nonce"] != m["session_nonce"]:
        fail("ACK_THRESHOLD_MISMATCH", "the threshold's session_nonce is not the mandate's")
    if failed:
        return None

    # B. Keys, in the passport the composition verified for the mandate's agent, then the policy
    keys_list = verified["agent_keys"].get(m["agent_id"], [])
    components = [
        ("threshold classical", u["composite_sig"]["classical"], "classical"),
        ("threshold pq", u["composite_sig"]["pq"], "pq"),
        ("acknowledgment classical", k["composite_sig"]["classical"], "classical"),
        ("acknowledgment pq", k["composite_sig"]["pq"], "pq"),
    ]
    resolved: list[dict[str, Any]] = []
    for where, entry, _kind in components:
        key = _signer_key(keys_list, entry, verified["now_ms"])
        if type(key) is str:
            known = any(type(x) is dict and x.get("kid") == entry["kid"] for x in keys_list)
            fail("ACK_KEY_INVALID" if known else "ACK_KEY_UNKNOWN", f"{where}: {key} in the passport of {_printable(m['agent_id'])}")
            continue
        identity = _used_key_error(key, entry["kid"], entry["alg"], where)
        if identity:
            fail("ACK_KEY_INVALID", identity)
            continue
        resolved.append(key)
    policy = verified["policy"]

    def listed(field: str) -> list[Any]:
        value = policy.get(field)
        return list(value) if isinstance(value, (list, tuple)) else []

    for where, entry, kind in components:
        if kind == "classical" and verified["mode"] == "pq_only":
            continue
        accepted = "accepted_classical_algs" if kind == "classical" else "accepted_pq_algs"
        if entry["alg"] not in listed(accepted):
            fail("ACK_ALGORITHM_REJECTED", f"{where}: {entry['alg']} is not accepted by the verifier policy")
        if entry["alg"] in listed("advisory_rejected_algs"):
            fail("ACK_ALGORITHM_REJECTED", f"{where}: {entry['alg']} is rejected by an active advisory")
    if failed:
        return None

    # C. Signatures: the threshold under Awareness, then the acknowledgment under its own context
    uc, up, kc, kp = resolved

    async def verifies(context: str, record: dict[str, Any], classical: dict[str, Any], pq: dict[str, Any]) -> bool:
        try:
            r = await composite_verify(registry, context, _utf8(_unsigned(record)), record["composite_sig"], classical["public_key_b64"], pq["public_key_b64"])
            return bool(r.valid and r.classical_valid and r.pq_valid)
        except Exception:  # noqa: BLE001 — a signature that cannot be checked does not verify
            return False

    if not await verifies(DCP_CONTEXTS["Awareness"], u, uc, up):
        fail("ACK_THRESHOLD_SIGNATURE_INVALID", "the threshold does not verify under DCP-AI.v2.Awareness")
    if not await verifies(MANDATE_ACKNOWLEDGMENT_CONTEXT, k, kc, kp):
        fail("ACK_SIGNATURE_INVALID", "the acknowledgment does not verify under DCP-AI.v2.MandateAcknowledgment")
    if failed:
        return None

    # D. Own time, T1 to T4 (design § 6)
    at = _instant(k["acknowledged_at"])
    if at < _instant(m["timestamp"]):
        fail("ACK_TIME_INVALID", "T1: acknowledged_at is before the mandate timestamp")
    if at < _instant(u["timestamp"]):
        fail("ACK_TIME_INVALID", "T2: acknowledged_at is before the threshold timestamp")
    if at > _instant(m["valid_until"]):
        fail("ACK_TIME_INVALID", "T3: acknowledged_at is after the mandate valid_until")
    if at > verified["now_ms"] + SESSION_CLOCK_SKEW_MS:
        fail("ACK_TIME_INVALID", "T4: acknowledged_at is after now plus the clock skew")
    return None if failed else resolved
