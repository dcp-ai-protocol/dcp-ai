"""EXPERIMENTAL, opt-in (candidate ``dcp-jcs-v2``, phase 4): producers of new candidate evidence.

- ``sign_payload`` signs one artifact ``{payload, payload_hash, composite_sig}``. It signs no profile:
  the artifact has the form and the domain context of today's artifacts.
- ``sign_bundle`` assembles a bundle whose new manifest commits to
  ``canonicalization_profile: "dcp-jcs-v2"``, and signs that manifest.

Inputs are ``{"bytes": ...}`` (original bytes, checked by the phase 1 ingress before anything parses
them: the way for JSON received from elsewhere) or ``{"value": ...}`` (a host value, checked and copied by
a strict walk; it cannot recover the literal a parser read it from). Both functions are synchronous: they
check and copy every input, option and key label when called and return the awaitable signature, so a
caller's later change affects nothing. Rejections of this experimental contract are
ExperimentalCandidateProduceError, raised before any signer is called; they are not a normative
activation of the profile. Errors of the key, the registry or the provider stay today's errors, with no
rollback promised for a signature already made.

Nothing here relabels received evidence or recomputes a received commitment: an artifact whose
payload_hash is not the hash of its payload is refused, and an audit chain must start at GENESIS and link.
Builders, signers and verifiers of dcp-jcs-v1 are unchanged; only their primitives are reused.
"""

from __future__ import annotations

import math
from datetime import datetime, timezone
from typing import Any, Awaitable, NamedTuple, Optional

from dcp_ai.v2.canonicalize import canonicalize_v2
from dcp_ai.v2.composite_ops import CompositeKeyInfo, classical_only_sign, composite_sign
from dcp_ai.v2.crypto_registry import AlgorithmRegistry
from dcp_ai.v2.domain_separation import DCP_CONTEXTS
from dcp_ai.v2.dual_hash import dual_hash_canonical, dual_merkle_root, sha256_hex
from dcp_ai.v2.experimental_candidate_ingress import (
    CandidateIngressAccept,
    ExperimentalCandidateInternalError,
    experimental_candidate_ingress,
)
from dcp_ai.v2.experimental_candidate_router import JSON_LOADS_BYTES, RouteCandidate, create_router
from dcp_ai.v2.session_nonce import is_valid_session_nonce, rfc3339_epoch_ms, verify_session_binding
from dcp_ai.v2.signed_payload import prepare_payload

_MAX_SAFE = 9007199254740991  # 2^53-1
_MAX_DEPTH = 64
_ZEROS = "0" * 64
_CONTEXTS = frozenset(DCP_CONTEXTS.values())


class ExperimentalCandidateProduceError(Exception):
    """A rejection of the experimental producer contract, raised before any signer is called. ``part``
    names the input; ``offset`` is a byte offset in that input's bytes, ``path`` a JSON Pointer in its
    value."""

    def __init__(self, reject_class: str, part: str, path: Optional[str], offset: Optional[int] = None) -> None:
        where = "" if path is None else f" at {path or '/'}"
        at = "" if offset is None else f" (byte {offset})"
        super().__init__(f"{reject_class} in {part}{where}{at}")
        self.reject_class = reject_class
        self.part = part
        self.path = path
        self.offset = offset


class ProducedPayload(NamedTuple):
    bytes: bytes
    signed_payload: dict[str, Any]


class ProducedBundle(NamedTuple):
    bytes: bytes
    signed_bundle: dict[str, Any]


def _usage(message: str) -> TypeError:
    return TypeError(f"experimental candidate producer: {message}")


def _pointer(path: str, key: Any) -> str:
    return f"{path}/{str(key).replace('~', '~0').replace('/', '~1')}"


def _well_formed(s: str) -> bool:
    return not any(0xD800 <= ord(c) <= 0xDFFF for c in s)


def _exact_copy(v: Any, part: str, path: str, depth: int) -> Any:
    """A host value checked against the exact domain and copied, at most _MAX_DEPTH levels deep. Exact
    types only: a subclass (OrderedDict, IntEnum, a str subclass) or a tuple is not a JSON value here."""

    def reject(cls: str, at: str = path) -> ExperimentalCandidateProduceError:
        return ExperimentalCandidateProduceError(cls, part, at)

    t = type(v)
    if v is None or t is bool:
        return v
    if t is str:
        if not _well_formed(v):
            raise reject("SURROGATE_UNPAIRED")
        return v
    if t is int:
        if abs(v) > _MAX_SAFE:
            raise reject("NUMBER_OUT_OF_RANGE")
        return v
    if t is float:
        if not math.isfinite(v):
            raise reject("NUMBER_NOT_FINITE")
        if not v.is_integer():
            raise reject("NUMBER_NOT_INTEGER")
        if abs(v) > _MAX_SAFE:
            raise reject("NUMBER_OUT_OF_RANGE")
        return int(v)  # 1.0 is 1, -0.0 is 0
    if t is not dict and t is not list:
        raise reject("TYPE_UNSUPPORTED")
    if depth + 1 > _MAX_DEPTH:
        raise reject("DEPTH_EXCEEDED")
    if t is list:
        return [_exact_copy(x, part, _pointer(path, i), depth + 1) for i, x in enumerate(v)]
    out: dict[str, Any] = {}
    for k, x in v.items():
        if type(k) is not str:
            # At the parent: a foreign key is never converted, printed or compared (no __str__, __repr__ or __eq__ runs).
            raise reject("KEY_NOT_STRING", path)
        at = _pointer(path, k)
        if not _well_formed(k):
            raise reject("SURROGATE_UNPAIRED", at)
        out[k] = _exact_copy(x, part, at, depth + 1)
    return out


def _params(v: Any, what: str, allowed: tuple[str, ...]) -> dict[str, Any]:
    if type(v) is not dict:
        raise _usage(f"{what} must be a dict")
    for k in v:
        # The type first: a key that is not an exact str is never compared or printed.
        if type(k) is not str:
            raise _usage(f"{what} has a member whose key is not a str")
        if k not in allowed:
            raise _usage(f"{what} has an unknown member {k!r}")
    return dict(v)


def _own_bytes(v: Any, what: str) -> bytes:
    """A private copy of exact bytes, bytearray or memoryview, through the buffer protocol: no
    __bytes__ or other method of a subclass runs."""
    if type(v) is bytes:
        return v
    if type(v) is bytearray or type(v) is memoryview:
        return memoryview(v).tobytes()
    raise _usage(f"{what} must be bytes, bytearray or memoryview")


def _read_input(inp: Any, part: str, path: str = "") -> Any:
    p = _params(inp, part, ("bytes", "value"))
    if len(p) != 1:
        raise _usage(f"{part} must have exactly one of bytes and value")
    if "bytes" in p:
        r = experimental_candidate_ingress(_own_bytes(p["bytes"], f"{part}.bytes"))
        if not isinstance(r, CandidateIngressAccept):
            raise ExperimentalCandidateProduceError(r.reject_class, part, path or None, r.offset)
        return r.value
    return _exact_copy(p["value"], part, path, 0)


def _too_deep(v: Any, limit: int, path: str = "", depth: int = 0) -> Optional[str]:
    """The pointer of the first container that opens a level beyond ``limit``, or None."""
    if not isinstance(v, (dict, list)):
        return None
    if depth + 1 > limit:
        return path
    for k, x in (v.items() if isinstance(v, dict) else enumerate(v)):
        found = _too_deep(x, limit, _pointer(path, k), depth + 1)
        if found is not None:
            return found
    return None


def _read_keys(keys: Any, part: str) -> tuple[CompositeKeyInfo, Optional[CompositeKeyInfo]]:
    """The keys, with their labels checked (they end up in the signed unit); the secrets stay the provider's."""
    p = _params(keys, part, ("classical", "pq"))

    def one(name: str) -> CompositeKeyInfo:
        k = p[name]
        fields = ("kid", "alg", "secret_key_b64", "public_key_b64")
        if type(k) is CompositeKeyInfo:
            values = tuple(k)
        elif type(k) is dict and all(type(x) is str for x in k) and set(k) == set(fields):
            values = tuple(k[f] for f in fields)
        else:
            raise _usage(f"{part}.{name} must be a CompositeKeyInfo or a dict of {', '.join(fields)}")
        if not all(type(x) is str for x in values):
            raise _usage(f"{part}.{name} fields must be strings")
        for label, value in zip(("kid", "alg"), values):
            if not _well_formed(value):
                raise ExperimentalCandidateProduceError("SURROGATE_UNPAIRED", part, f"/{name}/{label}")
        return CompositeKeyInfo(*values)

    if "classical" not in p:
        raise _usage(f"{part}.classical is required")
    return one("classical"), (one("pq") if "pq" in p else None)


def _label(v: Any, part: str, path: str) -> str:
    if type(v) is not str or not v:
        raise _usage(f"{part}{path} must be a non-empty string")
    if not _well_formed(v):
        raise ExperimentalCandidateProduceError("SURROGATE_UNPAIRED", part, path)
    return v


async def _sign(registry: AlgorithmRegistry, context: str, data: bytes, classical: CompositeKeyInfo, pq: Optional[CompositeKeyInfo]) -> Any:
    if pq is not None:
        return await composite_sign(registry, context, data, classical, pq)
    return await classical_only_sign(registry, context, data, classical)


def _canonical(v: Any) -> bytes:
    return canonicalize_v2(v).encode("utf-8")


# ── sign_payload ──


def sign_payload(registry: AlgorithmRegistry, context: str, input: Any, keys: Any) -> Awaitable[ProducedPayload]:
    """EXPERIMENTAL, opt-in (candidate ``dcp-jcs-v2``, phase 4): signs one artifact under ``context``
    (one of DCP_CONTEXTS) over the canonical bytes of the payload's exact value. The payload must be a
    dict and the artifact must fit in 64 levels (the payload in 63): its own bytes go through the ingress.
    Checks and copies now; returns the awaitable ``(bytes, signed_payload)``."""
    if type(context) is not str or context not in _CONTEXTS:
        raise _usage("context must be one of DCP_CONTEXTS")
    classical, pq = _read_keys(keys, "keys")
    payload = _read_input(input, "payload")
    if type(payload) is not dict:
        raise ExperimentalCandidateProduceError("TYPE_UNSUPPORTED", "payload", "")
    deep = _too_deep(payload, _MAX_DEPTH - 1)
    if deep is not None:
        raise ExperimentalCandidateProduceError("DEPTH_EXCEEDED", "payload", deep)
    canonical_bytes, payload_hash = prepare_payload(payload)

    async def finish() -> ProducedPayload:
        composite = await _sign(registry, context, canonical_bytes, classical, pq)
        signed = {"payload": payload, "payload_hash": payload_hash, "composite_sig": _exact_copy(composite, "internal", "", 0)}
        out = _canonical(signed)
        again = experimental_candidate_ingress(out)
        if not isinstance(again, CandidateIngressAccept) or again.canonical_sha256 != sha256_hex(out):
            raise ExperimentalCandidateInternalError("a signed artifact the candidate ingress does not give back as is")
        return ProducedPayload(out, signed)

    return finish()


# ── sign_bundle ──

_ARTIFACTS = (
    ("rpr", "responsible_principal_record", "rpr_hash"),
    ("passport", "agent_passport", "passport_hash"),
    ("intent", "intent", "intent_hash"),
    ("policy_decision", "policy_decision", "policy_hash"),
)


def _read_artifact(inp: Any, part: str) -> dict[str, Any]:
    a = _read_input(inp, part)
    if type(a) is not dict:
        raise ExperimentalCandidateProduceError("TYPE_UNSUPPORTED", part, "")
    if type(a.get("payload")) is not dict:
        raise ExperimentalCandidateProduceError("TYPE_UNSUPPORTED", part, "/payload")
    if type(a.get("composite_sig")) is not dict:
        raise ExperimentalCandidateProduceError("TYPE_UNSUPPORTED", part, "/composite_sig")
    # The received commitment is checked, never recomputed into the artifact.
    if a.get("payload_hash") != prepare_payload(a["payload"])[1]:
        raise ExperimentalCandidateProduceError("COMMITMENT_MISMATCH", part, "/payload_hash")
    return a


def _entry_hash(e: Any) -> str:
    return f"sha256:{sha256_hex(_canonical(e))}"


def sign_bundle(registry: AlgorithmRegistry, parts: Any, signer: Any, options: Any) -> Awaitable[ProducedBundle]:
    """EXPERIMENTAL, opt-in (candidate ``dcp-jcs-v2``, phase 4): assembles a bundle from its parts and
    signs a new manifest that commits to ``canonicalization_profile: "dcp-jcs-v2"``. Every part is copied
    whole: members it does not know are kept; those outside a payload, an entry, a checkpoint or the
    manifest are not signed, so their integrity is not claimed. An empty audit trail has audit_count 0
    and the root of 64 zeros. The session start is never stamped from the clock: with an expiry,
    session_issued_at is required. Checks and copies now; returns the awaitable ``(bytes, signed_bundle)``.

    ``parts``: rpr, passport, intent, policy_decision (artifacts), audit_entries, pq_checkpoints (lists),
    each item ``{"bytes": ...}`` or ``{"value": ...}``. ``signer``: signer_type, signer_id, keys
    (``{"classical", "pq"}``; without pq, classical-only). ``options``: session_nonce, and optionally
    session_issued_at, session_expires_at, intended_verifier, dual_hash (default False) and created_at
    (outside every signature, not protected; default the clock). A member present as None is not absent.
    """
    o = _params(options, "options", ("session_nonce", "session_issued_at", "session_expires_at", "intended_verifier", "dual_hash", "created_at"))
    s = _params(signer, "signer", ("signer_type", "signer_id", "keys"))
    p = _params(parts, "parts", ("rpr", "passport", "intent", "policy_decision", "audit_entries", "pq_checkpoints"))
    for name in ("rpr", "passport", "intent", "policy_decision", "audit_entries"):
        if name not in p:
            raise _usage(f"parts.{name} is required")
    if "keys" not in s:
        raise _usage("signer.keys is required")

    signer_type = _label(s.get("signer_type"), "signer", "/signer_type")
    signer_id = _label(s.get("signer_id"), "signer", "/signer_id")
    classical, pq = _read_keys(s["keys"], "signer.keys")
    nonce = o.get("session_nonce")
    if type(nonce) is not str:
        raise _usage("options.session_nonce must be a string")
    if not is_valid_session_nonce(nonce):
        raise ExperimentalCandidateProduceError("SESSION_INVALID", "options", "/session_nonce")
    issued_at = _label(o["session_issued_at"], "options", "/session_issued_at") if "session_issued_at" in o else None
    expires_at = _label(o["session_expires_at"], "options", "/session_expires_at") if "session_expires_at" in o else None
    intended = _label(o["intended_verifier"], "options", "/intended_verifier") if "intended_verifier" in o else None
    dual = o.get("dual_hash", False)
    if type(dual) is not bool:
        raise _usage("options.dual_hash must be a bool")
    if "created_at" in o:
        created_at = _label(o["created_at"], "options", "/created_at")
        if rfc3339_epoch_ms(created_at) is None:
            raise _usage("options.created_at must be an RFC 3339 date")
    else:
        now = datetime.now(timezone.utc)
        created_at = now.strftime("%Y-%m-%dT%H:%M:%S.") + f"{now.microsecond // 1000:03d}Z"
    issued = None if issued_at is None else rfc3339_epoch_ms(issued_at)
    expires = None if expires_at is None else rfc3339_epoch_ms(expires_at)
    if issued_at is not None and issued is None:
        raise ExperimentalCandidateProduceError("SESSION_INVALID", "options", "/session_issued_at")
    if expires_at is not None and expires is None:
        raise ExperimentalCandidateProduceError("SESSION_INVALID", "options", "/session_expires_at")
    if expires_at is not None and issued_at is None:
        raise ExperimentalCandidateProduceError("SESSION_ISSUED_AT_REQUIRED", "options", "/session_issued_at")
    if issued is not None and expires is not None and issued > expires:
        raise ExperimentalCandidateProduceError("SESSION_INVALID", "options", "/session_expires_at")

    artifacts = [_read_artifact(p[part], part) for part, _, _ in _ARTIFACTS]

    def items(name: str) -> list[Any]:
        v = p.get(name, [])
        if type(v) is not list:
            raise _usage(f"parts.{name} must be a list")
        return list(v)

    entries = []
    for i, e in enumerate(items("audit_entries")):
        v = _read_input(e, "audit_entries", f"/{i}")
        if type(v) is not dict:
            raise ExperimentalCandidateProduceError("TYPE_UNSUPPORTED", "audit_entries", f"/{i}")
        entries.append(v)
    checkpoints = []
    for i, c in enumerate(items("pq_checkpoints")):
        v = _read_input(c, "pq_checkpoints", f"/{i}")
        if type(v) is not dict or type(v.get("checkpoint_id")) is not str:
            raise ExperimentalCandidateProduceError("TYPE_UNSUPPORTED", "pq_checkpoints", f"/{i}")
        checkpoints.append(v)

    # The chain is checked, never inferred or repaired: a new chain starts at GENESIS.
    for i, e in enumerate(entries):
        expected = "GENESIS" if i == 0 else _entry_hash(entries[i - 1])
        if e.get("prev_hash") != expected:
            raise ExperimentalCandidateProduceError("CHAIN_NOT_GENESIS" if i == 0 else "CHAIN_BREAK", "audit_entries", f"/{i}/prev_hash")
    binding = verify_session_binding([a["payload"] for a in artifacts] + entries + checkpoints)
    if not binding["valid"] or binding.get("nonce") != nonce:
        raise ExperimentalCandidateProduceError("SESSION_INVALID", "parts", None)
    if artifacts[0]["payload"].get("human_id") != signer_id:
        raise ExperimentalCandidateProduceError("SIGNER_MISMATCH", "signer", "/signer_id")

    roots = dual_merkle_root([dual_hash_canonical(canonicalize_v2(e)) for e in entries])
    manifest: dict[str, Any] = {
        "session_nonce": nonce,
        "rpr_hash": artifacts[0]["payload_hash"],
        "passport_hash": artifacts[1]["payload_hash"],
        "intent_hash": artifacts[2]["payload_hash"],
        "policy_hash": artifacts[3]["payload_hash"],
        "audit_merkle_root": f"sha256:{roots['sha256'] if roots else _ZEROS}",
        "audit_count": len(entries),
        "canonicalization_profile": "dcp-jcs-v2",
    }
    if dual:
        manifest["audit_merkle_root_secondary"] = f"sha3-256:{roots['sha3_256'] if roots else _ZEROS}"
    if checkpoints:
        manifest["pq_checkpoints"] = [c["checkpoint_id"] for c in checkpoints]
    if issued_at is not None:
        manifest["session_issued_at"] = issued_at
    if expires_at is not None:
        manifest["session_expires_at"] = expires_at
    if intended is not None:
        manifest["intended_verifier"] = intended

    bundle: dict[str, Any] = {"dcp_bundle_version": "2.0", "manifest": manifest}
    for (_, member, _), a in zip(_ARTIFACTS, artifacts):
        bundle[member] = a
    bundle["audit_entries"] = entries
    if checkpoints:
        bundle["pq_checkpoints"] = checkpoints

    kids = [classical.kid, pq.kid] if pq is not None else [classical.kid]

    def signature(manifest_hash: str, composite: Any) -> dict[str, Any]:
        return {
            "hash_alg": "sha256+sha3-256" if dual else "sha256",
            "created_at": created_at,
            "signer": {"type": signer_type, "id": signer_id, "kids": list(kids)},
            "manifest_hash": manifest_hash,
            "composite_sig": composite,
        }

    # The final unit's skeleton, its signature included, must fit in 64 levels before anything is signed.
    def entry(k: CompositeKeyInfo) -> dict[str, str]:
        return {"alg": k.alg, "kid": k.kid, "sig_b64": ""}

    skeleton = {"bundle": bundle, "signature": signature(f"sha256:{_ZEROS}", {
        "classical": entry(classical), "pq": entry(pq) if pq is not None else None,
        "binding": "pq_over_classical" if pq is not None else "classical_only",
    })}
    deep = _too_deep(skeleton, _MAX_DEPTH)
    if deep is not None:
        raise ExperimentalCandidateProduceError("DEPTH_EXCEEDED", "unit", deep)
    manifest_bytes = _canonical(manifest)
    manifest_hash = f"sha256:{sha256_hex(manifest_bytes)}"

    async def finish() -> ProducedBundle:
        composite = await _sign(registry, DCP_CONTEXTS["Bundle"], manifest_bytes, classical, pq)
        signed = {"bundle": bundle, "signature": signature(manifest_hash, _exact_copy(composite, "internal", "", 0))}
        out = _canonical(signed)
        route = create_router(transport="bare", accepted_profiles=["dcp-jcs-v2"], historical=JSON_LOADS_BYTES).route(out)
        if not isinstance(route, RouteCandidate) or route.canonical_sha256 != sha256_hex(out):
            raise ExperimentalCandidateInternalError("a produced unit the candidate route does not give back as is")
        return ProducedBundle(out, signed)

    return finish()
