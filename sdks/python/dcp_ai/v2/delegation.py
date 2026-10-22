"""
DCP-09 v2.0 Delegation & Representation — Python port.

Delegation mandates (human → agent authority), sub-mandates and mandate chains
(agent → agent, DCP-09 §3.5), mandate verification and revocation.
"""

from __future__ import annotations

import math
from datetime import datetime, timezone
from typing import Any

from dcp_ai.v2.canonicalize import canonicalize_v2
from dcp_ai.v2.composite_ops import CompositeKeyInfo, composite_sign, composite_verify
from dcp_ai.v2.crypto_registry import AlgorithmRegistry
from dcp_ai.v2.domain_separation import DCP_CONTEXTS
from dcp_ai.v2.lifecycle import _utc_now
from dcp_ai.v2.security_tier import max_tier
from dcp_ai.v2.session_nonce import parse_rfc3339


def _chain_fields(sub_delegation: dict[str, Any] | None, minimum_security_tier: str | None) -> dict[str, Any]:
    # Left out of the wire object when absent, so a plain root mandate is unchanged byte for byte.
    fields: dict[str, Any] = {}
    if sub_delegation is not None:
        fields["sub_delegation"] = sub_delegation
    if minimum_security_tier is not None:
        fields["minimum_security_tier"] = minimum_security_tier
    return fields


async def create_delegation_mandate(
    registry: AlgorithmRegistry,
    human_classical_key: CompositeKeyInfo,
    human_pq_key: CompositeKeyInfo,
    *,
    mandate_id: str,
    session_nonce: str,
    human_id: str,
    agent_id: str,
    authority_scope: list[dict[str, Any]],
    valid_from: str,
    valid_until: str,
    revocable: bool,
    sub_delegation: dict[str, Any] | None = None,
    minimum_security_tier: str | None = None,
) -> dict[str, Any]:
    """Create a delegation mandate signed by the human principal.

    ``sub_delegation`` (``{"permitted": bool, "max_depth": int}``) and
    ``minimum_security_tier`` are the DCP-09 §3.5 chain fields; both are optional.
    """
    payload: dict[str, Any] = {
        "dcp_version": "2.0",
        "mandate_id": mandate_id,
        "session_nonce": session_nonce,
        "human_id": human_id,
        "agent_id": agent_id,
        "authority_scope": authority_scope,
        "valid_from": valid_from,
        "valid_until": valid_until,
        "revocable": revocable,
        "timestamp": _utc_now(),
        **_chain_fields(sub_delegation, minimum_security_tier),
    }
    canonical = canonicalize_v2(payload)
    composite = await composite_sign(
        registry,
        DCP_CONTEXTS["Delegation"],
        canonical.encode("utf-8"),
        human_classical_key,
        human_pq_key,
    )
    # TS uses `human_composite_sig` (not `composite_sig`) to distinguish the
    # human-principal signature on the mandate artifact.
    return {**payload, "human_composite_sig": composite}


async def create_sub_mandate(
    registry: AlgorithmRegistry,
    delegator_classical_key: CompositeKeyInfo,
    delegator_pq_key: CompositeKeyInfo,
    parent: dict[str, Any],
    *,
    mandate_id: str,
    session_nonce: str,
    agent_id: str,
    authority_scope: list[dict[str, Any]],
    valid_from: str,
    valid_until: str,
    revocable: bool,
    sub_delegation: dict[str, Any] | None = None,
    minimum_security_tier: str | None = None,
) -> dict[str, Any]:
    """Create a sub-mandate (DCP-09 §3.5): the agent holding ``parent`` passes a
    narrower authority on to ``agent_id``, signing with its own keys under the
    SubMandate context. Nothing is checked here; ``verify_mandate_chain`` is the
    gate, so a sub-mandate wider than its parent is one no verifier accepts.
    """
    parent_depth = parent.get("delegation_depth")
    payload: dict[str, Any] = {
        "dcp_version": "2.0",
        "mandate_id": mandate_id,
        "session_nonce": session_nonce,
        "human_id": parent["human_id"],
        "agent_id": agent_id,
        "authority_scope": authority_scope,
        "valid_from": valid_from,
        "valid_until": valid_until,
        "revocable": revocable,
        "timestamp": _utc_now(),
        "parent_mandate_id": parent["mandate_id"],
        "delegation_depth": (parent_depth if isinstance(parent_depth, int) else 0) + 1,
        **_chain_fields(sub_delegation, minimum_security_tier),
    }
    canonical = canonicalize_v2(payload)
    composite = await composite_sign(
        registry,
        DCP_CONTEXTS["SubMandate"],
        canonical.encode("utf-8"),
        delegator_classical_key,
        delegator_pq_key,
    )
    return {**payload, "delegator_composite_sig": composite}


def verify_mandate_validity(
    mandate: dict[str, Any],
    revoked_mandate_ids: set[str],
    *,
    now: datetime | None = None,
) -> dict[str, Any]:
    """Verify a delegation mandate is still valid (not expired, not revoked)."""
    if mandate["mandate_id"] in revoked_mandate_ids:
        return {"valid": False, "reason": "Mandate has been revoked"}

    current = now or datetime.now(timezone.utc)
    valid_from = datetime.fromisoformat(mandate["valid_from"].replace("Z", "+00:00"))
    valid_until = datetime.fromisoformat(mandate["valid_until"].replace("Z", "+00:00"))

    if valid_from > current:
        return {"valid": False, "reason": "Mandate is not yet valid"}
    if valid_until < current:
        return {"valid": False, "reason": "Mandate has expired"}
    return {"valid": True}


# ── Mandate chains (DCP-09 §3.5.2) ──

_TIER_RANK = {"routine": 0, "standard": 1, "elevated": 2, "maximum": 3}
_CLASSICAL_ALGS = frozenset({"ed25519"})
_PQ_ALGS = frozenset({"ml-dsa-65", "slh-dsa-192f"})


def _is_str(v: Any) -> bool:
    return isinstance(v, str) and v != ""


def _is_str_list(v: Any) -> bool:
    return isinstance(v, list) and all(isinstance(s, str) for s in v)


def _is_number(v: Any) -> bool:
    # math.isfinite raises OverflowError on an int too large for a float, so ints are not passed to it.
    if isinstance(v, bool):
        return False
    return isinstance(v, int) or (isinstance(v, float) and math.isfinite(v))


def _is_int(v: Any) -> bool:
    # A JSON integer; a float with no fractional part counts, as in canonicalization.
    return _is_number(v) and (isinstance(v, int) or v.is_integer())


# A numeric limit compares only as an integer within ±(2^53 − 1): every SDK reads those exactly, whether
# it parses JSON numbers as doubles or keeps every digit, so beyond them two verifiers disagree on what a
# mandate says (DCP-09 §3.5.2 rule 5).
_MAX_COMPARABLE_LIMIT = 2**53 - 1


def _is_comparable_number(v: Any) -> bool:
    return _is_int(v) and -_MAX_COMPARABLE_LIMIT <= v <= _MAX_COMPARABLE_LIMIT


def _scope_entry_ok(e: Any) -> bool:
    return (
        isinstance(e, dict)
        and _is_str(e.get("domain"))
        and _is_str_list(e.get("actions_permitted"))
        and ("data_classes" not in e or _is_str_list(e["data_classes"]))
        and ("limits" not in e or isinstance(e["limits"], dict))
    )


def _sub_delegation_ok(v: Any) -> bool:
    return isinstance(v, dict) and isinstance(v.get("permitted"), bool) and _is_int(v.get("max_depth")) and v["max_depth"] >= 0


def _canonical_equal(a: Any, b: Any) -> bool:
    try:
        return canonicalize_v2(a) == canonicalize_v2(b)
    except Exception:
        return False


def _shape_errors(m: dict[str, Any]) -> list[str]:
    """Errors in one mandate's own fields, whatever its position in the chain."""
    errors = [f"missing or invalid {f}" for f in ("mandate_id", "human_id", "agent_id") if not _is_str(m.get(f))]
    errors += [f"missing or invalid {f}" for f in ("valid_from", "valid_until") if parse_rfc3339(m.get(f)) is None]
    scope = m.get("authority_scope")
    if not isinstance(scope, list) or not scope or not all(_scope_entry_ok(e) for e in scope):
        errors.append("missing or invalid authority_scope")
    else:
        for e in scope:
            for key, v in e.get("limits", {}).items():
                if _is_number(v) and not _is_comparable_number(v):
                    errors.append(f'limits.{key} for domain "{e["domain"]}" is not comparable')
    if "sub_delegation" in m and not _sub_delegation_ok(m["sub_delegation"]):
        errors.append("invalid sub_delegation")
    if "minimum_security_tier" in m and not (isinstance(m["minimum_security_tier"], str) and m["minimum_security_tier"] in _TIER_RANK):
        errors.append("invalid minimum_security_tier")
    return errors


def _attenuation_error(parent: list[dict[str, Any]], child: list[dict[str, Any]]) -> str | None:
    """Why ``child`` is not within ``parent`` (rule 5 of DCP-09 §3.5.2), or None when it is."""
    by_domain: dict[str, dict[str, Any]] = {}
    for p in parent:
        if p["domain"] in by_domain:
            return f'authority_scope domain "{p["domain"]}" is duplicated in the parent'
        by_domain[p["domain"]] = p
    seen: set[str] = set()
    for c in child:
        domain = c["domain"]
        if domain in seen:
            return f'authority_scope domain "{domain}" is duplicated'
        seen.add(domain)
        p = by_domain.get(domain)
        if p is None:
            return f'authority_scope domain "{domain}" is not in the parent'
        if not set(c["actions_permitted"]) <= set(p["actions_permitted"]):
            return f'actions_permitted for domain "{domain}" is not a subset of the parent'
        if "data_classes" in c:
            if "data_classes" not in p:
                return f'data_classes for domain "{domain}" present but the parent has none'
            if not set(c["data_classes"]) <= set(p["data_classes"]):
                return f'data_classes for domain "{domain}" is not a subset of the parent'
        if "limits" in p:
            if "limits" not in c:
                return f'limits for domain "{domain}" missing'
            for key, pv in p["limits"].items():
                if key not in c["limits"]:
                    return f'limits.{key} for domain "{domain}" missing'
                cv = c["limits"][key]
                # A number may only shrink; anything else must stay identical. A number outside ±(2^53 − 1), or a
                # number against a non-number, is not comparable.
                if _is_number(pv) or _is_number(cv):
                    if not (_is_comparable_number(pv) and _is_comparable_number(cv)):
                        return f'limits.{key} for domain "{domain}" is not comparable'
                    within = cv <= pv
                else:
                    within = _canonical_equal(pv, cv)
                if not within:
                    return f'limits.{key} for domain "{domain}" is not within the parent'
    return None


def _signer_key(keys: list[Any], entry: Any, now: datetime) -> dict[str, Any] | str:
    """The key entry a signature slot names, or why none can verify it."""
    if not isinstance(entry, dict) or not _is_str(entry.get("kid")) or not _is_str(entry.get("alg")) or not isinstance(entry.get("sig_b64"), str):
        return "malformed signature entry"
    kid = entry["kid"]
    key = next((k for k in keys if isinstance(k, dict) and k.get("kid") == kid), None)
    if key is None:
        return f"signer key kid={kid} not found"
    if key.get("alg") != entry["alg"]:
        return f"signer key kid={kid} is {key.get('alg')}, not {entry['alg']}"
    if key.get("status") != "active":
        return f"signer key kid={kid} is {key.get('status')}"
    if key.get("expires_at") is not None:
        expires = parse_rfc3339(key["expires_at"])
        if expires is None or expires < now:
            return f"signer key kid={kid} has expired or has an invalid expires_at"
    return key


async def _mandate_sig_error(
    registry: AlgorithmRegistry,
    context: str,
    mandate: dict[str, Any],
    field: str,
    keys: Any,
    keys_label: str,
    now: datetime,
) -> str | None:
    """Verify ``field`` of ``mandate``, a pq_over_classical composite signature over the mandate without its signature fields."""
    sig = mandate.get(field)
    if not isinstance(sig, dict) or not isinstance(sig.get("classical"), dict) or not isinstance(sig.get("pq"), dict) or sig.get("binding") != "pq_over_classical":
        return f"{field} must be a pq_over_classical composite signature"
    classical, pq = sig["classical"], sig["pq"]
    if classical.get("alg") not in _CLASSICAL_ALGS:
        return f"{field} classical slot holds {classical.get('alg')}, which is not a classical algorithm"
    if pq.get("alg") not in _PQ_ALGS:
        return f"{field} PQ slot holds {pq.get('alg')}, which is not a PQ algorithm"
    if not isinstance(keys, list):
        return f"{field}: no keys for {keys_label}"
    classical_key = _signer_key(keys, classical, now)
    if isinstance(classical_key, str):
        return f"{field}: {classical_key} in {keys_label}"
    pq_key = _signer_key(keys, pq, now)
    if isinstance(pq_key, str):
        return f"{field}: {pq_key} in {keys_label}"

    payload = {k: v for k, v in mandate.items() if k not in ("human_composite_sig", "delegator_composite_sig")}
    try:
        result = await composite_verify(
            registry,
            context,
            canonicalize_v2(payload).encode("utf-8"),
            sig,  # type: ignore[arg-type]
            classical_key["public_key_b64"],
            pq_key["public_key_b64"],
        )
    except Exception as exc:  # unknown algorithm, malformed key or signature
        return f"{field} verification error: {exc}"
    if not result.valid:
        return f"{field} does not verify"
    return None


async def verify_mandate_chain(
    registry: AlgorithmRegistry,
    chain: list[dict[str, Any]],
    revoked_mandate_ids: set[str],
    keys: dict[str, Any],
    *,
    now: datetime | None = None,
) -> dict[str, Any]:
    """Verify a mandate chain, root first (DCP-09 §3.5.2).

    The root carries a valid human signature (verified against ``keys["human_keys"]``);
    each sub-mandate links to the previous mandate, is signed by that mandate's agent
    (``keys["agent_keys"][agent_id]``), is permitted by the chain's ``sub_delegation``
    policies, lies inside its parent's validity window, only narrows the parent's
    authority and never lowers its ``minimum_security_tier``; and no mandate is
    revoked, so a revoked ancestor invalidates every descendant. Anything unknown,
    missing for the depth or not comparable fails closed. ``now`` is the verification
    time (default: the current time).

    Returns ``{"valid", "errors", "depth", "effective_tier"}``: ``depth`` is the leaf's
    ``delegation_depth`` when valid, and ``effective_tier`` the greatest
    ``minimum_security_tier`` along the chain, or None when no mandate sets one.
    """
    if now is None:
        now = datetime.now(timezone.utc)
    elif now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    # The chain is untrusted input: an exception the checks below did not foresee is a rejection, not a crash.
    try:
        return await _verify_mandate_chain(registry, chain, revoked_mandate_ids, keys, now)
    except Exception as exc:  # noqa: BLE001
        return {"valid": False, "errors": [f"mandate chain verification error: {exc}"], "depth": 0, "effective_tier": None}


async def _verify_mandate_chain(
    registry: AlgorithmRegistry,
    chain: list[dict[str, Any]],
    revoked_mandate_ids: set[str],
    keys: dict[str, Any],
    now: datetime,
) -> dict[str, Any]:
    def invalid(errors: list[str]) -> dict[str, Any]:
        return {"valid": False, "errors": errors, "depth": 0, "effective_tier": None}

    if not isinstance(chain, list) or not chain:
        return invalid(["chain must be a non-empty list of mandates"])
    if not isinstance(keys, dict) or not isinstance(keys.get("human_keys"), list) or not isinstance(keys.get("agent_keys"), dict):
        return invalid(["keys must have human_keys and agent_keys"])

    effective: str | None = None
    max_depth = math.inf  # the smallest sub_delegation.max_depth of the ancestors so far
    parent: dict[str, Any] | None = None
    for i, m in enumerate(chain):
        def at(error: str, i: int = i) -> str:
            return f"mandate[{i}]: {error}"

        if not isinstance(m, dict):
            return invalid([at("not an object")])
        shape = _shape_errors(m)
        if shape:
            return invalid([at(e) for e in shape])

        errors: list[str] = []
        if parent is None:
            if "delegation_depth" in m and m["delegation_depth"] != 0:
                errors.append(at("root must have delegation_depth 0"))
            if "parent_mandate_id" in m:
                errors.append(at("root must not have parent_mandate_id"))
            slots_right = "human_composite_sig" in m and "delegator_composite_sig" not in m
            if not slots_right:
                errors.append(at("root must carry human_composite_sig and no delegator_composite_sig"))
        else:
            expected_depth = (parent.get("delegation_depth") or 0) + 1
            depth = m.get("delegation_depth")
            if not _is_int(depth) or depth != expected_depth:
                errors.append(at(f"delegation_depth must be {expected_depth}"))
            if m.get("parent_mandate_id") != parent["mandate_id"]:
                errors.append(at("parent_mandate_id must equal the parent mandate_id"))
            slots_right = "delegator_composite_sig" in m and "human_composite_sig" not in m
            if not slots_right:
                errors.append(at("sub-mandate must carry delegator_composite_sig and no human_composite_sig"))
            policy = parent.get("sub_delegation")
            if not isinstance(policy, dict) or policy.get("permitted") is not True:
                errors.append(at("parent does not permit sub-delegation"))
            else:
                max_depth = min(max_depth, policy["max_depth"])
            if _is_int(depth) and depth > max_depth:
                errors.append(at(f"delegation_depth {depth} exceeds sub_delegation.max_depth {int(max_depth)}"))
            if m["human_id"] != parent["human_id"]:
                errors.append(at("human_id differs from the parent"))
            if parse_rfc3339(m["valid_from"]) < parse_rfc3339(parent["valid_from"]):  # type: ignore[operator]
                errors.append(at("valid_from is before the parent valid_from"))
            if parse_rfc3339(m["valid_until"]) > parse_rfc3339(parent["valid_until"]):  # type: ignore[operator]
                errors.append(at("valid_until is after the parent valid_until"))
            attenuation = _attenuation_error(parent["authority_scope"], m["authority_scope"])
            if attenuation:
                errors.append(at(attenuation))
            if "minimum_security_tier" in parent:
                tier = m.get("minimum_security_tier")
                if tier not in _TIER_RANK or _TIER_RANK[tier] < _TIER_RANK[parent["minimum_security_tier"]]:
                    errors.append(at("minimum_security_tier is below the parent"))

        if m["mandate_id"] in revoked_mandate_ids:
            errors.append(at("revoked"))
        if parse_rfc3339(m["valid_from"]) > now:  # type: ignore[operator]
            errors.append(at("not yet valid at the verification time"))
        if parse_rfc3339(m["valid_until"]) < now:  # type: ignore[operator]
            errors.append(at("expired at the verification time"))

        # The signature is the costly check; only a mandate whose slots are right can have the right one.
        if slots_right:
            if parent is None:
                sig_error = await _mandate_sig_error(
                    registry, DCP_CONTEXTS["Delegation"], m, "human_composite_sig", keys["human_keys"], "human_keys", now
                )
            else:
                agent_id = parent["agent_id"]
                sig_error = await _mandate_sig_error(
                    registry,
                    DCP_CONTEXTS["SubMandate"],
                    m,
                    "delegator_composite_sig",
                    keys["agent_keys"].get(agent_id),
                    f"agent_keys of {agent_id}",
                    now,
                )
            if sig_error:
                errors.append(at(sig_error))
        if errors:
            return invalid(errors)

        if "minimum_security_tier" in m:
            tier = m["minimum_security_tier"]
            effective = tier if effective is None else max_tier(effective, tier)
        parent = m
    return {"valid": True, "errors": [], "depth": len(chain) - 1, "effective_tier": effective}


def revoke_delegation(
    mandate: dict[str, Any],
    revoked_mandate_ids: set[str],
) -> dict[str, Any]:
    """Revoke a delegation mandate; mutates `revoked_mandate_ids` in place."""
    if not mandate.get("revocable", False):
        return {"revoked": False, "reason": "Mandate is not revocable"}
    revoked_mandate_ids.add(mandate["mandate_id"])
    return {"revoked": True}


async def generate_interaction_record(
    registry: AlgorithmRegistry,
    classical_key: CompositeKeyInfo,
    pq_key: CompositeKeyInfo,
    *,
    interaction_id: str,
    session_nonce: str,
    agent_id: str,
    counterparty_agent_id: str,
    public_layer: dict[str, str],
    private_layer_hash: str,
    mandate_id: str,
) -> dict[str, Any]:
    """Create a dual-layer interaction record between agents acting under delegation."""
    payload: dict[str, Any] = {
        "dcp_version": "2.0",
        "interaction_id": interaction_id,
        "session_nonce": session_nonce,
        "agent_id": agent_id,
        "counterparty_agent_id": counterparty_agent_id,
        "public_layer": public_layer,
        "private_layer_hash": private_layer_hash,
        "mandate_id": mandate_id,
        "timestamp": _utc_now(),
    }
    canonical = canonicalize_v2(payload)
    composite = await composite_sign(
        registry,
        DCP_CONTEXTS["Delegation"],
        canonical.encode("utf-8"),
        classical_key,
        pq_key,
    )
    return {**payload, "composite_sig": composite}
